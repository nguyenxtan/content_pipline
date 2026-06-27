"use server";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { contentGenerations, contentSchedulerJobs, promptTemplates, publishedVideos, socialChannels, uploadQueue } from "@/lib/db/schema";
import { eq, desc, asc, ilike, and, count, inArray, gte } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { calcCost } from "@/lib/ai-models";
import { logApiUsage } from "@/actions/ai-usage";
import { DEFAULT_PSYCHOLOGY_SHORT_PROMPT, DEFAULT_SHORT_PROMPT, DEFAULT_LONG_PROMPT } from "@/lib/content-prompts";
import { checkCapacityGate, notifyBackpressureIfNeeded } from "@/lib/production-capacity";
import { runTTS } from "@/lib/pipeline/tts";
import { runImages } from "@/lib/pipeline/images";
import { runShortVideo } from "@/lib/pipeline/short-video";
import { runHookEngine, inferHookPattern, inferHookType, type ScoredHook } from "@/lib/hook-engine";
import {
  runScriptEngine,
} from "@/lib/script-engine";
import { createPromptVersionEntry, mergePromptVersions } from "@/lib/prompt-version-registry";
import { getContentExperimentAssignment } from "@/lib/content-experiments";
import { getContentProfile, resolveContentProfileKey } from "@/lib/config/content-profiles";
import { getChannelPublishConfig, resolveChannelKey } from "@/lib/config/channel-configs";
import { inferStrategicTopicFamily, STRATEGIC_FAMILY_DISPLAY } from "@/lib/config/topic-family-registry";
import { pickBuddhistSprintTopicFamily, sprintAllocationSummary, PHAT_PHAP_SPRINT } from "@/lib/config/sprint-config";
import { generateQuoteShortsAction } from "@/actions/quote-generator";
import { pickVoiceForContent } from "@/lib/voice-rotation";
import {
  getRecommendedShortBatchSize,
  getRecommendedShortConcurrency,
  mapWithConcurrency,
} from "@/lib/pipeline/perf";
import {
  generateContentSchema,
  schedulerJobSchema,
  updateContentStatusSchema,
  type GeneratedContentResult,
  type SchedulerJobRecord,
  type ContentGenerationRow,
  type UpdateContentStatusInput,
} from "@/lib/validations/content-generator";
import { cronRunLogs } from "@/lib/db/schema";
import type { CronRunLog } from "@/lib/db/schema";
import { autoScheduleVideoAction } from "@/actions/social-channels";
import { inferFormatType, isLongVideoContent, isTtsShortContent } from "@/lib/content-format-type";
import { resolveQuoteSchedulingTarget } from "@/lib/quotes/quote-scheduling-target";
import { getYoutubeQuoteSchedulerPolicy } from "@/lib/quotes/youtube-quote-scheduler-policy";
import { getTangSauIsolationViolation } from "@/lib/content-profile-isolation";

const MODEL =
  process.env.CONTENT_GEN_MODEL ??
  process.env.NEXT_PUBLIC_LLM_TEST_MODEL ??
  "openai/gpt-4o-mini";

function applyTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replaceAll(`{{${k}}}`, v),
    template
  );
}

function getDefaultShortPrompt(contentProfileKey: string | null | undefined): string {
  return getContentProfile(contentProfileKey).key === "psychology"
    ? DEFAULT_PSYCHOLOGY_SHORT_PROMPT
    : DEFAULT_SHORT_PROMPT;
}

const DISALLOWED_TOPIC_PATTERNS = [
  /^khám phá\b/i,
  /^hành trình\b/i,
  /^bí quyết\b/i,
  /^nghệ thuật\b/i,
  /^lời dạy\b/i,
  /^những\b/i,
  /^sức mạnh\b/i,
  /^bí mật\b/i,
  /^điều gì\b/i,
  /^tại sao\b/i,
  /^vì sao\b/i,
  /^làm sao\b/i,
  /^đừng\b/i,
  /^người\b/i,
  /^càng\b/i,
  /^có những\b/i,
  /^trong cuộc sống\b/i,
];

function normalizeSuggestedTopic(value: string): string {
  return value
    .replace(/^\s*\d+[\.\)]\s*/, "")
    .replace(/^[\-*•]+\s*/, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[.!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidShortTopic(value: string): boolean {
  const topic = normalizeSuggestedTopic(value);
  const words = topic.split(/\s+/).filter(Boolean);
  if (!topic || words.length < 1 || words.length > 5) return false;
  if (topic.length > 40) return false;
  if (/[,:]/.test(topic)) return false;
  if (DISALLOWED_TOPIC_PATTERNS.some((pattern) => pattern.test(topic))) return false;
  return true;
}

async function generateShortHooksAndScript(params: {
  client: ReturnType<typeof getOpenRouterClient>;
  model: string;
  topic: string;
  nicheName: string;
  nicheDescription?: string | null;
  tone?: string | null;
  contentProfileKey?: string | null;
  shortBasePrompt: string;
  dedupBlock: string;
}): Promise<{
  hookCandidates: string[];
  selectedHook: string;
  shortContent: string;
  hookScoredCandidates: ScoredHook[];
  hookScore: number | null;
  hookPattern: string;
  hookType: string;
  usage: { hookIn: number; hookOut: number; pickIn: number; pickOut: number; shortIn: number; shortOut: number };
}> {
  const hookEngine = await runHookEngine({
    client: params.client,
    model: params.model,
    topic: params.topic,
    nicheName: params.nicheName,
    nicheDescription: params.nicheDescription,
    tone: params.tone,
    contentProfileKey: params.contentProfileKey,
    dedupBlock: params.dedupBlock,
    count: 20,
  });

  const shortScript = await runScriptEngine({
    client: params.client,
    model: params.model,
    topic: params.topic,
    nicheName: params.nicheName,
    selectedHook: hookEngine.selectedHook,
    contentProfileKey: params.contentProfileKey,
    mode: "short",
    shortBasePrompt: params.shortBasePrompt + params.dedupBlock,
  });
  if (shortScript.mode !== "short") throw new Error("Short script engine returned invalid mode");

  const hookScore = hookEngine.scoredHooks.find(h => h.hook === hookEngine.selectedHook)?.scores.total ?? null;

  const hookPattern = inferHookPattern(hookEngine.selectedHook);
  const hookType = inferHookType(hookEngine.selectedHook);

  return {
    hookCandidates: hookEngine.hooks,
    selectedHook: hookEngine.selectedHook,
    shortContent: shortScript.result.script,
    hookScoredCandidates: hookEngine.scoredHooks,
    hookScore,
    hookPattern,
    hookType,
    usage: {
      hookIn: hookEngine.usage.generateIn,
      hookOut: hookEngine.usage.generateOut,
      pickIn: hookEngine.usage.scoreIn,
      pickOut: hookEngine.usage.scoreOut,
      shortIn: shortScript.usage.inputTokens,
      shortOut: shortScript.usage.outputTokens,
    },
  };
}

/**
 * Dùng AI để tạo prompt chuyên biệt dựa trên thông tin phân mục
 * (tên, mô tả, đối tượng, giọng điệu, lĩnh vực)
 */
export async function generateNichePromptAction(
  nicheId: number,
  stage: "short" | "long",
  model: string
): Promise<{ prompt: string } | { error: string }> {
  const niche = await db.query.niches.findFirst({
    where: (n, { eq: e }) => e(n.id, nicheId),
  });
  if (!niche) return { error: "Không tìm thấy phân mục" };

  const client = getOpenRouterClient();

  const nicheProfile = [
    `Tên phân mục: ${niche.name}`,
    niche.category    ? `Lĩnh vực: ${niche.category}`            : null,
    niche.description ? `Mô tả: ${niche.description}`            : null,
    niche.targetAudience ? `Đối tượng: ${niche.targetAudience}`  : null,
    niche.tone        ? `Giọng điệu: ${niche.tone}`              : null,
  ].filter(Boolean).join("\n");

  const stageSpec = stage === "short"
    ? `Script YouTube Short, ĐÚNG 150-170 từ (không được vượt quá 170 từ):
- Mở đầu tự nhiên dẫn vào chủ đề (không cần hook giật gân)
- Trình bày nội dung/câu chuyện cốt lõi phù hợp giọng văn phân mục
- Kết thúc bằng 1-2 câu nhẹ nhàng mời người xem đăng ký/theo dõi kênh để nhận thêm chia sẻ (giọng thành tâm, không quảng cáo cứng)
- Biến dùng: {{topic}}, {{niche}}, {{script}}
- ĐỊNH DẠNG OUTPUT BẮT BUỘC (phải ghi rõ trong prompt): chỉ TEXT THUẦN — không markdown, không dấu **, không label section ("HOOK:", "CTA:", ...), không ghi chú cảnh trong ngoặc đơn, bắt đầu ngay với câu đầu tiên
- GIỚI HẠN TỪ BẮT BUỘC (phải ghi rõ trong prompt): tổng độ dài ĐÚNG 150-170 từ, đếm kỹ trước khi xuất`
    : `Script video YouTube dài 15-18 phút, tổng 2000-2400 từ Tiếng Việt:
- Đây là script đọc trực tiếp trước camera (không phải outline) — câu ngắn, tự nhiên
- Cấu trúc: Mở đầu (~200 từ) → Nội dung chính (~1800 từ) → Kết (~100 từ)
- QUAN TRỌNG: Viết đủ chiều dài, không dừng giữa chừng
- Giọng văn phù hợp phân mục "${niche.name}" và đối tượng
- Biến dùng: {{topic}}, {{niche}}, {{script}}
- ĐỊNH DẠNG OUTPUT BẮT BUỘC (phải ghi rõ trong prompt): chỉ TEXT THUẦN — không markdown, không dấu **, không label section ("HOOK:", "PHẦN 1:", "Kết luận:", ...), không ghi chú cảnh, bắt đầu ngay với câu đầu tiên của hook`;

  const metaPrompt = `Bạn là chuyên gia viết prompt cho AI tạo nội dung YouTube Tiếng Việt.

Thông tin phân mục:
${nicheProfile}

Nhiệm vụ: Viết một prompt hoàn chỉnh, chi tiết để khi đưa vào AI, AI sẽ tạo ra:
${stageSpec}

Yêu cầu cho prompt bạn viết:
- Viết bằng Tiếng Việt
- Bắt đầu bằng các biến đầu vào (Chủ đề: {{topic}}, Phân mục: {{niche}}, ...)
- Nêu rõ yêu cầu về độ dài, cấu trúc, giọng văn phù hợp phân mục "${niche.name}"
- Có hướng dẫn cụ thể về phong cách, tone phù hợp đối tượng
- BẮT BUỘC phải có đoạn yêu cầu định dạng output: "Chỉ xuất TEXT THUẦN — không markdown, không dấu **, không tiêu đề section, không ghi chú cảnh trong ngoặc đơn, không label như HOOK: hay CTA:. Bắt đầu ngay với câu đầu tiên."
- Kết thúc bằng "Chỉ xuất ${stage === "short" ? "script" : "toàn bộ script"}, không giải thích thêm."
- KHÔNG dùng markdown heading, KHÔNG giải thích, chỉ xuất prompt thuần`;

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Bạn viết prompt cho AI. Chỉ xuất nội dung prompt, không có text thêm." },
        { role: "user", content: metaPrompt },
      ],
      temperature: 0.7,
      max_tokens: stage === "long" ? 1400 : 800,
    });
    const generated = res.choices[0]?.message?.content?.trim() ?? "";
    if (!generated) return { error: "AI không trả về kết quả" };
    await logApiUsage({
      model,
      purpose: "niche_prompt",
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      nicheId,
    });
    return { prompt: generated };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Lỗi generate prompt" };
  }
}

export async function getContentPromptsAction(nicheId: number): Promise<{
  short: string; long: string;
  shortModel: string; longModel: string;
}> {
  const niche = await db.query.niches.findFirst({
    where: (n, { eq: e }) => e(n.id, nicheId),
    columns: { contentProfileKey: true },
  });
  const [shortTpl, longTpl] = await Promise.all([
    db.query.promptTemplates.findFirst({
      where: (t, { and: a, eq: e }) =>
        a(e(t.nicheId, nicheId), e(t.stage, "short_gen"), e(t.isActive, true)),
    }),
    db.query.promptTemplates.findFirst({
      where: (t, { and: a, eq: e }) =>
        a(e(t.nicheId, nicheId), e(t.stage, "long_gen"), e(t.isActive, true)),
    }),
  ]);
  return {
    short: shortTpl?.content ?? getDefaultShortPrompt(niche?.contentProfileKey),
    long: longTpl?.content ?? DEFAULT_LONG_PROMPT,
    shortModel: shortTpl?.model ?? MODEL,
    longModel: longTpl?.model ?? MODEL,
  };
}

export async function saveContentPromptAction(
  nicheId: number,
  stage: "short" | "long",
  content: string,
  model: string
): Promise<{ success: boolean; error?: string }> {
  const dbStage = stage === "short" ? "short_gen" : "long_gen";
  try {
    const existing = await db.query.promptTemplates.findFirst({
      where: (t, { and: a, eq: e }) =>
        a(e(t.nicheId, nicheId), e(t.stage, dbStage), e(t.isActive, true)),
    });
    if (existing) {
      await db
        .update(promptTemplates)
        .set({ content, model })
        .where(eq(promptTemplates.id, existing.id));
    } else {
      await db.insert(promptTemplates).values({
        nicheId,
        stage: dbStage,
        name: `${stage} content generator`,
        content,
        variables: ["topic", "niche", "script"],
        model,
        version: 1,
        isActive: true,
      });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "DB error" };
  }
}

/** Lấy tiêu đề các video trong 14 ngày qua của một niche để tránh trùng lặp */
export async function getRecentTopicsAction(nicheId: number, days = 14): Promise<string[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ topic: contentGenerations.topic })
    .from(contentGenerations)
    .where(and(eq(contentGenerations.nicheId, nicheId), gte(contentGenerations.createdAt, since)))
    .orderBy(desc(contentGenerations.createdAt))
    .limit(50);
  return rows.map(r => r.topic).filter(Boolean);
}

export async function suggestTopicsAction(
  nicheId: number,
  model = "openai/gpt-4o-mini",
  count = 8,
  topicFamily?: string,
): Promise<{ topics: string[] } | { error: string }> {
  const niche = await db.query.niches.findFirst({
    where: (n, { eq: e }) => e(n.id, nicheId),
  });
  if (!niche) return { error: "Không tìm thấy phân mục" };

  // Fetch recent titles to inject as dedup context
  const recentTopics = await getRecentTopicsAction(nicheId, 14);
  const dedupBlock = recentTopics.length > 0
    ? `\n\nCác tiêu đề ĐÃ LÀM trong 14 ngày qua (TUYỆT ĐỐI không tạo nội dung tương tự, trùng lặp về chủ đề hoặc góc nhìn):\n${recentTopics.slice(0, 30).map((t, i) => `${i + 1}. ${t}`).join("\n")}\n`
    : "";

  // Inject sprint family hint for Buddhist content — guides LLM toward target family
  const familyDisplayName = topicFamily
    ? (STRATEGIC_FAMILY_DISPLAY[topicFamily as keyof typeof STRATEGIC_FAMILY_DISPLAY] ?? topicFamily)
    : null;
  const familyBlock = familyDisplayName
    ? `\n\nChủ đề PHẢI thuộc nhóm nội dung: "${familyDisplayName}". Tập trung vào góc nhìn, cảm xúc, và câu chuyện liên quan đến nhóm này.`
    : "";

  const nicheContext = `Phân mục YouTube: "${niche.name}"${niche.description ? ` — ${niche.description}` : ""}${niche.targetAudience ? `\nĐối tượng: ${niche.targetAudience}` : ""}`;
  const profile = getContentProfile(niche.contentProfileKey);

  const client = getOpenRouterClient();
  const prompt = profile.key === "psychology"
    ? (count === 1
      ? `${nicheContext}${dedupBlock}
Gợi ý 1 chủ đề ngắn gọn cho video short về tâm lý, quan hệ, trưởng thành và hành vi con người.

Yêu cầu:
- Chủ đề phải là một cảm xúc, trạng thái, hành vi, hoặc tình huống rất thật trong đời sống hiện đại
- Viết như một nhãn chủ đề ngắn, KHÔNG phải tiêu đề YouTube
- Độ dài: 2-7 từ tiếng Việt
- Ưu tiên các kiểu chủ đề như: "Bị thao túng cảm xúc", "Ngại giải thích", "Sợ làm phiền", "Tử tế quá mức", "Im lặng sau tổn thương", "Áp lực phải ổn"
- KHÔNG dùng mở đầu kiểu tiêu đề như: "Khám phá...", "Bí quyết...", "Lời dạy..."
- KHÔNG dùng khung Phật giáo, tôn giáo, nghiệp, nhân quả
- Không dùng dấu hai chấm, không dùng câu hoàn chỉnh, không giật tít
- Chủ đề phải KHÁC BIỆT hoàn toàn với danh sách đã liệt kê
- Chỉ trả về chủ đề duy nhất, không thêm giải thích, không đánh số, không dấu ngoặc kép`
      : `${nicheContext}${dedupBlock}
Gợi ý ${count} chủ đề ngắn gọn cho video short về tâm lý, quan hệ, trưởng thành và hành vi con người.

Yêu cầu:
- Mỗi chủ đề phải là một cảm xúc, trạng thái, hành vi, hoặc tình huống rất thật trong đời sống hiện đại
- Viết như một nhãn chủ đề ngắn, KHÔNG phải tiêu đề YouTube
- Độ dài: 2-7 từ tiếng Việt
- Ưu tiên các kiểu chủ đề như: "Bị thao túng cảm xúc", "Ngại giải thích", "Sợ làm phiền", "Tử tế quá mức", "Im lặng sau tổn thương", "Áp lực phải ổn"
- KHÔNG dùng mở đầu kiểu tiêu đề như: "Khám phá...", "Bí quyết...", "Lời dạy..."
- KHÔNG dùng khung Phật giáo, tôn giáo, nghiệp, nhân quả
- Không dùng dấu hai chấm, không dùng câu hoàn chỉnh, không giật tít
- Mỗi chủ đề phải KHÁC BIỆT hoàn toàn, không trùng lặp với nhau hoặc với danh sách đã liệt kê
- Liệt kê đánh số 1. 2. 3. ... (mỗi dòng 1 chủ đề, không giải thích thêm)`)
    : count === 1
      ? `${nicheContext}${dedupBlock}${familyBlock}
Gợi ý 1 chủ đề ngắn gọn cho video short về lĩnh vực trên.

Yêu cầu:
- Chủ đề phải là một cảm xúc, nỗi đau, trạng thái, hoặc tình huống mà con người hay trải qua trong cuộc sống
- Viết như một nhãn chủ đề ngắn, KHÔNG phải tiêu đề YouTube
- Độ dài: 1-5 từ tiếng Việt
- Ưu tiên các kiểu chủ đề như: "Tha thứ", "Buông bỏ", "Cô đơn", "Tự ti", "Sợ bị bỏ rơi", "Mất lòng tin", "Không được thấu hiểu", "Tiếc một người"
- KHÔNG dùng các mở đầu kiểu tiêu đề như: "Khám phá...", "Hành trình...", "Bí quyết...", "Nghệ thuật...", "Lời dạy..."
- Không dùng dấu hai chấm, không dùng câu hoàn chỉnh, không giật tít
- Chủ đề phải KHÁC BIỆT hoàn toàn với danh sách đã liệt kê
- Chỉ trả về chủ đề duy nhất, không thêm giải thích, không đánh số, không dấu ngoặc kép`
      : `${nicheContext}${dedupBlock}${familyBlock}
Gợi ý ${count} chủ đề ngắn gọn cho video short về lĩnh vực trên.

Yêu cầu:
- Mỗi chủ đề phải là một cảm xúc, nỗi đau, trạng thái, hoặc tình huống mà con người hay trải qua trong cuộc sống
- Viết như một nhãn chủ đề ngắn, KHÔNG phải tiêu đề YouTube
- Độ dài: 1-5 từ tiếng Việt
- Ưu tiên các kiểu chủ đề như: "Tha thứ", "Buông bỏ", "Cô đơn", "Tự ti", "Sợ bị bỏ rơi", "Mất lòng tin", "Không được thấu hiểu", "Tiếc một người"
- KHÔNG dùng các mở đầu kiểu tiêu đề như: "Khám phá...", "Hành trình...", "Bí quyết...", "Nghệ thuật...", "Lời dạy..."
- Không dùng dấu hai chấm, không dùng câu hoàn chỉnh, không giật tít
- Mỗi chủ đề phải KHÁC BIỆT hoàn toàn, không trùng lặp với nhau hoặc với danh sách đã liệt kê
- Liệt kê đánh số 1. 2. 3. ... (mỗi dòng 1 chủ đề, không giải thích thêm)`;

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.9,
      max_tokens: count === 1 ? 150 : 800,
    });
    const content = res.choices[0]?.message?.content ?? "";
    let topics: string[];
    if (count === 1) {
      // Introductory phrases that indicate a line is NOT a title
      const isIntro = (s: string) =>
        /^(dưới đây|sau đây|đây là|gợi ý|tiêu đề|tôi gợi ý|xin giới thiệu)/i.test(s);

      const cleanLine = (l: string) =>
        l.replace(/^\s*\d+[\.\)]\s*/, "")
         .replace(/^\*+\s*/, "").replace(/\*+$/, "")
         .replace(/^\[|\]$/g, "")
         .replace(/"/g, "")
         .trim();

      const lines = content.split("\n").map(cleanLine).filter(Boolean);

      // Topics must remain short, concrete, and headline-free.
      const candidate = lines.find(
        (l) => !isIntro(l) && isValidShortTopic(l)
      );

      const title = candidate ?? null;
      topics = title ? [title.slice(0, 200)] : [];
    } else {
      // Multi-topic: each line is a separate short theme.
      const lines = content
        .split("\n")
        .map(normalizeSuggestedTopic)
        .filter(isValidShortTopic)
        .filter((line, index, arr) => arr.findIndex((x) => x.toLowerCase() === line.toLowerCase()) === index);
      topics = lines.slice(0, count);
    }
    const data = { topics };
    await logApiUsage({
      model,
      purpose: "topic_suggest",
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      nicheId,
    });
    return { topics: data.topics ?? [] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Lỗi gợi ý" };
  }
}

export async function generateContentAction(
  nicheId: number,
  topic: string,
  scriptModel?: string,
  contentMode: "short" | "long" | "both" = "both",
  topicFamily?: string,
): Promise<GeneratedContentResult | { error: string }> {
  const parsed = generateContentSchema.safeParse({ nicheId, topic });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input không hợp lệ" };
  }

  const niche = await db.query.niches.findFirst({
    where: (n, { eq: eqFn }) => eqFn(n.id, parsed.data.nicheId),
  });
  if (!niche) return { error: "Không tìm thấy ngách" };

  const client = getOpenRouterClient();
  const start = Date.now();
  const contentProfileKey = resolveContentProfileKey(niche.contentProfileKey);
  const channelKey = resolveChannelKey(niche.channelKey);

  const script = "";
  let shortContent = "";
  let shortHookCandidates: string[] = [];
  let shortSelectedHook = "";
  let longContent = "";
  let hookScoredCandidates: ScoredHook[] = [];
  let hookScore: number | null = null;
  let hookPattern: string | null = null;
  let hookType: string | null = null;
  let hookGeneratedAt: Date | null = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;

  const shortTokens = { in: 0, out: 0 };
  const shortHookTokens = { in: 0, out: 0 };
  const shortPickTokens = { in: 0, out: 0 };
  const longTokens  = { in: 0, out: 0 };
  let shortModel = MODEL;
  let longModel  = MODEL;
  const needShort = contentMode === "short" || contentMode === "both";
  const needLong  = contentMode === "long"  || contentMode === "both";
  // Longform generation is out of scope (see docs/SCOPE_REDUCTION_AUDIT_2026_06_26.md).
  // Fail closed instead of silently downgrading so callers notice immediately.
  if (needLong) {
    return { error: "Long-form generation đã bị loại bỏ khỏi scope (xem SCOPE_REDUCTION_AUDIT)." };
  }
  let shortPromptTemplateId: number | null = null;
  let shortPromptTemplateVersion: number | null = null;
  let longPromptTemplateId: number | null = null;
  let longPromptTemplateVersion: number | null = null;
  // Generate ID before the try block so script/hook usage logs can be linked to this content row
  const newId = crypto.randomUUID();

  try {
    // Script step removed — reserved for future audio story subsystem (see memory: project_audio_story_vision)
    const [shortTpl, longTpl] = await Promise.all([
      db.query.promptTemplates.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(e(t.nicheId, niche.id), e(t.stage, "short_gen"), e(t.isActive, true)),
      }),
      db.query.promptTemplates.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(e(t.nicheId, niche.id), e(t.stage, "long_gen"), e(t.isActive, true)),
      }),
    ]);

    const vars = { topic: parsed.data.topic, niche: niche.name, script: "" };
    shortModel = shortTpl?.model ?? MODEL;
    longModel  = longTpl?.model  ?? MODEL;
    shortPromptTemplateId = shortTpl?.id ?? null;
    shortPromptTemplateVersion = shortTpl?.version ?? null;
    longPromptTemplateId = longTpl?.id ?? null;
    longPromptTemplateVersion = longTpl?.version ?? null;

    // Fetch recent topics to inject as dedup context (same as suggestTopicsAction)
    const recentTopics = await getRecentTopicsAction(niche.id, 14);
    const dedupBlock = recentTopics.length > 0
      ? `\n\nCác chủ đề ĐÃ LÀM trong 14 ngày qua — TUYỆT ĐỐI không tạo nội dung trùng lặp hoặc tương tự về góc nhìn:\n${recentTopics.slice(0, 30).map((t, i) => `${i + 1}. ${t}`).join("\n")}\n`
      : "";

    if (needShort) {
      const shortBasePrompt = applyTemplate(shortTpl?.content ?? getDefaultShortPrompt(contentProfileKey), vars);
      const shortDraft = await generateShortHooksAndScript({
        client,
        model: shortModel,
        topic: parsed.data.topic,
        nicheName: niche.name,
        nicheDescription: niche.description,
        tone: niche.tone,
        contentProfileKey,
        shortBasePrompt,
        dedupBlock,
      });
      shortHookCandidates = shortDraft.hookCandidates;
      shortSelectedHook = shortDraft.selectedHook;
      shortContent = shortDraft.shortContent;
      hookScoredCandidates = shortDraft.hookScoredCandidates;
      hookScore = shortDraft.hookScore;
      hookPattern = shortDraft.hookPattern;
      hookType = shortDraft.hookType;
      hookGeneratedAt = new Date();
      shortHookTokens.in = shortDraft.usage.hookIn;
      shortHookTokens.out = shortDraft.usage.hookOut;
      shortPickTokens.in = shortDraft.usage.pickIn;
      shortPickTokens.out = shortDraft.usage.pickOut;
      shortTokens.in = shortDraft.usage.shortIn;
      shortTokens.out = shortDraft.usage.shortOut;
    }

    totalInputTokens  += shortHookTokens.in + shortPickTokens.in + shortTokens.in  + longTokens.in;
    totalOutputTokens += shortHookTokens.out + shortPickTokens.out + shortTokens.out + longTokens.out;

    const logJobs: Promise<void>[] = [];
    if (needShort) {
      logJobs.push(logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: shortHookTokens.in, outputTokens: shortHookTokens.out, nicheId: niche.id, contentGenerationId: newId }));
      logJobs.push(logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: shortPickTokens.in, outputTokens: shortPickTokens.out, nicheId: niche.id, contentGenerationId: newId }));
      logJobs.push(logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: shortTokens.in, outputTokens: shortTokens.out, nicheId: niche.id, contentGenerationId: newId }));
    }
    if (needLong)  logJobs.push(logApiUsage({ model: longModel, purpose: "content_long", inputTokens: longTokens.in, outputTokens: longTokens.out, nicheId: niche.id, contentGenerationId: newId }));
    await Promise.all(logJobs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM error";
    return { error: msg };
  }

  const generationTime = Date.now() - start;
  totalCost =
    calcCost(shortModel, shortHookTokens.in, shortHookTokens.out) +
    calcCost(shortModel, shortPickTokens.in, shortPickTokens.out) +
    calcCost(shortModel, shortTokens.in, shortTokens.out) +
    calcCost(longModel,  longTokens.in,  longTokens.out);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const experimentAssignment = getContentExperimentAssignment();
  const promptVersions = {
    hook: createPromptVersionEntry("hook", {
      model: shortModel,
      stage: "hook_engine",
      mode: contentMode,
      details: {
        count: shortHookCandidates.length,
        usedForShort: needShort,
        usedForLong: needLong,
      },
    }),
    script: createPromptVersionEntry("script", {
      model: needShort && needLong && shortModel !== longModel
        ? `${shortModel}, ${longModel}`
        : needLong
          ? longModel
          : shortModel,
      mode: contentMode,
      details: {
        short: needShort
          ? {
              stage: "short_gen",
              templateId: shortPromptTemplateId,
              templateVersion: shortPromptTemplateVersion,
              model: shortModel,
            }
          : null,
        long: needLong
          ? {
              stage: "long_gen",
              templateId: longPromptTemplateId,
              templateVersion: longPromptTemplateVersion,
              model: longModel,
            }
          : null,
      },
    }),
    titleMetadata: createPromptVersionEntry("titleMetadata", {
      model: null,
      mode: contentMode,
      details: {
        source: "deterministic_social_metadata_builder",
      },
    }),
  };

  const resolvedTopicFamily = topicFamily ?? inferStrategicTopicFamily(parsed.data.topic);

  // Voice Rotation V1: pick voice deterministically before INSERT so it goes in atomically.
  // Only applies to tts_short (voice is irrelevant for legacy_quote_short / long_video).
  // newId was declared earlier so script/hook usage logs can reference it before INSERT.
  const rotatedVoice = pickVoiceForContent(newId, channelKey);

  console.log(
    `[generate] topic="${parsed.data.topic}" family="${resolvedTopicFamily}"` +
    ` (${STRATEGIC_FAMILY_DISPLAY[resolvedTopicFamily as keyof typeof STRATEGIC_FAMILY_DISPLAY] ?? resolvedTopicFamily})` +
    ` format="tts_short" channel="${channelKey}"` +
    (rotatedVoice ? ` voice=${rotatedVoice}` : ""),
  );

  if (shortSelectedHook) {
    console.log(
      `[HOOK_TRACKING] selected | hookText: "${shortSelectedHook}" | hookType: ${hookType ?? "other"}` +
      ` | score: ${hookScore ?? "—"} | variant: ${experimentAssignment.experimentVariant}` +
      ` | contentId: ${newId}`,
    );
  }

  const [row] = await db
    .insert(contentGenerations)
    .values({
      id: newId,
      topic: parsed.data.topic,
      nicheId: niche.id,
      nicheName: niche.name,
      contentProfileKey,
      channelKey,
      script,
      shortContent,
      shortHookCandidates,
      shortSelectedHook,
      hookScoredCandidates,
      hookScore,
      hookPattern,
      hookType,
      hookVariant: experimentAssignment.experimentVariant || null,
      ...(hookGeneratedAt ? { hookGeneratedAt } : {}),
      longContent,
      promptVersions,
      experimentId: experimentAssignment.experimentId,
      experimentVariant: experimentAssignment.experimentVariant,
      totalTokens,
      totalCost: totalCost.toString(),
      generationTime,
      status: "completed",
      contentMode,
      formatType: "tts_short",
      topicFamily: resolvedTopicFamily,
      ttsVoice: rotatedVoice,
    })
    .returning({ id: contentGenerations.id });

  return {
    generationId: row.id,
    topic: parsed.data.topic,
    nicheName: niche.name,
    contentProfileKey,
    channelKey,
    script,
    shortContent,
    shortHookCandidates,
    shortSelectedHook: shortSelectedHook || null,
    longContent,
    promptVersions,
    experimentId: experimentAssignment.experimentId,
    experimentVariant: experimentAssignment.experimentVariant,
    totalTokens,
    totalCost,
    generationTime,
  };
}

export async function regenerateShortHooksAction(
  contentId: string
): Promise<{ success: true; shortContent: string; shortHookCandidates: string[]; shortSelectedHook: string } | { success: false; error: string }> {
  const item = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
  if (!item) return { success: false, error: "Không tìm thấy content" };

  const [{ total: queueTotal }] = await db
    .select({ total: count() })
    .from(uploadQueue)
    .where(and(
      eq(uploadQueue.contentId, contentId),
      inArray(uploadQueue.videoType, ["short", "quote"]),
      inArray(uploadQueue.status, ["queued", "uploading", "done"]),
    ));
  const [{ total: publishedTotal }] = await db
    .select({ total: count() })
    .from(publishedVideos)
    .where(and(
      eq(publishedVideos.contentId, contentId),
      inArray(publishedVideos.videoType, ["short", "quote"]),
    ));

  if (Number(queueTotal) > 0 || Number(publishedTotal) > 0) {
    return {
      success: false,
      error: "Content này đã vào queue hoặc đã đăng short/Facebook. Không nên đổi hook nữa vì sẽ lệch lịch sử phân tích.",
    };
  }

  const niche = await db.query.niches.findFirst({
    where: (n, { eq: eqFn }) => eqFn(n.id, item.nicheId),
  });
  if (!niche) return { success: false, error: "Không tìm thấy ngách" };

  const shortTpl = await db.query.promptTemplates.findFirst({
    where: (t, { and: a, eq: e }) =>
      a(e(t.nicheId, item.nicheId), e(t.stage, "short_gen"), e(t.isActive, true)),
  });
  const shortModel = shortTpl?.model ?? MODEL;
  const vars = { topic: item.topic, niche: item.nicheName, script: "" };
  const shortBasePrompt = applyTemplate(shortTpl?.content ?? getDefaultShortPrompt(item.contentProfileKey), vars);

  const recentTopics = await getRecentTopicsAction(item.nicheId, 14);
  const dedupBlock = recentTopics.length > 0
    ? `\n\nCác chủ đề ĐÃ LÀM trong 14 ngày qua — TUYỆT ĐỐI không tạo nội dung trùng lặp hoặc tương tự về góc nhìn:\n${recentTopics.slice(0, 30).map((t, i) => `${i + 1}. ${t}`).join("\n")}\n`
    : "";

  const client = getOpenRouterClient();

  try {
    const draft = await generateShortHooksAndScript({
      client,
      model: shortModel,
      topic: item.topic,
      nicheName: item.nicheName,
      nicheDescription: niche.description,
      tone: niche.tone,
      contentProfileKey: item.contentProfileKey,
      shortBasePrompt,
      dedupBlock,
    });

    removeFile(item.audioPath);
    removeDir(`media/images/${contentId}`);
    removeFile(item.videoPath);

    await db.delete(uploadQueue).where(and(
      eq(uploadQueue.contentId, contentId),
      inArray(uploadQueue.videoType, ["short", "quote"]),
    ));

    await db.update(contentGenerations)
      .set({
        shortContent: draft.shortContent,
        shortHookCandidates: draft.hookCandidates,
        shortSelectedHook: draft.selectedHook,
        hookScoredCandidates: draft.hookScoredCandidates,
        hookScore: draft.hookScore,
        hookPattern: draft.hookPattern,
        totalTokens: (item.totalTokens ?? 0) + draft.usage.hookIn + draft.usage.hookOut + draft.usage.pickIn + draft.usage.pickOut + draft.usage.shortIn + draft.usage.shortOut,
        totalCost: (Number(item.totalCost) + calcCost(shortModel, draft.usage.hookIn, draft.usage.hookOut) + calcCost(shortModel, draft.usage.pickIn, draft.usage.pickOut) + calcCost(shortModel, draft.usage.shortIn, draft.usage.shortOut)).toString(),
        ttsStatus: "pending",
        ttsErrorMessage: null,
        ttsOutputUrl: null,
        audioPath: null,
        ttsDurationMs: null,
        imagesStatus: "pending",
        imagesErrorMessage: null,
        imagePaths: [],
        imagesDurationMs: null,
        imagesCostUsd: null,
        videoStatus: "pending",
        videoErrorMessage: null,
        videoPath: null,
        youtubeUploadStatus: "pending",
        youtubeUploadError: null,
        youtubeVideoUrl: null,
        youtubeScheduledAt: null,
        facebookUploadStatus: "pending",
        facebookUploadError: null,
        facebookVideoUrl: null,
        facebookScheduledAt: null,
        promptVersions: mergePromptVersions(item.promptVersions, {
          hook: createPromptVersionEntry("hook", {
            model: shortModel,
            stage: "hook_engine",
            mode: "short",
            details: {
              count: draft.hookCandidates.length,
              regenerated: true,
            },
          }),
          script: createPromptVersionEntry("script", {
            model: shortModel,
            stage: "short_gen",
            mode: "short",
            templateId: shortTpl?.id ?? null,
            templateVersion: shortTpl?.version ?? null,
            details: {
              regeneratedFromHooks: true,
            },
          }),
        }),
        completedAt: null,
        mediaScheduledCleanAt: null,
        mediaCleanedAt: null,
      })
      .where(eq(contentGenerations.id, contentId));

    await Promise.all([
      logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: draft.usage.hookIn, outputTokens: draft.usage.hookOut, nicheId: item.nicheId, contentGenerationId: contentId }),
      logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: draft.usage.pickIn, outputTokens: draft.usage.pickOut, nicheId: item.nicheId, contentGenerationId: contentId }),
      logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: draft.usage.shortIn, outputTokens: draft.usage.shortOut, nicheId: item.nicheId, contentGenerationId: contentId }),
    ]);

    return {
      success: true,
      shortContent: draft.shortContent,
      shortHookCandidates: draft.hookCandidates,
      shortSelectedHook: draft.selectedHook,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "LLM error" };
  }
}

export async function getContentGenerationAction(
  id: string
): Promise<GeneratedContentResult | null> {
  const row = await db.query.contentGenerations.findFirst({
    where: (c, { eq: eqFn }) => eqFn(c.id, id),
  });
  if (!row) return null;
  return {
    generationId: row.id,
    topic: row.topic,
    nicheName: row.nicheName,
    contentProfileKey: row.contentProfileKey,
    channelKey: row.channelKey,
    script: row.script,
    shortContent: row.shortContent,
    shortHookCandidates: (row.shortHookCandidates as string[]) ?? [],
    shortSelectedHook: row.shortSelectedHook ?? null,
    longContent: row.longContent,
    promptVersions: row.promptVersions ?? null,
    experimentId: row.experimentId ?? null,
    experimentVariant: row.experimentVariant ?? null,
    totalTokens: row.totalTokens ?? 0,
    totalCost: Number(row.totalCost),
    generationTime: row.generationTime ?? 0,
  };
}

export async function getRecentContentGenerationsAction(
  limit = 5
): Promise<Array<{ id: string; topic: string; nicheName: string; createdAt: Date }>> {
  const rows = await db
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      nicheName: contentGenerations.nicheName,
      createdAt: contentGenerations.createdAt,
    })
    .from(contentGenerations)
    .orderBy(desc(contentGenerations.createdAt))
    .limit(limit);
  return rows;
}

const FREQUENCY_MINUTES: Record<string, number> = {
  "15min":   15,
  "30min":   30,
  "45min":   45,
  "hourly":  60,
  "90min":   90,
  "2hourly": 120,
  "3hourly": 180,
  "4hourly": 240,
  "6hourly": 360,
  "12hourly":720,
  "daily":   1440,
};
const BACKPRESSURE_DELAY_MINUTES = 10;

function calculateNextRunAt(frequency: string): Date {
  const now = new Date();
  const minutes = FREQUENCY_MINUTES[frequency];
  if (minutes) {
    const next = new Date(now);
    next.setSeconds(0, 0);

    const totalMinutes = next.getHours() * 60 + next.getMinutes();
    const nextBoundaryMinutes = Math.ceil((totalMinutes + 1) / minutes) * minutes;

    if (nextBoundaryMinutes >= 24 * 60) {
      next.setDate(next.getDate() + Math.floor(nextBoundaryMinutes / (24 * 60)));
    }

    const normalized = nextBoundaryMinutes % (24 * 60);
    next.setHours(Math.floor(normalized / 60), normalized % 60, 0, 0);
    return next;
  }
  return new Date(now.getTime() + 60 * 60 * 1000);
}

async function deferSchedulerJobForBackpressure(
  jobId: string,
  oldNextRunAt: Date | null,
): Promise<Date> {
  const newNextRunAt = new Date(Date.now() + BACKPRESSURE_DELAY_MINUTES * 60_000);
  await db.update(contentSchedulerJobs)
    .set({
      nextRunAt: newNextRunAt,
      updatedAt: new Date(),
    })
    .where(eq(contentSchedulerJobs.id, jobId));
  console.warn(
    `[backpressure] rescheduled job ${jobId} oldNextRunAt=${oldNextRunAt?.toISOString() ?? "null"} newNextRunAt=${newNextRunAt.toISOString()}`,
  );
  return newNextRunAt;
}

/**
 * Find the next available YouTube upload slot within [windowStart, windowEnd]
 * spaced intervalMin apart. Tries up to 7 days ahead.
 */
export async function createSchedulerJobAction(input: {
  nicheId: number;
  jobType?: "content_gen" | "short_pipeline" | "long_pipeline" | "quote_pipeline";
  contentMode?: "short" | "long" | "both";
  batchSize?: number;
  topic: string;
  frequency: string;
  cronExpression?: string;
  topicModel?: string;
  scriptModel?: string;
  ttsVoice?: string;
  imageCount?: number;
  imageStyle?: string;
  longImageCount?:        number;
  longImageStyle?:        string;
  longFalModel?:          string;
  longThumbnailFalModel?:      string;
  longThumbnailLlmModel?:      string;
  longThumbnailImageStyle?:    string;
  bgMusic?:                    boolean;
}): Promise<{ jobId: string; nextRunAt: Date } | { error: string }> {
  const parsed = schedulerJobSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input không hợp lệ" };
  }

  const niche = await db.query.niches.findFirst({
    where: (n, { eq: eqFn }) => eqFn(n.id, parsed.data.nicheId),
  });
  if (!niche) return { error: "Không tìm thấy ngách" };

  const nextRunAt = calculateNextRunAt(parsed.data.frequency);

  const [row] = await db
    .insert(contentSchedulerJobs)
    .values({
      nicheId: niche.id,
      nicheName: niche.name,
      jobType: parsed.data.jobType,
      contentMode: parsed.data.contentMode,
      batchSize: parsed.data.batchSize,
      topic: parsed.data.topic,
      frequency: parsed.data.frequency,
      cronExpression: parsed.data.cronExpression ?? null,
      isEnabled: true,
      nextRunAt,
      topicModel: parsed.data.topicModel,
      scriptModel: parsed.data.scriptModel,
      ttsVoice:       parsed.data.ttsVoice       ?? null,
      imageCount:     parsed.data.imageCount     ?? null,
      imageStyle:     parsed.data.imageStyle     ?? null,
      longImageCount:        parsed.data.longImageCount        ?? null,
      longImageStyle:        parsed.data.longImageStyle        ?? null,
      longFalModel:          parsed.data.longFalModel          ?? null,
      longThumbnailFalModel:      parsed.data.longThumbnailFalModel      ?? null,
      longThumbnailLlmModel:      parsed.data.longThumbnailLlmModel      ?? null,
      longThumbnailImageStyle:    parsed.data.longThumbnailImageStyle    ?? null,
      bgMusic:                    parsed.data.bgMusic                    ?? null,
    })
    .returning({ id: contentSchedulerJobs.id });

  return { jobId: row.id, nextRunAt };
}

export async function updateSchedulerJobAction(
  jobId: string,
  updates: {
    isEnabled?: boolean;
    nicheId?: number;
    jobType?: "content_gen" | "short_pipeline" | "long_pipeline" | "quote_pipeline";
    contentMode?: "short" | "long" | "both";
    batchSize?: number;
    topic?: string;
    frequency?: string;
    cronExpression?: string | null;
    topicModel?: string | null;
    scriptModel?: string | null;
    ttsVoice?: string | null;
    imageCount?: number | null;
    imageStyle?: string | null;
    longImageCount?: number | null;
    longImageStyle?: string | null;
    longFalModel?: string | null;
    longThumbnailFalModel?: string | null;
    longThumbnailLlmModel?: string | null;
    longThumbnailImageStyle?: string | null;
    bgMusic?: boolean | null;
  }
): Promise<{ success: boolean; nextRunAt?: Date }> {
  if (updates.frequency === "custom" && !updates.cronExpression?.trim()) {
    return { success: false };
  }

  const nextRunAt =
    updates.frequency ? calculateNextRunAt(updates.frequency) : undefined;

  let nicheUpdate: { nicheId: number; nicheName: string } | undefined;
  if (updates.nicheId !== undefined) {
    const niche = await db.query.niches.findFirst({
      where: (n, { eq: eqFn }) => eqFn(n.id, updates.nicheId!),
    });
    if (!niche) return { success: false };
    nicheUpdate = { nicheId: niche.id, nicheName: niche.name };
  }

  await db
    .update(contentSchedulerJobs)
    .set({
      ...(updates.isEnabled !== undefined ? { isEnabled: updates.isEnabled } : {}),
      ...(nicheUpdate ? { nicheId: nicheUpdate.nicheId, nicheName: nicheUpdate.nicheName } : {}),
      ...(updates.jobType !== undefined ? { jobType: updates.jobType } : {}),
      ...(updates.contentMode !== undefined ? { contentMode: updates.contentMode } : {}),
      ...(updates.batchSize !== undefined ? { batchSize: updates.batchSize } : {}),
      ...(updates.topic !== undefined ? { topic: updates.topic } : {}),
      ...(updates.frequency ? { frequency: updates.frequency } : {}),
      ...(updates.cronExpression !== undefined ? { cronExpression: updates.cronExpression } : {}),
      ...(updates.topicModel !== undefined ? { topicModel: updates.topicModel } : {}),
      ...(updates.scriptModel !== undefined ? { scriptModel: updates.scriptModel } : {}),
      ...(updates.ttsVoice !== undefined ? { ttsVoice: updates.ttsVoice } : {}),
      ...(updates.imageCount !== undefined ? { imageCount: updates.imageCount } : {}),
      ...(updates.imageStyle !== undefined ? { imageStyle: updates.imageStyle } : {}),
      ...(updates.longImageCount !== undefined ? { longImageCount: updates.longImageCount } : {}),
      ...(updates.longImageStyle !== undefined ? { longImageStyle: updates.longImageStyle } : {}),
      ...(updates.longFalModel !== undefined ? { longFalModel: updates.longFalModel } : {}),
      ...(updates.longThumbnailFalModel !== undefined ? { longThumbnailFalModel: updates.longThumbnailFalModel } : {}),
      ...(updates.longThumbnailLlmModel !== undefined ? { longThumbnailLlmModel: updates.longThumbnailLlmModel } : {}),
      ...(updates.longThumbnailImageStyle !== undefined ? { longThumbnailImageStyle: updates.longThumbnailImageStyle } : {}),
      ...(updates.bgMusic !== undefined ? { bgMusic: updates.bgMusic } : {}),
      ...(nextRunAt ? { nextRunAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(contentSchedulerJobs.id, jobId));

  return { success: true, ...(nextRunAt ? { nextRunAt } : {}) };
}

export async function getSchedulerJobsAction(): Promise<SchedulerJobRecord[]> {
  const rows = await db.query.contentSchedulerJobs.findMany({
    orderBy: (t, { desc: d }) => d(t.createdAt),
  });

  return rows.map(r => ({
    id: r.id,
    jobType: (r.jobType ?? "content_gen") as "content_gen" | "short_pipeline" | "long_pipeline" | "quote_pipeline",
    contentMode: (r.contentMode ?? "both") as "short" | "long" | "both",
    batchSize: r.batchSize ?? 3,
    topic: r.topic,
    nicheName: r.nicheName,
    nicheId: r.nicheId,
    frequency: r.frequency,
    cronExpression: r.cronExpression,
    isEnabled: r.isEnabled,
    lastRunAt: r.lastRunAt,
    nextRunAt: r.nextRunAt,
    createdAt: r.createdAt,
    topicModel: r.topicModel ?? null,
    scriptModel: r.scriptModel ?? null,
    ttsVoice:       r.ttsVoice       ?? null,
    imageCount:     r.imageCount     ?? null,
    imageStyle:     r.imageStyle     ?? null,
    longImageCount:        r.longImageCount        ?? null,
    longImageStyle:        r.longImageStyle        ?? null,
    longFalModel:          r.longFalModel          ?? null,
    longThumbnailFalModel:      r.longThumbnailFalModel      ?? null,
    longThumbnailLlmModel:      r.longThumbnailLlmModel      ?? null,
    longThumbnailImageStyle:    r.longThumbnailImageStyle    ?? null,
    bgMusic:                    r.bgMusic                    ?? null,
  }));
}

export async function deleteSchedulerJobAction(
  jobId: string
): Promise<{ success: boolean }> {
  await db
    .delete(contentSchedulerJobs)
    .where(eq(contentSchedulerJobs.id, jobId));
  return { success: true };
}

/**
 * Thực thi 1 scheduler job theo jobType:
 * - content_gen: AI tạo content (script + short/long tùy contentMode)
 * - short_pipeline: tự động chạy TTS → Ảnh → Video cho N item pending
 * - long_pipeline: tự động chạy TTS → Video cho N item pending
 */
export async function runSchedulerJobAction(
  jobId: string
): Promise<
  | { generationId?: string; topic?: string; processed?: number; results?: object[] }
  | { error: string }
  | { skipped: true; reason: "backpressure"; violations: string[] }
> {
  const job = await db.query.contentSchedulerJobs.findFirst({
    where: (j, { eq: e }) => e(j.id, jobId),
  });
  if (!job) return { error: "Không tìm thấy job" };
  if (!job.isEnabled) return { error: "Job đã bị tắt" };

  const jobType = (job.jobType ?? "content_gen") as "content_gen" | "short_pipeline" | "long_pipeline" | "quote_pipeline";

  // ── Content generation job ──────────────────────────────────
  if (jobType === "content_gen") {
    const gate = await checkCapacityGate("content_gen");
    if (!gate.allowed) {
      await deferSchedulerJobForBackpressure(jobId, job.nextRunAt ?? null);
      await notifyBackpressureIfNeeded("content_gen", gate.violations).catch(() => {});
      console.warn(
        `[backpressure] content_gen blocked for job ${jobId}:`,
        gate.violations.map((v) => v.message).join("; "),
      );
      return { skipped: true, reason: "backpressure", violations: gate.violations.map((v) => v.message) };
    }

    const topicModel  = job.topicModel  ?? "openai/gpt-4o-mini";
    const scriptModel = job.scriptModel ?? undefined;
    const contentMode = (job.contentMode ?? "both") as "short" | "long" | "both";

    // Sprint family selection: pick family first for phat_phap, then suggest a topic within that family.
    const jobNiche = await db.query.niches.findFirst({
      where: (n, { eq: e }) => e(n.id, job.nicheId),
      columns: { channelKey: true },
    });
    const sprintFamily = pickBuddhistSprintTopicFamily(jobNiche?.channelKey ?? "");
    if (sprintFamily) {
      console.log(
        `[scheduler:${jobId}] ${sprintAllocationSummary(PHAT_PHAP_SPRINT)} → selected="${sprintFamily}"`,
      );
    }

    let topic = job.topic.trim();
    if (!topic) {
      let lastError = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const suggested = await suggestTopicsAction(job.nicheId, topicModel, 1, sprintFamily ?? undefined);
        if ("error" in suggested) { lastError = suggested.error; continue; }
        topic = suggested.topics[0] ?? "";
        if (topic) break;
      }
      if (!topic) return { error: `AI không gợi ý được chủ đề sau 3 lần thử${lastError ? `: ${lastError}` : ""}` };
    }

    const result = await generateContentAction(job.nicheId, topic, scriptModel, contentMode, sprintFamily ?? undefined);
    if ("error" in result) return { error: result.error };

    const nextRunAt = calculateNextRunAt(job.frequency);
    await db.update(contentSchedulerJobs)
      .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
      .where(eq(contentSchedulerJobs.id, jobId));

    return { generationId: result.generationId, topic };
  }

  // ── Short pipeline job ──────────────────────────────────────
  if (jobType === "short_pipeline") {
    const gate = await checkCapacityGate("short_pipeline");
    if (!gate.allowed) {
      await deferSchedulerJobForBackpressure(jobId, job.nextRunAt ?? null);
      await notifyBackpressureIfNeeded("short_pipeline", gate.violations).catch(() => {});
      console.warn(
        `[backpressure] short_pipeline blocked for job ${jobId}:`,
        gate.violations.map((v) => v.message).join("; "),
      );
      return { skipped: true, reason: "backpressure", violations: gate.violations.map((v) => v.message) };
    }

    const batchSize   = Math.max(job.batchSize ?? 3, getRecommendedShortBatchSize());
    const contentMode = job.contentMode ?? "both";
    const modeFilter  = contentMode === "short" ? ["short"] : contentMode === "long" ? [] : ["short", "both"];
    if (modeFilter.length === 0) return { error: "Short pipeline không xử lý content_mode=long" };

    // Pick items where video is not done — including items stuck at error in any step
    const pending = await db.select({
      id: contentGenerations.id,
      ttsStatus: contentGenerations.ttsStatus,
      imagesStatus: contentGenerations.imagesStatus,
    })
      .from(contentGenerations)
      .where(and(
        eq(contentGenerations.nicheId, job.nicheId),
        inArray(contentGenerations.videoStatus, ["pending", "error"]),
        inArray(contentGenerations.contentMode, modeFilter),
      ))
      .orderBy(asc(contentGenerations.createdAt))
      .limit(batchSize);

    const ttsVoice   = job.ttsVoice   ?? null;
    const imageCount = job.imageCount ?? null;
    const imageStyle = job.imageStyle ?? null;
    const bgMusic    = job.bgMusic ?? null;
    const shortConcurrency = Math.min(batchSize, getRecommendedShortConcurrency());

    const results = await mapWithConcurrency(pending, shortConcurrency, async (item) => {
      const { id, ttsStatus, imagesStatus } = item;
      const [tts, imgs] = await Promise.all([
        ttsStatus !== "done"
          ? runTTS(id, "short", ttsVoice)
          : Promise.resolve({ success: true as const, audioPath: "", ttsDurationMs: 0 }),
        imagesStatus !== "done"
          ? runImages(id, imageCount, imageStyle)
          : Promise.resolve({ success: true as const, imagePaths: [] as string[], durationMs: 0, costUsd: 0 }),
      ]);

      if (!tts.success) return { id, step: "tts", ok: false, error: tts.error };
      if (!imgs.success) return { id, step: "images", ok: false, error: imgs.error };

      const vid = await runShortVideo(id, bgMusic ?? undefined);
      if (!vid.success) return { id, step: "video", ok: false, error: vid.error };

      await autoScheduleVideoAction(id, "short").catch(() => {});
      await autoScheduleVideoAction(id, "quote").catch(() => {});
      return { id, step: "video", ok: true as const };
    });

    const nextRunAt = calculateNextRunAt(job.frequency);
    await db.update(contentSchedulerJobs)
      .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
      .where(eq(contentSchedulerJobs.id, jobId));

    // Upload queue is cron-driven on purpose so manual/debug job runs cannot
    // accidentally publish before the scheduled slot.

    return { processed: pending.length, results };
  }

  // ── Quote pipeline job ──────────────────────────────────────
  if (jobType === "quote_pipeline") {
    const gate = await checkCapacityGate("short_pipeline");
    if (!gate.allowed) {
      await deferSchedulerJobForBackpressure(jobId, job.nextRunAt ?? null);
      await notifyBackpressureIfNeeded("short_pipeline", gate.violations).catch(() => {});
      console.warn(
        `[backpressure] quote_pipeline blocked for job ${jobId}:`,
        gate.violations.map((v) => v.message).join("; "),
      );
      return { skipped: true, reason: "backpressure", violations: gate.violations.map((v) => v.message) };
    }

    const jobNiche = await db.query.niches.findFirst({
      where: (n, { eq: e }) => e(n.id, job.nicheId),
      columns: { channelKey: true },
    });
    const policy = getYoutubeQuoteSchedulerPolicy(jobNiche?.channelKey);
    const nextRunAt = calculateNextRunAt(job.frequency);

    if (!policy?.enabled) {
      await db.update(contentSchedulerJobs)
        .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
        .where(eq(contentSchedulerJobs.id, jobId));
      return {
        processed: 0,
        results: [{ ok: true, skipped: "unsupported_channel", channelKey: jobNiche?.channelKey ?? null }],
      };
    }

    const publishConfig = await getChannelPublishConfig(policy.channelKey);
    const shortDestination = publishConfig?.shortDestinations.find(
      (destination) => destination.enabled && destination.channelId > 0,
    );
    if (!publishConfig?.autoScheduleEnabled || !shortDestination) {
      await db.update(contentSchedulerJobs)
        .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
        .where(eq(contentSchedulerJobs.id, jobId));
      return {
        processed: 0,
        results: [{ ok: true, skipped: "missing_publish_config", channelKey: policy.channelKey }],
      };
    }

    const configuredChannel = await db.query.socialChannels.findFirst({
      where: eq(socialChannels.id, shortDestination.channelId),
      columns: {
        id: true,
        platform: true,
        platformChannelId: true,
      },
    });
    if (!configuredChannel || configuredChannel.platform !== "youtube") {
      await db.update(contentSchedulerJobs)
        .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
        .where(eq(contentSchedulerJobs.id, jobId));
      return {
        processed: 0,
        results: [{ ok: true, skipped: "invalid_youtube_destination", channelId: shortDestination.channelId }],
      };
    }

    const siblingChannels = configuredChannel.platformChannelId
      ? await db.query.socialChannels.findMany({
          where: (channel, { and: a, eq: e }) => a(
            e(channel.platform, "youtube"),
            e(channel.platformChannelId, configuredChannel.platformChannelId!),
          ),
          columns: { id: true },
        })
      : [{ id: configuredChannel.id }];
    const siblingChannelIds = siblingChannels.map((channel) => channel.id);
    const now = new Date();
    const upcomingRows = await db.select({ id: uploadQueue.id })
      .from(uploadQueue)
      .innerJoin(contentGenerations, eq(uploadQueue.contentId, contentGenerations.id))
      .where(and(
        inArray(uploadQueue.channelId, siblingChannelIds),
        inArray(uploadQueue.status, ["queued", "uploading"]),
        gte(uploadQueue.scheduledAt, now),
        eq(contentGenerations.formatType, policy.formatType),
      ));
    const needed = Math.max(0, policy.targetUpcomingQueueRows - upcomingRows.length);
    const generateCount = Math.max(
      0,
      Math.min(job.batchSize ?? policy.maxQueueInsertPerRun, policy.maxQueueInsertPerRun, needed),
    );

    if (generateCount === 0) {
      await db.update(contentSchedulerJobs)
        .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
        .where(eq(contentSchedulerJobs.id, jobId));
      return {
        processed: 0,
        results: [{
          ok: true,
          skipped: "upcoming_queue_target_met",
          upcomingQueueCount: upcomingRows.length,
          targetUpcomingQueueRows: policy.targetUpcomingQueueRows,
        }],
      };
    }

    const generated = await generateQuoteShortsAction({
      count: generateCount,
      workspaceId: policy.workspaceId,
      channelProfileId: policy.channelProfileId,
      durationSec: policy.durationSec,
    });
    if (!generated.ok) {
      return { error: generated.error ?? "Không thể tạo YouTube quote short cho lane mới." };
    }

    const successfulIds = generated.results
      .filter((result) => result.ok && result.videoPath)
      .map((result) => result.contentId);
    const generatedRows = successfulIds.length > 0
      ? await db.select({
          id: contentGenerations.id,
          topic: contentGenerations.topic,
          channelKey: contentGenerations.channelKey,
          nicheId: contentGenerations.nicheId,
          nicheName: contentGenerations.nicheName,
          contentProfileKey: contentGenerations.contentProfileKey,
          formatType: contentGenerations.formatType,
          shortContent: contentGenerations.shortContent,
          script: contentGenerations.script,
          topicFamily: contentGenerations.topicFamily,
          promptVersions: contentGenerations.promptVersions,
        })
        .from(contentGenerations)
        .where(inArray(contentGenerations.id, successfulIds))
      : [];
    const mismatchedGeneratedRows = generatedRows
      .map((row) => ({
        row,
        isolationViolation: getTangSauIsolationViolation({
          channelKey: row.channelKey,
          nicheId: row.nicheId,
          contentProfileKey: row.contentProfileKey,
          formatType: row.formatType,
          title: row.topic,
          topic: row.topic,
          shortContent: row.shortContent,
          script: row.script,
          topicFamily: row.topicFamily,
          promptVersions: row.promptVersions,
        }),
      }))
      .filter(({ row, isolationViolation }) =>
        row.channelKey !== policy.channelKey ||
        row.nicheId !== job.nicheId ||
        row.contentProfileKey !== "philosophy" ||
        row.formatType !== policy.formatType ||
        isolationViolation !== null,
      );
    const schedulableIds = new Set(
      generatedRows
        .filter((row) => !mismatchedGeneratedRows.some((bad) => bad.row.id === row.id))
        .map((row) => row.id),
    );
    const generatedRowById = new Map(generatedRows.map((row) => [row.id, row]));
    for (const { row, isolationViolation } of mismatchedGeneratedRows) {
      console.warn(
        `[quote_pipeline] skip_schedule_mismatch job=${jobId} contentId=${row.id}` +
        ` expectedChannel=${policy.channelKey} actualChannel=${row.channelKey}` +
        ` expectedNicheId=${job.nicheId} actualNicheId=${row.nicheId}` +
        ` expectedProfile=philosophy actualProfile=${row.contentProfileKey ?? "null"}` +
        ` expectedFormat=${policy.formatType} actualFormat=${row.formatType ?? "null"}` +
        (isolationViolation ? ` isolation=${isolationViolation.code}:${isolationViolation.hits.join("|")}` : ""),
      );
    }
    for (const contentId of successfulIds) {
      if (!schedulableIds.has(contentId)) continue;
      const generatedRow = generatedRowById.get(contentId);
      const schedulingTarget = generatedRow
        ? resolveQuoteSchedulingTarget({
            channelKey: generatedRow.channelKey,
            contentProfileKey: generatedRow.contentProfileKey,
            formatType: generatedRow.formatType,
          })
        : null;
      if (!schedulingTarget) {
        console.warn(
          `[quote_pipeline] skip_schedule_target_unresolved job=${jobId} contentId=${contentId}` +
          ` channel=${generatedRow?.channelKey ?? "null"}` +
          ` profile=${generatedRow?.contentProfileKey ?? "null"}` +
          ` format=${generatedRow?.formatType ?? "null"}`,
        );
        continue;
      }
      await autoScheduleVideoAction(contentId, schedulingTarget).catch(() => {});
    }

    const scheduledRows = schedulableIds.size > 0
      ? await db.select({ contentId: uploadQueue.contentId })
        .from(uploadQueue)
        .where(and(
          inArray(uploadQueue.contentId, [...schedulableIds]),
          inArray(uploadQueue.channelId, siblingChannelIds),
          eq(uploadQueue.platform, "youtube"),
          eq(uploadQueue.videoType, "short"),
          inArray(uploadQueue.status, ["queued", "uploading", "done"]),
        ))
      : [];

    await db.update(contentSchedulerJobs)
      .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
      .where(eq(contentSchedulerJobs.id, jobId));

    return {
      processed: successfulIds.length,
      results: [{
        ok: true,
        generatedCount: generated.generatedCount,
        successCount: generated.successCount,
        mismatchCount: mismatchedGeneratedRows.length,
        scheduledCount: scheduledRows.length,
        skippedCount: schedulableIds.size - scheduledRows.length,
      }],
    };
  }

  // long_pipeline removed — longform pipeline is out of scope (see docs/SCOPE_REDUCTION_AUDIT_2026_06_26.md)
  if (jobType === "long_pipeline") {
    return { error: "long_pipeline đã bị loại bỏ khỏi scope (xem SCOPE_REDUCTION_AUDIT)" };
  }

  return { error: "jobType không hợp lệ" };
}

export type GalleryFiltersInput = {
  topic?: string;
  idSearch?: string;
  nicheId?: number;
  ttsStatus?: string;
  youtubeUploadStatus?: string;
  isLocked?: boolean;
  sortBy?: "newest" | "oldest" | "alphabetical" | "locked";
  page?: number;
  perPage?: number;
  contentType?: "short" | "long";
};

export type PaginatedGenerations = {
  items: ContentGenerationRow[];
  total: number;
  page: number;
  perPage: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

function mapRow(r: typeof contentGenerations.$inferSelect): ContentGenerationRow {
  return {
    id: r.id,
    formatType: inferFormatType({
      formatType: r.formatType,
      experimentId: r.experimentId,
      contentMode: r.contentMode,
    }),
    contentMode: r.contentMode ?? "both",
    topic: r.topic,
    nicheName: r.nicheName,
    nicheId: r.nicheId,
    contentProfileKey: r.contentProfileKey,
    channelKey: r.channelKey,
    script: r.script,
    shortContent: r.shortContent,
    shortHookCandidates: (r.shortHookCandidates as string[]) ?? [],
    shortSelectedHook: r.shortSelectedHook ?? null,
    hookPattern: r.hookPattern ?? null,
    hookType: r.hookType ?? null,
    longContent: r.longContent,
    promptVersions: r.promptVersions ?? null,
    experimentId: r.experimentId ?? null,
    experimentVariant: r.experimentVariant ?? null,
    totalTokens: r.totalTokens ?? 0,
    totalCost: Number(r.totalCost),
    generationTime: r.generationTime ?? 0,
    status: r.status,
    createdAt: r.createdAt,
    // TTS
    ttsStatus: r.ttsStatus ?? "pending",
    ttsErrorMessage: r.ttsErrorMessage,
    ttsOutputUrl: r.ttsOutputUrl,
    audioPath: r.audioPath,
    ttsDurationMs: r.ttsDurationMs ?? null,
    // Images
    imagesStatus: r.imagesStatus ?? "pending",
    imagesErrorMessage: r.imagesErrorMessage,
    imagePaths: (r.imagePaths as string[]) ?? [],
    imagesDurationMs: r.imagesDurationMs ?? null,
    imagesCostUsd: r.imagesCostUsd ?? null,
    // Video
    videoStatus: r.videoStatus ?? "pending",
    videoErrorMessage: r.videoErrorMessage,
    videoPath: r.videoPath,
    shortCoverText: r.shortCoverText ?? null,
    shortCoverAssetPath: r.shortCoverAssetPath ?? null,
    shortCoverGeneratedAt: r.shortCoverGeneratedAt ?? null,
    // YouTube (short)
    youtubeUploadStatus: r.youtubeUploadStatus ?? "pending",
    youtubeUploadError: r.youtubeUploadError,
    youtubeVideoUrl: r.youtubeVideoUrl,
    youtubeScheduledAt: r.youtubeScheduledAt,
    // YouTube (long)
    longYoutubeUploadStatus: r.longYoutubeUploadStatus ?? "pending",
    longYoutubeUploadError: r.longYoutubeUploadError,
    longYoutubeVideoUrl: r.longYoutubeVideoUrl,
    longYoutubeScheduledAt: r.longYoutubeScheduledAt,
    // Facebook
    facebookUploadStatus: r.facebookUploadStatus ?? "pending",
    facebookUploadError: r.facebookUploadError,
    facebookVideoUrl: r.facebookVideoUrl,
    // Long pipeline
    longTtsStatus: r.longTtsStatus ?? "pending",
    longTtsErrorMessage: r.longTtsErrorMessage,
    longAudioPath: r.longAudioPath,
    longTtsDurationMs: r.longTtsDurationMs ?? null,
    longImagesStatus: r.longImagesStatus ?? "pending",
    longImagesErrorMessage: r.longImagesErrorMessage,
    longImagePaths: (r.longImagePaths as string[]) ?? [],
    longImagesDurationMs: r.longImagesDurationMs ?? null,
    longImagesCostUsd: r.longImagesCostUsd ?? null,
    longThumbnailPath: r.longThumbnailPath ?? null,
    longYoutubeDescription: r.longYoutubeDescription ?? null,
    longVideoStatus: r.longVideoStatus ?? "pending",
    longVideoErrorMessage: r.longVideoErrorMessage,
    longVideoPath: r.longVideoPath,
    // Cleanup
    completedAt: r.completedAt,
    mediaCleanedAt: r.mediaCleanedAt,
    // Lock
    isLocked: r.isLocked,
    lockedAt: r.lockedAt,
    lockedBy: r.lockedBy,
  };
}

export async function getContentGenerationsAction(
  filters?: GalleryFiltersInput
): Promise<PaginatedGenerations> {
  const page = Math.max(1, filters?.page ?? 1);
  const perPage = Math.min(100, Math.max(1, filters?.perPage ?? 20));

  const conditions = [];
  const isIdSearch = !!filters?.idSearch;
  if (filters?.topic) conditions.push(ilike(contentGenerations.topic, `%${filters.topic}%`));
  if (isIdSearch) {
    // ID prefix search — matches UUIDs that start with the given prefix (case-insensitive).
    // Status filters are intentionally skipped so published/error/old items are found.
    const prefix = filters.idSearch!.toLowerCase().replace(/\s/g, "");
    conditions.push(ilike(contentGenerations.id, `${prefix}%`));
  } else {
    if (filters?.ttsStatus) conditions.push(
      filters?.contentType === "long"
        ? eq(contentGenerations.longTtsStatus, filters.ttsStatus)
        : eq(contentGenerations.ttsStatus, filters.ttsStatus)
    );
    if (filters?.youtubeUploadStatus) conditions.push(
      filters?.contentType === "long"
        ? eq(contentGenerations.longYoutubeUploadStatus, filters.youtubeUploadStatus)
        : eq(contentGenerations.youtubeUploadStatus, filters.youtubeUploadStatus)
    );
  }
  if (filters?.nicheId) conditions.push(eq(contentGenerations.nicheId, filters.nicheId));
  if (filters?.isLocked !== undefined) conditions.push(eq(contentGenerations.isLocked, filters.isLocked));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderCol = {
    oldest: asc(contentGenerations.createdAt),
    alphabetical: asc(contentGenerations.topic),
    locked: desc(contentGenerations.isLocked),
    newest: desc(contentGenerations.createdAt),
  }[filters?.sortBy ?? "newest"] ?? desc(contentGenerations.createdAt);

  const rows = await db
    .select()
    .from(contentGenerations)
    .where(where)
    .orderBy(orderCol)
  ;

  const mappedRows = rows.map(mapRow);
  const filteredRows = mappedRows.filter((row) => {
    if (filters?.contentType === "long") {
      return isLongVideoContent(row);
    }
    if (filters?.contentType === "short") {
      return isTtsShortContent(row);
    }
    return true;
  });

  const total = filteredRows.length;
  const items = filteredRows.slice((page - 1) * perPage, page * perPage);

  return {
    items,
    total,
    page,
    perPage,
    hasNextPage: page * perPage < total,
    hasPrevPage: page > 1,
  };
}

/** Xóa 1 file, im lặng nếu không tồn tại */
function removeFile(relPath: string | null | undefined) {
  if (!relPath) return;
  try {
    const abs = path.join(process.cwd(), relPath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* không làm gián đoạn luồng chính */ }
}

/** Xóa cả thư mục (đệ quy), im lặng nếu không tồn tại */
function removeDir(relDir: string) {
  try {
    const abs = path.join(process.cwd(), relDir);
    if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
  } catch { /* ignore */ }
}

export async function deleteContentGenerationAction(
  id: string
): Promise<{ success: boolean; deletedFiles: string[] }> {
  // 1. Đọc record trước để lấy đường dẫn file
  const row = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, id),
  });

  const deleted: string[] = [];

  if (row) {
    // Short TTS audio
    if (row.audioPath) { removeFile(row.audioPath); deleted.push(row.audioPath); }

    // Short images — xóa cả thư mục media/images/{id}/
    const imgDir = `media/images/${id}`;
    removeDir(imgDir);
    if ((row.imagePaths as string[] | null)?.length) deleted.push(imgDir + "/");

    // Short video
    if (row.videoPath) { removeFile(row.videoPath); deleted.push(row.videoPath); }

    // Long TTS audio
    if (row.longAudioPath) { removeFile(row.longAudioPath); deleted.push(row.longAudioPath); }

    // Long images — xóa cả thư mục media/images/{id}-long/
    const longImgDir = `media/images/${id}-long`;
    removeDir(longImgDir);
    if ((row.longImagePaths as string[] | null)?.length || row.longThumbnailPath) deleted.push(longImgDir + "/");

    // Long video
    if (row.longVideoPath) { removeFile(row.longVideoPath); deleted.push(row.longVideoPath); }
  }

  // 2. Xóa DB row
  await db.delete(contentGenerations).where(eq(contentGenerations.id, id));

  return { success: true, deletedFiles: deleted };
}

export async function lockContentGenerationAction(
  id: string
): Promise<{ success: boolean }> {
  await db
    .update(contentGenerations)
    .set({ isLocked: true, lockedAt: new Date(), lockedBy: "user" })
    .where(eq(contentGenerations.id, id));
  return { success: true };
}

export async function unlockContentGenerationAction(
  id: string
): Promise<{ success: boolean }> {
  await db
    .update(contentGenerations)
    .set({ isLocked: false, lockedAt: null, lockedBy: null })
    .where(eq(contentGenerations.id, id));
  return { success: true };
}

export async function getCronLogsAction(limit = 50): Promise<CronRunLog[]> {
  const rows = await db
    .select()
    .from(cronRunLogs)
    .orderBy(desc(cronRunLogs.ranAt))
    .limit(limit);
  return rows;
}

export async function updateContentStatusAction(
  id: string,
  updates: UpdateContentStatusInput
): Promise<{ success: boolean }> {
  const parsed = updateContentStatusSchema.safeParse(updates);
  if (!parsed.success) return { success: false };

  await db
    .update(contentGenerations)
    .set({
      ...(parsed.data.ttsStatus !== undefined ? { ttsStatus: parsed.data.ttsStatus } : {}),
      ...(parsed.data.ttsOutputUrl !== undefined ? { ttsOutputUrl: parsed.data.ttsOutputUrl } : {}),
      ...(parsed.data.ttsErrorMessage !== undefined ? { ttsErrorMessage: parsed.data.ttsErrorMessage } : {}),
      ...(parsed.data.youtubeUploadStatus !== undefined ? { youtubeUploadStatus: parsed.data.youtubeUploadStatus } : {}),
      ...(parsed.data.youtubeScheduledAt !== undefined ? { youtubeScheduledAt: parsed.data.youtubeScheduledAt } : {}),
      ...(parsed.data.youtubeVideoUrl !== undefined ? { youtubeVideoUrl: parsed.data.youtubeVideoUrl } : {}),
      ...(parsed.data.youtubeUploadError !== undefined ? { youtubeUploadError: parsed.data.youtubeUploadError } : {}),
    })
    .where(eq(contentGenerations.id, id));

  return { success: true };
}
