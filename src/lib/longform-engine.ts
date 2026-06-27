import type OpenAI from "openai";
import type { LongOutline, LongChapter } from "./script-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TitleCandidate = {
  title: string;
  scores: {
    curiosity: number;
    clarity: number;
    emotion: number;
    searchPotential: number;
    notClickbait: number;
    total: number;
  };
};

export type ThumbnailIntent = {
  emotion: string;
  mainVisual: string;
  text: string;
  colorMood: string;
};

export type LongformPackage = {
  topic: string;
  best_title: string;
  title_candidates: TitleCandidate[];
  description: string;
  chapters: { label: string; timestamp: string }[];
  tags: string[];
  pinned_comment: string;
  thumbnail_intent: ThumbnailIntent;
  script_path: string;
  video_path: string;
  thumbnail_path: string;
};

export type LongformEngineResult = {
  package: LongformPackage;
  usage: { inputTokens: number; outputTokens: number };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJsonObject(raw: string): string | null {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

function extractJsonArray(raw: string): string | null {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 5;
  return Math.max(0, Math.min(10, Math.round(v)));
}

async function callLLM(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return {
    text: res.choices[0]?.message?.content ?? "",
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}

// ─── Title Generator ──────────────────────────────────────────────────────────

function buildTitlePrompt(topic: string, scriptExcerpt: string): string {
  return `Bạn là người viết tiêu đề YouTube chuyên về Phật pháp, chữa lành và chiêm nghiệm đời sống.

Chủ đề: ${topic}

Đoạn script (200 từ đầu):
${scriptExcerpt}

Tạo đúng 10 tiêu đề tiếng Việt cho video dài YouTube về chủ đề này.

YÊU CẦU:
- Tiêu đề ngắn gọn, không quá 65 ký tự
- Ngôn ngữ đời thường, gần gũi — không văn hoa
- KHÔNG dùng số đếm ("7 điều...", "5 bài học...")
- Chạm cảm xúc, không clickbait rẻ tiền
- Không mở đầu bằng "Hãy", "Bạn cần", "Bí quyết", "Cách để"
- Phong cách chiêm nghiệm, thật, sâu

Ví dụ tốt:
- Người làm bạn tổn thương có thể đã quên từ lâu
- Có những điều càng giữ càng khổ
- Khi đời bắt bạn buông xuống, hãy nhớ điều này
- Càng lớn tuổi, càng hiểu vì sao im lặng là phúc

Trả về JSON array, mỗi phần tử là object: {"title": "..."}
Chỉ JSON, không giải thích.`;
}

function buildTitleScorePrompt(titles: string[], topic: string): string {
  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `Chấm điểm các tiêu đề YouTube sau cho video Phật pháp / chữa lành.

Chủ đề: ${topic}

Tiêu đề:
${numbered}

Chấm theo 5 tiêu chí, thang 0–10:
- curiosity: gây tò mò, muốn click
- clarity: rõ ràng, dễ hiểu ngay
- emotion: chạm cảm xúc
- search_potential: có từ khóa tìm kiếm tiềm năng
- not_clickbait: không rẻ tiền, không sốc, hợp Phật pháp (10 = hoàn toàn không clickbait)

Trả về JSON array theo đúng thứ tự, mỗi phần tử:
{"curiosity": N, "clarity": N, "emotion": N, "search_potential": N, "not_clickbait": N}
Chỉ JSON array, không giải thích.`;
}

async function generateTitles(
  client: OpenAI,
  model: string,
  topic: string,
  scriptExcerpt: string,
): Promise<{ candidates: TitleCandidate[]; inputTokens: number; outputTokens: number }> {
  const system = "Bạn là chuyên gia viết nội dung YouTube Việt Nam, chuyên mảng Phật pháp và chữa lành.";
  let usageIn = 0;
  let usageOut = 0;

  const genRes = await callLLM(client, model, system, buildTitlePrompt(topic, scriptExcerpt), 0.8, 600);
  usageIn += genRes.inputTokens;
  usageOut += genRes.outputTokens;

  const arrJson = extractJsonArray(genRes.text);
  let rawTitles: string[] = [];
  if (arrJson) {
    try {
      const parsed = JSON.parse(arrJson) as { title: string }[];
      rawTitles = parsed.map((x) => (x.title ?? "").trim()).filter(Boolean);
    } catch { /* fallback */ }
  }

  if (rawTitles.length === 0) {
    rawTitles = genRes.text
      .split("\n")
      .map((l) => l.replace(/^\d+[\).\s]+/, "").replace(/^["'"]+|["'"]+$/g, "").trim())
      .filter((l) => l.length > 10 && l.length < 100);
  }

  rawTitles = rawTitles.slice(0, 10);

  const scoreRes = await callLLM(client, model, system, buildTitleScorePrompt(rawTitles, topic), 0.2, 600);
  usageIn += scoreRes.inputTokens;
  usageOut += scoreRes.outputTokens;

  const scoreArrJson = extractJsonArray(scoreRes.text);
  let scoreData: { curiosity: number; clarity: number; emotion: number; search_potential: number; not_clickbait: number }[] = [];
  if (scoreArrJson) {
    try {
      scoreData = JSON.parse(scoreArrJson);
    } catch { /* skip */ }
  }

  const candidates: TitleCandidate[] = rawTitles.map((title, i) => {
    const s = scoreData[i] ?? {};
    const curiosity = clamp(s.curiosity ?? 5);
    const clarity = clamp(s.clarity ?? 5);
    const emotion = clamp(s.emotion ?? 5);
    const searchPotential = clamp(s.search_potential ?? 5);
    const notClickbait = clamp(s.not_clickbait ?? 5);
    const total = Math.round((curiosity + clarity + emotion + searchPotential + notClickbait) / 5);
    return { title, scores: { curiosity, clarity, emotion, searchPotential, notClickbait, total } };
  });

  return { candidates, inputTokens: usageIn, outputTokens: usageOut };
}

// ─── Description Generator ────────────────────────────────────────────────────

function buildDescriptionPrompt(topic: string, bestTitle: string, scriptExcerpt: string): string {
  return `Viết phần mô tả (description) cho video YouTube về: "${bestTitle}"
Chủ đề gốc: ${topic}

Đoạn script:
${scriptExcerpt}

YÊU CẦU:
- 2–3 câu mở đầu hấp dẫn (không lặp lại tiêu đề)
- Tóm tắt nội dung ngắn gọn (3–5 câu)
- CTA nhẹ: mời xem tiếp, đăng ký, chia sẻ nếu thấy ý nghĩa
- Disclaimer mềm nếu phù hợp: "Nội dung mang tính chiêm nghiệm cá nhân, không thay thế tư vấn chuyên môn."
- Tiếng Việt tự nhiên, không văn AI
- Tổng khoảng 150–250 từ

Trả về chỉ phần description, không có tiêu đề hay label.`;
}

async function generateDescription(
  client: OpenAI,
  model: string,
  topic: string,
  bestTitle: string,
  scriptExcerpt: string,
): Promise<{ description: string; inputTokens: number; outputTokens: number }> {
  const system = "Bạn là content writer cho kênh YouTube Phật pháp và chữa lành tiếng Việt.";
  const res = await callLLM(client, model, system, buildDescriptionPrompt(topic, bestTitle, scriptExcerpt), 0.7, 500);
  return { description: res.text.trim(), inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}

// ─── Tags Generator ───────────────────────────────────────────────────────────

const BASE_TAGS = [
  "phật pháp",
  "lời phật dạy",
  "chữa lành",
  "buông xả",
  "nhân quả",
  "vô thường",
  "bình an",
  "chiêm nghiệm",
  "sống đẹp",
  "tâm lý",
];

function buildTagsPrompt(topic: string, bestTitle: string): string {
  return `Tạo tags YouTube cho video: "${bestTitle}" (chủ đề: ${topic})

Tags phải:
- Tiếng Việt, ngắn (1–4 từ mỗi tag)
- Liên quan mật thiết đến nội dung
- Không spam — tối đa 5 tags bổ sung ngoài tags cơ bản
- Ưu tiên từ khóa người Việt thật sự tìm kiếm

Trả về JSON array các tags bổ sung: ["tag1", "tag2", ...]
Chỉ JSON array, không giải thích.`;
}

async function generateTags(
  client: OpenAI,
  model: string,
  topic: string,
  bestTitle: string,
): Promise<{ tags: string[]; inputTokens: number; outputTokens: number }> {
  const system = "Bạn là SEO specialist cho kênh YouTube Phật pháp Việt Nam.";
  const res = await callLLM(client, model, system, buildTagsPrompt(topic, bestTitle), 0.3, 150);

  let extraTags: string[] = [];
  const arrJson = extractJsonArray(res.text);
  if (arrJson) {
    try {
      const parsed = JSON.parse(arrJson);
      extraTags = (parsed as string[]).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 5);
    } catch { /* skip */ }
  }

  const allTags = [...new Set([...BASE_TAGS, ...extraTags])];
  return { tags: allTags, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}

// ─── Chapters from outline ────────────────────────────────────────────────────

function buildTimestampedChapters(
  chapters: LongChapter[],
  audioDurationSec: number,
): { label: string; timestamp: string }[] {
  if (!chapters.length) return [];

  const totalSections = chapters.length;
  const avgSec = audioDurationSec / totalSections;

  return chapters.map((ch, i) => {
    const totalSeconds = Math.round(i * avgSec);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timestamp = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return { label: ch.title, timestamp };
  });
}

// ─── Pinned Comment ───────────────────────────────────────────────────────────

function buildPinnedCommentPrompt(topic: string, bestTitle: string): string {
  return `Viết 1 bình luận ghim (pinned comment) cho video YouTube: "${bestTitle}"

Yêu cầu:
- Nhẹ nhàng, chân thành, không giả tạo
- Dạng câu hỏi mở để khuyến khích người xem tương tác
- Liên quan đến chủ đề: ${topic}
- Tối đa 2 câu
- Không emoji quá nhiều

Ví dụ tốt:
"Có điều gì trong cuộc đời mà quý vị đang học cách buông xuống không? Chia sẻ trong phần bình luận nhé."

Trả về chỉ nội dung bình luận, không có label.`;
}

async function generatePinnedComment(
  client: OpenAI,
  model: string,
  topic: string,
  bestTitle: string,
): Promise<{ comment: string; inputTokens: number; outputTokens: number }> {
  const system = "Bạn là người điều hành kênh YouTube Phật pháp, viết bình luận thân thiện với cộng đồng.";
  const res = await callLLM(client, model, system, buildPinnedCommentPrompt(topic, bestTitle), 0.7, 100);
  return { comment: res.text.trim(), inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}

// ─── Thumbnail Intent ─────────────────────────────────────────────────────────

function buildThumbnailIntentPrompt(topic: string, scriptExcerpt: string): string {
  return `Tạo metadata định hướng thumbnail cho video Phật pháp / chữa lành.

Chủ đề: ${topic}
Script:
${scriptExcerpt}

Trả về JSON object:
{
  "emotion": "tên cảm xúc chủ đạo (tha_thu/buon_ba/hoi_tiec/binh_an/nhan_qua/buon_xa/vo_thuong/so_hai/tinh_than_tu_bi)",
  "mainVisual": "mô tả ngắn hình ảnh chính nên dùng",
  "text": "gợi ý text thumbnail tối đa 5 từ tiếng Việt in hoa",
  "colorMood": "mô tả màu sắc ấm lạnh"
}
Chỉ JSON, không giải thích.`;
}

async function generateThumbnailIntent(
  client: OpenAI,
  model: string,
  topic: string,
  scriptExcerpt: string,
): Promise<{ intent: ThumbnailIntent; inputTokens: number; outputTokens: number }> {
  const system = "Bạn là art director cho kênh YouTube Phật pháp.";
  const res = await callLLM(client, model, system, buildThumbnailIntentPrompt(topic, scriptExcerpt), 0.5, 200);

  const fallback: ThumbnailIntent = {
    emotion: "binh_an",
    mainVisual: "Cảnh thiền định hoặc thiên nhiên yên bình",
    text: "BÌNH AN KHÔNG XA",
    colorMood: "Vàng ấm, cam nhạt, nâu gỗ",
  };

  const objJson = extractJsonObject(res.text);
  if (!objJson) return { intent: fallback, inputTokens: res.inputTokens, outputTokens: res.outputTokens };

  try {
    const parsed = JSON.parse(objJson) as Partial<ThumbnailIntent>;
    return {
      intent: {
        emotion: parsed.emotion ?? fallback.emotion,
        mainVisual: parsed.mainVisual ?? fallback.mainVisual,
        text: parsed.text ?? fallback.text,
        colorMood: parsed.colorMood ?? fallback.colorMood,
      },
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    };
  } catch {
    return { intent: fallback, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
  }
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

export async function runLongformEngine(params: {
  client: OpenAI;
  model: string;
  topic: string;
  script: string;
  outline?: LongOutline;
  rawChapters?: LongChapter[];
  audioDurationSec?: number;
  scriptPath?: string;
  videoPath?: string;
  thumbnailPath?: string;
}): Promise<LongformEngineResult> {
  const scriptExcerpt = params.script.split(/\s+/).slice(0, 250).join(" ");
  let usageIn = 0;
  let usageOut = 0;

  const titlesRes = await generateTitles(params.client, params.model, params.topic, scriptExcerpt);
  usageIn += titlesRes.inputTokens;
  usageOut += titlesRes.outputTokens;

  const sortedCandidates = [...titlesRes.candidates].sort((a, b) => b.scores.total - a.scores.total);
  const bestTitle = sortedCandidates[0]?.title ?? params.topic;

  const descRes = await generateDescription(params.client, params.model, params.topic, bestTitle, scriptExcerpt);
  usageIn += descRes.inputTokens;
  usageOut += descRes.outputTokens;

  const tagsRes = await generateTags(params.client, params.model, params.topic, bestTitle);
  usageIn += tagsRes.inputTokens;
  usageOut += tagsRes.outputTokens;

  const commentRes = await generatePinnedComment(params.client, params.model, params.topic, bestTitle);
  usageIn += commentRes.inputTokens;
  usageOut += commentRes.outputTokens;

  const intentRes = await generateThumbnailIntent(params.client, params.model, params.topic, scriptExcerpt);
  usageIn += intentRes.inputTokens;
  usageOut += intentRes.outputTokens;

  const audioDurationSec = params.audioDurationSec ?? 600;
  const chapters = params.rawChapters
    ? buildTimestampedChapters(params.rawChapters, audioDurationSec)
    : [];

  const pkg: LongformPackage = {
    topic: params.topic,
    best_title: bestTitle,
    title_candidates: sortedCandidates,
    description: descRes.description,
    chapters,
    tags: tagsRes.tags,
    pinned_comment: commentRes.comment,
    thumbnail_intent: intentRes.intent,
    script_path: params.scriptPath ?? "",
    video_path: params.videoPath ?? "",
    thumbnail_path: params.thumbnailPath ?? "",
  };

  return { package: pkg, usage: { inputTokens: usageIn, outputTokens: usageOut } };
}
