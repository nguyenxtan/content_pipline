/**
 * Verify Tầng Sâu scene pool diversity and generate 4 clean visual samples.
 *
 * Step 1: Audit all 32 scene entries — forbidden terms, person%, dark%, categories.
 * Step 2: Check 20 seeded prompt selections over sample topics.
 * Step 3: Generate 4 real fal.ai samples (KT + BI + NL + RC) with fresh backgrounds.
 *
 * Safety: no upload_queue mutations, no DB writes, no schedule, no media deletion.
 * upload_queue rows created = 0.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { fal } from "@fal-ai/client";
import fs from "fs";
import path from "path";

import {
  TANG_SAU_SCENE_POOL,
  buildQuoteShortImagePrompt,
  previewQuoteGeneration,
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

const OUTPUT_DIR = path.join(process.cwd(), "output", "tang-sau-scene-pool-verify");
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

const FORBIDDEN_TERMS = [
  "Buddhist", "temple", "monk", "lotus", "incense", "prayer bead",
  "Buddha", "spiritual", "meditation pose", "pagoda", "shrine",
  "religious",
];

// ── Step 1: Pool audit ────────────────────────────────────────────────────────

function auditPool(): boolean {
  console.log("── Step 1: Scene pool audit ────────────────────────────────────");
  console.log(`  Total scenes: ${TANG_SAU_SCENE_POOL.length}`);

  const categoryCounts: Record<string, number> = {};
  let personCount = 0;
  let darkCount = 0;
  let forbiddenFound = false;

  for (const entry of TANG_SAU_SCENE_POOL) {
    categoryCounts[entry.category] = (categoryCounts[entry.category] ?? 0) + 1;
    if (entry.hasPerson) personCount++;
    if (entry.isDark) darkCount++;

    const hit = FORBIDDEN_TERMS.find((term) =>
      entry.scene.toLowerCase().includes(term.toLowerCase()),
    );
    if (hit) {
      console.log(`  ✗ FORBIDDEN TERM "${hit}" in: ${entry.scene}`);
      forbiddenFound = true;
    }
  }

  const total = TANG_SAU_SCENE_POOL.length;
  const personPct = Math.round((personCount / total) * 100);
  const darkPct = Math.round((darkCount / total) * 100);
  const notDarkPct = 100 - darkPct;

  console.log("\n  Category distribution:");
  for (const [cat, count] of Object.entries(categoryCounts).sort()) {
    console.log(`    ${cat.padEnd(20)} ${count.toString().padStart(2)}/${total}  (${Math.round((count / total) * 100)}%)`);
  }

  const personOk = personPct <= 25;
  const notDarkOk = notDarkPct >= 60;
  const noForbidden = !forbiddenFound;

  console.log(`\n  Person scenes:  ${personCount}/${total} (${personPct}%) — limit ≤25%: ${personOk ? "✓" : "✗ OVER"}`);
  console.log(`  Dark/night:     ${darkCount}/${total} (${darkPct}%)  — not-dark ≥60%: ${notDarkOk ? "✓" : "✗ UNDER"}`);
  console.log(`  Forbidden terms: ${noForbidden ? "✓ none found" : "✗ FOUND (see above)"}`);

  return personOk && notDarkOk && noForbidden;
}

// ── Step 2: Seeded prompt selection over 20 topics ────────────────────────────

const SAMPLE_TOPICS = [
  "Có những người nói rất nhiều nhưng không ai thật sự hiểu họ",
  "Cô đơn giữa một thành phố quá đông người",
  "Có những đêm ta không buồn, chỉ thấy mình trống",
  "Điều mệt nhất không phải bận rộn mà là không còn cảm thấy mình đang sống",
  "Tự do nhất là khi không còn phải đóng vai ai nữa",
  "Có những sợi dây không ai buộc, nhưng ta vẫn mang theo nhiều năm",
  "Triết lý không làm đời dễ hơn, nhưng làm ta bớt mù hơn",
  "Không phải im lặng nào cũng là trống rỗng",
  "Bản ngã thích chiến thắng, còn nội tâm chỉ muốn được yên",
  "Điều khó nhất không phải chọn đúng mà là dám chịu trách nhiệm",
  "Có khi ta sống quá lâu trong phiên bản người khác mong muốn",
  "Nhiều lựa chọn không làm ta tự do hơn, chỉ làm ta mỏi hơn",
  "Khi thôi cần được công nhận, lòng người nhẹ đi rất nhiều",
  "Có những cuốn sách không trả lời mà chỉ buộc ta nhìn lại mình",
  "Một ý tưởng đúng lúc có thể thay đổi cả cách ta sống",
  "Sách hay không dạy ta sống, chỉ giúp ta thôi sống hời hợt",
  "Có những câu trả lời chỉ đến khi ta chịu ngồi yên",
  "Sự im lặng đúng lúc nói nhiều hơn mọi lời giải thích",
  "Có những ngày ta cần khoảng lặng hơn là thêm lời khuyên",
  "Khao khát tự do đôi khi chỉ là khao khát được sống thật",
];

function auditSelectedPrompts(): boolean {
  console.log("\n── Step 2: 20 seeded prompt selections ─────────────────────────");

  const catCounts: Record<string, number> = {};
  let personCount = 0;
  let darkCount = 0;
  let forbiddenFound = false;

  for (const topic of SAMPLE_TOPICS) {
    const prompt = buildQuoteShortImagePrompt(topic, TANG_SAU_CTX);
    // Identify which entry was selected
    const entryIdx = TANG_SAU_SCENE_POOL.findIndex((e) => prompt.startsWith(e.scene));
    const entry = entryIdx >= 0 ? TANG_SAU_SCENE_POOL[entryIdx]! : null;

    if (entry) {
      catCounts[entry.category] = (catCounts[entry.category] ?? 0) + 1;
      if (entry.hasPerson) personCount++;
      if (entry.isDark) darkCount++;
    }

    const hit = FORBIDDEN_TERMS.find((t) => prompt.toLowerCase().includes(t.toLowerCase()));
    if (hit) { console.log(`  ✗ FORBIDDEN "${hit}": ${prompt.slice(0, 80)}`); forbiddenFound = true; }

    const cat = entry?.category ?? "unknown";
    const flags = `${entry?.hasPerson ? "[person]" : "       "} ${entry?.isDark ? "[dark]" : "      "}`;
    console.log(`  ${cat.padEnd(18)} ${flags}  ${prompt.slice(0, 70)}`);
  }

  const total = SAMPLE_TOPICS.length;
  const personPct = Math.round((personCount / total) * 100);
  const notDarkPct = Math.round(((total - darkCount) / total) * 100);

  console.log("\n  Category distribution over 20 selections:");
  for (const [cat, count] of Object.entries(catCounts).sort()) {
    console.log(`    ${cat.padEnd(20)} ${count}/${total}`);
  }

  const personOk = personPct <= 25;
  const notDarkOk = notDarkPct >= 60;
  console.log(`\n  Person: ${personCount}/${total} (${personPct}%) ≤25%: ${personOk ? "✓" : "✗"}`);
  console.log(`  Not dark: ${total - darkCount}/${total} (${notDarkPct}%) ≥60%: ${notDarkOk ? "✓" : "✗"}`);
  console.log(`  No forbidden terms: ${!forbiddenFound ? "✓" : "✗"}`);

  return personOk && notDarkOk && !forbiddenFound;
}

// ── Step 3: Generate 4 real samples ──────────────────────────────────────────

function pickMusic(seed: string): string {
  const files = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|wav)$/i.test(f)).sort();
  if (!files.length) throw new Error("No music in " + MUSIC_DIR);
  const idx = Array.from(seed).reduce((s, c) => s + (c.codePointAt(0) ?? 0), 0) % files.length;
  return path.join("media", "music", "phat-phap", files[idx]!);
}

async function generateImage(contentId: string, topic: string): Promise<string> {
  const prompt = buildQuoteShortImagePrompt(topic, TANG_SAU_CTX);
  console.log(`\n     prompt: ${prompt.slice(0, 90)}…`);
  fs.mkdirSync(IMAGE_SUBDIR, { recursive: true });
  const dest = path.join(IMAGE_SUBDIR, `${contentId}-bg.jpg`);
  const result = await callWithRetry(
    () => fal.run(FAL_MODEL, { input: { prompt, image_size: FAL_IMAGE_SIZE, num_inference_steps: FAL_STEPS, num_images: 1, enable_safety_checker: false } }) as unknown as Promise<FalResult>,
    { label: `scene_pool_${contentId}`, baseDelayMs: 2_000 },
  );
  const url = result.data?.images?.[0]?.url;
  if (!url) throw new Error("No fal.ai URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function renderSample(contentId: string, item: QuoteGenPreviewItem): Promise<LegacyQuoteShortMetadata> {
  const src = await generateImage(contentId, item.topic);
  return renderLegacyQuoteShort({
    contentId,
    topic: item.topic,
    topicFamily: item.topicFamily,
    sourceImagePath: src,
    quoteText: item.mainQuote,
    reflectionText: item.reflectionText,
    noteLetterText: item.noteLetterText,
    englishLine: item.englishLine,
    kineticText: item.kineticText,
    musicPath: pickMusic(contentId),
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

async function generateFourSamples(): Promise<boolean> {
  console.log("\n── Step 3: Generate 4 real samples ─────────────────────────────");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const TANG_SAU_COMMON = { channelProfileId: "tang_sau_v1", workspaceId: "tang_sau_workspace" };
  const batches: Array<{ format: "kinetic_text" | "bilingual_minimal" | "note_letter_card" | "quote_reflection"; label: string }> = [
    { format: "kinetic_text", label: "Kinetic Text (brighter urban/cafe)" },
    { format: "bilingual_minimal", label: "Bilingual Minimal (nature/scenery)" },
    { format: "note_letter_card", label: "Note Letter Card (desk/window/notebook)" },
    { format: "quote_reflection", label: "Reflection Card (blue-hour/soft daylight)" },
  ];

  let ok = 0;
  for (const batch of batches) {
    const [item] = await previewQuoteGeneration({ count: 1, quoteFormat: batch.format, ...TANG_SAU_COMMON });
    if (!item) { console.error(`  ✗ No preview item for ${batch.label}`); continue; }
    const contentId = `ts-pool-${batch.format.slice(0, 2)}-${Date.now().toString(36)}`;
    console.log(`\n  ▶ ${contentId}  [${batch.label}]`);
    console.log(`    topic: ${item.topic.slice(0, 65)}`);
    try {
      const meta = await renderSample(contentId, item);
      console.log(`    ✓ video:   ${meta.videoPath}`);
      console.log(`    ✓ thumb:   ${meta.renderedImagePath}`);
      console.log(`    ✓ sidecar: ${meta.metadataPath}`);
      ok++;
    } catch (e) {
      console.error(`    ✗ ${e instanceof Error ? e.message : e}`);
    }
    await new Promise<void>((r) => setTimeout(r, 60));
  }
  console.log(`\n  Renders: ${ok}/4 OK`);
  return ok === 4;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const poolOk = auditPool();
  const promptOk = auditSelectedPrompts();
  const renderOk = await generateFourSamples();

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`Pool audit:         ${poolOk ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`Prompt selections:  ${promptOk ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`4 sample renders:   ${renderOk ? "✓ PASS" : "✗ FAIL"}`);
  console.log("upload_queue rows created: 0");
  console.log("DB mutations: 0");
  console.log("Uploads: 0");

  if (!poolOk || !promptOk || !renderOk) process.exit(1);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
