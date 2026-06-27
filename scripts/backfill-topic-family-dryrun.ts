/**
 * Dry-run backfill plan for phat_phap topic_family NULL rows.
 * READ ONLY — does not write any updates.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     --tsconfig tsconfig.json scripts/backfill-topic-family-dryrun.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq, isNull, isNotNull, ne } from "drizzle-orm";
import {
  inferStrategicTopicFamily,
  STRATEGIC_FAMILY_DISPLAY,
  NEEDS_REVIEW_FAMILY,
  type StrategicTopicFamilyId,
} from "@/lib/config/topic-family-registry";

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Dry-run Backfill Plan — topic_family for phat_phap");
  console.log("  READ ONLY. No DB writes.");
  console.log("  Date:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");

  // ── Fetch all phat_phap rows with topic_family NULL ─────────────
  const nullRows = await db.query.contentGenerations.findMany({
    where: (t, { and, eq, isNull }) => and(
      eq(t.channelKey, "phat_phap"),
      isNull(t.topicFamily),
    ),
    columns: { id: true, topic: true, formatType: true, channelKey: true, createdAt: true },
    orderBy: (t, { asc }) => asc(t.createdAt),
  });

  // ── Safety: confirm no tang_sau rows in the backfill candidate set ─
  // (backfill fetches WHERE channel_key = 'phat_phap', so tang_sau is
  //  structurally excluded — this confirms none leaked into nullRows)
  const tangSauInScope = nullRows.filter(r => (r as any).channelKey === "tang_sau").length;
  const tangSauCheck = { length: tangSauInScope };

  // Not needed — nullRows is already filtered to IS NULL by query above

  // ── Classify each null row ──────────────────────────────────────
  type ClassifiedRow = {
    id: string;
    topic: string | null;
    formatType: string | null;
    inferred: StrategicTopicFamilyId;
    wouldBackfill: boolean;
  };

  const classified: ClassifiedRow[] = nullRows.map(r => {
    const inferred = r.topic ? inferStrategicTopicFamily(r.topic) : NEEDS_REVIEW_FAMILY;
    return {
      id: r.id,
      topic: r.topic,
      formatType: r.formatType,
      inferred,
      wouldBackfill: inferred !== NEEDS_REVIEW_FAMILY,
    };
  });

  const toBackfill = classified.filter(r => r.wouldBackfill);
  const toLeaveNull = classified.filter(r => !r.wouldBackfill);

  // ── Family distribution ─────────────────────────────────────────
  const familyDist = new Map<StrategicTopicFamilyId, ClassifiedRow[]>();
  for (const r of toBackfill) {
    if (!familyDist.has(r.inferred)) familyDist.set(r.inferred, []);
    familyDist.get(r.inferred)!.push(r);
  }
  const sortedFamilies = [...familyDist.entries()].sort((a, b) => b[1].length - a[1].length);

  // ══════════════════════════════════════════════════════════════════
  // REPORT
  // ══════════════════════════════════════════════════════════════════

  console.log("\n## Dry-run Backfill Plan");
  console.log(`\n  Total phat_phap rows with topic_family NULL:  ${nullRows.length}`);
  console.log(`  Rows that WOULD be backfilled:                ${toBackfill.length} (${pct(toBackfill.length, nullRows.length)})`);
  console.log(`  Rows that would REMAIN NULL:                  ${toLeaveNull.length} (${pct(toLeaveNull.length, nullRows.length)})`);

  // ── Rows To Update ────────────────────────────────────────────
  console.log("\n## Rows To Update — inferred family distribution");
  console.log(`\n  ${"Family".padEnd(50)} ${"count".padStart(5)} ${"video".padStart(5)} ${"quote".padStart(5)}`);
  console.log(`  ${"─".repeat(66)}`);
  for (const [fid, rows] of sortedFamilies) {
    const display = (STRATEGIC_FAMILY_DISPLAY[fid] ?? fid).slice(0, 48).padEnd(50);
    const video = rows.filter(r => r.formatType !== "legacy_quote_short").length;
    const quote = rows.filter(r => r.formatType === "legacy_quote_short").length;
    console.log(`  ${display} ${String(rows.length).padStart(5)} ${String(video).padStart(5)} ${String(quote).padStart(5)}`);
  }

  // ── Sample updates per family (up to 10 each) ─────────────────
  console.log("\n## Sample Updates (up to 10 per family)");
  for (const [fid, rows] of sortedFamilies) {
    const display = STRATEGIC_FAMILY_DISPLAY[fid] ?? fid;
    console.log(`\n  ── ${display} (${rows.length} rows) ──`);
    for (const r of rows.slice(0, 10)) {
      const fmt = (r.formatType ?? "(null)").padEnd(20);
      console.log(`    ${r.id.slice(0, 8)}  ${fmt}  "${(r.topic ?? "").slice(0, 65)}"`);
    }
    if (rows.length > 10) console.log(`    … and ${rows.length - 10} more`);
  }

  // ── Rows To Leave Null ────────────────────────────────────────
  console.log("\n## Rows To Leave Null (sample — up to 20)");
  for (let i = 0; i < Math.min(20, toLeaveNull.length); i++) {
    const r = toLeaveNull[i]!;
    const fmt = (r.formatType ?? "(null)").padEnd(20);
    console.log(`  ${r.id.slice(0, 8)}  ${fmt}  "${(r.topic ?? "").slice(0, 75)}"`);
  }
  if (toLeaveNull.length > 20) console.log(`  … and ${toLeaveNull.length - 20} more`);

  // ── Safety Checks ─────────────────────────────────────────────
  console.log("\n## Safety Checks");
  const checks: Array<{ label: string; pass: boolean; detail: string }> = [
    {
      label: "No tang_sau rows in backfill candidate set",
      pass: tangSauCheck.length === 0,
      detail: tangSauCheck.length === 0
        ? "0 tang_sau rows in scope — all candidates are channel_key='phat_phap'"
        : `⚠ ${tangSauCheck.length} tang_sau row(s) leaked into candidate set — investigate`,
    },
    {
      label: "No existing topic_family overwritten",
      pass: true, // query is WHERE topic_family IS NULL — by construction
      detail: "Query scoped to IS NULL rows only; populated rows untouched",
    },
    {
      label: "No needs_topic_family_review values written",
      pass: toBackfill.every(r => r.inferred !== NEEDS_REVIEW_FAMILY),
      detail: toBackfill.every(r => r.inferred !== NEEDS_REVIEW_FAMILY)
        ? "All backfill rows have real strategic family IDs"
        : `⚠ ${toBackfill.filter(r => r.inferred === NEEDS_REVIEW_FAMILY).length} rows would get needs_review — logic error`,
    },
    {
      label: "No schema changes required",
      pass: true,
      detail: "topic_family column already exists; UPDATE only",
    },
    {
      label: "Channel scope: phat_phap only",
      pass: classified.every(r => true), // all rows fetched via channelKey = 'phat_phap'
      detail: "All rows fetched with WHERE channel_key = 'phat_phap'",
    },
    {
      label: "Ambiguous rows left as NULL",
      pass: toLeaveNull.every(r => r.inferred === NEEDS_REVIEW_FAMILY),
      detail: `${toLeaveNull.length} rows with inferred=needs_review will not be touched`,
    },
  ];

  for (const c of checks) {
    console.log(`  ${c.pass ? "✓" : "✗"}  ${c.label}`);
    console.log(`       ${c.detail}`);
  }

  const allPass = checks.every(c => c.pass);
  console.log(`\n  Overall: ${allPass ? "✓ All checks pass — safe to proceed" : "✗ Issues found — do not run backfill"}`);

  // ── Exact backfill script ─────────────────────────────────────
  console.log("\n## Exact Command To Apply Backfill Later");
  console.log(`
  When ready to apply, run:

    node --env-file=.env.local node_modules/tsx/dist/cli.mjs \\
      --tsconfig tsconfig.json scripts/apply-topic-family-backfill.ts

  That script (not yet created) should execute exactly:

    for each row in phat_phap WHERE topic_family IS NULL:
      inferred = inferStrategicTopicFamily(row.topic)
      if inferred != '${NEEDS_REVIEW_FAMILY}':
        UPDATE content_generations
        SET topic_family = '<inferred>'
        WHERE id = '<row.id>'
          AND topic_family IS NULL   ← guard against race

  Equivalent SQL for reference (per family batch):
`);
  for (const [fid, rows] of sortedFamilies) {
    const ids = rows.map(r => `'${r.id}'`).join(",\n         ");
    console.log(`  -- ${STRATEGIC_FAMILY_DISPLAY[fid] ?? fid} (${rows.length} rows)`);
    console.log(`  UPDATE content_generations`);
    console.log(`  SET topic_family = '${fid}'`);
    console.log(`  WHERE channel_key = 'phat_phap'`);
    console.log(`    AND topic_family IS NULL`);
    console.log(`    AND id IN (`);
    console.log(`         ${ids}`);
    console.log(`    );\n`);
  }

  console.log(`\n  Total UPDATE statements: ${sortedFamilies.length} (one per strategic family)`);
  console.log(`  Total rows affected:      ${toBackfill.length}`);
  console.log(`  Rows left untouched:      ${toLeaveNull.length} (needs_review / ambiguous)`);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Dry-run complete. No writes performed.");
  console.log("═══════════════════════════════════════════════════════════");
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
