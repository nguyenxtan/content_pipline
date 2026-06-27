import { load } from "cheerio";
import type { StoryLibraryFallbackInspectionVerdict } from "@/lib/story-library/types";
import { cleanInlineText, countWords, extractChapterNumber, normalizeParagraphText } from "@/lib/story-library/text";

export const WEBTRUYENDICH_SITE = "webtruyendich.com";
const MIN_FALLBACK_WORDS = 30;
const DEFAULT_TRANSLATOR = "Google Translate";
const GATED_PATTERNS = [
  "captcha",
  "turnstile",
  "đăng nhập",
  "dang nhap",
  "vui lòng đăng nhập",
  "please login",
  "rate limit",
  "quota exceeded",
  "no apikey",
] as const;
const PLACEHOLDER_PATTERNS = [
  "ai loading",
  "chapter error",
  "load failed",
  "loading...",
  "unexpected token",
  "failed to fetch",
  "the model is overloaded",
  "network error",
  "translate error",
] as const;

type WebTruyenDichShell = {
  pageTitle: string | null;
  canonicalUrl: string | null;
  storyTitle: string | null;
  chapterTitle: string | null;
  chapterNumber: number;
  novelId: string | null;
  sourceId: string | null;
  chapterSlug: string | null;
  streamContainerFound: boolean;
  cloudflareMarkerFound: boolean;
};

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

function extractVarValue(scriptText: string, variableName: string) {
  const match = scriptText.match(new RegExp(`\\b${variableName}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1]?.trim() ?? null;
}

function parseWebTruyenDichShell(html: string, pageUrl: string): WebTruyenDichShell {
  const $ = load(html);
  const scriptText = $("script")
    .toArray()
    .map((element) => $(element).html() ?? "")
    .join("\n");

  const pageTitle = cleanInlineText($("title").first().text()) || null;
  const canonicalUrl = $("link[rel='canonical']").attr("href") ?? pageUrl;
  const storyTitle =
    cleanInlineText($("script[type='application/ld+json']").toArray().map((element) => $(element).html() ?? "").join("\n").match(/"isPartOf"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]+)"/)?.[1] ?? "") ||
    cleanInlineText(extractVarValue(scriptText, "chapterNovelTitle")) ||
    null;
  const chapterTitle = cleanInlineText($("#chapter-title").first().text()) || null;

  return {
    pageTitle,
    canonicalUrl,
    storyTitle,
    chapterTitle,
    chapterNumber: extractChapterNumber(chapterTitle ?? pageTitle ?? ""),
    novelId: extractVarValue(scriptText, "novel_id"),
    sourceId: extractVarValue(scriptText, "sourceId"),
    chapterSlug: extractVarValue(scriptText, "chapterUrl"),
    streamContainerFound: $("#chapter-content-body #stream-spinner").length > 0,
    cloudflareMarkerFound: normalizeLower(html).includes("cf-turnstile"),
  };
}

export function parseWebTruyenDichFallbackApiResponse(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Fallback API payload is not an object");
  }

  const row = payload as Record<string, unknown>;
  const contentHtml = typeof row.content === "string" ? row.content : "";
  const title = typeof row.title === "string" ? cleanInlineText(row.title) : "";
  const chapterUrl = typeof row.chapter_url === "string" ? row.chapter_url : null;
  const contentText = normalizeParagraphText(
    load(`<div>${contentHtml.replace(/<\s*br\s*\/?>/gi, "\n")}</div>`)
      .root()
      .text()
      .split(/\n+/)
  );

  return {
    chapterTitle: title || null,
    chapterNumber: extractChapterNumber(title),
    chapterUrl,
    contentText,
    wordCount: countWords(contentText),
    contentLength: contentText.length,
  };
}

function classifyTextVerdict(text: string) {
  const lower = normalizeLower(text);
  if (GATED_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return "gated_or_unreadable" as const;
  }
  if (!text || PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return "empty_or_placeholder" as const;
  }
  if (countWords(text) < MIN_FALLBACK_WORDS) {
    return "empty_or_placeholder" as const;
  }
  return "valid_fallback" as const;
}

function buildHeaders() {
  return {
    "accept": "text/html,application/json",
    "accept-language": "vi,en;q=0.8",
    "user-agent": "Mozilla/5.0 (compatible; StoryLibraryBot/1.0; +https://localhost/story-library)",
  };
}

export async function inspectWebTruyenDichFallback(params: {
  fallbackUrl: string;
  expectedStoryTitle?: string | null;
  expectedChapterNumber?: number | null;
  expectedChapterTitle?: string | null;
}) : Promise<StoryLibraryFallbackInspection> {
  const parsedUrl = new URL(params.fallbackUrl);
  if (parsedUrl.hostname !== WEBTRUYENDICH_SITE) {
    return {
      verdict: "gated_or_unreadable",
      fallbackSourceSite: WEBTRUYENDICH_SITE,
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
      message: `Only ${WEBTRUYENDICH_SITE} fallback URLs are supported right now.`,
      diagnostics: {
        hostname: parsedUrl.hostname,
      },
    };
  }

  const pageResponse = await fetch(params.fallbackUrl, {
    headers: buildHeaders(),
  });
  const pageHtml = await pageResponse.text();
  const shell = parseWebTruyenDichShell(pageHtml, pageResponse.url || params.fallbackUrl);

  if (!pageResponse.ok) {
    return {
      verdict: "gated_or_unreadable",
      fallbackSourceSite: WEBTRUYENDICH_SITE,
      fallbackUrl: params.fallbackUrl,
      responseUrl: pageResponse.url || params.fallbackUrl,
      pageTitle: shell.pageTitle,
      canonicalUrl: shell.canonicalUrl,
      storyTitle: shell.storyTitle,
      chapterTitle: shell.chapterTitle,
      chapterNumber: shell.chapterNumber,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      message: `Fallback page returned HTTP ${pageResponse.status}.`,
      diagnostics: {
        httpStatus: pageResponse.status,
      },
    };
  }

  const pageLower = normalizeLower(pageHtml);
  if (GATED_PATTERNS.some((pattern) => pageLower.includes(pattern)) && !shell.streamContainerFound) {
    return {
      verdict: "gated_or_unreadable",
      fallbackSourceSite: WEBTRUYENDICH_SITE,
      fallbackUrl: params.fallbackUrl,
      responseUrl: pageResponse.url || params.fallbackUrl,
      pageTitle: shell.pageTitle,
      canonicalUrl: shell.canonicalUrl,
      storyTitle: shell.storyTitle,
      chapterTitle: shell.chapterTitle,
      chapterNumber: shell.chapterNumber,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      message: "Fallback page looks gated or unreadable.",
      diagnostics: {
        streamContainerFound: shell.streamContainerFound,
        cloudflareMarkerFound: shell.cloudflareMarkerFound,
      },
    };
  }

  if (!shell.novelId || !shell.sourceId || !shell.chapterSlug) {
    return {
      verdict: "parser_needed",
      fallbackSourceSite: WEBTRUYENDICH_SITE,
      fallbackUrl: params.fallbackUrl,
      responseUrl: pageResponse.url || params.fallbackUrl,
      pageTitle: shell.pageTitle,
      canonicalUrl: shell.canonicalUrl,
      storyTitle: shell.storyTitle,
      chapterTitle: shell.chapterTitle,
      chapterNumber: shell.chapterNumber,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      message: "Fallback page shell is missing chapter loader variables.",
      diagnostics: shell,
    };
  }

  const apiResponse = await fetch(`https://${WEBTRUYENDICH_SITE}/api/getChapter`, {
    method: "POST",
    headers: {
      ...buildHeaders(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      novel_id: shell.novelId,
      source_id: shell.sourceId,
      chapter_url: shell.chapterSlug,
      translator: DEFAULT_TRANSLATOR,
    }),
  });
  const apiText = await apiResponse.text();
  let apiPayload: unknown = null;
  try {
    apiPayload = JSON.parse(apiText);
  } catch {
    return {
      verdict: "parser_needed",
      fallbackSourceSite: WEBTRUYENDICH_SITE,
      fallbackUrl: params.fallbackUrl,
      responseUrl: apiResponse.url || pageResponse.url || params.fallbackUrl,
      pageTitle: shell.pageTitle,
      canonicalUrl: shell.canonicalUrl,
      storyTitle: shell.storyTitle,
      chapterTitle: shell.chapterTitle,
      chapterNumber: shell.chapterNumber,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      message: "Fallback chapter API did not return JSON.",
      diagnostics: {
        apiStatus: apiResponse.status,
      },
    };
  }

  if (!apiResponse.ok) {
    const detail =
      apiPayload && typeof apiPayload === "object" && !Array.isArray(apiPayload) && typeof (apiPayload as Record<string, unknown>).detail === "string"
        ? String((apiPayload as Record<string, unknown>).detail)
        : `Fallback chapter API returned HTTP ${apiResponse.status}.`;
    return {
      verdict: "gated_or_unreadable",
      fallbackSourceSite: WEBTRUYENDICH_SITE,
      fallbackUrl: params.fallbackUrl,
      responseUrl: apiResponse.url || pageResponse.url || params.fallbackUrl,
      pageTitle: shell.pageTitle,
      canonicalUrl: shell.canonicalUrl,
      storyTitle: shell.storyTitle,
      chapterTitle: shell.chapterTitle,
      chapterNumber: shell.chapterNumber,
      contentText: null,
      wordCount: 0,
      contentLength: 0,
      message: detail,
      diagnostics: {
        apiStatus: apiResponse.status,
      },
    };
  }

  const parsed = parseWebTruyenDichFallbackApiResponse(apiPayload);
  const titleMismatch = params.expectedChapterNumber
    ? parsed.chapterNumber !== params.expectedChapterNumber
    : false;
  const storyMismatch = params.expectedStoryTitle
    ? normalizeLower(shell.storyTitle) !== normalizeLower(params.expectedStoryTitle)
    : false;
  const verdict = classifyTextVerdict(parsed.contentText);

  if (storyMismatch || titleMismatch) {
    return {
      verdict: "wrong_story_or_chapter",
      fallbackSourceSite: WEBTRUYENDICH_SITE,
      fallbackUrl: params.fallbackUrl,
      responseUrl: apiResponse.url || pageResponse.url || params.fallbackUrl,
      pageTitle: shell.pageTitle,
      canonicalUrl: shell.canonicalUrl,
      storyTitle: shell.storyTitle,
      chapterTitle: parsed.chapterTitle ?? shell.chapterTitle,
      chapterNumber: parsed.chapterNumber || shell.chapterNumber,
      contentText: null,
      wordCount: parsed.wordCount,
      contentLength: parsed.contentLength,
      message: "Fallback content does not match the expected story or chapter number.",
      diagnostics: {
        expectedStoryTitle: params.expectedStoryTitle ?? null,
        expectedChapterNumber: params.expectedChapterNumber ?? null,
        extractedStoryTitle: shell.storyTitle,
        extractedChapterNumber: parsed.chapterNumber || shell.chapterNumber,
      },
    };
  }

  return {
    verdict,
    fallbackSourceSite: WEBTRUYENDICH_SITE,
    fallbackUrl: params.fallbackUrl,
    responseUrl: apiResponse.url || pageResponse.url || params.fallbackUrl,
    pageTitle: shell.pageTitle,
    canonicalUrl: shell.canonicalUrl,
    storyTitle: shell.storyTitle,
    chapterTitle: parsed.chapterTitle ?? shell.chapterTitle,
    chapterNumber: parsed.chapterNumber || shell.chapterNumber,
    contentText: verdict === "valid_fallback" ? parsed.contentText : null,
    wordCount: parsed.wordCount,
    contentLength: parsed.contentLength,
    message:
      verdict === "valid_fallback"
        ? `Valid fallback content found (${parsed.wordCount} words).`
        : verdict === "empty_or_placeholder"
          ? "Fallback page returned empty or placeholder content."
          : "Fallback page needs parser follow-up.",
    diagnostics: {
      apiStatus: apiResponse.status,
      streamContainerFound: shell.streamContainerFound,
      cloudflareMarkerFound: shell.cloudflareMarkerFound,
      expectedChapterTitle: params.expectedChapterTitle ?? null,
      extractedChapterUrl: parsed.chapterUrl,
    },
  };
}
