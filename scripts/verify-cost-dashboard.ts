/**
 * verify-cost-dashboard.ts
 *
 * Verifies the generation_cost_events schema, cost calculations,
 * aggregation logic, and filter correctness using synthetic rows.
 * Cleans up all synthetic records after running.
 *
 * Run:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/verify-cost-dashboard.ts
 */

import crypto from "crypto";
import { db } from "@/lib/db";
import { generationCostEvents } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import {
  getCostDashboardSummaryAction,
  listVideoCostBreakdownAction,
  getVideoCostDetailAction,
} from "@/actions/cost-dashboard";
import {
  DEFAULT_AIMAX_VND_PER_POINT,
  calculateAiMaxCostVnd,
  fmtVnd,
} from "@/lib/cost/cost-settings";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const insertedIds: string[] = [];
const TEST_CONTENT_ID = `verify-cost-${Date.now()}`;
const TEST_ROUTE = "__verify_cost_route__";
const TEST_NICHE = "__verify_cost_niche__";

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function cleanup() {
  if (insertedIds.length === 0) return;
  await db.delete(generationCostEvents).where(inArray(generationCostEvents.id, insertedIds));
  console.log(`\n  [cleanup] Deleted ${insertedIds.length} synthetic rows.`);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

async function insertSynthetic() {
  const now = new Date();

  // 1. AiMax TTS — known cost: 687 points × 0.12 = 82.44 VND
  const ttsId = crypto.randomUUID();
  // 2. Cache hit — zero cost
  const cacheId = crypto.randomUUID();
  // 3. Fal image — known USD cost → VND
  const imageId = crypto.randomUUID();
  // 4. LLM script — known USD cost → VND
  const llmId = crypto.randomUUID();
  // 5. Unknown — no cost data
  const unknownId = crypto.randomUUID();

  await db.insert(generationCostEvents).values([
    {
      id: ttsId,
      contentId: TEST_CONTENT_ID,
      provider: "aimax",
      costType: "tts",
      pipelineRoute: TEST_ROUTE,
      nicheName: TEST_NICHE,
      sourceTable: "tts_jobs",
      sourceId: `verify-tts-${ttsId}`,
      status: "done",
      usageUnit: "point",
      usageAmount: "687",
      unitCostVnd: String(DEFAULT_AIMAX_VND_PER_POINT),
      costVnd: "82.44",
      costSource: "configured_rate",
      metadata: { voiceLabel: "Thiện Tâm", textCharCount: 500 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cacheId,
      contentId: TEST_CONTENT_ID,
      provider: "aimax",
      costType: "tts",
      pipelineRoute: TEST_ROUTE,
      nicheName: TEST_NICHE,
      sourceTable: "tts_jobs",
      sourceId: `verify-cache-${cacheId}`,
      status: "cached",
      usageUnit: "point",
      usageAmount: "0",
      unitCostVnd: String(DEFAULT_AIMAX_VND_PER_POINT),
      costVnd: "0",
      costSource: "cache",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: imageId,
      contentId: TEST_CONTENT_ID,
      provider: "fal",
      costType: "image",
      pipelineRoute: TEST_ROUTE,
      nicheName: TEST_NICHE,
      sourceTable: "api_usage_logs",
      sourceId: `verify-img-${imageId}`,
      status: "done",
      usageUnit: "image",
      usageAmount: "6",
      costVnd: "450",
      costSource: "configured_rate",
      metadata: { model: "fal-ai/flux/schnell", numImages: 6, costUsd: 0.018 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: llmId,
      contentId: TEST_CONTENT_ID,
      provider: "openrouter",
      costType: "script",
      pipelineRoute: TEST_ROUTE,
      nicheName: TEST_NICHE,
      sourceTable: "api_usage_logs",
      sourceId: `verify-llm-${llmId}`,
      status: "done",
      usageUnit: "token",
      usageAmount: "4200",
      costVnd: "125",
      costSource: "configured_rate",
      metadata: { model: "openrouter/google/gemini-2.0-flash", inputTokens: 3000, outputTokens: 1200, costUsd: 0.005 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: unknownId,
      contentId: TEST_CONTENT_ID,
      provider: "openrouter",
      costType: "hook",
      pipelineRoute: TEST_ROUTE,
      nicheName: TEST_NICHE,
      sourceTable: "api_usage_logs",
      sourceId: `verify-unknown-${unknownId}`,
      status: "done",
      usageUnit: "token",
      usageAmount: "800",
      costVnd: null,
      costSource: "unknown",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  insertedIds.push(ttsId, cacheId, imageId, llmId, unknownId);
  return { ttsId, cacheId, imageId, llmId, unknownId };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n" + "═".repeat(64));
  console.log("  VERIFY: Cost Dashboard — schema + actions + calculations");
  console.log("═".repeat(64));

  // ── 1. Cost calculation correctness ──────────────────────────────────────
  console.log("\n[1] AiMax cost calculation");
  check("DEFAULT rate = 0.12 VND/point", DEFAULT_AIMAX_VND_PER_POINT === 0.12);
  check("687 points × 0.12 = 82.44 VND", calculateAiMaxCostVnd(687) === 82.44, `got ${calculateAiMaxCostVnd(687)}`);
  check("0 points = 0 VND", calculateAiMaxCostVnd(0) === 0);
  check("null points = null", calculateAiMaxCostVnd(null) === null);
  check("fmtVnd(82.44) contains ₫", fmtVnd(82.44).includes("₫"));
  check("fmtVnd(1250) contains ₫", fmtVnd(1250).includes("₫"));
  check("fmtVnd(null) = —", fmtVnd(null) === "—");

  // ── 2. Schema probe ───────────────────────────────────────────────────────
  console.log("\n[2] Schema column probe");
  try {
    await db.select({
      id:               generationCostEvents.id,
      contentId:        generationCostEvents.contentId,
      provider:         generationCostEvents.provider,
      costType:         generationCostEvents.costType,
      pipelineRoute:    generationCostEvents.pipelineRoute,
      contentProfileKey: generationCostEvents.contentProfileKey,
      nicheName:        generationCostEvents.nicheName,
      formatType:       generationCostEvents.formatType,
      sourceTable:      generationCostEvents.sourceTable,
      sourceId:         generationCostEvents.sourceId,
      status:           generationCostEvents.status,
      usageUnit:        generationCostEvents.usageUnit,
      usageAmount:      generationCostEvents.usageAmount,
      unitCostVnd:      generationCostEvents.unitCostVnd,
      costVnd:          generationCostEvents.costVnd,
      costSource:       generationCostEvents.costSource,
      currency:         generationCostEvents.currency,
      metadata:         generationCostEvents.metadata,
      createdAt:        generationCostEvents.createdAt,
      updatedAt:        generationCostEvents.updatedAt,
    }).from(generationCostEvents).limit(1);
    check("All schema columns accessible", true);
  } catch (err) {
    check("All schema columns accessible", false, String(err));
    await cleanup();
    return;
  }

  // ── 3. Insert synthetic rows ──────────────────────────────────────────────
  console.log("\n[3] Insert synthetic rows");
  try {
    await insertSynthetic();
    check("5 synthetic rows inserted", true);
  } catch (err) {
    check("5 synthetic rows inserted", false, String(err));
    await cleanup();
    return;
  }

  // ── 4. Summary aggregation ────────────────────────────────────────────────
  console.log("\n[4] getCostDashboardSummaryAction — pipelineRoute filter");
  const summaryResult = await getCostDashboardSummaryAction({ pipelineRoute: TEST_ROUTE });
  if (!summaryResult.ok) {
    check("Summary action ok", false, summaryResult.error);
  } else {
    const s = summaryResult.data;
    check("Summary action ok", true);
    // Known cost = 82.44 (TTS) + 450 (image) + 125 (script) = 657.44
    // Cache = 0 (not included in known)
    // Unknown hook = null (not included)
    check("knownCostVnd = 657.44", Math.abs(s.knownCostVnd - 657.44) < 0.01, `got ${s.knownCostVnd}`);
    check("ttsCostVnd = 82.44", Math.abs(s.ttsCostVnd - 82.44) < 0.01, `got ${s.ttsCostVnd}`);
    check("imageCostVnd = 450", Math.abs(s.imageCostVnd - 450) < 0.01, `got ${s.imageCostVnd}`);
    check("contentCostVnd = 125", Math.abs(s.contentCostVnd - 125) < 0.01, `got ${s.contentCostVnd}`);
    check("unknownCostEventCount ≥ 1", s.unknownCostEventCount >= 1, `got ${s.unknownCostEventCount}`);
    check("cachedCostEventCount ≥ 1", s.cachedCostEventCount >= 1, `got ${s.cachedCostEventCount}`);
    check("totalVideosWithCost ≥ 1", s.totalVideosWithCost >= 1, `got ${s.totalVideosWithCost}`);
    check("byProvider contains aimax", s.byProvider.some((p) => p.provider === "aimax"));
    check("byProvider contains fal", s.byProvider.some((p) => p.provider === "fal"));
    check("byProvider contains openrouter", s.byProvider.some((p) => p.provider === "openrouter"));
    check("byCostType contains tts", s.byCostType.some((c) => c.costType === "tts"));
    check("byCostType contains image", s.byCostType.some((c) => c.costType === "image"));
    check("byNiche contains test niche", s.byNiche.some((n) => n.niche === TEST_NICHE));
    check("aimaxVndPerPoint = 0.12", s.aimaxVndPerPoint === 0.12, `got ${s.aimaxVndPerPoint}`);
  }

  // ── 5. Per-video breakdown ────────────────────────────────────────────────
  console.log("\n[5] listVideoCostBreakdownAction — pipelineRoute filter");
  const listResult = await listVideoCostBreakdownAction({ pipelineRoute: TEST_ROUTE });
  if (!listResult.ok) {
    check("List action ok", false, listResult.error);
  } else {
    check("List action ok", true);
    const row = listResult.rows.find((r) => r.contentId === TEST_CONTENT_ID);
    check("Test content found in per-video list", row != null);
    if (row) {
      check("totalCostVnd = 657.44", Math.abs(row.totalCostVnd - 657.44) < 0.01, `got ${row.totalCostVnd}`);
      check("ttsCostVnd = 82.44", Math.abs(row.ttsCostVnd - 82.44) < 0.01, `got ${row.ttsCostVnd}`);
      check("imageCostVnd = 450", Math.abs(row.imageCostVnd - 450) < 0.01, `got ${row.imageCostVnd}`);
      check("unknownCostCount ≥ 1", row.unknownCostCount >= 1, `got ${row.unknownCostCount}`);
      check("nicheName = test niche", row.nicheName === TEST_NICHE);
    }
  }

  // ── 6. Detail action ──────────────────────────────────────────────────────
  console.log("\n[6] getVideoCostDetailAction");
  const detailResult = await getVideoCostDetailAction(TEST_CONTENT_ID);
  if (!detailResult.ok) {
    check("Detail action ok", false, detailResult.error);
  } else {
    check("Detail action ok", true);
    check("Events count = 5", detailResult.events.length === 5, `got ${detailResult.events.length}`);
    const cacheEv = detailResult.events.find((e) => e.status === "cached");
    check("Cache event has costVnd = 0", cacheEv != null && Number(cacheEv.costVnd) === 0, `got ${cacheEv?.costVnd}`);
    const unknownEv = detailResult.events.find((e) => e.costSource === "unknown");
    check("Unknown event has null costVnd", unknownEv != null && unknownEv.costVnd == null);
    check("No full text stored in metadata", detailResult.events.every((e) => {
      const meta = JSON.stringify(e.metadata ?? {});
      return !meta.includes("Đây là văn bản") && !meta.includes("script_content");
    }));
  }

  // ── 7. Provider filter ────────────────────────────────────────────────────
  console.log("\n[7] Filter by provider");
  const aimaxOnly = await getCostDashboardSummaryAction({ pipelineRoute: TEST_ROUTE, provider: "aimax" });
  if (aimaxOnly.ok) {
    check("aimax filter: byProvider only aimax", aimaxOnly.data.byProvider.every((p) => p.provider === "aimax"));
    check("aimax filter: ttsCostVnd = 82.44", Math.abs(aimaxOnly.data.ttsCostVnd - 82.44) < 0.01, `got ${aimaxOnly.data.ttsCostVnd}`);
    check("aimax filter: no fal in providers", !aimaxOnly.data.byProvider.some((p) => p.provider === "fal"));
  }

  // ── 8. Cleanup ─────────────────────────────────────────────────────────────
  console.log("\n[8] Cleanup");
  await cleanup();

  const afterCleanup = await listVideoCostBreakdownAction({ pipelineRoute: TEST_ROUTE });
  if (afterCleanup.ok) {
    const stillHas = afterCleanup.rows.some((r) => r.contentId === TEST_CONTENT_ID);
    check("Synthetic rows removed after cleanup", !stillHas);
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
