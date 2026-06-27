/**
 * repair-long-pilot-silence.ts
 * Fix 26 silence blocks >2s in the Sợ già pilot audio.
 *
 * Root cause: TTS model froze mid-narration, inserting 2–27s internal pauses.
 * Segment 6 is 100% silent (TTS failure).
 *
 * Strategy:
 *   - Seg-6 (silent): re-submit text to TTS, normalize fresh
 *   - 16 other affected segments: collapse internal silence >0.5s, re-loudnorm
 *   - All other segments: copy as-is
 *   - Rebuild merged WAV from repaired chunks
 *   - Validate 0 silence blocks >2s
 *   - Update sidecar manifest
 *
 * Does NOT render video. Does NOT modify Shorts. Does NOT publish.
 *
 * Run:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/repair-long-pilot-silence.ts
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { resolveAudioPathForHost } from "@/lib/pipeline/tts-paths";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

// ─── Config ───────────────────────────────────────────────────────────────────

const CONTENT_ID     = "b0ea0fff-7348-415a-93c8-e3a4cb02e88d";
const PLAN_DATE      = "2026-06-14";
const VOICE_ID       = "Sơn";
const ATEMPO         = 0.95;
const MAX_SEG_WORDS  = 130;
const MIN_SEG_WORDS  = 30;
const TTS_API_URL    = process.env.TTS_API_URL ?? "http://localhost:8765";

const AUDIO_DIR      = path.join(process.cwd(), "media", "audio");
const CHUNK_DIR      = path.join(AUDIO_DIR, `${CONTENT_ID}-long-chunks`);
const REPAIRED_DIR   = path.join(AUDIO_DIR, `${CONTENT_ID}-long-chunks-repaired`);
const MERGED_PATH    = path.join(AUDIO_DIR, `${CONTENT_ID}-long.wav`);
const MERGED_BACKUP  = path.join(AUDIO_DIR, `${CONTENT_ID}-long.wav.bak`);
const STATE_PATH     = path.join(process.cwd(), "reports", "longform-topic-plans", `${PLAN_DATE}.state.json`);

// Segments with confirmed internal silence >2s in merged audio
const INTERNAL_SILENCE_SEGS = new Set([1, 10, 12, 21, 25, 30, 38, 39, 44, 52, 60, 64, 76, 81, 87, 90]);
// Segment 6 is entirely silent — needs TTS re-generation
const SILENT_SEG = 6;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeForTTS(text: string): string {
  return text
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .replace(/(nh\p{L}*),\s*(nh)/gu, "$1. $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitIntoSegments(script: string): string[] {
  const paragraphs = script.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const rawUnits: string[] = [];
  for (const para of paragraphs) {
    const wc = countWords(para);
    if (wc <= MAX_SEG_WORDS) { rawUnits.push(para); continue; }
    const sentences = para.match(/[^.!?…]+(?:[.!?…]+["')\]]*)?/gu) ?? [para];
    let current: string[] = [];
    let currentWc = 0;
    for (const sent of sentences) {
      const sentWc = countWords(sent.trim());
      if (currentWc > 0 && currentWc + sentWc > MAX_SEG_WORDS) {
        rawUnits.push(current.join(" ").trim());
        current = [sent.trim()];
        currentWc = sentWc;
      } else {
        current.push(sent.trim());
        currentWc += sentWc;
      }
    }
    if (current.length > 0) rawUnits.push(current.join(" ").trim());
  }
  const merged: string[] = [];
  let pending = "";
  let pendingWc = 0;
  for (const unit of rawUnits) {
    const wc = countWords(unit);
    if (pendingWc > 0) {
      if (pendingWc + wc <= MAX_SEG_WORDS) {
        pending = pending + " " + unit;
        pendingWc += wc;
        if (pendingWc >= MIN_SEG_WORDS) {
          merged.push(pending.trim());
          pending = "";
          pendingWc = 0;
        }
        continue;
      } else {
        merged.push(pending.trim());
        pending = "";
        pendingWc = 0;
      }
    }
    if (wc < MIN_SEG_WORDS) { pending = unit; pendingWc = wc; }
    else merged.push(unit);
  }
  if (pending) merged.push(pending.trim());
  return merged.filter(s => countWords(s) > 0);
}

type TTSJobStatus = { status: "queued" | "processing" | "done" | "error"; path?: string; error?: string };

async function submitTTSJob(text: string, jobId: string): Promise<string> {
  const normalized = normalizeForTTS(text);
  const submitRes = await fetch(`${TTS_API_URL}/tts/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: normalized, content_id: jobId, voice: VOICE_ID }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => submitRes.statusText);
    throw new Error(`TTS submit failed (${submitRes.status}): ${body}`);
  }
  const { job_id } = await submitRes.json() as { job_id: string };
  if (!job_id) throw new Error("TTS submit returned no job_id");
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 8_000));
    const pollRes = await fetch(`${TTS_API_URL}/tts/status/${job_id}`);
    const status = await pollRes.json() as TTSJobStatus;
    if (status.status === "done") {
      if (!status.path) throw new Error(`TTS done but no path for job ${job_id}`);
      return status.path;
    }
    if (status.status === "error") throw new Error(`TTS error: ${status.error}`);
  }
  throw new Error(`TTS timeout after 10min for job ${job_id}`);
}

async function normalizeSegmentAudio(rawPath: string, outPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp.wav`;
  const af = [
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1:detection=rms",
    "areverse",
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.3:detection=rms",
    "areverse",
    `atempo=${ATEMPO.toFixed(3)}`,
    "loudnorm=I=-16:TP=-1.5:LRA=11",
  ].join(",");
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", rawPath,
    "-af", af,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    tmpPath,
  ], { timeout: 60_000 });
  fs.renameSync(tmpPath, outPath);
}

async function repairInternalSilence(inputPath: string, outPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp.wav`;
  // Collapse internal silences >0.5s (TTS freeze artifacts), then re-loudnorm.
  // stop_periods=-1 means collapse ALL internal silent regions over the threshold,
  // not just the first one. Natural sentence pauses (<0.5s) are preserved.
  const af = [
    "silenceremove=stop_periods=-1:stop_duration=0.5:stop_threshold=-40dB",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
  ].join(",");
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", inputPath,
    "-af", af,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    tmpPath,
  ], { timeout: 60_000 });
  fs.renameSync(tmpPath, outPath);
}

async function concatAudioFiles(chunkPaths: string[], outputPath: string): Promise<void> {
  const listFile = `${outputPath}.list.txt`;
  fs.writeFileSync(listFile, chunkPaths.map(p => `file '${p}'`).join("\n"));
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-f", "concat", "-safe", "0",
    "-i", listFile,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    outputPath,
  ], { timeout: 300_000 });
  fs.unlinkSync(listFile);
}

async function getAudioDurationSec(audioPath: string): Promise<number> {
  const result = await execFileAsync(FFMPEG_PATH, ["-i", audioPath, "-f", "null", "-"], { timeout: 30_000 })
    .catch(e => e as { stderr: string });
  const match = (result as { stderr: string }).stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!match) throw new Error(`Cannot read duration: ${audioPath}`);
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
}

async function detectSilenceBlocks(audioPath: string, minDurSec: number): Promise<Array<{start: number; end: number; dur: number}>> {
  const result = await execFileAsync(FFMPEG_PATH, [
    "-i", audioPath,
    "-af", `silencedetect=noise=-40dB:d=${minDurSec}`,
    "-f", "null", "-",
  ], { timeout: 60_000 }).catch(e => e as { stderr: string });
  const stderr = (result as { stderr: string }).stderr ?? "";
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map(m => parseFloat(m[1]));
  const endings = [...stderr.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map(m => ({
    end: parseFloat(m[1]),
    dur: parseFloat(m[2]),
  }));
  return starts.map((start, i) => ({ start, end: endings[i]?.end ?? 0, dur: endings[i]?.dur ?? 0 }));
}

function getChunkPath(segIdx: number): string {
  const files = fs.readdirSync(CHUNK_DIR).sort();
  // files use printf-style padding with spaces: "seg-  1.wav", "seg- 10.wav"
  return path.join(CHUNK_DIR, files[segIdx - 1]);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0);
  return `${m}m ${s}s`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const totalStart = Date.now();
  console.log("\n" + "═".repeat(65));
  console.log("  SILENCE REPAIR — Sợ Già pilot");
  console.log("  Content ID: " + CONTENT_ID);
  console.log("═".repeat(65) + "\n");

  // ── Load script from DB ───────────────────────────────────────────────────
  console.log("## 1 — Load script + segment texts");
  const row = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, CONTENT_ID),
  });
  if (!row?.longContent) throw new Error(`Content ${CONTENT_ID} not found or has no longContent`);
  const segments = splitIntoSegments(row.longContent);
  console.log(`  ✓ Script loaded: ${segments.length} segments`);
  const silentSegText = segments[SILENT_SEG - 1];
  console.log(`  Seg-${SILENT_SEG} text (${countWords(silentSegText)}w): "${silentSegText.slice(0, 60)}..."`);

  // ── Create repaired dir ───────────────────────────────────────────────────
  fs.mkdirSync(REPAIRED_DIR, { recursive: true });
  console.log(`\n  Repaired dir: ${REPAIRED_DIR}`);

  // ── Before stats ──────────────────────────────────────────────────────────
  console.log("\n## 2 — Before state");
  const beforeBlocks = await detectSilenceBlocks(MERGED_PATH, 2.0);
  const beforeDur = await getAudioDurationSec(MERGED_PATH);
  console.log(`  Silence blocks >2s: ${beforeBlocks.length}`);
  console.log(`  Total duration: ${(beforeDur / 60).toFixed(1)} min`);
  for (const b of beforeBlocks) {
    console.log(`    ${b.start.toFixed(1)}–${b.end.toFixed(1)}s  dur=${b.dur.toFixed(1)}s`);
  }

  // ── Process all 92 chunks ─────────────────────────────────────────────────
  console.log("\n## 3 — Repair chunks");
  const repairedChunkPaths: string[] = [];
  let regenCount = 0;
  let repairCount = 0;
  let copyCount = 0;

  for (let i = 1; i <= segments.length; i++) {
    const srcPath = getChunkPath(i);
    const outPath = path.join(REPAIRED_DIR, `seg-${String(i).padStart(3, "0")}.wav`);
    repairedChunkPaths.push(outPath);

    if (i === SILENT_SEG) {
      // Re-generate from TTS
      process.stdout.write(`  [${i}/${segments.length}] seg-${SILENT_SEG} SILENT → re-TTS (${countWords(silentSegText)}w) ... `);
      const jobId = `${CONTENT_ID}-repair-s${i}`;
      const rawContainerPath = await submitTTSJob(silentSegText, jobId);
      const rawHostPath = resolveAudioPathForHost(rawContainerPath);
      await normalizeSegmentAudio(rawHostPath, outPath);
      const dur = await getAudioDurationSec(outPath);
      console.log(`✓ ${dur.toFixed(1)}s`);
      regenCount++;
    } else if (INTERNAL_SILENCE_SEGS.has(i)) {
      // Collapse internal silence, re-loudnorm
      process.stdout.write(`  [${i}/${segments.length}] seg-${i} internal-sil → repair ... `);
      await repairInternalSilence(srcPath, outPath);
      const dur = await getAudioDurationSec(outPath);
      // Verify silence removed
      const silBlocks = await detectSilenceBlocks(outPath, 2.0);
      const status = silBlocks.length === 0 ? "✓" : `⚠ ${silBlocks.length} remaining`;
      console.log(`${status}  ${dur.toFixed(1)}s`);
      repairCount++;
    } else {
      // Copy as-is
      fs.copyFileSync(srcPath, outPath);
      copyCount++;
      if (i <= 5 || i === segments.length) {
        process.stdout.write(`  [${i}/${segments.length}] copy\n`);
      } else if (i === 6) {
        process.stdout.write(`  ... (${segments.length - INTERNAL_SILENCE_SEGS.size - 1 - regenCount} copies) ...\n`);
      }
    }
  }

  console.log(`\n  Re-generated:  ${regenCount} segment (seg-${SILENT_SEG})`);
  console.log(`  Silence-fixed: ${repairCount} segments`);
  console.log(`  Copied:        ${copyCount} segments`);

  // ── Backup original merged, rebuild ───────────────────────────────────────
  console.log("\n## 4 — Rebuild merged WAV");
  if (fs.existsSync(MERGED_PATH) && !fs.existsSync(MERGED_BACKUP)) {
    fs.copyFileSync(MERGED_PATH, MERGED_BACKUP);
    console.log(`  ↩ Backed up original: ${MERGED_BACKUP}`);
  }
  console.log(`  Concatenating ${repairedChunkPaths.length} repaired chunks...`);
  await concatAudioFiles(repairedChunkPaths, MERGED_PATH);

  // ── Validate ──────────────────────────────────────────────────────────────
  console.log("\n## 5 — Validate");
  const afterBlocks = await detectSilenceBlocks(MERGED_PATH, 2.0);
  const afterDur = await getAudioDurationSec(MERGED_PATH);
  const passed = afterBlocks.length === 0;
  console.log(`  Silence blocks >2s: ${afterBlocks.length} ${passed ? "✓ PASS" : "⚠ FAIL"}`);
  console.log(`  Duration before: ${(beforeDur / 60).toFixed(1)} min`);
  console.log(`  Duration after:  ${(afterDur / 60).toFixed(1)} min`);
  if (afterBlocks.length > 0) {
    for (const b of afterBlocks) {
      console.log(`    ⚠ remaining: ${b.start.toFixed(1)}–${b.end.toFixed(1)}s  dur=${b.dur.toFixed(1)}s`);
    }
  }

  // Verify no speech lost: repaired audio should be at least 75% of original duration
  const durationRatio = afterDur / beforeDur;
  const speechPreserved = durationRatio >= 0.75;
  console.log(`  Duration ratio: ${(durationRatio * 100).toFixed(1)}% ${speechPreserved ? "✓" : "⚠ WARN — may have lost speech"}`);

  // ── Update sidecar manifest ───────────────────────────────────────────────
  console.log("\n## 6 — Update sidecar");
  const relPath = `media/audio/${CONTENT_ID}-long.wav`;
  const rawSidecar = fs.readFileSync(STATE_PATH, "utf8");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sidecar = JSON.parse(rawSidecar) as { date: string; generatedAt: string; updatedAt: string; items: any[] };
  const item = sidecar.items.find((it: { topicKey: string }) => it.topicKey === "sợ già");
  if (item) {
    item.longAudioPath = relPath;
    item.pipelineStatus = passed ? "tts_repaired" : "tts_repair_partial";
    item.lastAction = "repair_silence";
    item.lastMessage = `Silence repair: ${beforeBlocks.length} blocks before → ${afterBlocks.length} after. Duration: ${(afterDur / 60).toFixed(1)} min. Repaired=${repairCount}, re-TTS=${regenCount}.`;
    item.silenceRepairApplied = true;
    item.silenceBlocksBefore = beforeBlocks.length;
    item.silenceBlocksAfter = afterBlocks.length;
    item.repairedAt = new Date().toISOString();
    item.audioDurationMin = parseFloat((afterDur / 60).toFixed(1));
    item.updatedAt = new Date().toISOString();
    sidecar.updatedAt = new Date().toISOString();
    const tmp = STATE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(sidecar, null, 2));
    fs.renameSync(tmp, STATE_PATH);
    console.log(`  ✓ Sidecar updated: ${passed ? "tts_repaired" : "tts_repair_partial"}`);
  } else {
    console.warn("  ⚠ Could not find 'sợ già' item in sidecar");
  }

  // Update DB audio path and TTS status
  await db.update(contentGenerations)
    .set({ longAudioPath: relPath, longTtsStatus: passed ? "repaired" : "repair_partial" })
    .where(eq(contentGenerations.id, CONTENT_ID));
  console.log(`  ✓ DB updated`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalMs = Date.now() - totalStart;
  console.log("\n" + "═".repeat(65));
  console.log(`  REPAIR ${passed ? "COMPLETE ✓" : "PARTIAL ⚠"} — ${formatDuration(totalMs)}`);
  console.log("═".repeat(65));
  console.log(`\nBefore: ${beforeBlocks.length} silence blocks >2s, ${(beforeDur / 60).toFixed(1)} min`);
  console.log(`After:  ${afterBlocks.length} silence blocks >2s, ${(afterDur / 60).toFixed(1)} min`);
  console.log(`\nFiles changed:`);
  console.log(`  ${MERGED_PATH}  (rebuilt)`);
  console.log(`  ${REPAIRED_DIR}/  (${repairedChunkPaths.length} repaired chunks)`);
  console.log(`  ${MERGED_BACKUP}  (original backup)`);
  console.log(`  ${STATE_PATH}  (sidecar updated)`);

  if (passed && speechPreserved) {
    console.log("\n✓ Audio is safe to listen. Do NOT render video until quality reviewed.");
  } else {
    if (!passed) console.log("\n⚠ Some silence blocks remain — investigate manually.");
    if (!speechPreserved) console.log("⚠ Duration dropped significantly — verify no speech was lost.");
  }

  process.exit(0);
}

main().catch(e => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
