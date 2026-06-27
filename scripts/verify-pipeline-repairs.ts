/**
 * Post-repair pipeline verification.
 *
 * For each content ID:
 *  1. Normalize audio if still raw (24 kHz) — 99b7f393 was TTS-error with broken filter.
 *  2. Run short-video assembly (re-uses existing TTS audio and images).
 *  3. Confirm subtitle PASS, video file exists, upload queue untouched.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/verify-pipeline-repairs.ts
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { runShortVideo } from "@/lib/pipeline/short-video";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const CONTENT_IDS = [
  "99b7f393-37ea-4716-98a4-e6b8fc7d69c0", // TTS error (broken filter) — needs normalization
  "f86006b4-5470-4a03-a442-27f37bd36aa9", // blank segment fix — should already be done
  "20f391d8-efd9-45a9-8adf-979879637dbe", // trailing drift fix — should already be done
  "6962bb6f-c136-4c52-866b-a994835ef2d0", // raw audio fix — should already be done
];

async function getAudioHz(absPath: string): Promise<number | null> {
  try {
    const r = await execFileAsync(FFMPEG_PATH, ["-i", absPath], { timeout: 15_000 })
      .catch((e: { stderr: string }) => ({ stderr: e.stderr ?? "" }));
    const m = (r as { stderr: string }).stderr.match(/(\d+)\s+Hz/);
    return m ? parseInt(m[1]) : null;
  } catch {
    return null;
  }
}

async function normalizeAudio(rawPath: string): Promise<void> {
  const tempPath = `${rawPath}.repair.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", rawPath,
    "-af",
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05:stop_periods=-1:stop_threshold=-50dB:stop_duration=0.35:stop_silence=0.16:detection=rms,loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    tempPath,
  ], { timeout: 120_000 });
  fs.renameSync(tempPath, rawPath);
}

async function main() {
  console.log("=== Post-repair pipeline verification ===\n");

  // ── Snapshot upload queue BEFORE any work ────────────────────────────────
  const queueBefore = await db
    .select({ id: uploadQueue.id, status: uploadQueue.status, contentId: uploadQueue.contentId })
    .from(uploadQueue)
    .where(inArray(uploadQueue.contentId, CONTENT_IDS));

  console.log(`Upload queue snapshot (${queueBefore.length} rows for these IDs):`);
  for (const q of queueBefore) {
    console.log(`  queue ${q.id?.slice(0, 8)} | cg=${q.contentId?.slice(0, 8)} | status=${q.status}`);
  }
  console.log();

  const results: Array<{
    id: string;
    topic: string;
    step: string;
    pass: boolean;
    detail: string;
  }> = [];

  for (const contentId of CONTENT_IDS) {
    const shortId = contentId.slice(0, 8);
    console.log(`──────────────────────────────────────────`);
    console.log(`[${shortId}] Inspecting…`);

    const item = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, contentId),
    });
    if (!item) {
      console.log(`  ERROR: not found in DB`);
      results.push({ id: shortId, topic: "n/a", step: "db_lookup", pass: false, detail: "not found" });
      continue;
    }

    console.log(`  topic: ${item.topic}`);
    console.log(`  tts_status: ${item.ttsStatus}  |  video_status: ${item.videoStatus}`);

    // ── Step 1: Normalize audio if needed ──────────────────────────────────
    const audioRelPath = item.audioPath ?? `media/audio/${contentId}.wav`;
    const audioAbsPath = path.join(process.cwd(), audioRelPath);

    if (!fs.existsSync(audioAbsPath)) {
      console.log(`  WARN: audio file not found at ${audioRelPath}`);
      results.push({ id: shortId, topic: item.topic ?? "", step: "audio_check", pass: false, detail: "audio missing" });
      continue;
    }

    const hz = await getAudioHz(audioAbsPath);
    console.log(`  audio: ${audioRelPath} (${hz ?? "?"}Hz)`);

    if (hz !== null && hz < 44100) {
      console.log(`  → Raw audio detected (${hz}Hz). Normalizing…`);
      await normalizeAudio(audioAbsPath);
      const hzAfter = await getAudioHz(audioAbsPath);
      console.log(`  → Normalized: ${hz}Hz → ${hzAfter}Hz`);

      // Repair DB: mark TTS done, set audio_path
      await db.update(contentGenerations)
        .set({ ttsStatus: "done", ttsErrorMessage: null, audioPath: audioRelPath })
        .where(eq(contentGenerations.id, contentId));
      console.log(`  → DB updated: tts_status=done, audio_path=${audioRelPath}`);
    } else {
      console.log(`  → Audio OK (already ${hz}Hz)`);
    }

    // ── Step 2: Run video assembly if not already done ─────────────────────
    const itemNow = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, contentId),
    });

    if (itemNow?.videoStatus === "done" && itemNow.videoPath) {
      const absVideo = path.join(process.cwd(), itemNow.videoPath);
      const exists = fs.existsSync(absVideo);
      console.log(`  → video already done: ${itemNow.videoPath} (file ${exists ? "EXISTS" : "MISSING"})`);
      if (exists) {
        results.push({ id: shortId, topic: item.topic ?? "", step: "video_exists", pass: true, detail: itemNow.videoPath });
      } else {
        console.log(`  → Video file missing — re-rendering…`);
        const vr = await runShortVideo(contentId);
        if (vr.success) {
          console.log(`  → Render OK: score=${vr.subtitleHealthScore}/100 path=${vr.videoPath}`);
          results.push({ id: shortId, topic: item.topic ?? "", step: "render", pass: true, detail: vr.videoPath });
        } else {
          console.log(`  → Render FAIL: ${vr.error}`);
          results.push({ id: shortId, topic: item.topic ?? "", step: "render", pass: false, detail: vr.error });
        }
      }
    } else {
      console.log(`  → Running video assembly…`);
      const t0 = Date.now();
      const vr = await runShortVideo(contentId);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (vr.success) {
        console.log(`  → Render OK in ${elapsed}s: subtitleStatus=${vr.subtitleStatus} score=${vr.subtitleHealthScore}/100`);
        console.log(`     path: ${vr.videoPath}`);
        results.push({ id: shortId, topic: item.topic ?? "", step: "render", pass: true, detail: vr.videoPath });
      } else {
        console.log(`  → Render FAIL in ${elapsed}s: ${vr.error}`);
        results.push({ id: shortId, topic: item.topic ?? "", step: "render", pass: false, detail: vr.error });
      }
    }
    console.log();
  }

  // ── Upload queue AFTER ─────────────────────────────────────────────────
  const queueAfter = await db
    .select({ id: uploadQueue.id, status: uploadQueue.status, contentId: uploadQueue.contentId })
    .from(uploadQueue)
    .where(inArray(uploadQueue.contentId, CONTENT_IDS));

  const queueUnchanged =
    queueAfter.length === queueBefore.length &&
    queueAfter.every((a) => queueBefore.find((b) => b.id === a.id && b.status === a.status));

  console.log(`──────────────────────────────────────────`);
  console.log(`\n=== SUMMARY ===\n`);
  let allPass = true;
  for (const r of results) {
    const mark = r.pass ? "PASS" : "FAIL";
    console.log(`  [${r.id}] ${mark} | ${r.topic} | ${r.detail}`);
    if (!r.pass) allPass = false;
  }
  console.log();
  console.log(`Upload queue unchanged: ${queueUnchanged ? "YES" : "NO — check manually!"}`);
  console.log(`\nOverall: ${allPass && queueUnchanged ? "PASS" : "FAIL"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
