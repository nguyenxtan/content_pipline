import "dotenv/config";

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import pg from "pg";
import sharp from "sharp";
import {
  buildSubtitleChunks,
  buildSubtitleChunksFromWords,
  validateAndRepairSubtitleChunks,
  type SpeechSegment,
  type WordTimestamp,
} from "@/lib/video/subtitle";

const execFileAsync = promisify(execFile);
const { Pool } = pg;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH = ffmpegInstaller.path;
const WHISPER_SCRIPT = path.join(process.cwd(), "tts-server", "whisper_timestamps.py");
const VENV_PYTHON = path.join(process.env.HOME ?? "", "venv-tts-new", "bin", "python3");

const OUT_DIR = path.join(process.cwd(), "output", "short-cover-intro-verification");
const SAMPLES_WANTED = 3;

type VerifySample = {
  id: string;
  topic: string;
  script: string;
  short_content: string;
  short_selected_hook: string | null;
  audio_path: string | null;
  image_paths: string[] | null;
};

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

async function inspectMedia(absPath: string): Promise<{ durationSec: number; startSec: number }> {
  const result = await execFileAsync(FFMPEG_PATH, ["-i", absPath, "-f", "null", "-"], { timeout: 30_000 })
    .catch((error: { stderr: string }) => ({ stderr: error.stderr }));
  const stderr = (result as { stderr: string }).stderr;
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!durationMatch) throw new Error(`Unable to inspect media timing: ${absPath}`);
  const startMatch = stderr.match(/start:\s*([-\d.]+)/);
  const durationSec =
    parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseFloat(durationMatch[3]);
  const startSec = startMatch ? parseFloat(startMatch[1]) : 0;
  return { durationSec, startSec };
}

async function getWhisperWordTimestamps(absPath: string): Promise<WordTimestamp[]> {
  try {
    const pythonBin = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
    const result = await execFileAsync(pythonBin, [WHISPER_SCRIPT, absPath], { timeout: 120_000 });
    const data = JSON.parse(result.stdout) as { success: boolean; words?: WordTimestamp[] };
    if (!data.success || !data.words || data.words.length < 5) return [];
    return data.words;
  } catch {
    return [];
  }
}

async function getAudioSpeechSegments(absPath: string, totalDuration: number): Promise<SpeechSegment[]> {
  const result = await execFileAsync(FFMPEG_PATH, [
    "-i", absPath, "-af", "silencedetect=n=-40dB:d=0.2", "-f", "null", "-",
  ], { timeout: 30_000 }).catch((error: { stderr: string }) => ({ stderr: error.stderr }));

  const stderr = (result as { stderr: string }).stderr;
  const silenceStarts: number[] = [];
  const silenceEnds: number[] = [];

  for (const line of stderr.split("\n")) {
    const sStart = line.match(/silence_start:\s*([\d.]+)/);
    if (sStart) silenceStarts.push(parseFloat(sStart[1]));
    const sEnd = line.match(/silence_end:\s*([\d.]+)/);
    if (sEnd) silenceEnds.push(parseFloat(sEnd[1]));
  }

  const segments: SpeechSegment[] = [];
  let cursor = 0;
  if (silenceEnds.length > 0 && silenceStarts.length > 0 && silenceStarts[0] < 0.15) {
    cursor = silenceEnds[0];
    silenceStarts.shift();
    silenceEnds.shift();
  } else if (silenceEnds.length > 0 && silenceStarts.length === 0) {
    return [];
  }

  const pairs = Math.min(silenceStarts.length, silenceEnds.length);
  for (let index = 0; index < pairs; index += 1) {
    if (silenceStarts[index] > cursor + 0.05) {
      segments.push({ start: cursor, end: silenceStarts[index] });
    }
    cursor = silenceEnds[index];
  }

  if (cursor < totalDuration - 0.05) {
    segments.push({ start: cursor, end: totalDuration });
  }

  return segments.length > 0 ? segments : [];
}

async function loadSamples(): Promise<VerifySample[]> {
  if (!process.env.DATABASE_URL) {
    console.warn("[warn] DATABASE_URL not set — skipping DB sample load");
    return [];
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const result = await client.query<VerifySample>(
      `
      SELECT id, topic, script, short_content, short_selected_hook, audio_path, image_paths
      FROM content_generations
      WHERE audio_path IS NOT NULL
        AND image_paths IS NOT NULL
        AND content_mode IN ('short', 'both')
      ORDER BY created_at DESC
      LIMIT 80
      `
    );

    const valid = result.rows.filter((row) => {
      const audioOk = row.audio_path && fs.existsSync(resolveProjectPath(row.audio_path));
      const imageOk = (row.image_paths ?? []).some((p) => fs.existsSync(resolveProjectPath(p)));
      return Boolean(audioOk && imageOk);
    });

    return valid.slice(0, SAMPLES_WANTED);
  } finally {
    client.release();
    await pool.end();
  }
}

async function extractFrame(videoPath: string, outputPath: string, timeSec: number): Promise<void> {
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-ss", timeSec.toFixed(3), "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath,
  ], { timeout: 30_000 });
}

async function computeImageSimilarity(referencePath: string, framePath: string): Promise<number> {
  const width = 180;
  const height = 320;
  const [reference, frame] = await Promise.all([
    sharp(referencePath).resize(width, height).removeAlpha().raw().toBuffer(),
    sharp(framePath).resize(width, height).removeAlpha().raw().toBuffer(),
  ]);
  let diffTotal = 0;
  for (let index = 0; index < reference.length; index += 1) {
    diffTotal += Math.abs(reference[index] - frame[index]);
  }
  const avgDiff = diffTotal / reference.length;
  return Math.max(0, Math.min(1, 1 - avgDiff / 255));
}

async function main() {
  process.env.SHORT_COVER_INTRO_ENABLED = "true";
  process.env.SHORT_COVER_DURATION_SEC = process.env.SHORT_COVER_DURATION_SEC || "1.5";
  process.env.SHORT_COVER_FADE_OUT_SEC = process.env.SHORT_COVER_FADE_OUT_SEC || "0.25";

  const introDurationSec = Number(process.env.SHORT_COVER_DURATION_SEC);
  const fadeOutSec = Number(process.env.SHORT_COVER_FADE_OUT_SEC);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  verify-short-cover-intro — smoke preview");
  console.log("  SHORT_COVER_INTRO_ENABLED=true");
  console.log(`  introDuration=${introDurationSec}s  fadeOut=${fadeOutSec}s`);
  console.log(`  Output: ${OUT_DIR}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const [{ runShortVideo }, { generateShortCover }, { generateShortCoverAsset }] = await Promise.all([
    import("@/lib/pipeline/short-video"),
    import("@/lib/short-cover-engine"),
    import("@/lib/image/short-cover-asset-generator"),
  ]);

  const samples = await loadSamples();
  if (samples.length === 0) {
    console.error("✗ No valid samples found. Check DATABASE_URL and that media files exist on disk.");
    process.exit(1);
  }

  console.log(`  Loaded ${samples.length} sample(s) from DB.\n`);

  const results: object[] = [];

  for (const [i, sample] of samples.entries()) {
    const sampleLabel = `[${i + 1}/${samples.length}]`;
    const sampleDir = path.join(OUT_DIR, `sample-${sample.id}`);
    fs.mkdirSync(sampleDir, { recursive: true });

    console.log(`${sampleLabel} ${sample.topic}`);
    console.log(`  ID       : ${sample.id}`);
    console.log(`  Hook     : ${(sample.short_selected_hook ?? "—").slice(0, 80)}`);

    const audioAbsPath = resolveProjectPath(sample.audio_path ?? "");

    // 1. Generate cover text + asset
    const cover = generateShortCover({
      topic: sample.topic,
      selectedHook: sample.short_selected_hook,
      script: sample.short_content || sample.script,
    });
    console.log(`  CoverText: "${cover.coverText}"`);

    let coverAsset;
    try {
      coverAsset = await generateShortCoverAsset({
        contentId: sample.id,
        topic: sample.topic,
        hookOrScriptExcerpt: sample.short_selected_hook || sample.short_content || sample.script,
        sourceImagePath: sample.image_paths?.[0] ?? null,
        coverText: cover.coverText,
        layoutPreset: "short_cover_hook",
      });
    } catch (e) {
      console.error(`  ✗ Cover asset generation failed: ${e instanceof Error ? e.message : e}`);
      results.push({ contentId: sample.id, topic: sample.topic, error: "cover_asset_failed" });
      continue;
    }

    const coverDestPath = path.join(sampleDir, "cover-asset.jpg");
    fs.copyFileSync(coverAsset.outputPath, coverDestPath);
    console.log(`  Cover    : ${coverDestPath}`);
    console.log(`  Readability: ${coverAsset.readabilityScore} | SafeArea: ${coverAsset.safeAreaPass}`);

    // 2. Render video (updates DB videoStatus, writes to media/videos/)
    console.log(`  Rendering video...`);
    let renderResult;
    try {
      renderResult = await runShortVideo(sample.id, false);
    } catch (e) {
      console.error(`  ✗ Render failed: ${e instanceof Error ? e.message : e}`);
      results.push({ contentId: sample.id, topic: sample.topic, error: "render_failed" });
      continue;
    }

    if (!renderResult.success) {
      console.error(`  ✗ Render error: ${renderResult.error}`);
      results.push({ contentId: sample.id, topic: sample.topic, error: renderResult.error });
      continue;
    }

    const videoSrcPath = resolveProjectPath(renderResult.videoPath);
    const videoDestPath = path.join(sampleDir, "video-preview.mp4");
    fs.copyFileSync(videoSrcPath, videoDestPath);

    // 3. Inspect output
    const videoMeta = await inspectMedia(videoSrcPath);
    const audioMeta = await inspectMedia(audioAbsPath);
    const audioDuration = audioMeta.durationSec;
    const videoDuration = videoMeta.durationSec;
    const fileSizeBytes = fs.statSync(videoDestPath).size;

    // 4. Extract first frame (t=0) and mid-intro frame (t = introDuration/2)
    const firstFramePath = path.join(sampleDir, "frame-first.jpg");
    const midIntroFramePath = path.join(sampleDir, "frame-mid-intro.jpg");
    const postIntroFramePath = path.join(sampleDir, "frame-post-intro.jpg");
    await extractFrame(videoSrcPath, firstFramePath, 0.05);
    await extractFrame(videoSrcPath, midIntroFramePath, introDurationSec * 0.5);
    await extractFrame(videoSrcPath, postIntroFramePath, introDurationSec + 0.2);

    // 5. Compare first frame similarity to cover asset
    let firstFrameSimilarity = 0;
    try {
      firstFrameSimilarity = await computeImageSimilarity(coverAsset.outputPath, firstFramePath);
    } catch { /* non-fatal */ }

    // 6. Subtitle info
    const speechSegments = await getAudioSpeechSegments(audioAbsPath, audioDuration);
    const wordTimestamps = await getWhisperWordTimestamps(audioAbsPath);
    const subtitleChunks = wordTimestamps.length >= 5
      ? buildSubtitleChunksFromWords(wordTimestamps, sample.short_content)
      : buildSubtitleChunks(sample.short_content, audioDuration, speechSegments.length > 0 ? speechSegments : undefined);
    const subtitleValidation = validateAndRepairSubtitleChunks(
      subtitleChunks,
      audioDuration,
      speechSegments.length > 0 ? speechSegments : undefined,
    );

    const result = {
      contentId: sample.id,
      topic: sample.topic,
      hook: sample.short_selected_hook,
      coverText: cover.coverText,
      coverConfidence: cover.confidence,
      coverAssetPath: coverDestPath,
      videoPath: videoDestPath,
      firstFramePath,
      midIntroFramePath,
      postIntroFramePath,
      introDurationSec,
      fadeOutSec,
      video: {
        durationSec: Number(videoDuration.toFixed(3)),
        audioDurationSec: Number(audioDuration.toFixed(3)),
        durationDeltaSec: Number((videoDuration - audioDuration).toFixed(3)),
        fileSizeBytes,
        fileSizeKb: Math.round(fileSizeBytes / 1024),
      },
      cover: {
        readabilityScore: coverAsset.readabilityScore,
        safeAreaPass: coverAsset.safeAreaPass,
        textLineCount: coverAsset.textLineCount,
        wordCount: coverAsset.coverTextWordCount,
        firstFrameSimilarity: Number(firstFrameSimilarity.toFixed(4)),
        startsWithCoverFrame: firstFrameSimilarity >= 0.85,
      },
      subtitles: {
        status: subtitleValidation.status,
        healthScore: subtitleValidation.subtitleHealthScore,
        exists: subtitleValidation.chunks.length > 0,
        firstChunkStartSec: subtitleValidation.metrics.firstSubtitleStartSec,
      },
      audio: {
        exists: fs.existsSync(audioAbsPath),
        startSec: Number(videoMeta.startSec.toFixed(4)),
      },
    };

    results.push(result);

    console.log(`  Video    : ${videoDestPath}`);
    console.log(`  Duration : video=${videoDuration.toFixed(2)}s  audio=${audioDuration.toFixed(2)}s  delta=${(videoDuration - audioDuration).toFixed(2)}s`);
    console.log(`  IntroSec : ${introDurationSec}s (expected cover overlay at t=0→${introDurationSec}s)`);
    console.log(`  FileSize : ${Math.round(fileSizeBytes / 1024)}KB`);
    console.log(`  1st frame sim to cover: ${(firstFrameSimilarity * 100).toFixed(1)}% (startsWithCover=${firstFrameSimilarity >= 0.85})`);
    console.log(`  Subtitle : status=${subtitleValidation.status} score=${subtitleValidation.subtitleHealthScore}/100 chunks=${subtitleValidation.chunks.length}`);
    console.log(`  Audio    : exists=${fs.existsSync(audioAbsPath)}`);
    console.log(`  Frames   : ${firstFramePath}`);
    console.log(`             ${midIntroFramePath}`);
    console.log(`             ${postIntroFramePath}`);
    console.log();
  }

  // Save report
  const reportPath = path.join(OUT_DIR, "report.json");
  const report = {
    generatedAt: new Date().toISOString(),
    featureFlags: {
      SHORT_COVER_INTRO_ENABLED: true,
      SHORT_COVER_DURATION_SEC: introDurationSec,
      SHORT_COVER_FADE_OUT_SEC: fadeOutSec,
    },
    samplesRendered: results.length,
    outputDir: OUT_DIR,
    results,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Rendered  : ${results.length} sample(s)`);
  console.log(`  Report    : ${reportPath}`);
  console.log(`  Output dir: ${OUT_DIR}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("Visual check checklist (inspect the video files manually):");
  console.log("  1. Cover intro visible at t=0 → 1.5s?");
  console.log("  2. Text readable (not cropped, not too small)?");
  console.log("  3. Text does not overlap subtitle region?");
  console.log("  4. Transition to main video not jarring?");
  console.log("  5. Audio not shifted or muted?");
  console.log("  6. frame-first.jpg matches cover-asset.jpg?");
  console.log("  7. frame-post-intro.jpg shows main video content (not cover)?");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
