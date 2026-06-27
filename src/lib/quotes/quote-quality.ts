import { resolveQuoteVisualStyle, type QuoteStyleResolverInput } from "@/lib/quotes/quote-style";

export type QuoteQualityProfileKey = "phat_phap" | "tang_sau" | "default";

type QuoteQualityProfile = {
  key: QuoteQualityProfileKey;
  minWords: number;
  maxWords: number;
  forbiddenPhrases: string[];
  fallbackQuotes: string[];
};

export type QuoteValidationResult = {
  ok: boolean;
  normalized: string;
  wordCount: number;
  issues: string[];
  forbiddenFound: string[];
};

const COMMON_FORBIDDEN = [
  "mọi chuyện rồi sẽ qua",
  "hãy sống chậm lại",
  "một bài học sâu sắc",
  "hành trình chữa lành",
  "phiên bản tốt hơn",
];

const PHAT_PHAP_FORBIDDEN = [
  "buông bỏ đúng lúc",
  "bình an trong tâm",
  "tâm an vạn sự an",
  "gieo nhân nào gặt quả nấy",
  "hãy",
];

const TANG_SAU_FORBIDDEN = [
  "yêu bản thân",
  "chữa lành",
  "mạnh mẽ lên",
  "mọi thứ đều có lý do",
  "vết thương nào rồi cũng lành",
];

const QUALITY_PROFILES: Record<QuoteQualityProfileKey, QuoteQualityProfile> = {
  phat_phap: {
    key: "phat_phap",
    minWords: 18,
    maxWords: 36,
    forbiddenPhrases: [...COMMON_FORBIDDEN, ...PHAT_PHAP_FORBIDDEN],
    fallbackQuotes: [
      "Có những nỗi mệt không đến từ việc đời quá nặng, mà từ phần trong ta vẫn âm thầm đòi người khác phải hiểu điều mình chưa thể nói ra.",
      "Khi thôi cần đúng trong một cuộc hơn thua, lòng người mới dần có chỗ để buông bớt oán trách và nghe rõ nỗi khổ của chính mình.",
      "Nhiều tổn thương không lớn vì người khác làm quá nhiều, mà vì trong ta còn giữ mãi một mong đợi chưa chịu lặng xuống.",
    ],
  },
  tang_sau: {
    key: "tang_sau",
    minWords: 18,
    maxWords: 38,
    forbiddenPhrases: [...COMMON_FORBIDDEN, ...TANG_SAU_FORBIDDEN],
    fallbackQuotes: [
      "Có người không sợ cô đơn vì thiếu người ở cạnh, mà vì họ đã quen tự thu nhỏ mình lại để khỏi làm ai khó chịu thêm một lần nữa.",
      "Đôi khi điều khiến một người im hẳn không phải bình yên, mà là cảm giác nói thêm nữa cũng chỉ làm nỗi mệt của mình lộ ra rõ hơn.",
      "Nhiều người lớn lên rất giỏi chịu đựng, đến mức ngay cả lúc tổn thương nhất họ vẫn chỉ xin lỗi vì đã khiến người khác thấy mình quá nhiều.",
    ],
  },
  default: {
    key: "default",
    minWords: 12,
    maxWords: 40,
    forbiddenPhrases: COMMON_FORBIDDEN,
    fallbackQuotes: [
      "Có những điều chỉ trở nên nhẹ hơn khi ta thôi bắt lòng mình phải trả lời mọi thứ thật nhanh.",
      "Nhiều bình yên không đến từ hoàn cảnh, mà đến từ lúc mình bớt chống lại điều đã xảy ra trong lòng.",
    ],
  },
};

export function normalizeQuoteText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[“”"]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function countVietnameseWords(value: string): number {
  return normalizeQuoteText(value)
    .replace(/\n/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

export function resolveQuoteQualityProfile(
  input: QuoteStyleResolverInput,
): QuoteQualityProfile {
  const style = resolveQuoteVisualStyle(input);
  if (style.reason === "phat_phap_static_guard") return QUALITY_PROFILES.phat_phap;
  if (style.reason === "tang_sau_static_guard") return QUALITY_PROFILES.tang_sau;
  return QUALITY_PROFILES.default;
}

function looksLikeListOrMultipleOptions(value: string): boolean {
  const text = normalizeQuoteText(value);
  if (/\n\s*(?:[-*•]|\d+[.)]|[A-D][.)])\s+/u.test(text)) return true;
  if (/\b(phương án|lựa chọn|option)\b/iu.test(text)) return true;
  const nonEmptyLines = text.split("\n").filter((line) => line.trim().length > 0);
  return nonEmptyLines.length > 3;
}

function hasNoisyFormatting(value: string): boolean {
  const text = normalizeQuoteText(value);
  const exclamations = (text.match(/!/g) ?? []).length;
  const hashtags = (text.match(/#/g) ?? []).length;
  const emojis = (text.match(/[\p{Extended_Pictographic}]/gu) ?? []).length;
  return exclamations > 1 || hashtags > 0 || emojis > 0;
}

function countSentences(value: string): number {
  const matches = normalizeQuoteText(value).match(/[.!?…]+/g);
  return matches?.length ?? 1;
}

export function validateQuoteText(
  value: string,
  input: QuoteStyleResolverInput,
): QuoteValidationResult {
  const profile = resolveQuoteQualityProfile(input);
  const normalized = normalizeQuoteText(value);
  const lower = normalized.toLocaleLowerCase("vi-VN");
  const wordCount = countVietnameseWords(normalized);
  const issues: string[] = [];
  const forbiddenFound = profile.forbiddenPhrases.filter((phrase) => lower.includes(phrase.toLocaleLowerCase("vi-VN")));

  if (!normalized) issues.push("empty");
  if (looksLikeListOrMultipleOptions(normalized)) issues.push("multiple_options_or_list");
  if (hasNoisyFormatting(normalized)) issues.push("noisy_formatting");
  if (wordCount < profile.minWords || wordCount > profile.maxWords) issues.push("length_out_of_range");
  if (countSentences(normalized) > 2) issues.push("too_many_sentences");
  if (forbiddenFound.length > 0) issues.push("contains_forbidden_cliche");

  return {
    ok: issues.length === 0,
    normalized,
    wordCount,
    issues,
    forbiddenFound,
  };
}

export function buildFallbackQuote(
  input: QuoteStyleResolverInput,
  seed = "",
): string {
  const profile = resolveQuoteQualityProfile(input);
  const library = profile.fallbackQuotes;
  const hash = Array.from(seed || profile.key).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0);
  return library[hash % library.length]!;
}
