/**
 * Generate 5 clean Tầng Sâu quote shorts after the visual hotfix.
 *
 * Uses the production pipeline (TANG_SAU_SCENE_POOL, inspectTangSauBackground guard).
 * Outputs to output/legacy-quote-short-v1/ so the scheduler can pick them up.
 * Inserts content_generations DB rows. Does NOT create upload_queue rows.
 *
 * Safety: no upload, no schedule, no published_videos mutation.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

const COUNT = 5;

async function main() {
  // Dynamic imports AFTER env loading so fal.config() sees FAL_KEY and db sees DATABASE_URL
  const pathMod = await import("path");
  const { db } = await import("@/lib/db");
  const { contentGenerations, niches } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const {
    previewQuoteGeneration,
    runQuoteShortBatch,
    QS_EXPERIMENT_ID,
  } = await import("@/lib/pipeline/quote-short-pipeline");

  console.log("=== Tầng Sâu hotfix batch — 5 clean items ===");
  console.log("Safety: no upload_queue mutations, no schedule, no uploads\n");

  // Get niche for DB insertion
  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.channelKey, "tang_sau"), eq(niches.isActive, true)),
    columns: { id: true, name: true, contentProfileKey: true, channelKey: true },
  });
  if (!niche) throw new Error("No active niche found for channel_key=tang_sau");
  console.log(`Niche: ${niche.name} (id=${niche.id}, cpk=${niche.contentProfileKey})\n`);

  // Generate preview items (LLM text generation)
  console.log("Generating preview items via previewQuoteGeneration...");
  const previewItems = await previewQuoteGeneration({
    count: COUNT,
    channelProfileId: "tang_sau_v1",
    workspaceId: "tang_sau_workspace",
    // No quoteFormat → auto-mix from TANG_SAU_FORMAT_POLICY
  });
  console.log(`Preview items: ${previewItems.length}`);
  for (const item of previewItems) {
    console.log(`  topic: ${item.topic.slice(0, 60)} [${item.experimentVariant}]`);
  }
  console.log();

  // Render videos (fal.ai + FFmpeg)
  console.log("Rendering videos via runQuoteShortBatch...");
  const batchResults = await runQuoteShortBatch(previewItems, { durationSec: 14 });

  const successful = batchResults.filter((r) => r.ok && r.videoPath);
  const failed = batchResults.filter((r) => !r.ok);

  console.log(`\nRender results: ${successful.length} OK, ${failed.length} FAIL`);
  for (const r of failed) {
    console.error(`  FAIL ${r.contentId}: ${r.error}`);
  }

  // Insert DB rows for successful items
  if (successful.length > 0) {
    await db.insert(contentGenerations).values(
      successful.map((r) => ({
        id: r.contentId,
        topic: r.topic,
        nicheId: niche.id,
        nicheName: niche.name,
        contentProfileKey: niche.contentProfileKey ?? "philosophy",
        channelKey: niche.channelKey ?? "tang_sau",
        script: r.reflectionText ? `${r.quoteText}\n\n${r.reflectionText}` : r.quoteText,
        shortContent: r.reflectionText ? `${r.quoteText}\n\n${r.reflectionText}` : r.quoteText,
        shortSelectedHook: r.quoteText,
        longContent: r.reflectionText ? `${r.quoteText}\n\n${r.reflectionText}` : r.quoteText,
        experimentId: QS_EXPERIMENT_ID,
        experimentVariant: r.experimentVariant ?? "LEGACY_QUOTE_KINETIC_TEXT_V1",
        thumbnailText: r.quoteText,
        status: "completed",
        ttsStatus: "done",
        imagesStatus: "done",
        videoStatus: "done",
        videoPath: r.videoPath ? pathMod.relative(process.cwd(), r.videoPath) : "",
        contentMode: "short",
        formatType: "legacy_quote_short",
      })),
    );
    console.log(`\nDB rows inserted: ${successful.length}`);
  }

  // Verify each item: sidecar, DB row, no queue row
  console.log("\n=== Verification ===");
  const BLACKLIST = ["buddha", "temple", "monk", "prayer", "praying", "lotus", "buddhist", "spiritual", "meditation pose", "old temple", "chắp tay"];
  const fs = (await import("fs")).default;

  for (const r of successful) {
    console.log(`\n  ${r.contentId}`);
    console.log(`    topic:    ${r.topic.slice(0, 60)}`);
    console.log(`    variant:  ${r.experimentVariant}`);
    console.log(`    video:    ${r.videoPath && fs.existsSync(r.videoPath) ? "✓ exists" : "✗ MISSING"}`);

    // Check sidecar
    if (r.sidecarPath && fs.existsSync(r.sidecarPath)) {
      const sidecar = JSON.parse(fs.readFileSync(r.sidecarPath, "utf8"));
      const kws: string[] = sidecar.visualSearchKeywords ?? [];
      const hits = BLACKLIST.filter((b) => kws.join(" ").toLowerCase().includes(b));
      console.log(`    workspaceId:       ${sidecar.workspaceId === "tang_sau_workspace" ? "✓" : "✗ " + String(sidecar.workspaceId)}`);
      console.log(`    channelProfileId:  ${sidecar.channelProfileId === "tang_sau_v1" ? "✓" : "✗ " + String(sidecar.channelProfileId)}`);
      console.log(`    channelKey:        ${sidecar.channelKey === "tang_sau" ? "✓" : "✗ " + String(sidecar.channelKey)}`);
      console.log(`    contentProfileKey: ${sidecar.contentProfileKey === "philosophy" ? "✓" : "✗ " + String(sidecar.contentProfileKey)}`);
      if (hits.length > 0) {
        console.log(`    visualSearchKeywords: ✗ BLACKLIST HIT: ${hits.join(", ")}`);
      } else {
        console.log(`    visualSearchKeywords: ✓ clean (${kws.slice(0, 3).join(", ")})`);
      }
    } else {
      console.log(`    sidecar: ✗ MISSING (${r.sidecarPath})`);
    }

    // Check DB row
    const dbRow = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, r.contentId),
      columns: { id: true, videoStatus: true, channelKey: true, contentProfileKey: true },
    });
    if (dbRow) {
      console.log(`    DB row:  ✓ videoStatus=${dbRow.videoStatus} channelKey=${dbRow.channelKey} cpk=${dbRow.contentProfileKey}`);
    } else {
      console.log("    DB row:  ✗ MISSING");
    }
  }

  // Confirm no upload_queue rows were created
  const { uploadQueue } = await import("@/lib/db/schema");
  const queueRows = await db.query.uploadQueue.findMany({
    where: (t, { inArray }) =>
      inArray(t.contentId, successful.map((r) => r.contentId)),
    columns: { id: true, contentId: true, status: true },
  });
  console.log(`\nupload_queue rows created: ${queueRows.length} (expected: 0)`);
  if (queueRows.length > 0) {
    console.error("  WARNING: unexpected queue rows:", queueRows);
  }

  console.log("\n=== Summary ===");
  console.log(`Generated OK: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Uploads: 0`);
  console.log(`Queue mutations: 0`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
