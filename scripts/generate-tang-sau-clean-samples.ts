/**
 * Generate clean Tầng Sâu Text Style Pack V1 samples through the normal
 * quote generation path (previewQuoteGeneration + fal.ai fresh images).
 *
 * This script does NOT use old rendered thumbnails as source images.
 * Each sample gets a brand-new fal.ai-generated background.
 *
 * Safety: No upload_queue mutations. No DB writes. No schedule. No media deletion.
 * upload_queue rows created = 0.
 */

import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fal } from "@fal-ai/client";

config({ path: ".env.local" });
config();

import {
  previewQuoteGeneration,
  type QuoteGenBatchOptions,
  type QuoteGenPreviewItem,
  QS_EXPERIMENT_ID,
} from "@/lib/pipeline/quote-short-pipeline";
import {
  renderLegacyQuoteShort,
  getLegacyQuoteVisualKeywords,
  type LegacyQuoteShortMetadata,
} from "@/lib/legacy-quote-short-generator";
import { callWithRetry } from "@/lib/llm/retry";

// ── Config ────────────────────────────────────────────────────────────────────

fal.config({ credentials: process.env.FAL_KEY });

const OUTPUT_DIR = path.join(process.cwd(), "output", "tang-sau-style-pack-v1-clean");
const IMAGE_SUBDIR = path.join(OUTPUT_DIR, "images");
const MUSIC_DIR = path.join(process.cwd(), "media", "music", "phat-phap");
const FAL_MODEL = "fal-ai/flux/schnell";
const FAL_IMAGE_SIZE = "portrait_4_3";
const FAL_STEPS = 4;

const TANG_SAU_COMMON: Pick<QuoteGenBatchOptions, "channelProfileId" | "workspaceId"> = {
  channelProfileId: "tang_sau_v1",
  workspaceId: "tang_sau_workspace",
};

type FalResult = { data: { images: Array<{ url: string }> } };

// ── Music selection (filesystem, no DB required) ───────────────────────────────

function pickMusicPath(seed: string): string {
  const files = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => /\.(mp3|m4a|wav)$/i.test(f))
    .sort();
  if (files.length === 0) throw new Error("No music files in " + MUSIC_DIR);
  const idx =
    Array.from(seed).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0) % files.length;
  return path.join("media", "music", "phat-phap", files[idx]!);
}

// ── Fal.ai image generation (fresh background, no old thumbnails) ─────────────

async function generateFreshImage(contentId: string, topic: string): Promise<string> {
  const keywords = getLegacyQuoteVisualKeywords(topic);
  // Tầng Sâu: modern cinematic aesthetic, not Buddhist imagery
  const prompt = [
    keywords.slice(0, 3).join(", "),
    "modern cinematic scene, quiet urban environment, solitary figure, soft natural light",
    "no text, no watermark, portrait orientation, editorial photography style, muted tones",
  ].join(", ");

  fs.mkdirSync(IMAGE_SUBDIR, { recursive: true });
  const destAbs = path.join(IMAGE_SUBDIR, `${contentId}-bg.jpg`);

  const result = await callWithRetry(
    () =>
      fal.run(FAL_MODEL, {
        input: {
          prompt,
          image_size: FAL_IMAGE_SIZE,
          num_inference_steps: FAL_STEPS,
          num_images: 1,
          enable_safety_checker: false,
        },
      }) as unknown as Promise<FalResult>,
    { label: `tang_sau_image_${contentId}`, baseDelayMs: 2_000 },
  );

  const url = result.data?.images?.[0]?.url;
  if (!url) throw new Error("Fal.ai did not return an image URL");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  fs.writeFileSync(destAbs, Buffer.from(await res.arrayBuffer()));

  // Return relative path (same convention as generateSingleItem in pipeline)
  return destAbs;
}

// ── Render one item ───────────────────────────────────────────────────────────

function makeContentId(prefix: string, idx: number): string {
  const ts = Date.now().toString(36);
  return `ts-clean-${prefix}-${idx + 1}-${ts}`;
}

async function renderItem(
  contentId: string,
  item: QuoteGenPreviewItem,
): Promise<LegacyQuoteShortMetadata> {
  const sourceImagePath = await generateFreshImage(contentId, item.topic);
  const musicPath = pickMusicPath(contentId);

  return renderLegacyQuoteShort({
    contentId,
    topic: item.topic,
    topicFamily: item.topicFamily,
    sourceImagePath,
    quoteText: item.mainQuote,
    reflectionText: item.reflectionText,
    noteLetterText: item.noteLetterText,
    englishLine: item.englishLine,
    kineticText: item.kineticText,
    musicPath,
    channelName: "Tầng Sâu",
    channelProfileId: item.channelProfileId,
    workspaceId: item.workspaceId,
    channelKey: item.channelKey,
    contentProfileKey: item.contentProfileKey,
    experimentId: QS_EXPERIMENT_ID,
    experimentVariant: item.experimentVariant,
    visualMode: item.visualMode,
    quoteStyle: item.quoteStyle,
    visualMood: item.visualMood,
    musicMood: item.musicMood,
    outputDir: OUTPUT_DIR,
  });
}

// ── Verification helpers ──────────────────────────────────────────────────────

function verifySidecar(
  meta: LegacyQuoteShortMetadata,
  item: QuoteGenPreviewItem,
): string[] {
  const checks: Array<[string, boolean]> = [
    ["formatType=legacy_quote_short", meta.formatType === "legacy_quote_short"],
    ["experimentId=LEGACY_QUOTE_SHORT", meta.experimentId === QS_EXPERIMENT_ID],
    [`experimentVariant=${item.experimentVariant}`, meta.experimentVariant === item.experimentVariant],
    [`visualMode=${item.visualMode}`, meta.visualMode === item.visualMode],
    [`quoteStyle=${item.quoteStyle}`, meta.quoteStyle === item.quoteStyle],
    ["workspaceId=tang_sau_workspace", meta.workspaceId === "tang_sau_workspace"],
    ["channelProfileId=tang_sau_v1", meta.channelProfileId === "tang_sau_v1"],
    ["channelKey=tang_sau", meta.channelKey === "tang_sau"],
    ["contentProfileKey=philosophy", meta.contentProfileKey === "philosophy"],
  ];
  return checks.filter(([, ok]) => !ok).map(([label]) => label);
}

// ── Batch definitions ─────────────────────────────────────────────────────────

type BatchDef = { label: string; prefix: string; opts: QuoteGenBatchOptions };

const BATCHES: BatchDef[] = [
  {
    label: "Note Letter Card (2)",
    prefix: "nl",
    opts: { count: 2, quoteFormat: "note_letter_card", ...TANG_SAU_COMMON },
  },
  {
    label: "Kinetic Text (2)",
    prefix: "kt",
    opts: { count: 2, quoteFormat: "kinetic_text", ...TANG_SAU_COMMON },
  },
  {
    label: "Bilingual Minimal (2)",
    prefix: "bi",
    opts: { count: 2, quoteFormat: "bilingual_minimal", ...TANG_SAU_COMMON },
  },
  {
    label: "Quote + Reflection (1)",
    prefix: "rc",
    opts: { count: 1, quoteFormat: "quote_reflection", ...TANG_SAU_COMMON },
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

type Result = {
  contentId: string;
  label: string;
  ok: boolean;
  videoPath?: string;
  sidecarPath?: string;
  thumbPath?: string;
  failedChecks?: string[];
  error?: string;
};

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(IMAGE_SUBDIR, { recursive: true });

  const results: Result[] = [];
  let successCount = 0;
  let failCount = 0;

  for (const batch of BATCHES) {
    console.log(`\n▶▶ Generating preview items: ${batch.label}`);
    let previewItems: QuoteGenPreviewItem[];
    try {
      previewItems = await previewQuoteGeneration(batch.opts);
      console.log(`   ${previewItems.length} items generated by LLM`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ✗ previewQuoteGeneration failed: ${msg}`);
      failCount++;
      results.push({ contentId: `${batch.prefix}-preview-fail`, label: batch.label, ok: false, error: msg });
      continue;
    }

    for (let i = 0; i < previewItems.length; i++) {
      const item = previewItems[i]!;
      const contentId = makeContentId(batch.prefix, i);

      console.log(`\n   ▶ Rendering ${contentId} [${item.experimentVariant}]`);
      console.log(`     topic: ${item.topic.slice(0, 65)}`);

      try {
        const meta = await renderItem(contentId, item);
        const failedChecks = verifySidecar(meta, item);

        console.log(`     ✓ video:    ${meta.videoPath}`);
        console.log(`     ✓ thumb:    ${meta.renderedImagePath}`);
        console.log(`     ✓ duration: ${meta.durationSec}s`);
        console.log(`     ✓ audio:    mean=${meta.audioValidation.meanVolumeDb?.toFixed(1)}dB`);

        if (failedChecks.length > 0) {
          console.log(`     ✗ sidecar checks FAILED: ${failedChecks.join(", ")}`);
        } else {
          console.log(`     ✓ sidecar fields all OK`);
        }

        results.push({
          contentId,
          label: batch.label,
          ok: failedChecks.length === 0,
          videoPath: meta.videoPath,
          sidecarPath: meta.metadataPath,
          thumbPath: meta.renderedImagePath,
          failedChecks: failedChecks.length > 0 ? failedChecks : undefined,
        });
        successCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`     ✗ ERROR: ${msg}`);
        results.push({ contentId, label: batch.label, ok: false, error: msg });
        failCount++;
      }

      // Tiny pause so makeContentId timestamps stay distinct
      await new Promise<void>((r) => setTimeout(r, 50));
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`Generated: ${successCount} OK   ${failCount} FAIL`);
  console.log(`Output dir: ${OUTPUT_DIR}`);

  console.log("\nResults:");
  for (const r of results) {
    const icon = r.ok ? "✓" : "✗";
    console.log(`\n  ${icon} ${r.contentId}  [${r.label}]`);
    if (r.videoPath) console.log(`      video:  ${r.videoPath}`);
    if (r.sidecarPath) console.log(`      sidecar: ${r.sidecarPath}`);
    if (r.thumbPath) console.log(`      thumb:  ${r.thumbPath}`);
    if (r.failedChecks) console.log(`      sidecar FAIL: ${r.failedChecks.join(", ")}`);
    if (r.error) console.log(`      error: ${r.error}`);
  }

  console.log("\nupload_queue rows created: 0");
  console.log("DB mutations: 0");
  console.log("Uploads: 0");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
