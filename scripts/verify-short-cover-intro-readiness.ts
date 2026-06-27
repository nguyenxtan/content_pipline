/**
 * Read-only monitor for short-cover-intro-v1 rollout publish/analytics readiness.
 *
 * Joins:
 *   content_generations
 *     → upload_queue        (platform=youtube, video_type=short)
 *     → published_videos    (platform=youtube, video_type=short)
 *     → video_metric_snapshots (latest per published video)
 *
 * For each intro row, determines:
 *   readinessStatus: rendered_not_queued | queued_not_published | published_waiting_48h
 *                  | analytics_ready | blocked_missing_video | blocked_publish_failed | unknown
 *
 * No DB writes. No generation. No publish. Pure read + report.
 *
 * Output: output/short-cover-intro-readiness/report.json
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";

const { Pool } = pg;

const CWD     = process.cwd();
const OUT_DIR = path.join(CWD, "output", "short-cover-intro-readiness");
const REPORT  = path.join(OUT_DIR, "report.json");

const ANALYTICS_READY_HOURS = 48;
const EXPERIMENT_ID         = "short-cover-intro-v1";
const EXPERIMENT_VARIANT    = "intro_on_1p5s";

// ── Types ────────────────────────────────────────────────────────────────────

type RawRow = {
  // content_generations
  id: string;
  topic: string | null;
  thumbnail_text: string | null;
  experiment_id: string | null;
  experiment_variant: string | null;
  video_status: string | null;
  video_path: string | null;
  youtube_video_url: string | null;
  created_at: Date;
  // upload_queue (may be null if not queued)
  uq_id: string | null;
  uq_status: string | null;
  uq_platform: string | null;
  uq_video_type: string | null;
  uq_scheduled_at: Date | null;
  uq_uploaded_at: Date | null;
  uq_error_message: string | null;
  uq_platform_video_url: string | null;
  // published_videos (may be null if not published)
  pv_id: string | null;
  pv_platform_video_id: string | null;
  pv_platform_video_url: string | null;
  published_at: Date | null;
  latest_view_count: string | null; // bigint → string from pg
  latest_like_count: string | null;
  latest_fetched_at: Date | null;
  // video_metric_snapshots latest (may be null)
  snap_view_count: string | null;
  snap_retention_pct: string | null;
  snap_avg_view_duration_sec: number | null;
  snap_fetched_at: Date | null;
};

type ReadinessStatus =
  | "rendered_not_queued"
  | "queued_not_published"
  | "published_waiting_48h"
  | "analytics_ready"
  | "blocked_missing_video"
  | "blocked_publish_failed"
  | "unknown";

type RowReport = {
  contentId: string;
  topic: string | null;
  thumbnailText: string | null;
  videoStatus: string | null;
  videoPath: string | null;
  videoFileExists: boolean;
  uploadQueueStatus: string | null;
  uploadQueueScheduledAt: string | null;
  uploadQueueErrorMessage: string | null;
  publishedVideoId: string | null;
  youtubeUrl: string | null;
  publishedAt: string | null;
  hoursSincePublish: number | null;
  hasMetricSnapshot: boolean;
  latestViews: number | null;
  latestRetentionPct: number | null;
  latestAvgViewDurationSec: number | null;
  analyticsReady: boolean;
  readinessStatus: ReadinessStatus;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function hoursSince(date: Date | null): number | null {
  if (!date) return null;
  return parseFloat(((Date.now() - new Date(date).getTime()) / 3_600_000).toFixed(1));
}

function toNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function classifyRow(r: RawRow, videoFileExists: boolean): ReadinessStatus {
  // Video file missing
  if (!r.video_path || !videoFileExists) return "blocked_missing_video";

  // Upload queue shows a hard error
  if (r.uq_status === "error") return "blocked_publish_failed";

  // Not yet queued
  if (!r.uq_id) return "rendered_not_queued";

  // Queued but not yet in published_videos
  if (!r.pv_id) {
    if (r.uq_status === "done") return "queued_not_published"; // uploaded but pv row missing (rare)
    return "queued_not_published";
  }

  // Published — check age
  const hours = hoursSince(r.published_at);
  if (hours === null) return "unknown";

  if (hours < ANALYTICS_READY_HOURS) return "published_waiting_48h";

  // Old enough — check for snapshot
  if (r.snap_view_count != null) return "analytics_ready";

  // Published ≥48h but no snapshot yet
  return "published_waiting_48h";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query<RawRow>(`
    SELECT
      cg.id,
      cg.topic,
      cg.thumbnail_text,
      cg.experiment_id,
      cg.experiment_variant,
      cg.video_status,
      cg.video_path,
      cg.youtube_video_url,
      cg.created_at,
      -- upload_queue (latest per content, youtube short)
      uq.id                  AS uq_id,
      uq.status              AS uq_status,
      uq.platform            AS uq_platform,
      uq.video_type          AS uq_video_type,
      uq.scheduled_at        AS uq_scheduled_at,
      uq.uploaded_at         AS uq_uploaded_at,
      uq.error_message       AS uq_error_message,
      uq.platform_video_url  AS uq_platform_video_url,
      -- published_videos (youtube short)
      pv.id                  AS pv_id,
      pv.platform_video_id   AS pv_platform_video_id,
      pv.platform_video_url  AS pv_platform_video_url,
      pv.published_at,
      pv.latest_view_count,
      pv.latest_like_count,
      pv.latest_fetched_at,
      -- latest metric snapshot
      vms.view_count         AS snap_view_count,
      vms.retention_pct      AS snap_retention_pct,
      vms.avg_view_duration_sec AS snap_avg_view_duration_sec,
      vms.fetched_at         AS snap_fetched_at
    FROM content_generations cg
    LEFT JOIN LATERAL (
      SELECT * FROM upload_queue
      WHERE content_id = cg.id
        AND platform = 'youtube'
        AND video_type = 'short'
      ORDER BY created_at DESC
      LIMIT 1
    ) uq ON true
    LEFT JOIN published_videos pv
      ON pv.content_id = cg.id
      AND pv.platform = 'youtube'
      AND pv.video_type = 'short'
    LEFT JOIN LATERAL (
      SELECT * FROM video_metric_snapshots
      WHERE published_video_id = pv.id
      ORDER BY fetched_at DESC
      LIMIT 1
    ) vms ON true
    WHERE cg.experiment_id = $1
      AND cg.experiment_variant = $2
    ORDER BY cg.created_at DESC
  `, [EXPERIMENT_ID, EXPERIMENT_VARIANT]);

  await pool.end();

  const rowReports: RowReport[] = rows.map((r) => {
    const videoFileExists = !!r.video_path && fs.existsSync(path.join(CWD, r.video_path));
    const status = classifyRow(r, videoFileExists);
    const hours  = hoursSince(r.published_at);

    const hasSnapshot   = r.snap_view_count != null;
    const latestViews   = toNum(r.snap_view_count) ?? toNum(r.latest_view_count);
    const latestRet     = toNum(r.snap_retention_pct);
    const latestDur     = r.snap_avg_view_duration_sec != null ? Number(r.snap_avg_view_duration_sec) : null;
    const analyticsReady = status === "analytics_ready";

    const youtubeUrl = r.pv_platform_video_url ?? r.uq_platform_video_url ?? r.youtube_video_url ?? null;

    return {
      contentId:                 r.id,
      topic:                     r.topic,
      thumbnailText:             r.thumbnail_text,
      videoStatus:               r.video_status,
      videoPath:                 r.video_path,
      videoFileExists,
      uploadQueueStatus:         r.uq_status,
      uploadQueueScheduledAt:    r.uq_scheduled_at ? new Date(r.uq_scheduled_at).toISOString() : null,
      uploadQueueErrorMessage:   r.uq_error_message,
      publishedVideoId:          r.pv_id,
      youtubeUrl,
      publishedAt:               r.published_at ? new Date(r.published_at).toISOString() : null,
      hoursSincePublish:         hours,
      hasMetricSnapshot:         hasSnapshot,
      latestViews,
      latestRetentionPct:        latestRet,
      latestAvgViewDurationSec:  latestDur,
      analyticsReady,
      readinessStatus:           status,
    };
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  const total           = rowReports.length;
  const rendered        = rowReports.filter((r) => r.videoStatus === "done" && r.videoFileExists).length;
  const queued          = rowReports.filter((r) => r.uploadQueueStatus != null && r.uploadQueueStatus !== "error").length;
  const published       = rowReports.filter((r) => r.publishedVideoId != null).length;
  const withSnapshot    = rowReports.filter((r) => r.hasMetricSnapshot).length;
  const analyticsReady  = rowReports.filter((r) => r.analyticsReady).length;
  const missingVideo    = rowReports.filter((r) => r.readinessStatus === "blocked_missing_video").length;
  const publishFailed   = rowReports.filter((r) => r.readinessStatus === "blocked_publish_failed").length;
  const waitingUpload   = rowReports.filter((r) => r.readinessStatus === "rendered_not_queued").length;
  const waitingPublish  = rowReports.filter((r) => r.readinessStatus === "queued_not_published").length;
  const waiting48h      = rowReports.filter((r) => r.readinessStatus === "published_waiting_48h").length;

  const publishedRows  = rowReports.filter((r) => r.publishedAt != null);
  const publishHours   = publishedRows.map((r) => r.hoursSincePublish).filter((h): h is number => h != null);
  const oldestPublish  = publishHours.length > 0 ? Math.max(...publishHours) : null;
  const newestPublish  = publishHours.length > 0 ? Math.min(...publishHours) : null;

  // Recommended action
  let recommendedAction: string;
  if (missingVideo > 0 || publishFailed > 0) {
    recommendedAction = "investigate_blockers";
  } else if (analyticsReady >= total) {
    recommendedAction = "run_analytics";
  } else if (published > 0 && waiting48h > 0) {
    const hoursLeft = oldestPublish != null ? Math.max(0, ANALYTICS_READY_HOURS - oldestPublish) : null;
    recommendedAction = `wait_48h${hoursLeft != null ? ` (oldest publish ${oldestPublish?.toFixed(1)}h ago — ~${hoursLeft.toFixed(0)}h remaining for oldest)` : ""}`;
  } else if (waitingUpload > 0 || waitingPublish > 0) {
    recommendedAction = "wait_for_upload";
  } else {
    recommendedAction = "wait_for_upload";
  }

  const summary = {
    experimentId:       EXPERIMENT_ID,
    experimentVariant:  EXPERIMENT_VARIANT,
    analyticsReadyAfterHours: ANALYTICS_READY_HOURS,
    total,
    rendered,
    queued,
    published,
    withMetricSnapshot:  withSnapshot,
    analyticsReady,
    missingVideo,
    publishFailed,
    waitingUpload,
    waitingPublish,
    waiting48h,
    oldestPublishAgeHours: oldestPublish,
    newestPublishAgeHours: newestPublish,
    recommendedAction,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    rows: rowReports,
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf-8");

  // ── Console output ────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  short-cover-intro-v1 Rollout Readiness Monitor`);
  console.log(`  ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════\n");

  console.log(`Total intro rows : ${total}`);
  console.log(`Rendered (file)  : ${rendered}`);
  console.log(`Queued           : ${queued}`);
  console.log(`Published YT     : ${published}`);
  console.log(`With snapshot    : ${withSnapshot}`);
  console.log(`Analytics ready  : ${analyticsReady}`);
  if (missingVideo)   console.log(`⚠  Missing video  : ${missingVideo}`);
  if (publishFailed)  console.log(`⚠  Publish failed : ${publishFailed}`);

  console.log("\n── Per row ─────────────────────────────────────────────");
  for (const r of rowReports) {
    const ageStr = r.hoursSincePublish != null ? ` (${r.hoursSincePublish}h ago)` : "";
    const viewStr = r.latestViews != null ? ` views=${r.latestViews}` : "";
    const retStr  = r.latestRetentionPct != null ? ` ret=${r.latestRetentionPct}%` : "";
    console.log(`  ${r.contentId.slice(0, 8)}  [${r.readinessStatus.padEnd(24)}]  "${r.topic}"${ageStr}${viewStr}${retStr}`);
    if (r.youtubeUrl) console.log(`           → ${r.youtubeUrl}`);
    if (r.uploadQueueErrorMessage) console.log(`           ✗ ${r.uploadQueueErrorMessage}`);
  }

  console.log(`\n── Recommended action ──────────────────────────────────`);
  console.log(`  ${recommendedAction}`);
  console.log(`\n[report] ${REPORT}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
