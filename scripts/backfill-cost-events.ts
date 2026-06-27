/**
 * backfill-cost-events.ts
 *
 * Backfills generation_cost_events from existing tts_jobs (AiMax TTS)
 * and api_usage_logs (LLM + Fal.ai) records that have a contentGenerationId.
 *
 * Dry-run by default. Use --execute to write to DB.
 *
 * Run:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/backfill-cost-events.ts
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/backfill-cost-events.ts --execute
 */

import { db } from "@/lib/db";
import { ttsJobs, apiUsageLogs, generationCostEvents, contentGenerations } from "@/lib/db/schema";
import { and, eq, isNotNull, notInArray, ne, sql } from "drizzle-orm";
import { getCostSettings } from "@/lib/cost/cost-settings";

const EXECUTE = process.argv.includes("--execute");
const INCLUDE_UNKNOWN_SCRIPT = process.argv.includes("--include-unknown-script");
const BATCH = 200;

let scanned = 0;
let created = 0;
let skipped = 0;
let unknownRows = 0;
let totalKnownVnd = 0;

function toNumStr(v: number | null | undefined): string | null {
  return v != null && Number.isFinite(v) ? String(v) : null;
}

function safeNum(v: string | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── TTS Jobs backfill ────────────────────────────────────────────────────────

async function backfillTtsJobs(vndPerPoint: number) {
  console.log("\n[TTS] Backfilling from tts_jobs (provider=aimax) …");

  // Find existing source_ids so we skip them
  const existing = await db.select({ sourceId: generationCostEvents.sourceId })
    .from(generationCostEvents)
    .where(eq(generationCostEvents.sourceTable, "tts_jobs"));
  const existingIds = new Set(existing.map((r) => r.sourceId).filter(Boolean));

  let offset = 0;
  while (true) {
    const rows = await db.select({
      externalJobId: ttsJobs.externalJobId,
      contentId:    ttsJobs.contentId,
      status:       ttsJobs.status,
      cacheHit:     ttsJobs.cacheHit,
      creditUsed:   ttsJobs.creditUsed,
      pipelineRoute: ttsJobs.pipelineRoute,
      contentProfileKey: ttsJobs.contentProfileKey,
      nicheName:    ttsJobs.nicheName,
      formatType:   ttsJobs.formatType,
      voiceLabel:   ttsJobs.voiceLabel,
      voiceFamily:  ttsJobs.voiceFamily,
      speed:        ttsJobs.speed,
      pitch:        ttsJobs.pitch,
      textCharCount: ttsJobs.textCharCount,
      createdAt:    ttsJobs.createdAt,
    })
      .from(ttsJobs)
      .where(eq(ttsJobs.provider, "aimax"))
      .limit(BATCH)
      .offset(offset);

    if (rows.length === 0) break;
    offset += BATCH;
    scanned += rows.length;

    for (const row of rows) {
      const sourceId = row.externalJobId;
      if (existingIds.has(sourceId)) { skipped++; continue; }

      const isCached = row.cacheHit === true || row.status === "cached";
      const creditNum = safeNum(row.creditUsed);
      const costVnd = isCached ? 0 : (creditNum != null ? creditNum * vndPerPoint : null);
      const costSource = isCached ? "cache" : (creditNum != null ? "configured_rate" : "unknown");
      const status = isCached ? "cached" : (row.status === "failed" || row.status === "cancelled" ? "failed" : "done");

      if (costVnd == null && !isCached) unknownRows++;
      else if (costVnd != null) totalKnownVnd += costVnd;

      if (EXECUTE) {
        try {
          await db.insert(generationCostEvents).values({
            contentId:        row.contentId ?? null,
            provider:         "aimax",
            costType:         "tts",
            pipelineRoute:    row.pipelineRoute ?? null,
            contentProfileKey: row.contentProfileKey ?? null,
            nicheName:        row.nicheName ?? null,
            formatType:       row.formatType ?? null,
            sourceTable:      "tts_jobs",
            sourceId,
            status,
            usageUnit:        "point",
            usageAmount:      isCached ? "0" : toNumStr(creditNum),
            unitCostVnd:      String(vndPerPoint),
            costVnd:          toNumStr(costVnd),
            costSource,
            metadata: {
              voiceLabel:   row.voiceLabel,
              voiceFamily:  row.voiceFamily,
              speed:        row.speed,
              pitch:        row.pitch,
              textCharCount: row.textCharCount,
            },
            createdAt: row.createdAt,
            updatedAt: new Date(),
          }).onConflictDoNothing();
          created++;
        } catch (err) {
          console.warn(`  [TTS] Skip ${sourceId}: ${String(err).split("\n")[0]}`);
          skipped++;
        }
      } else {
        created++; // dry-run count
      }
    }
  }
}

// ─── API Usage Logs backfill ──────────────────────────────────────────────────

async function backfillApiUsageLogs(usdToVnd: number) {
  console.log("\n[LLM/Fal] Backfilling from api_usage_logs (contentGenerationId not null) …");

  const existing = await db.select({ sourceId: generationCostEvents.sourceId })
    .from(generationCostEvents)
    .where(eq(generationCostEvents.sourceTable, "api_usage_logs"));
  const existingIds = new Set(existing.map((r) => r.sourceId).filter(Boolean));

  let offset = 0;
  while (true) {
    const rows = await db.select({
      id:          apiUsageLogs.id,
      model:       apiUsageLogs.model,
      provider:    apiUsageLogs.provider,
      purpose:     apiUsageLogs.purpose,
      inputTokens: apiUsageLogs.inputTokens,
      outputTokens: apiUsageLogs.outputTokens,
      costUsd:     apiUsageLogs.costUsd,
      contentGenerationId: apiUsageLogs.contentGenerationId,
      metadata:    apiUsageLogs.metadata,
      createdAt:   apiUsageLogs.createdAt,
    })
      .from(apiUsageLogs)
      .where(isNotNull(apiUsageLogs.contentGenerationId))
      .limit(BATCH)
      .offset(offset);

    if (rows.length === 0) break;
    offset += BATCH;
    scanned += rows.length;

    for (const row of rows) {
      const sourceId = String(row.id);
      if (existingIds.has(sourceId)) { skipped++; continue; }

      const isFal = row.model.startsWith("fal-ai/");
      const costUsd = safeNum(row.costUsd) ?? 0;
      const costVnd = costUsd > 0 ? Math.round(costUsd * usdToVnd * 100) / 100 : 0;
      const costType = isFal ? "image" : (row.purpose.startsWith("content_") ? "script" : (row.purpose.includes("hook") ? "hook" : "llm"));
      const providerName = isFal ? "fal" : "openrouter";

      if (costVnd > 0) totalKnownVnd += costVnd;
      else unknownRows++;

      if (EXECUTE) {
        try {
          await db.insert(generationCostEvents).values({
            contentId:     row.contentGenerationId ?? null,
            provider:      providerName,
            costType,
            sourceTable:   "api_usage_logs",
            sourceId,
            status:        "done",
            usageUnit:     isFal ? "image" : "token",
            usageAmount:   isFal
              ? toNumStr((row.metadata as { numImages?: number } | null)?.numImages ?? null)
              : String(row.inputTokens + row.outputTokens),
            unitCostVnd:   null,
            costVnd:       toNumStr(costVnd || null),
            costSource:    costUsd > 0 ? "configured_rate" : "unknown",
            metadata: {
              model:        row.model,
              purpose:      row.purpose,
              inputTokens:  row.inputTokens,
              outputTokens: row.outputTokens,
              costUsd,
            },
            createdAt: row.createdAt,
            updatedAt: new Date(),
          }).onConflictDoNothing();
          created++;
        } catch (err) {
          console.warn(`  [LLM] Skip ${sourceId}: ${String(err).split("\n")[0]}`);
          skipped++;
        }
      } else {
        created++; // dry-run count
      }
    }
  }
}

// ─── Unknown-script backfill ──────────────────────────────────────────────────

async function backfillUnknownScriptCosts() {
  console.log("\n[SCRIPT] Backfilling unknown-cost events for content rows without script cost events …");

  // Content IDs that already have at least one script-type cost event
  const covered = await db
    .selectDistinct({ contentId: generationCostEvents.contentId })
    .from(generationCostEvents)
    .where(
      and(
        isNotNull(generationCostEvents.contentId),
        sql`cost_type in ('script','hook','topic','llm')`,
      ),
    );
  const coveredIds = covered.map((r) => r.contentId!).filter(Boolean);

  // Content rows with short_content present (short_content is NOT NULL in schema, but
  // we still check it's non-empty as a proxy for "script generation actually ran").
  let offset = 0;
  while (true) {
    const query = db.select({
      id:               contentGenerations.id,
      nicheName:        contentGenerations.nicheName,
      contentProfileKey: contentGenerations.contentProfileKey,
      formatType:       contentGenerations.formatType,
      createdAt:        contentGenerations.createdAt,
    })
      .from(contentGenerations)
      .where(
        and(
          ne(contentGenerations.shortContent, ""),
          coveredIds.length > 0 ? notInArray(contentGenerations.id, coveredIds) : undefined,
        ),
      )
      .limit(BATCH)
      .offset(offset);

    const rows = await query;
    if (rows.length === 0) break;
    offset += BATCH;
    scanned += rows.length;

    for (const row of rows) {
      const sourceId = `unknown-script:${row.id}`;

      if (EXECUTE) {
        try {
          await db.insert(generationCostEvents).values({
            contentId:         row.id,
            provider:          "openrouter",
            costType:          "script",
            sourceTable:       "content_generations",
            sourceId,
            status:            "done",
            usageUnit:         null,
            usageAmount:       null,
            unitCostVnd:       null,
            costVnd:           null,
            costSource:        "unknown",
            nicheName:         row.nicheName ?? null,
            contentProfileKey: row.contentProfileKey ?? null,
            formatType:        row.formatType ?? null,
            metadata: {
              reason: "script exists but provider usage/cost was not captured",
            },
            createdAt:  row.createdAt,
            updatedAt:  new Date(),
          }).onConflictDoNothing();
          created++;
        } catch (err) {
          console.warn(`  [SCRIPT] Skip ${row.id}: ${String(err).split("\n")[0]}`);
          skipped++;
        }
      } else {
        created++; // dry-run count
        unknownRows++;
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n" + "═".repeat(64));
  console.log(`  BACKFILL: generation_cost_events  [${EXECUTE ? "EXECUTE" : "DRY RUN"}]`);
  if (INCLUDE_UNKNOWN_SCRIPT) console.log("  + unknown-script sentinel events");
  console.log("═".repeat(64));

  if (!EXECUTE) {
    console.log("  (Pass --execute to write to DB)\n");
  }

  const settings = await getCostSettings();
  console.log(`  AiMax rate: ${settings.aimaxVndPerPoint} VND/point`);
  console.log(`  USD→VND:   ${settings.usdToVnd}`);

  await backfillTtsJobs(settings.aimaxVndPerPoint);
  await backfillApiUsageLogs(settings.usdToVnd);
  if (INCLUDE_UNKNOWN_SCRIPT) await backfillUnknownScriptCosts();

  console.log("\n" + "═".repeat(64));
  console.log("  RESULTS:");
  console.log(`    Scanned:         ${scanned}`);
  console.log(`    Would create:    ${created}${EXECUTE ? " (written)" : " (dry run)"}`);
  console.log(`    Skipped (exist): ${skipped}`);
  console.log(`    Unknown cost:    ${unknownRows}`);
  console.log(`    Known VND total: ${totalKnownVnd.toLocaleString("vi-VN")} ₫`);
  console.log("═".repeat(64) + "\n");
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
