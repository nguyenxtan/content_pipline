import { config as loadEnv } from "dotenv";

/**
 * Production capacity dry-run report.
 *
 * Shows current capacity metrics, threshold status, and whether each job type
 * would be allowed or blocked.
 *
 * Usage:
 *   pnpm production:capacity
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.json scripts/production-capacity-report.ts
 */

loadEnv({ path: ".env.local" });
loadEnv();

const GB = 1_000_000_000;

function fmt(bytes: number): string {
  if (bytes === Number.MAX_SAFE_INTEGER) return "N/A (disk check unavailable)";
  if (bytes >= GB)        return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${bytes} B`;
}

function pct(current: number, threshold: number): string {
  if (threshold === 0) return "—";
  const p = Math.round((current / threshold) * 100);
  return `${p}%`;
}

function statusIcon(ok: boolean): string {
  return ok ? "✅" : "❌";
}

async function main() {
  const { getProductionCapacityStatus, checkCapacityGate } = await import("@/lib/production-capacity");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          Production Capacity Report                     ║");
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log(`Generated: ${new Date().toISOString()}\n`);

  const status = await getProductionCapacityStatus();
  const t = status.thresholds;

  // ── 1. Upload Queue ────────────────────────────────────────────────────────
  console.log("── Upload Queue ─────────────────────────────────────────────");
  const queueOk = status.pendingUploadCount <= t.maxPendingUploadQueue;
  console.log(`  ${statusIcon(queueOk)} Pending (queued+uploading): ${status.pendingUploadCount} / ${t.maxPendingUploadQueue}  [${pct(status.pendingUploadCount, t.maxPendingUploadQueue)}]`);
  console.log(`     Currently uploading : ${status.uploadingCount}`);
  console.log(`     Failed (error)      : ${status.failedUploadCount}`);
  if (status.nextScheduledPublishAt) {
    console.log(`     Next publish at     : ${status.nextScheduledPublishAt.toISOString()}`);
  }
  console.log();

  // ── 2. Rendered Videos ─────────────────────────────────────────────────────
  console.log("── Rendered Videos ──────────────────────────────────────────");
  const renderedOk = status.unpublishedRenderedCount <= t.maxUnpublishedRendered;
  console.log(`  ${statusIcon(renderedOk)} Rendered not cleaned: ${status.unpublishedRenderedCount} / ${t.maxUnpublishedRendered}  [${pct(status.unpublishedRenderedCount, t.maxUnpublishedRendered)}]`);
  console.log(`     Pipeline backlog (pending/error): ${status.pendingContentCount}`);
  console.log();

  // ── 3. Daily Generation ────────────────────────────────────────────────────
  console.log("── Daily Generation ─────────────────────────────────────────");
  const dailyOk = status.todayGeneratedCount < t.maxDailyNewContent;
  console.log(`  ${statusIcon(dailyOk)} Content generated today: ${status.todayGeneratedCount} / ${t.maxDailyNewContent}  [${pct(status.todayGeneratedCount, t.maxDailyNewContent)}]`);
  console.log();

  // ── 4. Media Sizes ─────────────────────────────────────────────────────────
  console.log("── Media Sizes ──────────────────────────────────────────────");
  const mediaOk = status.mediaTotalBytes <= t.maxMediaSizeGb * GB;
  console.log(`  ${statusIcon(mediaOk)} Total media: ${fmt(status.mediaTotalBytes)} / ${t.maxMediaSizeGb} GB  [${pct(status.mediaTotalBytes, t.maxMediaSizeGb * GB)}]`);
  console.log(`     media/videos : ${fmt(status.mediaVideoBytes)}`);
  console.log(`     media/audio  : ${fmt(status.mediaAudioBytes)}`);
  console.log(`     media/images : ${fmt(status.mediaImagesBytes)}`);
  console.log(`     Est. cleanup : ${fmt(status.estimatedCleanupBytes)} (would be freed after uploads)`);
  console.log();

  // ── 5. Disk ────────────────────────────────────────────────────────────────
  console.log("── Free Disk ────────────────────────────────────────────────");
  const diskOk = status.freeDiskBytes >= t.minFreeDiskGb * GB;
  console.log(`  ${statusIcon(diskOk)} Free disk: ${fmt(status.freeDiskBytes)} / min ${t.minFreeDiskGb} GB`);
  console.log();

  // ── 6. Gate simulation ────────────────────────────────────────────────────
  console.log("── Gate Simulation ──────────────────────────────────────────");

  const jobTypes = ["content_gen", "short_pipeline", "long_pipeline"] as const;
  for (const jt of jobTypes) {
    const gate = await checkCapacityGate(jt);
    if (gate.allowed) {
      console.log(`  ✅ ${jt.padEnd(18)} → ALLOWED`);
    } else {
      console.log(`  ❌ ${jt.padEnd(18)} → PAUSED`);
      for (const v of gate.violations) {
        console.log(`       • ${v.message}`);
      }
    }
  }
  console.log();

  // ── 7. Summary ────────────────────────────────────────────────────────────
  console.log("── Summary ──────────────────────────────────────────────────");
  if (status.isHealthy) {
    console.log("  ✅ All capacity checks PASS — generation is fully unblocked.");
  } else {
    console.log(`  ❌ ${status.violations.length} violation(s) — some jobs may be paused:`);
    for (const v of status.violations) {
      console.log(`     • [${v.reason}] ${v.message}`);
    }
  }
  console.log();
  console.log("  NOTE: Upload queue and analytics sync are NEVER blocked by backpressure.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
