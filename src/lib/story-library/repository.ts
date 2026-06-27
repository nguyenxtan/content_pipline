import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { storySourceChapters, storySources } from "@/lib/db/schema";
import { buildContentHash } from "@/lib/story-library/text";
import type {
  ParsedStoryChapterRef,
  ParsedStoryDetail,
  StoryLibraryChapterCrawlStatus,
  StoryLibraryCrawlStatus,
} from "@/lib/story-library/types";

export async function upsertStorySource(params: {
  detail: ParsedStoryDetail;
  crawlStatus: StoryLibraryCrawlStatus;
  lastError?: string | null;
  touchLastCrawledAt?: boolean;
}) {
  const existing = await db.query.storySources.findFirst({
    where: eq(storySources.sourceUrl, params.detail.sourceUrl),
  });

  const values = {
    sourceSite: "truyenfull.today",
    sourceUrl: params.detail.sourceUrl,
    slug: params.detail.slug,
    title: params.detail.title,
    author: params.detail.author ?? null,
    genres: params.detail.genres,
    status: params.detail.status ?? null,
    intro: params.detail.intro ?? null,
    chapterCount: params.detail.chapterCount,
    crawlStatus: params.crawlStatus,
    lastError: params.lastError ?? null,
    lastCrawledAt: params.touchLastCrawledAt ? new Date() : existing?.lastCrawledAt ?? null,
    updatedAt: new Date(),
  };

  if (!existing) {
    const [inserted] = await db
      .insert(storySources)
      .values({
        id: crypto.randomUUID(),
        ...values,
      })
      .returning();

    return inserted;
  }

  const [updated] = await db
    .update(storySources)
    .set(values)
    .where(eq(storySources.id, existing.id))
    .returning();

  return updated;
}

export async function markStorySourceStatus(storyId: string, crawlStatus: StoryLibraryCrawlStatus, lastError?: string | null) {
  await db
    .update(storySources)
    .set({
      crawlStatus,
      lastError: lastError ?? null,
      lastCrawledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storySources.id, storyId));
}

export type ChapterUpsertRenumbered = {
  chapterUrl: string;
  chapterTitle: string;
  originalChapterNumber: number;
  assignedChapterNumber: number;
};

export type ChapterUpsertSkipped = {
  chapterUrl: string;
  chapterTitle: string;
  chapterNumber: number;
  reason: string;
};

export type ChapterUpsertOutcome = {
  insertedCount: number;
  updatedCount: number;
  renumbered: ChapterUpsertRenumbered[];
  skipped: ChapterUpsertSkipped[];
};

// truyenfull.today occasionally lists a split/continuation chapter (e.g. "Chương 122-2")
// right after its parent chapter ("Chương 122"). extractChapterNumber() intentionally reads
// only the leading digits, so both rows resolve to the same chapterNumber. story_source_chapters
// enforces uniqueness on (story_id, chapter_number), so a naive insert collides. We keep the
// real titles intact and instead assign the colliding chapter the next free sequential number,
// so no chapter is lost and the run does not crash.
export async function upsertStorySourceChapters(
  storyId: string,
  chapters: ParsedStoryChapterRef[]
): Promise<ChapterUpsertOutcome> {
  const existingRows = await db.query.storySourceChapters.findMany({
    where: eq(storySourceChapters.storyId, storyId),
  });
  const existingByUrl = new Map(existingRows.map((row) => [row.chapterUrl, row]));
  const usedNumbers = new Set(existingRows.map((row) => row.chapterNumber));
  let lastAssignedNumber = existingRows.reduce((max, row) => Math.max(max, row.chapterNumber), 0);

  const outcome: ChapterUpsertOutcome = {
    insertedCount: 0,
    updatedCount: 0,
    renumbered: [],
    skipped: [],
  };

  // Stable sort by chapterNumber only: ties (e.g. a "122" and a "122-2" continuation chapter)
  // keep their original relative order, which matches the site's chapter-list (DOM) order, so
  // the parent chapter keeps its number and the continuation is the one that gets bumped below.
  const sortedChapters = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);

  for (const chapter of sortedChapters) {
    const existing = existingByUrl.get(chapter.chapterUrl);

    if (existing) {
      await db
        .update(storySourceChapters)
        .set({
          storyId,
          chapterTitle: chapter.chapterTitle,
          updatedAt: new Date(),
        })
        .where(eq(storySourceChapters.id, existing.id));
      outcome.updatedCount += 1;
      lastAssignedNumber = Math.max(lastAssignedNumber, existing.chapterNumber);
      continue;
    }

    let assignedNumber = chapter.chapterNumber;
    const collides = assignedNumber <= lastAssignedNumber || usedNumbers.has(assignedNumber);
    if (collides) {
      assignedNumber = lastAssignedNumber + 1;
      while (usedNumbers.has(assignedNumber)) {
        assignedNumber += 1;
      }
    }

    try {
      await db.insert(storySourceChapters).values({
        id: crypto.randomUUID(),
        storyId,
        chapterNumber: assignedNumber,
        chapterTitle: chapter.chapterTitle,
        chapterUrl: chapter.chapterUrl,
        crawlStatus: "queued",
      });
      outcome.insertedCount += 1;
      usedNumbers.add(assignedNumber);
      lastAssignedNumber = Math.max(lastAssignedNumber, assignedNumber);
      if (collides) {
        outcome.renumbered.push({
          chapterUrl: chapter.chapterUrl,
          chapterTitle: chapter.chapterTitle,
          originalChapterNumber: chapter.chapterNumber,
          assignedChapterNumber: assignedNumber,
        });
      }
    } catch (error) {
      outcome.skipped.push({
        chapterUrl: chapter.chapterUrl,
        chapterTitle: chapter.chapterTitle,
        chapterNumber: chapter.chapterNumber,
        reason: error instanceof Error ? error.message : "Unknown insert error",
      });
    }
  }

  return outcome;
}

export async function listQueuedStorySourceChapters(storyId: string, limit?: number) {
  const rows = await db.query.storySourceChapters.findMany({
    where: and(
      eq(storySourceChapters.storyId, storyId),
      inArray(storySourceChapters.crawlStatus, ["queued", "failed"])
    ),
    orderBy: [asc(storySourceChapters.chapterNumber)],
    limit,
  });

  return rows;
}

export async function markStorySourceChapterStatus(
  chapterId: string,
  crawlStatus: StoryLibraryChapterCrawlStatus,
  lastError?: string | null
) {
  await db
    .update(storySourceChapters)
    .set({
      crawlStatus,
      lastError: lastError ?? null,
      crawledAt: crawlStatus === "done" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(storySourceChapters.id, chapterId));
}

export async function saveStorySourceChapterContent(params: {
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  contentText: string;
  wordCount: number;
  recovery?: {
    sourceSite: string;
    url: string;
    method?: string;
    note?: string | null;
    fallbackContentLength?: number | null;
  };
}) {
  const current = await db.query.storySourceChapters.findFirst({
    where: eq(storySourceChapters.id, params.chapterId),
  });

  // The chapter page's own title can re-derive a chapterNumber that now collides with a
  // different chapter row for the same story (same root cause as upsertStorySourceChapters).
  // Keep the chapter's already-assigned number in that case instead of throwing a unique
  // constraint violation.
  let chapterNumber = params.chapterNumber;
  if (current && chapterNumber !== current.chapterNumber) {
    const conflict = await db.query.storySourceChapters.findFirst({
      where: and(
        eq(storySourceChapters.storyId, current.storyId),
        eq(storySourceChapters.chapterNumber, chapterNumber)
      ),
    });
    if (conflict && conflict.id !== params.chapterId) {
      chapterNumber = current.chapterNumber;
    }
  }

  await db
    .update(storySourceChapters)
    .set({
      chapterTitle: params.chapterTitle,
      chapterNumber,
      contentText: params.contentText,
      wordCount: params.wordCount,
      contentHash: buildContentHash(params.contentText),
      crawlStatus: "done",
      lastError: null,
      fallbackContentLength: params.recovery?.fallbackContentLength ?? undefined,
      fallbackLastCheckedAt: params.recovery ? new Date() : undefined,
      recoveryStatus: params.recovery ? "imported" : undefined,
      recoveryMethod: params.recovery?.method ?? undefined,
      recoveryNote: params.recovery?.note ?? undefined,
      recoveredAt: params.recovery ? new Date() : undefined,
      recoveredFromSourceSite: params.recovery?.sourceSite ?? undefined,
      recoveredFromUrl: params.recovery?.url ?? undefined,
      crawledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storySourceChapters.id, params.chapterId));
}

export async function updateStorySourceChapterRecovery(params: {
  chapterId: string;
  fallbackUrl?: string | null;
  fallbackSourceSite?: string | null;
  fallbackContentLength?: number | null;
  recoveryStatus?: string | null;
  recoveryMethod?: string | null;
  recoveryNote?: string | null;
  recoveredAt?: Date | null;
  recoveredFromSourceSite?: string | null;
  recoveredFromUrl?: string | null;
  fallbackLastCheckedAt?: Date | null;
}) {
  const values: Record<string, string | number | Date | null> = {
    updatedAt: new Date(),
  };

  if ("fallbackUrl" in params) values.fallbackUrl = params.fallbackUrl ?? null;
  if ("fallbackSourceSite" in params) values.fallbackSourceSite = params.fallbackSourceSite ?? null;
  if ("fallbackContentLength" in params) values.fallbackContentLength = params.fallbackContentLength ?? null;
  if ("fallbackLastCheckedAt" in params) values.fallbackLastCheckedAt = params.fallbackLastCheckedAt ?? null;
  if ("recoveryStatus" in params) values.recoveryStatus = params.recoveryStatus ?? null;
  if ("recoveryMethod" in params) values.recoveryMethod = params.recoveryMethod ?? null;
  if ("recoveryNote" in params) values.recoveryNote = params.recoveryNote ?? null;
  if ("recoveredAt" in params) values.recoveredAt = params.recoveredAt ?? null;
  if ("recoveredFromSourceSite" in params) values.recoveredFromSourceSite = params.recoveredFromSourceSite ?? null;
  if ("recoveredFromUrl" in params) values.recoveredFromUrl = params.recoveredFromUrl ?? null;

  const [updated] = await db
    .update(storySourceChapters)
    .set(values)
    .where(eq(storySourceChapters.id, params.chapterId))
    .returning();

  return updated ?? null;
}

export async function refreshStorySourceStats(storyId: string) {
  const existingStory = await db.query.storySources.findFirst({
    where: eq(storySources.id, storyId),
    columns: {
      crawlStatus: true,
      lastError: true,
    },
  });

  const [aggregate] = await db
    .select({
      chapterCount: sql<number>`count(*)::int`,
      crawledChapterCount: sql<number>`count(*) filter (where ${storySourceChapters.crawlStatus} = 'done')::int`,
      failedChapterCount: sql<number>`count(*) filter (where ${storySourceChapters.crawlStatus} = 'failed')::int`,
      totalWordCount: sql<number>`coalesce(sum(${storySourceChapters.wordCount}), 0)::int`,
    })
    .from(storySourceChapters)
    .where(eq(storySourceChapters.storyId, storyId));

  const latestFailedChapter = aggregate.failedChapterCount > 0
    ? await db.query.storySourceChapters.findFirst({
        where: and(
          eq(storySourceChapters.storyId, storyId),
          eq(storySourceChapters.crawlStatus, "failed")
        ),
        columns: {
          lastError: true,
        },
        orderBy: [
          desc(sql`coalesce(${storySourceChapters.crawledAt}, ${storySourceChapters.updatedAt}, ${storySourceChapters.createdAt})`),
        ],
      })
    : null;

  const crawlStatus: StoryLibraryCrawlStatus =
    aggregate.failedChapterCount > 0 && aggregate.crawledChapterCount > 0
      ? "partial"
      : aggregate.failedChapterCount > 0
        ? "failed"
        : aggregate.chapterCount > 0 && aggregate.crawledChapterCount === aggregate.chapterCount
          ? "done"
          : aggregate.crawledChapterCount > 0
            ? "partial"
            : "queued";

  const lastError = latestFailedChapter?.lastError
    ?? (
      aggregate.failedChapterCount === 0 &&
      existingStory?.crawlStatus === "failed" &&
      existingStory.lastError
        ? existingStory.lastError
        : null
    );

  const [updated] = await db
    .update(storySources)
    .set({
      chapterCount: aggregate.chapterCount,
      crawledChapterCount: aggregate.crawledChapterCount,
      totalWordCount: aggregate.totalWordCount,
      crawlStatus,
      lastError,
      updatedAt: new Date(),
      lastCrawledAt: new Date(),
    })
    .where(eq(storySources.id, storyId))
    .returning();

  return updated;
}

export async function listStorySourcesForResume() {
  return listStorySourcesForResumeWithFilters({});
}

export async function listStorySourcesForResumeWithFilters(params: {
  sourceSite?: string;
  failedOnly?: boolean;
}) {
  return db.query.storySources.findMany({
    where: and(
      params.sourceSite ? eq(storySources.sourceSite, params.sourceSite) : undefined,
      params.failedOnly
        ? eq(storySources.crawlStatus, "failed")
        : inArray(storySources.crawlStatus, ["queued", "crawling", "partial", "failed"])
    ),
    // Story continuity: finish in-progress ("partial") stories before starting brand-new ones,
    // so a story with real chapter-text progress is never starved by newly discovered stories.
    // Within that, prefer source-complete ("Full") novels over still-updating ones — a finished
    // novel's chapter count is fixed, so crawling it to completion is a well-defined, finite
    // task instead of chasing a moving target. The per-run chapter budget is shared across
    // stories and the resume loop stops as soon as it's spent, so this ordering is what actually
    // decides which story gets crawled each run, not just a tiebreak.
    // createdAt is immutable (unlike updatedAt/lastCrawledAt, which get touched by unrelated
    // metadata refreshes on every resume tick), so ordering by it keeps the same story selected
    // run after run until it actually runs out of chapters, instead of churning between stories.
    orderBy: [
      sql`case when ${storySources.crawlStatus} = 'partial' then 0 else 1 end`,
      sql`case when ${storySources.status} = 'Full' then 0 else 1 end`,
      asc(storySources.createdAt),
    ],
  });
}

// ── Pre-TTS audio text layer ─────────────────────────────────────────────────────
// Always derived from contentText; never overwrites the raw crawled text itself.

export type AudioTextDbStatus = "raw" | "normalized" | "needs_review" | "approved" | "blocked";

export async function saveStorySourceChapterAudioText(params: {
  chapterId: string;
  audioText: string;
  status: AudioTextDbStatus;
  issueCount: number;
  normalizationVersion: string;
  // Provenance: null/omitted = derived from raw content_text by the automated
  // normalizer; "manual_import" = an admin pasted clean text directly.
  source?: "manual_import" | null;
  // Manual import carries source URL/site/note as free text here (no dedicated
  // columns) — automated (re)normalization always clears it, since a fresh
  // mechanical pass supersedes any prior human review/provenance note.
  reviewNote?: string | null;
  // Only true when the admin explicitly approved in the same save (manual import's
  // "Save and approve" action) — otherwise reviewedAt is always cleared, since any
  // fresh save (including re-normalizing) supersedes a prior approval decision.
  markApproved?: boolean;
}) {
  await db
    .update(storySourceChapters)
    .set({
      audioText: params.audioText,
      audioTextStatus: params.status,
      audioTextIssueCount: params.issueCount,
      audioTextNormalizationVersion: params.normalizationVersion,
      audioTextSource: params.source ?? null,
      audioTextUpdatedAt: new Date(),
      audioTextReviewedAt: params.markApproved ? new Date() : null,
      audioTextReviewNote: params.reviewNote ?? null,
      updatedAt: new Date(),
    })
    .where(eq(storySourceChapters.id, params.chapterId));
}

export async function setStorySourceChapterAudioTextReview(params: {
  chapterId: string;
  status: "approved" | "needs_review";
  reviewNote?: string | null;
}) {
  await db
    .update(storySourceChapters)
    .set({
      audioTextStatus: params.status,
      // Only an explicit approval counts as "reviewed" — marking needs_review is a
      // request for MORE review, not a completed one, so the timestamp must stay null.
      audioTextReviewedAt: params.status === "approved" ? new Date() : null,
      audioTextReviewNote: params.reviewNote ?? null,
      updatedAt: new Date(),
    })
    .where(eq(storySourceChapters.id, params.chapterId));
}
