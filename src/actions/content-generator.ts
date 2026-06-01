"use server";

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { contentGenerations, contentSchedulerJobs, promptTemplates, uploadQueue, publishedVideos } from "@/lib/db/schema";
import { eq, desc, asc, ilike, and, count, inArray, gte } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { calcCost } from "@/lib/ai-models";
import { logApiUsage } from "@/actions/ai-usage";
import { DEFAULT_SHORT_PROMPT, DEFAULT_LONG_PROMPT } from "@/lib/content-prompts";
import { runTTS } from "@/lib/pipeline/tts";
import { runImages } from "@/lib/pipeline/images";
import { runLongImages } from "@/lib/pipeline/long-images";
import { runShortVideo } from "@/lib/pipeline/short-video";
import { runLongVideo } from "@/lib/pipeline/long-video";
import { runHookEngine } from "@/lib/hook-engine";
import {
  runScriptEngine,
} from "@/lib/script-engine";
import {
  getRecommendedLongBatchSize,
  getRecommendedLongConcurrency,
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
import { autoScheduleVideoAction, processUploadQueueAction } from "@/actions/social-channels";

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
  shortBasePrompt: string;
  dedupBlock: string;
}): Promise<{
  hookCandidates: string[];
  selectedHook: string;
  shortContent: string;
  usage: { hookIn: number; hookOut: number; pickIn: number; pickOut: number; shortIn: number; shortOut: number };
}> {
  const hookEngine = await runHookEngine({
    client: params.client,
    model: params.model,
    topic: params.topic,
    nicheName: params.nicheName,
    nicheDescription: params.nicheDescription,
    tone: params.tone,
    dedupBlock: params.dedupBlock,
    count: 20,
  });

  const shortScript = await runScriptEngine({
    client: params.client,
    model: params.model,
    topic: params.topic,
    nicheName: params.nicheName,
    selectedHook: hookEngine.selectedHook,
    mode: "short",
    shortBasePrompt: params.shortBasePrompt + params.dedupBlock,
  });
  if (shortScript.mode !== "short") throw new Error("Short script engine returned invalid mode");

  return {
    hookCandidates: hookEngine.hooks,
    selectedHook: hookEngine.selectedHook,
    shortContent: shortScript.result.script,
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
    short: shortTpl?.content ?? DEFAULT_SHORT_PROMPT,
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

  const nicheContext = `Phân mục YouTube: "${niche.name}"${niche.description ? ` — ${niche.description}` : ""}${niche.targetAudience ? `\nĐối tượng: ${niche.targetAudience}` : ""}`;

  const client = getOpenRouterClient();
  const prompt = count === 1
    ? `${nicheContext}${dedupBlock}
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
    : `${nicheContext}${dedupBlock}
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
  contentMode: "short" | "long" | "both" = "both"
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

  const script = "";
  let shortContent = "";
  let shortHookCandidates: string[] = [];
  let shortSelectedHook = "";
  let longContent = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;

  const shortTokens = { in: 0, out: 0 };
  const shortHookTokens = { in: 0, out: 0 };
  const shortPickTokens = { in: 0, out: 0 };
  const longTokens  = { in: 0, out: 0 };
  let shortModel = MODEL;
  let longModel  = MODEL;

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

    const needShort = contentMode === "short" || contentMode === "both";
    const needLong  = contentMode === "long"  || contentMode === "both";

    // Fetch recent topics to inject as dedup context (same as suggestTopicsAction)
    const recentTopics = await getRecentTopicsAction(niche.id, 14);
    const dedupBlock = recentTopics.length > 0
      ? `\n\nCác chủ đề ĐÃ LÀM trong 14 ngày qua — TUYỆT ĐỐI không tạo nội dung trùng lặp hoặc tương tự về góc nhìn:\n${recentTopics.slice(0, 30).map((t, i) => `${i + 1}. ${t}`).join("\n")}\n`
      : "";

    if (needShort) {
      const shortBasePrompt = applyTemplate(shortTpl?.content ?? DEFAULT_SHORT_PROMPT, vars);
      const shortDraft = await generateShortHooksAndScript({
        client,
        model: shortModel,
        topic: parsed.data.topic,
        nicheName: niche.name,
        nicheDescription: niche.description,
        tone: niche.tone,
        shortBasePrompt,
        dedupBlock,
      });
      shortHookCandidates = shortDraft.hookCandidates;
      shortSelectedHook = shortDraft.selectedHook;
      shortContent = shortDraft.shortContent;
      shortHookTokens.in = shortDraft.usage.hookIn;
      shortHookTokens.out = shortDraft.usage.hookOut;
      shortPickTokens.in = shortDraft.usage.pickIn;
      shortPickTokens.out = shortDraft.usage.pickOut;
      shortTokens.in = shortDraft.usage.shortIn;
      shortTokens.out = shortDraft.usage.shortOut;
    }

    if (needLong) {
      if (!shortSelectedHook) {
        const hookEngine = await runHookEngine({
            client,
            model: shortModel,
            topic: parsed.data.topic,
            nicheName: niche.name,
            nicheDescription: niche.description,
            tone: niche.tone,
            dedupBlock,
            count: 20,
        });
        shortHookCandidates = hookEngine.hooks;
        shortSelectedHook = hookEngine.selectedHook;
        shortHookTokens.in += hookEngine.usage.generateIn;
        shortHookTokens.out += hookEngine.usage.generateOut;
        shortPickTokens.in += hookEngine.usage.scoreIn;
        shortPickTokens.out += hookEngine.usage.scoreOut;
      }

      const longBase = applyTemplate(longTpl?.content ?? DEFAULT_LONG_PROMPT, vars) + dedupBlock;
      const longScript = await runScriptEngine({
        client,
        model: longModel,
        topic: parsed.data.topic,
        nicheName: niche.name,
        selectedHook: shortSelectedHook,
        mode: "long",
        longBasePrompt: longBase,
      });
      if (longScript.mode !== "long") throw new Error("Long script engine returned invalid mode");
      longContent = longScript.result.script;
      longTokens.in = longScript.usage.inputTokens;
      longTokens.out = longScript.usage.outputTokens;
    }

    totalInputTokens  += shortHookTokens.in + shortPickTokens.in + shortTokens.in  + longTokens.in;
    totalOutputTokens += shortHookTokens.out + shortPickTokens.out + shortTokens.out + longTokens.out;

    const logJobs: Promise<void>[] = [];
    if (needShort) {
      logJobs.push(logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: shortHookTokens.in, outputTokens: shortHookTokens.out, nicheId: niche.id }));
      logJobs.push(logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: shortPickTokens.in, outputTokens: shortPickTokens.out, nicheId: niche.id }));
      logJobs.push(logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: shortTokens.in, outputTokens: shortTokens.out, nicheId: niche.id }));
    }
    if (needLong)  logJobs.push(logApiUsage({ model: longModel,  purpose: "content_long",  inputTokens: longTokens.in,  outputTokens: longTokens.out,  nicheId: niche.id }));
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

  const [row] = await db
    .insert(contentGenerations)
    .values({
      topic: parsed.data.topic,
      nicheId: niche.id,
      nicheName: niche.name,
      script,
      shortContent,
      shortHookCandidates,
      shortSelectedHook,
      longContent,
      totalTokens,
      totalCost: totalCost.toString(),
      generationTime,
      status: "completed",
      contentMode,
    })
    .returning({ id: contentGenerations.id });

  return {
    generationId: row.id,
    topic: parsed.data.topic,
    nicheName: niche.name,
    script,
    shortContent,
    shortHookCandidates,
    shortSelectedHook: shortSelectedHook || null,
    longContent,
    totalTokens,
    totalCost,
    generationTime,
  };
}

/**
 * Generate long video content from an existing short-only item.
 * Uses the short content as a seed so the long video is a coherent expansion.
 */
export async function expandToLongAction(
  contentId: string
): Promise<{ success: true; longContent: string } | { success: false; error: string }> {
  const item = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
  if (!item) return { success: false, error: "Không tìm thấy content" };
  if (!item.shortContent) return { success: false, error: "Chưa có short content" };

  const longTpl = await db.query.promptTemplates.findFirst({
    where: (t, { and: a, eq: e }) =>
      a(e(t.nicheId, item.nicheId), e(t.stage, "long_gen"), e(t.isActive, true)),
  });

  const longModel = longTpl?.model ?? MODEL;
  const vars = { topic: item.topic, niche: item.nicheName, script: "" };
  const longBase = applyTemplate(longTpl?.content ?? DEFAULT_LONG_PROMPT, vars);

  const client = getOpenRouterClient();
  try {
    const selectedHook = item.shortSelectedHook
      ? item.shortSelectedHook
      : (await runHookEngine({
          client,
          model: longModel,
          topic: item.topic,
          nicheName: item.nicheName,
          dedupBlock: "",
          count: 20,
        })).selectedHook;

    const longScript = await runScriptEngine({
      client,
      model: longModel,
      topic: item.topic,
      nicheName: item.nicheName,
      selectedHook,
      mode: "long",
      longBasePrompt: `${longBase}\n\nShort video teaser đã tạo cho chủ đề này:\n---\n${item.shortContent}\n---`,
    });
    if (longScript.mode !== "long") return { success: false, error: "Long script engine returned invalid mode" };
    const longContent = longScript.result.script;
    if (!longContent) return { success: false, error: "AI không trả về nội dung" };

    await db.update(contentGenerations)
      .set({ longContent, contentMode: "both" })
      .where(eq(contentGenerations.id, contentId));

    await logApiUsage({
      model: longModel,
      purpose: "content_long",
      inputTokens: longScript.usage.inputTokens,
      outputTokens: longScript.usage.outputTokens,
      nicheId: item.nicheId,
    });

    return { success: true, longContent };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "LLM error" };
  }
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
  const shortBasePrompt = applyTemplate(shortTpl?.content ?? DEFAULT_SHORT_PROMPT, vars);

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
        completedAt: null,
        mediaScheduledCleanAt: null,
        mediaCleanedAt: null,
      })
      .where(eq(contentGenerations.id, contentId));

    await Promise.all([
      logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: draft.usage.hookIn, outputTokens: draft.usage.hookOut, nicheId: item.nicheId }),
      logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: draft.usage.pickIn, outputTokens: draft.usage.pickOut, nicheId: item.nicheId }),
      logApiUsage({ model: shortModel, purpose: "content_short", inputTokens: draft.usage.shortIn, outputTokens: draft.usage.shortOut, nicheId: item.nicheId }),
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
    script: row.script,
    shortContent: row.shortContent,
    shortHookCandidates: (row.shortHookCandidates as string[]) ?? [],
    shortSelectedHook: row.shortSelectedHook ?? null,
    longContent: row.longContent,
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

/**
 * Find the next available YouTube upload slot within [windowStart, windowEnd]
 * spaced intervalMin apart. Tries up to 7 days ahead.
 */
export async function createSchedulerJobAction(input: {
  nicheId: number;
  jobType?: "content_gen" | "short_pipeline" | "long_pipeline";
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
    jobType?: "content_gen" | "short_pipeline" | "long_pipeline";
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
    jobType: (r.jobType ?? "content_gen") as "content_gen" | "short_pipeline" | "long_pipeline",
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
): Promise<{ generationId?: string; topic?: string; processed?: number; results?: object[] } | { error: string }> {
  const job = await db.query.contentSchedulerJobs.findFirst({
    where: (j, { eq: e }) => e(j.id, jobId),
  });
  if (!job) return { error: "Không tìm thấy job" };
  if (!job.isEnabled) return { error: "Job đã bị tắt" };

  const jobType = (job.jobType ?? "content_gen") as "content_gen" | "short_pipeline" | "long_pipeline";

  // ── Content generation job ──────────────────────────────────
  if (jobType === "content_gen") {
    const topicModel  = job.topicModel  ?? "openai/gpt-4o-mini";
    const scriptModel = job.scriptModel ?? undefined;
    const contentMode = (job.contentMode ?? "both") as "short" | "long" | "both";

    let topic = job.topic.trim();
    if (!topic) {
      let lastError = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const suggested = await suggestTopicsAction(job.nicheId, topicModel, 1);
        if ("error" in suggested) { lastError = suggested.error; continue; }
        topic = suggested.topics[0] ?? "";
        if (topic) break;
      }
      if (!topic) return { error: `AI không gợi ý được chủ đề sau 3 lần thử${lastError ? `: ${lastError}` : ""}` };
    }

    const result = await generateContentAction(job.nicheId, topic, scriptModel, contentMode);
    if ("error" in result) return { error: result.error };

    const nextRunAt = calculateNextRunAt(job.frequency);
    await db.update(contentSchedulerJobs)
      .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
      .where(eq(contentSchedulerJobs.id, jobId));

    return { generationId: result.generationId, topic };
  }

  // ── Short pipeline job ──────────────────────────────────────
  if (jobType === "short_pipeline") {
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

    // Immediately upload any items just scheduled
    await processUploadQueueAction().catch(() => {});

    return { processed: pending.length, results };
  }

  // ── Long pipeline job ───────────────────────────────────────
  if (jobType === "long_pipeline") {
    const batchSize   = Math.max(job.batchSize ?? 2, getRecommendedLongBatchSize());
    const contentMode = job.contentMode ?? "both";
    const modeFilter  = contentMode === "long" ? ["long"] : contentMode === "short" ? [] : ["long", "both"];
    if (modeFilter.length === 0) return { error: "Long pipeline không xử lý content_mode=short" };

    // Pick items where long video is not done — including error items for retry
    const pending = await db.select({
      id: contentGenerations.id,
      longTtsStatus: contentGenerations.longTtsStatus,
    })
      .from(contentGenerations)
      .where(and(
        eq(contentGenerations.nicheId, job.nicheId),
        inArray(contentGenerations.longVideoStatus, ["pending", "error"]),
        inArray(contentGenerations.contentMode, modeFilter),
      ))
      .orderBy(asc(contentGenerations.createdAt))
      .limit(batchSize);

    const ttsVoiceLong = job.ttsVoice ?? null;
    const longConcurrency = Math.min(batchSize, getRecommendedLongConcurrency());

    const results = await mapWithConcurrency(pending, longConcurrency, async (item) => {
      const { id, longTtsStatus } = item;
      const freshItem = await db.query.contentGenerations.findFirst({ where: eq(contentGenerations.id, id) });
      const needLongImages = freshItem?.longImagesStatus !== "done";

      const [tts, imgs] = await Promise.all([
        longTtsStatus !== "done"
          ? runTTS(id, "long", ttsVoiceLong)
          : Promise.resolve({ success: true as const, audioPath: "", ttsDurationMs: 0 }),
        needLongImages
          ? runLongImages(id, {
              numImages: job.longImageCount ?? undefined,
              imageStyle: job.longImageStyle ?? undefined,
              falModel: job.longFalModel ?? undefined,
              thumbnailFalModel: job.longThumbnailFalModel ?? undefined,
              thumbnailLlmModel: job.longThumbnailLlmModel ?? undefined,
              thumbnailImageStyle: job.longThumbnailImageStyle ?? undefined,
            })
          : Promise.resolve({
              success: true as const,
              imagePaths: [] as string[],
              thumbnailPath: "",
              seoDescription: "",
              durationMs: 0,
              costUsd: 0,
            }),
      ]);

      if (!tts.success) return { id, step: "tts", ok: false, error: tts.error };
      if (!imgs.success) return { id, step: "images", ok: false, error: imgs.error };

      const vid = await runLongVideo(id);
      if (!vid.success) return { id, step: "video", ok: false, error: vid.error };
      await autoScheduleVideoAction(id, "long").catch(() => {});
      return { id, step: "video", ok: true as const };
    });

    const nextRunAt = calculateNextRunAt(job.frequency);
    await db.update(contentSchedulerJobs)
      .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
      .where(eq(contentSchedulerJobs.id, jobId));

    // Immediately upload any items just scheduled
    await processUploadQueueAction().catch(() => {});

    return { processed: pending.length, results };
  }

  return { error: "jobType không hợp lệ" };
}

export type GalleryFiltersInput = {
  topic?: string;
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
    contentMode: r.contentMode ?? "both",
    topic: r.topic,
    nicheName: r.nicheName,
    nicheId: r.nicheId,
    script: r.script,
    shortContent: r.shortContent,
    shortHookCandidates: (r.shortHookCandidates as string[]) ?? [],
    shortSelectedHook: r.shortSelectedHook ?? null,
    longContent: r.longContent,
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

  const isLong = filters?.contentType === "long";
  const conditions = [];
  // Filter by content_mode so short gallery only shows short/both and long gallery only shows long/both
  if (filters?.contentType) {
    conditions.push(isLong
      ? inArray(contentGenerations.contentMode, ["long", "both"])
      : inArray(contentGenerations.contentMode, ["short", "both"])
    );
  }
  if (filters?.topic) conditions.push(ilike(contentGenerations.topic, `%${filters.topic}%`));
  if (filters?.nicheId) conditions.push(eq(contentGenerations.nicheId, filters.nicheId));
  if (filters?.ttsStatus) conditions.push(
    isLong
      ? eq(contentGenerations.longTtsStatus, filters.ttsStatus)
      : eq(contentGenerations.ttsStatus, filters.ttsStatus)
  );
  if (filters?.youtubeUploadStatus) conditions.push(
    isLong
      ? eq(contentGenerations.longYoutubeUploadStatus, filters.youtubeUploadStatus)
      : eq(contentGenerations.youtubeUploadStatus, filters.youtubeUploadStatus)
  );
  if (filters?.isLocked !== undefined) conditions.push(eq(contentGenerations.isLocked, filters.isLocked));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderCol = {
    oldest: asc(contentGenerations.createdAt),
    alphabetical: asc(contentGenerations.topic),
    locked: desc(contentGenerations.isLocked),
    newest: desc(contentGenerations.createdAt),
  }[filters?.sortBy ?? "newest"] ?? desc(contentGenerations.createdAt);

  const [{ total }] = await db
    .select({ total: count() })
    .from(contentGenerations)
    .where(where);

  const rows = await db
    .select()
    .from(contentGenerations)
    .where(where)
    .orderBy(orderCol)
    .limit(perPage)
    .offset((page - 1) * perPage);

  return {
    items: rows.map(mapRow),
    total: Number(total),
    page,
    perPage,
    hasNextPage: page * perPage < Number(total),
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
