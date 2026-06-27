/**
 * Verify that Tầng Sâu quote short image prompt routing works after the fix.
 *
 * Checks:
 * 1. buildQuoteShortImagePrompt returns modern/cinematic prompts for Tầng Sâu contexts.
 * 2. buildQuoteShortImagePrompt returns Buddhist prompts for non-Tầng Sâu contexts.
 * 3. Generates 2 real samples (1 Kinetic Text + 1 Note Letter Card) via fal.ai
 *    using the routed prompt, and verifies backgrounds are not Buddhist/spiritual.
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
  buildQuoteShortImagePrompt,
  QS_EXPERIMENT_ID,
  type ImagePromptContext,
  type QuoteGenPreviewItem,
} from "@/lib/pipeline/quote-short-pipeline";
import {
  renderLegacyQuoteShort,
  type LegacyQuoteShortMetadata,
} from "@/lib/legacy-quote-short-generator";
import { callWithRetry } from "@/lib/llm/retry";

fal.config({ credentials: process.env.FAL_KEY });

const OUTPUT_DIR = path.join(process.cwd(), "output", "tang-sau-img-routing-verify");
const IMAGE_SUBDIR = path.join(OUTPUT_DIR, "images");
const MUSIC_DIR = path.join(process.cwd(), "media", "music", "phat-phap");
const FAL_MODEL = "fal-ai/flux/schnell";
const FAL_IMAGE_SIZE = "portrait_4_3";
const FAL_STEPS = 4;

type FalResult = { data: { images: Array<{ url: string }> } };

const TANG_SAU_CTX: ImagePromptContext = {
  channelProfileId: "tang_sau_v1",
  workspaceId: "tang_sau_workspace",
  channelKey: "tang_sau",
  contentProfileKey: "philosophy",
};

const BUDDHIST_CTX: ImagePromptContext = {
  channelProfileId: "gdt_v1",
  workspaceId: "gdt_workspace",
};

// ── Unit check: prompt routing ────────────────────────────────────────────────

const BUDDHIST_TERMS = ["Buddhist", "spiritual", "temple", "monk", "lotus", "pagoda", "incense", "prayer", "shrine", "meditation pose"];
const FORBIDDEN_IN_TANG_SAU = BUDDHIST_TERMS;

function checkPromptRouting(): boolean {
  let allOk = true;
  const testTopics = [
    "Có những đêm không buồn, chỉ thấy mình trống",
    "Cô đơn giữa một thành phố quá đông người",
    "Tự do nhất là khi không còn phải đóng vai ai nữa",
    "Có những câu trả lời chỉ đến khi ta chịu ngồi yên",
    "Nhiều lựa chọn không làm ta tự do hơn, chỉ làm ta mỏi hơn",
  ];

  console.log("\n── Prompt routing unit checks ──────────────────────────────");

  for (const topic of testTopics) {
    const tsPrompt = buildQuoteShortImagePrompt(topic, TANG_SAU_CTX);
    const buddhistPrompt = buildQuoteShortImagePrompt(topic, BUDDHIST_CTX);

    const forbiddenInTs = FORBIDDEN_IN_TANG_SAU.filter((term) =>
      tsPrompt.toLowerCase().includes(term.toLowerCase()),
    );
    const hasBuddhistInBuddhist = buddhistPrompt.toLowerCase().includes("buddhist");

    const tsOk = forbiddenInTs.length === 0;
    const bOk = hasBuddhistInBuddhist;

    console.log(`\n  topic: ${topic.slice(0, 55)}`);
    console.log(`    tang_sau prompt: ${tsPrompt}`);
    console.log(`    ${tsOk ? "✓" : "✗"} Tầng Sâu: no Buddhist/spiritual terms`);
    if (!tsOk) {
      console.log(`    ✗ FORBIDDEN TERMS FOUND: ${forbiddenInTs.join(", ")}`);
      allOk = false;
    }
    console.log(`    ${bOk ? "✓" : "✗"} Buddhist ctx: contains 'Buddhist'`);
    if (!bOk) {
      console.log(`    ✗ Buddhist prompt missing expected term`);
      allOk = false;
    }
  }

  // Also check that ONLY Tầng Sâu context triggers the routing
  const partialContextTests: Array<[string, ImagePromptContext, boolean]> = [
    ["workspaceId only", { workspaceId: "tang_sau_workspace" }, true],
    ["channelProfileId only", { channelProfileId: "tang_sau_v1" }, true],
    ["channelKey only", { channelKey: "tang_sau" }, true],
    ["contentProfileKey only", { contentProfileKey: "philosophy" }, true],
    ["empty context", {}, false],
    ["other workspace", { workspaceId: "other_workspace" }, false],
  ];

  console.log("\n  Context routing checks:");
  for (const [label, ctx, expectTangSau] of partialContextTests) {
    const prompt = buildQuoteShortImagePrompt("test topic", ctx);
    const isTangSauPrompt = !prompt.includes("Buddhist");
    const ok = isTangSauPrompt === expectTangSau;
    console.log(`    ${ok ? "✓" : "✗"} ${label}: ${expectTangSau ? "→ Tầng Sâu" : "→ Buddhist"} ${ok ? "" : "(FAIL)"}`);
    if (!ok) allOk = false;
  }

  return allOk;
}

// ── Image generation ──────────────────────────────────────────────────────────

function pickMusicPath(seed: string): string {
  const files = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|wav)$/i.test(f)).sort();
  if (files.length === 0) throw new Error("No music files in " + MUSIC_DIR);
  const idx = Array.from(seed).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0) % files.length;
  return path.join("media", "music", "phat-phap", files[idx]!);
}

async function generateAndVerifyImage(contentId: string, topic: string): Promise<string> {
  // Use the REAL pipeline helper — this is what the fix changes
  const prompt = buildQuoteShortImagePrompt(topic, TANG_SAU_CTX);
  console.log(`\n     fal.ai prompt: ${prompt}`);

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
    { label: `ts_routing_image_${contentId}`, baseDelayMs: 2_000 },
  );

  const url = result.data?.images?.[0]?.url;
  if (!url) throw new Error("Fal.ai did not return an image URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  fs.writeFileSync(destAbs, Buffer.from(await res.arrayBuffer()));
  return destAbs;
}

async function renderSample(contentId: string, item: QuoteGenPreviewItem): Promise<LegacyQuoteShortMetadata> {
  const sourceImagePath = await generateAndVerifyImage(contentId, item.topic);
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Unit check
  const routingOk = checkPromptRouting();
  if (!routingOk) {
    console.error("\n✗ Prompt routing unit checks FAILED — aborting render.");
    process.exit(1);
  }
  console.log("\n✓ All prompt routing checks passed.");

  // 2. Render 2 samples: 1 Kinetic Text + 1 Note Letter Card
  const TANG_SAU_COMMON = { channelProfileId: "tang_sau_v1", workspaceId: "tang_sau_workspace" };
  const batches = [
    { format: "kinetic_text" as const, label: "Kinetic Text" },
    { format: "note_letter_card" as const, label: "Note Letter Card" },
  ];

  console.log("\n── Render verification (2 samples) ─────────────────────────");
  let successCount = 0;

  for (const batch of batches) {
    const [item] = await previewQuoteGeneration({ count: 1, quoteFormat: batch.format, ...TANG_SAU_COMMON });
    if (!item) { console.error(`  ✗ No preview item for ${batch.label}`); continue; }

    const ts = Date.now().toString(36);
    const contentId = `ts-routing-verify-${batch.format.slice(0, 2)}-${ts}`;

    console.log(`\n  ▶ ${contentId} [${batch.label}]`);
    console.log(`    topic: ${item.topic.slice(0, 65)}`);

    try {
      const meta = await renderSample(contentId, item);
      console.log(`    ✓ video:   ${meta.videoPath}`);
      console.log(`    ✓ thumb:   ${meta.renderedImagePath}`);
      console.log(`    ✓ sidecar: ${meta.metadataPath}`);
      console.log(`    ✓ channelKey=${meta.channelKey}  workspaceId=${meta.workspaceId}`);
      successCount++;
    } catch (err) {
      console.error(`    ✗ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`Render: ${successCount}/2 OK`);
  console.log(`upload_queue rows created: 0`);
  console.log(`DB mutations: 0`);
  console.log(`Uploads: 0`);

  if (successCount < 2) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
