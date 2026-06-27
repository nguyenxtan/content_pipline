import { load } from "cheerio";
import type { StoryLibraryFallbackInspectionVerdict } from "@/lib/story-library/types";
import { cleanInlineText, countWords, extractChapterNumber, normalizeParagraphText } from "@/lib/story-library/text";

export const TVTRUYEN_SITE = "www.tvtruyen.fit";
const MIN_FALLBACK_WORDS = 30;
const GATED_PATTERNS = [
  "captcha",
  "turnstile",
  "cf-challenge",
  "challenge-platform",
  "đăng nhập",
  "dang nhap",
  "vui lòng đăng nhập",
  "please login",
  "login required",
  "subscribe to read",
  "unlock chapter",
  "mở khóa",
  "mo khoa",
  "thanh toán",
  "thanh toan",
  "payment required",
] as const;
const PLACEHOLDER_PATTERNS = [
  "nguồn thiếu chương này, mong độc giả thông cảm",
  "nguon thieu chuong nay, mong doc gia thong cam",
  "chương không có nội dung",
  "chuong khong co noi dung",
  "nội dung chương đang bị khóa",
  "noi dung chuong dang bi khoa",
  "đang cập nhật",
  "dang cap nhat",
  "load failed",
  "placeholder",
] as const;
const CONTENT_SELECTORS = ["#chapter-content", "#chapter-big-container #chapter-content"] as const;

export type StoryLibraryFallbackInspection = {
  verdict: StoryLibraryFallbackInspectionVerdict;
  fallbackSourceSite: string;
  fallbackUrl: string;
  responseUrl: string;
  pageTitle: string | null;
  canonicalUrl: string | null;
  storyTitle: string | null;
  chapterTitle: string | null;
  chapterNumber: number;
  contentText: string | null;
  wordCount: number;
  contentLength: number;
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

function hasPlaceholderText(text: string | null | undefined) {
  const normalized = normalizeLower(text);
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return PLACEHOLDER_PATTERNS.some((pattern) => {
    if (normalized === pattern) return true;
    return lines.some((line) => line === pattern || line.startsWith(pattern));
  });
}

function buildHeaders() {
  return {
    accept: "text/html,application/xhtml+xml",
    "accept-language": "vi,en;q=0.8",
    "user-agent": "Mozilla/5.0 (compatible; StoryLibraryBot/1.0; +https://localhost/story-library)",
  };
}

function extractTvTruyenContent(html: string) {
  const $ = load(html);
  const selectorDiagnostics = CONTENT_SELECTORS.map((selector) => {
    const root = $(selector).first();
    const paragraphs = root
      .find("p")
      .toArray()
      .map((element) => cleanInlineText($(element).text()))
      .filter(Boolean)
      .filter((line) => !line.match(/^bạn đã đi đến chương/i))
      .filter((line) => !line.match(/^truyện sẽ tiếp tục được cập nhật/i));
    const text = normalizeParagraphText(paragraphs);
    return {
      selector,
      found: root.length > 0,
      text,
      contentLength: text.length,
      wordCount: countWords(text),
    };
  });

  const bestCandidate = [...selectorDiagnostics].sort((a, b) => b.contentLength - a.contentLength)[0] ?? null;
  const pageTitle = cleanInlineText($("title").first().text()) || null;
  const canonicalUrl = $("link[rel='canonical']").attr("href") ?? null;
  const chapterTitle =
    cleanInlineText($(".chapter-title .chapter-text-info").first().text()) ||
    cleanInlineText($(".chapter-title").first().text()) ||
    pageTitle;
  const storyTitle =
    cleanInlineText($("meta[property='og:image:alt']").attr("content") ?? "") ||
    cleanInlineText($(".breadcrumb a").eq(1).text()) ||
    cleanInlineText(pageTitle?.split("/")[0] ?? "") ||
    null;

  return {
    pageTitle,
    canonicalUrl,
    storyTitle,
    chapterTitle: chapterTitle || null,
    chapterNumber: extractChapterNumber(chapterTitle ?? pageTitle ?? ""),
    contentSelectorUsed: bestCandidate?.selector ?? null,
    contentText: bestCandidate?.text ?? "",
    wordCount: bestCandidate?.wordCount ?? 0,
    contentLength: bestCandidate?.contentLength ?? 0,
    diagnostics: {
      selectorCandidates: selectorDiagnostics,
      gateIndicatorsFound: GATED_PATTERNS.filter((pattern) => normalizeLower(html).includes(pattern)),
      placeholderIndicatorsFound: PLACEHOLDER_PATTERNS.filter((pattern) => hasPlaceholderText(bestCandidate?.text) && normalizeLower(bestCandidate?.text).includes(pattern)),
      cloudflareMarkerFound:
        normalizeLower(html).includes("cf-turnstile") || normalizeLower(html).includes("challenge-platform"),
    },
  };
}

export function parseTvTruyenFallbackHtml(params: {
  html: string;
  fallbackUrl: string;
  responseUrl?: string;
  expectedStoryTitle?: string | null;
  expectedChapterNumber?: number | null;
  expectedChapterTitle?: string | null;
}) {
  const parsed = extractTvTruyenContent(params.html);
  const diagnostics = {
    contentSelectorUsed: parsed.contentSelectorUsed,
    ...parsed.diagnostics,
  };

  if (!parsed.contentSelectorUsed) {
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: params.responseUrl ?? params.fallbackUrl,
      pageTitle: parsed.pageTitle,
      canonicalUrl: parsed.canonicalUrl,
      storyTitle: parsed.storyTitle,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      verdict: "parser_needed",
      message: "Fallback page loaded but no chapter content selector matched.",
      diagnostics,
    });
  }

  const pageLower = normalizeLower(params.html);
  if (GATED_PATTERNS.some((pattern) => pageLower.includes(pattern))) {
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: params.responseUrl ?? params.fallbackUrl,
      pageTitle: parsed.pageTitle,
      canonicalUrl: parsed.canonicalUrl,
      storyTitle: parsed.storyTitle,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      verdict: "gated_or_unreadable",
      message: "Fallback page appears gated or unreadable.",
      diagnostics,
    });
  }

  if (
    params.expectedChapterNumber &&
    parsed.chapterNumber > 0 &&
    parsed.chapterNumber !== params.expectedChapterNumber
  ) {
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: params.responseUrl ?? params.fallbackUrl,
      pageTitle: parsed.pageTitle,
      canonicalUrl: parsed.canonicalUrl,
      storyTitle: parsed.storyTitle,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      contentText: parsed.contentText,
      wordCount: parsed.wordCount,
      contentLength: parsed.contentLength,
      verdict: "wrong_story_or_chapter",
      message: `Fallback chapter number ${parsed.chapterNumber} does not match expected chapter ${params.expectedChapterNumber}.`,
      diagnostics,
    });
  }

  if (!compareStoryMatch(parsed.storyTitle, params.expectedStoryTitle)) {
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: params.responseUrl ?? params.fallbackUrl,
      pageTitle: parsed.pageTitle,
      canonicalUrl: parsed.canonicalUrl,
      storyTitle: parsed.storyTitle,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      contentText: parsed.contentText,
      wordCount: parsed.wordCount,
      contentLength: parsed.contentLength,
      verdict: "wrong_story_or_chapter",
      message: "Fallback story title does not appear to match the missing chapter story.",
      diagnostics,
    });
  }

  if (hasPlaceholderText(parsed.contentText)) {
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: params.responseUrl ?? params.fallbackUrl,
      pageTitle: parsed.pageTitle,
      canonicalUrl: parsed.canonicalUrl,
      storyTitle: parsed.storyTitle,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      contentText: parsed.contentText,
      wordCount: parsed.wordCount,
      contentLength: parsed.contentLength,
      verdict: "empty_or_placeholder",
      message: "Fallback page contains placeholder or source-missing text, not readable chapter content.",
      diagnostics,
    });
  }

  if (parsed.wordCount < MIN_FALLBACK_WORDS) {
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: params.responseUrl ?? params.fallbackUrl,
      pageTitle: parsed.pageTitle,
      canonicalUrl: parsed.canonicalUrl,
      storyTitle: parsed.storyTitle,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      contentText: parsed.contentText,
      wordCount: parsed.wordCount,
      contentLength: parsed.contentLength,
      verdict: "empty_or_placeholder",
      message: "Fallback chapter content is too short to trust.",
      diagnostics,
    });
  }

  return buildInspectionResult({
    fallbackUrl: params.fallbackUrl,
    responseUrl: params.responseUrl ?? params.fallbackUrl,
    pageTitle: parsed.pageTitle,
    canonicalUrl: parsed.canonicalUrl,
    storyTitle: parsed.storyTitle,
    chapterTitle: parsed.chapterTitle,
    chapterNumber: parsed.chapterNumber,
    contentText: parsed.contentText,
    wordCount: parsed.wordCount,
    contentLength: parsed.contentLength,
    verdict: "valid_fallback",
    message: `Valid fallback content found (${parsed.wordCount} words).`,
    diagnostics,
  });
}

function compareStoryMatch(actual: string | null, expected: string | null | undefined) {
  if (!expected) return true;
  const actualComparable = normalizeComparable(actual);
  const expectedComparable = normalizeComparable(expected);
  return Boolean(actualComparable && expectedComparable && (actualComparable.includes(expectedComparable) || expectedComparable.includes(actualComparable)));
}

function buildInspectionResult(params: {
  fallbackUrl: string;
  responseUrl: string;
  pageTitle: string | null;
  canonicalUrl: string | null;
  storyTitle: string | null;
  chapterTitle: string | null;
  chapterNumber: number;
  contentText: string | null;
  wordCount: number;
  contentLength: number;
  verdict: StoryLibraryFallbackInspectionVerdict;
  message: string;
  diagnostics: Record<string, unknown>;
}) {
  return {
    verdict: params.verdict,
    fallbackSourceSite: TVTRUYEN_SITE,
    fallbackUrl: params.fallbackUrl,
    responseUrl: params.responseUrl,
    pageTitle: params.pageTitle,
    canonicalUrl: params.canonicalUrl,
    storyTitle: params.storyTitle,
    chapterTitle: params.chapterTitle,
    chapterNumber: params.chapterNumber,
    contentText: params.contentText,
    wordCount: params.wordCount,
    contentLength: params.contentLength,
    message: params.message,
    diagnostics: params.diagnostics,
  } satisfies StoryLibraryFallbackInspection;
}

export async function inspectTvTruyenFallback(params: {
  fallbackUrl: string;
  expectedStoryTitle?: string | null;
  expectedChapterNumber?: number | null;
  expectedChapterTitle?: string | null;
}) : Promise<StoryLibraryFallbackInspection> {
  const parsedUrl = new URL(params.fallbackUrl);
  if (parsedUrl.hostname !== TVTRUYEN_SITE) {
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: params.fallbackUrl,
      pageTitle: null,
      canonicalUrl: null,
      storyTitle: null,
      chapterTitle: null,
      chapterNumber: 0,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      verdict: "inconclusive",
      message: `Only ${TVTRUYEN_SITE} fallback URLs are supported here.`,
      diagnostics: { hostname: parsedUrl.hostname },
    });
  }

  const response = await fetch(params.fallbackUrl, { headers: buildHeaders() });
  const html = await response.text();
  const parsed = extractTvTruyenContent(html);

  if (!response.ok) {
    return buildInspectionResult({
      fallbackUrl: params.fallbackUrl,
      responseUrl: response.url || params.fallbackUrl,
      pageTitle: parsed.pageTitle,
      canonicalUrl: parsed.canonicalUrl,
      storyTitle: parsed.storyTitle,
      chapterTitle: parsed.chapterTitle,
      chapterNumber: parsed.chapterNumber,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      verdict: "gated_or_unreadable",
      message: `Fallback page returned HTTP ${response.status}.`,
      diagnostics: {
        httpStatus: response.status,
        contentSelectorUsed: parsed.contentSelectorUsed,
        ...parsed.diagnostics,
      },
    });
  }

  return parseTvTruyenFallbackHtml({
    html,
    fallbackUrl: params.fallbackUrl,
    responseUrl: response.url || params.fallbackUrl,
    expectedStoryTitle: params.expectedStoryTitle,
    expectedChapterNumber: params.expectedChapterNumber,
    expectedChapterTitle: params.expectedChapterTitle,
  });
}
