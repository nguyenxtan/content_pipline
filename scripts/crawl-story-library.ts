import { crawlSingleStory, crawlStoryCatalog, crawlStoryChapters, resumeStoryLibraryCrawls } from "@/lib/story-library/crawler";
import { storyCrawlerLog } from "@/lib/story-library/logger";
import type { StoryCrawlerRunMode, StoryLibrarySite } from "@/lib/story-library/types";
import { acquireJobLock, releaseJobLock } from "@/lib/ops/job-lock";
import path from "node:path";
import {
  createSkippedOverlapRun,
  createStoryCrawlerEvent,
  finishStoryCrawlerRun,
  startStoryCrawlerRun,
} from "@/lib/story-library/tracker";

const STORY_LIBRARY_LOCK_PATH = path.join(process.cwd(), "tmp", "story-library-crawl.lock");

function parseArgs(argv: string[]) {
  const [mode, ...rest] = argv;
  const args = new Map<string, string | boolean>();

  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
      continue;
    }
    args.set(key, next);
    index += 1;
  }

  return { mode, args };
}

function getString(args: Map<string, string | boolean>, key: string) {
  const value = args.get(key);
  return typeof value === "string" ? value : undefined;
}

function getNumber(args: Map<string, string | boolean>, key: string) {
  const value = getString(args, key);
  return value ? Number.parseInt(value, 10) : undefined;
}

function toRunMode(mode: string, args: Map<string, string | boolean>): StoryCrawlerRunMode {
  if (mode === "stories") return "catalog";
  if (mode === "story") return "story";
  if (mode === "story-chapters") return "chapters";
  if (mode === "resume") {
    return args.get("failed-only") === true ? "retry_failed" : "resume";
  }
  throw new Error(`Unsupported mode: ${mode}`);
}

async function main() {
  const { mode, args } = parseArgs(process.argv.slice(2));
  const site = (getString(args, "site") ?? "truyenfull.today") as StoryLibrarySite;
  const sourceSite = (getString(args, "source-site") ?? site) as StoryLibrarySite;
  const dryRun = args.get("dry-run") === true;
  const maxConcurrency = getNumber(args, "concurrency");

  if (!mode) {
    throw new Error("Mode is required: stories | story | story-chapters | resume");
  }

  const runMode = toRunMode(mode, args);
  const lockResult = acquireJobLock(STORY_LIBRARY_LOCK_PATH, { mode: runMode });
  if (!lockResult.acquired) {
    storyCrawlerLog("skipped_overlap", {
      reason: lockResult.reason,
      mode,
    });
    await createSkippedOverlapRun({
      mode: runMode,
      sourceSite,
      reason: lockResult.reason,
    });
    return;
  }

  await startStoryCrawlerRun({
    mode: runMode,
    sourceSite,
  });

  if (lockResult.replacedStale) {
    storyCrawlerLog("stale_lock_replaced", {
      mode,
      reason: lockResult.replacedStale.reason,
      previousPid: lockResult.replacedStale.previous?.pid ?? null,
      previousStartedAt: lockResult.replacedStale.previous?.startedAt ?? null,
      previousMode: lockResult.replacedStale.previous?.mode ?? null,
    });
    await createStoryCrawlerEvent({
      eventType: "stale_lock_replaced",
      level: "warn",
      message: lockResult.replacedStale.reason,
      metadata: {
        mode,
        previousPid: lockResult.replacedStale.previous?.pid ?? null,
        previousStartedAt: lockResult.replacedStale.previous?.startedAt ?? null,
        previousMode: lockResult.replacedStale.previous?.mode ?? null,
      },
    });
  }

  let runCompleted = false;
  try {
  if (mode === "stories") {
    const result = await crawlStoryCatalog({
      site,
      dryRun,
      maxConcurrency,
      limitStories: getNumber(args, "limit-stories"),
    });
    storyCrawlerLog("crawl_complete", {
      mode,
      discoveredStories: result.stories.length,
      savedStories: result.savedStories.length,
    });
    runCompleted = true;
    await finishStoryCrawlerRun({ status: "completed" });
    return;
  }

  if (mode === "story") {
    const storyUrl = getString(args, "url");
    if (!storyUrl) throw new Error("--url is required for story mode");

    const result = await crawlSingleStory({
      site,
      storyUrl,
      dryRun,
      maxConcurrency,
    });
    storyCrawlerLog("crawl_complete", {
      mode,
      sourceUrl: "sourceUrl" in result ? result.sourceUrl : null,
    });
    runCompleted = true;
    await finishStoryCrawlerRun({ status: "completed" });
    return;
  }

  if (mode === "story-chapters") {
    const storyId = getString(args, "story-id");
    if (!storyId) throw new Error("--story-id is required for story-chapters mode");

    const result = await crawlStoryChapters({
      storyId,
      maxConcurrency,
      limitChapters: getNumber(args, "limit-chapters"),
    });
    storyCrawlerLog("crawl_complete", {
      mode,
      storyId,
      crawledChapters: result.crawledChapters,
      failedChapters: result.failedChapters ?? 0,
    });
    runCompleted = true;
    await finishStoryCrawlerRun({ status: "completed" });
    return;
  }

  if (mode === "resume") {
    const result = await resumeStoryLibraryCrawls({
      site,
      maxConcurrency,
      sourceSite,
      maxStories: getNumber(args, "max-stories"),
      maxChapters: getNumber(args, "max-chapters"),
      failedOnly: args.get("failed-only") === true,
    });
    storyCrawlerLog("crawl_complete", {
      mode,
      resumedStories: result.length,
    });
    runCompleted = true;
    await finishStoryCrawlerRun({ status: "completed" });
    return;
  }

  throw new Error(`Unsupported mode: ${mode}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await createStoryCrawlerEvent({
      eventType: "failed_request",
      level: "error",
      message,
      metadata: {
        mode,
      },
    });
    await finishStoryCrawlerRun({
      status: "failed",
      lastError: message,
    });
    throw error;
  } finally {
    if (!runCompleted) {
      // no-op when already finished or failed; keeps lock release path simple
    }
    releaseJobLock(STORY_LIBRARY_LOCK_PATH);
  }
}

main().catch((error) => {
  storyCrawlerLog("failed_request", {
    mode: process.argv[2] ?? null,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
