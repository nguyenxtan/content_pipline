/**
 * Safely queue the 7 rendered short-cover-intro-v1 videos for normal upload processing.
 *
 * Uses autoScheduleVideoAction(contentId, "short") — identical path to normal pipeline.
 *
 * Platform targets for phat_phap channel:
 *   - YouTube Shorts  (channel 1, Giới Định Tuệ)   — bulkScheduleAction
 *   - Facebook Reels  (channel 6, Trí Tuệ An Nhiên) — insertPhatPhapCampaignFbRow (anchored to YT slot)
 *
 * Dry-run by default. Pass --execute to actually queue.
 *
 * Guards (per item):
 *   - video file must exist on disk
 *   - not already in upload_queue (status queued/uploading/done/cancelled)
 *   - not already in published_videos
 *   - experiment_id = 'short-cover-intro-v1' and experiment_variant = 'intro_on_1p5s'
 *   - video_status = 'done'
 *
 * Output: output/short-cover-intro-queue/report.json
 *
 * No publish. No generation. No render. Read + queue only.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";
import { autoScheduleVideoAction } from "@/actions/social-channels";

const { Pool } = pg;

const CWD     = process.cwd();
const OUT_DIR = path.join(CWD, "output", "short-cover-intro-queue");
const REPORT  = path.join(OUT_DIR, "report.json");

const EXPERIMENT_ID      = "short-cover-intro-v1";
const EXPERIMENT_VARIANT = "intro_on_1p5s";
const MAX_QUEUE_CAP      = 7;
const EXECUTE            = process.argv.includes("--execute");

// Known platform targets for phat_phap short pipeline
const PLATFORM_TARGETS = [
  { platform: "youtube", channelId: 1, channelName: "Giới Định Tuệ", videoType: "short", mechanism: "bulkScheduleAction" },
  { platform: "facebook", channelId: 6, channelName: "Trí Tuệ An Nhiên", videoType: "short", mechanism: "insertPhatPhapCampaignFbRow (anchored to YT slot)" },
];

// ── Types ────────────────────────────────────────────────────────────────────

type QueueAction =
  | "would_queue"
  | "queued"
  | "skipped_already_queued"
  | "skipped_already_published"
  | "skipped_missing_video";

type RowReport = {
  contentId: string;
  topic: string | null;
  thumbnailText: string | null;
  channelKey: string | null;
  videoPath: string | null;
  videoFileExists: boolean;
  alreadyQueued: boolean;
  existingQueueStatus: string | null;
  alreadyPublished: boolean;
  queueAction: QueueAction;
  queueIds: { platform: string; channelName: string; queueId: string; scheduledAt: string | null }[];
  platformTargets: typeof PLATFORM_TARGETS;
  error?: string;
};

type RawRow = {
  id: string;
  topic: string | null;
  thumbnail_text: string | null;
  channel_key: string | null;
  video_path: string | null;
  video_status: string | null;
  experiment_id: string | null;
  experiment_variant: string | null;
  // upload_queue
  uq_id: string | null;
  uq_status: string | null;
  uq_platform: string | null;
  // published_videos
  pv_id: string | null;
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // ── 1. Fetch all rollout items with upload_queue + published_videos state ──
  const { rows } = await pool.query<RawRow>(`
    SELECT
      cg.id,
      cg.topic,
      cg.thumbnail_text,
      cg.channel_key,
      cg.video_path,
      cg.video_status,
      cg.experiment_id,
      cg.experiment_variant,
      -- latest upload_queue entry (any platform)
      uq.id     AS uq_id,
      uq.status AS uq_status,
      uq.platform AS uq_platform,
      -- published_videos presence (any platform)
      pv.id AS pv_id
    FROM content_generations cg
    LEFT JOIN LATERAL (
      SELECT id, status, platform FROM upload_queue
      WHERE content_id = cg.id
        AND video_type = 'short'
        AND status IN ('queued', 'uploading', 'done', 'cancelled')
      ORDER BY created_at DESC
      LIMIT 1
    ) uq ON true
    LEFT JOIN published_videos pv
      ON pv.content_id = cg.id
      AND pv.platform = 'youtube'
      AND pv.video_type = 'short'
    WHERE cg.experiment_id = $1
      AND cg.experiment_variant = $2
    ORDER BY cg.created_at DESC
  `, [EXPERIMENT_ID, EXPERIMENT_VARIANT]);

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  queue-short-cover-intro-rollout — ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`  Experiment: ${EXPERIMENT_ID} / ${EXPERIMENT_VARIANT}`);
  console.log(`  Found ${rows.length} rollout rows`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  // ── 2. Classify each row ──────────────────────────────────────────────────
  const rowReports: RowReport[] = rows.map((r) => {
    const videoFileExists = !!r.video_path && fs.existsSync(path.join(CWD, r.video_path));
    const alreadyQueued = r.uq_id !== null;
    const alreadyPublished = r.pv_id !== null;

    let queueAction: QueueAction;
    if (!videoFileExists) {
      queueAction = "skipped_missing_video";
    } else if (alreadyPublished) {
      queueAction = "skipped_already_published";
    } else if (alreadyQueued) {
      queueAction = "skipped_already_queued";
    } else {
      queueAction = EXECUTE ? "queued" : "would_queue";
    }

    return {
      contentId: r.id,
      topic: r.topic,
      thumbnailText: r.thumbnail_text,
      channelKey: r.channel_key,
      videoPath: r.video_path,
      videoFileExists,
      alreadyQueued,
      existingQueueStatus: r.uq_status,
      alreadyPublished,
      queueAction,
      queueIds: [],
      platformTargets: PLATFORM_TARGETS,
    };
  });

  // ── 3. Safety checks ───────────────────────────────────────────────────────
  const eligible = rowReports.filter((r) => r.queueAction === "would_queue" || r.queueAction === "queued");
  const skipped  = rowReports.filter((r) => r.queueAction !== "would_queue" && r.queueAction !== "queued");

  console.log(`Eligible to queue : ${eligible.length}`);
  console.log(`Skipped           : ${skipped.length}`);
  if (skipped.length > 0) {
    for (const r of skipped) {
      console.log(`  ⊘ ${r.contentId.slice(0, 8)} [${r.queueAction}] "${r.topic}"`);
    }
  }

  if (eligible.length > MAX_QUEUE_CAP) {
    console.error(`\n[ERROR] ${eligible.length} eligible items exceeds cap of ${MAX_QUEUE_CAP}. Aborting.`);
    process.exit(1);
  }

  // ── 4. Dry-run output ─────────────────────────────────────────────────────
  if (!EXECUTE) {
    console.log(`\n── Dry-run: would queue these ${eligible.length} items ──────────────────`);
    for (const r of eligible) {
      console.log(`  + ${r.contentId.slice(0, 8)} "${r.topic}" (thumb: ${r.thumbnailText})`);
      console.log(`    → YouTube Shorts  ch=1  (Giới Định Tuệ)`);
      console.log(`    → Facebook Reels  ch=6  (Trí Tuệ An Nhiên, anchored to YT slot)`);
    }
    console.log(`\n[platform targets] Both YouTube Shorts AND Facebook Reels.`);
    console.log(`[mechanism]        autoScheduleVideoAction(contentId, "short") — same as normal pipeline.`);
    console.log(`\n[dry-run] No DB writes. Run with --execute to queue.\n`);
  }

  // ── 5. Execute ────────────────────────────────────────────────────────────
  if (EXECUTE) {
    console.log(`\n── Executing: queueing ${eligible.length} items ────────────────────────`);

    for (const row of rowReports) {
      if (row.queueAction !== "queued") continue;

      console.log(`  → ${row.contentId.slice(0, 8)} "${row.topic}"`);

      const before = Date.now();
      try {
        await autoScheduleVideoAction(row.contentId, "short");

        // Query the newly created queue rows for this content
        const { rows: newQueueRows } = await pool.query<{
          id: string;
          platform: string;
          channel_id: number;
          status: string;
          scheduled_at: Date | null;
        }>(`
          SELECT uq.id, uq.platform, uq.channel_id, uq.status, uq.scheduled_at
          FROM upload_queue uq
          WHERE uq.content_id = $1
            AND uq.video_type = 'short'
            AND uq.status IN ('queued', 'uploading')
          ORDER BY uq.created_at DESC
        `, [row.contentId]);

        const channelNames: Record<number, string> = { 1: "Giới Định Tuệ", 6: "Trí Tuệ An Nhiên" };

        row.queueIds = newQueueRows.map((q) => ({
          platform: q.platform,
          channelName: channelNames[q.channel_id] ?? `ch=${q.channel_id}`,
          queueId: q.id,
          scheduledAt: q.scheduled_at ? new Date(q.scheduled_at).toISOString() : null,
        }));

        const ms = Date.now() - before;
        if (row.queueIds.length > 0) {
          console.log(`    ✓ ${ms}ms — queued to ${row.queueIds.length} destination(s):`);
          for (const q of row.queueIds) {
            console.log(`      [${q.platform}] ${q.channelName}  queueId=${q.queueId}  scheduledAt=${q.scheduledAt}`);
          }
        } else {
          console.log(`    ⚠  ${ms}ms — autoScheduleVideoAction completed but no new queued rows found.`);
          console.log(`       (May have been skipped by safety checks — check logs above.)`);
          row.queueAction = "skipped_already_queued";
          row.error = "No new queued rows created by autoScheduleVideoAction.";
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`    ✗ Error: ${msg}`);
        row.error = msg;
        row.queueAction = "would_queue"; // revert to indicate not actually queued
      }
    }
  }

  // ── 6. Write report ───────────────────────────────────────────────────────
  const queuedCount    = rowReports.filter((r) => r.queueAction === "queued").length;
  const wouldQueueCount = rowReports.filter((r) => r.queueAction === "would_queue").length;
  const skippedQueued  = rowReports.filter((r) => r.queueAction === "skipped_already_queued").length;
  const skippedPublished = rowReports.filter((r) => r.queueAction === "skipped_already_published").length;
  const skippedVideo   = rowReports.filter((r) => r.queueAction === "skipped_missing_video").length;
  const errored        = rowReports.filter((r) => r.error !== undefined).length;

  const summary = {
    mode:               EXECUTE ? "execute" : "dry_run",
    experimentId:       EXPERIMENT_ID,
    experimentVariant:  EXPERIMENT_VARIANT,
    total:              rowReports.length,
    eligible:           eligible.length,
    queued:             queuedCount,
    wouldQueue:         wouldQueueCount,
    skippedAlreadyQueued: skippedQueued,
    skippedAlreadyPublished: skippedPublished,
    skippedMissingVideo: skippedVideo,
    errors:             errored,
    platformTargets:    PLATFORM_TARGETS,
    note: "Platform targets: YouTube Shorts (ch 1) + Facebook Reels (ch 6). Both are queued by autoScheduleVideoAction(contentId, 'short') — normal pipeline path for phat_phap channel.",
  };

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    rows: rowReports,
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf-8");

  // ── 7. Console summary ────────────────────────────────────────────────────
  console.log(`\n── Summary ─────────────────────────────────────────────`);
  console.log(`  Mode     : ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`  Total    : ${rowReports.length}`);
  if (EXECUTE) {
    console.log(`  Queued   : ${queuedCount}`);
    if (errored > 0) console.log(`  Errors   : ${errored}`);
  } else {
    console.log(`  Would Q  : ${wouldQueueCount}`);
  }
  if (skippedQueued)    console.log(`  ⊘ Already queued : ${skippedQueued}`);
  if (skippedPublished) console.log(`  ⊘ Already published : ${skippedPublished}`);
  if (skippedVideo)     console.log(`  ⊘ Missing video  : ${skippedVideo}`);
  console.log(`  Platforms: YouTube Shorts (ch 1) + Facebook Reels (ch 6)`);
  console.log(`\n[report] ${REPORT}\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
