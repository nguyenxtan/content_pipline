import { load, type CheerioAPI } from "cheerio";
import type {
  ParsedCatalogStory,
  ParsedChapterContent,
  ParsedStoryChapterRef,
  ParsedStoryDetail,
  StoryLibrarySite,
} from "@/lib/story-library/types";
import {
  cleanInlineText,
  countWords,
  extractChapterNumber,
  normalizeParagraphText,
  safeSlugFromUrl,
} from "@/lib/story-library/text";

export const TRUYENFULL_TODAY_SITE: StoryLibrarySite = "truyenfull.today";
const MIN_CHAPTER_WORDS = 10;
const SOURCE_MISSING_PATTERNS = [
  "nguồn thiếu chương này, mong độc giả thông cảm",
  "nguon thieu chuong nay, mong doc gia thong cam",
] as const;

export type ChapterParseFailureCode =
  | "chapter_content_not_found"
  | "blocked_or_empty_chapter"
  | "source_missing_chapter"
  | "chapter_not_found_or_redirect";

export type ChapterParseDiagnostics = {
  pageTitle: string | null;
  canonicalUrl: string | null;
  triedSelectors: string[];
  candidateTextLengths: Record<string, number>;
  contentRootFound: boolean;
  unlockReminderFound: boolean;
  sourceMissingFound: boolean;
};

export class StoryLibraryChapterParseError extends Error {
  code: ChapterParseFailureCode;
  diagnostics: ChapterParseDiagnostics;

  constructor(code: ChapterParseFailureCode, diagnostics: ChapterParseDiagnostics) {
    super(code);
    this.name = "StoryLibraryChapterParseError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export function getChapterParseFailureDiagnostics(error: unknown): ChapterParseDiagnostics | null {
  return error instanceof StoryLibraryChapterParseError ? error.diagnostics : null;
}

function absoluteUrl(input: string, baseUrl: string): string {
  return new URL(input, baseUrl).toString();
}

export function detectBlockedOrCloudflare(html: string): string | null {
  const lower = html.toLowerCase();
  if (
    lower.includes("cf-browser-verification") ||
    lower.includes("cloudflare") && lower.includes("just a moment") ||
    lower.includes("attention required")
  ) {
    return "Cloudflare or anti-bot challenge detected";
  }

  return null;
}

export function parseCatalogPage(html: string, pageUrl: string): {
  stories: ParsedCatalogStory[];
  nextPageUrl: string | null;
} {
  const $ = load(html);
  const stories = new Map<string, ParsedCatalogStory>();

  $("#list-page .row[itemscope]").each((_, element) => {
    const anchor = $(element).find(".truyen-title a").first();
    const href = anchor.attr("href");
    const title = cleanInlineText(anchor.text());
    if (!href || !title) return;

    const sourceUrl = absoluteUrl(href, pageUrl);
    stories.set(sourceUrl, {
      title,
      sourceUrl,
      slug: safeSlugFromUrl(sourceUrl),
      author: cleanInlineText($(element).find(".author").text().replace(/^.*?\s/, "")) || null,
      chapterLabel: cleanInlineText($(element).find(".chapter-text").parent().text()) || null,
    });
  });

  const nextHref =
    $('.pagination a[title*="Trang tiếp"]').first().attr("href") ??
    $('.pagination a .glyphicon-menu-right').first().parent().attr("href") ??
    null;

  return {
    stories: Array.from(stories.values()),
    nextPageUrl: nextHref ? absoluteUrl(nextHref, pageUrl).replace(/#list-chapter$/, "") : null,
  };
}

function parseChapterRefs($: CheerioAPI, pageUrl: string): ParsedStoryChapterRef[] {
  const chapters: ParsedStoryChapterRef[] = [];

  $("#list-chapter .list-chapter a").each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href");
    if (!href) return;

    const chapterUrl = absoluteUrl(href, pageUrl).replace(/#.*$/, "");
    const rawTitle = cleanInlineText(anchor.text());
    const chapterNumber = extractChapterNumber(rawTitle);

    chapters.push({
      chapterNumber,
      chapterTitle: rawTitle,
      chapterUrl,
    });
  });

  return chapters;
}

export function parseStoryDetailPage(html: string, pageUrl: string): ParsedStoryDetail {
  const $ = load(html);
  const title = cleanInlineText($(".col-info-desc h3.title[itemprop='name']").first().text());
  if (!title) {
    throw new Error("Story title not found");
  }

  const sourceUrl = absoluteUrl($("link[rel='canonical']").attr("href") ?? pageUrl, pageUrl).replace(/\/trang-\d+\/?$/, "/");
  const slug = safeSlugFromUrl(sourceUrl);
  const author = cleanInlineText($(".info-holder [itemprop='author']").first().text()) || null;
  const genres = $(".info-holder [itemprop='genre']")
    .toArray()
    .map((element) => cleanInlineText($(element).text()))
    .filter(Boolean);
  const status = cleanInlineText($(".info-holder .text-success").first().text()) || null;
  const intro = normalizeParagraphText(
    $(".desc .desc-text")
      .first()
      .find("p")
      .toArray()
      .map((element) => $(element).text())
  ) || null;
  const chapterPageCount = Number.parseInt($("#total-page").attr("value") ?? "1", 10) || 1;
  const chapters = parseChapterRefs($, pageUrl);

  return {
    sourceUrl,
    slug,
    title,
    author,
    genres,
    status,
    intro,
    chapterCount: chapterPageCount > 1 ? Math.max(chapters.length, chapterPageCount * 50) : chapters.length,
    chapterPageCount,
    chapters,
  };
}

export function parseStoryChapterListPage(html: string, pageUrl: string): ParsedStoryChapterRef[] {
  const $ = load(html);
  return parseChapterRefs($, pageUrl);
}

function extractBreakSeparatedChapterText(contentHtml: string) {
  const htmlWithBreaks = contentHtml
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|section|article|blockquote|li|hr)>/gi, "\n");
  const text = load(`<div>${htmlWithBreaks}</div>`).root().text();
  return normalizeParagraphText(text.split(/\n+/));
}

export function parseChapterPage(html: string): ParsedChapterContent {
  const $ = load(html);
  const storyTitle = cleanInlineText($(".chapter .truyen-title").first().text());
  const chapterTitle = cleanInlineText($(".chapter .chapter-title").first().text());
  const chapterNumber = extractChapterNumber(chapterTitle);

  const pageTitle = cleanInlineText($("title").first().text()) || null;
  const canonicalUrl = $("link[rel='canonical']").attr("href") ?? null;
  const contentRoot = $("#chapter-c").first().length
    ? $("#chapter-c").first()
    : $(".chapter-c[itemprop='articleBody'], .chapter .chapter-c").first();
  const diagnostics: ChapterParseDiagnostics = {
    pageTitle,
    canonicalUrl,
    triedSelectors: [
      "#chapter-c p",
      "#chapter-c",
      ".chapter-c[itemprop='articleBody']",
      ".chapter .chapter-c",
    ],
    candidateTextLengths: {},
    contentRootFound: contentRoot.length > 0,
    unlockReminderFound: $("#ads-unlock-reminder").length > 0,
    sourceMissingFound: false,
  };

  contentRoot.find(
    "#ads-chapter-top, #ads-chapter-bottom, script, style, .ads-unlock-container, .ads-unlock-reminder"
  ).remove();

  const paragraphs = contentRoot
    .find("p")
    .toArray()
    .map((element) => $(element).text());
  const paragraphContentText = normalizeParagraphText(paragraphs);
  diagnostics.candidateTextLengths["#chapter-c p"] = paragraphContentText.length;

  const breakContentText = extractBreakSeparatedChapterText(contentRoot.html() ?? "");
  diagnostics.candidateTextLengths["#chapter-c"] = breakContentText.length;

  const contentText = paragraphContentText || breakContentText;
  if (!contentText || countWords(contentText) < MIN_CHAPTER_WORDS) {
    const lowerTitle = pageTitle?.toLowerCase() ?? "";
    const rootText = cleanInlineText(contentRoot.text()).toLowerCase();
    diagnostics.sourceMissingFound = SOURCE_MISSING_PATTERNS.some((pattern) => rootText.includes(pattern));
    const isNotFoundPage =
      !contentRoot.length ||
      lowerTitle.includes("404") ||
      lowerTitle.includes("không tìm thấy") ||
      lowerTitle.includes("khong tim thay") ||
      rootText.includes("không tồn tại") ||
      rootText.includes("khong ton tai");
    const code: ChapterParseFailureCode = isNotFoundPage
      ? "chapter_not_found_or_redirect"
      : diagnostics.sourceMissingFound
        ? "source_missing_chapter"
      : diagnostics.unlockReminderFound
        ? "blocked_or_empty_chapter"
        : "chapter_content_not_found";
    throw new StoryLibraryChapterParseError(code, diagnostics);
  }

  return {
    storyTitle,
    chapterTitle,
    chapterNumber,
    contentText,
    wordCount: countWords(contentText),
  };
}
