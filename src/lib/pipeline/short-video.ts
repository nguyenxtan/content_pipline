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
const VIDEOS_DIR      = path.join(process.cwd(), "media", "videos");
const MUSIC_BASE      = path.join(process.cwd(), "media", "music");
const VIDEO_WIDTH     = 1080;
const VIDEO_HEIGHT    = 1920;
const SHORT_MAX_SEC   = 60;
const SHORT_COVER_OVERLAY_SEC = 10;
const SHORT_COVER_HOLD_SEC = 1.8;
const SHORT_MIN_OTHER_SEC  = 0.35;
const SHORT_COVER_ACCENT_X = 72;
const SHORT_COVER_ACCENT_Y = 132;
const SHORT_COVER_ACCENT_WIDTH = 8;
const SHORT_COVER_ACCENT_HEIGHT = 190;
const SHORT_SUBTITLE_MARGIN_V = 340;

function pickBgMusic(category: string, seed: string): string | null {
  const dir = path.join(MUSIC_BASE, category);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".mp3") || f.endsWith(".m4a"));
  if (files.length === 0) return null;
  const n = seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return path.join(dir, files[n % files.length]);
}

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
    const result = await execFileAsync(pythonBin, [WHISPER_SCRIPT, absPath], { timeout: 120_000 });
    const data = JSON.parse(result.stdout) as { success: boolean; words?: WordTimestamp[] };
    if (!data.success || !data.words || data.words.length < 5) return [];
    return data.words;
  } catch {
    return [];
  }
}

async function getAudioSpeechSegments(absPath: string, totalDuration: number): Promise<SpeechSegment[]> {
  const result = await execFileAsync(FFMPEG_PATH, ["-i", absPath, "-af", "silencedetect=n=-40dB:d=0.2", "-f", "null", "-"], { timeout: 30_000 })
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

export type ShortVideoResult =
  | { success: true; videoPath: string; durationMs: number }
  | { success: false; error: string };

function buildImageDurations(totalDuration: number, count: number): number[] {
  if (count <= 1) return [totalDuration];

  const maxCover = Math.min(
    SHORT_COVER_HOLD_SEC,
    totalDuration - SHORT_MIN_OTHER_SEC * (count - 1)
  );
  if (maxCover <= SHORT_MIN_OTHER_SEC) {
    return Array.from({ length: count }, () => totalDuration / count);
  }

  const rest = (totalDuration - maxCover) / (count - 1);
  return [maxCover, ...Array.from({ length: count - 1 }, () => rest)];
}

function toAssTime(seconds: number): string {
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const ss = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function delaySubtitleChunks(chunks: { start: number; end: number; text: string }[], delaySec: number, totalDuration: number) {
  if (delaySec <= 0) return chunks;

  return chunks
    .map((chunk) => {
      const shiftedStart = Math.min(chunk.start + delaySec, totalDuration);
      const shiftedEnd = Math.min(chunk.end + delaySec, totalDuration);
      return {
        ...chunk,
        start: shiftedStart,
        end: Math.max(shiftedStart + 0.12, shiftedEnd),
      };
    })
    .filter((chunk) => chunk.start < totalDuration);
}

function chooseCoverTitle(topic: string | null | undefined, shortContent: string | null | undefined): string {
  const topicText = topic?.trim().replace(/\s+/g, " ") ?? "";
  if (topicText) {
    const clauses = topicText.split(/[:|]/).map((part) => part.trim()).filter(Boolean);
    const featured = clauses.find((part) => part.length >= 14 && part.length <= 48);
    return (featured ?? topicText).slice(0, 72).trim();
  }

  const fallback = shortContent?.trim().replace(/\s+/g, " ") ?? "Short Video";
  return fallback.slice(0, 72).trim();
}

function wrapCoverTitleLines(title: string, maxLineLength = 18, maxLines = 3): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["Short Video"];

  const lines: string[] = [];
  let current = words[0];
  let index = 1;
  while (index < words.length && lines.length < maxLines - 1) {
    const next = `${current} ${words[index]}`;
    if (next.length <= maxLineLength) {
      current = next;
      index += 1;
      continue;
    }
    lines.push(current);
    current = words[index];
    index += 1;
  }
  const tail = [current, ...words.slice(index)].filter(Boolean).join(" ").trim();
  if (tail) lines.push(tail);

  const normalized = lines
    .slice(0, maxLines)
    .map((line, index) => {
      if (index < maxLines - 1) return line;
      return line.length > maxLineLength + 8 ? `${line.slice(0, maxLineLength + 5).trimEnd()}...` : line;
    });

  return normalized;
}

function buildCoverAssFile(title: string, duration: number, width = VIDEO_WIDTH, height = VIDEO_HEIGHT): string {
  const lines = wrapCoverTitleLines(title, 14, 3).map((line) =>
    line.replace(/\{/g, "\\{").replace(/\}/g, "\\}")
  );
  const safeText = lines
    .map((line, index) => {
      const color = index === lines.length - 1 ? "&H0099E6FF" : "&H00FFFFFF";
      return `{\\c${color}}${line}`;
    })
    .join("\\N");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cover,Arial,86,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,1,0,1,6,0,7,108,120,176,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${toAssTime(duration)},Cover,,0,0,0,,{\\an7\\fad(70,120)\\fsp1\\blur0.6}${safeText}`;
}

function escapeAssPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * @param bgMusicOverride  undefined/null = use niche.musicFolder; true = force enable (still needs musicFolder);
 *                         false = force disable regardless of niche setting
 */
export async function runShortVideo(contentId: string, bgMusicOverride?: boolean | null): Promise<ShortVideoResult> {
  const item = await db.query.contentGenerations.findFirst({ where: eq(contentGenerations.id, contentId) });
  if (!item) return { success: false, error: "Không tìm thấy content" };

  const { audioPath, imagePaths, shortContent, nicheId, topic } = item;
  const relAudio = audioPath?.replace(/^\/+/, "") ?? null;
  const absAudio = relAudio ? path.join(process.cwd(), relAudio) : null;
  if (!absAudio || !fs.existsSync(absAudio)) return { success: false, error: "Audio chưa được tạo" };
  if (!imagePaths || imagePaths.length === 0)  return { success: false, error: "Ảnh chưa được tạo" };

  const absImages = (imagePaths as string[]).map(p => path.join(process.cwd(), p));
  for (const img of absImages) {
    if (!fs.existsSync(img)) return { success: false, error: `Ảnh không tồn tại: ${img}` };
  }

  // Resolve niche music folder
  const niche = nicheId ? await db.query.niches.findFirst({ where: eq(niches.id, nicheId) }) : null;
  const musicCategory = niche?.musicFolder ?? null;
  // bgMusicOverride=false → no music; bgMusicOverride=true or undefined → use niche folder if set
  const bgMusic = bgMusicOverride === false ? null : (musicCategory ? pickBgMusic(musicCategory, contentId) : null);

  await db.update(contentGenerations)
    .set({ videoStatus: "processing", videoErrorMessage: null, videoPath: null })
    .where(eq(contentGenerations.id, contentId));

  const startMs = Date.now();
  const assPath = path.join(os.tmpdir(), `${contentId}.ass`);
  const coverAssPath = path.join(os.tmpdir(), `${contentId}-cover.ass`);

  try {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    const outputPath = path.join(VIDEOS_DIR, `${contentId}-short.mp4`);
    const thumbPath  = path.join(VIDEOS_DIR, `${contentId}-short-thumb.jpg`);

    const rawDuration   = await getAudioDuration(absAudio);
    const audioDuration = Math.min(rawDuration, SHORT_MAX_SEC);

    // Prefer Whisper word timestamps for accurate subtitle alignment
    const wordTimestamps = await getWhisperWordTimestamps(absAudio);
    let chunks;
    if (wordTimestamps.length >= 5) {
      chunks = buildSubtitleChunksFromWords(wordTimestamps, shortContent);
    } else {
      const speechSegments = await getAudioSpeechSegments(absAudio, audioDuration);
      chunks = buildSubtitleChunks(shortContent, audioDuration, speechSegments.length > 0 ? speechSegments : undefined);
    }
    const n = absImages.length;
    const imageDurations = buildImageDurations(audioDuration, n);
    const coverDuration = Math.min(imageDurations[0], SHORT_COVER_OVERLAY_SEC);
    const subtitleChunks = delaySubtitleChunks(chunks, coverDuration, audioDuration);
    fs.writeFileSync(assPath, buildAssFile(subtitleChunks, VIDEO_WIDTH, VIDEO_HEIGHT, contentId, SHORT_SUBTITLE_MARGIN_V), "utf-8");
    fs.writeFileSync(coverAssPath, buildCoverAssFile(chooseCoverTitle(topic, shortContent), coverDuration), "utf-8");
    const args: string[] = ["-y"];
    for (const [index, img] of absImages.entries()) {
      args.push("-loop", "1", "-t", imageDurations[index].toFixed(3), "-i", img);
    }
    // Trim audio to 60s max before feeding into FFmpeg
    args.push("-t", String(SHORT_MAX_SEC), "-i", absAudio);
    if (bgMusic) args.push("-stream_loop", "-1", "-i", bgMusic);

    const scaleFilters = absImages.map((_, i) =>
      `[${i}:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1[v${i}]`
    ).join(";");
    const concatIn  = absImages.map((_, i) => `[v${i}]`).join("");
    const escapedAss = escapeAssPath(assPath);
    const escapedCoverAss = escapeAssPath(coverAssPath);
    const assFilter = `ass='${escapedAss}':fontsdir='/Library/Fonts'`;
    const coverAssFilter = `ass='${escapedCoverAss}':fontsdir='/Library/Fonts'`;
    const coverWindowExpr = `between(t,0,${coverDuration.toFixed(3)})`;
    const titleScrim = `drawbox=x=0:y=0:w=iw:h=360:color=black@0.14:t=fill:enable='${coverWindowExpr}'`;
    const titleAccent = `drawbox=x=${SHORT_COVER_ACCENT_X}:y=${SHORT_COVER_ACCENT_Y}:w=${SHORT_COVER_ACCENT_WIDTH}:h=${SHORT_COVER_ACCENT_HEIGHT}:color=white@0.96:t=fill:enable='${coverWindowExpr}'`;

    let filterComplex: string;
    let audioMap: string;
    if (bgMusic) {
      filterComplex = [
        scaleFilters,
        `${concatIn}concat=n=${n}:v=1:a=0[vraw]`,
        `[vraw]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.15:t=fill:enable='${coverWindowExpr}'[vdim]`,
        `[vdim]${titleScrim}[vscrim]`,
        `[vscrim]${titleAccent}[vband]`,
        `[vband]${coverAssFilter}[vcover]`,
        `[vcover]${assFilter}[vout]`,
        `[${n + 1}:a]volume=0.12,atrim=duration=${audioDuration.toFixed(3)}[bgm]`,
        `[${n}:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      ].join(";");
      audioMap = "[aout]";
    } else {
      filterComplex = [
        scaleFilters,
        `${concatIn}concat=n=${n}:v=1:a=0[vraw]`,
        `[vraw]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.15:t=fill:enable='${coverWindowExpr}'[vdim]`,
        `[vdim]${titleScrim}[vscrim]`,
        `[vscrim]${titleAccent}[vband]`,
        `[vband]${coverAssFilter}[vcover]`,
        `[vcover]${assFilter}[vout]`,
      ].join(";");
      audioMap = `${n}:a`;
    }

    const baseArgs = [...args, "-filter_complex", filterComplex, "-map", "[vout]", "-map", audioMap];
    const audioOutputArgs = ["-c:a", "aac", "-b:a", "128k", "-t", String(SHORT_MAX_SEC), "-movflags", "+faststart", outputPath];

    try {
      const videoArgs = isAppleSilicon() ? getVideoToolboxArgs("short") : getLibx264Args("short");
      await execFileAsync(FFMPEG_PATH, [...baseArgs, ...videoArgs, ...audioOutputArgs], { timeout: 300_000 });
    } catch (err) {
      if (!isAppleSilicon()) throw err;
      await execFileAsync(FFMPEG_PATH, [...baseArgs, ...getLibx264Args("short"), ...audioOutputArgs], { timeout: 300_000 });
    }

    const thumbSec = Math.min(Math.max(imageDurations[0] * 0.35, 0.4), 0.9).toFixed(2);
    await execFileAsync(FFMPEG_PATH, ["-y", "-ss", thumbSec, "-i", outputPath, "-vframes", "1", "-q:v", "2", thumbPath], { timeout: 30_000 });

    const durationMs = Date.now() - startMs;
    const relVideo   = `media/videos/${contentId}-short.mp4`;
    await db.update(contentGenerations)
      .set({ videoStatus: "done", videoPath: relVideo, videoErrorMessage: null })
      .where(eq(contentGenerations.id, contentId));

    return { success: true, videoPath: relVideo, durationMs };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 600);
    await db.update(contentGenerations)
      .set({ videoStatus: "error", videoErrorMessage: msg })
      .where(eq(contentGenerations.id, contentId));
    return { success: false, error: msg };
  } finally {
    try { fs.unlinkSync(assPath); } catch { /* ignore */ }
    try { fs.unlinkSync(coverAssPath); } catch { /* ignore */ }
  }
}
