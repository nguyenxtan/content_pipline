import { setTimeout as sleep } from "node:timers/promises";
import { CheerioCrawler, RequestQueue } from "crawlee";
import { db } from "@/lib/db";
import { storySources } from "@/lib/db/schema";
import {
  detectBlockedOrCloudflare,
  getChapterParseFailureDiagnostics,
  parseCatalogPage,
  parseChapterPage,
  parseStoryChapterListPage,
  parseStoryDetailPage,
  TRUYENFULL_TODAY_SITE,
} from "@/lib/story-library/parsers/truyenfull-today";
import { extractDbErrorDetails, storyCrawlerLog, stringifyError } from "@/lib/story-library/logger";
import {
  listQueuedStorySourceChapters,
  listStorySourcesForResumeWithFilters,
  markStorySourceChapterStatus,
  markStorySourceStatus,
  refreshStorySourceStats,
  saveStorySourceChapterContent,
  upsertStorySource,
  upsertStorySourceChapters,
} from "@/lib/story-library/repository";
import {
  createStoryCrawlerEvent,
  incrementStoryCrawlerRunCounters,
  updateStoryCrawlerRun,
} from "@/lib/story-library/tracker";
import type {
  CrawlStoriesOptions,
  CrawlStoryChaptersOptions,
  CrawlStoryOptions,
  ParsedCatalogStory,
  ParsedStoryChapterRef,
  ParsedStoryDetail,
  ResumeStoryCrawlOptions,
} from "@/lib/story-library/types";
import { eq } from "drizzle-orm";

async function logCrawlerEvent(
  eventType: string,
  payload?: Record<string, unknown>,
  options?: {
    level?: "info" | "warn" | "error";
    message?: string;
    storyId?: string | null;
    chapterId?: string | null;
    url?: string | null;
  }
) {
  storyCrawlerLog(eventType, payload);
  await createStoryCrawlerEvent({
    eventType,
    level: options?.level,
    message: options?.message ?? eventType,
    storyId: options?.storyId,
    chapterId: options?.chapterId,
    url: options?.url ?? (typeof payload?.url === "string" ? payload.url : null),
    metadata: payload ?? null,
  });
}

const DEFAULT_MIN_DELAY_MS = 1500;
const DEFAULT_MAX_DELAY_MS = 3000;
const DEFAULT_TIMEOUT_SECS = 30;
const DEFAULT_RETRIES = 2;
const DEFAULT_MAX_CONCURRENCY = 1;
const MAX_ALLOWED_CONCURRENCY = 2;

function clampConcurrency(value?: number) {
  return Math.min(Math.max(value ?? DEFAULT_MAX_CONCURRENCY, 1), MAX_ALLOWED_CONCURRENCY);
}

function buildCrawlerOptions(options?: {
  minDelayMs?: number;
  maxDelayMs?: number;
  maxConcurrency?: number;
  requestTimeoutSecs?: number;
  maxRequestRetries?: number;
}) {
  return {
    minDelayMs: options?.minDelayMs ?? DEFAULT_MIN_DELAY_MS,
    maxDelayMs: options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    maxConcurrency: clampConcurrency(options?.maxConcurrency),
    requestTimeoutSecs: options?.requestTimeoutSecs ?? DEFAULT_TIMEOUT_SECS,
    maxRequestRetries: options?.maxRequestRetries ?? DEFAULT_RETRIES,
  };
}

async function randomDelay(minDelayMs: number, maxDelayMs: number) {
  const duration = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
  await sleep(duration);
}

function buildStoryPageUrl(sourceUrl: string, pageNumber: number) {
  return pageNumber <= 1 ? sourceUrl : `${sourceUrl.replace(/\/$/, "")}/trang-${pageNumber}/`;
}

function buildFailedRequestPayload(request: { url: string; loadedUrl?: string | null }, error: unknown, extra?: Record<string, unknown>) {
  const diagnostics = getChapterParseFailureDiagnostics(error);
  const dbError = extractDbErrorDetails(error);
  return {
    ...extra,
    url: request.url,
    responseUrl: request.loadedUrl ?? request.url,
    error: stringifyError(error),
    ...(diagnostics ? { diagnostics } : {}),
    ...(dbError ? { dbError } : {}),
  };
}

export async function crawlStoryCatalog(options: CrawlStoriesOptions) {
  if (options.site !== TRUYENFULL_TODAY_SITE) {
    throw new Error(`Unsupported site: ${options.site}`);
  }

  const crawlerOptions = buildCrawlerOptions(options);
  const queue = await RequestQueue.open(`story-library-catalog-${Date.now()}`);
  const discoveredStories = new Map<string, ParsedCatalogStory>();
  const enqueuedPages = new Set<string>();
  let reachedLimit = false;

  const enqueuePage = async (url: string) => {
    if (enqueuedPages.has(url)) return;
    enqueuedPages.add(url);
    await queue.addRequest({ url });
  };

  await enqueuePage("https://truyenfull.today/danh-sach/truyen-moi/");

  const crawler = new CheerioCrawler({
    requestQueue: queue,
    maxConcurrency: crawlerOptions.maxConcurrency,
    requestHandlerTimeoutSecs: crawlerOptions.requestTimeoutSecs,
    maxRequestRetries: crawlerOptions.maxRequestRetries,
    preNavigationHooks: [
      async () => {
        await randomDelay(crawlerOptions.minDelayMs, crawlerOptions.maxDelayMs);
      },
    ],
    failedRequestHandler: async ({ request }, error) => {
      await updateStoryCrawlerRun({ currentUrl: request.url });
      await logCrawlerEvent("failed_request", buildFailedRequestPayload(request, error), {
        level: "error",
        message: stringifyError(error),
        url: request.url,
      });
    },
    requestHandler: async ({ request, body }) => {
      await updateStoryCrawlerRun({ currentUrl: request.url });
      if (reachedLimit) return;

      const html = body.toString();
      const blocked = detectBlockedOrCloudflare(html);
      if (blocked) {
        await logCrawlerEvent("blocked_or_cloudflare_detected", { url: request.url, reason: blocked }, {
          level: "warn",
          message: blocked,
          url: request.url,
        });
        throw new Error(blocked);
      }

      const { stories, nextPageUrl } = parseCatalogPage(html, request.url);
      for (const story of stories) {
        if (discoveredStories.has(story.sourceUrl)) {
          await incrementStoryCrawlerRunCounters({ skippedDuplicates: 1 });
          await logCrawlerEvent("skipped_duplicate", { sourceUrl: story.sourceUrl }, {
            level: "info",
            message: "Duplicate story skipped",
            url: story.sourceUrl,
          });
          continue;
        }

        discoveredStories.set(story.sourceUrl, story);
        await logCrawlerEvent("discovered_story", { title: story.title, sourceUrl: story.sourceUrl }, {
          level: "info",
          message: story.title,
          url: story.sourceUrl,
        });
        if (discoveredStories.size >= (options.limitStories ?? 20)) {
          reachedLimit = true;
          break;
        }
      }

      if (!reachedLimit && nextPageUrl) {
        await enqueuePage(nextPageUrl);
      }
    },
  });

  await crawler.run();

  if (options.dryRun) {
    await logCrawlerEvent("crawl_complete", {
      mode: "stories",
      discoveredStories: discoveredStories.size,
      dryRun: true,
    }, {
      message: "Catalog dry run complete",
    });
    return {
      stories: Array.from(discoveredStories.values()),
      savedStories: [],
    };
  }

  const savedStories = [];
  for (const story of discoveredStories.values()) {
    await updateStoryCrawlerRun({
      currentStoryTitle: story.title,
      currentUrl: story.sourceUrl,
    });
    try {
      const saved = await crawlSingleStory({
        ...options,
        storyUrl: story.sourceUrl,
        dryRun: false,
      });
      savedStories.push(saved);
    } catch (error) {
      await logCrawlerEvent("failed_request", buildFailedRequestPayload({ url: story.sourceUrl }, error, {
        mode: "stories",
      }), {
        level: "error",
        message: stringifyError(error),
        url: story.sourceUrl,
      });
    }
  }

  await logCrawlerEvent("crawl_complete", {
    mode: "stories",
    discoveredStories: discoveredStories.size,
    savedStories: savedStories.length,
  }, {
    message: "Catalog crawl complete",
  });

  return {
    stories: Array.from(discoveredStories.values()),
    savedStories,
  };
}

export async function crawlSingleStory(options: CrawlStoryOptions) {
  if (options.site !== TRUYENFULL_TODAY_SITE) {
    throw new Error(`Unsupported site: ${options.site}`);
  }

  const crawlerOptions = buildCrawlerOptions(options);
  const queue = await RequestQueue.open(`story-library-story-${Date.now()}`);
  const chapterMap = new Map<string, ParsedStoryChapterRef>();
  let detail: ParsedStoryDetail | null = null;

  await queue.addRequest({
    url: options.storyUrl,
    userData: {
      kind: "detail",
      pageNumber: 1,
    },
  });

  const crawler = new CheerioCrawler({
    requestQueue: queue,
    maxConcurrency: crawlerOptions.maxConcurrency,
    requestHandlerTimeoutSecs: crawlerOptions.requestTimeoutSecs,
    maxRequestRetries: crawlerOptions.maxRequestRetries,
    preNavigationHooks: [
      async () => {
        await randomDelay(crawlerOptions.minDelayMs, crawlerOptions.maxDelayMs);
      },
    ],
    failedRequestHandler: async ({ request }, error) => {
      await updateStoryCrawlerRun({ currentUrl: request.url });
      await logCrawlerEvent("failed_request", buildFailedRequestPayload(request, error), {
        level: "error",
        message: stringifyError(error),
        url: request.url,
      });
    },
    requestHandler: async ({ request, body }) => {
      await updateStoryCrawlerRun({ currentUrl: request.url });
      const html = body.toString();
      const blocked = detectBlockedOrCloudflare(html);
      if (blocked) {
        await logCrawlerEvent("blocked_or_cloudflare_detected", { url: request.url, reason: blocked }, {
          level: "warn",
          message: blocked,
          url: request.url,
        });
        throw new Error(blocked);
      }

      if (request.userData.pageNumber === 1) {
        detail = parseStoryDetailPage(html, request.url);
        await updateStoryCrawlerRun({
          currentStoryTitle: detail.title,
          currentUrl: detail.sourceUrl,
        });
        for (const chapter of detail.chapters) {
          chapterMap.set(chapter.chapterUrl, chapter);
        }

        for (let pageNumber = 2; pageNumber <= detail.chapterPageCount; pageNumber += 1) {
          await queue.addRequest({
            url: buildStoryPageUrl(detail.sourceUrl, pageNumber),
            userData: {
              kind: "chapters",
              pageNumber,
            },
          });
        }
      } else {
        for (const chapter of parseStoryChapterListPage(html, request.url)) {
          chapterMap.set(chapter.chapterUrl, chapter);
        }
      }
    },
  });

  try {
    await crawler.run();
  } catch (error) {
    const lastError = stringifyError(error);
    if (!options.dryRun) {
      const existing = await db.query.storySources.findFirst({
        where: eq(storySources.sourceUrl, options.storyUrl),
      });
      if (existing) {
        await markStorySourceStatus(existing.id, "failed", lastError);
      }
    }
    throw error;
  }

  if (!detail) {
    throw new Error("Story detail could not be parsed");
  }

  const chapters = Array.from(chapterMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber);
  const finalDetail: ParsedStoryDetail = {
    ...detail,
    chapterCount: chapters.length,
    chapters,
  };

  if (options.dryRun) {
    await logCrawlerEvent("crawl_complete", {
      mode: "story",
      sourceUrl: finalDetail.sourceUrl,
      chapterCount: finalDetail.chapterCount,
      dryRun: true,
    }, {
      message: "Story dry run complete",
      url: finalDetail.sourceUrl,
    });
    return finalDetail;
  }

  await incrementStoryCrawlerRunCounters({ attemptedStories: 1 });
  await updateStoryCrawlerRun({
    currentStoryTitle: finalDetail.title,
    currentUrl: finalDetail.sourceUrl,
  });
  const savedStory = await upsertStorySource({
    detail: finalDetail,
    crawlStatus: "queued",
    touchLastCrawledAt: true,
  });
  await updateStoryCrawlerRun({
    currentStoryId: savedStory.id,
    currentStoryTitle: savedStory.title,
    currentUrl: finalDetail.sourceUrl,
  });
  await logCrawlerEvent("updated_story", {
    storyId: savedStory.id,
    title: savedStory.title,
    chapterCount: finalDetail.chapterCount,
  }, {
    message: savedStory.title,
    storyId: savedStory.id,
    url: finalDetail.sourceUrl,
  });

  const chapterUpsertOutcome = await upsertStorySourceChapters(savedStory.id, chapters);
  for (const chapter of chapters) {
    await logCrawlerEvent("queued_chapter", {
      storyId: savedStory.id,
      chapterNumber: chapter.chapterNumber,
      chapterUrl: chapter.chapterUrl,
    }, {
      message: chapter.chapterTitle || `Chapter ${chapter.chapterNumber}`,
      storyId: savedStory.id,
      url: chapter.chapterUrl,
    });
  }

  for (const renumbered of chapterUpsertOutcome.renumbered) {
    await logCrawlerEvent("chapter_number_renumbered", {
      storyId: savedStory.id,
      chapterUrl: renumbered.chapterUrl,
      originalChapterNumber: renumbered.originalChapterNumber,
      assignedChapterNumber: renumbered.assignedChapterNumber,
    }, {
      level: "warn",
      message: `Chapter number ${renumbered.originalChapterNumber} already used for this story; reassigned ${renumbered.chapterUrl} to ${renumbered.assignedChapterNumber}`,
      storyId: savedStory.id,
      url: renumbered.chapterUrl,
    });
  }

  for (const skipped of chapterUpsertOutcome.skipped) {
    await logCrawlerEvent("skipped_malformed_chapter", {
      storyId: savedStory.id,
      chapterUrl: skipped.chapterUrl,
      chapterNumber: skipped.chapterNumber,
      reason: skipped.reason,
    }, {
      level: "warn",
      message: `Skipped chapter link that could not be inserted: ${skipped.reason}`,
      storyId: savedStory.id,
      url: skipped.chapterUrl,
    });
  }

  await refreshStorySourceStats(savedStory.id);
  await logCrawlerEvent("crawl_complete", {
    mode: "story",
    storyId: savedStory.id,
    sourceUrl: finalDetail.sourceUrl,
    chapterCount: chapters.length,
  }, {
    message: "Story crawl complete",
    storyId: savedStory.id,
    url: finalDetail.sourceUrl,
  });

  return savedStory;
}

export async function crawlStoryChapters(options: CrawlStoryChaptersOptions) {
  const story = await db.query.storySources.findFirst({
    where: eq(storySources.id, options.storyId),
  });
  if (!story) {
    throw new Error(`Story not found: ${options.storyId}`);
  }

  const chapters = await listQueuedStorySourceChapters(options.storyId, options.limitChapters);
  if (chapters.length === 0) {
    await logCrawlerEvent("crawl_complete", {
      mode: "story-chapters",
      storyId: options.storyId,
      crawledChapters: 0,
    }, {
      message: "No chapters queued",
      storyId: options.storyId,
    });
    return { story, crawledChapters: 0 };
  }

  const crawlerOptions = buildCrawlerOptions(options);
  const queue = await RequestQueue.open(`story-library-chapters-${Date.now()}`);
  const chapterByUrl = new Map(chapters.map((chapter) => [chapter.chapterUrl, chapter]));
  let failedChapters = 0;

  for (const chapter of chapters) {
    await incrementStoryCrawlerRunCounters({ attemptedChapters: 1 });
    await markStorySourceChapterStatus(chapter.id, "crawling");
    await updateStoryCrawlerRun({
      currentStoryId: story.id,
      currentStoryTitle: story.title,
      currentChapterId: chapter.id,
      currentChapterTitle: chapter.chapterTitle ?? `Chương ${chapter.chapterNumber}`,
      currentUrl: chapter.chapterUrl,
    });
    await queue.addRequest({
      url: chapter.chapterUrl,
      userData: {
        chapterId: chapter.id,
      },
    });
  }

  await markStorySourceStatus(options.storyId, "crawling");

  const crawler = new CheerioCrawler({
    requestQueue: queue,
    maxConcurrency: crawlerOptions.maxConcurrency,
    requestHandlerTimeoutSecs: crawlerOptions.requestTimeoutSecs,
    maxRequestRetries: crawlerOptions.maxRequestRetries,
    preNavigationHooks: [
      async () => {
        await randomDelay(crawlerOptions.minDelayMs, crawlerOptions.maxDelayMs);
      },
    ],
    failedRequestHandler: async ({ request }, error) => {
      const chapter = chapterByUrl.get(request.url);
      failedChapters += 1;
      await incrementStoryCrawlerRunCounters({ failedChapters: 1 });
      await updateStoryCrawlerRun({
        currentUrl: request.url,
        currentChapterId: chapter?.id ?? null,
        currentChapterTitle: chapter?.chapterTitle ?? null,
        lastError: stringifyError(error),
      });
      await logCrawlerEvent("failed_request", buildFailedRequestPayload(request, error, {
        chapterId: chapter?.id ?? null,
      }), {
        level: "error",
        message: stringifyError(error),
        storyId: story.id,
        chapterId: chapter?.id ?? null,
        url: request.url,
      });
      if (chapter) {
        await markStorySourceChapterStatus(chapter.id, "failed", stringifyError(error));
      }
    },
    requestHandler: async ({ request, body }) => {
      const chapter = chapterByUrl.get(request.url);
      if (!chapter) return;
      await updateStoryCrawlerRun({
        currentStoryId: story.id,
        currentStoryTitle: story.title,
        currentChapterId: chapter.id,
        currentChapterTitle: chapter.chapterTitle ?? `Chương ${chapter.chapterNumber}`,
        currentUrl: request.url,
      });

      const html = body.toString();
      const blocked = detectBlockedOrCloudflare(html);
      if (blocked) {
        failedChapters += 1;
        await incrementStoryCrawlerRunCounters({ failedChapters: 1 });
        await updateStoryCrawlerRun({ lastError: blocked });
        await logCrawlerEvent("blocked_or_cloudflare_detected", { url: request.url, reason: blocked }, {
          level: "warn",
          message: blocked,
          storyId: story.id,
          chapterId: chapter.id,
          url: request.url,
        });
        await markStorySourceChapterStatus(chapter.id, "failed", blocked);
        throw new Error(blocked);
      }

      const parsed = parseChapterPage(html);
      await saveStorySourceChapterContent({
        chapterId: chapter.id,
        chapterTitle: parsed.chapterTitle || chapter.chapterTitle || `Chương ${chapter.chapterNumber}`,
        chapterNumber: parsed.chapterNumber || chapter.chapterNumber,
        contentText: parsed.contentText,
        wordCount: parsed.wordCount,
      });

      await incrementStoryCrawlerRunCounters({ succeededChapters: 1 });
      await logCrawlerEvent("crawled_chapter", {
        storyId: options.storyId,
        chapterId: chapter.id,
        chapterNumber: parsed.chapterNumber || chapter.chapterNumber,
        wordCount: parsed.wordCount,
      }, {
        message: parsed.chapterTitle || chapter.chapterTitle || `Chapter ${chapter.chapterNumber}`,
        storyId: options.storyId,
        chapterId: chapter.id,
        url: request.url,
      });
    },
  });

  await crawler.run();
  const updatedStory = await refreshStorySourceStats(options.storyId);

  if (failedChapters > 0 && updatedStory) {
    await markStorySourceStatus(options.storyId, updatedStory.crawlStatus as "queued" | "crawling" | "done" | "partial" | "failed", updatedStory.lastError);
  }

  await logCrawlerEvent("crawl_complete", {
    mode: "story-chapters",
    storyId: options.storyId,
    crawledChapters: chapters.length - failedChapters,
    failedChapters,
  }, {
    message: "Chapter crawl complete",
    storyId: options.storyId,
  });

  return {
    story: updatedStory ?? story,
    crawledChapters: chapters.length - failedChapters,
    failedChapters,
  };
}

export async function resumeStoryLibraryCrawls(options: ResumeStoryCrawlOptions) {
  const stories = await listStorySourcesForResumeWithFilters({
    sourceSite: options.sourceSite ?? options.site,
    failedOnly: options.failedOnly,
  });
  const resumed = [];
  const maxStories = Math.max(options.maxStories ?? stories.length, 0);
  let remainingChapterBudget = Math.max(options.maxChapters ?? Number.MAX_SAFE_INTEGER, 0);
  let attemptedChapters = 0;

  for (const story of stories) {
    if (resumed.length >= maxStories) break;
    await updateStoryCrawlerRun({
      currentStoryId: story.id,
      currentStoryTitle: story.title,
      currentUrl: story.sourceUrl,
    });

    try {
      await crawlSingleStory({
        ...options,
        storyUrl: story.sourceUrl,
        dryRun: false,
      });
    } catch (error) {
      await logCrawlerEvent("failed_request", buildFailedRequestPayload({ url: story.sourceUrl }, error, {
        mode: "resume",
        storyId: story.id,
      }), {
        level: "error",
        message: stringifyError(error),
        storyId: story.id,
        url: story.sourceUrl,
      });
      continue;
    }

    let chapterResult = {
      story,
      crawledChapters: 0,
      failedChapters: 0,
    };

    if (remainingChapterBudget > 0) {
      try {
        chapterResult = await crawlStoryChapters({
          ...options,
          storyId: story.id,
          limitChapters: Math.min(remainingChapterBudget, options.maxChapters ?? remainingChapterBudget),
        });
        const attemptedForStory = chapterResult.crawledChapters + (chapterResult.failedChapters ?? 0);
        attemptedChapters += attemptedForStory;
        remainingChapterBudget = Math.max(remainingChapterBudget - attemptedForStory, 0);
      } catch (error) {
        await logCrawlerEvent("failed_request", buildFailedRequestPayload({ url: story.sourceUrl }, error, {
          mode: "resume",
          storyId: story.id,
        }), {
          level: "error",
          message: stringifyError(error),
          storyId: story.id,
          url: story.sourceUrl,
        });
      }
    }

    resumed.push({
      storyId: story.id,
      chapterResult,
    });

    if (remainingChapterBudget === 0) break;
  }

  await logCrawlerEvent("crawl_complete", {
    mode: "resume",
    resumedStories: resumed.length,
    attemptedChapters,
    remainingChapterBudget: Number.isFinite(remainingChapterBudget) ? remainingChapterBudget : null,
    failedOnly: options.failedOnly ?? false,
    sourceSite: options.sourceSite ?? options.site,
  }, {
    message: "Resume crawl complete",
  });

  return resumed;
}
