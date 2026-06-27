import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { storyCrawlEvents, storyCrawlRuns } from "@/lib/db/schema";
import type { StoryCrawlerEventLevel, StoryCrawlerRunMode, StoryCrawlerRunStatus } from "@/lib/story-library/types";

type ActiveRunContext = {
  runId: string;
  mode: StoryCrawlerRunMode;
  sourceSite: string | null;
};

let activeRun: ActiveRunContext | null = null;

function now() {
  return new Date();
}

export async function startStoryCrawlerRun(params: {
  mode: StoryCrawlerRunMode;
  sourceSite?: string | null;
  status?: StoryCrawlerRunStatus;
  lastError?: string | null;
}) {
  const timestamp = now();
  const [run] = await db
    .insert(storyCrawlRuns)
    .values({
      mode: params.mode,
      sourceSite: params.sourceSite ?? null,
      status: params.status ?? "running",
      startedAt: timestamp,
      heartbeatAt: timestamp,
      finishedAt: params.status && params.status !== "running" ? timestamp : null,
      lastError: params.lastError ?? null,
      updatedAt: timestamp,
    })
    .returning();

  if (run.status === "running") {
    activeRun = {
      runId: run.id,
      mode: params.mode,
      sourceSite: params.sourceSite ?? null,
    };
  }

  return run;
}

export function getActiveStoryCrawlerRunId() {
  return activeRun?.runId ?? null;
}

export async function updateStoryCrawlerRun(params: {
  heartbeat?: boolean;
  currentStoryId?: string | null;
  currentStoryTitle?: string | null;
  currentChapterId?: string | null;
  currentChapterTitle?: string | null;
  currentUrl?: string | null;
  lastError?: string | null;
}) {
  if (!activeRun) return;

  const timestamp = now();
  await db
    .update(storyCrawlRuns)
    .set({
      heartbeatAt: params.heartbeat === false ? undefined : timestamp,
      currentStoryId: params.currentStoryId,
      currentStoryTitle: params.currentStoryTitle,
      currentChapterId: params.currentChapterId,
      currentChapterTitle: params.currentChapterTitle,
      currentUrl: params.currentUrl,
      lastError: params.lastError,
      updatedAt: timestamp,
    })
    .where(sql`${storyCrawlRuns.id} = ${activeRun.runId}`);
}

export async function incrementStoryCrawlerRunCounters(params: {
  attemptedStories?: number;
  attemptedChapters?: number;
  succeededChapters?: number;
  failedChapters?: number;
  skippedDuplicates?: number;
}) {
  if (!activeRun) return;

  const updates: Record<string, unknown> = {
    heartbeatAt: now(),
    updatedAt: now(),
  };

  if (params.attemptedStories) {
    updates.attemptedStories = sql`${storyCrawlRuns.attemptedStories} + ${params.attemptedStories}`;
  }
  if (params.attemptedChapters) {
    updates.attemptedChapters = sql`${storyCrawlRuns.attemptedChapters} + ${params.attemptedChapters}`;
  }
  if (params.succeededChapters) {
    updates.succeededChapters = sql`${storyCrawlRuns.succeededChapters} + ${params.succeededChapters}`;
  }
  if (params.failedChapters) {
    updates.failedChapters = sql`${storyCrawlRuns.failedChapters} + ${params.failedChapters}`;
  }
  if (params.skippedDuplicates) {
    updates.skippedDuplicates = sql`${storyCrawlRuns.skippedDuplicates} + ${params.skippedDuplicates}`;
  }

  await db.update(storyCrawlRuns).set(updates).where(sql`${storyCrawlRuns.id} = ${activeRun.runId}`);
}

export async function createStoryCrawlerEvent(params: {
  eventType: string;
  level?: StoryCrawlerEventLevel;
  message: string;
  storyId?: string | null;
  chapterId?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
  runId?: string | null;
}) {
  const resolvedRunId = params.runId === undefined ? getActiveStoryCrawlerRunId() : params.runId;

  await db.insert(storyCrawlEvents).values({
    runId: resolvedRunId,
    eventType: params.eventType,
    level: params.level ?? "info",
    message: params.message,
    storyId: params.storyId ?? null,
    chapterId: params.chapterId ?? null,
    url: params.url ?? null,
    metadata: params.metadata ?? null,
  });
}

export async function finishStoryCrawlerRun(params: {
  status: Exclude<StoryCrawlerRunStatus, "running">;
  lastError?: string | null;
}) {
  if (!activeRun) return;

  const runId = activeRun.runId;
  const timestamp = now();

  await db
    .update(storyCrawlRuns)
    .set({
      status: params.status,
      finishedAt: timestamp,
      heartbeatAt: timestamp,
      lastError: params.lastError ?? null,
      updatedAt: timestamp,
    })
    .where(sql`${storyCrawlRuns.id} = ${runId}`);

  activeRun = null;
}

export async function createSkippedOverlapRun(params: {
  mode: StoryCrawlerRunMode;
  sourceSite?: string | null;
  reason: string;
}) {
  const run = await startStoryCrawlerRun({
    mode: params.mode,
    sourceSite: params.sourceSite,
    status: "skipped_overlap",
    lastError: params.reason,
  });

  await createStoryCrawlerEvent({
    runId: run.id,
    eventType: "skipped_overlap",
    level: "warn",
    message: params.reason,
    metadata: {
      mode: params.mode,
      sourceSite: params.sourceSite ?? null,
    },
  });

  return run;
}
