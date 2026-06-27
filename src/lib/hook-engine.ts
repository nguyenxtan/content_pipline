import type OpenAI from "openai";
import { callWithRetry } from "@/lib/llm/retry";
import { getContentProfile } from "@/lib/config/content-profiles";

export type HookScoreBreakdown = {
  curiosity: number;
  emotion: number;
  relatability: number;
  retention: number;
  total: number;
};

export type ScoredHook = {
  index: number;
  hook: string;
  scores: HookScoreBreakdown;
};

export type HookEngineResult = {
  hooks: string[];
  scoredHooks: ScoredHook[];
  top3: ScoredHook[];
  selectedHook: string;
  usage: {
    generateIn: number;
    generateOut: number;
    scoreIn: number;
    scoreOut: number;
  };
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value)));
}

function cleanGeneratedContent(text: string): string {
  return text
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^\[.{1,40}\]$/.test(t)) return false;
      if (/^\(.*\)$/.test(t) && t.length < 120) return false;
      if (/^[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐƠƯA-Z\s]{2,30}:$/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHookCandidates(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.replace(/^\d+[\).\-\s]+/, ""))
    .map((line) => line.replace(/^["'“”]+|["'“”]+$/g, ""))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 12 && line.length <= 180)
    .filter((line) => !/^(hook|mở đầu|câu \d+)/i.test(line))
    .filter((line, index, arr) => arr.findIndex((x) => x.toLowerCase() === line.toLowerCase()) === index);
}

function extractJsonObject(raw: string): string | null {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

function buildHookGenerationPrompt(input: {
  topic: string;
  nicheName: string;
  nicheDescription?: string | null;
  tone?: string | null;
  contentProfileKey?: string | null;
  dedupBlock?: string;
  count?: number;
}): string {
  const profile = getContentProfile(input.contentProfileKey);
  const nicheMeta = [
    `Lĩnh vực: ${input.nicheName}`,
    input.nicheDescription ? `Mô tả ngách: ${input.nicheDescription}` : null,
    input.tone ? `Giọng điệu: ${input.tone}` : null,
    `Chủ đề: ${input.topic}`,
  ].filter(Boolean).join("\n");

  const count = input.count ?? 20;

  if (profile.key === "psychology") {
    return `Bạn là biên tập viên nội dung cho kênh Tầng Sâu. Bạn viết hook tiếng Việt hiện đại cho video short về tâm lý, quan hệ, trưởng thành và hành vi con người.

${nicheMeta}${input.dedupBlock ?? ""}

Hãy tạo đúng ${count} câu mở đầu bằng tiếng Việt cho video short về chủ đề trên.

KHÔNG ĐƯỢC mở đầu bằng:
- Khái niệm trừu tượng hoặc định nghĩa ("Tha thứ là...", "Nỗi sợ hãi là...")
- Đạo lý, lời răn dạy, màu self-help guru, hoặc giọng giảng bài
- Khung Phật giáo, tôn giáo, nghiệp, nhân quả, giác ngộ
- "Trong cuộc sống...", "Có những...", "Chúng ta thường...", "Bạn có biết..."
- Từ ngữ marketing: "hook", "viral", "engagement"
- Fake statistics, chẩn đoán bệnh lý, fearbait

BẮT BUỘC mỗi câu phải thuộc một trong các dạng:
- ${profile.hookPatterns.join("\n- ")}

YÊU CẦU THÊM:
- Mỗi câu chỉ 1 câu, không quá 18 từ
- Giọng hiện đại, ngắn, sắc, gần với người 18-35
- Phân bổ đều các dạng, không tập trung vào 1 dạng
- Ưu tiên các kiểu câu như:
  - "${profile.hookExamples.join('"\n  - "')}"

ĐỊNH DẠNG OUTPUT:
- Chỉ xuất đúng ${count} dòng
- Mỗi dòng là một câu mở đầu
- Không thêm giải thích, không tiêu đề, không markdown`;
  }

  return `Bạn là người từng trải, hiểu Phật pháp nhưng không giảng đạo. Bạn nói bằng ngôn ngữ của người đời thường.

${nicheMeta}${input.dedupBlock ?? ""}

Hãy tạo đúng ${count} câu mở đầu bằng tiếng Việt cho video short về chủ đề trên.

KHÔNG ĐƯỢC mở đầu bằng:
- Khái niệm trừu tượng hoặc định nghĩa ("Tha thứ là...", "Nỗi sợ hãi là...")
- Đạo lý hoặc lời Phật dạy
- "Trong cuộc sống...", "Có những...", "Chúng ta thường...", "Bạn có biết..."
- Bất kỳ câu nào nghe như bài giảng hoặc sách self-help
- Từ ngữ marketing: "hook", "viral", "engagement"

BẮT BUỘC mỗi câu phải thuộc một trong các dạng:
- Một sự thật khiến người nghe giật mình
- Một điều tiếc nuối mà nhiều người từng trải qua
- Một tình huống rất đời thường
- Một nghịch lý trong cuộc sống
- Một câu khiến người nghe thấy bản thân trong đó

YÊU CẦU THÊM:
- Mỗi câu chỉ 1 câu, không quá 20 từ
- Giọng trầm tĩnh, chân thật, như người lớn tuổi kể lại điều mình đã nghiệm ra
- Phân bổ đều các dạng, không tập trung vào 1 dạng
- Ưu tiên các kiểu câu như:
  - "Người làm quý vị tổn thương có thể đã quên chuyện đó từ lâu."
  - "Có những thứ người ta mang theo cả đời mà không nhận ra."
  - "Điều khiến nhiều người khổ nhất lại không nằm ở hoàn cảnh."
  - "Càng lớn tuổi, quý vị càng hiểu giá trị của sự im lặng."

ĐỊNH DẠNG OUTPUT:
- Chỉ xuất đúng ${count} dòng
- Mỗi dòng là một câu mở đầu
- Không thêm giải thích, không tiêu đề, không markdown`;
}

function buildHookScoringPrompt(input: {
  topic: string;
  nicheName: string;
  contentProfileKey?: string | null;
  hooks: string[];
}): string {
  const profile = getContentProfile(input.contentProfileKey);
  const hooksBlock = input.hooks.map((hook, index) => `${index + 1}. ${hook}`).join("\n");
  if (profile.key === "psychology") {
    return `Bạn là biên tập viên chuyên tối ưu hook cho video short tiếng Việt về tâm lý, quan hệ và trưởng thành cảm xúc.

Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}

Đây là ${input.hooks.length} hook ứng viên:
${hooksBlock}

Hãy chấm điểm TỪNG hook theo 4 tiêu chí, thang điểm 0-10:
- curiosity: mức độ khiến người xem muốn nghe tiếp ngay
- emotion: mức độ chạm đúng cảm xúc thật, không bi lụy
- relatability: mức độ khiến người xem thấy mình trong đó
- retention: mức độ đủ sắc để giữ người xem ở lại 3-5 giây đầu

YÊU CẦU:
- Điểm phải là số nguyên
- Chấm công bằng, không cho tất cả điểm cao
- Ưu tiên hook ngắn, quan sát sắc, gần đời, không dạy đời
- Trừ điểm nếu hook mang màu self-help giáo điều, tôn giáo, Phật giáo, hoặc drama rẻ tiền
- Trừ điểm nếu hook nghe quá học thuật, quá dài, hoặc giống lời quote chung chung

Trả về JSON đúng format:
{
  "scores": [
    {
      "index": 1,
      "curiosity": 8,
      "emotion": 7,
      "relatability": 9,
      "retention": 8
    }
  ],
  "top3": [1, 4, 2]
}

Chỉ xuất JSON, không giải thích thêm.`;
  }
  return `Bạn là biên tập viên chuyên tối ưu hook cho video short tiếng Việt về Phật pháp và chữa lành.

Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}

Đây là ${input.hooks.length} hook ứng viên:
${hooksBlock}

Hãy chấm điểm TỪNG hook theo 4 tiêu chí, thang điểm 0-10:
- curiosity: mức độ khiến người nghe muốn biết tiếp
- emotion: mức độ chạm cảm xúc thật
- relatability: mức độ khiến người nghe thấy bản thân trong đó
- retention: mức độ đủ mạnh để giữ người xem ở lại

YÊU CẦU:
- Điểm phải là số nguyên
- Chấm công bằng, không cho tất cả điểm cao
- Không chấm theo kiểu giật gân rẻ tiền
- Ưu tiên hook đúng cảm xúc, gần đời, có chiều sâu

Trả về JSON đúng format:
{
  "scores": [
    {
      "index": 1,
      "curiosity": 8,
      "emotion": 7,
      "relatability": 9,
      "retention": 8
    }
  ],
  "top3": [1, 4, 2]
}

Chỉ xuất JSON, không giải thích thêm.`;
}

function fallbackScoreHookForProfile(
  contentProfileKey: string | null | undefined,
  topic: string,
  hook: string,
  index: number,
): ScoredHook {
  const profile = getContentProfile(contentProfileKey);
  const normalizedHook = hook.toLowerCase();
  const normalizedTopic = topic.toLowerCase();
  const curiosityMarkers = profile.hookFallbackMarkers.curiosity;
  const emotionMarkers = profile.hookFallbackMarkers.emotion;
  const relatableMarkers = profile.hookFallbackMarkers.relatability;
  const retentionMarkers = profile.hookFallbackMarkers.retention;

  const countMatches = (markers: string[]) => markers.reduce((sum, marker) => sum + (normalizedHook.includes(marker) ? 1 : 0), 0);
  const wordCount = hook.trim().split(/\s+/).filter(Boolean).length;
  const lengthBonus = wordCount >= 8 && wordCount <= 16 ? 2 : wordCount <= 20 ? 1 : 0;
  const topicBonus = normalizedTopic && normalizedHook.includes(normalizedTopic.split(/\s+/)[0] ?? "") ? 1 : 0;

  const curiosity = clampScore(4 + countMatches(curiosityMarkers) * 2 + lengthBonus);
  const emotion = clampScore(4 + countMatches(emotionMarkers) * 2 + topicBonus);
  const relatability = clampScore(4 + countMatches(relatableMarkers) * 2 + lengthBonus);
  const retention = clampScore(4 + countMatches(retentionMarkers) * 2 + (hook.includes(",") ? 1 : 0) + lengthBonus);
  const total = curiosity + emotion + relatability + retention;

  return {
    index,
    hook,
    scores: { curiosity, emotion, relatability, retention, total },
  };
}

function fallbackScoreHooksForProfile(
  contentProfileKey: string | null | undefined,
  topic: string,
  hooks: string[],
): ScoredHook[] {
  return hooks
    .map((hook, idx) => fallbackScoreHookForProfile(contentProfileKey, topic, hook, idx + 1))
    .sort((a, b) => b.scores.total - a.scores.total || a.index - b.index);
}

function normalizeScoredHooks(hooks: string[], rawScores: unknown): ScoredHook[] {
  if (!Array.isArray(rawScores)) return [];

  const mapped = rawScores
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const value = entry as Record<string, unknown>;
      const index = Number(value.index);
      if (!Number.isInteger(index) || index < 1 || index > hooks.length) return null;
      const hook = hooks[index - 1];
      const curiosity = clampScore(Number(value.curiosity));
      const emotion = clampScore(Number(value.emotion));
      const relatability = clampScore(Number(value.relatability));
      const retention = clampScore(Number(value.retention));
      return {
        index,
        hook,
        scores: {
          curiosity,
          emotion,
          relatability,
          retention,
          total: curiosity + emotion + relatability + retention,
        },
      } satisfies ScoredHook;
    })
    .filter((item): item is ScoredHook => !!item);

  const deduped = mapped.filter((item, idx, arr) => arr.findIndex((x) => x.index === item.index) === idx);
  return deduped.sort((a, b) => b.scores.total - a.scores.total || a.index - b.index);
}

export async function runHookEngine(params: {
  client: OpenAI;
  model: string;
  topic: string;
  nicheName: string;
  nicheDescription?: string | null;
  tone?: string | null;
  contentProfileKey?: string | null;
  dedupBlock?: string;
  count?: number;
}): Promise<HookEngineResult> {
  const hookPrompt = buildHookGenerationPrompt(params);
  const hookRes = await callWithRetry(
    () => params.client.chat.completions.create({
      model: params.model,
      messages: [{ role: "user", content: hookPrompt }],
      temperature: 0.95,
      max_tokens: 420,
    }),
    { label: "hook_generation" },
  );

  const requestedCount = params.count ?? 20;
  const hooks = extractHookCandidates(hookRes.choices[0]?.message?.content ?? "").slice(0, requestedCount);
  const normalizedHooks = hooks.length > 0 ? hooks : [params.topic];

  const scorePrompt = buildHookScoringPrompt({
    topic: params.topic,
    nicheName: params.nicheName,
    contentProfileKey: params.contentProfileKey,
    hooks: normalizedHooks,
  });

  const scoreRes = await callWithRetry(
    () => params.client.chat.completions.create({
      model: params.model,
      messages: [{ role: "user", content: scorePrompt }],
      temperature: 0.2,
      max_tokens: 900,
    }),
    { label: "hook_scoring" },
  );

  const scoreOutput = scoreRes.choices[0]?.message?.content ?? "";
  let scoredHooks: ScoredHook[] = [];
  let top3Indices: number[] = [];

  try {
    const jsonPayload = extractJsonObject(scoreOutput);
    if (!jsonPayload) throw new Error("No JSON payload");
    const parsed = JSON.parse(jsonPayload) as { scores?: unknown; top3?: unknown };
    scoredHooks = normalizeScoredHooks(normalizedHooks, parsed.scores);
    if (Array.isArray(parsed.top3)) {
      top3Indices = parsed.top3
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= normalizedHooks.length);
    }
  } catch {
    scoredHooks = [];
  }

  if (scoredHooks.length === 0) {
    scoredHooks = fallbackScoreHooksForProfile(params.contentProfileKey, params.topic, normalizedHooks);
  }

  const top3 = (top3Indices.length > 0
    ? top3Indices
        .map((index) => scoredHooks.find((hook) => hook.index === index))
        .filter((hook): hook is ScoredHook => !!hook)
    : scoredHooks.slice(0, 3)
  ).slice(0, 3);

  return {
    hooks: normalizedHooks,
    scoredHooks,
    top3,
    selectedHook: top3[0]?.hook ?? normalizedHooks[0],
    usage: {
      generateIn: hookRes.usage?.prompt_tokens ?? 0,
      generateOut: hookRes.usage?.completion_tokens ?? 0,
      scoreIn: scoreRes.usage?.prompt_tokens ?? 0,
      scoreOut: scoreRes.usage?.completion_tokens ?? 0,
    },
  };
}

export function buildShortScriptFromHookPrompt(input: {
  shortBasePrompt: string;
  selectedHook: string;
  topic: string;
  nicheName: string;
}): string {
  return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}

Hook đã được chọn:
${input.selectedHook}

Nhiệm vụ:
1. Dùng đúng hook trên làm câu đầu tiên.
2. Viết toàn bộ short script hoàn chỉnh xoay quanh chính hook đó.
3. Câu đầu tiên của output phải chính là hook đã chọn, giữ nguyên wording.

${input.shortBasePrompt}

YÊU CẦU BỔ SUNG:
- Hook phải xuất hiện nguyên vẹn ở câu đầu tiên
- Các câu sau phải triển khai đúng mạch cảm xúc của hook, không bị rơi xuống giọng an toàn quá sớm
- Nội dung phải cụ thể, không triết lý chung chung
- Nếu chủ đề thiên về chiêm nghiệm, vẫn phải có ít nhất 1 ý khiến người xem thấy mình trong đó`;
}

export function cleanHookScriptOutput(text: string): string {
  return cleanGeneratedContent(text);
}

export type HookType =
  | "question"
  | "shock"
  | "contradiction"
  | "confession"
  | "transformation"
  | "warning"
  | "curiosity_gap"
  | "emotional_pain"
  | "system_activation"
  | "rebirth"
  | "revenge"
  | "wealth_flex"
  | "other";

export const HOOK_TYPE_DISPLAY: Record<HookType, string> = {
  question:          "Câu hỏi",
  shock:             "Sự thật gây sốc",
  contradiction:     "Nghịch lý",
  confession:        "Thú nhận / Tự sự",
  transformation:    "Chuyển hoá",
  warning:           "Cảnh báo",
  curiosity_gap:     "Tò mò / Bí ẩn",
  emotional_pain:    "Cảm xúc đau",
  system_activation: "Kích hoạt hệ thống",
  rebirth:           "Trọng sinh / Đầu thai",
  revenge:           "Báo thù",
  wealth_flex:       "Khoe giàu",
  other:             "Khác",
};

export function inferHookType(hook: string): HookType {
  const t = hook.toLowerCase().trim();

  // Story-genre types first — very specific, minimal false-positive risk
  if (/\b(đầu thai|trọng sinh|kiếp trước|kiếp sau|tái sinh)\b/.test(t)) return "rebirth";
  if (/\b(trả thù|báo oán|hả hê|đòi nợ|rửa hận|báo thù)\b/.test(t)) return "revenge";
  if (/\b(tỷ phú|đại gia|triệu đô|triệu đồng trở lên)\b/.test(t)) return "wealth_flex";
  if (/\b(hệ thống|cấp độ|điểm kinh nghiệm|tu luyện cấp|skill|kỹ năng đặc biệt)\b/.test(t)) return "system_activation";

  // Question
  if (t.endsWith("?") || /\b(tại sao|vì sao|làm sao|thế nào|liệu|có phải|phải không|có bao giờ|bao giờ mới)\b/.test(t)) return "question";

  // Warning
  if (/\b(đừng bao giờ|đừng|cẩn thận với|tránh|hãy tránh|nguy hiểm|đừng để)\b/.test(t)) return "warning";

  // Contradiction / paradox
  if (/\b(lại không|lại chính là|nhưng lại|nghịch lý|ngược lại|trái lại|lại là điều|lại là cách)\b/.test(t)) return "contradiction";

  // Shock / counter-intuitive truth
  if (/\b(sự thật|thực ra|thật ra|ít ai|không phải ai|bạn không biết|hoá ra|thật sự là)\b/.test(t)) return "shock";

  // Confession / first-person admission
  if (/\b(tôi đã|mình đã|tôi từng|mình từng|tôi là người|mình là người|tôi hiểu)\b/.test(t)) return "confession";

  // Transformation
  if (/\b(thay đổi|không còn|trở thành|bước ra|lột xác|vượt qua|thoát khỏi|khác đi)\b/.test(t)) return "transformation";

  // Curiosity gap
  if (/\b(bí mật|ít người biết|ít người nhận ra|giải mã|phía sau|điều ẩn|điều mà|sắp xảy ra|bạn sẽ)\b/.test(t)) return "curiosity_gap";

  // Emotional pain
  if (/\b(đau|tổn thương|buồn|cô đơn|mất đi|khóc|tuyệt vọng|đớn đau|vết thương|bị bỏ|bị phản bội|thiếu thốn|cô độc)\b/.test(t)) return "emotional_pain";

  return "other";
}

export function inferHookPattern(hook: string): string {
  const text = hook.toLowerCase();

  // Paradox: unexpected "lại" contrast structure or explicit paradox language
  if (
    /\blại không\b/.test(text) ||
    /\blại chính là\b/.test(text) ||
    /nhưng.*\blại\b/.test(text) ||
    /\bngược lại\b/.test(text) ||
    /\btrái lại\b/.test(text) ||
    /\bnghịch lý\b/.test(text) ||
    /sợ hãi.*\blại\b/.test(text) ||
    /\blại là\b.*con đường/.test(text)
  ) {
    return "nghịch_lý";
  }

  // Regret / missed experience
  if (
    /\btiếc\b/.test(text) ||
    /\bmuộn\b/.test(text) ||
    /\blỡ\b/.test(text) ||
    /\bbỏ lỡ\b/.test(text) ||
    /\bkhông kịp\b/.test(text) ||
    /\bđã qua\b/.test(text)
  ) {
    return "tiếc_nuối";
  }

  // Shocking / counter-intuitive truth
  if (
    /\bthực ra\b/.test(text) ||
    /\bthật ra\b/.test(text) ||
    /\bsự thật\b/.test(text) ||
    /\bkhông phải\b/.test(text) ||
    /\bít ai\b/.test(text)
  ) {
    return "sự_thật";
  }

  // Self-identification: addresses the viewer or common humanity
  if (
    /\bquý vị\b/.test(text) ||
    /\bbạn\b/.test(text) ||
    /\bnhiều người\b/.test(text) ||
    /\bai cũng\b/.test(text) ||
    /\bngười ta\b/.test(text) ||
    /\bnhững ai\b/.test(text) ||
    /\bmọi người\b/.test(text) ||
    /\bchúng ta\b/.test(text) ||
    /\bcó người\b/.test(text)
  ) {
    return "nhận_diện";
  }

  return "đời_thường";
}
