import { getContentProfile } from "@/lib/config/content-profiles";
import { extractFacebookQuoteCandidate } from "@/lib/quotes/quote-pipeline";
import { buildFallbackQuote, validateQuoteText } from "@/lib/quotes/quote-quality";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "");
}

function extractTopicWords(rawTitle: string): string[] {
  return rawTitle
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4)
    .map((w) => w.replace(/[^a-zA-Z0-9À-ỹ]/g, ""));
}

export const FACEBOOK_SAFE_CAPTION_MAX_LENGTH = 2000;

const SENTENCE_END_RE = /[.!?…。！？]["'”’)\]]?$/u;
const HASHTAG_RE = /^#[\p{L}\p{N}_]+$/u;
const VIETNAMESE_FRAGMENT_ENDINGS = new Set([
  "anh",
  "bị",
  "của",
  "cùng",
  "đam",
  "đang",
  "đến",
  "giữa",
  "khi",
  "khoảnh",
  "làm",
  "len",
  "một",
  "những",
  "trong",
  "vào",
  "và",
]);

function graphemes(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("vi", { granularity: "grapheme" });
    return [...segmenter.segment(value)].map((part) => part.segment);
  }
  return Array.from(value);
}

function graphemeLength(value: string): number {
  return graphemes(value).length;
}

function sliceGraphemes(value: string, maxLength: number): string {
  return graphemes(value).slice(0, Math.max(0, maxLength)).join("");
}

function normalizeCaptionText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitHashtags(value: string): { body: string; hashtags: string[] } {
  const lines = normalizeCaptionText(value).split("\n");
  const hashtagLineIndex = [...lines].reverse().findIndex((line) => {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => HASHTAG_RE.test(token));
  });
  if (hashtagLineIndex === -1) {
    return { body: normalizeCaptionText(value), hashtags: [] };
  }

  const index = lines.length - 1 - hashtagLineIndex;
  const hashtags = lines[index].trim().split(/\s+/).filter((token) => HASHTAG_RE.test(token));
  const body = normalizeCaptionText(lines.slice(0, index).join("\n"));
  return { body, hashtags };
}

function findLastSentenceBoundary(value: string, maxLength: number): number {
  const source = sliceGraphemes(value, maxLength);
  const boundaries = [...source.matchAll(/[.!?…。！？]["'”’)\]]?/gu)];
  const last = boundaries.at(-1);
  if (!last || last.index == null) return -1;
  return last.index + last[0].length;
}

function trimBodyToBoundary(body: string, maxLength: number): string {
  const normalized = normalizeCaptionText(body);
  if (graphemeLength(normalized) <= maxLength) return normalized;

  const sentenceBoundary = findLastSentenceBoundary(normalized, maxLength);
  if (sentenceBoundary >= 80) return normalized.slice(0, sentenceBoundary).trim();

  const clipped = sliceGraphemes(normalized, maxLength);
  const lastSpace = clipped.search(/\s+\S*$/u);
  const wordSafe = lastSpace >= 80 ? clipped.slice(0, lastSpace) : clipped;
  return `${wordSafe.replace(/[,\s;:]+$/u, "").trim()}...`;
}

function strippedLastWord(body: string): string {
  const lastWord = body.trim().split(/\s+/).at(-1) ?? "";
  return lastWord.replace(/[.!?…。！？”"')\]]+$/gu, "").toLowerCase();
}

function hasBrokenCaptionTail(body: string): boolean {
  const normalized = normalizeCaptionText(body);
  if (!normalized) return false;
  if (bodyEndsWithPunctuation(normalized)) return false;

  const lastWord = strippedLastWord(normalized);
  return (
    graphemeLength(lastWord) <= 2 ||
    VIETNAMESE_FRAGMENT_ENDINGS.has(lastWord) ||
    !SENTENCE_END_RE.test(normalized)
  );
}

function trimToLastCleanWordBoundary(body: string, maxLength: number): string {
  let candidate = sliceGraphemes(normalizeCaptionText(body), maxLength)
    .replace(/[,\s;:]+$/u, "")
    .trim();

  while (candidate.includes(" ")) {
    const lastWord = strippedLastWord(candidate);
    const unsafeTail = graphemeLength(lastWord) <= 2 || VIETNAMESE_FRAGMENT_ENDINGS.has(lastWord);
    if (!unsafeTail) break;
    const next = candidate.replace(/\s+\S*$/u, "").replace(/[,\s;:]+$/u, "").trim();
    if (graphemeLength(next) < 6) break;
    candidate = next;
  }

  return `${candidate}...`;
}

function repairCaptionBody(body: string, maxLength: number): string {
  const normalized = normalizeCaptionText(body);
  if (!normalized) return normalized;

  const overLimit = graphemeLength(normalized) > maxLength;
  const brokenTail = hasBrokenCaptionTail(normalized);
  if (!overLimit && !brokenTail) return normalized;

  const sentenceBoundary = findLastSentenceBoundary(normalized, maxLength);
  if (sentenceBoundary >= 40) return normalized.slice(0, sentenceBoundary).trim();
  return trimToLastCleanWordBoundary(normalized, maxLength);
}

function bodyEndsWithPunctuation(body: string): boolean {
  const withoutClosingQuote = body.trim().replace(/[”"')\]]+$/u, "");
  return SENTENCE_END_RE.test(withoutClosingQuote);
}

function appendPunctuationIfNeeded(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return trimmed;
  if (bodyEndsWithPunctuation(trimmed)) return trimmed;
  return `${trimmed}.`;
}

function appendHashtagsWithinLimit(body: string, hashtags: string[], maxLength: number): string {
  let caption = body;
  const selected: string[] = [];
  for (const tag of hashtags) {
    const nextTags = [...selected, tag].join(" ");
    const candidate = `${body}\n\n${nextTags}`;
    if (graphemeLength(candidate) > maxLength) break;
    selected.push(tag);
    caption = candidate;
  }
  return caption;
}

export function buildSafeFacebookCaption(
  rawCaption: string,
  maxLength = FACEBOOK_SAFE_CAPTION_MAX_LENGTH,
): string {
  const { body, hashtags } = splitHashtags(rawCaption);
  const hashtagReserve = hashtags.length > 0 ? Math.min(160, hashtags.join(" ").length + 2) : 0;
  const bodyMax = Math.max(120, maxLength - hashtagReserve);
  const safeBody = appendPunctuationIfNeeded(repairCaptionBody(body, bodyMax));
  const withTags = appendHashtagsWithinLimit(safeBody, hashtags, maxLength);
  if (graphemeLength(withTags) <= maxLength) return withTags;
  return trimBodyToBoundary(safeBody, maxLength);
}

export function validateFacebookCaption(caption: string, maxLength = FACEBOOK_SAFE_CAPTION_MAX_LENGTH): {
  ok: boolean;
  issues: string[];
  length: number;
} {
  const normalized = normalizeCaptionText(caption);
  const { body } = splitHashtags(normalized);
  const issues: string[] = [];
  const length = graphemeLength(normalized);
  if (length > maxLength) issues.push(`Caption exceeds safe limit (${length}/${maxLength}).`);
  const lastWord = strippedLastWord(body);
  const bodyPunctuated = bodyEndsWithPunctuation(body);
  if (!bodyPunctuated && graphemeLength(lastWord) <= 2) {
    issues.push("Caption ends with a short orphan fragment.");
  }
  if (!bodyPunctuated && VIETNAMESE_FRAGMENT_ENDINGS.has(lastWord)) {
    issues.push("Caption ends with a likely Vietnamese fragment.");
  }
  if (body && !bodyPunctuated) {
    issues.push("Caption body should end with punctuation before hashtags.");
  }
  return { ok: issues.length === 0, issues, length };
}

function buildShortDescription(
  rawTitle: string,
  nicheSlug: string,
  topicWords: string[],
  contentProfileKey?: string | null,
): string {
  const profile = getContentProfile(contentProfileKey);
  const summary = profile.key === "psychology"
    ? `Goc nhin tam ly ngan ve ${rawTitle.trim()}.`.slice(0, 140)
    : `Goc nhin ngan ve ${rawTitle.trim()}.`.slice(0, 140);
  const cta = profile.shortDescriptionCta;
  const hashtags = ["#Shorts", ...profile.facebookHashtags, `#${nicheSlug}`, ...topicWords.slice(0, 2).map((w) => `#${slugify(w)}`)]
    .filter((tag) => tag !== "#")
    .join(" ");
  return [summary, cta, hashtags].filter(Boolean).join("\n");
}

export function buildFacebookReelDescription(input: {
  topic: string;
  nicheName: string;
  shortContent?: string | null;
  contentProfileKey?: string | null;
}): string {
  const profile = getContentProfile(input.contentProfileKey);
  const rawTitle = input.topic || "Video";
  const nicheSlug = slugify(input.nicheName || "video");
  const topicWords = extractTopicWords(rawTitle);
  const summary = input.shortContent?.trim()
    ? input.shortContent.trim().slice(0, 260)
    : (profile.key === "psychology"
      ? `Goc nhin tam ly ngan ve ${rawTitle.trim()}.`.slice(0, 260)
      : `Goc nhin ngan ve ${rawTitle.trim()}.`.slice(0, 260));
  const hashtags = [...profile.facebookHashtags, `#${nicheSlug}`, ...topicWords.slice(0, 2).map((w) => `#${slugify(w)}`)]
    .filter((tag) => tag !== "#")
    .join(" ");
  return buildSafeFacebookCaption([summary, hashtags].filter(Boolean).join("\n\n"));
}

export function buildFacebookQuoteText(input: {
  topic: string;
  shortContent?: string | null;
  contentProfileKey?: string | null;
  channelKey?: string | null;
  nicheName?: string | null;
}): string {
  const profile = getContentProfile(input.contentProfileKey);
  const sentence = extractFacebookQuoteCandidate(input.shortContent);
  const base = sentence && sentence.length > 0
    ? sentence
    : profile.defaultQuoteFallback.replace("{{topic}}", input.topic.trim());

  const validation = validateQuoteText(base, {
    channelKey: input.channelKey,
    contentProfileKey: input.contentProfileKey,
    nicheName: input.nicheName,
  });
  const qualitySafe = validation.ok
    ? validation.normalized
    : buildFallbackQuote({
      channelKey: input.channelKey,
      contentProfileKey: input.contentProfileKey,
      nicheName: input.nicheName,
    }, input.topic);

  if (qualitySafe.length <= 170) return qualitySafe;

  const clipped = qualitySafe.slice(0, 167);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 60 ? clipped.slice(0, lastSpace) : clipped).trim()}...`;
}

export function buildFacebookQuotePostDescription(input: {
  topic: string;
  nicheName: string;
  shortContent?: string | null;
  contentProfileKey?: string | null;
  quoteText?: string | null;
}): string {
  const profile = getContentProfile(input.contentProfileKey);
  const rawTitle = input.topic || "Bai viet";
  const nicheSlug = slugify(input.nicheName || "video");
  const topicWords = extractTopicWords(rawTitle);
  const quote = input.quoteText?.trim()
    ? input.quoteText.trim()
    : buildFacebookQuoteText({
        topic: input.topic,
        shortContent: input.shortContent,
        contentProfileKey: input.contentProfileKey,
      });
  const hashtags = [...profile.facebookHashtags, `#${nicheSlug}`, ...topicWords.slice(0, 2).map((w) => `#${slugify(w)}`)]
    .filter((tag) => tag !== "#")
    .join(" ");
  return buildSafeFacebookCaption([`“${quote}”`, hashtags].filter(Boolean).join("\n\n"));
}

export function buildYouTubeVideoMetadata(input: {
  contentType: "short" | "long";
  topic: string;
  nicheName: string;
  shortContent?: string | null;
  longContent?: string | null;
  longYoutubeDescription?: string | null;
  contentProfileKey?: string | null;
}): {
  title: string;
  description: string;
  tags: string[];
} {
  const profile = getContentProfile(input.contentProfileKey);
  const rawTitle = input.topic || "Video";
  const nicheSlug = slugify(input.nicheName || "video");
  const topicWords = extractTopicWords(rawTitle);
  const hashtagWords = [...profile.facebookHashtags.map((tag) => tag.replace(/^#/, "")), nicheSlug, ...topicWords.map(slugify)].filter(Boolean);

  if (input.contentType === "long") {
    const hashtags = (profile.key === "psychology"
      ? hashtagWords.map((w) => `#${w}`)
      : ["#viral", ...hashtagWords.map((w) => `#${w}`)]).join(" ");
    const seoBase = input.longYoutubeDescription?.trim()
      ? input.longYoutubeDescription.trim()
      : input.longContent?.slice(0, 4800) ?? "";
    return {
      title: rawTitle.slice(0, 100),
      description: [seoBase, "", hashtags].join("\n").slice(0, 5000),
      tags: [...new Set([
        ...(profile.key === "psychology" ? [] : ["viral"]),
        ...profile.youtubeBaseTags,
        nicheSlug,
        ...topicWords,
      ])].filter(Boolean),
    };
  }

  return {
    title: (rawTitle.length <= 93 ? `${rawTitle} #Shorts` : rawTitle).slice(0, 100),
    description: buildShortDescription(rawTitle, nicheSlug, topicWords, input.contentProfileKey).slice(0, 5000),
    tags: [...new Set([...profile.youtubeBaseTags, nicheSlug, ...topicWords])].filter(Boolean),
  };
}

export function buildDefaultVideoTitle(input: {
  platform: "youtube" | "facebook";
  contentType: "short" | "long" | "quote";
  topic: string;
  contentProfileKey?: string | null;
  shortContent?: string | null;
  quoteText?: string | null;
}): string {
  const rawTitle = input.topic || "Video";
  if (input.platform === "youtube" && input.contentType === "short") {
    return (rawTitle.length <= 93 ? `${rawTitle} #Shorts` : rawTitle).slice(0, 100);
  }
  if (input.platform === "facebook" && input.contentType === "quote") {
    return (input.quoteText?.trim()
      ? input.quoteText.trim()
      : buildFacebookQuoteText({
          topic: input.topic,
          shortContent: input.shortContent,
          contentProfileKey: input.contentProfileKey,
        })).slice(0, 100);
  }
  return rawTitle.slice(0, 100);
}

export function buildDefaultVideoDescription(input: {
  platform: "youtube" | "facebook";
  contentType: "short" | "long" | "quote";
  topic: string;
  nicheName: string;
  shortContent?: string | null;
  longContent?: string | null;
  longYoutubeDescription?: string | null;
  contentProfileKey?: string | null;
  quoteText?: string | null;
}): string {
  if (input.platform === "facebook") {
    if (input.contentType === "quote") {
      return buildFacebookQuotePostDescription({
        topic: input.topic,
        nicheName: input.nicheName,
        shortContent: input.shortContent,
        contentProfileKey: input.contentProfileKey,
        quoteText: input.quoteText,
      });
    }
    return buildFacebookReelDescription({
      topic: input.topic,
      nicheName: input.nicheName,
      shortContent: input.shortContent,
      contentProfileKey: input.contentProfileKey,
    });
  }

  if (input.contentType === "quote") {
    return "";
  }

  return buildYouTubeVideoMetadata({
    contentType: input.contentType as "short" | "long",
    topic: input.topic,
    nicheName: input.nicheName,
    shortContent: input.shortContent,
    longContent: input.longContent,
    longYoutubeDescription: input.longYoutubeDescription,
    contentProfileKey: input.contentProfileKey,
  }).description;
}
