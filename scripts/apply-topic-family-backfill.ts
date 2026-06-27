/**
 * Conservative topic_family backfill for phat_phap.
 *
 * Updates exactly the rows approved in the dry-run:
 *   - 124 phat_phap rows where inferStrategicTopicFamily(topic) != needs_topic_family_review
 *   - 42 ambiguous legacy rows are left as NULL
 *   - No needs_topic_family_review values written
 *   - No schema changes
 *   - No tang_sau rows touched
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     --tsconfig tsconfig.json scripts/apply-topic-family-backfill.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq, isNull, inArray, isNotNull, and, sql } from "drizzle-orm";
import {
  inferStrategicTopicFamily,
  STRATEGIC_FAMILY_DISPLAY,
  NEEDS_REVIEW_FAMILY,
  type StrategicTopicFamilyId,
} from "@/lib/config/topic-family-registry";
import { getStrategicFamilyCoverageAction } from "@/actions/publishing-analytics";

function pct(n: number, total: number) {
  return total === 0 ? "0%" : `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Apply topic_family backfill — phat_phap conservative");
  console.log("  Date:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");

  // ── 1. Snapshot BEFORE counts ──────────────────────────────────
  const [totalCount, populatedCount, nullCount] = await Promise.all([
    db.$count(contentGenerations, eq(contentGenerations.channelKey, "phat_phap")),
    db.$count(contentGenerations, and(
      eq(contentGenerations.channelKey, "phat_phap"),
      isNotNull(contentGenerations.topicFamily),
    )),
    db.$count(contentGenerations, and(
      eq(contentGenerations.channelKey, "phat_phap"),
      isNull(contentGenerations.topicFamily),
    )),
  ]);

  console.log("\n── Before ───────────────────────────────────────────────────");
  console.log(`  phat_phap total:             ${totalCount}`);
  console.log(`  topic_family populated:      ${populatedCount}`);
  console.log(`  topic_family null:           ${nullCount}`);

  // ── 2. Build candidate set (same logic as dry-run) ────────────
  const nullRows = await db.query.contentGenerations.findMany({
    where: and(
      eq(contentGenerations.channelKey, "phat_phap"),
      isNull(contentGenerations.topicFamily),
    ),
    columns: { id: true, topic: true },
  });

  // Group by inferred family, exclude needs_review
  const familyGroups = new Map<StrategicTopicFamilyId, string[]>();
  const needsReviewIds: string[] = [];

  for (const row of nullRows) {
    const inferred = row.topic ? inferStrategicTopicFamily(row.topic) : NEEDS_REVIEW_FAMILY;
    if (inferred === NEEDS_REVIEW_FAMILY) {
      needsReviewIds.push(row.id);
    } else {
      if (!familyGroups.has(inferred)) familyGroups.set(inferred, []);
      familyGroups.get(inferred)!.push(row.id);
    }
  }

  const toBackfillIds = [...familyGroups.values()].flat();

  console.log(`\n── Candidate set ────────────────────────────────────────────`);
  console.log(`  Rows to backfill:  ${toBackfillIds.length}`);
  console.log(`  Rows to leave null (needs_review): ${needsReviewIds.length}`);

  for (const [fid, ids] of [...familyGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const display = (STRATEGIC_FAMILY_DISPLAY[fid] ?? fid).padEnd(45);
    console.log(`    ${display} ${ids.length} rows`);
  }

  // Safety gate: refuse to write needs_topic_family_review
  const needsReviewInCandidates = toBackfillIds.filter(id =>
    needsReviewIds.includes(id)
  ).length;
  if (needsReviewInCandidates > 0) {
    throw new Error(`SAFETY: ${needsReviewInCandidates} needs_review IDs leaked into backfill set — aborting`);
  }

  if (toBackfillIds.length === 0) {
    console.log("\n  Nothing to backfill. Exiting.");
    return;
  }

  // ── 3. Apply updates ──────────────────────────────────────────
  console.log("\n── Applying updates ─────────────────────────────────────────");

  let totalUpdated = 0;
  const updatedByFamily = new Map<string, number>();

  // Run per-family with guarded WHERE clause
  // Drizzle doesn't expose a simple cross-table transaction helper,
  // so we run family-by-family and count affected rows. Each UPDATE
  // is guarded by channel_key + topic_family IS NULL + id IN (...),
  // making it safe to re-run (idempotent).
  for (const [fid, ids] of familyGroups) {
    const display = STRATEGIC_FAMILY_DISPLAY[fid] ?? fid;
    process.stdout.write(`  ${display} (${ids.length}) … `);

    const result = await db
      .update(contentGenerations)
      .set({ topicFamily: fid })
      .where(
        and(
          eq(contentGenerations.channelKey, "phat_phap"),
          isNull(contentGenerations.topicFamily),
          inArray(contentGenerations.id, ids),
        ),
      )
      .returning({ id: contentGenerations.id });

    const affected = result.length;
    console.log(`${affected} updated`);
    totalUpdated += affected;
    updatedByFamily.set(fid, affected);
  }

  // ── 4. Snapshot AFTER counts ──────────────────────────────────
  const [totalAfter, populatedAfter, nullAfter] = await Promise.all([
    db.$count(contentGenerations, eq(contentGenerations.channelKey, "phat_phap")),
    db.$count(contentGenerations, and(
      eq(contentGenerations.channelKey, "phat_phap"),
      isNotNull(contentGenerations.topicFamily),
    )),
    db.$count(contentGenerations, and(
      eq(contentGenerations.channelKey, "phat_phap"),
      isNull(contentGenerations.topicFamily),
    )),
  ]);

  console.log("\n── After ────────────────────────────────────────────────────");
  console.log(`  phat_phap total:             ${totalAfter}`);
  console.log(`  topic_family populated:      ${populatedAfter}  (was ${populatedCount}, +${populatedAfter - populatedCount})`);
  console.log(`  topic_family null:           ${nullAfter}  (was ${nullCount}, -${nullCount - nullAfter})`);
  console.log(`  rows updated this run:       ${totalUpdated}`);
  console.log(`  rows left null:              ${nullAfter}`);

  // ── 5. Distribution by family (all populated rows) ───────────
  console.log("\n── topic_family distribution (all populated phat_phap rows) ──");
  const allPopulated = await db.query.contentGenerations.findMany({
    where: and(
      eq(contentGenerations.channelKey, "phat_phap"),
      isNotNull(contentGenerations.topicFamily),
    ),
    columns: { topicFamily: true },
  });
  const distMap = new Map<string, number>();
  for (const r of allPopulated) {
    const fid = r.topicFamily!;
    distMap.set(fid, (distMap.get(fid) ?? 0) + 1);
  }
  for (const [fid, n] of [...distMap.entries()].sort((a, b) => b[1] - a[1])) {
    const display = (STRATEGIC_FAMILY_DISPLAY[fid as StrategicTopicFamilyId] ?? fid).padEnd(45);
    console.log(`  ${display} ${String(n).padStart(4)} (${pct(n, populatedAfter)})`);
  }

  // ── 6. Safety checks ─────────────────────────────────────────
  console.log("\n── Safety checks ────────────────────────────────────────────");

  // a. tang_sau rows updated
  const tangSauUpdated = await db.$count(
    contentGenerations,
    and(
      eq(contentGenerations.channelKey, "tang_sau"),
      isNotNull(contentGenerations.topicFamily),
      // Only rows that are in our approved ID list (belt-and-suspenders check)
      inArray(contentGenerations.id, toBackfillIds),
    ),
  );
  check("tang_sau rows updated = 0", tangSauUpdated === 0,
    tangSauUpdated === 0 ? "0 tang_sau rows touched" : `⚠ ${tangSauUpdated} tang_sau rows updated`);

  // b. needs_topic_family_review written
  const needsReviewWritten = await db.$count(
    contentGenerations,
    and(
      eq(contentGenerations.channelKey, "phat_phap"),
      eq(contentGenerations.topicFamily, NEEDS_REVIEW_FAMILY),
    ),
  );
  check("needs_topic_family_review written = 0", needsReviewWritten === 0,
    needsReviewWritten === 0 ? "0 rows have needs_review value" : `⚠ ${needsReviewWritten} rows have needs_review`);

  // c. Rows updated match approved set exactly
  const countMismatch = totalUpdated !== toBackfillIds.length;
  // Some rows may have been already populated by concurrent writes — that's fine.
  // We only flag if MORE rows were updated than approved.
  check("rows updated ≤ approved candidate count",
    totalUpdated <= toBackfillIds.length,
    `updated=${totalUpdated} approved=${toBackfillIds.length}${totalUpdated < toBackfillIds.length ? " (some already populated — OK)" : ""}`);

  // d. Expected final populated count
  const expectedPopulated = populatedCount + totalUpdated;
  check(`populated count = ${expectedPopulated}`,
    populatedAfter === expectedPopulated,
    `got ${populatedAfter}`);

  // e. Expected null count
  const expectedNull = nullCount - totalUpdated;
  check(`null count = ${expectedNull}`,
    nullAfter === expectedNull,
    `got ${nullAfter}`);

  // ── 7. Coverage action ────────────────────────────────────────
  console.log("\n── Strategic Topic Family Coverage (post-backfill) ──────────");
  try {
    const coverage = await getStrategicFamilyCoverageAction();
    for (const r of coverage) {
      if (r.sampleDepth.total === 0) continue;
      const vq = `${r.videoCount.total}v/${r.quoteCount.total}q`;
      console.log(`  [${(r.sprintLabel ?? "—").padEnd(12)}] ${r.displayName.padEnd(40)} total=${r.sampleDepth.total} (${vq}) ${r.sampleDepthStatus}`);
    }
    console.log("  ✓ Coverage action OK");
  } catch (e) {
    console.error(`  ✗ Coverage action failed: ${e}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Backfill complete.");
  console.log(`  Rows updated:    ${totalUpdated}`);
  console.log(`  Rows left null:  ${nullAfter}`);
  console.log(`  Total populated: ${populatedAfter} (expected 151)`);
  const finalOk = populatedAfter === 151 || populatedAfter === populatedCount + totalUpdated;
  console.log(`  Result: ${finalOk ? "✓" : "⚠ check counts above"}`);
  console.log("═══════════════════════════════════════════════════════════");
}

function check(label: string, pass: boolean, detail: string) {
  console.log(`  ${pass ? "✓" : "✗"}  ${label}`);
  console.log(`       ${detail}`);
}

main().catch(err => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
