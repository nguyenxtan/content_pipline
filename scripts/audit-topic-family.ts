import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  inferStrategicTopicFamily,
  STRATEGIC_FAMILY_DISPLAY,
  NEEDS_REVIEW_FAMILY,
  type StrategicTopicFamilyId,
} from "@/lib/config/topic-family-registry";

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  topic_family backfill audit — READ ONLY, no DB writes");
  console.log("  Date:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");

  const rows = await db.query.contentGenerations.findMany({
    where: eq(contentGenerations.channelKey, "phat_phap"),
    columns: {
      id: true,
      topic: true,
      topicFamily: true,
      formatType: true,
      status: true,
      createdAt: true,
    },
    orderBy: (t, { desc }) => desc(t.createdAt),
  });

  const total = rows.length;
  const populated = rows.filter(r => r.topicFamily != null && r.topicFamily !== "");
  const nullRows = rows.filter(r => !r.topicFamily);

  console.log(`\n── Totals ───────────────────────────────────────────────────`);
  console.log(`  Total phat_phap rows: ${total}`);
  console.log(`  topic_family populated: ${populated.length} (${pct(populated.length, total)})`);
  console.log(`  topic_family null:      ${nullRows.length} (${pct(nullRows.length, total)})`);

  // ── Populated distribution ──────────────────────────────────────
  console.log(`\n── Populated topic_family distribution ──────────────────────`);
  const popCounts = new Map<string, number>();
  for (const r of populated) {
    const fid = r.topicFamily!;
    popCounts.set(fid, (popCounts.get(fid) ?? 0) + 1);
  }
  for (const [fid, n] of [...popCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const display = STRATEGIC_FAMILY_DISPLAY[fid as StrategicTopicFamilyId] ?? fid;
    console.log(`  ${String(n).padStart(4)} (${pct(n, populated.length).padStart(5)})  ${display}`);
  }

  // ── Infer families for null rows ────────────────────────────────
  console.log(`\n── Inferring topic_family for ${nullRows.length} null rows ──────────────────`);

  const inferred = new Map<string, { total: number; video: number; quote: number; topics: string[] }>();
  for (const r of nullRows) {
    const fid = r.topic ? inferStrategicTopicFamily(r.topic) : NEEDS_REVIEW_FAMILY;
    if (!inferred.has(fid)) inferred.set(fid, { total: 0, video: 0, quote: 0, topics: [] });
    const slot = inferred.get(fid)!;
    slot.total++;
    const isQuote = r.formatType === "legacy_quote_short";
    if (isQuote) slot.quote++; else slot.video++;
    if (slot.topics.length < 5 && r.topic) slot.topics.push(r.topic);
  }

  // Sort: needs_review last, rest by count desc
  const sorted = [...inferred.entries()].sort((a, b) => {
    if (a[0] === NEEDS_REVIEW_FAMILY) return 1;
    if (b[0] === NEEDS_REVIEW_FAMILY) return -1;
    return b[1].total - a[1].total;
  });

  console.log(`\n  ${"Family".padEnd(50)} ${"total".padStart(5)} ${"video".padStart(5)} ${"quote".padStart(5)}`);
  console.log(`  ${"─".repeat(70)}`);
  for (const [fid, counts] of sorted) {
    const display = (STRATEGIC_FAMILY_DISPLAY[fid as StrategicTopicFamilyId] ?? fid).slice(0, 48).padEnd(50);
    console.log(`  ${display} ${String(counts.total).padStart(5)} ${String(counts.video).padStart(5)} ${String(counts.quote).padStart(5)}`);
  }

  const needsReviewData = inferred.get(NEEDS_REVIEW_FAMILY);
  const needsReviewCount = needsReviewData?.total ?? 0;
  const inferrableCount = nullRows.length - needsReviewCount;

  console.log(`\n  Inferrable (would get a strategic family):  ${inferrableCount} (${pct(inferrableCount, nullRows.length)})`);
  console.log(`  Needs manual review (no match):             ${needsReviewCount} (${pct(needsReviewCount, nullRows.length)})`);

  // ── needs_review topic sample ───────────────────────────────────
  console.log(`\n── Top needs_review topics (up to 30) ───────────────────────`);
  const needsReviewRows = nullRows
    .filter(r => !r.topic || inferStrategicTopicFamily(r.topic) === NEEDS_REVIEW_FAMILY)
    .slice(0, 30);

  for (let i = 0; i < needsReviewRows.length; i++) {
    const r = needsReviewRows[i]!;
    const isQuote = r.formatType === "legacy_quote_short" ? "quote" : "video";
    const date = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : "—";
    console.log(`  ${String(i + 1).padStart(2)}. [${isQuote}] ${date}  ${(r.topic ?? "(no topic)").slice(0, 80)}`);
  }

  if (needsReviewCount > 30) {
    console.log(`  … and ${needsReviewCount - 30} more`);
  }

  // ── Status of null rows (completed only vs all) ─────────────────
  console.log(`\n── null rows by status ──────────────────────────────────────`);
  const statusMap = new Map<string, number>();
  for (const r of nullRows) {
    const s = r.status ?? "(null)";
    statusMap.set(s, (statusMap.get(s) ?? 0) + 1);
  }
  for (const [s, n] of [...statusMap.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  status="${s}"`);
  }

  // ── Format breakdown of null rows ──────────────────────────────
  console.log(`\n── null rows by format ──────────────────────────────────────`);
  const fmtMap = new Map<string, number>();
  for (const r of nullRows) {
    const f = r.formatType ?? "(null)";
    fmtMap.set(f, (fmtMap.get(f) ?? 0) + 1);
  }
  for (const [f, n] of [...fmtMap.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  formatType="${f}"`);
  }

  // ── Date range of null rows ─────────────────────────────────────
  const dates = nullRows.map(r => r.createdAt ? new Date(r.createdAt).getTime() : 0).filter(Boolean);
  if (dates.length > 0) {
    const earliest = new Date(Math.min(...dates)).toISOString().slice(0, 10);
    const latest = new Date(Math.max(...dates)).toISOString().slice(0, 10);
    console.log(`\n── Date range of null rows ──────────────────────────────────`);
    console.log(`  Earliest: ${earliest}`);
    console.log(`  Latest:   ${latest}`);
  }

  // ── Recommendation ──────────────────────────────────────────────
  console.log(`\n── Recommendation ───────────────────────────────────────────`);
  const inferrablePct = nullRows.length > 0 ? inferrableCount / nullRows.length : 0;
  const reviewPct = nullRows.length > 0 ? needsReviewCount / nullRows.length : 0;

  if (nullRows.length === 0) {
    console.log("  ✓ All rows already have topic_family. No backfill needed.");
  } else if (reviewPct > 0.5) {
    console.log(`  ⚠ CAUTION: ${pct(needsReviewCount, nullRows.length)} of null rows would become needs_review.`);
    console.log("    Backfill would label most rows as 'unclassified' — consider expanding");
    console.log("    inferStrategicTopicFamily() keyword rules first before backfilling.");
  } else if (inferrablePct >= 0.5) {
    console.log(`  ✓ SAFE TO BACKFILL: ${pct(inferrableCount, nullRows.length)} of null rows map to a strategic family.`);
    console.log(`    ${needsReviewCount} rows (${pct(needsReviewCount, nullRows.length)}) would get needs_review — inspect list above first.`);
    console.log("    Recommend: review needs_review topics, then run a targeted backfill script.");
  } else {
    console.log(`  ~ PARTIAL SIGNAL: only ${pct(inferrableCount, nullRows.length)} of null rows map to a strategic family.`);
    console.log("    Review needs_review topics above before deciding on backfill.");
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Audit complete. No DB writes performed.");
  console.log("═══════════════════════════════════════════════════════════");
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
