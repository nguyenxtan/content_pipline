/**
 * One-command operations health dashboard.
 *
 * Usage:
 *   pnpm ops:health
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.json scripts/ops-health.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getProductionCapacityStatus, checkCapacityGate } from "@/lib/production-capacity";
import { db } from "@/lib/db";
import { cronRunLogs } from "@/lib/db/schema";
import { desc, gte } from "drizzle-orm";

const GB = 1_000_000_000;
const MB = 1_048_576;

function fmt(bytes: number): string {
  if (bytes === Number.MAX_SAFE_INTEGER) return "N/A";
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`;
  return `${bytes} B`;
}

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

async function getRecentCronErrors(): Promise<{ ranAt: Date; summary: string }[]> {
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000); // last 3 hours
  const rows = await db
    .select({ ranAt: cronRunLogs.ranAt, errorSummary: cronRunLogs.errorSummary })
    .from(cronRunLogs)
    .where(gte(cronRunLogs.ranAt, since))
    .orderBy(desc(cronRunLogs.ranAt))
    .limit(20);
  return rows
    .filter((r) => r.errorSummary)
    .map((r) => ({ ranAt: r.ranAt!, summary: r.errorSummary! }));
}

async function getLastCronRun(): Promise<{ ranAt: Date; durationMs: number | null } | null> {
  const rows = await db
    .select({ ranAt: cronRunLogs.ranAt, durationMs: cronRunLogs.durationMs })
    .from(cronRunLogs)
    .orderBy(desc(cronRunLogs.ranAt))
    .limit(1);
  return rows[0] ?? null;
}

async function main() {
  const [status, contentGate, shortGate, longGate, cronErrors, lastRun] = await Promise.all([
    getProductionCapacityStatus(),
    checkCapacityGate("content_gen"),
    checkCapacityGate("short_pipeline"),
    checkCapacityGate("long_pipeline"),
    getRecentCronErrors(),
    getLastCronRun(),
  ]);

  const now = new Date();
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║               Ops Health Dashboard                     ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log(`  ${now.toISOString()}\n`);

  // ── 1. Gate status ──────────────────────────────────────────────────────────
  console.log("  PIPELINE GATES");
  const gateRow = (label: string, allowed: boolean) =>
    `    ${allowed ? "✅" : "❌"} ${pad(label, 22)}  ${allowed ? "ALLOWED" : "PAUSED"}`;
  console.log(gateRow("content_gen", contentGate.allowed));
  console.log(gateRow("short_pipeline", shortGate.allowed));
  console.log(gateRow("long_pipeline", longGate.allowed));

  const allViolations = [
    ...contentGate.violations,
    ...shortGate.violations.filter(
      (v) => !contentGate.violations.some((cv) => cv.reason === v.reason),
    ),
  ];
  if (allViolations.length > 0) {
    console.log("  BLOCKING REASONS:");
    for (const v of allViolations) {
      console.log(`    ⚠  ${v.message}`);
    }
  }
  console.log();

  // ── 2. Queue & pipeline ─────────────────────────────────────────────────────
  console.log("  QUEUE & PIPELINE");
  console.log(`    ${pad("Upload queue (queued+uploading):", 36)} ${status.pendingUploadCount}  (⚠ threshold ${status.thresholds.maxPendingUploadQueue})`);
  console.log(`    ${pad("Upload errors:", 36)} ${status.failedUploadCount}`);
  console.log(`    ${pad("Rendered videos on disk:", 36)} ${status.unpublishedRenderedCount}  (⚠ threshold ${status.thresholds.maxUnpublishedRendered})`);
  console.log(`    ${pad("Pipeline backlog (pending/error):", 36)} ${status.pendingContentCount}`);
  console.log(`    ${pad("Generated today:", 36)} ${status.todayGeneratedCount}  (⚠ limit ${status.thresholds.maxDailyNewContent})`);
  if (status.nextScheduledPublishAt) {
    console.log(`    ${pad("Next scheduled upload:", 36)} ${status.nextScheduledPublishAt.toISOString()}`);
  }
  console.log();

  // ── 3. Storage ──────────────────────────────────────────────────────────────
  console.log("  STORAGE");
  const mediaOk = status.mediaTotalBytes <= status.thresholds.maxMediaSizeGb * GB;
  const diskOk = status.freeDiskBytes >= status.thresholds.minFreeDiskGb * GB;
  console.log(`    ${mediaOk ? "✅" : "❌"} ${pad("Total media:", 35)} ${fmt(status.mediaTotalBytes)}  (threshold ${status.thresholds.maxMediaSizeGb} GB)`);
  console.log(`    ${diskOk ? "✅" : "❌"} ${pad("Free disk:", 35)} ${fmt(status.freeDiskBytes)}  (min ${status.thresholds.minFreeDiskGb} GB)`);
  console.log(`    ${pad("  Estimated safe-to-delete:", 35)} ~${fmt(status.estimatedCleanupBytes)}`);
  if (status.estimatedCleanupBytes > 50 * MB) {
    console.log(`    ℹ  Run: pnpm cleanup:uploaded-assets:delete`);
  }
  console.log();

  // ── 4. Feature flags ────────────────────────────────────────────────────────
  console.log("  FEATURE FLAGS");
  const coverEnabled = ["1", "true", "yes", "on"].includes(
    (process.env.SHORT_COVER_INTRO_ENABLED ?? "").trim().toLowerCase(),
  );
  const experimentVariant = process.env.CONTENT_EXPERIMENT_VARIANT ?? "HOOK_V1 (default)";
  const experimentId =
    process.env.CONTENT_EXPERIMENT_ID ??
    (() => {
      const v = process.env.CONTENT_EXPERIMENT_VARIANT ?? "HOOK_V1";
      const idx = v.lastIndexOf("_V");
      return idx > 0 ? v.slice(0, idx) : "HOOK";
    })() + " (inferred)";
  const contentModel = process.env.CONTENT_GEN_MODEL ?? "openai/gpt-4o-mini (default)";
  const longformModel = process.env.LONGFORM_MODEL ?? "google/gemini-2.0-flash (default)";

  console.log(`    SHORT_COVER_INTRO_ENABLED : ${coverEnabled ? "ON ✅" : "off"}`);
  if (coverEnabled) {
    const dur = process.env.SHORT_COVER_DURATION_SEC ?? "1.5 (default)";
    const fade = process.env.SHORT_COVER_FADE_OUT_SEC ?? "0.25 (default)";
    console.log(`    SHORT_COVER_DURATION_SEC  : ${dur}s`);
    console.log(`    SHORT_COVER_FADE_OUT_SEC  : ${fade}s`);
  }
  console.log(`    CONTENT_EXPERIMENT_VARIANT: ${experimentVariant}`);
  console.log(`    CONTENT_EXPERIMENT_ID     : ${experimentId}`);
  console.log(`    CONTENT_GEN_MODEL         : ${contentModel}`);
  console.log(`    LONGFORM_MODEL            : ${longformModel}`);
  console.log();

  // ── 5. Cron health ──────────────────────────────────────────────────────────
  console.log("  CRON HEALTH");
  if (lastRun) {
    const agoMs = now.getTime() - lastRun.ranAt.getTime();
    const agoMin = Math.round(agoMs / 60000);
    const durStr = lastRun.durationMs ? `${lastRun.durationMs}ms` : "unknown";
    const stale = agoMin > 5;
    console.log(`    ${stale ? "⚠ " : "✅"} Last cron run: ${agoMin}m ago  (duration: ${durStr})`);
    if (stale) {
      console.log(`       ⚠  Cron has not run in > 5 minutes — check cron trigger`);
    }
  } else {
    console.log(`    ⚠  No cron run logs found`);
  }
  if (cronErrors.length > 0) {
    console.log(`    ❌ ${cronErrors.length} cron error(s) in last 3h:`);
    for (const e of cronErrors.slice(0, 3)) {
      const t = e.ranAt.toISOString().slice(11, 19);
      console.log(`       [${t}] ${e.summary}`);
    }
    if (cronErrors.length > 3) {
      console.log(`       ... and ${cronErrors.length - 3} more`);
    }
  } else {
    console.log(`    ✅ No cron errors in last 3h`);
  }
  console.log();

  // ── 6. Recommended next action ─────────────────────────────────────────────
  console.log("  RECOMMENDED ACTION");
  if (!status.isHealthy) {
    const topViolation = allViolations[0];
    switch (topViolation?.reason) {
      case "upload_queue_too_large":
        console.log("    → Upload queue is full. Wait for uploads to drain or check for upload errors.");
        break;
      case "unpublished_rendered_videos_too_many":
        console.log("    → Run: pnpm cleanup:uploaded-assets:delete");
        break;
      case "media_size_too_large":
        console.log("    → Run: pnpm storage:report  then  pnpm cleanup:uploaded-assets:delete");
        break;
      case "low_free_disk":
        console.log("    → Free disk space externally, then re-check with pnpm ops:health");
        break;
      case "daily_generation_limit_reached":
        console.log("    → Daily limit hit. Wait for midnight UTC reset or raise MAX_DAILY_NEW_CONTENT.");
        break;
      default:
        console.log("    → Check violations above and consult docs/OPERATIONS.md");
    }
  } else if (status.estimatedCleanupBytes > 200 * MB) {
    console.log("    → System healthy. Consider running: pnpm cleanup:uploaded-assets:delete");
  } else if (cronErrors.length > 0) {
    console.log("    → System running. Investigate cron errors listed above.");
  } else {
    console.log("    ✅ All systems nominal.");
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
