import type OpenAI from "openai";

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
  dedupBlock?: string;
  count?: number;
}): string {
  const nicheMeta = [
    `Lĩnh vực: ${input.nicheName}`,
    input.nicheDescription ? `Mô tả ngách: ${input.nicheDescription}` : null,
    input.tone ? `Giọng điệu: ${input.tone}` : null,
    `Chủ đề: ${input.topic}`,
  ].filter(Boolean).join("\n");

  const count = input.count ?? 20;

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
  hooks: string[];
}): string {
  const hooksBlock = input.hooks.map((hook, index) => `${index + 1}. ${hook}`).join("\n");
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

function fallbackScoreHook(topic: string, hook: string, index: number): ScoredHook {
  const normalizedHook = hook.toLowerCase();
  const normalizedTopic = topic.toLowerCase();

  const curiosityMarkers = ["?", "đừng", "quên", "muộn", "giữ", "vì sao", "điều gì", "càng"];
  const emotionMarkers = ["đau", "khổ", "sợ", "hận", "buồn", "nhẹ", "mất", "cô đơn", "tổn thương", "day dứt"];
  const relatableMarkers = ["người ta", "quý vị", "có những", "càng lớn", "nhiều người", "chúng ta"];
  const retentionMarkers = ["nhưng", "lại", "đôi khi", "có thể", "thường", "chỉ vì", "không phải"];

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

function fallbackScoreHooks(topic: string, hooks: string[]): ScoredHook[] {
  return hooks
    .map((hook, idx) => fallbackScoreHook(topic, hook, idx + 1))
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
  dedupBlock?: string;
  count?: number;
}): Promise<HookEngineResult> {
  const hookPrompt = buildHookGenerationPrompt(params);
  const hookRes = await params.client.chat.completions.create({
    model: params.model,
    messages: [{ role: "user", content: hookPrompt }],
    temperature: 0.95,
    max_tokens: 420,
  });

  const requestedCount = params.count ?? 20;
  const hooks = extractHookCandidates(hookRes.choices[0]?.message?.content ?? "").slice(0, requestedCount);
  const normalizedHooks = hooks.length > 0 ? hooks : [params.topic];

  const scorePrompt = buildHookScoringPrompt({
    topic: params.topic,
    nicheName: params.nicheName,
    hooks: normalizedHooks,
  });

  const scoreRes = await params.client.chat.completions.create({
    model: params.model,
    messages: [{ role: "user", content: scorePrompt }],
    temperature: 0.2,
    max_tokens: 900,
  });

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
    scoredHooks = fallbackScoreHooks(params.topic, normalizedHooks);
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
