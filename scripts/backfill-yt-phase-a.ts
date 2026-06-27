/**
 * Backfill YouTube Analytics Phase A metrics for Giới Định Tuệ (phat_phap).
 *
 * Inserts new snapshot rows with share_count, estimated_minutes_watched,
 * subscribers_gained, and subscribers_lost for existing published videos
 * that lack Phase A data.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-yt-phase-a.ts [options]
 *
 * Options:
 *   --dry-run          Print what would be inserted without writing to DB (default)
 *   --execute          Write snapshot rows to DB
 *   --limit <N>        Max videos to process (default: 100)
 *   --days <N>         Only videos published in last N days (default: 90)
 *   --all-days         Process all videos regardless of age
 *   --channel <key>    Channel profile key (only "phat_phap" supported, default)
 *
 * Examples:
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-yt-phase-a.ts --dry-run
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-yt-phase-a.ts --execute --limit 50 --days 30
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-yt-phase-a.ts --execute --all-days --limit 200
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import {
  publishedVideos,
  videoMetricSnapshots,
  socialChannels,
} from "@/lib/db/schema";
import { and, eq, gte, isNotNull, desc, inArray } from "drizzle-orm";
import {
  fetchYouTubeAnalyticsMetrics,
  listYouTubeVideos,
  isQuotaExceededError,
  nextQuotaResetUtc,
} from "@/lib/social/youtube-api";

// ── Channel config ────────────────────────────────────────────────────────────

const PHAT_PHAP_PLATFORM_ACCOUNT_ID = 1;
const ANALYTICS_BATCH_SIZE = 40;
const DATA_API_BATCH_SIZE = 50;

// ── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i++;
    } else {
      result[key] = true;
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const dryRun = !(args["execute"] === true);
const limit = typeof args["limit"] === "string" ? parseInt(args["limit"], 10) : 100;
const daysArg = typeof args["days"] === "string" ? parseInt(args["days"], 10) : 90;
const allDays = args["all-days"] === true;
const channelKey = typeof args["channel"] === "string" ? args["channel"] : "phat_phap";

if (channelKey !== "phat_phap") {
  console.error(`Only --channel phat_phap is supported in this backfill. Got: ${channelKey}`);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toCount(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

function toRetentionPctDbValue(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return String(Math.min(999.99, Math.max(0, value)));
}

function parseIsoDurationToSeconds(duration: string | null | undefined): number | null {
  if (!duration) return null;
  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;
  const [, d, h, m, s] = match;
  return (
    (Number(d ?? 0) * 86400) +
    (Number(h ?? 0) * 3600) +
    (Number(m ?? 0) * 60) +
    Number(s ?? 0)
  );
}

// ── Credential resolution ─────────────────────────────────────────────────────

async function resolveCredential() {
  const now = new Date();
  const rows = await db.query.socialChannels.findMany({
    where: and(
      eq(socialChannels.platform, "youtube"),
      eq(socialChannels.platformAccountId, PHAT_PHAP_PLATFORM_ACCOUNT_ID),
      eq(socialChannels.isActive, true),
      eq(socialChannels.needsReconnect, false),
      isNotNull(socialChannels.accessToken),
    ),
    with: { oauthClient: true },
    orderBy: (t, { asc }) => asc(t.id),
  });

  const healthy = rows.filter((r) => {
    if (!r.accessToken) return false;
    if (r.quotaExceededUntil && r.quotaExceededUntil > now) return false;
    if (r.oauthClient && !r.oauthClient.isActive) return false;
    return true;
  });

  if (healthy.length === 0) {
    const quotaBlocked = rows.filter(
      (r) => r.quotaExceededUntil && r.quotaExceededUntil > now,
    );
    if (quotaBlocked.length > 0) {
      const resetAt = quotaBlocked[0]!.quotaExceededUntil!;
      console.error(`Quota exceeded. Resets at ${resetAt.toISOString()} UTC`);
      console.error("Re-run after the quota resets.");
      process.exit(1);
    }
    console.error(
      "No active YouTube credential for phat_phap (account_id=1). " +
      "Re-authorise at Settings → Channels.",
    );
    process.exit(1);
  }

  return healthy[0]!;
}

// ── Pre-flight report ─────────────────────────────────────────────────────────

async function preflight(cutoff: Date | null) {
  const baseWhere = and(
    eq(publishedVideos.platform, "youtube"),
    eq(publishedVideos.platformAccountId, PHAT_PHAP_PLATFORM_ACCOUNT_ID),
    isNotNull(publishedVideos.platformVideoId),
    isNotNull(publishedVideos.publishedAt),
    ...(cutoff ? [gte(publishedVideos.publishedAt, cutoff)] : []),
  );

  const targets = await db
    .select({ id: publishedVideos.id })
    .from(publishedVideos)
    .where(baseWhere);

  const targetIds = targets.map((r) => r.id);
  if (targetIds.length === 0) {
    return { targetCount: 0, phaseACoverage: null };
  }

  // Existing Phase A coverage across all snapshots
  const phaseARows = await db
    .select({
      shareCountNonNull: videoMetricSnapshots.shareCount,
      emwNonNull: videoMetricSnapshots.estimatedMinutesWatched,
      subGainNonNull: videoMetricSnapshots.subscribersGained,
      subLostNonNull: videoMetricSnapshots.subscribersLost,
      retentionNonNull: videoMetricSnapshots.retentionPct,
    })
    .from(videoMetricSnapshots)
    .where(inArray(videoMetricSnapshots.publishedVideoId, targetIds));

  const coverage = {
    totalSnapshots: phaseARows.length,
    shareCount: phaseARows.filter((r) => r.shareCountNonNull !== null).length,
    emw: phaseARows.filter((r) => r.emwNonNull !== null).length,
    subGained: phaseARows.filter((r) => r.subGainNonNull !== null).length,
    subLost: phaseARows.filter((r) => r.subLostNonNull !== null).length,
    retention: phaseARows.filter((r) => r.retentionNonNull !== null).length,
  };

  return { targetCount: targetIds.length, phaseACoverage: coverage };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cutoff = allDays ? null : new Date(Date.now() - daysArg * 24 * 60 * 60 * 1000);

  console.log(`\n═══ YouTube Analytics Phase A Backfill (${dryRun ? "DRY RUN" : "EXECUTE"}) ═══\n`);
  console.log(`Channel:   phat_phap / Giới Định Tuệ (platform_account_id=1)`);
  console.log(`Mode:      ${dryRun ? "DRY RUN — no DB writes" : "EXECUTE — will insert snapshot rows"}`);
  console.log(`Scope:     ${allDays ? "all published videos" : `videos published in last ${daysArg} days (since ${cutoff!.toISOString().slice(0, 10)})`}`);
  console.log(`Limit:     ${limit}`);

  // Pre-flight
  const { targetCount, phaseACoverage } = await preflight(cutoff);
  console.log(`\n── Pre-flight ────────────────────────────────────────────`);
  console.log(`Target videos in scope:       ${targetCount}`);
  if (phaseACoverage) {
    console.log(`Existing snapshots (in scope): ${phaseACoverage.totalSnapshots}`);
    console.log(`  share_count non-null:        ${phaseACoverage.shareCount}`);
    console.log(`  estimated_minutes_watched:   ${phaseACoverage.emw}`);
    console.log(`  subscribers_gained:          ${phaseACoverage.subGained}`);
    console.log(`  subscribers_lost:            ${phaseACoverage.subLost}`);
    console.log(`  retention_pct:               ${phaseACoverage.retention}`);
  }

  if (targetCount === 0) {
    console.log("\nNo target videos found. Nothing to do.");
    return;
  }

  // Resolve credential
  const credential = await resolveCredential();
  console.log(`\nCredential: social_channels.id=${credential.id} (${credential.name})`);

  // Fetch target videos ordered by publishedAt DESC (newest first)
  const baseWhere = and(
    eq(publishedVideos.platform, "youtube"),
    eq(publishedVideos.platformAccountId, PHAT_PHAP_PLATFORM_ACCOUNT_ID),
    isNotNull(publishedVideos.platformVideoId),
    isNotNull(publishedVideos.publishedAt),
    ...(cutoff ? [gte(publishedVideos.publishedAt, cutoff)] : []),
  );

  const targetVideos = await db
    .select({
      id: publishedVideos.id,
      platformVideoId: publishedVideos.platformVideoId,
      publishedAt: publishedVideos.publishedAt,
      title: publishedVideos.title,
    })
    .from(publishedVideos)
    .where(baseWhere)
    .orderBy(desc(publishedVideos.publishedAt))
    .limit(limit);

  console.log(`\nVideos to process (after limit): ${targetVideos.length}`);

  // ── Analytics date range: from earliest publishedAt to today ─────────────
  const earliestPublished = targetVideos.reduce(
    (min, v) => v.publishedAt && v.publishedAt < min ? v.publishedAt : min,
    new Date(),
  );
  const analyticsStartDate = new Date(
    Math.min(earliestPublished.getTime(), Date.now() - 400 * 24 * 60 * 60 * 1000),
  ).toISOString().slice(0, 10);
  const analyticsEndDate = new Date().toISOString().slice(0, 10);

  console.log(`Analytics window: ${analyticsStartDate} → ${analyticsEndDate}`);
  console.log(
    `\nAPI calls estimate: ~${Math.ceil(targetVideos.length / DATA_API_BATCH_SIZE)} Data API batches, ` +
    `~${Math.ceil(targetVideos.length / ANALYTICS_BATCH_SIZE)} Analytics batches`,
  );

  if (dryRun) {
    console.log("\n── Dry-run sample (first 5 videos) ──────────────────────");
    for (const v of targetVideos.slice(0, 5)) {
      console.log(`  ${v.publishedAt?.toISOString().slice(0, 10) ?? "?"}  ${v.platformVideoId}  ${v.title?.slice(0, 60) ?? "?"}`);
    }
    console.log("\nNo DB writes made. Re-run with --execute to insert snapshots.");
    return;
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  const platformVideoIds = targetVideos.map((v) => v.platformVideoId!);
  const videoIdToRow = new Map(targetVideos.map((v) => [v.platformVideoId!, v]));

  // 1. Data API: view/like/comment/duration
  console.log("\n── Fetching Data API metrics ──────────────────────────────");
  const dataApiItems: Map<string, {
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    favoriteCount: number | null;
    durationSeconds: number | null;
    privacyStatus: string | null;
  }> = new Map();

  for (let i = 0; i < platformVideoIds.length; i += DATA_API_BATCH_SIZE) {
    const batch = platformVideoIds.slice(i, i + DATA_API_BATCH_SIZE);
    try {
      const items = await listYouTubeVideos(credential.id, batch);
      for (const item of items) {
        if (!item.id) continue;
        dataApiItems.set(item.id, {
          viewCount: toCount(item.statistics?.viewCount),
          likeCount: toCount(item.statistics?.likeCount),
          commentCount: toCount(item.statistics?.commentCount),
          favoriteCount: toCount(item.statistics?.favoriteCount),
          durationSeconds: parseIsoDurationToSeconds(item.contentDetails?.duration),
          privacyStatus: item.status?.privacyStatus ?? null,
        });
      }
      process.stdout.write(`  Data API: ${Math.min(i + DATA_API_BATCH_SIZE, platformVideoIds.length)}/${platformVideoIds.length}\r`);
    } catch (err) {
      if (isQuotaExceededError(err)) {
        const reset = nextQuotaResetUtc();
        console.error(`\nData API quota exceeded. Resets at ${reset.toISOString()}`);
        console.error("Stop. Re-run tomorrow with --execute.");
        process.exit(1);
      }
      console.error(`\nData API error at batch ${i}:`, err instanceof Error ? err.message : String(err));
    }
  }
  console.log(`\n  Data API fetched: ${dataApiItems.size}/${platformVideoIds.length} videos`);

  // 2. Analytics API: Phase A metrics
  console.log("\n── Fetching Analytics API metrics (Phase A) ──────────────");
  let analyticsMap: Map<string, {
    shareCount: number | null;
    estimatedMinutesWatched: number | null;
    subscribersGained: number | null;
    subscribersLost: number | null;
    avgViewDurationSec: number | null;
    retentionPct: number | null;
    ctr: number | null;
    impressions: number | null;
  }> = new Map();

  try {
    analyticsMap = await fetchYouTubeAnalyticsMetrics(
      credential.id,
      platformVideoIds,
      analyticsStartDate,
      analyticsEndDate,
    );
    console.log(`  Analytics API returned: ${analyticsMap.size} rows`);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      const reset = nextQuotaResetUtc();
      console.error(`Analytics API quota exceeded. Resets at ${reset.toISOString()}`);
      console.error("Stop. Re-run tomorrow with --execute.");
      process.exit(1);
    }
    console.warn(`Analytics API error (will insert Data-API-only snapshots):`, err instanceof Error ? err.message : String(err));
  }

  // 3. Insert snapshots
  console.log("\n── Inserting snapshots ──────────────────────────────────");
  const now = new Date();
  let inserted = 0;
  let dataApiOnly = 0;
  let phaseARows = 0;
  const errors: string[] = [];

  for (const platformVideoId of platformVideoIds) {
    const row = videoIdToRow.get(platformVideoId);
    if (!row) continue;

    const dataMetrics = dataApiItems.get(platformVideoId) ?? null;
    const analytics = analyticsMap.get(platformVideoId) ?? null;

    try {
      await db.insert(videoMetricSnapshots).values({
        publishedVideoId: row.id,
        fetchedAt: now,
        viewCount: dataMetrics?.viewCount ?? null,
        likeCount: dataMetrics?.likeCount ?? null,
        commentCount: dataMetrics?.commentCount ?? null,
        favoriteCount: dataMetrics?.favoriteCount ?? null,
        durationSeconds: dataMetrics?.durationSeconds ?? null,
        privacyStatus: dataMetrics?.privacyStatus ?? null,
        // Analytics API fields
        ctr: analytics?.ctr !== null && analytics?.ctr !== undefined ? String(analytics.ctr) : null,
        avgViewDurationSec: analytics?.avgViewDurationSec ?? null,
        retentionPct: analytics?.retentionPct !== null && analytics?.retentionPct !== undefined
          ? toRetentionPctDbValue(analytics.retentionPct)
          : null,
        shareCount: analytics?.shareCount ?? null,
        estimatedMinutesWatched: analytics?.estimatedMinutesWatched ?? null,
        subscribersGained: analytics?.subscribersGained ?? null,
        subscribersLost: analytics?.subscribersLost ?? null,
        rawJson: { source: "phase_a_backfill", backfilledAt: now.toISOString() },
      });
      inserted++;
      if (analytics) phaseARows++;
      else dataApiOnly++;
    } catch (err) {
      errors.push(`${platformVideoId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Post-run report ────────────────────────────────────────────────────────
  console.log(`\n── Results ───────────────────────────────────────────────`);
  console.log(`Videos processed:              ${platformVideoIds.length}`);
  console.log(`Snapshots inserted:            ${inserted}`);
  console.log(`  with Phase A analytics:      ${phaseARows}`);
  console.log(`  Data API only (no analytics):${dataApiOnly}`);
  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    for (const e of errors) console.log(`  - ${e}`);
  } else {
    console.log(`Errors: 0`);
  }

  // Updated Phase A counts for entire phat_phap scope (all time)
  console.log(`\n── Updated Phase A coverage (all phat_phap snapshots) ────`);
  const updatedCoverage = await preflight(null);
  if (updatedCoverage.phaseACoverage) {
    const c = updatedCoverage.phaseACoverage;
    console.log(`Total snapshots:               ${c.totalSnapshots}`);
    console.log(`share_count non-null:          ${c.shareCount}`);
    console.log(`estimated_minutes_watched:     ${c.emw}`);
    console.log(`subscribers_gained:            ${c.subGained}`);
    console.log(`subscribers_lost:              ${c.subLost}`);
    console.log(`retention_pct:                 ${c.retention}`);
  }

  if (errors.length > 0) {
    console.log("\n⚠  Some insertions failed — check errors above.");
    process.exit(1);
  } else {
    console.log("\n✓  Backfill complete.");
  }
}

main().catch((err) => {
  const e = err as Error & { cause?: unknown; code?: string };
  console.error("\nFatal:", e.message ?? String(err));
  if (e.cause) console.error("Cause:", String(e.cause));
  if (e.code) console.error("Code:", e.code);
  process.exit(1);
});
