/**
 * TTS Repair Preview — GxR_7Ib73Nw artifact
 *
 * Tests two variants of the risky phrase to confirm/deny root cause
 * and produce a repaired audio preview. Does NOT touch DB, queue, or
 * any existing media files.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;
const WHISPER_PYTHON = "/Users/bichtuyen/venv-tts-new/bin/python3";
const WHISPER_SCRIPT = path.join(process.cwd(), "tts-server", "whisper_timestamps.py");

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const VOICE = "Ngoc"; // confirmed from cache filename ngoc.wav
const OUT_DIR = path.join(process.cwd(), "media", "_repair_preview");
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 5 * 60 * 1000;

// Full normalized short_content for GxR_7Ib73Nw — kept for reference
// const ORIGINAL_FULL_TEXT = `...`; // see audit-tts-artifact.ts for full text

// The risky phrase isolated for fast comparison
const RISKY_ISOLATED = `tiếng mưa rơi lộp độp trên mái nhà, như đang thì thầm những nỗi niềm sâu thẳm.`;

// Repaired isolated: split at "nhà," → "nhà. Âm thanh ấy như..."
const REPAIRED_ISOLATED = `tiếng mưa rơi lộp độp trên mái nhà. Âm thanh ấy như đang thì thầm những nỗi niềm sâu thẳm.`;

async function normalizeAudio(inputPath: string, outputPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", inputPath,
    "-af",
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05:stop_periods=-1:stop_threshold=-50dB:stop_duration=0.35:stop_silence=0.16:detection=rms,loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    tempPath,
  ], { timeout: 60_000 });
  fs.renameSync(tempPath, outputPath);
}

async function submitTTS(text: string, contentId: string): Promise<string> {
  const res = await fetch(`${TTS_API_URL}/tts/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content_id: contentId, voice: VOICE }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TTS submit failed (${res.status}): ${body}`);
  }
  const { job_id } = await res.json() as { job_id: string };
  return job_id;
}

function resolveLocalPath(filePath: string): string {
  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) return filePath;
  return path.join(process.cwd(), filePath.replace(/^\/+/, ""));
}

async function waitForTTS(jobId: string): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${TTS_API_URL}/tts/status/${jobId}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) continue;
    const status = await res.json() as { status: string; path?: string; error?: string };
    if (status.status === "done") {
      if (!status.path) throw new Error("TTS done but no path");
      return resolveLocalPath(status.path);
    }
    if (status.status === "error") throw new Error(status.error ?? "TTS failed");
    process.stdout.write(".");
  }
  throw new Error("TTS timeout");
}

async function runWhisperOnSegment(audioPath: string, label: string): Promise<void> {
  try {
    const result = await execFileAsync(WHISPER_PYTHON, [WHISPER_SCRIPT, audioPath], { timeout: 60_000 });
    const data = JSON.parse(result.stdout) as { success: boolean; words: Array<{ word: string; start: number; end: number }> };
    if (!data.success) {
      console.log(`  ${label}: Whisper failed`);
      return;
    }
    const elongated = data.words.filter(w => (w.end - w.start) > 0.5);
    if (elongated.length === 0) {
      console.log(`  ${label}: ✅ No elongated words (all < 0.5s)`);
    } else {
      for (const w of elongated) {
        const dur = (w.end - w.start).toFixed(3);
        console.log(`  ${label}: ⚠️  "${w.word}" ${w.start.toFixed(2)}s–${w.end.toFixed(2)}s (${dur}s) ELONGATED`);
      }
    }
  } catch (e) {
    console.log(`  ${label}: Whisper error: ${e}`);
  }
}

async function testVariant(label: string, text: string, outputBase: string): Promise<void> {
  console.log(`\n── Testing: ${label} ──`);
  console.log(`  text: "${text.slice(0, 80)}..."`);
  const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
  const rawPath = path.join(OUT_DIR, `${outputBase}-raw.wav`);
  const normPath = path.join(OUT_DIR, `${outputBase}-norm.wav`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("  Submitting to TTS...");
  const jobId = await submitTTS(text, `_repair_preview_${hash}`);
  console.log(`  job_id: ${jobId}`);
  process.stdout.write("  Polling");
  const rawAudioPath = await waitForTTS(jobId);
  console.log(`\n  Raw audio: ${rawAudioPath}`);

  // Copy raw output
  fs.copyFileSync(rawAudioPath, rawPath);
  const rawStat = fs.statSync(rawPath);
  console.log(`  Raw size: ${rawStat.size}B`);

  // Normalize
  await normalizeAudio(rawPath, normPath);
  const normStat = fs.statSync(normPath);
  console.log(`  Normalized: ${normPath} (${normStat.size}B)`);

  // Whisper analysis
  await runWhisperOnSegment(normPath, label);
}

async function main() {
  console.log("═══ TTS Repair Preview for GxR_7Ib73Nw artifact ═══");
  console.log(`Output dir: ${OUT_DIR}`);
  console.log(`Voice: ${VOICE}`);

  // Test 1: Original risky phrase (isolated)
  await testVariant("ORIGINAL isolated", RISKY_ISOLATED, "original-isolated");

  // Test 2: Repaired phrase (isolated, sentence split)
  await testVariant("REPAIRED isolated (sentence split)", REPAIRED_ISOLATED, "repaired-isolated");

  console.log("\n═══ Summary ═══");
  console.log(`  Original isolated: ${path.join(OUT_DIR, "original-isolated-norm.wav")}`);
  console.log(`  Repaired isolated: ${path.join(OUT_DIR, "repaired-isolated-norm.wav")}`);
  console.log(`  Compare 0–5s window of each to verify artifact removed.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
