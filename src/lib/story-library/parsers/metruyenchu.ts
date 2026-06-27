import { load } from "cheerio";
import type { StoryLibraryFallbackInspectionVerdict } from "@/lib/story-library/types";
import { cleanInlineText, countWords, extractChapterNumber, normalizeParagraphText } from "@/lib/story-library/text";

// metruyenchuvn.com chapter URLs carry a random per-chapter suffix
// (e.g. /<slug>/chuong-305-_MYjpecCZ2iP) that cannot be predicted from the chapter
// number alone. This source is therefore manual-URL-only — never auto-generate a
// suggested URL for it (unlike tvtruyen.fit/itruyenchu.org elsewhere in this file's
// siblings, which DO have a predictable /<slug>/chuong-<n> pattern).
export const METRUYENCHU_SITE = "metruyenchuvn.com";

const MIN_FALLBACK_WORDS = 30;
const CONTENT_SELECTORS = [
  "#chapter-content",
  ".chapter-c-content",
  ".chapter-content",
  ".content-chapter",
  ".box-chap-content",
  ".reading-content",
  "article .content",
  ".content",
] as const;

// Exact phrases from the task brief, plus the existing project's generic
// captcha/login/unlock vocabulary for consistency with the other fallback parsers.
const GATED_PATTERNS = [
  "nhập mã để đọc tiếp",
  "nhap ma de doc tiep",
  "nhập mã",
  "nhap ma",
  "mã xác nhận",
  "ma xac nhan",
  "đăng nhập để đọc",
  "dang nhap de doc",
  "vui lòng đăng nhập",
  "vui long dang nhap",
  "captcha",
  "xác minh",
  "xac minh",
  "mở khóa",
  "mo khoa",
  "turnstile",
  "cf-challenge",
  "challenge-platform",
] as const;
// "code" alone is too generic to substring-match (would false-positive on unrelated
// text) — checked separately as a whole word.
const GATED_WHOLE_WORD_PATTERNS = [/\bcode\b/i] as const;

const PLACEHOLDER_PATTERNS = [
  "nguồn thiếu chương này, mong độc giả thông cảm",
  "nguon thieu chuong nay, mong doc gia thong cam",
  "chương không có nội dung",
  "chuong khong co noi dung",
  "nội dung đang cập nhật",
  "noi dung dang cap nhat",
  "đang cập nhật",
  "dang cap nhat",
] as const;

const NOISE_LINE_PATTERNS = [
  /^chương\s+\d+[:.]?\s*/i,
  /^chương trước$/i,
  /^chương sau$/i,
  /^mục lục$/i,
  /^\.+$/,
] as const;

export type StoryLibraryFallbackInspection = {
  verdict: StoryLibraryFallbackInspectionVerdict;
  fallbackSourceSite: string;
  fallbackUrl: string;
  responseUrl: string;
  httpStatus: number | null;
  pageTitle: string | null;
  canonicalUrl: string | null;
  storyTitle: string | null;
  chapterTitle: string | null;
  chapterNumber: number;
  contentSelectorUsed: string | null;
  contentText: string | null;
  wordCount: number;
  contentLength: number;
  gateIndicatorsFound: string[];
  message: string;
  diagnostics: Record<string, unknown>;
};

function normalizeLower(value: string | null | undefined) {
  return cleanInlineText(value ?? "").toLowerCase();
}

function stripDiacritics(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeComparable(value: string | null | undefined) {
  return stripDiacritics(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareStoryMatch(actual: string | null, expected: string | null | undefined) {
  if (!expected) return true;
  const actualComparable = normalizeComparable(actual);
  const expectedComparable = normalizeComparable(expected);
  return Boolean(actualComparable && expectedComparable && (actualComparable.includes(expectedComparable) || expectedComparable.includes(actualComparable)));
}

function findGateIndicators(html: string): string[] {
  const lower = normalizeLower(html);
  const found = GATED_PATTERNS.filter((pattern) => lower.includes(pattern)) as string[];
  for (const pattern of GATED_WHOLE_WORD_PATTERNS) {
    if (pattern.test(html)) found.push(pattern.source);
  }
  return found;
}

function hasPlaceholderText(text: string | null | undefined) {
  const normalized = normalizeLower(text);
  if (!normalized) return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => normalized === pattern || normalized.includes(pattern));
}

function buildHeaders() {
  return {
    accept: "text/html,application/xhtml+xml",
    "accept-language": "vi,en;q=0.8",
    "user-agent": "Mozilla/5.0 (compatible; StoryLibraryBot/1.0; +https://localhost/story-library)",
  };
}

function extractMetruyenChuContent(html: string) {
  const $ = load(html);

  const selectorDiagnostics = CONTENT_SELECTORS.map((selector) => {
    const root = $(selector).first();
    const paragraphTexts = root
      .find("p")
      .toArray()
      .map((element) => cleanInlineText($(element).text()))
      .filter(Boolean)
      .filter((line) => !NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line)));

    // Fall back to the container's own text if it has no <p> children — some
    // truyen-CMS templates render chapter body as plain text nodes, not paragraphs.
    const text = paragraphTexts.length > 0 ? normalizeParagraphText(paragraphTexts) : cleanInlineText(root.text());

    return {
      selector,
      found: root.length > 0,
      contentLength: text.length,
      wordCount: countWords(text),
      text,
    };
  });

  const bestCandidate = [...selectorDiagnostics].sort((a, b) => b.contentLength - a.contentLength)[0] ?? null;
  const pageTitle = cleanInlineText($("title").first().text()) || null;
  const canonicalUrl = $("link[rel='canonical']").attr("href") ?? null;
  const storyTitle =
    cleanInlineText($("h1").first().text()) ||
    cleanInlineText($("meta[property='og:title']").attr("content") ?? "") ||
    cleanInlineText(pageTitle?.split(" - Chương")[0]?.split(" - MeTruyenChu")[0] ?? "") ||
    null;
  const chapterTitle =
    cleanInlineText($("h2").first().text()) ||
    cleanInlineText(pageTitle?.match(/(Chương[^|]+)/i)?.[1] ?? "") ||
    null;

  return {
    pageTitle,
    canonicalUrl,
    storyTitle,
    chapterTitle,
    chapterNumber: extractChapterNumber(chapterTitle ?? pageTitle ?? ""),
    contentSelectorUsed: bestCandidate && bestCandidate.contentLength > 0 ? bestCandidate.selector : null,
    contentText: bestCandidate?.text ?? "",
    wordCount: bestCandidate?.wordCount ?? 0,
    contentLength: bestCandidate?.contentLength ?? 0,
    diagnostics: { selectorCandidates: selectorDiagnostics },
  };
}

function buildInspectionResult(params: {
  fallbackUrl: string;
  responseUrl: string;
  httpStatus: number | null;
  pageTitle: string | null;
  canonicalUrl: string | null;
  storyTitle: string | null;
  chapterTitle: string | null;
  chapterNumber: number;
  contentSelectorUsed: string | null;
  contentText: string | null;
  wordCount: number;
  contentLength: number;
  gateIndicatorsFound: string[];
  verdict: StoryLibraryFallbackInspectionVerdict;
  message: string;
  diagnostics: Record<string, unknown>;
}): StoryLibraryFallbackInspection {
  return {
    verdict: params.verdict,
    fallbackSourceSite: METRUYENCHU_SITE,
    fallbackUrl: params.fallbackUrl,
    responseUrl: params.responseUrl,
    httpStatus: params.httpStatus,
    pageTitle: params.pageTitle,
    canonicalUrl: params.canonicalUrl,
    storyTitle: params.storyTitle,
    chapterTitle: params.chapterTitle,
    chapterNumber: params.chapterNumber,
    contentSelectorUsed: params.contentSelectorUsed,
    contentText: params.contentText,
    wordCount: params.wordCount,
    contentLength: params.contentLength,
    gateIndicatorsFound: params.gateIndicatorsFound,
    message: params.message,
    diagnostics: params.diagnostics,
  };
}

const GATED_MESSAGE = "This page requires manual unlock/code/login and cannot be auto-imported.";

export function parseMetruyenChuFallbackHtml(params: {
  html: string;
  fallbackUrl: string;
  responseUrl?: string;
  httpStatus?: number | null;
  expectedStoryTitle?: string | null;
  expectedChapterNumber?: number | null;
  expectedChapterTitle?: string | null;
}): StoryLibraryFallbackInspection {
  const parsed = extractMetruyenChuContent(params.html);
  const gateIndicatorsFound = findGateIndicators(params.html);
  const responseUrl = params.responseUrl ?? params.fallbackUrl;
  const httpStatus = params.httpStatus ?? null;
  const base = {
    fallbackUrl: params.fallbackUrl,
    responseUrl,
    httpStatus,
    pageTitle: parsed.pageTitle,
    canonicalUrl: parsed.canonicalUrl,
    storyTitle: parsed.storyTitle,
    chapterTitle: parsed.chapterTitle,
    chapterNumber: parsed.chapterNumber,
    contentSelectorUsed: parsed.contentSelectorUsed,
    gateIndicatorsFound,
    diagnostics: parsed.diagnostics,
  };

  // Gate/code/login/captcha phrases win over everything else — never import gated text,
  // even if a content selector happened to also match some surrounding page chrome.
  if (gateIndicatorsFound.length > 0) {
    return buildInspectionResult({
      ...base,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      verdict: "gated_or_unreadable",
      message: GATED_MESSAGE,
    });
  }

  if (!parsed.contentSelectorUsed) {
    return buildInspectionResult({
      ...base,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      verdict: "parser_needed",
      message: "Fallback page loaded but no chapter content selector matched.",
    });
  }

  if (
    params.expectedChapterNumber &&
    parsed.chapterNumber > 0 &&
    parsed.chapterNumber !== params.expectedChapterNumber
  ) {
    return buildInspectionResult({
      ...base,
      contentText: parsed.contentText,
      wordCount: parsed.wordCount,
      contentLength: parsed.contentLength,
      verdict: "wrong_story_or_chapter",
      message: `Fallback chapter number ${parsed.chapterNumber} does not match expected chapter ${params.expectedChapterNumber}.`,
    });
  }

  if (!compareStoryMatch(parsed.storyTitle, params.expectedStoryTitle)) {
    return buildInspectionResult({
      ...base,
      contentText: parsed.contentText,
      wordCount: parsed.wordCount,
      contentLength: parsed.contentLength,
      verdict: "wrong_story_or_chapter",
      message: "Fallback story title does not appear to match the missing chapter story.",
    });
  }

  if (hasPlaceholderText(parsed.contentText) || parsed.wordCount < MIN_FALLBACK_WORDS) {
    return buildInspectionResult({
      ...base,
      contentText: parsed.contentText,
      wordCount: parsed.wordCount,
      contentLength: parsed.contentLength,
      verdict: "empty_or_placeholder",
      message: "Fallback chapter content is missing, placeholder, or too short to trust.",
    });
  }

  return buildInspectionResult({
    ...base,
    contentText: parsed.contentText,
    wordCount: parsed.wordCount,
    contentLength: parsed.contentLength,
    verdict: "valid_fallback",
    message: `Valid fallback content found (${parsed.wordCount} words).`,
  });
}

/**
 * Inspects exactly one manually-pasted metruyenchuvn.com chapter URL. Never crawls
 * the site, never guesses/generates a URL — the admin must supply the exact URL,
 * since chapter links here carry an unpredictable random suffix.
 */
export async function inspectMetruyenChuFallback(params: {
  fallbackUrl: string;
  expectedStoryTitle?: string | null;
  expectedChapterNumber?: number | null;
  expectedChapterTitle?: string | null;
}): Promise<StoryLibraryFallbackInspection> {
  const parsedUrl = new URL(params.fallbackUrl);
  if (parsedUrl.hostname !== METRUYENCHU_SITE) {
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: params.fallbackUrl,
      httpStatus: null,
      pageTitle: null,
      canonicalUrl: null,
      storyTitle: null,
      chapterTitle: null,
      chapterNumber: 0,
      contentSelectorUsed: null,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      gateIndicatorsFound: [],
      verdict: "inconclusive",
      message: `Only ${METRUYENCHU_SITE} fallback URLs are supported here.`,
      diagnostics: { hostname: parsedUrl.hostname },
    });
  }

  const response = await fetch(params.fallbackUrl, { headers: buildHeaders() });
  const html = await response.text();

  if (!response.ok) {
    const parsed = extractMetruyenChuContent(html);
    const gateIndicatorsFound = findGateIndicators(html);
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: response.url || params.fallbackUrl,
      httpStatus: response.status,
      pageTitle: parsed.pageTitle,
      canonicalUrl: parsed.canonicalUrl,
      storyTitle: parsed.storyTitle,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      contentSelectorUsed: parsed.contentSelectorUsed,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      gateIndicatorsFound,
      verdict: "gated_or_unreadable",
      message: `${GATED_MESSAGE} (HTTP ${response.status})`,
      diagnostics: parsed.diagnostics,
    });
  }

  return parseMetruyenChuFallbackHtml({
    html,
    fallbackUrl: params.fallbackUrl,
    responseUrl: response.url || params.fallbackUrl,
    httpStatus: response.status,
    expectedStoryTitle: params.expectedStoryTitle,
    expectedChapterNumber: params.expectedChapterNumber,
    expectedChapterTitle: params.expectedChapterTitle,
  });
}
