/**
 * Smoke test: strategic topic family end-to-end wiring.
 *
 * Tests without external LLM/TTS/video API calls:
 *   1. Sprint allocation: pickBuddhistSprintTopicFamily distribution
 *   2. Topic family inference: inferStrategicTopicFamily on known topics
 *   3. normalizeTopicFamily: maps old IDs to strategic IDs
 *   4. DB write: insert 3 synthetic phat_phap rows with topic_family
 *   5. DB read: confirm topic_family was stored
 *   6. Coverage query: getStrategicFamilyCoverageAction runs without error
 *   7. Tang Sau guard: existing tang_sau rows have no topic_family
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     --tsconfig tsconfig.json scripts/smoke-test-topic-family.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  pickBuddhistSprintTopicFamily,
  PHAT_PHAP_SPRINT,
} from "@/lib/config/sprint-config";
import {
  inferStrategicTopicFamily,
  normalizeTopicFamily,
  STRATEGIC_FAMILY_DISPLAY,
  NEEDS_REVIEW_FAMILY,
  type StrategicTopicFamilyId,
} from "@/lib/config/topic-family-registry";
import { getStrategicFamilyCoverageAction } from "@/actions/publishing-analytics";

// ── Helpers ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓  ${label}${detail ? ` — ${detail}` : ""}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Test synthetic row IDs ────────────────────────────────────────────────

const SMOKE_IDS = [
  "smoke-test-nhan-qua-001",
  "smoke-test-nhan-qua-002",
  "smoke-test-buong-bo-001",
];

async function cleanup() {
  await db.delete(contentGenerations).where(
    eq(contentGenerations.id, SMOKE_IDS[0]!),
  );
  await db.delete(contentGenerations).where(
    eq(contentGenerations.id, SMOKE_IDS[1]!),
  );
  await db.delete(contentGenerations).where(
    eq(contentGenerations.id, SMOKE_IDS[2]!),
  );
}

// ── Section 1: Sprint allocation distribution ─────────────────────────────

function testSprintAllocation() {
  console.log("\n── 1. Sprint allocation (100 rolls) ─────────────────────────");
  const counts: Record<string, number> = {};
  const N = 200;
  for (let i = 0; i < N; i++) {
    const fid = pickBuddhistSprintTopicFamily("phat_phap") ?? "null";
    counts[fid] = (counts[fid] ?? 0) + 1;
  }

  const focusCount = counts[PHAT_PHAP_SPRINT.focusFamily] ?? 0;
  const focusPct = (focusCount / N * 100).toFixed(1);
  console.log(`  Focus (${PHAT_PHAP_SPRINT.focusFamily}): ${focusCount}/${N} = ${focusPct}%`);

  const secondaryCount = PHAT_PHAP_SPRINT.secondaryFamilies
    .reduce((s, fid) => s + (counts[fid] ?? 0), 0);
  const secondaryPct = (secondaryCount / N * 100).toFixed(1);
  console.log(`  Secondary: ${secondaryCount}/${N} = ${secondaryPct}%`);

  const exploreCount = PHAT_PHAP_SPRINT.exploreFamilies
    .reduce((s, fid) => s + (counts[fid] ?? 0), 0);
  const explorePct = (exploreCount / N * 100).toFixed(1);
  console.log(`  Explore: ${exploreCount}/${N} = ${explorePct}%`);

  // Allow ±15% variance on 200 rolls
  check("Focus ≥ 55% (target 70%)", focusCount / N >= 0.55, `got ${focusPct}%`);
  check("Secondary ≥ 10% (target 20%)", secondaryCount / N >= 0.10, `got ${secondaryPct}%`);

  const nullCount = counts["null"] ?? 0;
  check("Non-phat_phap returns null", pickBuddhistSprintTopicFamily("tang_sau") === null);
  check("No null values from phat_phap rolls", nullCount === 0, `null count: ${nullCount}`);
}

// ── Section 2: Topic family inference ────────────────────────────────────

function testInference() {
  console.log("\n── 2. Topic family inference ────────────────────────────────");
  const cases: Array<[string, StrategicTopicFamilyId]> = [
    ["Nhân quả và báo ứng", "nhan_qua_nguoi_xau_bao_ung"],
    ["Kẻ xấu sẽ bị báo ứng", "nhan_qua_nguoi_xau_bao_ung"],
    ["Buông bỏ để chữa lành", "buong_bo_chua_lanh"],
    // "im lặng là trí tuệ" is the keyphrase; "sức mạnh" alone doesn't match — needs_review is correct
    ["Người biết nhẫn nhịn là người mạnh", "tri_tue_song_im_lang_nhan_nhin"],
    ["Gia đình và hiếu thảo", "gia_dinh_hieu_dao"],
    ["Tình yêu và sự tổn thương", "tinh_yeu_ton_thuong"],
    ["Bình yên nội tâm", "binh_yen_an_lac"],
    ["Phước báo và duyên lành", "phuoc_bao_nghiep_duyen"],
  ];

  for (const [topic, expected] of cases) {
    const got = inferStrategicTopicFamily(topic);
    check(
      `inferStrategicTopicFamily("${topic.substring(0, 30)}")`,
      got === expected,
      `expected=${expected} got=${got}`,
    );
  }
}

// ── Section 3: normalizeTopicFamily (old ID mapping) ─────────────────────

function testNormalize() {
  console.log("\n── 3. normalizeTopicFamily (old → strategic) ────────────────");
  const cases: Array<[string, string]> = [
    ["nhan_qua_nguoi_xau_bao_ung", "nhan_qua_nguoi_xau_bao_ung"],  // already strategic
    ["bung_bo", "buong_bo_chua_lanh"],                              // old CI ID
    ["fear_anxiety", "buong_bo_chua_lanh"],                         // old quote ID
    ["unknown_family_xyz", NEEDS_REVIEW_FAMILY],                   // unrecognized
  ];

  for (const [input, expected] of cases) {
    const got = normalizeTopicFamily(input);
    check(
      `normalizeTopicFamily("${input}")`,
      got === expected,
      `expected=${expected} got=${got}`,
    );
  }
}

// ── Section 4: DB write — 3 synthetic phat_phap rows ─────────────────────

async function testDbWrite() {
  console.log("\n── 4. DB write: 3 synthetic phat_phap rows ─────────────────");

  // Clean up any previous smoke test rows
  await cleanup();

  const rows = [
    {
      id: SMOKE_IDS[0]!,
      topic: "Kẻ phản bội sẽ nhận quả báo",
      topicFamily: "nhan_qua_nguoi_xau_bao_ung",
      formatType: "tts_short",
    },
    {
      id: SMOKE_IDS[1]!,
      topic: "Người xấu tự chuốc họa vào thân",
      topicFamily: "nhan_qua_nguoi_xau_bao_ung",
      formatType: "tts_short",
    },
    {
      id: SMOKE_IDS[2]!,
      topic: "Buông bỏ để tâm được nhẹ",
      topicFamily: "buong_bo_chua_lanh",
      formatType: "legacy_quote_short",
    },
  ];

  for (const row of rows) {
    await db.insert(contentGenerations).values({
      id: row.id,
      topic: row.topic,
      nicheId: 13,
      nicheName: "Phật Pháp",
      channelKey: "phat_phap",
      contentProfileKey: "buddhism",
      topicFamily: row.topicFamily,
      formatType: row.formatType,
      script: "smoke-test",
      shortContent: "smoke-test",
      longContent: "smoke-test",
      status: "completed",
      contentMode: "short",
    });
    console.log(`  Inserted: ${row.id} topic_family="${row.topicFamily}" format="${row.formatType}"`);
  }
  check("3 rows inserted", true);
}

// ── Section 5: DB read — verify topic_family stored ──────────────────────

async function testDbRead() {
  console.log("\n── 5. DB read: verify topic_family populated ────────────────");

  const rows = await db.query.contentGenerations.findMany({
    where: eq(contentGenerations.channelKey, "phat_phap"),
    columns: { id: true, topic: true, topicFamily: true, formatType: true, createdAt: true },
    orderBy: (t, { desc: d }) => d(t.createdAt),
    limit: 10,
  });

  const smokeRows = rows.filter((r) => SMOKE_IDS.includes(r.id));
  check("3 smoke rows found in DB", smokeRows.length === 3, `found ${smokeRows.length}`);

  for (const r of smokeRows) {
    check(
      `Row ${r.id} has topic_family`,
      r.topicFamily != null && r.topicFamily.length > 0,
      `topic_family="${r.topicFamily}"`,
    );
  }

  const nhanQuaRows = smokeRows.filter((r) => r.topicFamily === "nhan_qua_nguoi_xau_bao_ung");
  const buongBoRows = smokeRows.filter((r) => r.topicFamily === "buong_bo_chua_lanh");
  const quoteRows = smokeRows.filter((r) => r.formatType === "legacy_quote_short");
  const videoRows = smokeRows.filter((r) => r.formatType === "tts_short");

  check("2 rows have focus family (nhan_qua)", nhanQuaRows.length === 2, `count=${nhanQuaRows.length}`);
  check("1 row has secondary family (buong_bo)", buongBoRows.length === 1, `count=${buongBoRows.length}`);
  check("1 quote/photo row (legacy_quote_short)", quoteRows.length === 1, `count=${quoteRows.length}`);
  check("2 video rows (tts_short)", videoRows.length === 2, `count=${videoRows.length}`);

  console.log("\n  Smoke rows summary:");
  for (const r of smokeRows) {
    const display = STRATEGIC_FAMILY_DISPLAY[r.topicFamily as StrategicTopicFamilyId] ?? r.topicFamily;
    console.log(`    ${r.id} | family="${r.topicFamily}" (${display}) | format="${r.formatType}"`);
  }

  return { contentIds: smokeRows.map((r) => r.id), families: smokeRows.map((r) => r.topicFamily) };
}

// ── Section 6: Coverage action ────────────────────────────────────────────

async function testCoverageAction() {
  console.log("\n── 6. getStrategicFamilyCoverageAction() ────────────────────");

  let coverageRows;
  try {
    coverageRows = await getStrategicFamilyCoverageAction();
    check("Action executed without error", true);
  } catch (err) {
    check("Action executed without error", false, String(err));
    return;
  }

  check("Returns array", Array.isArray(coverageRows));
  check("Has at least 1 row", coverageRows.length >= 1, `count=${coverageRows.length}`);

  const focusRow = coverageRows.find((r) => r.familyId === "nhan_qua_nguoi_xau_bao_ung");
  check("Focus family row present", focusRow != null);

  if (focusRow) {
    check("Focus row sprintLabel = Focus", focusRow.sprintLabel === "Focus", `got="${focusRow.sprintLabel}"`);
    check("Focus row sampleDepth.total >= 2", focusRow.sampleDepth.total >= 2, `total=${focusRow.sampleDepth.total}`);
    check("Focus row videoCount.total >= 2", focusRow.videoCount.total >= 2, `videoTotal=${focusRow.videoCount.total}`);
  }

  const buongBoRow = coverageRows.find((r) => r.familyId === "buong_bo_chua_lanh");
  if (buongBoRow) {
    check("Buong bo sprintLabel = Secondary", buongBoRow.sprintLabel === "Secondary", `got="${buongBoRow.sprintLabel}"`);
    check("Buong bo quoteCount.total >= 1", buongBoRow.quoteCount.total >= 1, `quoteTotal=${buongBoRow.quoteCount.total}`);
  }

  console.log("\n  Coverage summary (phat_phap, sorted by sprint priority):");
  for (const r of coverageRows) {
    const videoQ = `${r.videoCount.total}v/${r.quoteCount.total}q`;
    console.log(`    [${String(r.sprintLabel ?? "—").padEnd(12)}] ${r.displayName.padEnd(40)} | total=${r.sampleDepth.total} (${videoQ}) | ${r.sampleDepthStatus}`);
  }
}

// ── Section 7: Tang Sau guard ─────────────────────────────────────────────

async function testTangSauGuard() {
  console.log("\n── 7. Tang Sau guard: no Buddhist topic_family ──────────────");

  const tangSauWithFamily = await db.query.contentGenerations.findMany({
    where: and(
      eq(contentGenerations.channelKey, "tang_sau"),
      isNotNull(contentGenerations.topicFamily),
    ),
    columns: { id: true, topicFamily: true },
    limit: 5,
  });

  check(
    "No tang_sau rows have topic_family set",
    tangSauWithFamily.length === 0,
    tangSauWithFamily.length > 0
      ? `Found ${tangSauWithFamily.length} rows: ${tangSauWithFamily.map((r) => r.topicFamily).join(", ")}`
      : "0 rows",
  );
}

// ── Section 8: Upload queue untouched ─────────────────────────────────────

async function testUploadQueueUntouched() {
  console.log("\n── 8. Upload queue: schema unchanged ────────────────────────");
  // Just verify we can query it without error (proves schema is intact)
  const { uploadQueue } = await import("@/lib/db/schema");
  const count = await db.$count(uploadQueue);
  check("upload_queue queryable without error", true, `${count} rows`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Smoke test: Strategic topic family end-to-end wiring");
  console.log("═══════════════════════════════════════════════════════════");

  try {
    testSprintAllocation();
    testInference();
    testNormalize();
    await testDbWrite();
    const { contentIds, families } = await testDbRead();
    await testCoverageAction();
    await testTangSauGuard();
    await testUploadQueueUntouched();

    console.log("\n── Cleanup: removing smoke test rows ────────────────────────");
    await cleanup();
    console.log("  Smoke rows deleted.");

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log(`  Content IDs: ${contentIds.join(", ")}`);
    console.log(`  topic_family values: ${families.join(", ")}`);
    console.log("═══════════════════════════════════════════════════════════");

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error("\n  FATAL:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  }
}

main();
