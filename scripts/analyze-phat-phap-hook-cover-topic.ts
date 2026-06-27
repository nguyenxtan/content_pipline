import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { resolveShortCoverSourceImage } from "@/lib/image/short-cover-asset-generator";

const { Pool } = pg;

// Known incident windows from docs/PROJECT_MASTER_PLAN.md / docs/DECISIONS.md (ADR-027/028).
// Observational only — used to annotate rows, never to exclude them.
const LEGACY_DIRTY_QUEUE_WINDOWS: Array<{ from: string; to: string; label: string }> = [
  { from: "2026-06-16T00:00:00Z", to: "2026-06-19T23:59:59Z", label: "docker_outage_and_pileup_recovery" },
];

type Args = {
  from: string | null;
  to: string | null;
  minViews: number | null;
  includeYoutube: boolean;
  includeFacebook: boolean;
  json: boolean;
};

type ContentRow = {
  id: string;
  topic: string;
  format_type: string | null;
  topic_family: string | null;
  hook_pattern: string | null;
  hook_type: string | null;
  short_selected_hook: string | null;
  short_cover_text: string | null;
  short_cover_asset_path: string | null;
  short_cover_generated_at: string | null;
  image_paths: string[] | null;
  prompt_versions: unknown;
  created_at: string;
};

type PlatformRow = {
  content_id: string;
  platform: string;
  video_type: string;
  published_at: string | null;
  latest_view_count: string | number | null;
  latest_like_count: string | number | null;
  latest_comment_count: string | number | null;
  snapshot_retention_pct: string | number | null;
  snapshot_avg_view_duration_sec: number | null;
  snapshot_share_count: string | number | null;
  snapshot_view_count: string | number | null;
};

type CoverState =
  | "no_cover_asset"
  | "coverText_only"
  | "cover_asset_present";

type PublishTimeCoverState = "at_publish" | "after_publish" | "unknown" | "not_applicable_unpublished";

type MetricRow = {
  contentId: string;
  title: string;
  formatType: string;
  topicFamily: string;
  hookPattern: string;
  platform: "youtube" | "facebook";
  views: number;
  retentionPct: number | null;
  likes: number;
  comments: number;
  shares: number;
  coverState: CoverState;
  coverTextNow: string | null;
  hasCoverAssetNow: boolean;
  coverAssetAtPublish: PublishTimeCoverState;
  coverTextAtPublish: PublishTimeCoverState;
  publishedAt: string | null;
  qualityFlags: string[];
};

function parseArgs(argv: string[]): Args {
  let from: string | null = null;
  let to: string | null = null;
  let minViews: number | null = null;
  let includeYoutube = false;
  let includeFacebook = false;
  let anyPlatformFlag = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") {
      from = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--to") {
      to = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--min-views") {
      const parsed = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error("--min-views must be >= 0");
      minViews = parsed;
      index += 1;
      continue;
    }
    if (arg === "--include-youtube") {
      includeYoutube = true;
      anyPlatformFlag = true;
      continue;
    }
    if (arg === "--include-facebook") {
      includeFacebook = true;
      anyPlatformFlag = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!anyPlatformFlag) {
    includeYoutube = true;
    includeFacebook = true;
  }

  return { from, to, minViews, includeYoutube, includeFacebook, json };
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round1(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

function confidenceFor(count: number): string {
  if (count >= 5) return "adequate (>=5 per data sufficiency rule)";
  if (count >= 2) return "low_sample";
  return "insufficient (n=1)";
}

function inDirtyWindow(publishedAt: string | null): string | null {
  if (!publishedAt) return null;
  const ts = new Date(publishedAt).getTime();
  for (const window of LEGACY_DIRTY_QUEUE_WINDOWS) {
    if (ts >= new Date(window.from).getTime() && ts <= new Date(window.to).getTime()) {
      return window.label;
    }
  }
  return null;
}

function getCoverDetails(promptVersions: unknown): Record<string, unknown> | null {
  if (!promptVersions || typeof promptVersions !== "object") return null;
  const cover = (promptVersions as Record<string, unknown>).cover;
  if (!cover || typeof cover !== "object") return null;
  const details = (cover as Record<string, unknown>).details;
  return details && typeof details === "object" ? (details as Record<string, unknown>) : null;
}

function derivePublishTimeCoverState(input: {
  hasValue: boolean;
  generatedAt: string | null;
  sourceIsKnownBackfill: boolean;
  sourceIsRenderPipeline: boolean;
  earliestPublishedAt: string | null;
}): PublishTimeCoverState {
  if (!input.earliestPublishedAt) return "not_applicable_unpublished";
  if (!input.hasValue) return "at_publish"; // absence is a known state, not ambiguous
  if (input.sourceIsKnownBackfill) return "after_publish";
  if (!input.generatedAt) {
    if (input.sourceIsRenderPipeline) return "at_publish";
    return "unknown";
  }
  const generated = new Date(input.generatedAt).getTime();
  const published = new Date(input.earliestPublishedAt).getTime();
  if (!Number.isFinite(generated) || !Number.isFinite(published)) return "unknown";
  return generated <= published ? "at_publish" : "after_publish";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const whereParts = ["channel_key = 'phat_phap'", "format_type in ('tts_short', 'legacy_quote_short')"];
    const params: Array<string | number> = [];
    let paramIndex = 1;

    if (args.from) {
      whereParts.push(`created_at >= $${paramIndex}::timestamptz`);
      params.push(args.from);
      paramIndex += 1;
    }
    if (args.to) {
      whereParts.push(`created_at < $${paramIndex}::timestamptz`);
      params.push(args.to);
      paramIndex += 1;
    }

    const contentResult = await pool.query<ContentRow>(
      `
        select
          id, topic, format_type, topic_family, hook_pattern, hook_type,
          short_selected_hook, short_cover_text, short_cover_asset_path,
          short_cover_generated_at::text, image_paths, prompt_versions, created_at::text
        from content_generations
        where ${whereParts.join(" and ")}
        order by created_at desc
      `,
      params,
    );

    const contentRows = contentResult.rows;
    const contentIds = contentRows.map((row) => row.id);

    const platforms: string[] = [];
    if (args.includeYoutube) platforms.push("youtube");
    if (args.includeFacebook) platforms.push("facebook");

    let platformRows: PlatformRow[] = [];
    if (contentIds.length > 0 && platforms.length > 0) {
      const platformResult = await pool.query<PlatformRow>(
        `
          select
            pv.content_id,
            pv.platform,
            pv.video_type,
            pv.published_at::text,
            pv.latest_view_count,
            pv.latest_like_count,
            pv.latest_comment_count,
            latest_snap.retention_pct as snapshot_retention_pct,
            latest_snap.avg_view_duration_sec as snapshot_avg_view_duration_sec,
            latest_snap.share_count as snapshot_share_count,
            latest_snap.view_count as snapshot_view_count
          from published_videos pv
          left join lateral (
            select vms.retention_pct, vms.avg_view_duration_sec, vms.share_count, vms.view_count
            from video_metric_snapshots vms
            where vms.published_video_id = pv.id
            order by vms.fetched_at desc
            limit 1
          ) latest_snap on true
          where pv.content_id = any($1)
            and pv.video_type = 'short'
            and pv.platform = any($2)
        `,
        [contentIds, platforms],
      );
      platformRows = platformResult.rows;
    }

    const platformsByContent = new Map<string, PlatformRow[]>();
    for (const row of platformRows) {
      const list = platformsByContent.get(row.content_id) ?? [];
      list.push(row);
      platformsByContent.set(row.content_id, list);
    }

    const metricRows: MetricRow[] = [];
    let completePairs = 0;
    let incompletePairs = 0;
    const coverAssetStateCounts = { at_publish: 0, after_publish: 0, unknown: 0, not_applicable_unpublished: 0 };
    const coverTextStateCounts = { at_publish: 0, after_publish: 0, unknown: 0, not_applicable_unpublished: 0 };
    let missingAnalyticsCount = 0;
    let legacyDirtyQueueCount = 0;

    for (const row of contentRows) {
      const rowsForContent = platformsByContent.get(row.id) ?? [];
      const ytRow = rowsForContent.find((r) => r.platform === "youtube") ?? null;
      const fbRow = rowsForContent.find((r) => r.platform === "facebook") ?? null;
      const hasComplete = Boolean(ytRow?.published_at) && Boolean(fbRow?.published_at);
      if (ytRow || fbRow) {
        if (hasComplete) completePairs += 1;
        else incompletePairs += 1;
      }

      const publishedDates = [ytRow?.published_at, fbRow?.published_at].filter(
        (value): value is string => Boolean(value),
      );
      const earliestPublishedAt = publishedDates.length
        ? publishedDates.sort()[0]
        : null;

      const coverDetails = getCoverDetails(row.prompt_versions);
      const metadataSource = (coverDetails?.metadataSource as string | undefined) ?? null;
      const assetGeneration = coverDetails?.assetGeneration as Record<string, unknown> | undefined;
      const assetGenSource = (assetGeneration?.source as string | undefined) ?? null;
      const coverTextGeneratedAt = (coverDetails?.generatedAt as string | undefined) ?? null;
      const hasCoverText = Boolean(row.short_cover_text?.trim());
      const hasCoverAssetNow = Boolean(row.short_cover_asset_path);

      const coverTextAtPublish = derivePublishTimeCoverState({
        hasValue: hasCoverText,
        generatedAt: coverTextGeneratedAt,
        sourceIsKnownBackfill: metadataSource === "backfill_v1" || metadataSource === "backfill_v2",
        sourceIsRenderPipeline: metadataSource === "render_pipeline_v1",
        earliestPublishedAt,
      });
      const coverAssetAtPublish = derivePublishTimeCoverState({
        hasValue: hasCoverAssetNow,
        generatedAt: row.short_cover_generated_at,
        sourceIsKnownBackfill: assetGenSource === "standalone_asset_backfill_v1",
        sourceIsRenderPipeline: metadataSource === "render_pipeline_v1" && !assetGenSource,
        earliestPublishedAt,
      });

      coverAssetStateCounts[coverAssetAtPublish] += 1;
      coverTextStateCounts[coverTextAtPublish] += 1;

      const coverState: CoverState = hasCoverAssetNow
        ? "cover_asset_present"
        : hasCoverText
          ? "coverText_only"
          : "no_cover_asset";

      const dirtyWindow = inDirtyWindow(earliestPublishedAt);
      if (dirtyWindow) legacyDirtyQueueCount += 1;

      let missingSourceImageFlag = false;
      let orphanAssetIgnoredFlag = false;
      if (!hasCoverAssetNow) {
        const source = resolveShortCoverSourceImage({
          contentId: row.id,
          sourceImagePath: row.image_paths?.[0] ?? null,
        });
        if (!source.ok) missingSourceImageFlag = true;
        const canonicalPath = path.join(process.cwd(), `media/covers/${row.id}-short-cover.jpg`);
        if (fs.existsSync(canonicalPath)) orphanAssetIgnoredFlag = true;
      }

      for (const platformRow of rowsForContent) {
        if (!platformRow.published_at) continue;
        const views = toNumber(platformRow.platform === "youtube" ? platformRow.latest_view_count : platformRow.latest_view_count);
        if (args.minViews != null && views < args.minViews) continue;

        const retentionPct =
          platformRow.platform === "youtube" ? toNullableNumber(platformRow.snapshot_retention_pct) : null;
        const hasAnyAnalytics =
          views > 0 || retentionPct != null || toNumber(platformRow.latest_like_count) > 0;
        if (!hasAnyAnalytics) missingAnalyticsCount += 1;

        const qualityFlags: string[] = [];
        if (!hasComplete) qualityFlags.push("incomplete_platform_pair");
        if (!hasAnyAnalytics) qualityFlags.push("missing_analytics");
        if (retentionPct != null && retentionPct > 100) qualityFlags.push("retention_over_100_shorts_replay");
        if (coverAssetAtPublish === "after_publish") qualityFlags.push("cover_asset_generated_after_publish");
        if (dirtyWindow) qualityFlags.push("legacy_dirty_queue_period");
        if (missingSourceImageFlag) qualityFlags.push("missing_source_image");
        if (orphanAssetIgnoredFlag) qualityFlags.push("orphan_asset_ignored");

        metricRows.push({
          contentId: row.id,
          title: row.topic,
          formatType: row.format_type ?? "(unknown)",
          topicFamily: row.topic_family ?? "(unclassified)",
          hookPattern: row.hook_pattern ?? row.hook_type ?? "(untracked)",
          platform: platformRow.platform as "youtube" | "facebook",
          views,
          retentionPct,
          likes: toNumber(platformRow.latest_like_count),
          comments: toNumber(platformRow.latest_comment_count),
          shares: toNumber(platformRow.snapshot_share_count),
          coverState,
          coverTextNow: row.short_cover_text,
          hasCoverAssetNow,
          coverAssetAtPublish,
          coverTextAtPublish,
          publishedAt: platformRow.published_at,
          qualityFlags,
        });
      }
    }

    const ytRows = metricRows.filter((r) => r.platform === "youtube");
    const fbRows = metricRows.filter((r) => r.platform === "facebook");
    const retentionRows = ytRows.filter((r) => r.retentionPct != null);

    function groupBy<K extends string>(rows: MetricRow[], keyFn: (row: MetricRow) => K) {
      const groups = new Map<K, MetricRow[]>();
      for (const row of rows) {
        const key = keyFn(row);
        const list = groups.get(key) ?? [];
        list.push(row);
        groups.set(key, list);
      }
      return groups;
    }

    function summarize(rows: MetricRow[]) {
      const views = rows.map((r) => r.views);
      const retentions = rows.filter((r) => r.retentionPct != null).map((r) => r.retentionPct as number);
      return {
        count: rows.length,
        avgViews: round1(mean(views)),
        medianViews: median(views),
        avgRetention: round1(mean(retentions)),
        retentionSampleSize: retentions.length,
      };
    }

    const topicFamilyGroups = groupBy(ytRows, (r) => r.topicFamily);
    const hookPatternGroups = groupBy(ytRows, (r) => r.hookPattern);
    const formatGroups = groupBy(ytRows, (r) => r.formatType);
    const coverStateGroups = groupBy(ytRows, (r) => r.coverState);
    const comboGroups = groupBy(ytRows, (r) => `${r.topicFamily}::${r.hookPattern}` as const);

    const topicFamilyRanking = [...topicFamilyGroups.entries()]
      .map(([topicFamily, rows]) => ({ topicFamily, ...summarize(rows) }))
      .sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0));

    const hookPatternRanking = [...hookPatternGroups.entries()]
      .map(([hookPattern, rows]) => ({ hookPattern, ...summarize(rows) }))
      .sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0));

    const formatComparison = [...formatGroups.entries()]
      .map(([formatType, rows]) => ({ formatType, ...summarize(rows) }))
      .sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0));

    const coverObservations = [...coverStateGroups.entries()]
      .map(([coverState, rows]) => {
        const afterPublishCount = rows.filter((r) => r.coverAssetAtPublish === "after_publish").length;
        return {
          coverState,
          ...summarize(rows),
          caveat:
            coverState === "cover_asset_present" && afterPublishCount > 0
              ? `${afterPublishCount}/${rows.length} had asset generated AFTER publish — views/retention predate the asset, observational only`
              : coverState === "cover_asset_present"
                ? "asset present at publish time for all rows in this group"
                : "-",
        };
      })
      .sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0));

    const bestCombinations = [...comboGroups.entries()]
      .map(([key, rows]) => {
        const [topicFamily, hookPattern] = key.split("::");
        const coverPresentCount = rows.filter((r) => r.hasCoverAssetNow).length;
        const dominantCoverState = coverPresentCount >= rows.length / 2 ? "cover_asset_present" : "no_or_text_only";
        return {
          topicFamily,
          hookPattern,
          coverState: dominantCoverState,
          ...summarize(rows),
        };
      })
      .filter((combo) => combo.count >= 2)
      .sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0))
      .slice(0, 10);

    const eligibleForWinners = ytRows.filter((r) => !r.qualityFlags.includes("missing_analytics"));
    const sortedByViews = [...eligibleForWinners].sort((a, b) => b.views - a.views);
    const winners = sortedByViews.slice(0, 10);
    const losers = [...eligibleForWinners]
      .filter((r) => r.views > 0)
      .sort((a, b) => a.views - b.views)
      .slice(0, 10);

    const facebookSummary = summarize(fbRows);

    const payload = {
      meta: {
        from: args.from,
        to: args.to,
        minViews: args.minViews,
        includeYoutube: args.includeYoutube,
        includeFacebook: args.includeFacebook,
      },
      audit: {
        contentRowsAnalyzed: contentRows.length,
        youtubeRowsWithAnalytics: ytRows.length,
        facebookRowsWithAnalytics: fbRows.length,
        retentionCoverage: retentionRows.length,
        completePairs,
        incompletePairsExcludedFromPairLogic: incompletePairs,
      },
      dataQuality: {
        coverAssetTimingStates: coverAssetStateCounts,
        coverTextTimingStates: coverTextStateCounts,
        missingAnalyticsCount,
        legacyDirtyQueueCount,
        lowSampleGroups: topicFamilyRanking.filter((g) => g.count < 5).map((g) => g.topicFamily),
      },
      topicFamilyRanking,
      hookPatternRanking,
      formatComparison,
      coverObservations,
      bestCombinations,
      facebookSummary,
      winners,
      losers,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Hook/Cover/Topic Performance Audit");
    console.log(`- Date range: ${args.from ?? "(none)"} to ${args.to ?? "(none)"}`);
    console.log(`- Content rows analyzed: ${payload.audit.contentRowsAnalyzed}`);
    console.log(`- YouTube rows with analytics: ${payload.audit.youtubeRowsWithAnalytics}`);
    console.log(`- Facebook rows with analytics: ${payload.audit.facebookRowsWithAnalytics}`);
    console.log(`- Retention coverage: ${payload.audit.retentionCoverage}`);
    console.log(`- Complete platform pairs: ${payload.audit.completePairs}`);
    console.log(`- Incomplete pairs (flagged, not excluded from per-platform stats): ${payload.audit.incompletePairsExcludedFromPairLogic}`);

    console.log("\n### Data Quality");
    const cas = payload.dataQuality.coverAssetTimingStates;
    const cts = payload.dataQuality.coverTextTimingStates;
    console.log(
      `- Cover asset at-publish state: at_publish=${cas.at_publish}, after_publish=${cas.after_publish}, unknown=${cas.unknown}, not_applicable_unpublished=${cas.not_applicable_unpublished}`,
    );
    console.log(
      `- CoverText at-publish state: at_publish=${cts.at_publish}, after_publish=${cts.after_publish}, unknown=${cts.unknown}, not_applicable_unpublished=${cts.not_applicable_unpublished}`,
    );
    console.log(`- Cover asset generated after publish (backfill, observational only): ${cas.after_publish}`);
    console.log(`- Missing analytics rows: ${payload.dataQuality.missingAnalyticsCount}`);
    console.log(`- Legacy dirty queue period rows: ${payload.dataQuality.legacyDirtyQueueCount}`);
    console.log(`- Low-sample topic families (<5): ${payload.dataQuality.lowSampleGroups.join(", ") || "none"}`);

    console.log("\n### Topic Family Ranking (YouTube)");
    console.log("| topic_family | count | avg_views | median_views | avg_retention | confidence | notes |");
    console.log("|---|---:|---:|---:|---:|---|---|");
    for (const g of topicFamilyRanking) {
      console.log(
        `| ${g.topicFamily} | ${g.count} | ${g.avgViews ?? "-"} | ${g.medianViews ?? "-"} | ${g.avgRetention ?? "n/a"} | ${confidenceFor(g.count)} | retention n=${g.retentionSampleSize} |`,
      );
    }

    console.log("\n### Hook Pattern Ranking (YouTube)");
    console.log("| hook_pattern | count | avg_views | median_views | avg_retention | confidence | notes |");
    console.log("|---|---:|---:|---:|---:|---|---|");
    for (const g of hookPatternRanking) {
      console.log(
        `| ${g.hookPattern} | ${g.count} | ${g.avgViews ?? "-"} | ${g.medianViews ?? "-"} | ${g.avgRetention ?? "n/a"} | ${confidenceFor(g.count)} | retention n=${g.retentionSampleSize} |`,
      );
    }

    console.log("\n### Cover Observations (YouTube, observational only)");
    console.log("| cover_state | count | avg_views | median_views | avg_retention | caveat |");
    console.log("|---|---:|---:|---:|---:|---|");
    for (const g of coverObservations) {
      console.log(`| ${g.coverState} | ${g.count} | ${g.avgViews ?? "-"} | ${g.medianViews ?? "-"} | ${g.avgRetention ?? "n/a"} | ${g.caveat} |`);
    }

    console.log("\n### Format Comparison (YouTube)");
    console.log("| format_type | count | avg_views | median_views | avg_retention | notes |");
    console.log("|---|---:|---:|---:|---:|---|");
    for (const g of formatComparison) {
      console.log(`| ${g.formatType} | ${g.count} | ${g.avgViews ?? "-"} | ${g.medianViews ?? "-"} | ${g.avgRetention ?? "n/a"} | confidence: ${confidenceFor(g.count)} |`);
    }

    console.log("\n### Best Combinations (YouTube, n>=2)");
    console.log("| topic_family | hook_pattern | cover_state | count | avg_views | avg_retention | recommendation |");
    console.log("|---|---|---|---:|---:|---:|---|");
    for (const c of bestCombinations) {
      console.log(
        `| ${c.topicFamily} | ${c.hookPattern} | ${c.coverState} | ${c.count} | ${c.avgViews ?? "-"} | ${c.avgRetention ?? "n/a"} | ${confidenceFor(c.count)} |`,
      );
    }

    console.log("\n### Facebook Reach/Engagement Summary");
    console.log(
      `- count: ${facebookSummary.count} | avg_views: ${facebookSummary.avgViews ?? "-"} | median_views: ${facebookSummary.medianViews ?? "-"} | retention: not available on Facebook in current schema`,
    );

    console.log("\n### Winners (top by views, YouTube)");
    console.log("| content_id | title | format_type | topic_family | hook_pattern | views | retention | coverText |");
    console.log("|---|---|---|---|---|---:|---:|---|");
    for (const w of winners) {
      console.log(
        `| ${w.contentId} | ${w.title.slice(0, 40)} | ${w.formatType} | ${w.topicFamily} | ${w.hookPattern} | ${w.views} | ${w.retentionPct ?? "n/a"} | ${w.coverTextNow ?? "-"} |`,
      );
    }

    console.log("\n### Losers / Review Candidates (lowest views with traffic, YouTube)");
    console.log("| content_id | title | format_type | topic_family | hook_pattern | views | retention | flags |");
    console.log("|---|---|---|---|---|---:|---:|---|");
    for (const l of losers) {
      console.log(
        `| ${l.contentId} | ${l.title.slice(0, 40)} | ${l.formatType} | ${l.topicFamily} | ${l.hookPattern} | ${l.views} | ${l.retentionPct ?? "n/a"} | ${l.qualityFlags.join(", ") || "-"} |`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
