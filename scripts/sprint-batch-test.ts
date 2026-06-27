/**
 * Real sprint batch test: 10 phat_phap items with topic_family wiring.
 *
 * Distribution (approximate 70/20/10):
 *   7 TTS content items:
 *     - 5 × nhan_qua_nguoi_xau_bao_ung (focus)
 *     - 1 × buong_bo_chua_lanh (secondary)
 *     - 1 × tri_tue_song_im_lang_nhan_nhin (secondary)
 *   3 quote/photo items (full pipeline, sprint allocation picks family):
 *     - generateQuoteShortsAction({ count: 3, workspaceId: "buddhist_healing_workspace" })
 *
 * TTS items: script generated only (videoStatus: pending — short_pipeline renders separately).
 * Quote items: full pipeline (LLM + image + video render, videoStatus: done).
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     --tsconfig tsconfig.json scripts/sprint-batch-test.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import fs from "fs";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { generateContentAction } from "@/actions/content-generator";
import { generateQuoteShortsAction } from "@/actions/quote-generator";
import { getStrategicFamilyCoverageAction } from "@/actions/publishing-analytics";
import { STRATEGIC_FAMILY_DISPLAY, type StrategicTopicFamilyId } from "@/lib/config/topic-family-registry";

// ── Topics chosen from curated pool (no LLM topic-suggestion call needed) ──

const TTS_BATCH: Array<{ topic: string; topicFamily: string }> = [
  // focus × 5
  { topic: "Người hại bạn rồi cũng nhận quả báo", topicFamily: "nhan_qua_nguoi_xau_bao_ung" },
  { topic: "Đừng trả thù — nhân quả sẽ tự lo", topicFamily: "nhan_qua_nguoi_xau_bao_ung" },
  { topic: "Kẻ phản bội sống ác, trời không tha", topicFamily: "nhan_qua_nguoi_xau_bao_ung" },
  { topic: "Tiểu nhân đắc chí chỉ là tạm thời", topicFamily: "nhan_qua_nguoi_xau_bao_ung" },
  { topic: "Im lặng trước người xấu là trí tuệ cao nhất", topicFamily: "nhan_qua_nguoi_xau_bao_ung" },
  // secondary × 2
  { topic: "Buông bỏ người không còn yêu thương ta nữa", topicFamily: "buong_bo_chua_lanh" },
  { topic: "Nhẫn nhịn không phải yếu đuối mà là trí tuệ", topicFamily: "tri_tue_song_im_lang_nhan_nhin" },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function fmt(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function familyLabel(fid: string | null): string {
  if (!fid) return "(none)";
  return STRATEGIC_FAMILY_DISPLAY[fid as StrategicTopicFamilyId] ?? fid;
}

// ── Section 1: TTS content items ──────────────────────────────────────────

async function generateTtsBatch(): Promise<string[]> {
  console.log("\n── TTS content items (7 items, script generation only) ──────");
  const ids: string[] = [];

  for (const { topic, topicFamily } of TTS_BATCH) {
    const t0 = Date.now();
    process.stdout.write(`  [${topicFamily.split("_")[0]}] "${topic.substring(0, 50)}" … `);

    const result = await generateContentAction(
      13,           // phat_phap niche id
      topic,
      undefined,    // use default model
      "short",      // short only, faster
      topicFamily,  // explicit family — bypasses sprint roll for the test
    );

    if ("error" in result) {
      console.error(`✗ ERROR: ${result.error}`);
      continue;
    }
    ids.push(result.generationId);
    console.log(`✓ id=${result.generationId} [${fmt(Date.now() - t0)}]`);
  }

  return ids;
}

// ── Section 2: Quote/photo items ──────────────────────────────────────────

async function generateQuoteBatch(): Promise<string[]> {
  console.log("\n── Quote/photo items (3 items, full pipeline) ──────────────");
  console.log("  (LLM + image generation + video render — may take a few minutes)");

  const t0 = Date.now();
  const result = await generateQuoteShortsAction({
    count: 3,
    workspaceId: "buddhist_healing_workspace",
    // No explicit topicFamily — let sprint allocation pick
  });

  if (!result.ok && result.results.length === 0) {
    console.error(`  ✗ Quote batch failed: ${result.error ?? "unknown"}`);
    return [];
  }

  console.log(`  Completed ${result.successCount}/${result.generatedCount} in ${fmt(Date.now() - t0)}`);
  if (result.failCount > 0) {
    console.warn(`  ⚠ ${result.failCount} failed`);
  }

  const ids = result.results
    .filter((r) => r.ok && r.videoPath)
    .map((r) => r.contentId);

  for (const r of result.results) {
    const status = r.ok ? "✓" : "✗";
    console.log(`  ${status} id=${r.contentId} topic="${r.topic?.substring(0, 45) ?? "(none)"}" videoPath=${r.videoPath ? "present" : "—"}`);
  }

  return ids;
}

// ── Section 3: DB verification ────────────────────────────────────────────

async function verifyDb(allIds: string[]) {
  console.log("\n── DB verification ─────────────────────────────────────────");

  const rows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, allIds),
    columns: {
      id: true,
      topic: true,
      topicFamily: true,
      formatType: true,
      videoStatus: true,
      status: true,
      createdAt: true,
    },
    orderBy: (t, { asc: a }) => a(t.createdAt),
  });

  const missing = allIds.filter((id) => !rows.find((r) => r.id === id));
  if (missing.length > 0) {
    console.warn(`  ⚠ Missing from DB: ${missing.join(", ")}`);
  }

  let withFamily = 0;
  let withoutFamily = 0;
  const familyCounts: Record<string, number> = {};

  console.log("\n  ┌─────────────────────────────────────────────────────────────────────────────────┐");
  console.log("  │ # │ Format           │ VideoStatus │ topic_family                │ topic (50c) │");
  console.log("  ├─────────────────────────────────────────────────────────────────────────────────┤");

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const fmt_type = (r.formatType ?? "tts_short").padEnd(16);
    const vstatus = (r.videoStatus ?? "?").padEnd(11);
    const family = (r.topicFamily ?? "—").padEnd(28);
    const topic = (r.topic ?? "").substring(0, 50);

    console.log(`  │ ${String(i + 1).padStart(2)} │ ${fmt_type} │ ${vstatus} │ ${family}│ ${topic}`);

    if (r.topicFamily) {
      withFamily++;
      familyCounts[r.topicFamily] = (familyCounts[r.topicFamily] ?? 0) + 1;
    } else {
      withoutFamily++;
    }
  }
  console.log("  └─────────────────────────────────────────────────────────────────────────────────┘");

  console.log(`\n  topic_family populated: ${withFamily}/${rows.length}`);
  if (withoutFamily > 0) {
    console.warn(`  ⚠ ${withoutFamily} rows missing topic_family`);
  }

  const focusCount = familyCounts["nhan_qua_nguoi_xau_bao_ung"] ?? 0;
  const quoteCount = rows.filter((r) => r.formatType === "legacy_quote_short").length;
  const videoCount = rows.filter((r) => r.formatType !== "legacy_quote_short").length;

  console.log("\n  Family distribution:");
  for (const [fid, n] of Object.entries(familyCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((n / rows.length) * 100);
    const bar = "█".repeat(Math.round(pct / 5));
    console.log(`    ${fid.padEnd(40)} ${String(n).padStart(2)} / ${rows.length} (${pct}%)  ${bar}`);
  }

  console.log(`\n  Quote/photo items: ${quoteCount}`);
  console.log(`  Video/TTS items:   ${videoCount}`);
  console.log(`  Focus family (nhan_qua) ≥ 7: ${focusCount >= 7 ? "✓" : `⚠ only ${focusCount}`}`);
  console.log(`  Quote items ≥ 3: ${quoteCount >= 3 ? "✓" : `⚠ only ${quoteCount}`}`);

  return rows;
}

// ── Section 4: Quote sidecar topicFamily check ────────────────────────────

async function verifySidecars(rows: Array<{ id: string; topicFamily: string | null; formatType: string | null }>) {
  console.log("\n── Quote sidecar topicFamily ────────────────────────────────");

  const quoteRows = rows.filter((r) => r.formatType === "legacy_quote_short");
  if (quoteRows.length === 0) {
    console.log("  No quote items in batch.");
    return;
  }

  // Find sidecar files in output directory
  const outputDir = "output/quote-shorts";
  if (!fs.existsSync(outputDir)) {
    console.log(`  ⚠ Output directory not found: ${outputDir}`);
    return;
  }

  for (const row of quoteRows) {
    const sidecarPattern = `${row.id}-legacy-quote-short.json`;
    const found = fs.readdirSync(outputDir, { recursive: true })
      .map(String)
      .find((f) => f.endsWith(sidecarPattern));

    if (!found) {
      console.log(`  ⚠ No sidecar found for ${row.id}`);
      continue;
    }

    const sidecarPath = `${outputDir}/${found}`;
    try {
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as { topicFamily?: string };
      const match = sidecar.topicFamily === row.topicFamily;
      const icon = match ? "✓" : "⚠";
      console.log(`  ${icon} ${row.id.substring(0, 8)}… sidecar.topicFamily="${sidecar.topicFamily}" db.topicFamily="${row.topicFamily}" ${match ? "(match)" : "(MISMATCH)"}`);
    } catch {
      console.log(`  ⚠ Failed to read sidecar: ${sidecarPath}`);
    }
  }
}

// ── Section 5: Strategic coverage delta ──────────────────────────────────

async function verifyCoverage(beforeFocusTotal: number) {
  console.log("\n── Strategic Topic Family Coverage delta ────────────────────");

  const coverage = await getStrategicFamilyCoverageAction();
  const focusRow = coverage.find((r) => r.familyId === "nhan_qua_nguoi_xau_bao_ung");
  const nowFocusTotal = focusRow?.sampleDepth.total ?? 0;

  console.log(`  Before: nhan_qua total = ${beforeFocusTotal}`);
  console.log(`  After:  nhan_qua total = ${nowFocusTotal}`);
  console.log(`  Delta:  +${nowFocusTotal - beforeFocusTotal}`);
  console.log(`  Expected delta ≥ 5 (5 focus TTS items): ${nowFocusTotal - beforeFocusTotal >= 5 ? "✓" : "⚠"}`);

  console.log("\n  Coverage snapshot (phat_phap):");
  for (const r of coverage) {
    if (r.sampleDepth.total === 0) continue;
    const vq = `${r.videoCount.total}v/${r.quoteCount.total}q`;
    console.log(`    [${(r.sprintLabel ?? "—").padEnd(12)}] ${r.displayName.padEnd(40)} total=${r.sampleDepth.total} (${vq}) ${r.sampleDepthStatus}`);
  }
}

// ── Section 6: Tang Sau guard ─────────────────────────────────────────────

async function verifyTangSauUntouched() {
  console.log("\n── Tang Sau guard ───────────────────────────────────────────");
  const { isNotNull } = await import("drizzle-orm");
  const tsRows = await db.query.contentGenerations.findMany({
    where: (t, { and: _and, eq: _eq }) =>
      _and(_eq(t.channelKey, "tang_sau"), isNotNull(t.topicFamily)),
    columns: { id: true },
    limit: 5,
  });
  console.log(`  tang_sau rows with topic_family: ${tsRows.length} ${tsRows.length === 0 ? "✓" : "⚠ UNEXPECTED"}`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Sprint batch test: 10 phat_phap items");
  console.log("  Date:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");

  // Snapshot focus family count before generation
  const beforeCoverage = await getStrategicFamilyCoverageAction();
  const beforeFocusTotal = beforeCoverage.find((r) => r.familyId === "nhan_qua_nguoi_xau_bao_ung")?.sampleDepth.total ?? 0;
  console.log(`\n  Pre-run: nhan_qua sampleDepth.total = ${beforeFocusTotal}`);

  const t0 = Date.now();

  const ttsIds = await generateTtsBatch();
  const quoteIds = await generateQuoteBatch();

  const allIds = [...ttsIds, ...quoteIds];
  console.log(`\n  Total generated: ${allIds.length}/10 in ${fmt(Date.now() - t0)}`);

  if (allIds.length === 0) {
    console.error("  ✗ No items generated. Exiting.");
    process.exit(1);
  }

  const rows = await verifyDb(allIds);
  await verifySidecars(rows.map((r) => ({ id: r.id, topicFamily: r.topicFamily ?? null, formatType: r.formatType ?? null })));
  await verifyCoverage(beforeFocusTotal);
  await verifyTangSauUntouched();

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  BATCH SUMMARY");
  console.log("═══════════════════════════════════════════════════════════");

  const queueStatus = rows.map((r) => {
    const isQuote = r.formatType === "legacy_quote_short";
    const isTts = !isQuote;
    return {
      id: r.id,
      topic: r.topic ?? "(none)",
      topicFamily: r.topicFamily ?? "(none)",
      format: r.formatType ?? "tts_short",
      videoStatus: r.videoStatus ?? "pending",
      queueStatus: isQuote
        ? "completed — not queued (autoSchedule runs in short_pipeline)"
        : "pending — awaiting short_pipeline render",
    };
  });

  for (const item of queueStatus) {
    console.log(`\n  ID: ${item.id}`);
    console.log(`    topic:       ${item.topic.substring(0, 70)}`);
    console.log(`    topic_family: ${item.topicFamily} (${familyLabel(item.topicFamily)})`);
    console.log(`    format:      ${item.format}`);
    console.log(`    videoStatus: ${item.videoStatus}`);
    console.log(`    queue:       ${item.queueStatus}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Done.");
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
