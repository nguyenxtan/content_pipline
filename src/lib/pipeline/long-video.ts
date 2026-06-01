import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";
import { contentGenerations, niches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { buildSubtitleChunks, buildSubtitleChunksFromWords, buildAssFile, SpeechSegment, WordTimestamp } from "@/lib/video/subtitle";
import { getLibx264Args, getVideoToolboxArgs, isAppleSilicon } from "@/lib/pipeline/perf";

const execFileAsync = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH  = ffmpegInstaller.path;
const VIDEOS_DIR   = path.join(process.cwd(), "media", "videos");
const MUSIC_BASE   = path.join(process.cwd(), "media", "music");
const VIDEO_WIDTH  = 1920;
const VIDEO_HEIGHT = 1080;
const MARGIN_V     = 80;

async function getAudioDuration(absPath: string): Promise<number> {
  const result = await execFileAsync(FFMPEG_PATH, ["-i", absPath, "-f", "null", "-"], { timeout: 30_000 })
    .catch((e: { stderr: string }) => ({ stderr: e.stderr }));
  const match = (result as { stderr: string }).stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!match) throw new Error("Không đọc được duration audio");
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
}

const WHISPER_SCRIPT = path.join(process.cwd(), "tts-server", "whisper_timestamps.py");
const VENV_PYTHON    = path.join(process.env.HOME ?? "", "venv-tts-new", "bin", "python3");

async function getWhisperWordTimestamps(absPath: string): Promise<WordTimestamp[]> {
  try {
    const pythonBin = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
    const result = await execFileAsync(pythonBin, [WHISPER_SCRIPT, absPath], { timeout: 300_000 });
    const data = JSON.parse(result.stdout) as { success: boolean; words?: WordTimestamp[] };
    if (!data.success || !data.words || data.words.length < 5) return [];
    return data.words;
  } catch {
    return [];
  }
}

async function getAudioSpeechSegments(absPath: string, totalDuration: number): Promise<SpeechSegment[]> {
  const result = await execFileAsync(FFMPEG_PATH, ["-i", absPath, "-af", "silencedetect=n=-40dB:d=0.2", "-f", "null", "-"], { timeout: 60_000 })
    .catch((e: { stderr: string }) => ({ stderr: e.stderr }));
  const stderr = (result as { stderr: string }).stderr;
  const silenceStarts: number[] = [];
  const silenceEnds: number[]   = [];
  for (const line of stderr.split("\n")) {
    const sStart = line.match(/silence_start:\s*([\d.]+)/);
    if (sStart) silenceStarts.push(parseFloat(sStart[1]));
    const sEnd = line.match(/silence_end:\s*([\d.]+)/);
    if (sEnd) silenceEnds.push(parseFloat(sEnd[1]));
  }
  const segments: SpeechSegment[] = [];
  let cursor = 0;
  // Only skip as "leading silence" if the first silence starts very close to 0
  if (silenceEnds.length > 0 && silenceStarts.length > 0 && silenceStarts[0] < 0.15) {
    cursor = silenceEnds[0]; silenceStarts.shift(); silenceEnds.shift();
  } else if (silenceEnds.length > 0 && silenceStarts.length === 0) return [];
  const pairs = Math.min(silenceStarts.length, silenceEnds.length);
  for (let i = 0; i < pairs; i++) {
    if (silenceStarts[i] > cursor + 0.05) segments.push({ start: cursor, end: silenceStarts[i] });
    cursor = silenceEnds[i];
  }
  if (cursor < totalDuration - 0.05) segments.push({ start: cursor, end: totalDuration });
  return segments.length > 0 ? segments : [];
}

function pickBgMusic(category: string, seed: string): string | null {
  const dir = path.join(MUSIC_BASE, category);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".mp3") || f.endsWith(".m4a"));
  if (files.length === 0) return null;
  const n = seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return path.join(dir, files[n % files.length]);
}

export type LongVideoResult =
  | { success: true; videoPath: string; durationMs: number }
  | { success: false; error: string };

export async function runLongVideo(contentId: string): Promise<LongVideoResult> {
  const item = await db.query.contentGenerations.findFirst({ where: eq(contentGenerations.id, contentId) });
  if (!item) return { success: false, error: "Không tìm thấy content" };

  const { longAudioPath, longContent, nicheId } = item;
  // Prefer dedicated long images; fall back to short images if long not ready
  const imagePaths = (item.longImagePaths as string[] | null)?.length
    ? item.longImagePaths
    : item.imagePaths;
  const relAudio = longAudioPath?.replace(/^\/+/, "") ?? null;
  const absAudio = relAudio ? path.join(process.cwd(), relAudio) : null;
  if (!absAudio || !fs.existsSync(absAudio)) return { success: false, error: "Long audio chưa được tạo" };

  // Resolve niche music folder
  const niche = nicheId ? await db.query.niches.findFirst({ where: eq(niches.id, nicheId) }) : null;
  const musicCategory = niche?.musicFolder ?? null;
  const bgMusic = musicCategory ? pickBgMusic(musicCategory, contentId) : null;

  await db.update(contentGenerations)
    .set({ longVideoStatus: "processing", longVideoErrorMessage: null, longVideoPath: null })
    .where(eq(contentGenerations.id, contentId));

  const startMs = Date.now();
  const assPath = path.join(os.tmpdir(), `${contentId}-long.ass`);

  try {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    const outputPath = path.join(VIDEOS_DIR, `${contentId}-long.mp4`);

    const audioDuration = await getAudioDuration(absAudio);

    // Prefer Whisper word timestamps for accurate subtitle alignment
    const wordTimestamps = await getWhisperWordTimestamps(absAudio);
    let chunks;
    if (wordTimestamps.length >= 5) {
      chunks = buildSubtitleChunksFromWords(wordTimestamps, longContent);
    } else {
      const speechSegments = await getAudioSpeechSegments(absAudio, audioDuration);
      chunks = buildSubtitleChunks(longContent, audioDuration, speechSegments.length > 0 ? speechSegments : undefined);
    }
    fs.writeFileSync(assPath, buildAssFile(chunks, VIDEO_WIDTH, VIDEO_HEIGHT, contentId, MARGIN_V), "utf-8");

    const hasBgm  = !!bgMusic;
    const absImages = ((imagePaths as string[] | null) ?? [])
      .map(p => path.join(process.cwd(), p))
      .filter(p => fs.existsSync(p));
    const hasImages = absImages.length > 0;

    const args: string[] = ["-y"];
    const escapedAss = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
    const assFilter = `ass='${escapedAss}':fontsdir='/Library/Fonts'`;

    let filterComplex: string;
    let audioMap: string;
    let audioInputIdx: number;

    if (hasImages) {
      // Slideshow mode (existing behavior)
      const n = absImages.length;
      const imgDur = (audioDuration / n).toFixed(3);
      for (const img of absImages) args.push("-loop", "1", "-t", imgDur, "-i", img);
      args.push("-i", absAudio);
      audioInputIdx = n;
      if (hasBgm) args.push("-stream_loop", "-1", "-i", bgMusic!);

      const scaleFilters = absImages.map((_, i) =>
        `[${i}:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1[v${i}]`
      ).join(";");
      const concatIn = absImages.map((_, i) => `[v${i}]`).join("");
      if (hasBgm) {
        filterComplex = [scaleFilters, `${concatIn}concat=n=${n}:v=1:a=0[vraw]`, `[vraw]${assFilter}[vout]`, `[${n + 1}:a]volume=0.15,atrim=duration=${audioDuration.toFixed(3)}[bgm]`, `[${n}:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`].join(";");
        audioMap = "[aout]";
      } else {
        filterComplex = [scaleFilters, `${concatIn}concat=n=${n}:v=1:a=0[vraw]`, `[vraw]${assFilter}[vout]`].join(";");
        audioMap = `${n}:a`;
      }
    } else {
      // Solid background mode — dark slate color, subtitles only
      args.push("-f", "lavfi", "-i", `color=c=#0f172a:size=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:rate=25`);
      args.push("-i", absAudio);
      audioInputIdx = 1;
      if (hasBgm) args.push("-stream_loop", "-1", "-i", bgMusic!);

      if (hasBgm) {
        filterComplex = [`[0:v]${assFilter}[vout]`, `[2:a]volume=0.15,atrim=duration=${audioDuration.toFixed(3)}[bgm]`, `[1:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`].join(";");
        audioMap = "[aout]";
      } else {
        filterComplex = `[0:v]${assFilter}[vout]`;
        audioMap = `${audioInputIdx}:a`;
      }
    }

    const baseArgs = [...args, "-filter_complex", filterComplex, "-map", "[vout]", "-map", audioMap];
    const audioOutputArgs = ["-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outputPath];

    try {
      const videoArgs = isAppleSilicon() ? getVideoToolboxArgs("long") : getLibx264Args("long");
      await execFileAsync(FFMPEG_PATH, [...baseArgs, ...videoArgs, ...audioOutputArgs], { timeout: 600_000 });
    } catch (err) {
      if (!isAppleSilicon()) throw err;
      await execFileAsync(FFMPEG_PATH, [...baseArgs, ...getLibx264Args("long"), ...audioOutputArgs], { timeout: 600_000 });
    }

    const durationMs = Date.now() - startMs;
    const relVideo   = `media/videos/${contentId}-long.mp4`;
    await db.update(contentGenerations)
      .set({ longVideoStatus: "done", longVideoPath: relVideo, longVideoErrorMessage: null })
      .where(eq(contentGenerations.id, contentId));

    return { success: true, videoPath: relVideo, durationMs };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 600);
    await db.update(contentGenerations)
      .set({ longVideoStatus: "error", longVideoErrorMessage: msg })
      .where(eq(contentGenerations.id, contentId));
    return { success: false, error: msg };
  } finally {
    try { fs.unlinkSync(assPath); } catch { /* ignore */ }
  }
}
