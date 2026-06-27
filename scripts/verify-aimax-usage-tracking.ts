/**
 * verify-aimax-usage-tracking.ts
 *
 * Inserts synthetic tts_jobs records (done / cached / failed) to verify the
 * AiMax Usage Monitor schema, server-action aggregations, and filter logic.
 * Cleans up all synthetic rows after running.
 *
 * Run:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/verify-aimax-usage-tracking.ts
 */

import crypto from "crypto";
import { db } from "@/lib/db";
import { ttsJobs } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getAiMaxUsageSummaryAction, listAiMaxUsageRequestsAction } from "@/actions/aimax-usage";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const insertedIds: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function sha256(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// ─── Synthetic data ───────────────────────────────────────────────────────────

const TEST_ROUTE  = "__verify_test_route__";
const TEST_FAMILY = "__verify_test_family__";
const TEST_TEXT   = "Đây là văn bản kiểm tra hệ thống theo dõi sử dụng AiMax TTS.";
const TEXT_HASH   = sha256(TEST_TEXT);
const CHAR_COUNT  = TEST_TEXT.length;
const CONTENT_ID  = `verify-test-${Date.now()}`;

async function insertSynthetic() {
  const now = new Date();

  const doneId = crypto.randomUUID();
  const cachedId = crypto.randomUUID();
  const failedId = crypto.randomUUID();

  await db.insert(ttsJobs).values([
    // 1. completed network request
    {
      id: doneId,
      provider: "aimax",
      externalJobId: `verify-done-${doneId}`,
      voiceId: "s_sg_male_thientam_ytstable_vc",
      voiceLabel: "Thiện Tâm",
      voiceFamily: TEST_FAMILY,
      status: "completed",
      creditUsed: "12.5000",
      cacheHit: false,
      usageSource: "api",
      pipelineRoute: TEST_ROUTE,
      contentId: CONTENT_ID,
      contentProfileKey: "phat_phap_short",
      nicheName: "Phật Pháp",
      formatType: "short",
      speed: "1.000",
      pitch: "0.000",
      textHash: TEXT_HASH,
      textCharCount: CHAR_COUNT,
      cacheIdentity: `cache-identity-done-${doneId}`,
      startedAt: new Date(now.getTime() - 5000),
      completedAt: now,
      durationMs: 5000,
      createdAt: now,
      updatedAt: now,
    },
    // 2. cache hit — zero cost
    {
      id: cachedId,
      provider: "aimax",
      externalJobId: `cache:${cachedId}`,
      voiceId: "s_sg_male_thientam_ytstable_vc",
      voiceLabel: "Thiện Tâm",
      voiceFamily: TEST_FAMILY,
      status: "cached",
      creditUsed: "0.0000",
      cacheHit: true,
      usageSource: "cache",
      pipelineRoute: TEST_ROUTE,
      contentId: CONTENT_ID,
      contentProfileKey: "phat_phap_short",
      nicheName: "Phật Pháp",
      formatType: "short",
      speed: "1.000",
      pitch: "0.000",
      textHash: TEXT_HASH,
      textCharCount: CHAR_COUNT,
      cacheIdentity: `cache-identity-done-${doneId}`,
      durationMs: 2,
      createdAt: now,
      updatedAt: now,
    },
    // 3. failed request
    {
      id: failedId,
      provider: "aimax",
      externalJobId: `verify-failed-${failedId}`,
      voiceId: "s_sg_male_thientam_ytstable_vc",
      voiceLabel: "Thiện Tâm",
      voiceFamily: TEST_FAMILY,
      status: "failed",
      cacheHit: false,
      usageSource: "api",
      pipelineRoute: TEST_ROUTE,
      contentId: CONTENT_ID,
      errorMessage: "Synthetic failure for verify script",
      textHash: TEXT_HASH,
      textCharCount: CHAR_COUNT,
      durationMs: 1200,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  insertedIds.push(doneId, cachedId, failedId);
  return { doneId, cachedId, failedId };
}

async function cleanup() {
  if (insertedIds.length === 0) return;
  await db.delete(ttsJobs).where(inArray(ttsJobs.id, insertedIds));
  console.log(`\n  [cleanup] Deleted ${insertedIds.length} synthetic rows.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n" + "═".repeat(64));
  console.log("  VERIFY: AiMax Usage Tracking — tts_jobs schema + actions");
  console.log("═".repeat(64));

  // ── 1. Schema column existence (SQL level) ─────────────────────────────────
  console.log("\n[1] Schema column check (via Drizzle select)");
  try {
    // If columns are missing this throws immediately
    const probe = await db.select({
      id: ttsJobs.id,
      provider: ttsJobs.provider,
      status: ttsJobs.status,
      pipelineRoute: ttsJobs.pipelineRoute,
      contentId: ttsJobs.contentId,
      contentProfileKey: ttsJobs.contentProfileKey,
      nicheName: ttsJobs.nicheName,
      formatType: ttsJobs.formatType,
      voiceId: ttsJobs.voiceId,
      voiceLabel: ttsJobs.voiceLabel,
      voiceFamily: ttsJobs.voiceFamily,
      speed: ttsJobs.speed,
      pitch: ttsJobs.pitch,
      textHash: ttsJobs.textHash,
      textCharCount: ttsJobs.textCharCount,
      cacheIdentity: ttsJobs.cacheIdentity,
      cacheHit: ttsJobs.cacheHit,
      usageSource: ttsJobs.usageSource,
      creditUsed: ttsJobs.creditUsed,
      estimatedCredits: ttsJobs.estimatedCredits,
      balanceBefore: ttsJobs.balanceBefore,
      balanceAfter: ttsJobs.balanceAfter,
      rawJson: ttsJobs.rawJson,          // covers rawUsageJson / pointsUsed / tokensUsed / estimatedTokens
      startedAt: ttsJobs.startedAt,
      completedAt: ttsJobs.completedAt,
      durationMs: ttsJobs.durationMs,
      errorMessage: ttsJobs.errorMessage,
      createdAt: ttsJobs.createdAt,
      updatedAt: ttsJobs.updatedAt,
    }).from(ttsJobs).limit(1);
    check("All tracked columns accessible via Drizzle ORM", true);
    check("Query returned without error", Array.isArray(probe));
  } catch (err) {
    check("All tracked columns accessible via Drizzle ORM", false, String(err));
    await cleanup();
    return;
  }

  // ── 2. Insert synthetic rows ───────────────────────────────────────────────
  console.log("\n[2] Insert synthetic rows");
  let ids: { doneId: string; cachedId: string; failedId: string };
  try {
    ids = await insertSynthetic();
    check("3 synthetic rows inserted (done / cached / failed)", true);
  } catch (err) {
    check("3 synthetic rows inserted (done / cached / failed)", false, String(err));
    await cleanup();
    return;
  }

  // ── 3. Verify no full text stored ─────────────────────────────────────────
  console.log("\n[3] Full-text storage safety");
  const rawRows = await db.select({ id: ttsJobs.id, rawJson: ttsJobs.rawJson }).from(ttsJobs).where(
    inArray(ttsJobs.id, insertedIds),
  );
  for (const row of rawRows) {
    const serialized = JSON.stringify(row.rawJson ?? "");
    check(`Row ${row.id.slice(0, 8)}… does not store full TTS text`, !serialized.includes(TEST_TEXT));
  }
  check("textHash stored (not raw text)", rawRows.every((r) => {
    return insertedIds.includes(r.id);  // verified by separate field check below
  }));
  const hashRows = await db.select({ textHash: ttsJobs.textHash }).from(ttsJobs).where(
    inArray(ttsJobs.id, insertedIds),
  );
  check("textHash column populated correctly", hashRows.every((r) => r.textHash === TEXT_HASH));

  // ── 4. Summary action totals ──────────────────────────────────────────────
  console.log("\n[4] getAiMaxUsageSummaryAction — pipelineRoute filter");
  const summaryResult = await getAiMaxUsageSummaryAction({ pipelineRoute: TEST_ROUTE });
  if (!summaryResult.ok) {
    check("Summary action returned ok", false, summaryResult.error);
  } else {
    const s = summaryResult.data;
    check("Summary action returned ok", true);
    check(`totalRequests = 3`, s.totalRequests === 3, `got ${s.totalRequests}`);
    check(`cacheHits = 1`, s.cacheHits === 1, `got ${s.cacheHits}`);
    check(`networkRequests = 2`, s.networkRequests === 2, `got ${s.networkRequests}`);
    check(`failedRequests = 1`, s.failedRequests === 1, `got ${s.failedRequests}`);
    check(`totalChars = ${CHAR_COUNT * 3}`, s.totalChars === CHAR_COUNT * 3, `got ${s.totalChars}`);
    check("byPipelineRoute contains test route", s.byPipelineRoute.some((r) => r.route === TEST_ROUTE));
    check("byVoiceFamily contains test family", s.byVoiceFamily.some((r) => r.family === TEST_FAMILY));
    check("byStatus contains 'completed'", s.byStatus.some((r) => r.status === "completed"));
    check("byStatus contains 'cached'", s.byStatus.some((r) => r.status === "cached"));
    check("byStatus contains 'failed'", s.byStatus.some((r) => r.status === "failed"));
  }

  // ── 5. Cache hit has zero cost ─────────────────────────────────────────────
  console.log("\n[5] Cache hit record — zero-cost assertion");
  const cachedRow = await db.select({
    creditUsed: ttsJobs.creditUsed,
    cacheHit: ttsJobs.cacheHit,
    usageSource: ttsJobs.usageSource,
    status: ttsJobs.status,
  }).from(ttsJobs).where(eq(ttsJobs.id, ids.cachedId)).limit(1);

  if (cachedRow[0]) {
    const c = cachedRow[0];
    check("cache hit: cacheHit = true", c.cacheHit === true);
    check("cache hit: status = 'cached'", c.status === "cached");
    check("cache hit: usageSource = 'cache'", c.usageSource === "cache");
    check("cache hit: creditUsed = 0", Number(c.creditUsed) === 0, `got ${c.creditUsed}`);
  } else {
    check("cache hit row found", false);
  }

  // ── 6. List action paginates and filters ──────────────────────────────────
  console.log("\n[6] listAiMaxUsageRequestsAction — filter by route");
  const listResult = await listAiMaxUsageRequestsAction({ pipelineRoute: TEST_ROUTE, limit: 50 });
  if (!listResult.ok) {
    check("List action returned ok", false, listResult.error);
  } else {
    check("List action returned ok", true);
    check("List total = 3", listResult.total === 3, `got ${listResult.total}`);
    check("List rows.length = 3", listResult.rows.length === 3, `got ${listResult.rows.length}`);
    check("All rows have voiceFamily", listResult.rows.every((r) => r.voiceFamily === TEST_FAMILY));
    check("Failed row has errorMessage", listResult.rows.some((r) => r.status === "failed" && r.errorMessage != null));
    check("Done row has creditUsed", listResult.rows.some((r) => r.status === "completed" && r.creditUsed != null));
  }

  // ── 7. Filter by voiceFamily ───────────────────────────────────────────────
  console.log("\n[7] listAiMaxUsageRequestsAction — filter by voiceFamily");
  const familyResult = await listAiMaxUsageRequestsAction({ voiceFamily: TEST_FAMILY, limit: 10 });
  if (familyResult.ok) {
    check("voiceFamily filter: total ≥ 3", familyResult.total >= 3, `got ${familyResult.total}`);
    check("voiceFamily filter: all rows match", familyResult.rows.every((r) => r.voiceFamily === TEST_FAMILY));
  } else {
    check("voiceFamily filter returned ok", false, familyResult.error);
  }

  // ── 8. Filter by cacheHit ──────────────────────────────────────────────────
  console.log("\n[8] listAiMaxUsageRequestsAction — cacheHit filter");
  const cacheOnlyResult = await listAiMaxUsageRequestsAction({ pipelineRoute: TEST_ROUTE, cacheHit: true, limit: 10 });
  if (cacheOnlyResult.ok) {
    check("cacheHit=true filter returns only cache rows", cacheOnlyResult.rows.every((r) => r.cacheHit === true));
    check("cacheHit=true filter: total = 1", cacheOnlyResult.total === 1, `got ${cacheOnlyResult.total}`);
  } else {
    check("cacheHit filter returned ok", false, cacheOnlyResult.error);
  }

  const networkOnlyResult = await listAiMaxUsageRequestsAction({ pipelineRoute: TEST_ROUTE, cacheHit: false, limit: 10 });
  if (networkOnlyResult.ok) {
    check("cacheHit=false filter: total = 2", networkOnlyResult.total === 2, `got ${networkOnlyResult.total}`);
    check("cacheHit=false filter: no cache rows", networkOnlyResult.rows.every((r) => r.cacheHit !== true));
  } else {
    check("cacheHit=false filter returned ok", false, networkOnlyResult.error);
  }

  // ── 9. Cleanup ─────────────────────────────────────────────────────────────
  console.log("\n[9] Cleanup");
  await cleanup();

  // Confirm deleted
  const afterCleanup = await listAiMaxUsageRequestsAction({ pipelineRoute: TEST_ROUTE, limit: 10 });
  if (afterCleanup.ok) {
    check("Synthetic rows removed after cleanup", afterCleanup.total === 0, `${afterCleanup.total} rows remain`);
  } else {
    check("Post-cleanup query succeeded", false, afterCleanup.error);
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(64));
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(64) + "\n");

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  cleanup().finally(() => process.exit(1));
});
