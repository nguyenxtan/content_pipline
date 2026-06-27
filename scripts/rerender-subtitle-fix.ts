import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { runShortVideo } from "@/lib/pipeline/short-video";

async function main() {
  const id = "eea488b9-f909-4fb9-a6a0-b570d0d011a0";
  console.log("Re-rendering:", id);
  console.log("Topic: Nỗi sợ bị ruồng bỏ");
  console.log("Applying: fade-only animation, size 72, max 5 words/chunk, cross-platform fontsdir");
  const t0 = Date.now();
  const result = await runShortVideo(id);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (!result.success) {
    console.error("✗ Render failed:", result.error);
    process.exit(1);
  }

  console.log("\n✓ Render success");
  console.log("  videoPath:          ", result.videoPath);
  console.log("  durationMs:         ", result.durationMs);
  console.log("  subtitleStatus:     ", result.subtitleStatus);
  console.log("  subtitleHealthScore:", result.subtitleHealthScore);
  console.log("  elapsed:            ", elapsed + "s");

  const m = result.subtitleMetadata;
  console.log("\n  Subtitle metadata:");
  console.log("    playRes:                  ", `${m.playResX}×${m.playResY}`);
  console.log("    fontFamily:               ", m.fontFamily);
  console.log("    fontSize:                 ", m.fontSize);
  console.log("    marginV:                  ", m.marginV);
  console.log("    maxLineChars (est):       ", m.maxLineChars);
  console.log("    burnStage:                ", m.burnStage);
  console.log("    hasLateScaleAfterSubtitle:", m.hasLateScaleAfterSubtitle);
  console.log("    validationResult:         ", m.validationResult);
  if (m.validationErrors.length > 0) {
    console.log("    validationErrors:");
    for (const e of m.validationErrors) console.log("      -", e);
  }
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
