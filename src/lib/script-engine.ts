import type OpenAI from "openai";
import { callWithRetry } from "@/lib/llm/retry";
import {
  findForbiddenProfileTerms,
  findPreachyProfilePhrases,
  getContentProfile,
} from "@/lib/config/content-profiles";

export const SHORT_CTA = getContentProfile("buddhism").shortCta ?? "";

const SHORT_WORD_MIN = 120;
const SHORT_WORD_MAX = 170;
const SHORT_DURATION_MIN = 45;
const SHORT_DURATION_MAX = 60;
const WORDS_PER_SECOND = 2.8;

export type ScriptValidationResult = {
  wordCount: number;
  estimatedDurationSec: number;
  bannedOpeningMatched: string | null;
  pronounCheckPassed: boolean;
  genericAiPhrases: string[];
  forbiddenTerms: string[];
  preachyPhrases: string[];
  hasRequiredCta: boolean;
  passesLength: boolean;
  passesDuration: boolean;
  passesOpening: boolean;
  passesGeneric: boolean;
  passes: boolean;
  issues: string[];
};

export type ShortScriptProsodyQA = {
  sentenceCount: number;
  avgWordsPerSentence: number;
  maxSentenceWords: number;
  totalCommas: number;
  longSentenceWarnings: string[];
  multiCommaWarnings: string[];
  prosodyWarnings: string[];
};

export type ShortScriptEngineResult = {
  script: string;
  validation: ScriptValidationResult;
  prosodyQa: ShortScriptProsodyQA;
  rewriteCount: number;
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateDurationSec(text: string): number {
  return wordCount(text) / WORDS_PER_SECOND;
}

function cleanText(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripStructuralNoise(text: string): string {
  return cleanText(text)
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^#+\s/.test(t)) return false;
      if (/^\*+\s*/.test(t)) return false;
      if (/^-{3,}$/.test(t)) return false;
      if (/^(mở đầu|phần|kết|chapter|outline|hook|cta)\s*[:\-]/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

function normalizeGenericPhrases(text: string): string {
  return text
    .replace(/khám phá sâu hơn/gi, "nhìn kỹ hơn")
    .replace(/hành trình khám phá/gi, "chặng đường nhìn lại")
    .replace(/\bbí quyết\b/gi, "điều cốt lõi")
    .replace(/\bnghệ thuật\b/gi, "cách");
}

function firstSentence(text: string): string {
  const sentence = stripStructuralNoise(text).split(/(?<=[.!?…])\s+/)[0] ?? "";
  return sentence.trim().toLowerCase();
}

function findBannedOpening(
  text: string,
  contentProfileKey: string | null | undefined,
): string | null {
  const profile = getContentProfile(contentProfileKey);
  const first = firstSentence(text);
  return profile.bannedOpenings.find((pattern) => first.startsWith(pattern)) ?? null;
}

function findGenericAiPhrases(
  text: string,
  contentProfileKey: string | null | undefined,
): string[] {
  const profile = getContentProfile(contentProfileKey);
  const normalized = text.toLowerCase();
  return profile.genericAiPhrases.filter((phrase) => normalized.includes(phrase));
}

function hasAllowedPronoun(
  text: string,
  contentProfileKey: string | null | undefined,
): boolean {
  const profile = getContentProfile(contentProfileKey);
  const normalized = text.toLowerCase();
  return profile.allowedPronouns.some((pronoun) => normalized.includes(pronoun));
}

function ensureShortCta(
  script: string,
  contentProfileKey: string | null | undefined,
): string {
  const profile = getContentProfile(contentProfileKey);
  const cta = profile.shortCta?.trim();
  const cleaned = stripStructuralNoise(script);
  if (!profile.requireShortCta || !cta) return cleaned;
  if (cleaned.toLowerCase().endsWith(cta.toLowerCase())) return cleaned;

  const sentences = cleaned.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const trimmed = [...sentences];
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1].toLowerCase();
    if (last.startsWith("nếu thấy") || last.includes("theo dõi kênh") || last.includes("nhấn thích")) {
      trimmed.pop();
      continue;
    }
    break;
  }

  const base = trimmed.join(" ").trim();
  return `${base}${base ? " " : ""}${cta}`.trim();
}

export function validateShortScript(
  script: string,
  contentProfileKey: string | null | undefined = "buddhism",
): ScriptValidationResult {
  const profile = getContentProfile(contentProfileKey);
  const cleaned = normalizeGenericPhrases(stripStructuralNoise(script));
  const wc = wordCount(cleaned);
  const duration = estimateDurationSec(cleaned);
  const bannedOpeningMatched = findBannedOpening(cleaned, profile.key);
  const pronounCheckPassed = hasAllowedPronoun(cleaned, profile.key);
  const genericAiPhrases = findGenericAiPhrases(cleaned, profile.key);
  const forbiddenTerms = findForbiddenProfileTerms(profile.key, cleaned, "script");
  const preachyPhrases = findPreachyProfilePhrases(profile.key, cleaned);
  const normalized = cleaned.toLowerCase();
  const hasCta = !profile.requireShortCta || !profile.shortCta
    ? true
    : normalized.endsWith(profile.shortCta.toLowerCase());

  const issues: string[] = [];
  const passesLength = wc >= SHORT_WORD_MIN && wc <= SHORT_WORD_MAX;
  const passesDuration = duration >= SHORT_DURATION_MIN && duration <= SHORT_DURATION_MAX;
  const passesOpening = !bannedOpeningMatched;
  const passesGeneric = genericAiPhrases.length === 0;

  if (!passesLength) issues.push(`Word count ngoài target ${SHORT_WORD_MIN}-${SHORT_WORD_MAX}: ${wc}`);
  if (!passesDuration) issues.push(`Estimated duration ngoài target ${SHORT_DURATION_MIN}-${SHORT_DURATION_MAX}s: ${duration.toFixed(1)}s`);
  if (bannedOpeningMatched) issues.push(`Banned opening: ${bannedOpeningMatched}`);
  if (!pronounCheckPassed) issues.push(`Thiếu xưng hô phù hợp: ${profile.allowedPronouns.join(" / ")}`);
  if (!passesGeneric) issues.push(`Generic AI phrases: ${genericAiPhrases.join(", ")}`);
  if (forbiddenTerms.length > 0) issues.push(`Forbidden profile terms: ${forbiddenTerms.join(", ")}`);
  if (preachyPhrases.length > 0) issues.push(`Script sounds preachy: ${preachyPhrases.join(", ")}`);
  if (!hasCta) issues.push("Thiếu CTA chuẩn ở cuối");

  return {
    wordCount: wc,
    estimatedDurationSec: duration,
    bannedOpeningMatched,
    pronounCheckPassed,
    genericAiPhrases,
    forbiddenTerms,
    preachyPhrases,
    hasRequiredCta: hasCta,
    passesLength,
    passesDuration,
    passesOpening,
    passesGeneric,
    passes: issues.length === 0,
    issues,
  };
}

export function validateShortScriptProsody(script: string): ShortScriptProsodyQA {
  const cleaned = stripStructuralNoise(script);

  // Exclude the hardcoded CTA sentence from per-sentence prosody checks.
  // The CTA ("Nếu thấy hữu ích, quý vị hãy nhấn thích...") is 23+ words and
  // is injected by the DEFAULT_SHORT_PROMPT — the LLM cannot shorten it.
  // Flagging it as a prosody violation would be a permanent false alarm.
  // We still count it in sentenceCount and totalCommas so totals stay accurate.
  // Strip leading punctuation/quotes before CTA match (LLM sometimes wraps in " " or " ")
  const isCta = (s: string) =>
    s.replace(/^[\s""“”'"]+/, "").toLowerCase().startsWith("nếu thấy hữu ích");
  const allSentences = cleaned
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentences = allSentences.filter((s) => !isCta(s));

  // sentenceCount includes CTA (accurate total); avg/max use CTA-excluded sentences
  const sentenceCount = allSentences.length;
  const wordCounts = sentences.map((s) => wordCount(s));
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  const bodyCount = sentences.length;
  const avgWordsPerSentence =
    bodyCount > 0 ? Math.round((totalWords / bodyCount) * 10) / 10 : 0;
  const maxSentenceWords = bodyCount > 0 ? Math.max(...wordCounts) : 0;
  const totalCommas = (cleaned.match(/,/g) ?? []).length;

  const longSentenceWarnings: string[] = [];
  const multiCommaWarnings: string[] = [];

  sentences.forEach((s, i) => {
    const wc = wordCounts[i];
    if (wc !== undefined && wc > 18) {
      const preview = s.length > 60 ? `${s.slice(0, 60)}…` : s;
      longSentenceWarnings.push(`Câu ${i + 1} dài ${wc} từ (>18): "${preview}"`);
    }
    const commasInSentence = (s.match(/,/g) ?? []).length;
    if (commasInSentence > 1) {
      const preview = s.length > 60 ? `${s.slice(0, 60)}…` : s;
      multiCommaWarnings.push(`Câu ${i + 1} có ${commasInSentence} dấu phẩy (>1): "${preview}"`);
    }
  });

  const prosodyWarnings: string[] = [
    ...longSentenceWarnings,
    ...multiCommaWarnings,
  ];
  if (avgWordsPerSentence > 15) {
    prosodyWarnings.push(
      `Avg ${avgWordsPerSentence} từ/câu (>15 — VieNeu ít ngắt tự nhiên hơn)`,
    );
  }
  if (bodyCount < 5) {
    prosodyWarnings.push(
      `Chỉ ${bodyCount} câu body (<5 ranh giới — VieNeu thiếu pause cho 30–45s)`,
    );
  }

  return {
    sentenceCount,
    avgWordsPerSentence,
    maxSentenceWords,
    totalCommas,
    longSentenceWarnings,
    multiCommaWarnings,
    prosodyWarnings,
  };
}

function buildShortDraftPrompt(input: {
  topic: string;
  nicheName: string;
  selectedHook: string;
  basePrompt: string;
  contentProfileKey?: string | null;
}) {
  const profile = getContentProfile(input.contentProfileKey);
  if (profile.key === "psychology") {
    const safeBasePrompt = findForbiddenProfileTerms(profile.key, input.basePrompt, "script").length === 0
      ? `\n\n${input.basePrompt}`
      : "";
    return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}

Hook thắng:
${input.selectedHook}

Viết short script theo đúng flow này:
1. Hook
2. Một tình huống rất đời thường hoặc cảm giác ai cũng từng gặp
3. Giải thích tâm lý thật ngắn, bằng ngôn ngữ dễ hiểu
4. Một insight sắc nhưng không lên lớp
5. Một câu kết ngắn, dễ nhớ

RÀNG BUỘC CỨNG:
- 125-150 từ
- 45-60 giây
- Câu đầu tiên phải chính là hook thắng, giữ nguyên wording
- Xưng hô "bạn", ngôn ngữ nói tự nhiên
- Câu ngắn, rõ, gọn, không học thuật
- Không tôn giáo, không Phật giáo, không tâm linh, không self-help guru
- Không dùng "quý vị", "A Di Đà Phật", "nghiệp", "nhân quả", "giác ngộ"
- Không giảng đạo, không dạy đời, không moral lecture
- Không mở đầu lại bằng "Trong cuộc sống", "Chúng ta thường", "Hôm nay"
- Kết bằng một câu đọng lại, KHÔNG thêm CTA cố định

${safeBasePrompt}

Chỉ xuất script cuối cùng, không giải thích thêm.`;
  }
  return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}

Hook thắng:
${input.selectedHook}

Viết short script theo đúng flow này:
1. Hook
2. Một tình huống đời thường
3. Một đoạn chiêm nghiệm
4. Một ý tinh thần Phật pháp rất nhẹ
5. CTA

RÀNG BUỘC CỨNG:
- 130-150 từ
- 45-60 giây
- Câu đầu tiên phải chính là hook thắng, giữ nguyên wording
- Không giảng đạo
- Không dạy đời
- Không dùng văn AI chung chung
- Không mở đầu lại bằng các câu như "Trong cuộc sống", "Chúng ta thường", "Hôm nay chúng ta"
- CTA cuối phải đúng nguyên văn:
"${SHORT_CTA}"

QUY TẮC ĐỘ DÀI CÂU (tối ưu cho VieNeu TTS):
- Câu lý tưởng: 8–15 từ
- Tối đa 18 từ mỗi câu — không viết câu dài hơn
- Mỗi câu tối đa 1 dấu phẩy
- Không dùng chuỗi liệt kê 3+ mệnh đề nối bằng dấu phẩy
- Ưu tiên dấu chấm để tách ý, không dùng dấu phẩy thay dấu chấm
- Mỗi câu chỉ một ý chính duy nhất
- Xuống dòng mới sau mỗi câu để TTS nhận rõ ranh giới
- Giọng bình tĩnh, nhẹ nhàng, tinh thần Phật pháp không nặng nề
- Tránh câu phức nhiều tầng ý, tránh hoa mỹ rườm rà
- Câu đơn, rõ, như đang nói chuyện bình thường

${input.basePrompt}

Chỉ xuất script cuối cùng, không giải thích thêm.`;
}

function buildShortRepairPrompt(input: {
  topic: string;
  nicheName: string;
  selectedHook: string;
  currentScript: string;
  issues: string[];
  contentProfileKey?: string | null;
}) {
  const profile = getContentProfile(input.contentProfileKey);
  if (profile.key === "psychology") {
    return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}
Hook thắng: ${input.selectedHook}

Script hiện tại:
---
${input.currentScript}
---

Script trên chưa đạt vì:
${input.issues.map((issue) => `- ${issue}`).join("\n")}

Hãy rewrite lại script để:
- giữ nguyên hook ở câu đầu
- giữ cùng cảm xúc và chủ đề
- rút câu gọn hơn, nói như đang trò chuyện với "bạn"
- thêm một tình huống rất cụ thể nếu nội dung còn chung chung
- bỏ toàn bộ wording tôn giáo, Phật giáo, self-help guru, hoặc giọng dạy đời
- nếu quá dài thì bỏ phần giảng giải vòng vo
- nếu quá ngắn thì thêm một quan sát tâm lý đời thường
- giữ script trong khoảng 125-150 từ
- kết lại bằng một câu ngắn, nhớ được, không thêm CTA cố định

Chỉ xuất script mới, không giải thích thêm.`;
  }
  return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}
Hook thắng: ${input.selectedHook}

Script hiện tại:
---
${input.currentScript}
---

Script trên chưa đạt vì:
${input.issues.map((issue) => `- ${issue}`).join("\n")}

Hãy rewrite lại script để:
- giữ nguyên hook ở câu đầu
- giữ cùng cảm xúc và chủ đề
- không cắt cứng giữa câu
- nếu quá dài thì rút gọn bằng cách bỏ phần chung chung
- nếu quá ngắn thì expand bằng một quan sát đời thường cụ thể hơn
- giữ script trong khoảng 130-150 từ để chừa biên an toàn cho thời lượng
- CTA cuối phải đúng nguyên văn:
"${SHORT_CTA}"

QUY TẮC CÂU (giữ nguyên khi rewrite):
- Mỗi câu tối đa 18 từ
- Mỗi câu tối đa 1 dấu phẩy
- Ưu tiên dấu chấm để tách ý
- Câu đơn, rõ, một ý duy nhất

Chỉ xuất script mới, không giải thích thêm.`;
}

async function generateText(
  client: OpenAI,
  model: string,
  prompt: string,
  temperature: number,
  maxTokens: number,
  label = "script_text",
) {
  const res = await callWithRetry(
    () => client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens,
    }),
    { label },
  );
  return {
    text: cleanText(res.choices[0]?.message?.content ?? ""),
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}

async function generateShortScriptInternal(params: {
  client: OpenAI;
  model: string;
  topic: string;
  nicheName: string;
  selectedHook: string;
  shortBasePrompt: string;
  contentProfileKey?: string | null;
}): Promise<{ result: ShortScriptEngineResult; usage: { inputTokens: number; outputTokens: number } }> {
  let usageIn = 0;
  let usageOut = 0;

  const firstDraft = await generateText(
    params.client,
    params.model,
    buildShortDraftPrompt({
      topic: params.topic,
      nicheName: params.nicheName,
      selectedHook: params.selectedHook,
      basePrompt: params.shortBasePrompt,
      contentProfileKey: params.contentProfileKey,
    }),
    0.75,
    500,
    "short_script_draft",
  );
  usageIn += firstDraft.inputTokens;
  usageOut += firstDraft.outputTokens;

  let script = normalizeGenericPhrases(ensureShortCta(firstDraft.text, params.contentProfileKey));
  let validation = validateShortScript(script, params.contentProfileKey);
  let rewriteCount = 0;

  while (!validation.passes && rewriteCount < 3) {
    rewriteCount += 1;
    const repair = await generateText(
      params.client,
      params.model,
      buildShortRepairPrompt({
        topic: params.topic,
        nicheName: params.nicheName,
        selectedHook: params.selectedHook,
        currentScript: script,
        issues: validation.issues,
        contentProfileKey: params.contentProfileKey,
      }),
      0.45,
      500,
      `short_script_repair_${rewriteCount}`,
    );
    usageIn += repair.inputTokens;
    usageOut += repair.outputTokens;
    script = normalizeGenericPhrases(ensureShortCta(repair.text, params.contentProfileKey));
    validation = validateShortScript(script, params.contentProfileKey);
  }

  const prosodyQa = validateShortScriptProsody(script);
  if (prosodyQa.prosodyWarnings.length > 0) {
    console.warn(
      `[PROSODY-WARN] sentences=${prosodyQa.sentenceCount}` +
      ` avg=${prosodyQa.avgWordsPerSentence}w/s` +
      ` max=${prosodyQa.maxSentenceWords}w` +
      ` commas=${prosodyQa.totalCommas}` +
      ` warnings=${prosodyQa.prosodyWarnings.length}`,
    );
    for (const w of prosodyQa.prosodyWarnings) {
      console.warn(`  [PROSODY-WARN] ${w}`);
    }
  }

  return {
    result: { script, validation, prosodyQa, rewriteCount },
    usage: { inputTokens: usageIn, outputTokens: usageOut },
  };
}

export async function runScriptEngine(params: {
  client: OpenAI;
  model: string;
  topic: string;
  nicheName: string;
  selectedHook: string;
  contentProfileKey?: string | null;
  mode: "short";
  shortBasePrompt?: string;
}): Promise<{ mode: "short"; result: ShortScriptEngineResult; usage: { inputTokens: number; outputTokens: number } }> {
  const output = await generateShortScriptInternal({
    client: params.client,
    model: params.model,
    topic: params.topic,
    nicheName: params.nicheName,
    selectedHook: params.selectedHook,
    shortBasePrompt: params.shortBasePrompt ?? "",
    contentProfileKey: params.contentProfileKey,
  });
  return { mode: "short", ...output };
}
