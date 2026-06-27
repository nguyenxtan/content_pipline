/**
 * One-shot check: YouTube re-authorization status + latest analytics snapshot values.
 * Run with: pnpm exec tsx --tsconfig tsconfig.json scripts/check-yt-reauth.ts
 */

import { db } from "@/lib/db";
import { socialChannels, videoMetricSnapshots, publishedVideos } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";

async function main() {
  // ── 1. YouTube channel scopes ──────────────────────────────────────────────
  console.log("\n═══ YouTube Channels (scope check) ═══");
  const channels = await db.query.socialChannels.findMany({
    where: eq(socialChannels.platform, "youtube"),
  });

  if (channels.length === 0) {
    console.log("  (no YouTube channels in DB)");
  }

  for (const ch of channels) {
    const hasAnalytics = ch.scope?.includes("yt-analytics.readonly") ?? false;
    console.log(`\n  [${ch.id}] ${ch.name}`);
    console.log(`    platformChannelId : ${ch.platformChannelId ?? "(null)"}`);
    console.log(`    isActive          : ${ch.isActive}`);
    console.log(`    needsReconnect    : ${ch.needsReconnect}`);
    console.log(`    scope             : ${ch.scope ?? "(null)"}`);
    console.log(`    has_analytics_scope: ${hasAnalytics ? "YES ✓" : "NO ✗  ← NEEDS RE-AUTH"}`);
  }

  // ── 2. Latest 5 snapshots for YouTube videos ───────────────────────────────
  console.log("\n\n═══ Latest video_metric_snapshots (YouTube, last 5) ═══");

  const ytVideos = await db.query.publishedVideos.findMany({
    where: eq(publishedVideos.platform, "youtube"),
  });

  if (ytVideos.length === 0) {
    console.log("  (no YouTube published_videos in DB)");
    return;
  }

  const ytVideoIds = ytVideos.map((v) => v.id);

  const snapshots = await db.query.videoMetricSnapshots.findMany({
    where: (t) => inArray(t.publishedVideoId, ytVideoIds),
    orderBy: [desc(videoMetricSnapshots.fetchedAt)],
    limit: 5,
  });

  if (snapshots.length === 0) {
    console.log("  (no snapshots for YouTube videos — sync has not run yet)");
    return;
  }

  for (const snap of snapshots) {
    const video      = ytVideos.find((v) => v.id === snap.publishedVideoId);
    const raw        = snap.rawJson as Record<string, unknown> | null;
    const impressions = raw?.impressions;

    console.log(`\n  Snapshot  : ${snap.id.slice(0, 8)} @ ${snap.fetchedAt?.toISOString() ?? "?"}`);
    console.log(`  Video     : ${(video?.title ?? snap.publishedVideoId).slice(0, 60)}`);
    console.log(`  ctr                  : ${snap.ctr              ?? "null  ← not written"}`);
    console.log(`  avg_view_duration_sec: ${snap.avgViewDurationSec ?? "null  ← not written"}`);
    console.log(`  retention_pct        : ${snap.retentionPct     ?? "null  ← not written"}`);
    console.log(`  raw_json.impressions : ${impressions           ?? "null  ← not written"}`);
  }
}

main().catch((err) => {
  console.error("\nDB error:", err instanceof Error ? err.message : String(err));
  if ((err as { cause?: unknown }).cause) {
    console.error("  cause:", String((err as { cause: unknown }).cause));
  }
  process.exit(1);
});
