/**
 * Run a single YouTube analytics sync and report what was written.
 * Run with: pnpm exec tsx --tsconfig tsconfig.json scripts/run-yt-analytics-sync.ts
 */

import { db } from "@/lib/db";
import { videoMetricSnapshots, publishedVideos } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { syncYouTubeAnalyticsAction } from "@/actions/publishing-analytics";

async function main() {
  console.log("\n═══ Running YouTube Analytics Sync (force=true, limit=5) ═══\n");

  let syncResult: Awaited<ReturnType<typeof syncYouTubeAnalyticsAction>>;
  try {
    syncResult = await syncYouTubeAnalyticsAction({ force: true, limitVideos: 5 });
  } catch (err) {
    console.error("Sync threw:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log("Sync result:");
  console.log("  platform:        ", syncResult.platform);
  console.log("  accountsTouched: ", syncResult.accountsTouched);
  console.log("  videosRequested: ", syncResult.videosRequested);
  console.log("  videosUpdated:   ", syncResult.videosUpdated);
  if (syncResult.errors.length > 0) {
    console.log("  errors:");
    for (const e of syncResult.errors) console.log(`    - ${e}`);
  } else {
    console.log("  errors:          (none)");
  }

  // ── Latest snapshots ──────────────────────────────────────────────────────
  console.log("\n═══ Latest video_metric_snapshots after sync (last 5) ═══\n");

  const ytVideos = await db.query.publishedVideos.findMany({
    where: eq(publishedVideos.platform, "youtube"),
  });
  const ytVideoIds = ytVideos.map((v) => v.id);

  const snapshots = await db.query.videoMetricSnapshots.findMany({
    where: (t) => inArray(t.publishedVideoId, ytVideoIds),
    orderBy: [desc(videoMetricSnapshots.fetchedAt)],
    limit: 5,
  });

  for (const snap of snapshots) {
    const video = ytVideos.find((v) => v.id === snap.publishedVideoId);
    const raw = snap.rawJson as Record<string, unknown> | null;
    const impressions = raw?.impressions;

    console.log(`  [${snap.fetchedAt?.toISOString() ?? "?"}]`);
    console.log(`  Video     : ${(video?.title ?? snap.publishedVideoId).slice(0, 60)}`);
    console.log(`  ctr                  : ${snap.ctr              ?? "null"}`);
    console.log(`  avg_view_duration_sec: ${snap.avgViewDurationSec ?? "null"}`);
    console.log(`  retention_pct        : ${snap.retentionPct     ?? "null"}`);
    console.log(`  raw_json.impressions : ${impressions           ?? "null"}`);
    console.log();
  }
}

main().catch((err) => {
  console.error("\nFatal:", err instanceof Error ? err.message : String(err));
  if ((err as { cause?: unknown }).cause) console.error("  cause:", String((err as { cause: unknown }).cause));
  process.exit(1);
});
