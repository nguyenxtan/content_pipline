/**
 * Production backpressure / throttle helper.
 *
 * Provides read-only capacity checks that are called before heavy generation or
 * render stages.  Upload jobs and analytics syncs are NEVER gated by this module.
 *
 * Thresholds (all configurable via env vars):
 *   MAX_PENDING_UPLOAD_QUEUE        = 60
 *   MAX_UNPUBLISHED_RENDERED_VIDEOS = 30
 *   MAX_MEDIA_SIZE_GB               = 10
 *   MIN_FREE_DISK_GB                = 30
 *   MAX_DAILY_NEW_CONTENT           = 20
 */

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { appConfig, contentGenerations, uploadQueue } from "@/lib/db/schema";
import { eq, and, inArray, gte, isNull, isNotNull, count, asc } from "drizzle-orm";
import { sendTelegram } from "@/lib/social/telegram";

const ROOT = process.cwd();
const BACKPRESSURE_STATE_KEY = "backpressure_state";
const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between Telegram alerts

// ── Thresholds ────────────────────────────────────────────────────────────────

export interface ProductionThresholds {
  maxPendingUploadQueue: number;   // MAX_PENDING_UPLOAD_QUEUE
  maxUnpublishedRendered: number;  // MAX_UNPUBLISHED_RENDERED_VIDEOS
  maxMediaSizeGb: number;          // MAX_MEDIA_SIZE_GB
  minFreeDiskGb: number;           // MIN_FREE_DISK_GB
  maxDailyNewContent: number;      // MAX_DAILY_NEW_CONTENT
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v ? parseInt(v, 10) : NaN;
  return isNaN(n) ? fallback : n;
}

export function getThresholds(): ProductionThresholds {
  return {
    maxPendingUploadQueue:  envInt("MAX_PENDING_UPLOAD_QUEUE",          60),
    maxUnpublishedRendered: envInt("MAX_UNPUBLISHED_RENDERED_VIDEOS",    30),
    maxMediaSizeGb:         envInt("MAX_MEDIA_SIZE_GB",                  10),
    minFreeDiskGb:          envInt("MIN_FREE_DISK_GB",                   30),
    maxDailyNewContent:     envInt("MAX_DAILY_NEW_CONTENT",              20),
  };
}

// ── Media size scan (synchronous, fast for local directories) ─────────────────

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const recurse = (d: string) => {
    let entries: string[];
    try { entries = fs.readdirSync(d); } catch { return; }
    for (const name of entries) {
      const full = path.join(d, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) recurse(full);
        else total += stat.size;
      } catch { /* skip unreadable entries */ }
    }
  };
  recurse(dir);
  return total;
}

// ── Public types ──────────────────────────────────────────────────────────────

export type CapacityReason =
  | "upload_queue_too_large"
  | "unpublished_rendered_videos_too_many"
  | "media_size_too_large"
  | "low_free_disk"
  | "daily_generation_limit_reached";

export interface CapacityViolation {
  reason: CapacityReason;
  /** Human-readable explanation */
  message: string;
  current: number;
  threshold: number;
}

export interface ProductionCapacityStatus {
  // ── Upload queue ──────────────────────────────────────────────────────────
  pendingUploadCount: number;    // queued + uploading
  uploadingCount: number;        // actively uploading right now
  failedUploadCount: number;     // status = error

  // ── Content generation ────────────────────────────────────────────────────
  pendingContentCount: number;        // short videoStatus = pending | error (not yet rendered)
  unpublishedRenderedCount: number;   // videoStatus = done, mediaCleanedAt IS NULL
  todayGeneratedCount: number;        // new content_generations rows created today

  // ── Media sizes (bytes) ───────────────────────────────────────────────────
  mediaTotalBytes: number;
  mediaVideoBytes: number;
  mediaAudioBytes: number;
  mediaImagesBytes: number;
  estimatedCleanupBytes: number;  // rough estimate of cleanup-eligible bytes

  // ── Disk ──────────────────────────────────────────────────────────────────
  freeDiskBytes: number;  // Number.MAX_SAFE_INTEGER when unavailable

  // ── Schedule ──────────────────────────────────────────────────────────────
  nextScheduledPublishAt: Date | null;

  // ── Meta ──────────────────────────────────────────────────────────────────
  thresholds: ProductionThresholds;
  violations: CapacityViolation[];
  isHealthy: boolean;
}

export interface CapacityGateResult {
  allowed: boolean;
  violations: CapacityViolation[];
  status: ProductionCapacityStatus;
}

// ── Main status query ─────────────────────────────────────────────────────────

export async function getProductionCapacityStatus(): Promise<ProductionCapacityStatus> {
  const thresholds = getThresholds();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    queueRows,
    pendingContentCount,
    unpublishedRenderedCount,
    todayGeneratedCount,
    nextPublishRow,
    cleanupEligibleCount,
  ] = await Promise.all([
    // Upload queue counts grouped by status
    db
      .select({ status: uploadQueue.status, n: count() })
      .from(uploadQueue)
      .where(inArray(uploadQueue.status, ["queued", "uploading", "error"]))
      .groupBy(uploadQueue.status),

    // Short videos not yet rendered (still in pipeline backlog)
    db
      .select({ n: count() })
      .from(contentGenerations)
      .where(inArray(contentGenerations.videoStatus, ["pending", "error"]))
      .then((r) => Number(r[0]?.n ?? 0)),

    // Rendered short videos still sitting on disk (uploaded or not, cleanup not done)
    db
      .select({ n: count() })
      .from(contentGenerations)
      .where(
        and(
          eq(contentGenerations.videoStatus, "done"),
          isNull(contentGenerations.mediaCleanedAt),
        ),
      )
      .then((r) => Number(r[0]?.n ?? 0)),

    // Content rows created today (all statuses)
    db
      .select({ n: count() })
      .from(contentGenerations)
      .where(gte(contentGenerations.createdAt, todayStart))
      .then((r) => Number(r[0]?.n ?? 0)),

    // Next queued upload
    db
      .select({ scheduledAt: uploadQueue.scheduledAt })
      .from(uploadQueue)
      .where(eq(uploadQueue.status, "queued"))
      .orderBy(asc(uploadQueue.scheduledAt))
      .limit(1)
      .then((r) => r[0]?.scheduledAt ?? null),

    // Items with cleanup scheduled but not yet cleaned
    db
      .select({ n: count() })
      .from(contentGenerations)
      .where(
        and(
          isNotNull(contentGenerations.mediaScheduledCleanAt),
          isNull(contentGenerations.mediaCleanedAt),
        ),
      )
      .then((r) => Number(r[0]?.n ?? 0)),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of queueRows) byStatus[r.status] = Number(r.n);
  const pendingUploadCount = (byStatus["queued"] ?? 0) + (byStatus["uploading"] ?? 0);
  const uploadingCount     = byStatus["uploading"] ?? 0;
  const failedUploadCount  = byStatus["error"]     ?? 0;

  // ── Media sizes ───────────────────────────────────────────────────────────
  const mediaVideoBytes  = dirSizeBytes(path.join(ROOT, "media/videos"));
  const mediaAudioBytes  = dirSizeBytes(path.join(ROOT, "media/audio"));
  const mediaImagesBytes = dirSizeBytes(path.join(ROOT, "media/images"));
  const mediaTotalBytes  =
    mediaVideoBytes +
    mediaAudioBytes +
    mediaImagesBytes +
    dirSizeBytes(path.join(ROOT, "media/audio-cache")) +
    dirSizeBytes(path.join(ROOT, "media/covers"))      +
    dirSizeBytes(path.join(ROOT, "media/music"));

  // Rough estimate: ~30 MB per eligible item (video + audio + images combined)
  const estimatedCleanupBytes = cleanupEligibleCount * 30 * 1024 * 1024;

  // ── Free disk (Node 18.15+ / 19.6+) ──────────────────────────────────────
  let freeDiskBytes = Number.MAX_SAFE_INTEGER;
  try {
    const stats = fs.statfsSync(ROOT);
    freeDiskBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // statfsSync unavailable or failed — skip disk constraint
  }

  // ── Violations ────────────────────────────────────────────────────────────
  const violations: CapacityViolation[] = [];

  if (pendingUploadCount > thresholds.maxPendingUploadQueue) {
    violations.push({
      reason: "upload_queue_too_large",
      message: `Upload queue has ${pendingUploadCount} pending items (threshold ${thresholds.maxPendingUploadQueue})`,
      current: pendingUploadCount,
      threshold: thresholds.maxPendingUploadQueue,
    });
  }

  if (unpublishedRenderedCount > thresholds.maxUnpublishedRendered) {
    violations.push({
      reason: "unpublished_rendered_videos_too_many",
      message: `${unpublishedRenderedCount} rendered videos on disk not yet cleaned up (threshold ${thresholds.maxUnpublishedRendered})`,
      current: unpublishedRenderedCount,
      threshold: thresholds.maxUnpublishedRendered,
    });
  }

  const maxMediaBytes = thresholds.maxMediaSizeGb * 1_000_000_000;
  if (mediaTotalBytes > maxMediaBytes) {
    violations.push({
      reason: "media_size_too_large",
      message: `Total media size is ${(mediaTotalBytes / 1e9).toFixed(2)} GB (threshold ${thresholds.maxMediaSizeGb} GB)`,
      current: mediaTotalBytes,
      threshold: maxMediaBytes,
    });
  }

  const minFreeBytes = thresholds.minFreeDiskGb * 1_000_000_000;
  if (freeDiskBytes < minFreeBytes) {
    violations.push({
      reason: "low_free_disk",
      message: `Free disk is ${(freeDiskBytes / 1e9).toFixed(1)} GB (minimum ${thresholds.minFreeDiskGb} GB required)`,
      current: freeDiskBytes,
      threshold: minFreeBytes,
    });
  }

  if (todayGeneratedCount >= thresholds.maxDailyNewContent) {
    violations.push({
      reason: "daily_generation_limit_reached",
      message: `Generated ${todayGeneratedCount} content items today (daily limit ${thresholds.maxDailyNewContent})`,
      current: todayGeneratedCount,
      threshold: thresholds.maxDailyNewContent,
    });
  }

  return {
    pendingUploadCount,
    uploadingCount,
    failedUploadCount,
    pendingContentCount,
    unpublishedRenderedCount,
    todayGeneratedCount,
    mediaTotalBytes,
    mediaVideoBytes,
    mediaAudioBytes,
    mediaImagesBytes,
    estimatedCleanupBytes,
    freeDiskBytes,
    nextScheduledPublishAt: nextPublishRow,
    thresholds,
    violations,
    isHealthy: violations.length === 0,
  };
}

// ── Gate check ────────────────────────────────────────────────────────────────

// content_gen gates on all reasons including daily limit
const CONTENT_GEN_GATES = new Set<CapacityReason>([
  "upload_queue_too_large",
  "unpublished_rendered_videos_too_many",
  "media_size_too_large",
  "low_free_disk",
  "daily_generation_limit_reached",
]);

// pipeline (TTS/images/render) gates on resource reasons but NOT daily generation limit —
// once content is created, allow the pipeline to finish rendering it.
const PIPELINE_GATES = new Set<CapacityReason>([
  "upload_queue_too_large",
  "unpublished_rendered_videos_too_many",
  "media_size_too_large",
  "low_free_disk",
]);

export async function checkCapacityGate(
  jobType: "content_gen" | "short_pipeline" | "long_pipeline",
): Promise<CapacityGateResult> {
  const status = await getProductionCapacityStatus();
  const gates   = jobType === "content_gen" ? CONTENT_GEN_GATES : PIPELINE_GATES;
  const violations = status.violations.filter((v) => gates.has(v.reason));
  return { allowed: violations.length === 0, violations, status };
}

// ── Telegram notification (rate-limited per 30 min) ───────────────────────────

type BackpressureState = { lastNotifiedAt?: string | null };

export async function notifyBackpressureIfNeeded(
  jobType: string,
  violations: CapacityViolation[],
): Promise<void> {
  if (violations.length === 0) return;

  try {
    const row = await db.query.appConfig.findFirst({
      where: eq(appConfig.key, BACKPRESSURE_STATE_KEY),
    });

    const state: BackpressureState = row
      ? (JSON.parse(row.value) as BackpressureState)
      : {};

    if (state.lastNotifiedAt) {
      const elapsed = Date.now() - new Date(state.lastNotifiedAt).getTime();
      if (elapsed < NOTIFY_COOLDOWN_MS) return;
    }

    const lines = violations.map((v) => `• ${v.message}`).join("\n");
    await sendTelegram(
      `⚠️ <b>Generation paused: ${jobType}</b>\n\n${lines}\n\n` +
      `Upload queue và analytics sync vẫn hoạt động bình thường.`,
    );

    const newState: BackpressureState = { lastNotifiedAt: new Date().toISOString() };
    await db
      .insert(appConfig)
      .values({ key: BACKPRESSURE_STATE_KEY, value: JSON.stringify(newState) })
      .onConflictDoUpdate({
        target: appConfig.key,
        set: { value: JSON.stringify(newState), updatedAt: new Date() },
      });
  } catch {
    // Notification is best-effort — do not let it break the caller
  }
}
