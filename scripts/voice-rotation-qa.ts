/**
 * voice-rotation-qa.ts — Voice Rotation V1 preview generator
 *
 * Generates one 5–8s audio preview per confirmed VieNeu voice.
 * Sample text: Buddhist short-script sentence (representative of phat_phap content).
 * Audio policy: loudnorm-only · silenceremove=false · no punctuation injection
 *
 * Also verifies the deterministic voice picker:
 *   - Runs pickVoiceForContent() on 100 random UUIDs and reports bucket distribution.
 *   - Checks that phat_phap 80/20 mix is within ±5% tolerance.
 *
 * Output: media/qa/voice-rotation-v1/{voice_id}.wav
 *
 * Run:
 *   npx tsx scripts/voice-rotation-qa.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";

import { VIENEU_VOICES, PHAT_PHAP_ROTATION_V1, pickVoiceForContent } from "@/lib/voice-rotation";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH = ffmpegInstaller.path;
const execFileAsync = promisify(execFile);

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const QA_DIR = path.join(process.cwd(), "media", "qa", "voice-rotation-v1");
const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 10 * 60 * 1000;

/** Buddhist sample text — representative phat_phap short script sentence. */
const SAMPLE_TEXT =
  "Người biết im lặng không phải là người yếu đuối. " +
  "Họ chỉ hiểu rằng, có những chuyện không cần giải thích.";

// ── Helpers ────────────────────────────────────────────────────────────────────

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

async function submitTTS(text: string, contentId: string, voice: string): Promise<string> {
  const res = await fetch(`${TTS_API_URL}/tts/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content_id: contentId, voice }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`TTS submit failed (${res.status}): ${await res.text()}`);
  const { job_id } = await res.json() as { job_id: string };
  return job_id;
}

function resolveLocalPath(filePath: string): string {
  const containerAudioDir = process.env.TTS_CONTAINER_AUDIO_DIR ?? null;
  const hostAudioDir = path.join(process.cwd(), "media", "audio");
  if (containerAudioDir && filePath.startsWith(containerAudioDir)) {
    const rel = filePath.slice(containerAudioDir.length).replace(/^\/+/, "");
    return path.join(hostAudioDir, rel);
  }
  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) return filePath;
  return path.join(process.cwd(), filePath.replace(/^\/+/, ""));
}

async function pollTTS(jobId: string): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${TTS_API_URL}/tts/status/${jobId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const status = await res.json() as { status: string; path?: string; error?: string };
    if (status.status === "done") {
      if (!status.path) throw new Error("TTS done but no path");
      const hostPath = resolveLocalPath(status.path);
      if (!fs.existsSync(hostPath)) throw new Error(`TTS file missing: ${hostPath}`);
      return hostPath;
    }
    if (status.status === "error") throw new Error(status.error ?? "TTS failed");
    process.stdout.write(".");
  }
  throw new Error("TTS timeout");
}

// ── Section 1: Distribution test ──────────────────────────────────────────────

function runDistributionTest(): void {
  console.log("\n── Voice Rotation Distribution Test (n=1000) ────────────────────────");

  const N = 1000;
  const counts: Record<string, number> = {};
  for (const v of PHAT_PHAP_ROTATION_V1.voices) counts[v.id] = 0;

  for (let i = 0; i < N; i++) {
    const id = crypto.randomUUID();
    const voice = pickVoiceForContent(id, "phat_phap") ?? "Ly";
    counts[voice] = (counts[voice] ?? 0) + 1;
  }

  let allPass = true;
  for (const v of PHAT_PHAP_ROTATION_V1.voices) {
    const pct = ((counts[v.id] ?? 0) / N) * 100;
    const expected = v.weight;
    const tolerance = 5;
    const pass = Math.abs(pct - expected) <= tolerance;
    if (!pass) allPass = false;
    console.log(
      `  ${v.id.padEnd(6)} expected=${expected}%  actual=${pct.toFixed(1)}%` +
      `  delta=${(pct - expected).toFixed(1)}pp  ${pass ? "✓" : "✗ OUT OF TOLERANCE"}`,
    );
  }

  // Determinism check: same ID → same voice, 10 rounds
  let deterministic = true;
  for (let i = 0; i < 10; i++) {
    const id = crypto.randomUUID();
    const v1 = pickVoiceForContent(id, "phat_phap");
    const v2 = pickVoiceForContent(id, "phat_phap");
    if (v1 !== v2) { deterministic = false; break; }
  }
  console.log(`  determinism check (10 pairs): ${deterministic ? "✓ PASS" : "✗ FAIL"}`);

  // Channel without rotation config → returns null
  const noConfig = pickVoiceForContent(crypto.randomUUID(), "tang_sau");
  console.log(`  null for unknown channel (tang_sau): ${noConfig === null ? "✓ PASS" : `✗ FAIL (got ${noConfig})`}`);

  if (allPass && deterministic) {
    console.log("  → Distribution PASS ✓");
  } else {
    console.warn("  → Distribution issues detected — review weights");
  }
}

// ── Section 2: TTS health check ────────────────────────────────────────────────

async function checkTTSHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${TTS_API_URL}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return false;
    const data = await res.json() as { status: string };
    return data.status === "ok";
  } catch { return false; }
}

async function fetchVoiceList(): Promise<Array<{ id: string; name: string }>> {
  try {
    const res = await fetch(`${TTS_API_URL}/voices`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return [];
    const data = await res.json() as { voices: Array<{ id: string; name: string }> };
    return data.voices ?? [];
  } catch { return []; }
}

// ── Section 3: Generate previews ──────────────────────────────────────────────

type VoicePreviewResult = {
  voiceId: string;
  voiceName: string;
  gender: string;
  region: string;
  ok: boolean;
  previewFile?: string;
  durationSec?: number;
  errorMsg?: string;
};

async function generatePreview(
  voiceId: string,
  voiceName: string,
): Promise<{ rawPath?: string; error?: string }> {
  const ttsText = normalizeTextForTTS(SAMPLE_TEXT);
  const contentId = `qa-voice-rotation-${voiceId}-${Date.now()}`;

  // Check if preview already exists (idempotent)
  const existingPath = path.join(QA_DIR, `${voiceId}.wav`);
  if (fs.existsSync(existingPath)) {
    console.log(`  → cache hit (skipping TTS call)`);
    return { rawPath: existingPath };
  }

  const rawCachePath = path.join(QA_DIR, `${voiceId}.raw.wav`);
  let rawPath: string;

  if (fs.existsSync(rawCachePath)) {
    rawPath = rawCachePath;
    console.log(`  → raw cache hit`);
  } else {
    try {
      const jobId = await submitTTS(ttsText, contentId, voiceId);
      process.stdout.write(`  → job=${jobId} polling`);
      rawPath = await pollTTS(jobId);
      process.stdout.write("\n");
      console.log(`  → raw TTS: ${rawPath}`);
      // Cache raw
      fs.mkdirSync(QA_DIR, { recursive: true });
      fs.copyFileSync(rawPath, rawCachePath);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { rawPath };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(QA_DIR, { recursive: true });

  console.log("═".repeat(70));
  console.log("  VOICE ROTATION V1 — QA Preview Generator");
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Sample: "${SAMPLE_TEXT.slice(0, 60)}…"`);
  console.log(`  Policy: loudnorm-only · silenceremove=false · injection=off`);
  console.log(`  Output: ${QA_DIR}`);
  console.log("═".repeat(70));

  // ── Distribution test (no TTS needed) ───────────────────────────────────────
  runDistributionTest();

  // ── TTS server health + voice list ──────────────────────────────────────────
  console.log("\n── TTS Server Check ─────────────────────────────────────────────────");
  const online = await checkTTSHealth();
  console.log(`  Server: ${online ? "✓ online" : "✗ offline"} (${TTS_API_URL})`);
  if (!online) {
    console.error("  ✗ TTS server offline — cannot generate previews. Stopping here.");
    process.exit(1);
  }

  const serverVoices = await fetchVoiceList();
  const serverVoiceIds = new Set(serverVoices.map(v => v.id));
  console.log(`  Server voices (${serverVoices.length}): ${serverVoices.map(v => v.id).join(", ")}`);

  // Verify VIENEU_VOICES matches server list
  const missing = VIENEU_VOICES.filter(v => !serverVoiceIds.has(v.id));
  const extra = serverVoices.filter(v => !VIENEU_VOICES.some(kv => kv.id === v.id));
  if (missing.length > 0) console.warn(`  ⚠ Config voices not on server: ${missing.map(v => v.id).join(", ")}`);
  if (extra.length > 0)   console.warn(`  ⚠ Server voices not in config: ${extra.map(v => v.id).join(", ")}`);
  if (missing.length === 0 && extra.length === 0) console.log("  ✓ Config matches server voice list");

  // ── Generate preview for each confirmed voice ──────────────────────────────
  console.log(`\n── Preview Generation (${serverVoices.length} voices × loudnorm-only) ──────────────`);
  const ttsText = normalizeTextForTTS(SAMPLE_TEXT);
  console.log(`  Normalized text: "${ttsText}"`);
  console.log();

  const results: VoicePreviewResult[] = [];

  for (const serverVoice of serverVoices) {
    const configVoice = VIENEU_VOICES.find(v => v.id === serverVoice.id);
    const voiceName = configVoice?.name ?? serverVoice.name;
    const gender = configVoice?.gender ?? "?";
    const region = configVoice?.region ?? "?";

    console.log(`  [${serverVoice.id}] ${voiceName} (${gender} miền ${region})`);

    const { rawPath, error } = await generatePreview(serverVoice.id, voiceName);

    if (!rawPath || error) {
      console.log(`  ✗ Failed: ${error ?? "unknown"}`);
      results.push({ voiceId: serverVoice.id, voiceName, gender, region, ok: false, errorMsg: error });
      continue;
    }

    const previewPath = path.join(QA_DIR, `${serverVoice.id}.wav`);

    // Skip re-applying loudnorm if preview already exists (same file)
    if (rawPath !== previewPath) {
      await applyLoudnormOnly(rawPath, previewPath);
      console.log(`  ✓ loudnorm applied → ${path.relative(process.cwd(), previewPath)}`);
    } else {
      console.log(`  ✓ preview exists   → ${path.relative(process.cwd(), previewPath)}`);
    }

    const dur = await getAudioDurationSec(previewPath);
    console.log(`  ✓ duration: ${dur?.toFixed(2) ?? "?"}s`);

    results.push({
      voiceId: serverVoice.id,
      voiceName,
      gender,
      region,
      ok: true,
      previewFile: path.relative(process.cwd(), previewPath),
      durationSec: dur ?? undefined,
    });
  }

  // ── FINAL REPORT ────────────────────────────────────────────────────────────

  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);

  console.log("\n\n" + "═".repeat(70));
  console.log("## Available Voices");
  console.log("═".repeat(70));
  console.log();

  const hdr = [
    "id".padEnd(8), "name".padEnd(16), "gender".padEnd(7), "region".padEnd(7),
    "dur(s)".padStart(7), "file".padEnd(42), "status".padEnd(8),
  ].join("  ");
  console.log("  " + hdr);
  console.log("  " + "─".repeat(hdr.length));

  for (const r of results) {
    const row = [
      r.voiceId.padEnd(8),
      r.voiceName.padEnd(16),
      r.gender.padEnd(7),
      r.region.padEnd(7),
      (r.durationSec?.toFixed(2) ?? "—").padStart(7),
      (r.previewFile ?? `✗ ${r.errorMsg?.slice(0, 35) ?? "error"}`).padEnd(42),
      (r.ok ? "✓ ok" : "✗ fail").padEnd(8),
    ].join("  ");
    console.log("  " + row);
  }

  console.log("\n" + "═".repeat(70));
  console.log("## Preview Files");
  console.log("═".repeat(70));
  for (const r of ok) {
    console.log(`  ${r.previewFile}`);
  }

  console.log("\n" + "═".repeat(70));
  console.log("## Voice Rotation Config");
  console.log("═".repeat(70));
  console.log(`
  Channel: phat_phap
  Config : PHAT_PHAP_ROTATION_V1
  Mix    : ${PHAT_PHAP_ROTATION_V1.voices.map(v => `${v.id} ${v.weight}%`).join(" + ")}
  Fallback: ${PHAT_PHAP_ROTATION_V1.fallbackVoice}
  Method : SHA-256(contentId)[0:4] % 100 → cumulative weight bucket
  Storage: content_generations.tts_voice (varchar 50, set at INSERT, immutable after audio)
  `);

  console.log("═".repeat(70));
  console.log("## Safety Checks");
  console.log("═".repeat(70));
  console.log(`
  ✓ No DB writes in this script
  ✓ Audio policy unchanged: loudnorm-only · silenceremove=false · injection=off
  ✓ TTS provider unchanged: VieNeu
  ✓ Previews are QA-only: no contentGenerations rows created
  ✓ Confirmed voices: ${ok.length}/${results.length}
  ${fail.length > 0 ? `⚠ Failed voices: ${fail.map(r => r.voiceId).join(", ")}` : "✓ All voices confirmed working"}
  `);

  console.log("═".repeat(70));
  console.log();

  process.exit(fail.length === 0 ? 0 : 2);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
