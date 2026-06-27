/**
 * Repair subtitle-failed short videos by re-running video assembly only.
 * TTS, images, and script are NOT regenerated.
 *
 * Usage: npx tsx scripts/repair-subtitle-failed.ts
 */

import { runShortVideo } from "@/lib/pipeline/short-video";

const CONTENT_IDS = [
  "f86006b4-5470-4a03-a442-27f37bd36aa9", // 1 blank/invalid subtitle segment
  "20f391d8-efd9-45a9-8adf-979879637dbe", // drift 0.92s (threshold 0.90s)
  "6962bb6f-c136-4c52-866b-a994835ef2d0", // drift 2.32s — audio pre-normalised above
];

async function main() {
  console.log("=== Subtitle repair run ===\n");

  for (const id of CONTENT_IDS) {
    console.log(`[${id.slice(0, 8)}] Running short video assembly…`);
    const t0 = Date.now();
    const result = await runShortVideo(id);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (result.success) {
      console.log(`  status       : PASS (${result.subtitleStatus})`);
      console.log(`  healthScore  : ${result.subtitleHealthScore}/100`);
      console.log(`  videoPath    : ${result.videoPath}`);
      console.log(`  elapsed      : ${elapsed}s`);
      console.log(`  readyToPublish: YES — reset upload_queue status manually to re-queue`);
    } else {
      console.log(`  status       : FAIL`);
      console.log(`  error        : ${result.error}`);
      console.log(`  elapsed      : ${elapsed}s`);
    }
    console.log();
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
