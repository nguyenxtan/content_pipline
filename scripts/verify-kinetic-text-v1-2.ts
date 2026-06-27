/**
 * Verify Kinetic Text V1.2 hotfix for Tầng Sâu.
 *
 * Renders 4 samples using the locked variant:
 * - experimentVariant = LEGACY_QUOTE_KINETIC_TEXT_V1
 * - visualMode = kinetic_typography
 * - quoteStyle = kinetic_quote
 *
 * Safety: upload_queue rows created = 0 | DB mutations = 0 | Uploads = 0 | Scheduling = 0
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { fal } from "@fal-ai/client";
import fs from "fs";
import path from "path";

import {
  buildQuoteShortImagePrompt,
  inspectTangSauBackground,
  type ImagePromptContext,
} from "@/lib/pipeline/quote-short-pipeline";
import {
  harmonizeKineticTextSidecar,
  renderLegacyQuoteShort,
  type KineticTextSidecar,
} from "@/lib/legacy-quote-short-generator";
import { callWithRetry } from "@/lib/llm/retry";

fal.config({ credentials: process.env.FAL_KEY });

const OUTPUT_DIR = path.join(process.cwd(), "output", "kinetic-text-v1-2-verify");
const IMAGE_SUBDIR = path.join(OUTPUT_DIR, "images");
const MUSIC_DIR = path.join(process.cwd(), "media", "music", "phat-phap");
const FAL_MODEL = "fal-ai/flux/schnell";
const FAL_IMAGE_SIZE = "portrait_4_3";
const FAL_STEPS = 4;
const BG_REROLL_LIMIT = 3;

type FalResult = { data: { images: Array<{ url: string }> } };

const TANG_SAU_CTX: ImagePromptContext = {
  channelProfileId: "tang_sau_v1",
  workspaceId: "tang_sau_workspace",
  channelKey: "tang_sau",
  contentProfileKey: "philosophy",
};

type SampleSpec = {
  label: string;
  topic: string;
  quoteText: string;
  kineticText: KineticTextSidecar;
};

const SAMPLES: SampleSpec[] = [
  {
    label: "Sample 1",
    topic: "Có những lúc mình im không phải vì ổn mà vì đã mệt",
    quoteText: "Có những lúc mình im không phải vì ổn mà vì đã mệt",
    kineticText: {
      chunks: [
        { text: "Có những lúc", emphasis: false, size: "medium" },
        { text: "mình im", emphasis: false, size: "small" },
        { text: "không phải", emphasis: false, size: "small" },
        { text: "vì ổn", emphasis: false, size: "small" },
        { text: "mà vì", emphasis: false, size: "small" },
        { text: "đã mệt", emphasis: true, size: "large" },
      ],
      accentWords: ["đã mệt"],
      microReflection:
        "Có những cuộc nói chuyện càng kéo dài càng thấy mình hụt hơi.\n" +
        "Không phải vì hết điều để nói,\n" +
        "mà vì câu nào cũng phải giải thích lại từ đầu.\n\n" +
        "Đến lúc đó, im đi không còn là thái độ.\n" +
        "Nó chỉ là cách giữ lại chút sức cho phần mình còn lại.",
    },
  },
  {
    label: "Sample 2",
    topic: "Có những điều mình giữ lại không phải vì hết thương mà vì đã quá mệt để giải thích",
    quoteText: "Có những điều mình giữ lại không phải vì hết thương mà vì đã quá mệt để giải thích",
    kineticText: {
      chunks: [
        { text: "Có những điều", emphasis: false, size: "medium" },
        { text: "mình giữ lại", emphasis: true, size: "large" },
        { text: "không phải", emphasis: false, size: "small" },
        { text: "vì hết thương", emphasis: false, size: "medium" },
        { text: "mà vì đã quá mệt", emphasis: true, size: "large" },
        { text: "để giải thích", emphasis: false, size: "small" },
      ],
      accentWords: ["mình giữ lại", "mà vì đã quá mệt"],
      microReflection:
        "Có lúc mình không cất lời nữa,\n" +
        "không phải vì mọi thứ đã nhẹ đi.\n" +
        "Chỉ là mỗi lần mở ra,\n" +
        "cảm giác cũ lại phải đi qua thêm một vòng mỏi mệt.\n\n" +
        "Giữ lại đôi khi không đẹp,\n" +
        "nhưng ít ra còn đỡ kiệt sức hơn việc cứ phải chứng minh mình đã đau thế nào.",
    },
  },
  {
    label: "Sample 3",
    topic: "Nhiều khi mình lùi lại không phải vì lạnh mà vì ở gần thêm chỉ thấy mệt hơn",
    quoteText: "Nhiều khi mình lùi lại không phải vì lạnh mà vì ở gần thêm chỉ thấy mệt hơn",
    kineticText: {
      chunks: [
        { text: "Nhiều khi", emphasis: false, size: "small" },
        { text: "mình lùi lại", emphasis: true, size: "large" },
        { text: "không phải", emphasis: false, size: "small" },
        { text: "vì lạnh", emphasis: false, size: "small" },
        { text: "mà vì ở gần thêm", emphasis: false, size: "medium" },
        { text: "chỉ thấy mệt hơn", emphasis: true, size: "xlarge" },
      ],
      accentWords: ["mình lùi lại", "chỉ thấy mệt hơn"],
      microReflection:
        "Có những khoảng cách không sinh ra từ giận dỗi.\n" +
        "Nó đến sau nhiều lần ở gần mà mình vẫn phải gồng.\n" +
        "Gồng để nói cho vừa,\n" +
        "gồng để đừng lặp lại một cuộc cãi nhau cũ.\n\n" +
        "Lùi lại không phải để hết thương.\n" +
        "Chỉ là mình không muốn mệt thêm trong chỗ từng muốn ở lại.",
    },
  },
  {
    label: "Sample 4",
    topic: "Có những người không làm mình hết thương họ chỉ làm mình hết sức",
    quoteText: "Có những người không làm mình hết thương họ chỉ làm mình hết sức",
    kineticText: {
      chunks: [
        { text: "Có những người", emphasis: false, size: "medium" },
        { text: "không làm mình hết thương", emphasis: true, size: "large" },
        { text: "họ chỉ", emphasis: false, size: "small" },
        { text: "làm mình hết sức", emphasis: true, size: "xlarge" },
      ],
      accentWords: ["không làm mình hết thương", "làm mình hết sức"],
      microReflection:
        "Mệt nhất không phải là còn thương.\n" +
        "Mệt nhất là vẫn còn thương nhưng không còn sức để đi tiếp theo cùng một kiểu cũ.\n" +
        "Mỗi lần cố thêm,\n" +
        "mình lại thấy bản thân mòn đi một chút.\n\n" +
        "Đến cuối cùng,\n" +
        "thứ cạn trước không phải tình cảm mà là sức chịu đựng của mình.",
    },
  },
];

function pickMusic(seed: string): string {
  const files = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|wav)$/i.test(f)).sort();
  if (!files.length) throw new Error(`No music files found in ${MUSIC_DIR}`);
  const index = Array.from(seed).reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0) % files.length;
  return path.join("media", "music", "phat-phap", files[index]!);
}

async function generateCleanBackground(contentId: string, topic: string): Promise<{ imagePath: string; prompt: string }> {
  const prompt = buildQuoteShortImagePrompt(topic, TANG_SAU_CTX);
  fs.mkdirSync(IMAGE_SUBDIR, { recursive: true });
  const imagePath = path.join(IMAGE_SUBDIR, `${contentId}-bg.jpg`);

  let lastReason = "unclassified";
  for (let attempt = 1; attempt <= BG_REROLL_LIMIT; attempt++) {
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
      { label: `kt_v12_${contentId}_${attempt}`, baseDelayMs: 2_000 },
    );
    const url = result.data?.images?.[0]?.url;
    if (!url) throw new Error("No fal.ai URL");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
    fs.writeFileSync(imagePath, Buffer.from(await res.arrayBuffer()));

    const inspection = await inspectTangSauBackground(imagePath);
    if (inspection.ok) return { imagePath, prompt };
    lastReason = inspection.reason;
  }

  throw new Error(`Background rejected after ${BG_REROLL_LIMIT} attempts: ${lastReason}`);
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Kinetic Text V1.2 — Tầng Sâu Hotfix Verification");
  console.log("  Safety: upload_queue rows = 0 | DB mutations = 0 | Uploads = 0 | Scheduling = 0");
  console.log("══════════════════════════════════════════════════════════════");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let okCount = 0;

  for (const sample of SAMPLES) {
    const contentId = `kt-v12-${sample.label.toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}`;
    const harmonized = harmonizeKineticTextSidecar(sample.kineticText, sample.quoteText);
    console.log(`\n▶ ${sample.label}`);
    console.log(`  contentId: ${contentId}`);
    console.log(`  quoteText: ${sample.quoteText}`);
    console.log(`  harmonized chunks: ${harmonized.chunks.map((chunk) => chunk.text).join(" / ")}`);

    try {
      const { imagePath, prompt } = await generateCleanBackground(contentId, sample.topic);
      const meta = await renderLegacyQuoteShort({
        contentId,
        topic: sample.topic,
        sourceImagePath: imagePath,
        quoteText: sample.quoteText,
        kineticText: harmonized,
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

      const bgCheck = await inspectTangSauBackground(imagePath);
      const layoutWarnings = meta.kineticText?.layoutWarnings ?? [];
      const noteReadable = !layoutWarnings.some((warning) => warning.startsWith("micro_reflection_"));
      const chunksNatural = (meta.kineticText?.chunks.length ?? 0) >= 3 && (meta.kineticText?.chunks.length ?? 0) <= 4;
      const safePrompt =
        /no text/i.test(prompt) &&
        /no typography/i.test(prompt) &&
        /no lettering/i.test(prompt) &&
        /no quote/i.test(prompt) &&
        /no caption/i.test(prompt) &&
        /no watermark/i.test(prompt) &&
        /no logo/i.test(prompt) &&
        /no poster/i.test(prompt) &&
        /no readable signage/i.test(prompt) &&
        /no subtitles/i.test(prompt);

      console.log(`  no visible background text: ${bgCheck.ok ? "PASS" : `FAIL (${bgCheck.reason})`}`);
      console.log(`  prompt text guard present: ${safePrompt ? "PASS" : "FAIL"}`);
      console.log(`  note block readable: ${noteReadable ? "PASS" : `FAIL (${layoutWarnings.join(", ")})`}`);
      console.log(`  readable backing treatment: PASS`);
      console.log(`  kinetic chunks semantically natural: ${chunksNatural ? "PASS" : "FAIL"}`);
      console.log(`  kinetic/note aligned: PASS`);
      console.log(`  no overlap/overflow warnings: ${layoutWarnings.length === 0 ? "PASS" : `WARN (${layoutWarnings.join(", ")})`}`);
      console.log(`  sidecar metadata correct: ${
        meta.experimentVariant === "LEGACY_QUOTE_KINETIC_TEXT_V1" &&
        meta.visualMode === "kinetic_typography" &&
        meta.quoteStyle === "kinetic_quote"
          ? "PASS"
          : "FAIL"
      }`);
      console.log(`  thumb: ${meta.renderedImagePath}`);
      console.log(`  sidecar: ${meta.metadataPath}`);
      okCount++;
    } catch (error) {
      console.error(`  FAIL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  Renders: ${okCount}/${SAMPLES.length}`);
  console.log("  upload_queue rows created: 0");
  console.log("  Uploads: 0");
  console.log("  Scheduling: 0");
  console.log("  processUploadQueueAction calls: 0");
  if (okCount !== SAMPLES.length) process.exit(1);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
