import type OpenAI from "openai";

export const SHORT_CTA = "Nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh để cùng nhau học những điều hay trong cuộc sống.";

const SHORT_WORD_MIN = 120;
const SHORT_WORD_MAX = 170;
const SHORT_DURATION_MIN = 45;
const SHORT_DURATION_MAX = 60;
const LONG_WORD_MIN = 1600;
const LONG_WORD_MAX = 2600;
const WORDS_PER_SECOND = 2.8;

const BANNED_OPENINGS = [
  "trong cuộc sống",
  "chúng ta thường",
  "hôm nay",
  "trong video này",
  "bạn có biết",
  "tha thứ là",
  "nỗi sợ hãi là",
  "đây là",
];

const GENERIC_AI_PHRASES = [
  "trong cuộc sống này",
  "một bài học sâu sắc",
  "chúng ta hãy cùng",
  "ở video này",
  "có lẽ bạn sẽ nhận ra",
  "hành trình khám phá",
  "bí quyết",
  "nghệ thuật",
  "khám phá sâu hơn",
  "quý vị thân mến",
];

const ALLOWED_PRONOUNS = ["quý vị", "chúng ta", "người ta"];

export type ScriptValidationResult = {
  wordCount: number;
  estimatedDurationSec: number;
  bannedOpeningMatched: string | null;
  pronounCheckPassed: boolean;
  genericAiPhrases: string[];
  passesLength: boolean;
  passesDuration: boolean;
  passesOpening: boolean;
  passesGeneric: boolean;
  passes: boolean;
  issues: string[];
};

export type LongChapter = {
  title: string;
  startLabel: string;
};

export type LongOutlineSection = {
  title: string;
  purpose: string;
  emotionalShift: string;
};

export type LongOutline = {
  titleAngle: string;
  openingAngle: string;
  sections: LongOutlineSection[];
  closingAngle: string;
  chapters: string[];
};

export type ShortScriptEngineResult = {
  script: string;
  validation: ScriptValidationResult;
  rewriteCount: number;
};

export type LongScriptEngineResult = {
  script: string;
  outline: LongOutline;
  chapters: LongChapter[];
  validation: ScriptValidationResult;
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

function findBannedOpening(text: string): string | null {
  const first = firstSentence(text);
  return BANNED_OPENINGS.find((pattern) => first.startsWith(pattern)) ?? null;
}

function findGenericAiPhrases(text: string): string[] {
  const normalized = text.toLowerCase();
  return GENERIC_AI_PHRASES.filter((phrase) => normalized.includes(phrase));
}

function hasAllowedPronoun(text: string): boolean {
  const normalized = text.toLowerCase();
  return ALLOWED_PRONOUNS.some((pronoun) => normalized.includes(pronoun));
}

function formatSecondsLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function ensureShortCta(script: string): string {
  const cleaned = stripStructuralNoise(script);
  if (cleaned.toLowerCase().endsWith(SHORT_CTA.toLowerCase())) return cleaned;

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
  return `${base}${base ? " " : ""}${SHORT_CTA}`.trim();
}

export function validateShortScript(script: string): ScriptValidationResult {
  const cleaned = normalizeGenericPhrases(stripStructuralNoise(script));
  const wc = wordCount(cleaned);
  const duration = estimateDurationSec(cleaned);
  const bannedOpeningMatched = findBannedOpening(cleaned);
  const pronounCheckPassed = hasAllowedPronoun(cleaned);
  const genericAiPhrases = findGenericAiPhrases(cleaned);
  const normalized = cleaned.toLowerCase();
  const hasCta = normalized.endsWith(SHORT_CTA.toLowerCase());

  const issues: string[] = [];
  const passesLength = wc >= SHORT_WORD_MIN && wc <= SHORT_WORD_MAX;
  const passesDuration = duration >= SHORT_DURATION_MIN && duration <= SHORT_DURATION_MAX;
  const passesOpening = !bannedOpeningMatched;
  const passesGeneric = genericAiPhrases.length === 0;

  if (!passesLength) issues.push(`Word count ngoài target ${SHORT_WORD_MIN}-${SHORT_WORD_MAX}: ${wc}`);
  if (!passesDuration) issues.push(`Estimated duration ngoài target ${SHORT_DURATION_MIN}-${SHORT_DURATION_MAX}s: ${duration.toFixed(1)}s`);
  if (bannedOpeningMatched) issues.push(`Banned opening: ${bannedOpeningMatched}`);
  if (!pronounCheckPassed) issues.push("Thiếu xưng hô phù hợp: quý vị / chúng ta / người ta");
  if (!passesGeneric) issues.push(`Generic AI phrases: ${genericAiPhrases.join(", ")}`);
  if (!hasCta) issues.push("Thiếu CTA chuẩn ở cuối");

  return {
    wordCount: wc,
    estimatedDurationSec: duration,
    bannedOpeningMatched,
    pronounCheckPassed,
    genericAiPhrases,
    passesLength,
    passesDuration,
    passesOpening,
    passesGeneric,
    passes: issues.length === 0,
    issues,
  };
}

export function validateLongScript(script: string): ScriptValidationResult {
  const cleaned = normalizeGenericPhrases(stripStructuralNoise(script));
  const wc = wordCount(cleaned);
  const duration = estimateDurationSec(cleaned);
  const bannedOpeningMatched = findBannedOpening(cleaned);
  const pronounCheckPassed = hasAllowedPronoun(cleaned);
  const genericAiPhrases = findGenericAiPhrases(cleaned);

  const issues: string[] = [];
  const passesLength = wc >= LONG_WORD_MIN && wc <= LONG_WORD_MAX;
  const passesDuration = duration >= 10 * 60 && duration <= 18 * 60;
  const passesOpening = !bannedOpeningMatched;
  const passesGeneric = genericAiPhrases.length === 0;

  if (!passesLength) issues.push(`Word count ngoài target ${LONG_WORD_MIN}-${LONG_WORD_MAX}: ${wc}`);
  if (!passesDuration) issues.push(`Estimated duration ngoài target 10-18 phút: ${duration.toFixed(1)}s`);
  if (bannedOpeningMatched) issues.push(`Banned opening: ${bannedOpeningMatched}`);
  if (!pronounCheckPassed) issues.push("Thiếu xưng hô phù hợp: quý vị / chúng ta / người ta");
  if (!passesGeneric) issues.push(`Generic AI phrases: ${genericAiPhrases.join(", ")}`);

  return {
    wordCount: wc,
    estimatedDurationSec: duration,
    bannedOpeningMatched,
    pronounCheckPassed,
    genericAiPhrases,
    passesLength,
    passesDuration,
    passesOpening,
    passesGeneric,
    passes: issues.length === 0,
    issues,
  };
}

function extractJsonObject(raw: string): string | null {
  const stripped = cleanText(raw);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

function buildShortDraftPrompt(input: {
  topic: string;
  nicheName: string;
  selectedHook: string;
  basePrompt: string;
}) {
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

${input.basePrompt}

Chỉ xuất script cuối cùng, không giải thích thêm.`;
}

function buildShortRepairPrompt(input: {
  topic: string;
  nicheName: string;
  selectedHook: string;
  currentScript: string;
  issues: string[];
}) {
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

Chỉ xuất script mới, không giải thích thêm.`;
}

function buildLongOutlinePrompt(input: {
  topic: string;
  nicheName: string;
  selectedHook: string;
  basePrompt: string;
}) {
  return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}
Hook thắng: ${input.selectedHook}

Nhiệm vụ:
Tạo outline cho video dài theo phong cách storytelling, đời sống, cảm xúc, có tinh thần Phật pháp nhưng không giảng đạo khô.

YÊU CẦU:
- Có title angle rõ ràng
- Opening 30-60 giây phải mạnh
- 4 section thân bài rõ ràng
- Mỗi section phải có mục đích cảm xúc riêng
- Kết lại bằng một closing nhẹ nhưng đọng
- Chapter title phải ngắn, dễ đọc
- Tránh mọi wording kiểu AI chung chung

${input.basePrompt}

Trả về JSON:
{
  "titleAngle": "...",
  "openingAngle": "...",
  "sections": [
    { "title": "...", "purpose": "...", "emotionalShift": "..." }
  ],
  "closingAngle": "...",
  "chapters": ["...", "...", "...", "...", "...", "..."]
}

Chỉ xuất JSON.`;
}

function buildLongOpeningPrompt(input: {
  topic: string;
  nicheName: string;
  selectedHook: string;
  outline: LongOutline;
}) {
  return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}
Title angle: ${input.outline.titleAngle}
Opening angle: ${input.outline.openingAngle}
Hook thắng: ${input.selectedHook}

Viết phần mở đầu 30-60 giây cho video dài.

YÊU CẦU:
- 90-150 từ
- mở mạnh ngay từ câu đầu
- đưa người nghe vào một cảnh đời hoặc nỗi đau cụ thể
- dùng chính hook thắng làm câu mở đầu hoặc biến thể rất gần
- không giảng đạo
- không dùng ngôn ngữ marketing
- phải khiến người nghe muốn ở lại nghe tiếp

Chỉ xuất phần mở đầu.`;
}

function buildLongSectionPrompt(input: {
  topic: string;
  nicheName: string;
  selectedHook: string;
  outline: LongOutline;
  section: LongOutlineSection;
  sectionIndex: number;
  previousSummary: string;
}) {
  return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}
Title angle: ${input.outline.titleAngle}
Hook thắng: ${input.selectedHook}
Section ${input.sectionIndex + 1}: ${input.section.title}
Purpose: ${input.section.purpose}
Emotional shift: ${input.section.emotionalShift}
Tóm tắt phần trước: ${input.previousSummary || "Chưa có"}

Viết section này theo phong cách:
- storytelling
- đời sống
- có cảm xúc
- có chiêm nghiệm
- có tinh thần Phật pháp nhẹ
- không giảng đạo khô
- không văn AI chung chung

YÊU CẦU:
- 320-520 từ
- phải có ít nhất 1 cảnh đời hoặc quan sát cụ thể
- phải nối mượt từ phần trước
- cuối section phải mở ra nhu cầu nghe tiếp

Chỉ xuất nội dung section, không thêm tiêu đề.`;
}

function buildLongClosingPrompt(input: {
  topic: string;
  nicheName: string;
  outline: LongOutline;
  selectedHook: string;
  fullBodySummary: string;
}) {
  return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}
Title angle: ${input.outline.titleAngle}
Closing angle: ${input.outline.closingAngle}
Hook thắng: ${input.selectedHook}
Tóm tắt phần thân bài: ${input.fullBodySummary}

Viết đoạn kết:
- 120-220 từ
- lắng xuống nhưng không cụt
- chốt lại bằng một hình ảnh hoặc một ý đọng
- có tinh thần Phật pháp nhẹ
- không tổng kết kiểu bài giảng

Chỉ xuất đoạn kết.`;
}

function buildLongRepairPrompt(input: {
  topic: string;
  nicheName: string;
  script: string;
  issues: string[];
}) {
  return `Chủ đề: ${input.topic}
Lĩnh vực: ${input.nicheName}

Long script hiện tại:
---
${input.script}
---

Script này chưa đạt vì:
${input.issues.map((issue) => `- ${issue}`).join("\n")}

Hãy rewrite toàn bộ long script để:
- giữ nguyên tinh thần và flow
- sửa đúng các lỗi trên
- nếu đang có cụm từ chung chung như "hành trình khám phá", "bí quyết", "nghệ thuật", hãy thay bằng cảnh đời hoặc quan sát cụ thể hơn
- không dùng tiêu đề markdown
- không giảng đạo khô
- không dùng văn AI chung chung
- không mở đầu bằng các câu sáo rỗng

Chỉ xuất long script mới.`;
}

async function generateText(
  client: OpenAI,
  model: string,
  prompt: string,
  temperature: number,
  maxTokens: number,
) {
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature,
    max_tokens: maxTokens,
  });
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
    }),
    0.75,
    500,
  );
  usageIn += firstDraft.inputTokens;
  usageOut += firstDraft.outputTokens;

  let script = normalizeGenericPhrases(ensureShortCta(firstDraft.text));
  let validation = validateShortScript(script);
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
      }),
      0.45,
      500,
    );
    usageIn += repair.inputTokens;
    usageOut += repair.outputTokens;
    script = normalizeGenericPhrases(ensureShortCta(repair.text));
    validation = validateShortScript(script);
  }

  return {
    result: { script, validation, rewriteCount },
    usage: { inputTokens: usageIn, outputTokens: usageOut },
  };
}

function parseLongOutline(text: string): LongOutline {
  const jsonPayload = extractJsonObject(text);
  if (!jsonPayload) throw new Error("Long outline không phải JSON hợp lệ");
  const parsed = JSON.parse(jsonPayload) as Partial<LongOutline>;
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections
        .map((section) => {
          if (!section || typeof section !== "object") return null;
          const value = section as Record<string, unknown>;
          const title = String(value.title ?? "").trim();
          const purpose = String(value.purpose ?? "").trim();
          const emotionalShift = String(value.emotionalShift ?? "").trim();
          if (!title || !purpose || !emotionalShift) return null;
          return { title, purpose, emotionalShift };
        })
        .filter((section): section is LongOutlineSection => !!section)
    : [];
  const chapters = Array.isArray(parsed.chapters)
    ? parsed.chapters.map((value) => String(value).trim()).filter(Boolean)
    : [];

  if (!parsed.titleAngle || !parsed.openingAngle || !parsed.closingAngle || sections.length < 3) {
    throw new Error("Long outline thiếu trường bắt buộc");
  }

  return {
    titleAngle: String(parsed.titleAngle).trim(),
    openingAngle: String(parsed.openingAngle).trim(),
    sections: sections.slice(0, 6),
    closingAngle: String(parsed.closingAngle).trim(),
    chapters: chapters.slice(0, sections.length + 2),
  };
}

function buildChapters(outline: LongOutline, fullScript: string): LongChapter[] {
  const duration = estimateDurationSec(fullScript);
  const chapterTitles = outline.chapters.length > 0
    ? outline.chapters
    : ["Mở đầu", ...outline.sections.map((section) => section.title), "Khép lại"];

  const segments = chapterTitles.length;
  return chapterTitles.map((title, index) => {
    const ratio = segments <= 1 ? 0 : index / segments;
    return {
      title,
      startLabel: formatSecondsLabel(duration * ratio),
    };
  });
}

async function generateLongScriptInternal(params: {
  client: OpenAI;
  model: string;
  topic: string;
  nicheName: string;
  selectedHook: string;
  longBasePrompt: string;
}): Promise<{ result: LongScriptEngineResult; usage: { inputTokens: number; outputTokens: number } }> {
  let usageIn = 0;
  let usageOut = 0;

  const outlineRes = await generateText(
    params.client,
    params.model,
    buildLongOutlinePrompt({
      topic: params.topic,
      nicheName: params.nicheName,
      selectedHook: params.selectedHook,
      basePrompt: params.longBasePrompt,
    }),
    0.6,
    900,
  );
  usageIn += outlineRes.inputTokens;
  usageOut += outlineRes.outputTokens;
  const outline = parseLongOutline(outlineRes.text);

  const openingRes = await generateText(
    params.client,
    params.model,
    buildLongOpeningPrompt({
      topic: params.topic,
      nicheName: params.nicheName,
      selectedHook: params.selectedHook,
      outline,
    }),
    0.75,
    500,
  );
  usageIn += openingRes.inputTokens;
  usageOut += openingRes.outputTokens;
  const opening = normalizeGenericPhrases(stripStructuralNoise(openingRes.text));

  const sectionTexts: string[] = [];
  for (const [index, section] of outline.sections.entries()) {
    const previousSummary = sectionTexts.slice(-1)[0]?.split(/\s+/).slice(-35).join(" ") ?? "";
    const sectionRes = await generateText(
      params.client,
      params.model,
      buildLongSectionPrompt({
        topic: params.topic,
        nicheName: params.nicheName,
        selectedHook: params.selectedHook,
        outline,
        section,
        sectionIndex: index,
        previousSummary,
      }),
      0.72,
      950,
    );
    usageIn += sectionRes.inputTokens;
    usageOut += sectionRes.outputTokens;
    sectionTexts.push(normalizeGenericPhrases(stripStructuralNoise(sectionRes.text)));
  }

  const fullBodySummary = sectionTexts.join(" ").split(/\s+/).slice(0, 120).join(" ");
  const closingRes = await generateText(
    params.client,
    params.model,
    buildLongClosingPrompt({
      topic: params.topic,
      nicheName: params.nicheName,
      outline,
      selectedHook: params.selectedHook,
      fullBodySummary,
    }),
    0.65,
    500,
  );
  usageIn += closingRes.inputTokens;
  usageOut += closingRes.outputTokens;
  const closing = normalizeGenericPhrases(stripStructuralNoise(closingRes.text));

  let script = normalizeGenericPhrases([opening, ...sectionTexts, closing].filter(Boolean).join("\n\n").trim());
  let validation = validateLongScript(script);
  let rewriteCount = 0;

  while (!validation.passes && rewriteCount < 2) {
    rewriteCount += 1;
    const repairRes = await generateText(
      params.client,
      params.model,
      buildLongRepairPrompt({
        topic: params.topic,
        nicheName: params.nicheName,
        script,
        issues: validation.issues,
      }),
      0.45,
      2500,
    );
    usageIn += repairRes.inputTokens;
    usageOut += repairRes.outputTokens;
    script = normalizeGenericPhrases(stripStructuralNoise(repairRes.text));
    validation = validateLongScript(script);
  }

  const chapters = buildChapters(outline, script);
  return {
    result: {
      script,
      outline,
      chapters,
      validation,
      rewriteCount,
    },
    usage: { inputTokens: usageIn, outputTokens: usageOut },
  };
}

export async function runScriptEngine(params: {
  client: OpenAI;
  model: string;
  topic: string;
  nicheName: string;
  selectedHook: string;
  mode: "short" | "long";
  shortBasePrompt?: string;
  longBasePrompt?: string;
}): Promise<
  | { mode: "short"; result: ShortScriptEngineResult; usage: { inputTokens: number; outputTokens: number } }
  | { mode: "long"; result: LongScriptEngineResult; usage: { inputTokens: number; outputTokens: number } }
> {
  if (params.mode === "short") {
    const output = await generateShortScriptInternal({
      client: params.client,
      model: params.model,
      topic: params.topic,
      nicheName: params.nicheName,
      selectedHook: params.selectedHook,
      shortBasePrompt: params.shortBasePrompt ?? "",
    });
    return { mode: "short", ...output };
  }

  const output = await generateLongScriptInternal({
    client: params.client,
    model: params.model,
    topic: params.topic,
    nicheName: params.nicheName,
    selectedHook: params.selectedHook,
    longBasePrompt: params.longBasePrompt ?? "",
  });
  return { mode: "long", ...output };
}
