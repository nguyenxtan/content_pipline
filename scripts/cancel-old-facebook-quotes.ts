import { config as loadEnv } from "dotenv";

import fs from "fs";
import path from "path";
import pg from "pg";
import {
  buildFacebookQuoteText,
  buildSafeFacebookCaption,
  validateFacebookCaption,
} from "@/lib/social/youtube-metadata";
import { resolveFacebookQuoteImageSource } from "@/lib/social/facebook-quote-source";

loadEnv({ path: ".env.local" });
loadEnv();

const { Pool } = pg;

const EXECUTE = process.argv.includes("--execute");
const EXPECTED_COUNT_ARG = process.argv.find((arg) => arg.startsWith("--expected-count="));
const EXPECTED_COUNT = EXPECTED_COUNT_ARG ? Number.parseInt(EXPECTED_COUNT_ARG.split("=")[1] ?? "", 10) : null;
const CANCELLATION_REASON = "old_facebook_quote_backlog_cleanup";
const AGE_THRESHOLD_HOURS = 48;
const REPORT_PATH = path.join(process.cwd(), "output", "manifests", "facebook-quote-cancel-dry-run.json");

type QueueCandidateRow = {
  queue_id: string;
  content_id: string;
  channel_id: number;
  scheduled_at: Date;
  created_at: Date;
  updated_at: Date;
  title: string;
  description: string;
  topic: string;
  niche_name: string;
  content_profile_key: string | null;
  short_content: string;
  image_paths: string[] | null;
  youtube_video_url: string | null;
  facebook_video_url: string | null;
  experiment_id: string | null;
  experiment_variant: string | null;
  has_youtube_published_video: boolean;
  has_facebook_published_video: boolean;
  has_queued_facebook_short: boolean;
};

type CapacitySnapshot = {
  pendingUploadCount: number;
  failedUploadCount: number;
  unpublishedRenderedCount: number;
  thresholds: {
    maxPendingUploadQueue: number;
    maxUnpublishedRendered: number;
  };
  violations: Array<{ reason: string; message: string; current: number; threshold: number }>;
  isHealthy: boolean;
};

type CandidateEvaluation = {
  queueId: string;
  contentId: string;
  topic: string;
  scheduledAt: string;
  createdAt: string;
  createdAgeHours: number;
  sourceImageMode: "original" | "short_thumb_fallback";
  captionValid: boolean;
  safeToCancel: boolean;
  skipReasons: string[];
  youtubePublished: boolean;
  hasQueuedFacebookShort: boolean;
  experimentId: string | null;
  experimentVariant: string | null;
};

function createPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

function ageHours(from: Date, to = new Date()): number {
  return Math.round((((to.getTime() - new Date(from).getTime()) / 36e5) * 10)) / 10;
}

async function loadPendingFacebookQuotes(client: pg.PoolClient): Promise<QueueCandidateRow[]> {
  const result = await client.query<QueueCandidateRow>(
    `
      SELECT
        uq.id AS queue_id,
        uq.content_id,
        uq.channel_id,
        uq.scheduled_at,
        uq.created_at,
        uq.updated_at,
        uq.title,
        uq.description,
        cg.topic,
        cg.niche_name,
        cg.content_profile_key,
        cg.short_content,
        cg.image_paths,
        cg.youtube_video_url,
        cg.facebook_video_url,
        cg.experiment_id,
        cg.experiment_variant,
        EXISTS (
          SELECT 1
          FROM published_videos pv
          WHERE pv.content_id = cg.id
            AND pv.platform = 'youtube'
        ) AS has_youtube_published_video,
        EXISTS (
          SELECT 1
          FROM published_videos pv
          WHERE pv.content_id = cg.id
            AND pv.platform = 'facebook'
        ) AS has_facebook_published_video,
        EXISTS (
          SELECT 1
          FROM upload_queue uq_short
          WHERE uq_short.content_id = cg.id
            AND uq_short.platform = 'facebook'
            AND uq_short.video_type = 'short'
            AND uq_short.status = 'queued'
        ) AS has_queued_facebook_short
      FROM upload_queue uq
      INNER JOIN content_generations cg ON cg.id = uq.content_id
      WHERE uq.platform = 'facebook'
        AND uq.video_type = 'quote'
        AND uq.status = 'queued'
      ORDER BY uq.created_at ASC, uq.scheduled_at ASC
    `,
  );
  return result.rows;
}

async function loadCounts(client: pg.PoolClient): Promise<{
  facebookQuotePending: number;
  facebookReelPending: number;
  allPlatformPending: number;
}> {
  const result = await client.query<{
    facebook_quote_pending: number;
    facebook_reel_pending: number;
    all_platform_pending: number;
  }>(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE platform = 'facebook'
            AND video_type = 'quote'
            AND status = 'queued'
        )::int AS facebook_quote_pending,
        COUNT(*) FILTER (
          WHERE platform = 'facebook'
            AND video_type = 'short'
            AND status = 'queued'
        )::int AS facebook_reel_pending,
        COUNT(*) FILTER (
          WHERE status IN ('queued', 'uploading')
        )::int AS all_platform_pending
      FROM upload_queue
    `,
  );
  const row = result.rows[0];
  return {
    facebookQuotePending: Number(row?.facebook_quote_pending ?? 0),
    facebookReelPending: Number(row?.facebook_reel_pending ?? 0),
    allPlatformPending: Number(row?.all_platform_pending ?? 0),
  };
}

function evaluateRows(rows: QueueCandidateRow[]): CandidateEvaluation[] {
  return rows.map((row) => {
    const imagePaths = Array.isArray(row.image_paths) ? row.image_paths : [];
    const quoteSource = resolveFacebookQuoteImageSource({
      contentId: row.content_id,
      imagePaths,
    });
    const rawCaption = [
      buildFacebookQuoteText({
        topic: row.topic,
        shortContent: row.short_content,
        contentProfileKey: row.content_profile_key,
      }),
      row.description || "",
    ].filter(Boolean).join("\n\n");
    const safeCaption = buildSafeFacebookCaption(rawCaption);
    const captionValidation = validateFacebookCaption(safeCaption);

    const createdAge = ageHours(row.created_at);
    const youtubePublished = Boolean(row.youtube_video_url || row.has_youtube_published_video);
    const skipReasons: string[] = [];

    if (!youtubePublished) skipReasons.push("youtube_not_published");
    if (row.facebook_video_url || row.has_facebook_published_video) skipReasons.push("already_published_on_facebook");
    if (!quoteSource.ok) skipReasons.push("missing_source_image");
    if (!captionValidation.ok) skipReasons.push("caption_invalid_after_safe_builder");
    if (createdAge <= AGE_THRESHOLD_HOURS) skipReasons.push("queue_age_below_threshold");
    if (row.has_queued_facebook_short) skipReasons.push("paired_facebook_reel_queued");
    if (row.experiment_id || row.experiment_variant) skipReasons.push("experiment_tagged");

    return {
      queueId: row.queue_id,
      contentId: row.content_id,
      topic: row.topic,
      scheduledAt: row.scheduled_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      createdAgeHours: createdAge,
      sourceImageMode: quoteSource.ok ? quoteSource.sourceImageMode : "short_thumb_fallback",
      captionValid: captionValidation.ok,
      safeToCancel: skipReasons.length === 0,
      skipReasons,
      youtubePublished,
      hasQueuedFacebookShort: row.has_queued_facebook_short,
      experimentId: row.experiment_id,
      experimentVariant: row.experiment_variant,
    };
  });
}

function simulateCapacityAfterCancellation(
  currentCapacity: CapacitySnapshot,
  selectedCount: number,
): {
  pendingAfter: number;
  statusAfter: "ALLOWED" | "PAUSED";
  violationsAfter: string[];
} {
  const pendingAfter = Math.max(0, currentCapacity.pendingUploadCount - selectedCount);
  const otherViolations = currentCapacity.violations.filter((violation) => violation.reason !== "upload_queue_too_large");
  const violationsAfter = [...otherViolations.map((violation) => violation.message)];
  if (pendingAfter > currentCapacity.thresholds.maxPendingUploadQueue) {
    violationsAfter.unshift(
      `Upload queue has ${pendingAfter} pending items (threshold ${currentCapacity.thresholds.maxPendingUploadQueue})`,
    );
  }

  return {
    pendingAfter,
    statusAfter: violationsAfter.length === 0 ? "ALLOWED" : "PAUSED",
    violationsAfter,
  };
}

async function cancelRows(
  client: pg.PoolClient,
  queueIds: string[],
): Promise<number> {
  if (queueIds.length === 0) return 0;
  const result = await client.query(
    `
      UPDATE upload_queue
      SET
        status = 'cancelled',
        error_message = $2,
        updated_at = NOW()
      WHERE id = ANY($1::text[])
        AND status = 'queued'
    `,
    [queueIds, CANCELLATION_REASON],
  );
  return result.rowCount ?? 0;
}

async function main(): Promise<void> {
  const pool = createPool();
  const client = await pool.connect();

  try {
    const { getProductionCapacityStatus } = await import("@/lib/production-capacity");
    const beforeCounts = await loadCounts(client);
    const currentCapacity = await getProductionCapacityStatus();
    const quoteRows = await loadPendingFacebookQuotes(client);
    const evaluations = evaluateRows(quoteRows);

    const selected = evaluations.filter((row) => row.safeToCancel);
    const skipped = evaluations.filter((row) => !row.safeToCancel);
    const skippedByReason = skipped.reduce<Record<string, number>>((acc, row) => {
      for (const reason of row.skipReasons) {
        acc[reason] = (acc[reason] ?? 0) + 1;
      }
      return acc;
    }, {});

    const simulated = simulateCapacityAfterCancellation(
      currentCapacity as CapacitySnapshot,
      selected.length,
    );

    const dryRunPayload = {
      generatedAt: new Date().toISOString(),
      execute: EXECUTE,
      cancellationReason: CANCELLATION_REASON,
      beforeCounts,
      selectedCount: selected.length,
      selectedQueueIds: selected.map((row) => row.queueId),
      selected: selected.slice(0, 100),
      skippedCount: skipped.length,
      skippedByReason,
      skippedSample: skipped.slice(0, 40),
      simulatedAfter: {
        facebookQuotePending: Math.max(0, beforeCounts.facebookQuotePending - selected.length),
        facebookReelPending: beforeCounts.facebookReelPending,
        allPlatformPending: simulated.pendingAfter,
        capacityStatus: simulated.statusAfter,
        violations: simulated.violationsAfter,
      },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(dryRunPayload, null, 2), "utf8");

    console.log(`dry-run report: ${path.relative(process.cwd(), REPORT_PATH)}`);
    console.log(`facebook quote pending before: ${beforeCounts.facebookQuotePending}`);
    console.log(`facebook reel pending before: ${beforeCounts.facebookReelPending}`);
    console.log(`all-platform pending before: ${beforeCounts.allPlatformPending}`);
    console.log(`selected safe_to_cancel_old_quote rows: ${selected.length}`);
    console.log(`facebook quote pending after (simulated): ${Math.max(0, beforeCounts.facebookQuotePending - selected.length)}`);
    console.log(`facebook reel pending after (simulated): ${beforeCounts.facebookReelPending}`);
    console.log(`all-platform pending after (simulated): ${simulated.pendingAfter}`);
    console.log(`capacity after (simulated): ${simulated.statusAfter}`);
    if (Object.keys(skippedByReason).length > 0) {
      console.log(`skipped reasons: ${JSON.stringify(skippedByReason)}`);
    }

    if (!EXECUTE) return;
    if (EXPECTED_COUNT != null && selected.length !== EXPECTED_COUNT) {
      throw new Error(`Refusing execute because dry-run selected ${selected.length} rows instead of expected ${EXPECTED_COUNT}.`);
    }

    await client.query("BEGIN");
    try {
      const updated = await cancelRows(client, selected.map((row) => row.queueId));
      await client.query("COMMIT");

      const afterCounts = await loadCounts(client);
      const capacityAfter = await getProductionCapacityStatus();

      console.log("");
      console.log("execute summary");
      console.log(`rows cancelled: ${updated}`);
      console.log(`facebook quote pending after: ${afterCounts.facebookQuotePending}`);
      console.log(`facebook reel pending after: ${afterCounts.facebookReelPending}`);
      console.log(`all-platform pending after: ${afterCounts.allPlatformPending}`);
      console.log(`capacity after: ${capacityAfter.isHealthy ? "ALLOWED" : "PAUSED"}`);
      if (!capacityAfter.isHealthy) {
        for (const violation of capacityAfter.violations) {
          console.log(`violation: ${violation.message}`);
        }
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
