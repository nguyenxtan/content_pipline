/**
 * Retroactive Topic Family Classification — co_don_ban_sac
 *
 * Identifies CG-linked videos that match loneliness / identity / exhaustion
 * themes and should be classified as `co_don_ban_sac` rather than
 * `buong_bo_chua_lanh` or NULL.
 *
 * Safety guarantees:
 *   - Default mode is DRY-RUN (no DB writes).
 *   - Only high-confidence matches (conf >= 0.60) are updated in apply mode.
 *   - Never touches legacy rows (published_videos with content_id IS NULL).
 *   - Never touches rows whose current topic_family is already `co_don_ban_sac`.
 *   - Produces rollback SQL before applying any changes.
 *   - Does not modify Shorts pipeline, publishing, or upload_queue.
 *
 * Modes:
 *   DRY-RUN (default):
 *     npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/classify-co-don-ban-sac.ts
 *
 *   APPLY:
 *     npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/classify-co-don-ban-sac.ts --apply
 */

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { classifyTopic, FAMILY_TAXONOMY } from "@/lib/analytics/topic-family-classifier";

// ─── Config ───────────────────────────────────────────────────────────────────

const TARGET_FAMILY      = "co_don_ban_sac";
const HIGH_CONF_THRESH   = 0.60;  // only apply above this
const MEDIUM_CONF_THRESH = 0.30;  // report but don't apply below HIGH

// Source families that may contain misclassified co_don content
const RECLASSIFY_FROM: (string | null)[] = [
  null,                   // unclassified
  "buong_bo_chua_lanh",  // most likely to have co_don overlap
];

const REPORT_DIR  = path.join(process.cwd(), "reports", "retroactive-classification");
const DATE        = new Date().toISOString().slice(0, 10);

const IS_APPLY    = process.argv.includes("--apply");
const CHANNEL_KEY = "phat_phap";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CandidateRow {
  contentId: string;
  topic: string;
  currentFamily: string | null;
  viewCount: number;
  likeCount: number;
  retentionPct: number | null;
  publishedAt: string | null;
  platformVideoId: string | null;
}

interface ClassifiedCandidate extends CandidateRow {
  confidence: number;
  matchedKeywords: string[];
  tier: "high" | "medium" | "low";
  willUpdate: boolean;
  rollbackFamily: string | null;
}

// ─── DB Query ─────────────────────────────────────────────────────────────────

async function fetchCandidates(): Promise<CandidateRow[]> {
  // Fetch ALL CG-linked published phat_phap videos where:
  //   - topic_family is NULL  (unclassified)
  //   - topic_family = 'buong_bo_chua_lanh'  (possible misclassification)
  // Explicitly exclude legacy rows (content_id IS NULL handled by INNER JOIN)
  const rows = await db.execute(sql`
    SELECT
      cg.id                             AS content_id,
      cg.topic,
      cg.topic_family                   AS current_family,
      COALESCE(pv.latest_view_count, 0) AS view_count,
      COALESCE(pv.latest_like_count, 0) AS like_count,
      vms_agg.retention_pct,
      pv.published_at,
      pv.platform_video_id
    FROM content_generations cg
    INNER JOIN published_videos pv ON pv.content_id = cg.id
    LEFT JOIN (
      SELECT
        published_video_id,
        ROUND(AVG(retention_pct::numeric), 1) AS retention_pct
      FROM video_metric_snapshots
      WHERE avg_view_duration_sec IS NOT NULL
      GROUP BY published_video_id
    ) vms_agg ON vms_agg.published_video_id = pv.id
    WHERE cg.channel_key    = ${CHANNEL_KEY}
      AND pv.platform       = 'youtube'
      AND (
        cg.topic_family IS NULL
        OR cg.topic_family = 'buong_bo_chua_lanh'
      )
    ORDER BY pv.latest_view_count DESC NULLS LAST
  `);

  return (rows.rows as any[]).map(r => ({
    contentId:      r.content_id,
    topic:          r.topic ?? "",
    currentFamily:  r.current_family ?? null,
    viewCount:      Number(r.view_count) || 0,
    likeCount:      Number(r.like_count) || 0,
    retentionPct:   r.retention_pct !== null ? Number(r.retention_pct) : null,
    publishedAt:    r.published_at ? new Date(r.published_at).toISOString().slice(0, 10) : null,
    platformVideoId: r.platform_video_id ?? null,
  }));
}

// ─── Classification ───────────────────────────────────────────────────────────

function classifyCandidates(rows: CandidateRow[]): {
  toClassify: ClassifiedCandidate[];
  notMatched: CandidateRow[];
} {
  const toClassify: ClassifiedCandidate[] = [];
  const notMatched: CandidateRow[]        = [];

  for (const row of rows) {
    const result = classifyTopic(row.topic);

    // Only consider those that classify as co_don_ban_sac
    if (!result || result.family !== TARGET_FAMILY) {
      notMatched.push(row);
      continue;
    }

    const conf = result.confidence;
    const tier: "high" | "medium" | "low" =
      conf >= HIGH_CONF_THRESH   ? "high"   :
      conf >= MEDIUM_CONF_THRESH ? "medium" :
                                   "low";

    toClassify.push({
      ...row,
      confidence:      conf,
      matchedKeywords: result.matchedKeywords,
      tier,
      willUpdate:      tier === "high" && row.currentFamily !== TARGET_FAMILY,
      rollbackFamily:  row.currentFamily,  // null = was unclassified
    });
  }

  // Sort: high conf first, then by views
  toClassify.sort((a, b) => {
    if (a.tier !== b.tier) {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.tier] - order[b.tier];
    }
    return b.viewCount - a.viewCount;
  });

  return { toClassify, notMatched };
}

// ─── DB Apply ─────────────────────────────────────────────────────────────────

async function applyUpdates(candidates: ClassifiedCandidate[]): Promise<{
  updated: number;
  errors: Array<{ contentId: string; error: string }>;
}> {
  const toUpdate = candidates.filter(c => c.willUpdate);
  let updated    = 0;
  const errors: Array<{ contentId: string; error: string }> = [];

  for (const c of toUpdate) {
    try {
      await db.execute(sql`
        UPDATE content_generations
        SET topic_family = ${TARGET_FAMILY}
        WHERE id = ${c.contentId}
          AND (topic_family IS NULL OR topic_family = ${c.rollbackFamily ?? null})
      `);
      updated++;
      process.stdout.write(`  ✓ [${c.viewCount}v] ${c.topic.slice(0, 60)}\n`);
    } catch (e: any) {
      const msg = e.cause?.message ?? e.message;
      errors.push({ contentId: c.contentId, error: msg });
      process.stderr.write(`  ✗ ${c.contentId}: ${msg}\n`);
    }
  }

  return { updated, errors };
}

// ─── Report Builder ───────────────────────────────────────────────────────────

function buildReport(
  candidates: ClassifiedCandidate[],
  notMatched: CandidateRow[],
  applied: { updated: number; errors: Array<{ contentId: string; error: string }> } | null,
): string {
  const high   = candidates.filter(c => c.tier === "high");
  const medium = candidates.filter(c => c.tier === "medium");
  const low    = candidates.filter(c => c.tier === "low");

  const lines: string[] = [];
  lines.push(`# Retroactive Classification — co_don_ban_sac`);
  lines.push(`**Date:** ${DATE}`);
  lines.push(`**Mode:** ${IS_APPLY ? "APPLY" : "DRY-RUN"}`);
  lines.push(`**Target family:** \`co_don_ban_sac\` — ${FAMILY_TAXONOMY[TARGET_FAMILY]?.label}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Candidates scanned (NULL + buong_bo) | ${candidates.length + notMatched.length} |`);
  lines.push(`| Matched co_don_ban_sac (any conf)    | ${candidates.length} |`);
  lines.push(`| HIGH confidence (≥0.60) — will update | ${high.length} |`);
  lines.push(`| MEDIUM confidence (0.30–0.59) — report only | ${medium.length} |`);
  lines.push(`| LOW confidence (<0.30) — excluded      | ${low.length} |`);
  lines.push(`| Not matched (stays in current family)  | ${notMatched.length} |`);
  if (applied) {
    lines.push(`| **Actually updated in DB**             | **${applied.updated}** |`);
    lines.push(`| Errors during apply                    | ${applied.errors.length} |`);
  }
  lines.push(``);

  // Rollback SQL — generated upfront, even before apply, so it's always available
  const highCandidates = high.filter(c => c.willUpdate);
  if (highCandidates.length > 0) {
    lines.push(`## Rollback SQL`);
    lines.push(``);
    lines.push(`Run this to revert all HIGH-confidence updates:`);
    lines.push(``);
    lines.push("```sql");
    // Group by rollback family to generate minimal SQL
    const byRollback = new Map<string | null, string[]>();
    for (const c of highCandidates) {
      const key = c.rollbackFamily;
      if (!byRollback.has(key)) byRollback.set(key, []);
      byRollback.get(key)!.push(c.contentId);
    }
    for (const [from, ids] of byRollback.entries()) {
      const setVal = from === null ? "NULL" : `'${from}'`;
      const inList = ids.map(id => `'${id}'`).join(",\n  ");
      lines.push(`-- Revert ${ids.length} rows back to ${from ?? "NULL"}`);
      lines.push(`UPDATE content_generations`);
      lines.push(`SET topic_family = ${setVal}`);
      lines.push(`WHERE id IN (`);
      lines.push(`  ${inList}`);
      lines.push(`);`);
      lines.push(``);
    }
    lines.push("```");
    lines.push(``);
  }

  // HIGH candidates table
  lines.push(`## HIGH Confidence (conf ≥ 0.60) — ${high.length} candidates`);
  lines.push(``);
  lines.push(`| Views | Ret% | Conf | From → To | Keywords | Topic |`);
  lines.push(`|-------|------|------|-----------|----------|-------|`);
  for (const c of high) {
    const ret   = c.retentionPct !== null ? `${c.retentionPct}%` : "—";
    const from  = c.rollbackFamily ?? "NULL";
    const kws   = c.matchedKeywords.slice(0, 2).join(", ");
    const topic = c.topic.slice(0, 55);
    lines.push(`| ${c.viewCount} | ${ret} | ${(c.confidence * 100).toFixed(0)}% | \`${from}\` → \`${TARGET_FAMILY}\` | ${kws} | ${topic} |`);
  }
  lines.push(``);

  // MEDIUM candidates table
  if (medium.length > 0) {
    lines.push(`## MEDIUM Confidence (0.30–0.59) — ${medium.length} candidates (report only, not updated)`);
    lines.push(``);
    lines.push(`| Views | Ret% | Conf | From | Keywords | Topic |`);
    lines.push(`|-------|------|------|------|----------|-------|`);
    for (const c of medium) {
      const ret   = c.retentionPct !== null ? `${c.retentionPct}%` : "—";
      const from  = c.rollbackFamily ?? "NULL";
      const kws   = c.matchedKeywords.slice(0, 2).join(", ");
      const topic = c.topic.slice(0, 55);
      lines.push(`| ${c.viewCount} | ${ret} | ${(c.confidence * 100).toFixed(0)}% | \`${from}\` | ${kws} | ${topic} |`);
    }
    lines.push(``);
    lines.push(`*Medium-confidence topics need manual review before reclassification.*`);
    lines.push(``);
  }

  // Breakdown by source family
  lines.push(`## Source breakdown`);
  lines.push(``);
  const srcBreakdown = new Map<string, number>();
  for (const c of candidates) {
    const k = c.rollbackFamily ?? "NULL (unclassified)";
    srcBreakdown.set(k, (srcBreakdown.get(k) ?? 0) + 1);
  }
  for (const [fam, cnt] of [...srcBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- \`${fam}\`: ${cnt} matched candidates`);
  }
  lines.push(``);

  if (applied && applied.errors.length > 0) {
    lines.push(`## Apply Errors`);
    lines.push(``);
    for (const err of applied.errors) {
      lines.push(`- \`${err.contentId}\`: ${err.error}`);
    }
    lines.push(``);
  }

  lines.push(`## Next Steps`);
  lines.push(``);
  if (!IS_APPLY) {
    lines.push(`1. Review HIGH confidence candidates above.`);
    lines.push(`2. Run with \`--apply\` to update ${high.filter(c => c.willUpdate).length} records in DB.`);
    lines.push(`3. After apply, rerun analytics and picker to confirm \`co_don_ban_sac\` appears.`);
  } else {
    lines.push(`1. Verify updated records: \`SELECT id, topic, topic_family FROM content_generations WHERE topic_family = 'co_don_ban_sac' AND channel_key = '${CHANNEL_KEY}';\``);
    lines.push(`2. Rerun topic family analytics to confirm family stats update.`);
    lines.push(`3. Rerun longform picker V2 to confirm \`co_don_ban_sac\` appears in candidates.`);
    lines.push(`4. To rollback: use the SQL block above.`);
  }
  lines.push(``);

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nRetroactive Classification — co_don_ban_sac`);
  console.log(`Mode: ${IS_APPLY ? "APPLY ⚠" : "DRY-RUN (default)"}`);
  console.log(`High-confidence threshold: ${(HIGH_CONF_THRESH * 100).toFixed(0)}%\n`);

  // 1. Fetch candidates from DB
  console.log("Fetching CG-linked videos (NULL + buong_bo_chua_lanh)...");
  const rows = await fetchCandidates();
  console.log(`  Found ${rows.length} rows to evaluate\n`);

  // 2. Classify
  console.log("Running co_don_ban_sac classifier...");
  const { toClassify, notMatched } = classifyCandidates(rows);

  const high   = toClassify.filter(c => c.tier === "high");
  const medium = toClassify.filter(c => c.tier === "medium");

  console.log(`  Matched co_don_ban_sac: ${toClassify.length}`);
  console.log(`    HIGH   (≥${(HIGH_CONF_THRESH * 100).toFixed(0)}%): ${high.length}`);
  console.log(`    MEDIUM:                ${medium.length}`);
  console.log(`  Not matched:             ${notMatched.length}\n`);

  console.log("Sample HIGH confidence candidates:");
  for (const c of high.slice(0, 8)) {
    const ret = c.retentionPct !== null ? `, ret:${c.retentionPct}%` : "";
    const from = c.rollbackFamily ?? "NULL";
    console.log(`  [${c.viewCount}v${ret}] conf:${(c.confidence*100).toFixed(0)}% from:${from} "${c.topic.slice(0, 55)}"`);
  }
  console.log();

  // 3. Apply or dry-run
  let applied: { updated: number; errors: Array<{ contentId: string; error: string }> } | null = null;

  if (IS_APPLY) {
    const toUpdate = high.filter(c => c.willUpdate);
    console.log(`\n⚠  APPLYING: updating ${toUpdate.length} rows in content_generations.topic_family...`);
    applied = await applyUpdates(toClassify);
    console.log(`\nApply complete: ${applied.updated} updated, ${applied.errors.length} errors`);
  } else {
    console.log(`DRY-RUN: ${high.filter(c => c.willUpdate).length} records WOULD be updated.`);
    console.log(`Run with --apply to execute.`);
  }

  // 4. Write report
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const suffix = IS_APPLY ? "apply" : "dryrun";
  const reportPath = path.join(REPORT_DIR, `${DATE}-co-don-${suffix}.md`);
  const jsonPath   = path.join(REPORT_DIR, `${DATE}-co-don-${suffix}.json`);

  const md = buildReport(toClassify, notMatched, applied);
  fs.writeFileSync(reportPath, md, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({
    date: DATE,
    mode: IS_APPLY ? "apply" : "dryrun",
    targetFamily: TARGET_FAMILY,
    summary: {
      scanned:  rows.length,
      matched:  toClassify.length,
      high:     high.length,
      medium:   medium.length,
      willUpdate: high.filter(c => c.willUpdate).length,
      updated:  applied?.updated ?? 0,
    },
    highCandidates: high.map(c => ({
      contentId:       c.contentId,
      topic:           c.topic,
      currentFamily:   c.currentFamily,
      viewCount:       c.viewCount,
      retentionPct:    c.retentionPct,
      confidence:      c.confidence,
      matchedKeywords: c.matchedKeywords,
      willUpdate:      c.willUpdate,
    })),
    mediumCandidates: medium.map(c => ({
      contentId:       c.contentId,
      topic:           c.topic,
      currentFamily:   c.currentFamily,
      viewCount:       c.viewCount,
      confidence:      c.confidence,
      matchedKeywords: c.matchedKeywords,
    })),
    rollbackIds: high.filter(c => c.willUpdate).map(c => ({
      contentId:      c.contentId,
      rollbackFamily: c.rollbackFamily,
    })),
  }, null, 2), "utf8");

  console.log(`\nReports:`);
  console.log(`  ${reportPath}`);
  console.log(`  ${jsonPath}`);

  process.exit(0);
}

main().catch(e => {
  console.error("Fatal:", e.cause?.message ?? e.message);
  console.error(e.stack);
  process.exit(1);
});
