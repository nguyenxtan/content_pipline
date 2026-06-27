/**
 * Verify Kinetic Text V1.1 typography polish.
 *
 * Renders 3 clean samples using the exact content examples from the spec:
 *   1. "Có những người / không rời đi / họ chỉ / im lặng dần"
 *   2. "Không phải / ta hết buồn / chỉ là / đã quen rồi"
 *   3. "Càng lớn / ta càng ít nói / không phải vì ổn / mà vì mệt"
 *
 * Each sample gets a fresh fal.ai background (no ghost text from old renders).
 *
 * Safety: upload_queue rows created = 0 | DB mutations = 0 | Uploads = 0
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { fal } from "@fal-ai/client";
import fs from "fs";
import path from "path";

import {
  buildQuoteShortImagePrompt,
  type ImagePromptContext,
} from "@/lib/pipeline/quote-short-pipeline";
import {
  renderLegacyQuoteShort,
  type KineticTextSidecar,
} from "@/lib/legacy-quote-short-generator";
import { callWithRetry } from "@/lib/llm/retry";

fal.config({ credentials: process.env.FAL_KEY });

const OUTPUT_DIR = path.join(process.cwd(), "output", "kinetic-text-v1-1-verify");
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

function pickMusic(seed: string): string {
  const files = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|wav)$/i.test(f)).sort();
  if (!files.length) throw new Error("No music files in " + MUSIC_DIR);
  const idx = Array.from(seed).reduce((s, c) => s + (c.codePointAt(0) ?? 0), 0) % files.length;
  return path.join("media", "music", "phat-phap", files[idx]!);
}

async function generateImage(contentId: string, topic: string): Promise<string> {
  const prompt = buildQuoteShortImagePrompt(topic, TANG_SAU_CTX);
  console.log(`    prompt: ${prompt.slice(0, 90)}…`);
  fs.mkdirSync(IMAGE_SUBDIR, { recursive: true });
  const dest = path.join(IMAGE_SUBDIR, `${contentId}-bg.jpg`);
  const result = await callWithRetry(
    () => fal.run(FAL_MODEL, { input: { prompt, image_size: FAL_IMAGE_SIZE, num_inference_steps: FAL_STEPS, num_images: 1, enable_safety_checker: false } }) as unknown as Promise<FalResult>,
    { label: `kt_v11_${contentId}`, baseDelayMs: 2_000 },
  );
  const url = result.data?.images?.[0]?.url;
  if (!url) throw new Error("No fal.ai URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

type SampleSpec = {
  topic: string;
  kineticText: KineticTextSidecar;
  label: string;
};

const SAMPLES: SampleSpec[] = [
  {
    label: "Sample 1 — Có những người / không rời đi",
    topic: "Có những người nói rất nhiều nhưng không ai thật sự hiểu họ",
    kineticText: {
      chunks: [
        { text: "Có những người", emphasis: false, size: "medium" },
        { text: "không rời đi", emphasis: true, size: "large" },
        { text: "họ chỉ", emphasis: false, size: "small" },
        { text: "im lặng dần.", emphasis: true, size: "xlarge" },
      ],
      accentWords: ["không rời đi", "im lặng dần."],
    },
  },
  {
    label: "Sample 2 — Không phải / ta hết buồn",
    topic: "Có những đêm ta không buồn, chỉ thấy mình trống",
    kineticText: {
      chunks: [
        { text: "Không phải", emphasis: false, size: "medium" },
        { text: "ta hết buồn", emphasis: true, size: "large" },
        { text: "chỉ là", emphasis: false, size: "small" },
        { text: "đã quen rồi.", emphasis: true, size: "xlarge" },
      ],
      accentWords: ["ta hết buồn", "đã quen rồi."],
    },
  },
  {
    label: "Sample 3 — Càng lớn / ta càng ít nói",
    topic: "Điều mệt nhất không phải bận rộn mà là không còn cảm thấy mình đang sống",
    kineticText: {
      chunks: [
        { text: "Càng lớn", emphasis: false, size: "small" },
        { text: "ta càng ít nói.", emphasis: true, size: "large" },
        { text: "không phải vì ổn", emphasis: false, size: "medium" },
        { text: "mà vì mệt.", emphasis: true, size: "xlarge" },
      ],
      accentWords: ["ta càng ít nói.", "mà vì mệt."],
    },
  },
];

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Kinetic Text V1.1 — Visual Verification");
  console.log("  Safety: upload_queue rows = 0 | DB mutations = 0 | Uploads = 0");
  console.log("══════════════════════════════════════════════════════════════\n");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let ok = 0;

  for (const spec of SAMPLES) {
    const contentId = `kt-v11-${Date.now().toString(36)}`;
    console.log(`\n▶ ${spec.label}`);
    console.log(`  contentId: ${contentId}`);
    console.log(`  accentWords: [${spec.kineticText.accentWords.join(", ")}]`);
    console.log(`  chunks: ${spec.kineticText.chunks.map((c) => `(${c.size}${c.emphasis ? "*" : ""} "${c.text}")`).join(" → ")}`);

    try {
      console.log("  Generating fal.ai image…");
      const imgPath = await generateImage(contentId, spec.topic);

      console.log("  Rendering video…");
      const meta = await renderLegacyQuoteShort({
        contentId,
        topic: spec.topic,
        sourceImagePath: imgPath,
        quoteText: spec.kineticText.chunks.map((c) => c.text).join(" "),
        kineticText: spec.kineticText,
        durationSec: 9,
        musicPath: pickMusic(contentId),
        channelName: "Tầng Sâu",
        channelProfileId: "tang_sau_v1",
        workspaceId: "tang_sau_workspace",
        channelKey: "tang_sau",
        contentProfileKey: "philosophy",
        experimentId: "LEGACY_QUOTE_SHORT",
        experimentVariant: "LEGACY_QUOTE_KINETIC_TEXT_V1",
        visualMode: "kinetic_typography",
        quoteStyle: "kinetic_quote",
        visualMood: "editorial_stillness",
        musicMood: "ambient_reflection",
        outputDir: OUTPUT_DIR,
      });

      console.log(`  ✓ video:   ${meta.videoPath}`);
      console.log(`  ✓ thumb:   ${meta.renderedImagePath}`);
      console.log(`  ✓ sidecar: ${meta.metadataPath}`);
      console.log(`  ✓ variant: ${meta.experimentVariant}`);
      console.log(`  ✓ visualMode: ${meta.visualMode}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${e instanceof Error ? e.message : e}`);
    }

    await new Promise<void>((r) => setTimeout(r, 60));
  }

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  Renders: ${ok}/3`);
  console.log(`  upload_queue rows created: 0`);
  console.log(`  DB mutations: 0`);
  console.log(`  Uploads: 0`);
  if (ok < 3) process.exit(1);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
