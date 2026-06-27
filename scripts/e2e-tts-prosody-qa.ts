/**
 * e2e-tts-prosody-qa.ts
 *
 * End-to-end TTS prosody QA for phat_phap with updated script prompt.
 * Generates 3 scripts → VieNeu TTS (loudnorm-only) → measure pauses.
 *
 * SAFE: no DB writes, no queue, no publish, no video render.
 * Previews saved to: media/qa/final-tts-prosody/
 *
 * Run:
 *   OPENROUTER_API_KEY="sk-or-..." npx tsx scripts/e2e-tts-prosody-qa.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";

import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { runScriptEngine, validateShortScriptProsody } from "@/lib/script-engine";
import { DEFAULT_SHORT_PROMPT } from "@/lib/content-prompts";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH = ffmpegInstaller.path;
const execFileAsync = promisify(execFile);

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const TTS_VOICE = "Ly"; // phat_phap default
const QA_DIR = path.join(process.cwd(), "media", "qa", "final-tts-prosody");
const POLL_INTERVAL_MS = 12_000;
const MAX_WAIT_MS = 15 * 60 * 1000;

// ─── 3 topic families ──────────────────────────────────────────────────────────
const TESTS: Array<{ family: string; topic: string; hook: string }> = [
  {
    family: "nhan_qua_nguoi_xau_bao_ung",
    topic: "Nhân quả trả về người làm điều xấu",
    hook: "Có những người đã làm ta tổn thương — nhưng cuộc đời không để họ đi mãi không trả giá.",
  },
  {
    family: "buong_bo_chua_lanh",
    topic: "Buông bỏ để tâm được chữa lành",
    hook: "Ta cứ giữ mãi những vết thương cũ, không phải vì chúng chưa lành — mà vì ta chưa dám buông.",
  },
  {
    family: "tri_tue_song_im_lang_nhan_nhin",
    topic: "Trí tuệ của im lặng và nhẫn nhịn trong đời sống",
    hook: "Người khôn ngoan nhất trong phòng thường là người ít nói nhất.",
  },
];

// ─── Helpers (replicated from tts.ts — no DB, no side effects) ────────────────

function normalizeTextForTTS(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/(nh\p{L}*),\s*(nh)/gu, "$1. $2")
    .trim();
}

function buildTextHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

async function applyLoudnormOnly(inputPath: string, outputPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", inputPath,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    tempPath,
  ], { timeout: 120_000 });
  fs.renameSync(tempPath, outputPath);
}

async function getAudioDurationSec(audioPath: string): Promise<number | null> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", audioPath, "-f", "null", "-",
    ], { timeout: 15_000 }).catch(e => e as { stderr?: string });
    const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(
      (result as { stderr?: string }).stderr ?? ""
    );
    if (!m) return null;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch { return null; }
}

async function countSilenceSegs(audioPath: string, minDurSec: number): Promise<number> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", audioPath,
      "-af", `silencedetect=noise=-50dB:d=${minDurSec}`,
      "-f", "null", "-",
    ], { timeout: 15_000 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";
    return (stderr.match(/silence_end/g) ?? []).length;
  } catch { return -1; }
}

async function submitTTS(text: string, contentId: string): Promise<string> {
  const res = await fetch(`${TTS_API_URL}/tts/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content_id: contentId, voice: TTS_VOICE }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`TTS submit failed (${res.status}): ${await res.text()}`);
  const { job_id } = await res.json() as { job_id: string };
  return job_id;
}

async function pollTTS(jobId: string): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${TTS_API_URL}/tts/status/${jobId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const status = await res.json() as {
      status: string; path?: string; error?: string;
    };
    if (status.status === "done") {
      if (!status.path) throw new Error("TTS done but no path");
      // Resolve container path to host path
      const containerAudioDir = process.env.TTS_CONTAINER_AUDIO_DIR ?? null;
      const hostAudioDir = path.join(process.cwd(), "media", "audio");
      let hostPath = status.path;
      if (containerAudioDir && status.path.startsWith(containerAudioDir)) {
        const rel = status.path.slice(containerAudioDir.length).replace(/^\/+/, "");
        hostPath = path.join(hostAudioDir, rel);
      }
      if (!fs.existsSync(hostPath)) throw new Error(`TTS file not found: ${hostPath}`);
      return hostPath;
    }
    if (status.status === "error") throw new Error(status.error ?? "TTS failed");
    process.stdout.write(".");
  }
  throw new Error("TTS timeout");
}

type TestResult = {
  family: string;
  topic: string;
  sentenceCount: number;
  avgWordsPerSentence: number;
  maxSentenceWords: number;
  totalCommas: number;
  prosodyWarnings: number;
  pauses150: number;
  pauses300: number;
  durationSec: number | null;
  previewFile: string;
  scriptSample: string;
  rewriteCount: number;
};

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(QA_DIR, { recursive: true });
  const client = getOpenRouterClient();
  const model = "openai/gpt-4o-mini";

  console.log("═".repeat(70));
  console.log("  E2E TTS PROSODY QA — phat_phap (3 topic families)");
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Voice: ${TTS_VOICE}  Mode: loudnorm-only  Injection: OFF`);
  console.log(`  Output: ${QA_DIR}`);
  console.log("═".repeat(70));
  console.log();

  const results: TestResult[] = [];

  for (const [i, tc] of TESTS.entries()) {
    console.log(`\n[${ i + 1}/3] ${tc.family}`);
    console.log(`  Topic: ${tc.topic}`);

    // ── Step 1: Generate script ─────────────────────────────────────────────
    console.log("  [1/4] Generating script...");
    const scriptOut = await runScriptEngine({
      client,
      model,
      topic: tc.topic,
      nicheName: "Phật Pháp",
      selectedHook: tc.hook,
      contentProfileKey: "buddhism",
      mode: "short",
      shortBasePrompt: DEFAULT_SHORT_PROMPT,
    });
    if (scriptOut.mode !== "short") throw new Error("Unexpected mode");
    const { result: scriptResult } = scriptOut;
    const qa = scriptResult.prosodyQa;
    const script = scriptResult.script;

    console.log(`  → script OK (rewrites=${scriptResult.rewriteCount}  sentences=${qa.sentenceCount}  avg=${qa.avgWordsPerSentence}w/s  max=${qa.maxSentenceWords}w  commas=${qa.totalCommas}  warnings=${qa.prosodyWarnings.length})`);
    if (qa.prosodyWarnings.length > 0) {
      for (const w of qa.prosodyWarnings) console.log(`     ⚠ ${w}`);
    }

    // ── Step 2: Normalize text and submit TTS ───────────────────────────────
    const ttsText = normalizeTextForTTS(script);
    const contentId = `qa-e2e-${tc.family}-${buildTextHash(ttsText).slice(0, 8)}`;
    const rawAudioHostPath = path.join(process.cwd(), "media", "audio", `${contentId}.wav`);

    console.log(`  [2/4] Submitting TTS (id=${contentId})...`);

    // Reuse cached raw file if exists (idempotent)
    let rawPath: string;
    if (fs.existsSync(rawAudioHostPath)) {
      console.log("  → raw TTS cache hit, reusing");
      rawPath = rawAudioHostPath;
    } else {
      const jobId = await submitTTS(ttsText, contentId);
      console.log(`  → job_id=${jobId}, polling`);
      process.stdout.write("  ");
      rawPath = await pollTTS(jobId);
      process.stdout.write("\n");
      console.log(`  → raw TTS done: ${rawPath}`);
      // Cache raw file
      if (!fs.existsSync(rawAudioHostPath)) {
        fs.mkdirSync(path.dirname(rawAudioHostPath), { recursive: true });
        fs.copyFileSync(rawPath, rawAudioHostPath);
      }
    }

    // ── Step 3: Apply loudnorm-only ─────────────────────────────────────────
    console.log("  [3/4] Applying loudnorm-only normalization...");
    const normalizedPath = path.join(QA_DIR, `${tc.family}.wav`);
    await applyLoudnormOnly(rawPath, normalizedPath);
    console.log(`  → loudnorm done: ${normalizedPath}`);

    // ── Step 4: Measure pauses and duration ─────────────────────────────────
    console.log("  [4/4] Measuring pauses...");
    const [durationSec, pauses150, pauses300] = await Promise.all([
      getAudioDurationSec(normalizedPath),
      countSilenceSegs(normalizedPath, 0.15),
      countSilenceSegs(normalizedPath, 0.30),
    ]);
    console.log(`  → duration=${durationSec?.toFixed(1) ?? "?"}s  pauses_150ms=${pauses150}  pauses_300ms=${pauses300}`);

    // Script sample (first 3 sentences)
    const scriptSample = script
      .split(/(?<=[.!?…])\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(" ");

    results.push({
      family: tc.family,
      topic: tc.topic,
      sentenceCount: qa.sentenceCount,
      avgWordsPerSentence: qa.avgWordsPerSentence,
      maxSentenceWords: qa.maxSentenceWords,
      totalCommas: qa.totalCommas,
      prosodyWarnings: qa.prosodyWarnings.length,
      pauses150,
      pauses300,
      durationSec,
      previewFile: path.relative(process.cwd(), normalizedPath),
      scriptSample,
      rewriteCount: scriptResult.rewriteCount,
    });
  }

  // ─── FINAL REPORT ──────────────────────────────────────────────────────────
  console.log("\n\n" + "═".repeat(70));
  console.log("## Script Prosody QA");
  console.log("═".repeat(70));
  console.log();

  for (const r of results) {
    console.log(`  [${r.family}]`);
    console.log(`  Topic     : ${r.topic}`);
    console.log(`  Sentences : ${r.sentenceCount}  avg=${r.avgWordsPerSentence}w/s  max=${r.maxSentenceWords}w  commas=${r.totalCommas}  warnings=${r.prosodyWarnings}`);
    console.log(`  Rewrites  : ${r.rewriteCount}`);
    console.log(`  Sample    : "${r.scriptSample.slice(0, 120)}…"`);
    console.log();
  }

  console.log("═".repeat(70));
  console.log("## Audio QA");
  console.log("═".repeat(70));
  console.log();

  const hdr = [
    "topic_family".padEnd(40),
    "avg w/s".padStart(8),
    "max w".padStart(6),
    "commas".padStart(7),
    "p150".padStart(5),
    "p300".padStart(5),
    "dur(s)".padStart(7),
    "preview".padEnd(45),
  ].join("  ");
  console.log("  " + hdr);
  console.log("  " + "─".repeat(hdr.length));

  for (const r of results) {
    const row = [
      r.family.padEnd(40),
      String(r.avgWordsPerSentence).padStart(8),
      String(r.maxSentenceWords).padStart(6),
      String(r.totalCommas).padStart(7),
      String(r.pauses150).padStart(5),
      String(r.pauses300).padStart(5),
      (r.durationSec?.toFixed(1) ?? "?").padStart(7),
      r.previewFile.padEnd(45),
    ].join("  ");
    console.log("  " + row);
  }

  // ─── Recommendation ────────────────────────────────────────────────────────
  const avgP150 = results.reduce((a, r) => a + r.pauses150, 0) / results.length;
  const avgP300 = results.reduce((a, r) => a + r.pauses300, 0) / results.length;
  const avgWps = results.reduce((a, r) => a + r.avgWordsPerSentence, 0) / results.length;

  console.log();
  console.log("═".repeat(70));
  console.log("## Recommendation");
  console.log("═".repeat(70));
  console.log();
  console.log(`  avg pauses_150ms : ${avgP150.toFixed(1)}/script  (native prosody test baseline: ~4.0)`);
  console.log(`  avg pauses_300ms : ${avgP300.toFixed(1)}/script  (native prosody test baseline: ~2.0)`);
  console.log(`  avg words/s      : ${avgWps.toFixed(1)}w/s  (pre-rule baseline: ~17+w/s)`);
  console.log();

  if (avgP150 >= 4) {
    console.log("  ✅ VieNeu natural prosody is healthy (≥4 pauses >150ms per script).");
  } else if (avgP150 >= 2) {
    console.log("  ⚠️  VieNeu natural prosody is moderate (2–4 pauses >150ms). Sentences may still be too long.");
  } else {
    console.log("  ❌ VieNeu natural prosody is weak (<2 pauses >150ms). Script structure needs review.");
  }

  if (avgWps <= 13) {
    console.log("  ✅ Script sentence length rule working well (avg ≤13w/s).");
  } else if (avgWps <= 15) {
    console.log("  ✅ Script sentence length acceptable (avg 13–15w/s).");
  } else {
    console.log("  ⚠️  Script sentence length above target (avg >15w/s). Prompt rules may need reinforcement.");
  }

  console.log();
  console.log(`  Preview files saved to: ${QA_DIR}`);
  console.log();
  console.log("═".repeat(70));
  console.log();

  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
