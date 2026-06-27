"use server";

import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { storyCrawlEvents, storyCrawlRuns, storySourceChapters, storySources } from "@/lib/db/schema";
import {
  refreshStorySourceStats,
  saveStorySourceChapterContent,
  updateStorySourceChapterRecovery,
  saveStorySourceChapterAudioText,
  setStorySourceChapterAudioTextReview,
} from "@/lib/story-library/repository";
import { inspectWebTruyenDichFallback, WEBTRUYENDICH_SITE } from "@/lib/story-library/parsers/webtruyendich";
import { inspectTvTruyenFallback, TVTRUYEN_SITE } from "@/lib/story-library/parsers/tvtruyen-fit";
import { inspectITruyenChuFallback, ITRUYENCHU_SITE } from "@/lib/story-library/parsers/itruyenchu";
import { inspectMetruyenChuFallback, METRUYENCHU_SITE } from "@/lib/story-library/parsers/metruyenchu";
import type { StoryLibraryFallbackInspectionVerdict } from "@/lib/story-library/types";
import {
  analyzeChapterAudioText,
  normalizeChapterAudioText,
  AUDIO_TEXT_NORMALIZATION_VERSION,
  type AudioTextStatus,
} from "@/lib/story-library/audio-text-normalizer";
import { countWords } from "@/lib/story-library/text";

const ATTENTION_EVENT_TYPES = [
  "blocked_or_cloudflare_detected",
  "failed_request",
  "skipped_overlap",
  "stale_lock_replaced",
] as const;

type StoryLibraryOverviewFilters = {
  search?: string;
  genre?: string;
  crawlStatus?: string;
  status?: string;
  sourceSite?: string;
  hasFailedChapters?: boolean;
  hasZeroChapters?: boolean;
  readyCandidate?: boolean;
  sort?: string;
};

type StoryLibraryOverviewRow = {
  id: string;
  sourceSite: string;
  sourceUrl: string;
  slug: string;
  title: string;
  author: string | null;
  genres: string[];
  status: string | null;
  intro: string | null;
  chapterCount: number;
  crawledChapterCount: number;
  totalWordCount: number;
  crawlStatus: string;
  lastError: string | null;
  lastCrawledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  failedChapterCount: number;
  progressPercentage: number;
};

function normalizeMonitorText(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function truncateMonitorText(value: string, maxLength = 180) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractMonitorMessageField(
  text: string,
  patterns: RegExp[],
) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function formatStoryCrawlerEventMessage(event: {
  eventType: string;
  message: string;
  metadata?: unknown;
}) {
  const normalizedMessage = normalizeMonitorText(event.message);
  const metadata =
    event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : null;

  if (event.eventType !== "failed_request" && event.eventType !== "blocked_or_cloudflare_detected") {
    return {
      summary: truncateMonitorText(normalizedMessage, 160),
      details: normalizedMessage,
    };
  }

  const metadataCode =
    typeof metadata?.code === "string"
      ? metadata.code
      : typeof metadata?.dbErrorCode === "string"
        ? metadata.dbErrorCode
        : null;
  const metadataConstraint =
    typeof metadata?.constraint === "string"
      ? metadata.constraint
      : typeof metadata?.constraintName === "string"
        ? metadata.constraintName
        : null;
  const metadataTable =
    typeof metadata?.table === "string"
      ? metadata.table
      : typeof metadata?.relation === "string"
        ? metadata.relation
        : null;
  const metadataDetail = typeof metadata?.detail === "string" ? metadata.detail : null;

  const code =
    metadataCode ??
    extractMonitorMessageField(normalizedMessage, [
      /\bcode[:=\s]+([0-9A-Z_]+)/i,
      /\bpostgres(?:ql)? error\s+([0-9A-Z_]+)/i,
    ]);
  const constraint =
    metadataConstraint ??
    extractMonitorMessageField(normalizedMessage, [
      /\bconstraint\s+"?([a-zA-Z0-9_.-]+)"?/i,
      /\bviolates unique constraint\s+"?([a-zA-Z0-9_.-]+)"?/i,
    ]);
  const table =
    metadataTable ??
    extractMonitorMessageField(normalizedMessage, [
      /\btable\s+"?([a-zA-Z0-9_.-]+)"?/i,
      /\brelation\s+"?([a-zA-Z0-9_.-]+)"?/i,
      /\binto\s+"?([a-zA-Z0-9_.-]+)"?/i,
      /\bfrom\s+"?([a-zA-Z0-9_.-]+)"?/i,
    ]);
  const detail =
    metadataDetail ??
    extractMonitorMessageField(normalizedMessage, [
      /\bdetail[:=\s]+(.+)/i,
      /\bmessage[:=\s]+(.+)/i,
    ]);

  const summaryParts = [
    code ? `code ${code}` : null,
    constraint ? `constraint ${constraint}` : null,
    table ? `table ${table}` : null,
  ].filter(Boolean);
  const operation =
    extractMonitorMessageField(normalizedMessage, [
      /^failed query:\s*(insert|update|delete|select)\b/i,
      /\b(insert|update|delete|select)\s+into\b/i,
      /\b(insert|update|delete|select)\b/i,
    ])?.toLowerCase() ?? null;

  let shortDetail = detail
    ? detail
    : normalizedMessage
        .replace(/\b(sql|query|statement|params?)[:=].*/i, "")
        .replace(/\s+/g, " ")
        .trim();

  if (shortDetail.toLowerCase().includes("duplicate key value violates unique constraint")) {
    shortDetail = "duplicate key violation";
  } else if (shortDetail.toLowerCase().includes("chapter content not found")) {
    shortDetail = "chapter content not found";
  } else if (shortDetail.toLowerCase().includes("cloudflare")) {
    shortDetail = "cloudflare or block page detected";
  }

  if (
    normalizedMessage.toLowerCase().startsWith("failed query:") ||
    !shortDetail ||
    shortDetail.toLowerCase() === "failed query:" ||
    shortDetail.toLowerCase() === "failed"
  ) {
    shortDetail = operation && table ? `${operation} row failed` : operation ? `${operation} request failed` : "request failed";
  }

  const summaryBase =
    summaryParts.length > 0
      ? `${event.eventType}: ${summaryParts.join(" • ")}`
      : `${event.eventType}: request/database error`;

  const summary = truncateMonitorText(
    shortDetail && !summaryBase.toLowerCase().includes(shortDetail.toLowerCase())
      ? `${summaryBase} • ${shortDetail}`
      : summaryBase,
    170,
  );

  return {
    summary,
    details: normalizedMessage,
  };
}

function escapeLikePattern(value: string) {
  return value.replace(/[%_\\]/g, "\\$&");
}

function isTruthyFilter(value: unknown) {
  return value === true || value === "1" || value === "true";
}

function buildStoryStatusCondition(status?: string): SQL | null {
  if (!status) return null;

  const normalized = status.trim().toLowerCase();
  const lowerStatus = sql`lower(coalesce(${storySources.status}, ''))`;

  if (normalized === "completed" || normalized === "full") {
    return sql`${lowerStatus} in ('full', 'completed', 'hoàn thành')`;
  }

  if (normalized === "ongoing" || normalized === "dang ra" || normalized === "đang ra") {
    return sql`${lowerStatus} in ('đang ra', 'dang ra', 'ongoing', 'updating')`;
  }

  if (normalized === "unknown") {
    return sql`coalesce(nullif(trim(${storySources.status}), ''), '') = ''`;
  }

  return eq(storySources.status, status);
}

function buildStoryOverviewConditions(filters?: StoryLibraryOverviewFilters) {
  const conditions: SQL[] = [];

  if (filters?.search) {
    conditions.push(sql`${storySources.title} ilike ${`%${escapeLikePattern(filters.search)}%`} escape '\\'`);
  }

  if (filters?.crawlStatus) {
    if (filters.crawlStatus === "pending") {
      conditions.push(sql`${storySources.crawlStatus} in ('queued', 'crawling')`);
    } else if (filters.crawlStatus === "completed") {
      conditions.push(eq(storySources.crawlStatus, "done"));
    } else {
      conditions.push(eq(storySources.crawlStatus, filters.crawlStatus));
    }
  }

  const statusCondition = buildStoryStatusCondition(filters?.status);
  if (statusCondition) {
    conditions.push(statusCondition);
  }

  if (filters?.sourceSite) {
    conditions.push(eq(storySources.sourceSite, filters.sourceSite));
  }

  if (filters?.genre) {
    conditions.push(sql`${storySources.genres} ? ${filters.genre}`);
  }

  if (isTruthyFilter(filters?.hasFailedChapters)) {
    conditions.push(sql`exists (
      select 1
      from ${storySourceChapters}
      where ${storySourceChapters.storyId} = ${storySources.id}
        and ${storySourceChapters.crawlStatus} = 'failed'
    )`);
  }

  if (isTruthyFilter(filters?.hasZeroChapters)) {
    conditions.push(eq(storySources.chapterCount, 0));
  }

  if (isTruthyFilter(filters?.readyCandidate)) {
    conditions.push(sql`
      ${storySources.crawledChapterCount} > 0
      and ${storySources.totalWordCount} > 0
      and not exists (
        select 1
        from ${storySourceChapters}
        where ${storySourceChapters.storyId} = ${storySources.id}
          and ${storySourceChapters.crawlStatus} = 'failed'
      )
    `);
  }

  return conditions;
}

function buildStoryOverviewWhere(filters?: StoryLibraryOverviewFilters) {
  const conditions = buildStoryOverviewConditions(filters);
  return conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
}

function buildStoryOverviewOrder(sort?: string) {
  switch (sort) {
    case "created_at_desc":
      return sql`${storySources.createdAt} desc, ${storySources.updatedAt} desc`;
    case "progress_asc":
      return sql`"progressPercentage" asc, ${storySources.updatedAt} desc`;
    case "failed_chapter_count_desc":
      return sql`"failedChapterCount" desc, ${storySources.updatedAt} desc`;
    case "total_word_count_desc":
      return sql`${storySources.totalWordCount} desc, ${storySources.updatedAt} desc`;
    case "chapter_count_desc":
      return sql`${storySources.chapterCount} desc, ${storySources.updatedAt} desc`;
    case "last_crawled_at_desc":
    default:
      return sql`${storySources.lastCrawledAt} desc nulls last, ${storySources.updatedAt} desc`;
  }
}

export async function getStoryLibraryOverviewAction(filters?: {
  search?: string;
  genre?: string;
  crawlStatus?: string;
  status?: string;
  sourceSite?: string;
  hasFailedChapters?: boolean;
  hasZeroChapters?: boolean;
  readyCandidate?: boolean;
  sort?: string;
}) {
  const whereClause = buildStoryOverviewWhere(filters);
  const orderByClause = buildStoryOverviewOrder(filters?.sort);

  const result = await db.execute<StoryLibraryOverviewRow>(sql`
    select
      ${storySources.id} as "id",
      ${storySources.sourceSite} as "sourceSite",
      ${storySources.sourceUrl} as "sourceUrl",
      ${storySources.slug} as "slug",
      ${storySources.title} as "title",
      ${storySources.author} as "author",
      ${storySources.genres} as "genres",
      ${storySources.status} as "status",
      ${storySources.intro} as "intro",
      ${storySources.chapterCount} as "chapterCount",
      ${storySources.crawledChapterCount} as "crawledChapterCount",
      ${storySources.totalWordCount} as "totalWordCount",
      ${storySources.crawlStatus} as "crawlStatus",
      ${storySources.lastError} as "lastError",
      ${storySources.lastCrawledAt} as "lastCrawledAt",
      ${storySources.createdAt} as "createdAt",
      ${storySources.updatedAt} as "updatedAt",
      coalesce(chapter_stats.failed_chapter_count, 0)::int as "failedChapterCount",
      case
        when ${storySources.chapterCount} <= 0 then 0
        when ${storySources.crawledChapterCount} >= ${storySources.chapterCount} then 100
        when ${storySources.crawledChapterCount} > 0 then greatest(
          1,
          round((${storySources.crawledChapterCount}::numeric / ${storySources.chapterCount}::numeric) * 100)
        )::int
        else 0
      end as "progressPercentage"
    from ${storySources}
    left join lateral (
      select
        count(*) filter (where ${storySourceChapters.crawlStatus} = 'failed')::int as failed_chapter_count
      from ${storySourceChapters}
      where ${storySourceChapters.storyId} = ${storySources.id}
    ) as chapter_stats on true
    ${whereClause}
    order by ${orderByClause}
  `);

  return result.rows.map((row) => ({
    ...row,
    genres: Array.isArray(row.genres) ? row.genres : [],
    failedChapterCount: Number(row.failedChapterCount ?? 0),
    progressPercentage: Math.max(0, Math.min(100, Number(row.progressPercentage ?? 0))),
    chapterCount: Number(row.chapterCount ?? 0),
    crawledChapterCount: Number(row.crawledChapterCount ?? 0),
    totalWordCount: Number(row.totalWordCount ?? 0),
  }));
}

export async function getStoryLibraryFilterOptionsAction() {
  const [genreRows, sourceSiteRows, statusRows] = await Promise.all([
    db.execute(sql`
      select distinct jsonb_array_elements_text(${storySources.genres}) as genre
      from ${storySources}
      where jsonb_array_length(${storySources.genres}) > 0
      order by genre asc
    `),
    db
      .selectDistinct({ sourceSite: storySources.sourceSite })
      .from(storySources)
      .orderBy(asc(storySources.sourceSite)),
    db
      .selectDistinct({ status: storySources.status })
      .from(storySources)
      .where(sql`${storySources.status} is not null and trim(${storySources.status}) <> ''`)
      .orderBy(asc(storySources.status)),
  ]);

  return {
    genres: genreRows.rows.map((row) => String(row.genre)).filter(Boolean),
    sourceSites: sourceSiteRows.map((row) => row.sourceSite),
    statuses: statusRows.map((row) => row.status).filter(Boolean) as string[],
  };
}

export async function getStoryLibraryStoryAction(storyId: string) {
  const story = await db.query.storySources.findFirst({
    where: eq(storySources.id, storyId),
  });

  if (!story) return null;

  const chapters = await db.query.storySourceChapters.findMany({
    where: eq(storySourceChapters.storyId, storyId),
    orderBy: [asc(storySourceChapters.chapterNumber)],
  });

  return {
    story,
    chapters,
  };
}

export async function getStoryLibraryChapterAction(storyId: string, chapterId: string) {
  const chapter = await db.query.storySourceChapters.findFirst({
    where: and(eq(storySourceChapters.id, chapterId), eq(storySourceChapters.storyId, storyId)),
  });

  if (!chapter) return null;

  const story = await db.query.storySources.findFirst({
    where: eq(storySources.id, storyId),
  });

  if (!story) return null;

  const [previousChapter, nextChapter] = await Promise.all([
    db.query.storySourceChapters.findFirst({
      where: and(
        eq(storySourceChapters.storyId, storyId),
        sql`${storySourceChapters.chapterNumber} < ${chapter.chapterNumber}`
      ),
      orderBy: [desc(storySourceChapters.chapterNumber)],
    }),
    db.query.storySourceChapters.findFirst({
      where: and(
        eq(storySourceChapters.storyId, storyId),
        sql`${storySourceChapters.chapterNumber} > ${chapter.chapterNumber}`
      ),
      orderBy: [asc(storySourceChapters.chapterNumber)],
    }),
  ]);

  const effectiveAudioText = chapter.audioText ?? chapter.contentText ?? "";
  // Two separate previews:
  // - rawAudioTextPreview: what the raw crawled content currently looks like for TTS review
  // - audioTextPreview: what the current persisted audio-text layer looks like (manual import
  //   or normalized derivative). UI uses the latter for approve/pass decisions.
  const rawAudioTextPreview = analyzeChapterAudioText({ text: chapter.contentText ?? "", chapterNumber: chapter.chapterNumber });
  const audioTextPreview = analyzeChapterAudioText({ text: effectiveAudioText, chapterNumber: chapter.chapterNumber });

  return {
    story,
    chapter,
    previousChapter,
    nextChapter,
    rawAudioTextPreview,
    audioTextPreview,
  };
}

function mapAnalyzerStatusToDbStatus(status: AudioTextStatus): "normalized" | "needs_review" | "blocked" {
  if (status === "block") return "blocked";
  if (status === "needs_review") return "needs_review";
  return "normalized"; // pass or warn — clean enough to use without forcing manual review
}

/**
 * Re-analyzes whatever is currently stored in audio_text (manual import or
 * automated derivation, whichever is there) WITHOUT changing the text itself and
 * WITHOUT resetting provenance back to raw-derived. Use this to re-check a manual
 * import after editing the dictionary/understanding, or just to refresh the saved
 * issue count — never use this to discard a manual import; that's what "Reset to
 * raw-derived normalized version" (resetStoryLibraryChapterAudioTextToRawAction) is for.
 */
export async function reanalyzeStoryLibraryChapterAudioTextAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  if (!chapterId) return;

  const chapter = await db.query.storySourceChapters.findFirst({ where: eq(storySourceChapters.id, chapterId) });
  if (!chapter) return;

  const currentAudioText = chapter.audioText ?? chapter.contentText ?? "";
  if (!currentAudioText.trim()) return;

  const analysis = analyzeChapterAudioText({ text: currentAudioText, chapterNumber: chapter.chapterNumber });

  await saveStorySourceChapterAudioText({
    chapterId,
    audioText: currentAudioText,
    status: mapAnalyzerStatusToDbStatus(analysis.status),
    issueCount: analysis.stats.issueCount,
    normalizationVersion: AUDIO_TEXT_NORMALIZATION_VERSION,
    // Preserve whatever provenance was already there — re-analysis is not a fresh
    // raw derivation, so it must not silently relabel a manual import as "derived".
    source: chapter.audioTextSource === "manual_import" ? "manual_import" : null,
    reviewNote: chapter.audioTextReviewNote,
  });

  safeRevalidatePath(`/admin/story-library/${chapter.storyId}/chapters/${chapterId}`);
  safeRevalidatePath(`/admin/story-library/${chapter.storyId}`);
}

/**
 * Explicitly discards whatever is currently in audio_text (including any manual
 * import) and replaces it with a fresh derivation from the immutable raw content_text.
 * This is the ONLY action that resets provenance back to "derived from raw" — never
 * the default/first button on the chapter page, since it destroys manual work.
 */
export async function resetStoryLibraryChapterAudioTextToRawAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  if (!chapterId) return;

  const chapter = await db.query.storySourceChapters.findFirst({ where: eq(storySourceChapters.id, chapterId) });
  if (!chapter) return;

  // Always re-derive from the immutable raw contentText, never from a prior audio_text —
  // this intentionally discards any manual import and must not compound on prior output.
  const analysis = normalizeChapterAudioText({ text: chapter.contentText ?? "", chapterNumber: chapter.chapterNumber });

  await saveStorySourceChapterAudioText({
    chapterId,
    audioText: analysis.normalizedText,
    status: mapAnalyzerStatusToDbStatus(analysis.status),
    issueCount: analysis.stats.issueCount,
    normalizationVersion: AUDIO_TEXT_NORMALIZATION_VERSION,
    // source omitted -> null -> "derived from raw", explicitly overwriting any
    // prior manual_import provenance, exactly what this action's name promises.
  });

  safeRevalidatePath(`/admin/story-library/${chapter.storyId}/chapters/${chapterId}`);
  safeRevalidatePath(`/admin/story-library/${chapter.storyId}`);
}

export async function approveStoryLibraryChapterAudioTextAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  if (!chapterId) return;
  const chapter = await db.query.storySourceChapters.findFirst({ where: eq(storySourceChapters.id, chapterId) });
  if (!chapter) return;

  const note = String(formData.get("review_note") ?? "").trim();
  const currentAudioText = chapter.audioText ?? chapter.contentText ?? "";
  if (!currentAudioText.trim()) return;

  const analysis = analyzeChapterAudioText({ text: currentAudioText, chapterNumber: chapter.chapterNumber });
  if (analysis.status === "block") {
    safeRevalidatePath(`/admin/story-library/${chapter.storyId}/chapters/${chapterId}`);
    safeRevalidatePath(`/admin/story-library/${chapter.storyId}`);
    return;
  }

  const reviewNote =
    note ||
    (analysis.status === "warn" || analysis.status === "needs_review"
      ? "Approved for TTS after admin review."
      : null);
  await setStorySourceChapterAudioTextReview({ chapterId, status: "approved", reviewNote });

  safeRevalidatePath(`/admin/story-library/${chapter.storyId}/chapters/${chapterId}`);
  safeRevalidatePath(`/admin/story-library/${chapter.storyId}`);
}

export async function markStoryLibraryChapterAudioTextNeedsReviewAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  if (!chapterId) return;
  const chapter = await db.query.storySourceChapters.findFirst({ where: eq(storySourceChapters.id, chapterId) });
  if (!chapter) return;

  const note = String(formData.get("review_note") ?? "").trim();
  await setStorySourceChapterAudioTextReview({ chapterId, status: "needs_review", reviewNote: note || null });

  safeRevalidatePath(`/admin/story-library/${chapter.storyId}/chapters/${chapterId}`);
  safeRevalidatePath(`/admin/story-library/${chapter.storyId}`);
}

function buildManualAudioTextImportNote(params: { sourceUrl?: string; sourceSite?: string; note?: string; refusalReason?: string }): string | null {
  const parts: string[] = [];
  if (params.sourceUrl) parts.push(`source_url: ${params.sourceUrl}`);
  if (params.sourceSite) parts.push(`source_site: ${params.sourceSite}`);
  if (params.note) parts.push(`note: ${params.note}`);
  if (params.refusalReason) parts.push(`approval_refused: ${params.refusalReason}`);
  if (parts.length === 0) return "[Manual import]";
  return `[Manual import] ${parts.join(" | ")}`;
}

export type ManualAudioTextImportMode = "draft" | "analyze" | "needs_review" | "approve";

async function saveImportedStoryLibraryChapterAudioText(params: {
  chapterId: string;
  audioText: string;
  chapterNumber: number;
  sourceUrl?: string;
  sourceSite?: string;
  note?: string;
  mode: ManualAudioTextImportMode;
}) {
  // Imported text is still analyzed — fallback/manual import is never a bypass for
  // blockers such as placeholders, gating remnants, or unsafe normalization issues.
  const analysis = analyzeChapterAudioText({ text: params.audioText, chapterNumber: params.chapterNumber });

  let status: "normalized" | "needs_review" | "blocked" | "approved";
  let markApproved = false;
  let refusalReason: string | undefined;

  if (params.mode === "approve") {
    if (analysis.status === "block") {
      status = "blocked";
      const blocker = analysis.issues.find((issue) => issue.severity === "block");
      refusalReason = blocker ? `${blocker.issueType} ("${blocker.snippet}")` : "unresolved blocking issue";
    } else {
      status = "approved";
      markApproved = true;
    }
  } else if (params.mode === "needs_review") {
    status = "needs_review";
  } else if (params.mode === "analyze") {
    status = mapAnalyzerStatusToDbStatus(analysis.status);
  } else {
    status = analysis.status === "block" ? "blocked" : "needs_review";
  }

  await saveStorySourceChapterAudioText({
    chapterId: params.chapterId,
    audioText: params.audioText,
    status,
    issueCount: analysis.stats.issueCount,
    normalizationVersion: AUDIO_TEXT_NORMALIZATION_VERSION,
    source: "manual_import",
    reviewNote: buildManualAudioTextImportNote({
      sourceUrl: params.sourceUrl,
      sourceSite: params.sourceSite,
      note: params.note,
      refusalReason,
    }),
    markApproved,
  });
}

/**
 * Manual admin import of clean audio text for chapters whose raw text has
 * unresolved blockers (e.g. star-obfuscation with no safe dictionary mapping).
 * Never touches content_text/wordCount — only the derived audio_text layer.
 */
export async function importStoryLibraryChapterAudioTextAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  const audioText = String(formData.get("audio_text") ?? "").trim();
  if (!chapterId || !audioText) return;

  const chapter = await db.query.storySourceChapters.findFirst({ where: eq(storySourceChapters.id, chapterId) });
  if (!chapter) return;

  const sourceUrl = String(formData.get("source_url") ?? "").trim() || undefined;
  const sourceSite = String(formData.get("source_site") ?? "").trim() || undefined;
  const note = String(formData.get("note") ?? "").trim() || undefined;
  const mode = (String(formData.get("import_mode") ?? "draft") as ManualAudioTextImportMode);

  await saveImportedStoryLibraryChapterAudioText({
    chapterId,
    audioText,
    chapterNumber: chapter.chapterNumber,
    sourceUrl,
    sourceSite,
    note,
    mode,
  });

  safeRevalidatePath(`/admin/story-library/${chapter.storyId}/chapters/${chapterId}`);
  safeRevalidatePath(`/admin/story-library/${chapter.storyId}`);
}

export async function importStoryLibraryChapterAudioTextFromFallbackAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  const fallbackUrl = String(formData.get("fallback_url") ?? "").trim();
  if (!chapterId || !fallbackUrl) return;

  const chapter = await db.query.storySourceChapters.findFirst({
    where: eq(storySourceChapters.id, chapterId),
    with: { story: true },
  });
  if (!chapter?.story) return;

  const mode = String(formData.get("import_mode") ?? "draft") as ManualAudioTextImportMode;
  const note = String(formData.get("note") ?? "").trim() || undefined;
  const inspection = await inspectStoryLibraryFallbackUrl({
    fallbackUrl,
    expectedStoryTitle: chapter.story.title,
    expectedChapterNumber: chapter.chapterNumber,
    expectedChapterTitle: chapter.chapterTitle,
  });

  if (inspection.verdict !== "valid_fallback" || !inspection.contentText) {
    const reviewNote = buildManualAudioTextImportNote({
      sourceUrl: fallbackUrl,
      sourceSite: inspection.fallbackSourceSite,
      note,
      refusalReason: inspection.message,
    });
    await setStorySourceChapterAudioTextReview({
      chapterId,
      status: chapter.audioTextStatus === "approved" ? "approved" : "needs_review",
      reviewNote,
    });
    safeRevalidatePath(`/admin/story-library/${chapter.storyId}/chapters/${chapterId}`);
    safeRevalidatePath(`/admin/story-library/${chapter.storyId}`);
    return;
  }

  await saveImportedStoryLibraryChapterAudioText({
    chapterId,
    audioText: inspection.contentText,
    chapterNumber: chapter.chapterNumber,
    sourceUrl: inspection.fallbackUrl,
    sourceSite: inspection.fallbackSourceSite,
    note,
    mode,
  });

  safeRevalidatePath(`/admin/story-library/${chapter.storyId}/chapters/${chapterId}`);
  safeRevalidatePath(`/admin/story-library/${chapter.storyId}`);
}

export async function markStoryLibraryChapterReviewedAction(chapterId: string) {
  const [updated] = await db
    .update(storySourceChapters)
    .set({
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storySourceChapters.id, chapterId))
    .returning();

  return updated ?? null;
}

type StoryLibraryMissingChapterRow = {
  chapterId: string;
  storyId: string;
  storyTitle: string;
  storySlug: string;
  chapterNumber: number;
  chapterTitle: string | null;
  primaryUrl: string;
  lastError: string | null;
  updatedAt: Date;
  crawlStatus: string;
  fallbackUrl: string | null;
  fallbackSourceSite: string | null;
  fallbackContentLength: number | null;
  fallbackLastCheckedAt: Date | null;
  recoveryStatus: string | null;
  recoveryMethod: string | null;
  recoveryNote: string | null;
  recoveredAt: Date | null;
  recoveredFromSourceSite: string | null;
  recoveredFromUrl: string | null;
  audioTextStatus: string;
  audioTextSource: string | null;
  audioTextReviewedAt: Date | null;
  audioText: string | null;
};

type StoryLibraryFallbackSuggestion = {
  sourceSite: string;
  label: string;
  url?: string;
  kind: "direct_url" | "chapter_list" | "manual";
};

export type StoryLibraryMissingChaptersView =
  | "unresolved"
  | "fallback_recovered"
  | "audio_text_recovered"
  | "audio_text_needs_approval"
  | "audio_text_blocked"
  | "all";

// revalidatePath() throws "static generation store missing" when called outside a
// real Next.js request context (e.g. a standalone tsx test script invoking a server
// action directly) — swallow only that specific error, never others.
function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("static generation store missing")) {
      throw error;
    }
  }
}

function revalidateStoryLibraryPaths(storyId?: string | null, chapterId?: string | null) {
  const paths = [
    "/admin/story-library",
    "/admin/story-library/missing-chapters",
    storyId ? `/admin/story-library/${storyId}` : null,
    storyId && chapterId ? `/admin/story-library/${storyId}/chapters/${chapterId}` : null,
  ].filter(Boolean) as string[];

  for (const path of paths) safeRevalidatePath(path);
}

function normalizeRecoverySourceSite(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === WEBTRUYENDICH_SITE) return WEBTRUYENDICH_SITE;
    if (hostname === TVTRUYEN_SITE) return TVTRUYEN_SITE;
    if (hostname === ITRUYENCHU_SITE) return ITRUYENCHU_SITE;
    if (hostname === METRUYENCHU_SITE) return METRUYENCHU_SITE;
    return hostname;
  } catch {
    return "";
  }
}

async function inspectStoryLibraryFallbackUrl(params: {
  fallbackUrl: string;
  expectedStoryTitle?: string | null;
  expectedChapterNumber?: number | null;
  expectedChapterTitle?: string | null;
}) {
  const hostname = new URL(params.fallbackUrl).hostname.toLowerCase();
  if (hostname === WEBTRUYENDICH_SITE) {
    return inspectWebTruyenDichFallback(params);
  }
  if (hostname === TVTRUYEN_SITE) {
    return inspectTvTruyenFallback(params);
  }
  if (hostname === ITRUYENCHU_SITE) {
    return inspectITruyenChuFallback(params);
  }
  if (hostname === METRUYENCHU_SITE) {
    return inspectMetruyenChuFallback(params);
  }
  return {
    verdict: "inconclusive" as StoryLibraryFallbackInspectionVerdict,
    fallbackSourceSite: hostname,
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
    message: `Fallback host ${hostname} is not supported yet.`,
    diagnostics: { hostname },
  };
}

function buildMissingChapterSuggestions(row: Pick<StoryLibraryMissingChapterRow, "storySlug" | "chapterNumber">): StoryLibraryFallbackSuggestion[] {
  const slug = row.storySlug?.trim();
  const chapterNumber = row.chapterNumber;

  return [
    slug
      ? {
          sourceSite: WEBTRUYENDICH_SITE,
          label: "Check public chapter list on webtruyendich.com",
          url: `https://${WEBTRUYENDICH_SITE}/truyen/${slug}/danh-sach-chuong-day-du`,
          kind: "chapter_list",
        }
      : null,
    slug && chapterNumber > 0
      ? {
          sourceSite: TVTRUYEN_SITE,
          label: `Inspect suggested tvtruyen.fit chapter ${chapterNumber}`,
          url: `https://${TVTRUYEN_SITE}/${slug}/chuong-${chapterNumber}`,
          kind: "direct_url",
        }
      : null,
    slug && chapterNumber > 0
      ? {
          sourceSite: ITRUYENCHU_SITE,
          label: `Inspect suggested itruyenchu.org chapter ${chapterNumber}`,
          url: `https://${ITRUYENCHU_SITE}/truyen/${slug}/chuong-${chapterNumber}`,
          kind: "direct_url",
        }
      : null,
    {
      sourceSite: "manual",
      label: "Manual import remains operator-approved only",
      kind: "manual",
    },
  ].filter(Boolean) as StoryLibraryFallbackSuggestion[];
}

function isStoryLibraryAudioTextRecoveredRow(row: Pick<StoryLibraryMissingChapterRow, "lastError" | "audioTextStatus" | "audioTextSource">) {
  return row.lastError === "source_missing_chapter" && row.audioTextStatus === "approved";
}

// "needs_review" can be a human override (markStoryLibraryChapterAudioTextNeedsReviewAction
// sets it unconditionally) on text that is still genuinely blocked, so the DB enum alone
// cannot tell "safe, just needs approval" apart from "actually still blocked". Re-analyze
// the stored text fresh — cheap, this list is small — to get the true current verdict.
// "blocked" status is never ambiguous; "normalized"/"approved" can never have blockers
// by construction (mapAnalyzerStatusToDbStatus only assigns them for pass/warn analysis).
function hasUnresolvedAudioTextBlockers(row: Pick<StoryLibraryMissingChapterRow, "audioTextStatus" | "audioText" | "chapterNumber">) {
  if (row.audioTextStatus === "blocked") return true;
  if (row.audioTextStatus !== "needs_review" || !row.audioText) return false;
  return analyzeChapterAudioText({ text: row.audioText, chapterNumber: row.chapterNumber }).status === "block";
}

// Splits the generic "missing" bucket into 5 mutually-exclusive states so a manual
// audio_text import in flight is never lumped in with chapters nothing has been done
// for yet. Precedence: most-resolved state wins (approved > fallback-imported raw text
// > blocked > needs-approval > genuinely unresolved).
//
// needs_approval/blocked require audioTextSource === "manual_import" specifically — a
// chapter can have a stale auto-derived needs_review/normalized audio_text sitting on
// top of a raw-missing chapter (e.g. left over from an old normalize pass on
// placeholder/garbage raw text) with no human ever having addressed the missing
// chapter. That is NOT "something is in flight awaiting a decision" — it's still
// genuinely unresolved, so it must not be excluded from the unresolved bucket.
function getStoryLibraryMissingChapterView(
  row: Omit<StoryLibraryMissingChapterRow, "audioText"> & { hasUnresolvedAudioTextBlockers: boolean }
): StoryLibraryMissingChaptersView {
  if (isStoryLibraryAudioTextRecoveredRow(row)) return "audio_text_recovered";
  if (row.recoveryStatus === "imported") return "fallback_recovered";
  if (row.audioTextSource !== "manual_import") return "unresolved";
  if (row.hasUnresolvedAudioTextBlockers) return "audio_text_blocked";
  if (row.audioTextStatus === "needs_review" || row.audioTextStatus === "normalized") return "audio_text_needs_approval";
  return "unresolved";
}

async function getMissingChapterById(chapterId: string) {
  return db.query.storySourceChapters.findFirst({
    where: eq(storySourceChapters.id, chapterId),
    with: {
      story: true,
    },
  });
}

async function inspectMissingChapterFallback(chapterId: string) {
  const chapter = await getMissingChapterById(chapterId);
  if (!chapter?.story) {
    return { chapter: null, inspection: null };
  }

  const fallbackUrl = chapter.fallbackUrl?.trim();
  if (!fallbackUrl) {
    await updateStorySourceChapterRecovery({
      chapterId,
      recoveryStatus: "fallback_pending",
      recoveryNote: "Add a fallback URL before inspection.",
      fallbackLastCheckedAt: new Date(),
      fallbackContentLength: 0,
    });
    revalidateStoryLibraryPaths(chapter.storyId, chapter.id);
    return { chapter, inspection: null };
  }

  const inspection = await inspectStoryLibraryFallbackUrl({
    fallbackUrl,
    expectedStoryTitle: chapter.story.title,
    expectedChapterNumber: chapter.chapterNumber,
    expectedChapterTitle: chapter.chapterTitle,
  });

  await updateStorySourceChapterRecovery({
    chapterId,
    fallbackUrl,
    fallbackSourceSite: inspection.fallbackSourceSite,
    fallbackContentLength: inspection.contentLength,
    fallbackLastCheckedAt: new Date(),
    recoveryStatus: inspection.verdict,
    recoveryNote: inspection.message,
  });
  revalidateStoryLibraryPaths(chapter.storyId, chapter.id);

  return { chapter, inspection };
}

export async function getStoryLibraryMissingChaptersAction(view: StoryLibraryMissingChaptersView = "unresolved") {
  const result = await db.execute<StoryLibraryMissingChapterRow>(sql`
    select
      ${storySourceChapters.id} as "chapterId",
      ${storySourceChapters.storyId} as "storyId",
      ${storySources.title} as "storyTitle",
      ${storySources.slug} as "storySlug",
      ${storySourceChapters.chapterNumber} as "chapterNumber",
      ${storySourceChapters.chapterTitle} as "chapterTitle",
      ${storySourceChapters.chapterUrl} as "primaryUrl",
      ${storySourceChapters.lastError} as "lastError",
      ${storySourceChapters.updatedAt} as "updatedAt",
      ${storySourceChapters.crawlStatus} as "crawlStatus",
      ${storySourceChapters.fallbackUrl} as "fallbackUrl",
      ${storySourceChapters.fallbackSourceSite} as "fallbackSourceSite",
      ${storySourceChapters.fallbackContentLength} as "fallbackContentLength",
      ${storySourceChapters.fallbackLastCheckedAt} as "fallbackLastCheckedAt",
      ${storySourceChapters.recoveryStatus} as "recoveryStatus",
      ${storySourceChapters.recoveryMethod} as "recoveryMethod",
      ${storySourceChapters.recoveryNote} as "recoveryNote",
      ${storySourceChapters.recoveredAt} as "recoveredAt",
      ${storySourceChapters.recoveredFromSourceSite} as "recoveredFromSourceSite",
      ${storySourceChapters.recoveredFromUrl} as "recoveredFromUrl",
      ${storySourceChapters.audioTextStatus} as "audioTextStatus",
      ${storySourceChapters.audioTextSource} as "audioTextSource",
      ${storySourceChapters.audioTextReviewedAt} as "audioTextReviewedAt",
      ${storySourceChapters.audioText} as "audioText"
    from ${storySourceChapters}
    inner join ${storySources}
      on ${storySources.id} = ${storySourceChapters.storyId}
    where ${storySourceChapters.lastError} = 'source_missing_chapter'
       or ${storySourceChapters.recoveryStatus} is not null
    order by
      case
        when ${storySourceChapters.recoveryStatus} = 'imported' then 1
        when ${storySourceChapters.recoveryStatus} = 'rejected' then 2
        else 0
      end,
      ${storySourceChapters.updatedAt} desc,
      ${storySourceChapters.chapterNumber} asc
  `);

  const hydratedRows = result.rows.map((row) => {
    const chapterNumber = Number(row.chapterNumber);
    const { audioText, ...rest } = row;
    return {
      ...rest,
      chapterNumber,
      fallbackContentLength: row.fallbackContentLength === null ? null : Number(row.fallbackContentLength),
      hasUnresolvedAudioTextBlockers: hasUnresolvedAudioTextBlockers({ audioTextStatus: row.audioTextStatus, audioText, chapterNumber }),
      suggestions: buildMissingChapterSuggestions({ storySlug: row.storySlug, chapterNumber }),
    };
  });

  const rows = hydratedRows.filter((row) => {
    if (view === "all") return true;
    return getStoryLibraryMissingChapterView(row) === view;
  });

  return {
    rows,
    summary: {
      // The audio-aware unresolved count — drives the default tab/badge. Excludes
      // chapters where a manual audio_text import is already in flight (needs
      // approval or blocked), since "nothing has been done yet" is a different
      // problem from "something was imported, it just needs a decision".
      unresolvedMissingForAudioCount: hydratedRows.filter((row) => getStoryLibraryMissingChapterView(row) === "unresolved").length,
      // Pure raw-source provenance count, independent of audio_text recovery state.
      rawMissingCount: hydratedRows.filter((row) => row.lastError === "source_missing_chapter").length,
      validFallbackCount: hydratedRows.filter((row) => row.recoveryStatus === "valid_fallback").length,
      importedCount: hydratedRows.filter((row) => row.recoveryStatus === "imported").length,
      audioTextRecoveredCount: hydratedRows.filter((row) => getStoryLibraryMissingChapterView(row) === "audio_text_recovered").length,
      audioTextNeedsApprovalCount: hydratedRows.filter((row) => getStoryLibraryMissingChapterView(row) === "audio_text_needs_approval").length,
      audioTextBlockedCount: hydratedRows.filter((row) => getStoryLibraryMissingChapterView(row) === "audio_text_blocked").length,
      rejectedCount: hydratedRows.filter((row) => row.recoveryStatus === "rejected").length,
      needsManualRecoveryCount: hydratedRows.filter((row) =>
        getStoryLibraryMissingChapterView(row) === "unresolved" &&
        row.lastError === "source_missing_chapter" &&
        row.recoveryStatus !== "imported" &&
        row.recoveryStatus !== "valid_fallback"
      ).length,
    },
  };
}

export async function attachStoryLibraryFallbackUrlAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  const fallbackUrl = String(formData.get("fallback_url") ?? "").trim();
  if (!chapterId) return;

  const fallbackSourceSite = normalizeRecoverySourceSite(fallbackUrl);
  const chapter = await getMissingChapterById(chapterId);
  if (!chapter?.story) return;

  if (!fallbackUrl || !fallbackSourceSite) {
    await updateStorySourceChapterRecovery({
      chapterId,
      fallbackUrl: fallbackUrl || null,
      fallbackSourceSite: fallbackSourceSite || null,
      recoveryStatus: "fallback_pending",
      recoveryNote: "Enter a valid fallback URL to inspect.",
      fallbackContentLength: null,
      fallbackLastCheckedAt: null,
    });
    revalidateStoryLibraryPaths(chapter.storyId, chapter.id);
    return;
  }

  await updateStorySourceChapterRecovery({
    chapterId,
    fallbackUrl,
    fallbackSourceSite,
    recoveryStatus: "fallback_pending",
    recoveryNote: `Fallback URL saved for inspection (${fallbackSourceSite}).`,
    fallbackContentLength: null,
    fallbackLastCheckedAt: null,
    recoveredAt: null,
    recoveredFromSourceSite: null,
    recoveredFromUrl: null,
  });
  revalidateStoryLibraryPaths(chapter.storyId, chapter.id);
}

export async function inspectStoryLibraryFallbackAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  if (!chapterId) return;
  await inspectMissingChapterFallback(chapterId);
}

export async function importStoryLibraryFallbackAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  if (!chapterId) return;

  const { chapter, inspection } = await inspectMissingChapterFallback(chapterId);
  if (!chapter?.story || !inspection || inspection.verdict !== "valid_fallback" || !inspection.contentText) {
    return;
  }

  await saveStorySourceChapterContent({
    chapterId,
    chapterTitle: chapter.chapterTitle ?? inspection.chapterTitle ?? `Chương ${chapter.chapterNumber}`,
    chapterNumber: chapter.chapterNumber,
    contentText: inspection.contentText,
    wordCount: inspection.wordCount,
    recovery: {
      sourceSite: inspection.fallbackSourceSite,
      url: inspection.fallbackUrl,
      method: "fallback_source",
      note: `Recovered from ${inspection.fallbackSourceSite}.`,
      fallbackContentLength: inspection.contentLength,
    },
  });
  await refreshStorySourceStats(chapter.storyId);
  revalidateStoryLibraryPaths(chapter.storyId, chapter.id);
}

export async function rejectStoryLibraryFallbackAction(formData: FormData) {
  const chapterId = String(formData.get("chapter_id") ?? "");
  if (!chapterId) return;

  const chapter = await getMissingChapterById(chapterId);
  if (!chapter?.story) return;

  await updateStorySourceChapterRecovery({
    chapterId,
    recoveryStatus: "rejected",
    recoveryNote: "Fallback rejected by admin.",
    fallbackLastCheckedAt: new Date(),
  });
  revalidateStoryLibraryPaths(chapter.storyId, chapter.id);
}

export async function getStoryLibraryCrawlMonitorAction(filters?: {
  attentionOnly?: boolean;
  level?: "all" | "info" | "warn" | "error";
  eventType?: string;
  hideQueued?: boolean;
}) {
  const eventConditions = [];

  if (filters?.attentionOnly) {
    eventConditions.push(
      or(
        eq(storyCrawlEvents.level, "error"),
        inArray(storyCrawlEvents.eventType, [...ATTENTION_EVENT_TYPES])
      )
    );
  }

  if (filters?.level && filters.level !== "all") {
    eventConditions.push(eq(storyCrawlEvents.level, filters.level));
  }

  if (filters?.eventType) {
    eventConditions.push(eq(storyCrawlEvents.eventType, filters.eventType));
  }

  if (filters?.hideQueued) {
    eventConditions.push(sql`${storyCrawlEvents.eventType} <> 'queued_chapter'`);
  }

  const [activeRun, recentRuns, recentEvents, eventTypeRows, runs24hResult, events24hResult, cadenceResult] = await Promise.all([
    db.query.storyCrawlRuns.findFirst({
      where: eq(storyCrawlRuns.status, "running"),
      orderBy: [desc(storyCrawlRuns.startedAt)],
    }),
    db.query.storyCrawlRuns.findMany({
      orderBy: [desc(storyCrawlRuns.startedAt)],
      limit: 20,
    }),
    db.query.storyCrawlEvents.findMany({
      where: eventConditions.length > 0 ? and(...eventConditions) : undefined,
      orderBy: [desc(storyCrawlEvents.createdAt)],
      limit: 100,
      with: {
        run: true,
      },
    }),
    db
      .selectDistinct({ eventType: storyCrawlEvents.eventType })
      .from(storyCrawlEvents)
      .orderBy(asc(storyCrawlEvents.eventType)),
    db.execute(sql`
      select
        count(*)::int as "runsLast24h",
        count(*) filter (where ${storyCrawlRuns.status} = 'completed')::int as "completedRunsLast24h",
        count(*) filter (where ${storyCrawlRuns.status} = 'failed')::int as "failedRunsLast24h",
        count(*) filter (
          where ${storyCrawlRuns.mode} in ('catalog', 'story')
        )::int as "catalogIndexingRunsLast24h",
        count(*) filter (
          where ${storyCrawlRuns.mode} in ('chapters', 'resume', 'retry_failed')
        )::int as "chapterTextRunsLast24h",
        coalesce(sum(${storyCrawlRuns.succeededChapters}), 0)::int as "chaptersCrawledLast24h"
      from ${storyCrawlRuns}
      where ${storyCrawlRuns.startedAt} >= now() - interval '24 hours'
    `),
    db.execute(sql`
      select
        count(*) filter (where ${storyCrawlEvents.eventType} = 'skipped_overlap')::int as "skippedOverlapLast24h",
        count(*) filter (where ${storyCrawlEvents.eventType} = 'stale_lock_replaced')::int as "staleLockReplacedLast24h",
        count(*) filter (where ${storyCrawlEvents.eventType} = 'failed_request')::int as "failedRequestLast24h",
        count(*) filter (where ${storyCrawlEvents.eventType} = 'blocked_or_cloudflare_detected')::int as "blockedLast24h",
        count(*) filter (where ${storyCrawlEvents.eventType} = 'discovered_story')::int as "storiesDiscoveredLast24h",
        count(*) filter (where ${storyCrawlEvents.eventType} = 'updated_story')::int as "storiesIndexedLast24h",
        count(*) filter (where ${storyCrawlEvents.eventType} = 'queued_chapter')::int as "chapterLinksIndexedLast24h",
        max(case when ${storyCrawlEvents.eventType} = 'failed_request' then ${storyCrawlEvents.createdAt} else null end) as "lastFailedRequestAt",
        max(case when ${storyCrawlEvents.eventType} = 'blocked_or_cloudflare_detected' then ${storyCrawlEvents.createdAt} else null end) as "lastBlockedAt"
      from ${storyCrawlEvents}
      where ${storyCrawlEvents.createdAt} >= now() - interval '24 hours'
    `),
    db.execute(sql`
      select
        (
          select coalesce(max(coalesce(${storyCrawlRuns.finishedAt}, ${storyCrawlRuns.startedAt})), null)
          from ${storyCrawlRuns}
          where ${storyCrawlRuns.mode} = 'catalog'
            and ${storyCrawlRuns.status} = 'completed'
        ) as "lastSuccessfulCatalogRunAt",
        (
          select coalesce(max(coalesce(${storyCrawlRuns.finishedAt}, ${storyCrawlRuns.startedAt})), null)
          from ${storyCrawlRuns}
          where ${storyCrawlRuns.mode} in ('chapters', 'resume')
            and ${storyCrawlRuns.status} = 'completed'
        ) as "lastSuccessfulChapterRunAt",
        (
          select coalesce(max(coalesce(${storyCrawlRuns.finishedAt}, ${storyCrawlRuns.startedAt})), null)
          from ${storyCrawlRuns}
          where ${storyCrawlRuns.mode} = 'retry_failed'
            and ${storyCrawlRuns.status} = 'completed'
        ) as "lastSuccessfulRetryRunAt",
        (
          select count(*)::int
          from ${storySourceChapters}
          where ${storySourceChapters.crawlStatus} in ('queued', 'crawling', 'failed')
             or ${storySourceChapters.contentText} is null
        ) as "remainingChapterBacklog"
    `),
  ]);

  const runs24h = runs24hResult.rows[0] ?? {
    runsLast24h: 0,
    completedRunsLast24h: 0,
    failedRunsLast24h: 0,
    catalogIndexingRunsLast24h: 0,
    chapterTextRunsLast24h: 0,
    chaptersCrawledLast24h: 0,
  };
  const events24h = events24hResult.rows[0] ?? {
    skippedOverlapLast24h: 0,
    staleLockReplacedLast24h: 0,
    failedRequestLast24h: 0,
    blockedLast24h: 0,
    storiesDiscoveredLast24h: 0,
    storiesIndexedLast24h: 0,
    chapterLinksIndexedLast24h: 0,
    lastFailedRequestAt: null,
    lastBlockedAt: null,
  };

  const activeHeartbeat = activeRun?.heartbeatAt ? new Date(activeRun.heartbeatAt).getTime() : null;
  const activeRunStale = activeRun?.status === "running" && activeHeartbeat
    ? Date.now() - activeHeartbeat > 30 * 60 * 1000
    : false;

  const failedRequestLast24h = Number(events24h.failedRequestLast24h ?? 0);
  const blockedLast24h = Number(events24h.blockedLast24h ?? 0);
  const skippedOverlapLast24h = Number(events24h.skippedOverlapLast24h ?? 0);
  const staleLockReplacedLast24h = Number(events24h.staleLockReplacedLast24h ?? 0);
  const cadenceRow = cadenceResult.rows[0] ?? {};
  const lastSuccessfulCatalogRunAt = cadenceRow.lastSuccessfulCatalogRunAt ?? null;
  const lastSuccessfulChapterRunAt = cadenceRow.lastSuccessfulChapterRunAt ?? null;
  const lastSuccessfulRetryRunAt = cadenceRow.lastSuccessfulRetryRunAt ?? null;
  const remainingChapterBacklog = Number(cadenceRow.remainingChapterBacklog ?? 0);
  const currentWindowStartedAt = (() => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    if (!lastSuccessfulChapterRunAt) return twoHoursAgo;

    const latestSuccess = new Date(lastSuccessfulChapterRunAt);
    return latestSuccess.getTime() > twoHoursAgo.getTime() ? latestSuccess : twoHoursAgo;
  })();
  const minutesSinceLastSuccessfulChapterRun = lastSuccessfulChapterRunAt
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(lastSuccessfulChapterRunAt).getTime()) / (60 * 1000))
      )
    : null;
  const chapterFreshnessStatus =
    remainingChapterBacklog === 0
      ? "healthy"
      : minutesSinceLastSuccessfulChapterRun === null
        ? "problem"
        : minutesSinceLastSuccessfulChapterRun <= 45
          ? "healthy"
          : minutesSinceLastSuccessfulChapterRun <= 90
            ? "watch"
            : "problem";

  const currentWindowResult = await db.execute(sql`
    select
      count(*) filter (where ${storyCrawlEvents.eventType} = 'failed_request')::int as "failedRequestCurrentWindow",
      count(*) filter (where ${storyCrawlEvents.eventType} = 'blocked_or_cloudflare_detected')::int as "blockedCurrentWindow",
      count(*) filter (where ${storyCrawlEvents.eventType} = 'skipped_overlap')::int as "skippedOverlapCurrentWindow",
      count(*) filter (where ${storyCrawlEvents.eventType} = 'stale_lock_replaced')::int as "staleLockReplacedCurrentWindow"
    from ${storyCrawlEvents}
    where ${storyCrawlEvents.createdAt} >= ${currentWindowStartedAt}
  `);
  const currentWindow = currentWindowResult.rows[0] ?? {
    failedRequestCurrentWindow: 0,
    blockedCurrentWindow: 0,
    skippedOverlapCurrentWindow: 0,
    staleLockReplacedCurrentWindow: 0,
  };

  const failedRequestCurrentWindow = Number(currentWindow.failedRequestCurrentWindow ?? 0);
  const blockedCurrentWindow = Number(currentWindow.blockedCurrentWindow ?? 0);
  const skippedOverlapCurrentWindow = Number(currentWindow.skippedOverlapCurrentWindow ?? 0);
  const staleLockReplacedCurrentWindow = Number(currentWindow.staleLockReplacedCurrentWindow ?? 0);
  const hasFreshChapterSuccess = chapterFreshnessStatus === "healthy" || chapterFreshnessStatus === "watch";
  const hasResolvedHistoricalErrors =
    failedRequestLast24h > 0 &&
    failedRequestCurrentWindow === 0 &&
    Boolean(lastSuccessfulChapterRunAt) &&
    !activeRunStale &&
    blockedCurrentWindow === 0;

  const healthStatus =
    activeRunStale || blockedCurrentWindow > 0 || failedRequestCurrentWindow >= 2 || chapterFreshnessStatus === "problem"
      ? "problem"
      : failedRequestCurrentWindow > 0 ||
          skippedOverlapCurrentWindow > 0 ||
          staleLockReplacedCurrentWindow > 0 ||
          skippedOverlapLast24h > 0 ||
          staleLockReplacedLast24h > 0 ||
          hasResolvedHistoricalErrors
        ? "watch"
      : "healthy";

  const healthReason =
    healthStatus === "problem"
      ? activeRunStale
        ? "An active crawl heartbeat looks stale."
        : blockedCurrentWindow > 0
          ? "Blocked or Cloudflare signals were recorded in the current health window."
          : failedRequestCurrentWindow >= 2
            ? "Repeated failed_request events were recorded in the current health window."
            : "Chapter-text crawling is overdue relative to the safe schedule while backlog remains."
      : healthStatus === "watch"
        ? hasResolvedHistoricalErrors
          ? "Resolved historical errors exist in the last 24 hours, but recent chapter-text crawling is healthy."
          : failedRequestCurrentWindow > 0
            ? "A recent failed_request was seen, but it has not become a repeating problem."
            : "Overlap or stale-lock events were seen recently, but successful runs continue."
        : hasFreshChapterSuccess
          ? "Recent chapter-text success is fresh, with no current blocking signals or stale run."
          : "No blocking signals and no stale active heartbeat were detected.";

  return {
    activeRun,
    recentRuns,
    recentEvents: recentEvents.map((event) => {
      const formatted = formatStoryCrawlerEventMessage(event);
      return {
        ...event,
        displayMessage: formatted.summary,
        fullMessage: formatted.details,
      };
    }),
    eventTypes: eventTypeRows.map((row) => row.eventType).filter(Boolean),
    cadenceSummary: {
      catalogCadenceLabel: "Every 2 hours",
      chapterCadenceLabel: "Every 30 minutes",
      retryCadenceLabel: "Every 6 hours",
      lastSuccessfulCatalogRunAt,
      lastSuccessfulChapterRunAt,
      lastSuccessfulRetryRunAt,
      minutesSinceLastSuccessfulChapterRun,
      remainingChapterBacklog,
      chapterFreshnessStatus,
    },
    healthSummary: {
      status: healthStatus,
      reason: healthReason,
      activeRunStale,
      currentWindowStartedAt,
      failedRequestCurrentWindow,
      blockedCurrentWindow,
      skippedOverlapCurrentWindow,
      staleLockReplacedCurrentWindow,
      hasResolvedHistoricalErrors,
      runsLast24h: Number(runs24h.runsLast24h ?? 0),
      completedRunsLast24h: Number(runs24h.completedRunsLast24h ?? 0),
      failedRunsLast24h: Number(runs24h.failedRunsLast24h ?? 0),
      skippedOverlapLast24h,
      staleLockReplacedLast24h,
      failedRequestLast24h,
      blockedLast24h,
      chaptersCrawledLast24h: Number(runs24h.chaptersCrawledLast24h ?? 0),
      storiesDiscoveredLast24h: Number(events24h.storiesDiscoveredLast24h ?? 0),
      storiesIndexedLast24h: Number(events24h.storiesIndexedLast24h ?? 0),
      chapterLinksIndexedLast24h: Number(events24h.chapterLinksIndexedLast24h ?? 0),
      catalogIndexingRunsLast24h: Number(runs24h.catalogIndexingRunsLast24h ?? 0),
      chapterTextRunsLast24h: Number(runs24h.chapterTextRunsLast24h ?? 0),
    },
  };
}

export async function getStoryLibraryDashboardStatsAction() {
  const [overviewResult, sourceSiteResult, statusResult, catalogRunResult, chapterRunResult, todayResult] = await Promise.all([
    db.execute(sql`
      with story_rollup as (
        select
          ${storySources.id} as story_id,
          ${storySources.sourceSite} as source_site,
          ${storySources.status} as story_status,
          ${storySources.chapterCount} as chapter_count,
          ${storySources.crawledChapterCount} as crawled_chapter_count,
          ${storySources.totalWordCount} as total_word_count,
          ${storySources.crawlStatus} as crawl_status,
          count(*) filter (where ${storySourceChapters.crawlStatus} = 'failed')::int as failed_chapter_count,
          count(*) filter (where ${storySourceChapters.lastError} = 'source_missing_chapter')::int as missing_chapter_count,
          count(*) filter (where ${storySourceChapters.recoveryStatus} = 'imported')::int as recovered_chapter_count,
          count(*) filter (
            where ${storySourceChapters.lastError} = 'source_missing_chapter'
              and coalesce(${storySourceChapters.recoveryStatus}, '') not in ('imported', 'valid_fallback')
          )::int as needs_manual_recovery_count
        from ${storySources}
        left join ${storySourceChapters}
          on ${storySourceChapters.storyId} = ${storySources.id}
        group by ${storySources.id}
      )
      select
        count(*)::int as "totalStories",
        coalesce(sum(chapter_count), 0)::int as "totalIndexedChapters",
        coalesce(sum(crawled_chapter_count), 0)::int as "totalCrawledChapters",
        coalesce(sum(failed_chapter_count), 0)::int as "totalFailedChapters",
        coalesce(sum(total_word_count), 0)::int as "totalWordCount",
        count(*) filter (where crawl_status in ('queued', 'crawling'))::int as "pendingStories",
        count(*) filter (where crawl_status = 'partial')::int as "partialStories",
        count(*) filter (where crawl_status = 'done')::int as "completedStories",
        count(*) filter (where crawl_status = 'failed')::int as "failedStories",
        count(*) filter (
          where lower(coalesce(story_status, '')) in ('đang ra', 'dang ra', 'ongoing', 'updating')
        )::int as "ongoingStories",
        count(*) filter (
          where lower(coalesce(story_status, '')) in ('full', 'completed', 'hoàn thành')
        )::int as "completedStatusStories",
        count(*) filter (
          where coalesce(nullif(trim(story_status), ''), '') = ''
             or lower(coalesce(story_status, '')) not in ('đang ra', 'dang ra', 'ongoing', 'updating', 'full', 'completed', 'hoàn thành')
        )::int as "unknownStatusStories",
        count(*) filter (where chapter_count = 0)::int as "storiesWithZeroChapters",
        count(*) filter (where failed_chapter_count > 0)::int as "storiesWithFailedChapters",
        count(*) filter (where missing_chapter_count > 0)::int as "storiesBlockedByMissingChapters",
        coalesce(sum(missing_chapter_count), 0)::int as "totalMissingChapters",
        coalesce(sum(recovered_chapter_count), 0)::int as "totalRecoveredChapters",
        coalesce(sum(needs_manual_recovery_count), 0)::int as "totalNeedsManualRecoveryChapters",
        count(*) filter (
          where crawled_chapter_count > 0
            and failed_chapter_count = 0
            and total_word_count > 0
        )::int as "storiesReadyForAudioCandidateCount"
      from story_rollup
    `),
    db.execute(sql`
      select
        ${storySources.sourceSite} as "sourceSite",
        count(*)::int as "storyCount"
      from ${storySources}
      group by ${storySources.sourceSite}
      order by count(*) desc, ${storySources.sourceSite} asc
    `),
    db.execute(sql`
      select
        case
          when lower(coalesce(${storySources.status}, '')) in ('đang ra', 'dang ra', 'ongoing', 'updating') then 'ongoing'
          when lower(coalesce(${storySources.status}, '')) in ('full', 'completed', 'hoàn thành') then 'completed'
          else 'unknown'
        end as "statusBucket",
        count(*)::int as "storyCount"
      from ${storySources}
      group by 1
      order by "storyCount" desc, "statusBucket" asc
    `),
    db.execute(sql`
      select coalesce(max(coalesce(${storyCrawlRuns.finishedAt}, ${storyCrawlRuns.startedAt})), null) as "lastCatalogCrawlAt"
      from ${storyCrawlRuns}
      where ${storyCrawlRuns.mode} = 'catalog'
        and ${storyCrawlRuns.status} <> 'skipped_overlap'
    `),
    db.execute(sql`
      select coalesce(max(coalesce(${storyCrawlRuns.finishedAt}, ${storyCrawlRuns.startedAt})), null) as "lastChapterCrawlAt"
      from ${storyCrawlRuns}
      where ${storyCrawlRuns.mode} in ('chapters', 'resume', 'retry_failed')
        and ${storyCrawlRuns.status} <> 'skipped_overlap'
    `),
    db.execute(sql`
      select
        (
          select count(*)::int
          from ${storySources}
          where ${storySources.createdAt} >= date_trunc('day', now())
        ) as "storiesDiscoveredToday",
        (
          select count(*)::int
          from ${storySourceChapters}
          where ${storySourceChapters.createdAt} >= date_trunc('day', now())
        ) as "chaptersIndexedToday",
        (
          select count(*)::int
          from ${storySourceChapters}
          where ${storySourceChapters.crawledAt} >= date_trunc('day', now())
        ) as "chaptersCrawledToday"
    `),
  ]);

  const overview = overviewResult.rows[0] ?? {};
  const today = todayResult.rows[0] ?? {};

  return {
    totals: {
      totalStories: Number(overview.totalStories ?? 0),
      totalIndexedChapters: Number(overview.totalIndexedChapters ?? 0),
      totalCrawledChapters: Number(overview.totalCrawledChapters ?? 0),
      totalFailedChapters: Number(overview.totalFailedChapters ?? 0),
      totalWordCount: Number(overview.totalWordCount ?? 0),
      pendingStories: Number(overview.pendingStories ?? 0),
      partialStories: Number(overview.partialStories ?? 0),
      completedStories: Number(overview.completedStories ?? 0),
      failedStories: Number(overview.failedStories ?? 0),
      ongoingStories: Number(overview.ongoingStories ?? 0),
      completedStatusStories: Number(overview.completedStatusStories ?? 0),
      unknownStatusStories: Number(overview.unknownStatusStories ?? 0),
      storiesDiscoveredToday: Number(today.storiesDiscoveredToday ?? 0),
      chaptersIndexedToday: Number(today.chaptersIndexedToday ?? 0),
      chaptersCrawledToday: Number(today.chaptersCrawledToday ?? 0),
      storiesWithZeroChapters: Number(overview.storiesWithZeroChapters ?? 0),
      storiesWithFailedChapters: Number(overview.storiesWithFailedChapters ?? 0),
      totalMissingChapters: Number(overview.totalMissingChapters ?? 0),
      totalRecoveredChapters: Number(overview.totalRecoveredChapters ?? 0),
      totalNeedsManualRecoveryChapters: Number(overview.totalNeedsManualRecoveryChapters ?? 0),
      storiesBlockedByMissingChapters: Number(overview.storiesBlockedByMissingChapters ?? 0),
      storiesReadyForAudioCandidateCount: Number(overview.storiesReadyForAudioCandidateCount ?? 0),
    },
    sourceSites: sourceSiteResult.rows.map((row) => ({
      sourceSite: String(row.sourceSite),
      storyCount: Number(row.storyCount ?? 0),
    })),
    storyStatuses: statusResult.rows.map((row) => ({
      status: String(row.statusBucket),
      storyCount: Number(row.storyCount ?? 0),
    })),
    lastCatalogCrawlAt: catalogRunResult.rows[0]?.lastCatalogCrawlAt ?? null,
    lastChapterCrawlAt: chapterRunResult.rows[0]?.lastChapterCrawlAt ?? null,
  };
}

export async function getStoryLibraryBacklogStatsAction() {
  const result = await db.execute(sql`
    with story_rollup as (
      select
        ${storySources.id} as story_id,
        ${storySources.chapterCount} as chapter_count,
        ${storySources.crawledChapterCount} as crawled_chapter_count
      from ${storySources}
    )
    select
      count(*) filter (
        where greatest(chapter_count - crawled_chapter_count, 0) > 0
      )::int as "storiesPendingChapterCrawl",
      coalesce(sum(greatest(chapter_count - crawled_chapter_count, 0)), 0)::int as "chaptersRemainingToCrawl",
      (
        select count(*)::int
        from ${storySourceChapters}
        where ${storySourceChapters.crawlStatus} = 'failed'
      ) as "failedChaptersWaitingRetry"
    from story_rollup
  `);

  const row = result.rows[0] ?? {};
  const chaptersRemainingToCrawl = Number(row.chaptersRemainingToCrawl ?? 0);
  // Derived from the actual configured chapter-text resume cadence: STORY_LIBRARY_MAX_CHAPTERS
  // default (20, see scripts/story-library/crawl-chapters-once.sh) on the 30-minute LaunchAgent
  // interval (48 runs/day). theoreticalPerDay assumes every run completes with zero overlap/
  // failure; conservativePerDay derates by the observed skipped_overlap/failure rate from the
  // post-fix validation window (~85% run success) rather than an arbitrary guess.
  const chapterTextMaxChaptersPerRun = 20;
  const chapterTextRunsPerDay = 48;
  const theoreticalPerDay = chapterTextMaxChaptersPerRun * chapterTextRunsPerDay;
  const conservativePerDay = Math.round(theoreticalPerDay * 0.85);

  return {
    storiesPendingChapterCrawl: Number(row.storiesPendingChapterCrawl ?? 0),
    chaptersRemainingToCrawl,
    failedChaptersWaitingRetry: Number(row.failedChaptersWaitingRetry ?? 0),
    conservativePerDay,
    theoreticalPerDay,
    etaDaysAtConservative: chaptersRemainingToCrawl > 0 ? Number((chaptersRemainingToCrawl / conservativePerDay).toFixed(1)) : 0,
    etaDaysAtTheoretical: chaptersRemainingToCrawl > 0 ? Number((chaptersRemainingToCrawl / theoreticalPerDay).toFixed(1)) : 0,
  };
}

export async function getStoryLibraryDiscoveryEstimateAction() {
  const result = await db.execute(sql`
    select
      (select count(*)::int from ${storySources}) as "storiesDiscoveredTotal",
      (
        select count(*)::int
        from ${storySources}
        where ${storySources.createdAt} >= now() - interval '24 hours'
      ) as "storiesDiscoveredLast24h",
      (select count(*)::int from ${storySourceChapters}) as "chapterLinksIndexedTotal",
      (
        select count(*)::int
        from ${storySourceChapters}
        where ${storySourceChapters.createdAt} >= now() - interval '24 hours'
      ) as "chapterLinksIndexedLast24h"
  `);

  const row = result.rows[0] ?? {};
  const storiesDiscoveredTotal = Number(row.storiesDiscoveredTotal ?? 0);
  const chapterLinksIndexedTotal = Number(row.chapterLinksIndexedTotal ?? 0);

  const catalogPaceStoriesPer2h = 50;
  const catalogCadenceHours = 2;
  const theoreticalMaxStoriesPerDay = Math.round((catalogPaceStoriesPer2h / catalogCadenceHours) * 24);

  return {
    storiesDiscoveredTotal,
    storiesDiscoveredLast24h: Number(row.storiesDiscoveredLast24h ?? 0),
    chapterLinksIndexedTotal,
    chapterLinksIndexedLast24h: Number(row.chapterLinksIndexedLast24h ?? 0),
    catalogPaceStoriesPer2h,
    catalogCadenceHours,
    theoreticalMaxStoriesPerDay,
    averageChapterLinksPerDiscoveredStory:
      storiesDiscoveredTotal > 0 ? Number((chapterLinksIndexedTotal / storiesDiscoveredTotal).toFixed(1)) : 0,
    fullSiteTotalKnown: false,
  };
}

export async function getStoryLibraryGenreStatsAction() {
  const result = await db.execute(sql`
    select
      genre_rows.genre as "genre",
      count(distinct ${storySources.id})::int as "storyCount",
      coalesce(sum(${storySources.crawledChapterCount}), 0)::int as "crawledChapterCount",
      coalesce(sum(${storySources.totalWordCount}), 0)::int as "totalWordCount"
    from ${storySources}
    cross join lateral jsonb_array_elements_text(${storySources.genres}) as genre_rows(genre)
    group by genre_rows.genre
  `);

  const rows = result.rows
    .map((row) => ({
      genre: String(row.genre),
      storyCount: Number(row.storyCount ?? 0),
      crawledChapterCount: Number(row.crawledChapterCount ?? 0),
      totalWordCount: Number(row.totalWordCount ?? 0),
    }))
    .filter((row) => row.genre);

  const byStoryCount = [...rows].sort((a, b) => b.storyCount - a.storyCount || a.genre.localeCompare(b.genre)).slice(0, 8);
  const byCrawledChapters = [...rows].sort((a, b) => b.crawledChapterCount - a.crawledChapterCount || a.genre.localeCompare(b.genre)).slice(0, 8);
  const byTotalWords = [...rows].sort((a, b) => b.totalWordCount - a.totalWordCount || a.genre.localeCompare(b.genre)).slice(0, 8);

  return {
    topByStoryCount: byStoryCount,
    topByCrawledChapters: byCrawledChapters,
    topByTotalWords: byTotalWords,
  };
}

export async function getStoryLibraryDedupeStatsAction() {
  const [sourceResult, duplicateTitleResult, duplicateTitleAuthorResult, duplicateChapterUrlResult, missingResult] = await Promise.all([
    db.execute(sql`
      select
        count(*)::int as "totalStorySourcesCount",
        count(distinct ${storySources.sourceUrl})::int as "distinctSourceUrlCount"
      from ${storySources}
    `),
    db.execute(sql`
      with normalized_titles as (
        select
          trim(regexp_replace(lower(coalesce(${storySources.title}, '')), '\s+', ' ', 'g')) as normalized_title
        from ${storySources}
      )
      select count(*)::int as "possibleDuplicateTitleCount"
      from (
        select normalized_title
        from normalized_titles
        where normalized_title <> ''
        group by normalized_title
        having count(*) > 1
      ) duplicates
    `),
    db.execute(sql`
      with normalized_title_authors as (
        select
          trim(regexp_replace(lower(coalesce(${storySources.title}, '')), '\s+', ' ', 'g')) as normalized_title,
          trim(regexp_replace(lower(coalesce(${storySources.author}, '')), '\s+', ' ', 'g')) as normalized_author
        from ${storySources}
        where coalesce(nullif(trim(${storySources.author}), ''), '') <> ''
      )
      select count(*)::int as "possibleDuplicateTitleAuthorCount"
      from (
        select normalized_title, normalized_author
        from normalized_title_authors
        where normalized_title <> '' and normalized_author <> ''
        group by normalized_title, normalized_author
        having count(*) > 1
      ) duplicates
    `),
    db.execute(sql`
      select coalesce(sum(duplicate_rows.duplicate_count - 1), 0)::int as "duplicateChapterUrlCount"
      from (
        select count(*)::int as duplicate_count
        from ${storySourceChapters}
        where coalesce(nullif(trim(${storySourceChapters.chapterUrl}), ''), '') <> ''
        group by ${storySourceChapters.chapterUrl}
        having count(*) > 1
      ) duplicate_rows
    `),
    db.execute(sql`
      select
        count(*) filter (where coalesce(nullif(trim(${storySources.sourceUrl}), ''), '') = '')::int as "storiesMissingSourceUrl",
        (
          select count(*)::int
          from ${storySourceChapters}
          where coalesce(nullif(trim(${storySourceChapters.chapterUrl}), ''), '') = ''
        ) as "chaptersMissingChapterUrl"
      from ${storySources}
    `),
  ]);

  return {
    distinctSourceUrlCount: Number(sourceResult.rows[0]?.distinctSourceUrlCount ?? 0),
    totalStorySourcesCount: Number(sourceResult.rows[0]?.totalStorySourcesCount ?? 0),
    possibleDuplicateTitleCount: Number(duplicateTitleResult.rows[0]?.possibleDuplicateTitleCount ?? 0),
    possibleDuplicateTitleAuthorCount: Number(duplicateTitleAuthorResult.rows[0]?.possibleDuplicateTitleAuthorCount ?? 0),
    duplicateChapterUrlCount: Number(duplicateChapterUrlResult.rows[0]?.duplicateChapterUrlCount ?? 0),
    storiesMissingSourceUrl: Number(missingResult.rows[0]?.storiesMissingSourceUrl ?? 0),
    chaptersMissingChapterUrl: Number(missingResult.rows[0]?.chaptersMissingChapterUrl ?? 0),
  };
}

// ── Story-level bulk audio text review (already-crawled chapters only) ──────────
// Never crawls new chapters. Never overwrites raw content_text.

async function listCrawledChaptersForAudioText(storyId: string) {
  return db.query.storySourceChapters.findMany({
    where: and(eq(storySourceChapters.storyId, storyId), eq(storySourceChapters.crawlStatus, "done")),
    orderBy: [asc(storySourceChapters.chapterNumber)],
  });
}

export type StoryLibraryAudioTextScanSummary = {
  totalScanned: number;
  passCount: number;
  warnCount: number;
  needsReviewCount: number;
  blockedCount: number;
  topIssueExamples: Array<{ chapterNumber: number; issueType: string; snippet: string; replacement: string | null }>;
};

function summarizeAudioTextAnalyses(
  analyses: Array<{ chapterNumber: number; status: AudioTextStatus; issues: ReturnType<typeof analyzeChapterAudioText>["issues"] }>
): StoryLibraryAudioTextScanSummary {
  const topIssueExamples = analyses
    .flatMap((a) => a.issues)
    .slice(0, 30)
    .map((issue) => ({
      chapterNumber: issue.chapterNumber ?? 0,
      issueType: issue.issueType,
      snippet: issue.snippet,
      replacement: issue.replacement,
    }));

  return {
    totalScanned: analyses.length,
    passCount: analyses.filter((a) => a.status === "pass").length,
    warnCount: analyses.filter((a) => a.status === "warn").length,
    needsReviewCount: analyses.filter((a) => a.status === "needs_review").length,
    blockedCount: analyses.filter((a) => a.status === "block").length,
    topIssueExamples,
  };
}

/** Read-only — does not persist anything. Always analyzes the raw content_text fresh. */
export async function scanStoryLibraryAudioTextAction(storyId: string): Promise<StoryLibraryAudioTextScanSummary> {
  const chapters = await listCrawledChaptersForAudioText(storyId);
  const analyses = chapters.map((chapter) => ({
    chapterNumber: chapter.chapterNumber,
    ...analyzeChapterAudioText({ text: chapter.contentText ?? "", chapterNumber: chapter.chapterNumber }),
  }));
  return summarizeAudioTextAnalyses(analyses);
}

/**
 * Writes a fresh audio_text + audio_text_status for every already-crawled chapter of
 * this story, derived from the immutable raw content_text. "Safe" describes the
 * operation (mechanical only, no rewriting/guessing) — every chapter gets a result,
 * including needs_review/blocked ones, so they're ready for single-chapter review.
 */
export async function bulkNormalizeStoryLibraryAudioTextAction(formData: FormData) {
  const storyId = String(formData.get("story_id") ?? "");
  if (!storyId) return;

  const chapters = await listCrawledChaptersForAudioText(storyId);
  for (const chapter of chapters) {
    // Never silently overwrite an explicit human approval (manual import or otherwise) —
    // re-deriving from raw would discard a deliberately curated/imported audio text.
    if (chapter.audioTextStatus === "approved") continue;

    const analysis = normalizeChapterAudioText({ text: chapter.contentText ?? "", chapterNumber: chapter.chapterNumber });
    await saveStorySourceChapterAudioText({
      chapterId: chapter.id,
      audioText: analysis.normalizedText,
      status: mapAnalyzerStatusToDbStatus(analysis.status),
      issueCount: analysis.stats.issueCount,
      normalizationVersion: AUDIO_TEXT_NORMALIZATION_VERSION,
    });
  }

  safeRevalidatePath(`/admin/story-library/${storyId}`);
}

export type StoryLibraryAudioTextReviewRow = {
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string | null;
  audioTextStatus: string;
  audioTextIssueCount: number;
  audioTextReviewNote: string | null;
};

/** Reads PERSISTED audio_text_status — run "Normalize" first so raw chapters get a status. */
export async function getStoryLibraryAudioTextReviewQueueAction(storyId: string): Promise<StoryLibraryAudioTextReviewRow[]> {
  const rows = await db.query.storySourceChapters.findMany({
    where: and(
      eq(storySourceChapters.storyId, storyId),
      eq(storySourceChapters.crawlStatus, "done"),
      inArray(storySourceChapters.audioTextStatus, ["needs_review", "blocked"])
    ),
    orderBy: [asc(storySourceChapters.chapterNumber)],
  });

  return rows.map((row) => ({
    chapterId: row.id,
    chapterNumber: row.chapterNumber,
    chapterTitle: row.chapterTitle,
    audioTextStatus: row.audioTextStatus,
    audioTextIssueCount: row.audioTextIssueCount,
    audioTextReviewNote: row.audioTextReviewNote,
  }));
}

export type StoryLibraryAudioTextStatusCounts = Record<"raw" | "normalized" | "needs_review" | "approved" | "blocked", number>;

export async function getStoryLibraryAudioTextStatusCountsAction(storyId: string): Promise<StoryLibraryAudioTextStatusCounts> {
  const result = await db.execute(sql`
    select ${storySourceChapters.audioTextStatus} as status, count(*)::int as c
    from ${storySourceChapters}
    where ${storySourceChapters.storyId} = ${storyId} and ${storySourceChapters.crawlStatus} = 'done'
    group by ${storySourceChapters.audioTextStatus}
  `);
  const counts: StoryLibraryAudioTextStatusCounts = { raw: 0, normalized: 0, needs_review: 0, approved: 0, blocked: 0 };
  for (const row of result.rows) {
    const status = String(row.status) as keyof StoryLibraryAudioTextStatusCounts;
    if (status in counts) counts[status] = Number(row.c ?? 0);
  }
  return counts;
}
