import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";
import pg from "pg";
import {
  buildSubtitleChunks,
  buildSubtitleChunksFromWords,
  validateAndRepairSubtitleChunks,
  type SpeechSegment,
  type WordTimestamp,
} from "@/lib/video/subtitle";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });
dotenv.config({ path: path.join(process.cwd(), ".env"), override: false });

const execFileAsync = promisify(execFile);
const { Pool } = pg;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH = ffmpegInstaller.path;
const WHISPER_SCRIPT = path.join(process.cwd(), "tts-server", "whisper_timestamps.py");
const VENV_PYTHON = path.join(process.env.HOME ?? "", "venv-tts-new", "bin", "python3");
const EXPERIMENT_ID = "SHORT_COVER_INTRO";
const EXPERIMENT_VARIANT = "COVER_INTRO_ON";

type CandidateRow = {
  id: string;
  topic: string;
  script: string;
  short_content: string;
  short_selected_hook: string | null;
  audio_path: string | null;
  image_paths: string[] | null;
  video_path: string | null;
  video_status: string | null;
  video_error_message: string | null;
  youtube_video_url: string | null;
  facebook_video_url: string | null;
  experiment_id: string | null;
  experiment_variant: string | null;
  created_at: string;
};

type SkippedItem = {
  contentId: string;
  topic: string;
  reason: string;
};

type SelectedItem = {
  contentId: string;
  topic: string;
  coverText: string;
  subtitleHealthScore: number;
  subtitleStatus: "PASS" | "FAIL";
  baselineVideoPath: string;
  outputVideoPath: string;
  coverPath: string;
  thumbPath: string | null;
  durationSec: number;
};

type Summary = {
  experimentId: typeof EXPERIMENT_ID;
  experimentVariant: typeof EXPERIMENT_VARIANT;
  featureFlags: {
    SHORT_COVER_INTRO_ENABLED: true;
    SHORT_COVER_DURATION_SEC: number;
    SHORT_COVER_FADE_OUT_SEC: number;
  };
  requested: number;
  selectedCount: number;
  selected: SelectedItem[];
  skipped: SkippedItem[];
  outputDir: string;
  generatedAt: string;
};

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function fileExists(filePath: string | null | undefined): filePath is string {
  return Boolean(filePath && fs.existsSync(resolveProjectPath(filePath)));
}

function readLimit(): number {
  const raw = process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
  const parsed = raw ? Number(raw) : 5;
  return Number.isFinite(parsed) ? Math.max(5, Math.min(10, parsed)) : 5;
}

async function inspectMedia(absPath: string): Promise<{ durationSec: number }> {
  const result = await execFileAsync(FFMPEG_PATH, ["-i", absPath, "-f", "null", "-"], { timeout: 30_000 })
    .catch((error: { stderr: string }) => ({ stderr: error.stderr }));
  const stderr = (result as { stderr: string }).stderr;
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!durationMatch) {
    throw new Error(`Unable to inspect media timing: ${absPath}`);
  }

  const durationSec =
    parseInt(durationMatch[1], 10) * 3600 +
    parseInt(durationMatch[2], 10) * 60 +
    parseFloat(durationMatch[3]);
  return { durationSec };
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
    "-i", absPath,
    "-af", "silencedetect=n=-40dB:d=0.2",
    "-f", "null", "-",
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

async function loadCandidates(limit: number): Promise<CandidateRow[]> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for prepare-short-cover-intro-experiment.ts");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const result = await client.query<CandidateRow>(
      `
      SELECT
        cg.id,
        cg.topic,
        cg.script,
        cg.short_content,
        cg.short_selected_hook,
        cg.audio_path,
        cg.image_paths,
        cg.video_path,
        cg.video_status,
        cg.video_error_message,
        cg.youtube_video_url,
        cg.facebook_video_url,
        cg.experiment_id,
        cg.experiment_variant,
        cg.created_at
      FROM content_generations cg
      WHERE cg.content_mode IN ('short', 'both')
        AND cg.video_status = 'done'
        AND cg.audio_path IS NOT NULL
        AND cg.video_path IS NOT NULL
        AND cg.image_paths IS NOT NULL
        AND cg.youtube_video_url IS NULL
        AND cg.facebook_video_url IS NULL
      ORDER BY cg.created_at DESC
      LIMIT $1
      `,
      [Math.max(limit * 4, 30)],
    );

    return result.rows.filter((row) => {
      const audioOk = fileExists(row.audio_path);
      const videoOk = fileExists(row.video_path);
      const imageOk = (row.image_paths ?? []).some((imagePath) => fileExists(imagePath));
      return audioOk && videoOk && imageOk;
    });
  } finally {
    client.release();
    await pool.end();
  }
}

async function computeSubtitleHealth(sample: CandidateRow): Promise<{
  subtitleHealthScore: number;
  subtitleStatus: "PASS" | "FAIL";
}> {
  const audioPath = resolveProjectPath(sample.audio_path ?? "");
  const { durationSec } = await inspectMedia(audioPath);
  const speechSegments = await getAudioSpeechSegments(audioPath, durationSec);
  const wordTimestamps = await getWhisperWordTimestamps(audioPath);
  const subtitleChunks = wordTimestamps.length >= 5
    ? buildSubtitleChunksFromWords(wordTimestamps, sample.short_content)
    : buildSubtitleChunks(sample.short_content, durationSec, speechSegments.length > 0 ? speechSegments : undefined);

  const subtitleValidation = validateAndRepairSubtitleChunks(
    subtitleChunks,
    durationSec,
    speechSegments.length > 0 ? speechSegments : undefined,
  );

  return {
    subtitleHealthScore: subtitleValidation.subtitleHealthScore,
    subtitleStatus: subtitleValidation.status,
  };
}

function copyIfExists(sourcePath: string | null | undefined, targetPath: string): boolean {
  if (!sourcePath || !fs.existsSync(sourcePath)) return false;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

async function updateExperimentMarker(contentId: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for updateExperimentMarker");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE content_generations
      SET experiment_id = $2, experiment_variant = $3
      WHERE id = $1
      `,
      [contentId, EXPERIMENT_ID, EXPERIMENT_VARIANT],
    );
  } finally {
    client.release();
    await pool.end();
  }
}

async function restoreVideoState(sample: CandidateRow): Promise<void> {
  if (!process.env.DATABASE_URL) return;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE content_generations
      SET video_status = $2,
          video_path = $3,
          video_error_message = $4
      WHERE id = $1
      `,
      [sample.id, sample.video_status, sample.video_path, sample.video_error_message],
    );
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  process.env.SHORT_COVER_INTRO_ENABLED = "true";
  process.env.SHORT_COVER_DURATION_SEC = process.env.SHORT_COVER_DURATION_SEC || "1.5";
  process.env.SHORT_COVER_FADE_OUT_SEC = process.env.SHORT_COVER_FADE_OUT_SEC || "0.25";

  const requested = readLimit();
  const candidates = await loadCandidates(requested);
  if (candidates.length === 0) {
    throw new Error("No unpublished render-ready short videos were found.");
  }

  const selectedCandidates: Array<CandidateRow & { subtitleHealthScore: number; subtitleStatus: "PASS" | "FAIL" }> = [];
  const skipped: SkippedItem[] = [];

  for (const candidate of candidates) {
    const subtitle = await computeSubtitleHealth(candidate);
    if (subtitle.subtitleStatus !== "PASS") {
      skipped.push({
        contentId: candidate.id,
        topic: candidate.topic,
        reason: `subtitle_validation_fail:${subtitle.subtitleHealthScore}`,
      });
      continue;
    }
    if (subtitle.subtitleHealthScore < 90) {
      skipped.push({
        contentId: candidate.id,
        topic: candidate.topic,
        reason: `subtitle_health_below_90:${subtitle.subtitleHealthScore}`,
      });
      continue;
    }

    selectedCandidates.push({
      ...candidate,
      subtitleHealthScore: subtitle.subtitleHealthScore,
      subtitleStatus: subtitle.subtitleStatus,
    });

    if (selectedCandidates.length >= requested) break;
  }

  if (selectedCandidates.length === 0) {
    throw new Error("No subtitle-safe short videos were found for the experiment batch.");
  }

  const [{ runShortVideo }, { generateShortCover }, { generateShortCoverAsset }] = await Promise.all([
    import("@/lib/pipeline/short-video"),
    import("@/lib/short-cover-engine"),
    import("@/lib/image/short-cover-asset-generator"),
  ]);

  const outputDir = path.join(process.cwd(), "output", "short-cover-intro-experiment");
  fs.mkdirSync(outputDir, { recursive: true });

  const selected: SelectedItem[] = [];

  for (const [index, sample] of selectedCandidates.entries()) {
    const ordinal = String(index + 1).padStart(2, "0");
    const baselineVideoAbs = resolveProjectPath(sample.video_path ?? "");
    const baselineThumbAbs = path.join(process.cwd(), "media", "videos", `${sample.id}-short-thumb.jpg`);
    const baselineSnapshotPath = path.join(outputDir, `${ordinal}-${sample.id}-baseline.mp4`);
    const outputVideoPath = path.join(outputDir, `${ordinal}-${sample.id}-cover-intro.mp4`);
    const outputThumbPath = path.join(outputDir, `${ordinal}-${sample.id}-cover-intro-thumb.jpg`);
    const backupVideoPath = path.join(outputDir, `${ordinal}-${sample.id}-baseline-backup.tmp.mp4`);
    const backupThumbPath = path.join(outputDir, `${ordinal}-${sample.id}-baseline-thumb-backup.tmp.jpg`);

    copyIfExists(baselineVideoAbs, baselineSnapshotPath);
    const hadBaselineThumb = copyIfExists(baselineThumbAbs, path.join(outputDir, `${ordinal}-${sample.id}-baseline-thumb.jpg`));
    copyIfExists(baselineVideoAbs, backupVideoPath);
    const hadThumbBackup = copyIfExists(baselineThumbAbs, backupThumbPath);

    const cover = generateShortCover({
      topic: sample.topic,
      selectedHook: sample.short_selected_hook,
      script: sample.short_content || sample.script,
    });

    const coverAsset = await generateShortCoverAsset({
      contentId: sample.id,
      topic: sample.topic,
      hookOrScriptExcerpt: sample.short_selected_hook || sample.short_content || sample.script,
      sourceImagePath: sample.image_paths?.[0] ?? null,
      coverText: cover.coverText,
      layoutPreset: "short_cover_hook",
    });

    try {
      const renderResult = await runShortVideo(sample.id, false);
      if (!renderResult.success) {
        skipped.push({
          contentId: sample.id,
          topic: sample.topic,
          reason: `render_failed:${renderResult.error}`,
        });
        continue;
      }

      const renderedVideoAbs = resolveProjectPath(renderResult.videoPath);
      fs.copyFileSync(renderedVideoAbs, outputVideoPath);
      copyIfExists(path.join(process.cwd(), "media", "videos", `${sample.id}-short-thumb.jpg`), outputThumbPath);

      await updateExperimentMarker(sample.id);

      const { durationSec } = await inspectMedia(outputVideoPath);
      selected.push({
        contentId: sample.id,
        topic: sample.topic,
        coverText: coverAsset.coverText,
        subtitleHealthScore: sample.subtitleHealthScore,
        subtitleStatus: sample.subtitleStatus,
        baselineVideoPath: baselineSnapshotPath,
        outputVideoPath,
        coverPath: coverAsset.outputPath,
        thumbPath: fs.existsSync(outputThumbPath) ? outputThumbPath : null,
        durationSec: Number(durationSec.toFixed(3)),
      });
    } finally {
      if (fs.existsSync(backupVideoPath)) {
        fs.copyFileSync(backupVideoPath, baselineVideoAbs);
        fs.unlinkSync(backupVideoPath);
      }
      if (hadThumbBackup && fs.existsSync(backupThumbPath)) {
        fs.copyFileSync(backupThumbPath, baselineThumbAbs);
        fs.unlinkSync(backupThumbPath);
      } else {
        try {
          fs.unlinkSync(backupThumbPath);
        } catch {
          // ignore
        }
        if (!hadBaselineThumb) {
          try {
            fs.unlinkSync(baselineThumbAbs);
          } catch {
            // ignore
          }
        }
      }

      await restoreVideoState(sample);
    }
  }

  const summary: Summary = {
    experimentId: EXPERIMENT_ID,
    experimentVariant: EXPERIMENT_VARIANT,
    featureFlags: {
      SHORT_COVER_INTRO_ENABLED: true,
      SHORT_COVER_DURATION_SEC: Number(process.env.SHORT_COVER_DURATION_SEC),
      SHORT_COVER_FADE_OUT_SEC: Number(process.env.SHORT_COVER_FADE_OUT_SEC),
    },
    requested,
    selectedCount: selected.length,
    selected,
    skipped,
    outputDir,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
