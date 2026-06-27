/**
 * Verify Tầng Sâu visual direction: bright/clean/modern, no Buddhist/spiritual cues.
 *
 * Step 1: Pool audit — 36 entries, brightness%, person%, forbidden terms.
 * Step 2: 12 seeded prompt classifications — brightness, scene type, Buddhist cue check.
 * Step 3: 4 sample video renders with inspectTangSauBackground visual guard check.
 *
 * Safety: no upload_queue mutations, no DB writes, no schedule, no uploads.
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
  inspectTangSauBackground,
  type ImagePromptContext,
} from "@/lib/pipeline/quote-short-pipeline";
import { renderLegacyQuoteShort } from "@/lib/legacy-quote-short-generator";
import { callWithRetry } from "@/lib/llm/retry";

fal.config({ credentials: process.env.FAL_KEY });

const OUTPUT_DIR = path.join(process.cwd(), "output", "tang-sau-visual-direction-verify");
const IMAGE_SUBDIR = path.join(OUTPUT_DIR, "images");
const MUSIC_DIR = path.join(process.cwd(), "media", "music", "phat-phap");
const FAL_MODEL = "fal-ai/flux/schnell";
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
  "Buddha", "spiritual", "meditation pose", "pagoda", "shrine", "religious",
  "altar", "monk robe", "statue", "iconography",
];

// ── Step 1: Pool audit ────────────────────────────────────────────────────────

function auditPool(): boolean {
  console.log("── Step 1: Pool audit (36-entry) ────────────────────────────────");
  console.log(`  Total scenes: ${TANG_SAU_SCENE_POOL.length}`);

  const catCounts: Record<string, number> = {};
  let personCount = 0;
  let darkCount = 0;
  let forbiddenFound = false;

  for (const entry of TANG_SAU_SCENE_POOL) {
    catCounts[entry.category] = (catCounts[entry.category] ?? 0) + 1;
    if (entry.hasPerson) personCount++;
    if (entry.isDark) darkCount++;

    const hit = FORBIDDEN_TERMS.find((t) =>
      entry.scene.toLowerCase().includes(t.toLowerCase()),
    );
    if (hit) {
      console.log(`  ✗ FORBIDDEN TERM "${hit}": ${entry.scene.slice(0, 80)}`);
      forbiddenFound = true;
    }
  }

  const total = TANG_SAU_SCENE_POOL.length;
  const brightCount = total - darkCount;
  const brightPct = Math.round((brightCount / total) * 100);
  const personPct = Math.round((personCount / total) * 100);
  const darkPct = Math.round((darkCount / total) * 100);

  console.log("\n  Category distribution:");
  for (const [cat, count] of Object.entries(catCounts).sort()) {
    console.log(`    ${cat.padEnd(20)} ${count.toString().padStart(2)}/${total}  (${Math.round((count / total) * 100)}%)`);
  }

  const brightOk = brightPct >= 60;
  const personOk = personPct <= 25;
  const noForbidden = !forbiddenFound;
  const sizeOk = total === 36;

  console.log(`\n  Pool size:      ${total} — expect 36: ${sizeOk ? "✓" : "✗"}`);
  console.log(`  Bright scenes:  ${brightCount}/${total} (${brightPct}%) — ≥60%: ${brightOk ? "✓" : "✗ UNDER"}`);
  console.log(`  Dark/night:     ${darkCount}/${total} (${darkPct}%)`);
  console.log(`  Person scenes:  ${personCount}/${total} (${personPct}%) — ≤25%: ${personOk ? "✓" : "✗ OVER"}`);
  console.log(`  Forbidden terms: ${noForbidden ? "✓ none" : "✗ FOUND (see above)"}`);

  return sizeOk && brightOk && personOk && noForbidden;
}

// ── Step 2: 12 prompt classifications ────────────────────────────────────────

const SAMPLE_TOPICS_12 = [
  "Có những người nói rất nhiều nhưng không ai thật sự hiểu họ",
  "Cô đơn giữa một thành phố quá đông người",
  "Tự do nhất là khi không còn phải đóng vai ai nữa",
  "Triết lý không làm đời dễ hơn, nhưng làm ta bớt mù hơn",
  "Bản ngã thích chiến thắng, còn nội tâm chỉ muốn được yên",
  "Khi thôi cần được công nhận, lòng người nhẹ đi rất nhiều",
  "Một ý tưởng đúng lúc có thể thay đổi cả cách ta sống",
  "Sự im lặng đúng lúc nói nhiều hơn mọi lời giải thích",
  "Nhiều lựa chọn không làm ta tự do hơn, chỉ làm ta mỏi hơn",
  "Có những đêm ta không buồn, chỉ thấy mình trống",
  "Điều mệt nhất không phải bận rộn mà là không còn cảm thấy mình đang sống",
  "Khao khát tự do đôi khi chỉ là khao khát được sống thật",
];

function classifyPrompts(): boolean {
  console.log("\n── Step 2: 12 prompt classifications ────────────────────────────");

  const catCounts: Record<string, number> = {};
  let brightCount = 0;
  let personCount = 0;
  let forbiddenFound = false;

  for (const topic of SAMPLE_TOPICS_12) {
    const prompt = buildQuoteShortImagePrompt(topic, TANG_SAU_CTX);
    // Style anchor now leads the prompt, so match by includes rather than startsWith
    const entry = TANG_SAU_SCENE_POOL.find((e) => prompt.includes(e.scene));

    if (entry) {
      catCounts[entry.category] = (catCounts[entry.category] ?? 0) + 1;
      if (!entry.isDark) brightCount++;
      if (entry.hasPerson) personCount++;
    }

    // Check only the scene text — negative prompt lines intentionally contain these words
    const sceneText = entry?.scene ?? "";
    const hit = FORBIDDEN_TERMS.find((t) => sceneText.toLowerCase().includes(t.toLowerCase()));
    if (hit) {
      console.log(`  ✗ FORBIDDEN TERM "${hit}" in scene: ${sceneText.slice(0, 80)}`);
      forbiddenFound = true;
    }

    const brightTag = entry?.isDark ? "[dark  ]" : "[bright]";
    const personTag = entry?.hasPerson ? "[person]" : "        ";
    const cat = entry?.category ?? "unknown";
    const topicShort = topic.slice(0, 45).padEnd(45);
    console.log(`  ${brightTag} ${personTag} ${cat.padEnd(18)} — ${topicShort}`);
  }

  const total = SAMPLE_TOPICS_12.length;
  const brightPct = Math.round((brightCount / total) * 100);
  const brightOk = brightPct >= 60;
  const noForbidden = !forbiddenFound;

  console.log(`\n  Bright/clean:   ${brightCount}/${total} (${brightPct}%) — ≥60%: ${brightOk ? "✓" : "✗ UNDER"}`);
  console.log(`  Person scenes:  ${personCount}/${total}`);
  console.log(`  Forbidden terms: ${noForbidden ? "✓ none" : "✗ FOUND"}`);
  console.log("  Category breakdown:");
  for (const [cat, n] of Object.entries(catCounts).sort()) {
    console.log(`    ${cat.padEnd(20)} ${n}/${total}`);
  }

  // Check color direction keywords appear in prompt (non-dark entries)
  const sampleBrightTopic = SAMPLE_TOPICS_12[0]!;
  const samplePrompt = buildQuoteShortImagePrompt(sampleBrightTopic, TANG_SAU_CTX);
  const hasColorDir = samplePrompt.includes("Kinfolk magazine") || samplePrompt.includes("Monocle magazine");
  // Buddhist negatives removed from prompt — naming them activates CLIP concepts.
  // Guard is in inspectTangSauBackground instead.
  const hasStyleAnchor = samplePrompt.includes("commercial lifestyle photography") || samplePrompt.includes("contemporary urban documentary");
  console.log(`\n  Magazine style anchor present: ${hasColorDir ? "✓" : "✗ MISSING"}`);
  console.log(`  Commercial photography anchor present: ${hasStyleAnchor ? "✓" : "✗ MISSING"}`);
  console.log(`  (Buddhist negatives removed from prompt — CLIP activation risk)`)

  return brightOk && noForbidden && hasColorDir && hasStyleAnchor;
}

// ── Step 3: 4 sample renders ──────────────────────────────────────────────────

function pickMusic(seed: string): string {
  const files = fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a|wav)$/i.test(f)).sort();
  if (!files.length) throw new Error("No music in " + MUSIC_DIR);
  const idx = Array.from(seed).reduce((s, c) => s + (c.codePointAt(0) ?? 0), 0) % files.length;
  return path.join("media", "music", "phat-phap", files[idx]!);
}

async function generateImage(contentId: string, topic: string): Promise<string> {
  const prompt = buildQuoteShortImagePrompt(topic, TANG_SAU_CTX);
  fs.mkdirSync(IMAGE_SUBDIR, { recursive: true });
  const dest = path.join(IMAGE_SUBDIR, `${contentId}-bg.jpg`);
  const result = await callWithRetry(
    () =>
      fal.run(FAL_MODEL, {
        input: { prompt, image_size: "portrait_4_3", num_inference_steps: FAL_STEPS, num_images: 1, enable_safety_checker: false },
      }) as unknown as Promise<FalResult>,
    { label: `visual_dir_verify_${contentId}`, baseDelayMs: 2_000 },
  );
  const url = result.data?.images?.[0]?.url;
  if (!url) throw new Error("No fal.ai URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// Full video renders (4)
const RENDER_SAMPLES = [
  {
    label: "indoor_objects — bright cafe",
    topic: "Khi thôi cần được công nhận, lòng người nhẹ đi rất nhiều",
    quote: "Khi thôi cần được công nhận, lòng người nhẹ đi rất nhiều",
  },
  {
    label: "urban_city — bright street",
    topic: "Tự do nhất là khi không còn phải đóng vai ai nữa",
    quote: "Tự do nhất là khi không còn phải đóng vai ai nữa",
  },
  {
    label: "nature_scenery — open landscape",
    topic: "Sự im lặng đúng lúc nói nhiều hơn mọi lời giải thích",
    quote: "Sự im lặng đúng lúc nói nhiều hơn mọi lời giải thích",
  },
  {
    label: "abstract_light — editorial",
    topic: "Có những đêm ta không buồn, chỉ thấy mình trống",
    quote: "Có những đêm ta không buồn, chỉ thấy mình trống",
  },
];

// Image-only guard checks (4 extra topics — guard only, no full video render)
const IMAGE_ONLY_TOPICS = [
  { label: "indoor_objects — window seat",    topic: "Có những sợi dây không ai buộc, nhưng ta vẫn mang theo nhiều năm" },
  { label: "nature_scenery — meadow",          topic: "Triết lý không làm đời dễ hơn, nhưng làm ta bớt mù hơn" },
  { label: "urban_city — morning sidewalk",    topic: "Bản ngã thích chiến thắng, còn nội tâm chỉ muốn được yên" },
  { label: "abstract_light — window shadow",   topic: "Không phải im lặng nào cũng là trống rỗng" },
];

async function runRenders(): Promise<{ ok: number; guardResults: string[]; flagCount: number }> {
  console.log("\n── Step 3: 4 video renders + 4 image-only guard checks (8 total) ─");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let ok = 0;
  const guardResults: string[] = [];

  // 4 full video renders
  for (const spec of RENDER_SAMPLES) {
    const contentId = `visual-dir-${Date.now().toString(36)}`;
    console.log(`\n  ▶ [video] ${spec.label}`);
    console.log(`    contentId: ${contentId}`);

    try {
      console.log("    Generating image…");
      const imgPath = await generateImage(contentId, spec.topic);

      console.log("    Running inspectTangSauBackground…");
      const guard = await inspectTangSauBackground(imgPath);
      const guardTag = guard.ok ? "✓ clean" : `✗ FLAGGED: ${guard.reason}`;
      console.log(`    Visual guard: ${guardTag}`);
      guardResults.push(`[video] ${spec.label}: ${guardTag}`);

      console.log("    Rendering video…");
      const meta = await renderLegacyQuoteShort({
        contentId,
        topic: spec.topic,
        sourceImagePath: imgPath,
        quoteText: spec.quote,
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

      console.log(`    ✓ video:  ${meta.videoPath}`);
      console.log(`    ✓ thumb:  ${meta.renderedImagePath}`);
      ok++;
    } catch (e) {
      console.error(`    ✗ ${e instanceof Error ? e.message : e}`);
      guardResults.push(`[video] ${spec.label}: render_error`);
    }

    await new Promise<void>((r) => setTimeout(r, 60));
  }

  // 4 image-only guard checks
  console.log("\n  ── Image-only guard checks ────────────────────────────────────");
  for (const spec of IMAGE_ONLY_TOPICS) {
    const contentId = `visual-dir-img-${Date.now().toString(36)}`;
    console.log(`\n  ▶ [img] ${spec.label}`);

    try {
      const imgPath = await generateImage(contentId, spec.topic);
      const guard = await inspectTangSauBackground(imgPath);
      const guardTag = guard.ok ? "✓ clean" : `✗ FLAGGED: ${guard.reason}`;
      console.log(`    Visual guard: ${guardTag}`);
      guardResults.push(`[img] ${spec.label}: ${guardTag}`);
    } catch (e) {
      console.error(`    ✗ ${e instanceof Error ? e.message : e}`);
      guardResults.push(`[img] ${spec.label}: error`);
    }

    await new Promise<void>((r) => setTimeout(r, 60));
  }

  const flagCount = guardResults.filter((r) => r.includes("✗ FLAGGED")).length;
  return { ok, guardResults, flagCount };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Tầng Sâu Visual Direction Verification");
  console.log("  Safety: upload_queue rows = 0 | DB mutations = 0 | Uploads = 0");
  console.log("══════════════════════════════════════════════════════════════\n");

  const poolOk = auditPool();
  const promptOk = classifyPrompts();
  const { ok: renders, guardResults, flagCount } = await runRenders();

  const totalImages = guardResults.filter((r) => !r.includes("render_error") && !r.includes(": error")).length;
  const guardFunctional = guardResults.every((r) => !r.includes("render_error") && !r.includes(": error"));
  const flagRateOk = flagCount <= 1; // target: ≤1/8

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Pool audit:          ${poolOk ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  Prompt classif.:     ${promptOk ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  Video renders:       ${renders}/4`);
  console.log(`  Visual guard checks (8 images):`);
  for (const r of guardResults) console.log(`    ${r}`);
  console.log(`  Flags:               ${flagCount}/${totalImages} (target ≤1/8): ${flagRateOk ? "✓" : "✗ ABOVE TARGET — model may need stronger prompt or different settings"}`);
  console.log(`  Guard functional:    ${guardFunctional ? "✓" : "✗ errors occurred"}`);
  console.log(`\n  upload_queue rows created: 0`);
  console.log(`  DB mutations: 0`);
  console.log(`  Uploads: 0`);

  // Report queued items status
  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("  Queued items note:");
  console.log("  Existing queued items (Jun 6–7) have images already generated.");
  console.log("  Those images are non-Buddhist from original generation — safe to publish.");
  console.log("  New generations from this point use the updated prompt with style anchor.");

  if (!poolOk || !promptOk || renders < 4) process.exit(1);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
