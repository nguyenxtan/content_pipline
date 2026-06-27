/**
 * Hook / Topic Family Analytics — read-only audit script.
 *
 * Reads DB + published analytics to produce a structured report for comparing:
 *   - experimentId / experimentVariant groups
 *   - topicFamily (stored or inferred via resolveTopicFamily)
 *   - hookPattern
 *   - thumbnailText / coverText
 *   - shortSelectedHook
 *   - YouTube analytics (views, retention, duration) where available
 *
 * No DB writes. No generation. No publish. Pure read + report.
 *
 * Output: output/hook-topic-analytics/report.json
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";
import { resolveTopicFamily } from "@/lib/config/topic-family-registry";

const { Pool } = pg;

const CWD      = process.cwd();
const OUT_DIR  = path.join(CWD, "output", "hook-topic-analytics");
const REPORT   = path.join(OUT_DIR, "report.json");

const MIN_SAMPLE_FOR_COMPARISON = 5;
const MIN_RETENTION_SAMPLE      = 10;

// ── Types ────────────────────────────────────────────────────────────────────

type ContentRow = {
  id: string;
  topic: string | null;
  topic_family: string | null;
  short_selected_hook: string | null;
  hook_pattern: string | null;
  hook_score: number | null;
  thumbnail_text: string | null;
  experiment_id: string | null;
  experiment_variant: string | null;
  content_mode: string | null;
  video_status: string | null;
  created_at: Date;
  // joined from published_videos (null if not published on youtube)
  pv_id: string | null;
  pv_platform: string | null;
  platform_video_id: string | null;
  platform_video_url: string | null;
  published_at: Date | null;
  latest_view_count: number | null;
  latest_like_count: number | null;
  // joined from latest metric snapshot (null if no snapshot)
  snap_view_count: number | null;
  snap_retention_pct: number | null;
  snap_avg_view_duration_sec: number | null;
  snap_ctr: number | null;
  snap_fetched_at: Date | null;
};

type GroupStats = {
  count: number;
  publishedYt: number;
  withRetention: number;
  avgViews: number | null;
  medianViews: number | null;
  avgRetentionPct: number | null;
  avgViewDurationSec: number | null;
  totalViews: number;
  lowConfidence: boolean;
  retentionMissing: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function groupStats(rows: ContentRow[]): GroupStats {
  const published = rows.filter((r) => r.pv_id !== null);
  // pg returns bigint/numeric columns as strings — coerce to number explicitly
  const views = published
    .map((r) => {
      const v = r.snap_view_count ?? r.latest_view_count;
      return v != null ? Number(v) : 0;
    })
    .filter((v) => v > 0 && isFinite(v));
  const retentions = published
    .map((r) => r.snap_retention_pct != null ? Number(r.snap_retention_pct) : null)
    .filter((v): v is number => v !== null && isFinite(v));
  const durations = published
    .map((r) => r.snap_avg_view_duration_sec != null ? Number(r.snap_avg_view_duration_sec) : null)
    .filter((v): v is number => v !== null && isFinite(v));

  const totalViews = views.reduce((s, v) => s + v, 0);

  return {
    count:              rows.length,
    publishedYt:        published.length,
    withRetention:      retentions.length,
    avgViews:           views.length > 0 ? Math.round(totalViews / views.length) : null,
    medianViews:        median(views) !== null ? Math.round(median(views)!) : null,
    avgRetentionPct:    retentions.length > 0
      ? parseFloat((retentions.reduce((s, v) => s + v, 0) / retentions.length).toFixed(2))
      : null,
    avgViewDurationSec: durations.length > 0
      ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
      : null,
    totalViews,
    lowConfidence:      published.length < MIN_SAMPLE_FOR_COMPARISON,
    retentionMissing:   retentions.length < MIN_RETENTION_SAMPLE,
  };
}

function dataSufficiencyWarnings(stats: GroupStats, label: string): string[] {
  const warnings: string[] = [];
  if (stats.publishedYt === 0) warnings.push(`${label}: 0 published on YouTube — no analytics available yet`);
  else if (stats.publishedYt < MIN_SAMPLE_FOR_COMPARISON) warnings.push(`${label}: only ${stats.publishedYt} published (need ≥${MIN_SAMPLE_FOR_COMPARISON} for reliable comparison)`);
  if (stats.publishedYt > 0 && stats.withRetention === 0) warnings.push(`${label}: retention not synced — re-auth YouTube Analytics API or wait 48h post-publish`);
  else if (stats.withRetention < MIN_RETENTION_SAMPLE && stats.publishedYt > 0) warnings.push(`${label}: only ${stats.withRetention}/${stats.publishedYt} published videos have retention data`);
  return warnings;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Single query: content_generations LEFT JOIN published_videos (youtube shorts only)
  // LEFT JOIN latest metric snapshot per published video
  const { rows } = await pool.query<ContentRow>(`
    WITH latest_snap AS (
      SELECT DISTINCT ON (published_video_id)
        published_video_id,
        view_count       AS snap_view_count,
        retention_pct    AS snap_retention_pct,
        avg_view_duration_sec AS snap_avg_view_duration_sec,
        ctr              AS snap_ctr,
        fetched_at       AS snap_fetched_at
      FROM video_metric_snapshots
      ORDER BY published_video_id, fetched_at DESC
    )
    SELECT
      cg.id,
      cg.topic,
      cg.topic_family,
      cg.short_selected_hook,
      cg.hook_pattern,
      cg.hook_score,
      cg.thumbnail_text,
      cg.experiment_id,
      cg.experiment_variant,
      cg.content_mode,
      cg.video_status,
      cg.created_at,
      pv.id              AS pv_id,
      pv.platform        AS pv_platform,
      pv.platform_video_id,
      pv.platform_video_url,
      pv.published_at,
      pv.latest_view_count,
      pv.latest_like_count,
      ls.snap_view_count,
      ls.snap_retention_pct::float    AS snap_retention_pct,
      ls.snap_avg_view_duration_sec,
      ls.snap_ctr::float              AS snap_ctr,
      ls.snap_fetched_at
    FROM content_generations cg
    LEFT JOIN published_videos pv
      ON pv.content_id = cg.id
      AND pv.platform = 'youtube'
      AND pv.video_type = 'short'
    LEFT JOIN latest_snap ls ON ls.published_video_id = pv.id
    WHERE cg.content_mode IN ('short', 'both')
    ORDER BY cg.created_at DESC
  `);

  await pool.end();

  console.log(`[audit] Loaded ${rows.length} short content rows`);

  // ── 1. Totals ───────────────────────────────────────────────────────────────
  const totalGenerated  = rows.length;
  const totalPublishedYt = rows.filter((r) => r.pv_id !== null).length;
  const totalWithRetention = rows.filter((r) => r.snap_retention_pct !== null).length;
  const totalVideoDone  = rows.filter((r) => r.video_status === "done").length;

  // ── 2. By experimentId / experimentVariant ──────────────────────────────────
  const expMap = new Map<string, ContentRow[]>();
  for (const row of rows) {
    const key = `${row.experiment_id ?? "UNASSIGNED"}|${row.experiment_variant ?? "UNASSIGNED"}`;
    if (!expMap.has(key)) expMap.set(key, []);
    expMap.get(key)!.push(row);
  }

  const byExperiment = Array.from(expMap.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, grpRows]) => {
      const [experimentId, experimentVariant] = key.split("|");
      const stats = groupStats(grpRows);
      return { experimentId, experimentVariant, ...stats };
    });

  // ── 3. By topicFamily ───────────────────────────────────────────────────────
  const familyMap = new Map<string, ContentRow[]>();
  for (const row of rows) {
    const { strategicFamily } = resolveTopicFamily({
      storedFamily: row.topic_family,
      topic: row.topic ?? "",
    });
    if (!familyMap.has(strategicFamily)) familyMap.set(strategicFamily, []);
    familyMap.get(strategicFamily)!.push(row);
  }

  const byTopicFamily = Array.from(familyMap.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([family, grpRows]) => {
      const stats = groupStats(grpRows);
      return { topicFamily: family, ...stats };
    });

  // ── 4. By hookPattern ───────────────────────────────────────────────────────
  const hookPatternMap = new Map<string, ContentRow[]>();
  for (const row of rows) {
    const key = row.hook_pattern ?? "no_pattern";
    if (!hookPatternMap.has(key)) hookPatternMap.set(key, []);
    hookPatternMap.get(key)!.push(row);
  }

  const byHookPattern = Array.from(hookPatternMap.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([hookPattern, grpRows]) => {
      const stats = groupStats(grpRows);
      return { hookPattern, ...stats };
    });

  // ── 5. By thumbnailText ─────────────────────────────────────────────────────
  const thumbMap = new Map<string, ContentRow[]>();
  for (const row of rows) {
    const key = row.thumbnail_text?.trim() || "(not_set)";
    if (!thumbMap.has(key)) thumbMap.set(key, []);
    thumbMap.get(key)!.push(row);
  }

  const byThumbnailText = Array.from(thumbMap.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 30) // top 30 to avoid huge report
    .map(([thumbnailText, grpRows]) => ({
      thumbnailText,
      count: grpRows.length,
      publishedYt: grpRows.filter((r) => r.pv_id !== null).length,
      experimentIds: [...new Set(grpRows.map((r) => r.experiment_id).filter(Boolean))],
    }));

  // ── 6. Cover intro rows detail ──────────────────────────────────────────────
  const coverIntroRows = rows.filter((r) => r.experiment_id === "short-cover-intro-v1");
  const coverIntroDetail = coverIntroRows.map((r) => ({
    id:               r.id,
    topic:            r.topic,
    topicFamily:      resolveTopicFamily({ storedFamily: r.topic_family, topic: r.topic ?? "" }).strategicFamily,
    selectedHook:     r.short_selected_hook,
    hookPattern:      r.hook_pattern,
    hookScore:        r.hook_score,
    thumbnailText:    r.thumbnail_text,
    experimentId:     r.experiment_id,
    experimentVariant: r.experiment_variant,
    videoStatus:      r.video_status,
    publishedAt:      r.published_at,
    ytUrl:            r.platform_video_url,
    views:            r.snap_view_count != null ? Number(r.snap_view_count) : r.latest_view_count != null ? Number(r.latest_view_count) : null,
    retentionPct:     r.snap_retention_pct != null ? Number(r.snap_retention_pct) : null,
    avgViewDurationSec: r.snap_avg_view_duration_sec != null ? Number(r.snap_avg_view_duration_sec) : null,
  }));

  const coverIntroStats = groupStats(coverIntroRows);

  // ── 7. HOOK_V2 baseline detail ──────────────────────────────────────────────
  const hookV2Rows = rows.filter((r) => r.experiment_id === "HOOK" && r.experiment_variant === "HOOK_V2");
  const hookV2Stats = groupStats(hookV2Rows);

  const toViews = (r: ContentRow) => Number(r.snap_view_count ?? r.latest_view_count ?? 0);
  const toRet   = (r: ContentRow) => r.snap_retention_pct != null ? Number(r.snap_retention_pct) : null;

  const hookV2TopByViews = [...hookV2Rows]
    .filter((r) => r.pv_id !== null)
    .sort((a, b) => toViews(b) - toViews(a))
    .slice(0, 5)
    .map((r) => ({
      id:           r.id,
      topic:        r.topic,
      topicFamily:  resolveTopicFamily({ storedFamily: r.topic_family, topic: r.topic ?? "" }).strategicFamily,
      hookPattern:  r.hook_pattern,
      views:        toViews(r),
      retentionPct: toRet(r),
      ytUrl:        r.platform_video_url,
    }));

  const hookV2BottomByViews = [...hookV2Rows]
    .filter((r) => r.pv_id !== null && toViews(r) > 0)
    .sort((a, b) => toViews(a) - toViews(b))
    .slice(0, 5)
    .map((r) => ({
      id:           r.id,
      topic:        r.topic,
      topicFamily:  resolveTopicFamily({ storedFamily: r.topic_family, topic: r.topic ?? "" }).strategicFamily,
      hookPattern:  r.hook_pattern,
      views:        toViews(r),
      retentionPct: toRet(r),
      ytUrl:        r.platform_video_url,
    }));

  // ── 8. Data sufficiency warnings ────────────────────────────────────────────
  const warnings: string[] = [];
  warnings.push(...dataSufficiencyWarnings(coverIntroStats, "short-cover-intro-v1"));
  if (hookV2Stats.publishedYt < MIN_SAMPLE_FOR_COMPARISON) {
    warnings.push(...dataSufficiencyWarnings(hookV2Stats, "HOOK/HOOK_V2"));
  }
  if (hookV2Stats.withRetention < MIN_RETENTION_SAMPLE) {
    warnings.push(`HOOK_V2 retention coverage: ${hookV2Stats.withRetention}/${hookV2Stats.publishedYt} (need ≥${MIN_RETENTION_SAMPLE} for stable avg)`);
  }
  if (totalWithRetention === 0) {
    warnings.push("No retention data at all — YouTube Analytics API may not be connected or synced");
  }

  // ── 9. Build report ──────────────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      shortContentGenerated: totalGenerated,
      videoDone:             totalVideoDone,
      publishedYoutube:      totalPublishedYt,
      withRetentionData:     totalWithRetention,
    },
    byExperiment,
    byTopicFamily,
    byHookPattern,
    byThumbnailText,
    coverIntroExperiment: {
      experimentId:      "short-cover-intro-v1",
      experimentVariant: "intro_on_1p5s",
      stats:             coverIntroStats,
      rows:              coverIntroDetail,
      readyForComparison: coverIntroStats.publishedYt >= MIN_SAMPLE_FOR_COMPARISON,
      note: coverIntroStats.publishedYt === 0
        ? "All 7 cover intro videos are rendered but not yet published — queued for cron upload. Re-run this script after publish + 48h for meaningful comparison."
        : `${coverIntroStats.publishedYt} published. Wait until all are published and analytics synced before concluding.`,
    },
    hookV2Baseline: {
      experimentId:      "HOOK",
      experimentVariant: "HOOK_V2",
      stats:             hookV2Stats,
      topByViews:        hookV2Stats.publishedYt >= MIN_SAMPLE_FOR_COMPARISON ? hookV2TopByViews : [],
      bottomByViews:     hookV2Stats.publishedYt >= MIN_SAMPLE_FOR_COMPARISON ? hookV2BottomByViews : [],
      note: hookV2Stats.publishedYt >= MIN_SAMPLE_FOR_COMPARISON
        ? `Baseline established: ${hookV2Stats.publishedYt} published, avg ${hookV2Stats.avgViews} views, avg retention ${hookV2Stats.avgRetentionPct}%`
        : "Insufficient sample — need ≥5 published videos",
    },
    dataSufficiencyWarnings: warnings,
    comparisonReadiness: {
      coverIntroPublished:   coverIntroStats.publishedYt,
      hookV2Published:       hookV2Stats.publishedYt,
      coverIntroRetention:   coverIntroStats.withRetention,
      hookV2Retention:       hookV2Stats.withRetention,
      canCompareViews:       coverIntroStats.publishedYt >= MIN_SAMPLE_FOR_COMPARISON && hookV2Stats.publishedYt >= MIN_SAMPLE_FOR_COMPARISON,
      canCompareRetention:   coverIntroStats.withRetention >= MIN_RETENTION_SAMPLE && hookV2Stats.withRetention >= MIN_RETENTION_SAMPLE,
      recommendation: coverIntroStats.publishedYt === 0
        ? "WAIT: Cover intro videos not yet published. Re-run after publish + 48h."
        : coverIntroStats.publishedYt < MIN_SAMPLE_FOR_COMPARISON
          ? `PARTIAL: ${coverIntroStats.publishedYt}/${MIN_SAMPLE_FOR_COMPARISON} cover intro published. Continue rollout then re-run.`
          : "READY: Enough data for preliminary views comparison. Retention needs more time.",
    },
  };

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n[report] ${REPORT}`);

  // ── Console summary ──────────────────────────────────────────────────────────
  console.log("\n=== HOOK / TOPIC FAMILY ANALYTICS ===\n");
  console.log(`Total short content: ${totalGenerated}  published YT: ${totalPublishedYt}  with retention: ${totalWithRetention}`);

  console.log("\n── By experiment ──────────────────────────────");
  for (const e of byExperiment) {
    const conf = e.lowConfidence ? " [LOW_CONF]" : "";
    const ret = e.avgRetentionPct != null ? `ret=${e.avgRetentionPct}%` : "ret=n/a";
    const views = e.avgViews != null ? `avgViews=${e.avgViews}` : "avgViews=n/a";
    console.log(`  ${e.experimentId}/${e.experimentVariant}: n=${e.count} pub=${e.publishedYt} ${views} ${ret}${conf}`);
  }

  console.log("\n── By topicFamily (top 8) ─────────────────────");
  for (const f of byTopicFamily.slice(0, 8)) {
    const ret = f.avgRetentionPct != null ? `ret=${f.avgRetentionPct}%` : "ret=n/a";
    const views = f.avgViews != null ? `avgViews=${f.avgViews}` : "avgViews=n/a";
    console.log(`  ${f.topicFamily}: n=${f.count} pub=${f.publishedYt} ${views} ${ret}`);
  }

  console.log("\n── By hookPattern (top 8) ─────────────────────");
  for (const h of byHookPattern.slice(0, 8)) {
    const ret = h.avgRetentionPct != null ? `ret=${h.avgRetentionPct}%` : "ret=n/a";
    const views = h.avgViews != null ? `avgViews=${h.avgViews}` : "avgViews=n/a";
    console.log(`  ${h.hookPattern}: n=${h.count} pub=${h.publishedYt} ${views} ${ret}`);
  }

  console.log("\n── Cover intro rows ────────────────────────────");
  for (const r of coverIntroDetail) {
    console.log(`  ${r.id.slice(0, 8)} "${r.topic}" | family=${r.topicFamily} | hook=${r.hookPattern} | thumb="${r.thumbnailText}" | pub=${r.publishedAt ? "yes" : "no"}`);
  }

  console.log("\n── Data sufficiency warnings ───────────────────");
  for (const w of warnings) console.log(`  ⚠  ${w}`);

  console.log(`\n── Comparison readiness ────────────────────────`);
  console.log(`  ${report.comparisonReadiness.recommendation}`);
  console.log();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
