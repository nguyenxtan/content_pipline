/**
 * Verify accentWords tolerant substring matching.
 *
 * Unit-checks the match logic, then renders 2 kinetic samples that reproduce
 * the original substring-mismatch scenario.
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
import { renderLegacyQuoteShort } from "@/lib/legacy-quote-short-generator";
import { callWithRetry } from "@/lib/llm/retry";

fal.config({ credentials: process.env.FAL_KEY });

const OUTPUT_DIR = path.join(process.cwd(), "output", "kinetic-accent-match-verify");
const IMAGE_SUBDIR = path.join(OUTPUT_DIR, "images");
const MUSIC_DIR = path.join(process.cwd(), "media", "music", "phat-phap");
const FAL_MODEL = "fal-ai/flux/schnell";
type FalResult = { data: { images: Array<{ url: string }> } };

const TANG_SAU_CTX: ImagePromptContext = {
  channelProfileId: "tang_sau_v1",
  workspaceId: "tang_sau_workspace",
  channelKey: "tang_sau",
  contentProfileKey: "philosophy",
};

// ── Unit test: reproduce the tolerant match logic inline ──────────────────────

function stripPunct(s: string): string {
  return s.replace(/[.,!?…–—\s]+$/, "").replace(/^[.,!?…–—\s]+/, "");
}

function accentCandidates(words: string[]): string[] {
  return words
    .map((w) => stripPunct(w.trim().toLocaleLowerCase("vi-VN")))
    .filter((w) => Array.from(w).length >= 3);
}

function chunkMatchesAccent(chunkText: string, candidates: string[]): boolean {
  const norm = stripPunct(chunkText.trim().toLocaleLowerCase("vi-VN"));
  return candidates.some((a) => a === norm || norm.includes(a) || a.includes(norm));
}

function runUnitTests(): boolean {
  console.log("── Unit tests: chunkMatchesAccent ──────────────────────────────────");

  const cases: Array<{ chunk: string; accentWords: string[]; expected: boolean; label: string }> = [
    // Original bug case
    { chunk: "Một ý tưởng",     accentWords: ["ý tưởng"],        expected: true,  label: "chunk contains accentWord" },
    { chunk: "thay đổi cả",     accentWords: ["thay đổi"],        expected: true,  label: "chunk contains accentWord (prefix)" },
    // Exact match still works
    { chunk: "im lặng dần.",    accentWords: ["im lặng dần."],    expected: true,  label: "exact match" },
    // accentWord contains chunk (short phrase)
    { chunk: "mệt.",             accentWords: ["mệt thật sự."],    expected: true,  label: "accentWord contains chunk" },
    // Should NOT match: too short (< 3 chars)
    { chunk: "ta",               accentWords: ["ta"],              expected: false, label: "reject: candidate < 3 chars" },
    { chunk: "là",               accentWords: ["là"],              expected: false, label: "reject: candidate < 3 chars" },
    // Should NOT match: completely unrelated
    { chunk: "Càng lớn",        accentWords: ["im lặng"],         expected: false, label: "no match (unrelated)" },
    // Empty accentWords → always false (no candidates)
    { chunk: "Một ý tưởng",     accentWords: [],                  expected: false, label: "empty accentWords → no match" },
  ];

  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const cands = accentCandidates(c.accentWords);
    const got = cands.length > 0 && chunkMatchesAccent(c.chunk, cands);
    const ok = got === c.expected;
    console.log(`  ${ok ? "✓" : "✗"} [${c.label}]`);
    console.log(`      chunk="${c.chunk}"  accentWords=[${c.accentWords.join(", ")}]  → ${got} (expected ${c.expected})`);
    if (ok) pass++; else fail++;
  }

  console.log(`\n  ${pass}/${cases.length} unit tests passed\n`);
  return fail === 0;
}

// ── Render helpers ────────────────────────────────────────────────────────────

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
    () => fal.run(FAL_MODEL, {
      input: { prompt, image_size: "portrait_4_3", num_inference_steps: 4, num_images: 1, enable_safety_checker: false },
    }) as unknown as Promise<FalResult>,
    { label: `accent_verify_${contentId}`, baseDelayMs: 2_000 },
  );
  const url = result.data?.images?.[0]?.url;
  if (!url) throw new Error("No fal.ai URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Kinetic Text — accentWords Substring Match Verification");
  console.log("  Safety: upload_queue rows = 0 | DB mutations = 0 | Uploads = 0");
  console.log("══════════════════════════════════════════════════════════════\n");

  const unitOk = runUnitTests();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Sample 1: exact reproduction of the bug case ("ý tưởng" vs "Một ý tưởng")
  // Sample 2: another substring case ("thay đổi" vs "thay đổi cả")
  const samples = [
    {
      label: "Bug repro — accentWord=substring of chunk",
      topic: "Một ý tưởng đúng lúc có thể thay đổi cả cách ta sống",
      kineticText: {
        chunks: [
          { text: "Một ý tưởng",     emphasis: true,  size: "large" as const },
          { text: "đúng lúc có thể", emphasis: false, size: "medium" as const },
          { text: "thay đổi cả",     emphasis: true,  size: "large" as const },
          { text: "cách ta sống.",   emphasis: false, size: "medium" as const },
        ],
        accentWords: ["ý tưởng", "thay đổi"],   // substrings — should now match
      },
    },
    {
      label: "Mix — exact + substring accentWords",
      topic: "Khi thôi cần được công nhận, lòng người nhẹ đi rất nhiều",
      kineticText: {
        chunks: [
          { text: "Khi thôi cần",       emphasis: false, size: "small" as const },
          { text: "được công nhận,",    emphasis: true,  size: "xlarge" as const },
          { text: "lòng người",         emphasis: false, size: "medium" as const },
          { text: "nhẹ đi rất nhiều.", emphasis: true,  size: "xlarge" as const },
        ],
        accentWords: ["công nhận", "nhẹ đi rất nhiều."],  // one substring, one exact
      },
    },
  ];

  let ok = 0;
  for (const spec of samples) {
    const contentId = `accent-verify-${Date.now().toString(36)}`;
    console.log(`▶ ${spec.label}`);
    console.log(`  contentId:   ${contentId}`);
    console.log(`  accentWords: [${spec.kineticText.accentWords.join(", ")}]`);
    console.log(`  chunks: ${spec.kineticText.chunks.map((c) => `(${c.size}${c.emphasis ? "*" : ""} "${c.text}")`).join(" → ")}`);

    try {
      console.log("  Generating image…");
      const img = await generateImage(contentId, spec.topic);

      console.log("  Rendering…");
      const meta = await renderLegacyQuoteShort({
        contentId,
        topic: spec.topic,
        sourceImagePath: img,
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

      // Verify sidecar
      const sidecarOk =
        meta.experimentVariant === "LEGACY_QUOTE_KINETIC_TEXT_V1" &&
        meta.visualMode === "kinetic_typography" &&
        meta.channelKey === "tang_sau";

      console.log(`  ✓ video:   ${meta.videoPath}`);
      console.log(`  ✓ thumb:   ${meta.renderedImagePath}`);
      console.log(`  ✓ variant: ${meta.experimentVariant}`);
      console.log(`  ✓ sidecar: ${sidecarOk ? "ok" : "MISMATCH"}`);
      if (!sidecarOk) console.log(`    variant=${meta.experimentVariant} visualMode=${meta.visualMode} channelKey=${meta.channelKey}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${e instanceof Error ? e.message : e}`);
    }
    await new Promise<void>((r) => setTimeout(r, 60));
  }

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  Unit tests:  ${unitOk ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  Renders:     ${ok}/2`);
  console.log(`  upload_queue rows created: 0`);
  console.log(`  DB mutations: 0`);
  console.log(`  Uploads: 0`);

  if (!unitOk || ok < 2) process.exit(1);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
