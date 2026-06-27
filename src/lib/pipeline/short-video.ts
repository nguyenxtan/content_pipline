import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";
import { contentGenerations, niches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createPromptVersionEntry, mergePromptVersions } from "@/lib/prompt-version-registry";
import {
  buildSubtitleChunks,
  buildSubtitleChunksFromWords,
  buildAssFile,
  SpeechSegment,
  validateAndRepairSubtitleChunks,
  WordTimestamp,
  buildSubtitleRenderMetadata,
  SubtitleRenderMetadata,
} from "@/lib/video/subtitle";
import { getLibx264Args, getVideoToolboxArgs, isAppleSilicon } from "@/lib/pipeline/perf";
import { generateShortCover } from "@/lib/short-cover-engine";
import { generateShortCoverAsset } from "@/lib/image/short-cover-asset-generator";

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
const SHORT_COVER_INTRO_DURATION_DEFAULT_SEC = 1.5;
const SHORT_COVER_INTRO_FADE_OUT_DEFAULT_SEC = 0.25;
const PHAT_PHAP_SHORT_FORMATS = new Set(["tts_short", "legacy_quote_short"]);

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Ken Burns slow-zoom flag — disabled by default until experiment is validated.
// When enabled, applies a subtle 100→103% zoom over the full video duration.
// Phase 3 implementation: set SHORT_ZOOM_ENABLED=true in .env.local to activate.
const SHORT_ZOOM_ENABLED = readBooleanEnv("SHORT_ZOOM_ENABLED", false);

function getShortCoverIntroConfig(audioDuration: number): {
  enabled: boolean;
  durationSec: number;
  fadeOutSec: number;
} {
  const enabled = readBooleanEnv("SHORT_COVER_INTRO_ENABLED", false);
  const durationSec = Math.max(
    0.25,
    Math.min(audioDuration, readNumberEnv("SHORT_COVER_DURATION_SEC", SHORT_COVER_INTRO_DURATION_DEFAULT_SEC))
  );
  const fadeOutSec = Math.max(
    0,
    Math.min(durationSec - 0.05, readNumberEnv("SHORT_COVER_FADE_OUT_SEC", SHORT_COVER_INTRO_FADE_OUT_DEFAULT_SEC))
  );

  return { enabled, durationSec, fadeOutSec };
}

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
  | { success: true; videoPath: string; durationMs: number; subtitleHealthScore: number; subtitleStatus: "PASS" | "FAIL"; subtitleMetadata: SubtitleRenderMetadata }
  | { success: false; error: string };

/**
 * Resolve a cross-platform fonts directory for ffmpeg subtitles filter.
 * Returns null if no known font directory exists (ffmpeg uses system default).
 */
function resolveFontsDir(): string | null {
  const candidates = [
    "/Library/Fonts",                  // macOS system
    `${process.env.HOME}/Library/Fonts`, // macOS user
    "/usr/share/fonts",                // Linux (Debian/Ubuntu/CentOS)
    "/usr/local/share/fonts",          // Linux user-installed
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }
  return null;
}

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
    const shortCoverIntro = getShortCoverIntroConfig(audioDuration);

    // Prefer Whisper word timestamps for accurate subtitle alignment
    const speechSegments = await getAudioSpeechSegments(absAudio, audioDuration);
    const wordTimestamps = await getWhisperWordTimestamps(absAudio);

    // validationSegments: reference speech bounds used for drift checking.
    // When Whisper succeeds, use Whisper's first/last word times — this is more
    // accurate than silencedetect when AiMax audio has trailing reverb or low-level
    // noise that silencedetect wrongly marks as speech (causes false drift failures).
    let validationSegments: SpeechSegment[] | undefined;
    let chunks;
    if (wordTimestamps.length >= 5) {
      chunks = buildSubtitleChunksFromWords(wordTimestamps, shortContent);
      const whisperStart = wordTimestamps[0].start;
      const whisperEnd = wordTimestamps[wordTimestamps.length - 1].end;
      validationSegments = [{ start: whisperStart, end: whisperEnd }];
      console.log(
        `[subtitle] contentId=${contentId} provider=aimax whisperRange=${whisperStart.toFixed(2)}–${whisperEnd.toFixed(2)}s` +
        ` audioDuration=${audioDuration.toFixed(2)}s trailingNoise=${(audioDuration - whisperEnd).toFixed(2)}s`,
      );
    } else {
      chunks = buildSubtitleChunks(shortContent, audioDuration, speechSegments.length > 0 ? speechSegments : undefined);
      validationSegments = speechSegments.length > 0 ? speechSegments : undefined;
    }
    const subtitleValidation = validateAndRepairSubtitleChunks(
      chunks,
      audioDuration,
      validationSegments,
    );
    chunks = subtitleValidation.chunks;
    if (subtitleValidation.status === "FAIL") {
      throw new Error(
        `Subtitle validation failed (${subtitleValidation.subtitleHealthScore}/100): ${subtitleValidation.issues.join(" ")}`
      );
    }
    const n = absImages.length;
    const imageDurations = buildImageDurations(audioDuration, n);
    const coverDuration = Math.min(imageDurations[0], SHORT_COVER_OVERLAY_SEC);
    // When cover intro is enabled, suppress subtitle events that fall inside the intro window
    // so the opening cover text is not visually cluttered by simultaneous subtitle lines.
    // Chunks wholly inside the window are dropped; chunks crossing the boundary are clamped.
    // This only affects the .ass render — subtitle validation already ran on the full chunk set.
    const introCutSec = shortCoverIntro.enabled ? shortCoverIntro.durationSec : 0;
    const renderChunks = introCutSec > 0
      ? chunks
          .map(c => c.end <= introCutSec ? null : c.start < introCutSec ? { ...c, start: introCutSec } : c)
          .filter((c): c is NonNullable<typeof c> => c !== null)
      : chunks;
    fs.writeFileSync(assPath, buildAssFile(renderChunks, VIDEO_WIDTH, VIDEO_HEIGHT, contentId, SHORT_SUBTITLE_MARGIN_V), "utf-8");
    if (!shortCoverIntro.enabled) {
      fs.writeFileSync(coverAssPath, buildCoverAssFile(chooseCoverTitle(topic, shortContent), coverDuration), "utf-8");
    }
    const args: string[] = ["-y"];
    for (const [index, img] of absImages.entries()) {
      args.push("-loop", "1", "-t", imageDurations[index].toFixed(3), "-i", img);
    }
    // Trim audio to 60s max before feeding into FFmpeg
    args.push("-t", String(SHORT_MAX_SEC), "-i", absAudio);
    if (bgMusic) args.push("-stream_loop", "-1", "-i", bgMusic);

    // ── Short Cover Asset ─────────────────────────────────────────────────────
    // Generated unconditionally for tracking + potential first-frame overlay.
    // Non-fatal: video render continues if generation fails.
    let shortCoverAssetPath: string | null = null;   // absolute path (for FFmpeg)
    let coverAssetRelPath: string | null = null;     // relative path (for DB, ADR-019)
    let introCoverText: string | null = null;
    let coverReason: string | null = null;
    let coverConfidence: number | null = null;
    let coverStatus: "generated" | "reused_existing" | "metadata_only" | "missing" = "missing";
    let coverError: string | null = null;
    let coverWasReused = false;
    try {
      const cover = generateShortCover({
        topic,
        selectedHook: item.shortSelectedHook,
        script: shortContent || item.script,
      });
      introCoverText = cover.coverText;
      coverReason = cover.coverReason;
      coverConfidence = cover.confidence;
      const relPath = `media/covers/${contentId}-short-cover.jpg`;
      const existingAbsPath = item.shortCoverAssetPath
        ? path.join(process.cwd(), item.shortCoverAssetPath.replace(/^\/+/, ""))
        : null;
      if (existingAbsPath && fs.existsSync(existingAbsPath)) {
        shortCoverAssetPath = existingAbsPath;
        coverAssetRelPath = item.shortCoverAssetPath!;
        coverWasReused = true;
        coverStatus = "reused_existing";
        console.log(`[COVER_ASSET] reused | coverText: "${cover.coverText}" | path: ${relPath} | 1080x1920`);
      } else {
        const coverAsset = await generateShortCoverAsset({
          contentId,
          topic,
          hookOrScriptExcerpt: item.shortSelectedHook || shortContent || item.script,
          sourceImagePath: (imagePaths as string[])[0] ?? null,
          coverText: cover.coverText,
          layoutPreset: "short_cover_hook",
        });
        shortCoverAssetPath = coverAsset.outputPath;
        coverAssetRelPath = relPath;
        coverStatus = "generated";
        console.log(
          `[COVER_ASSET] generated | coverText: "${cover.coverText}" | path: ${relPath}` +
          ` | ${coverAsset.width}x${coverAsset.height} | readability: ${coverAsset.readabilityScore} | reused: false`
        );
      }
    } catch (coverErr) {
      const coverErrMsg = coverErr instanceof Error ? coverErr.message : String(coverErr);
      coverError = coverErrMsg;
      if (introCoverText) coverStatus = "metadata_only";
      console.error(`[COVER_ASSET] failed for ${contentId}: ${coverErrMsg}`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (shortCoverIntro.enabled && shortCoverAssetPath) {
      args.push("-loop", "1", "-t", shortCoverIntro.durationSec.toFixed(3), "-i", shortCoverAssetPath);
    }

    // Ken Burns: when SHORT_ZOOM_ENABLED, apply a subtle 100→103% zoom over each image's duration.
    // Zoompan upscales by 3% first so the zoom has headroom without black borders.
    const buildImageScaleFilter = (i: number, durationSec: number): string => {
      if (SHORT_ZOOM_ENABLED) {
        const totalFrames = Math.ceil(durationSec * 30);
        // Zoom from 1.00 to 1.03 over the clip, centred
        return (
          `[${i}:v]scale=${Math.round(VIDEO_WIDTH * 1.06)}:${Math.round(VIDEO_HEIGHT * 1.06)}` +
          `:force_original_aspect_ratio=increase,crop=${Math.round(VIDEO_WIDTH * 1.06)}:${Math.round(VIDEO_HEIGHT * 1.06)},setsar=1,` +
          `zoompan=z='1+0.001*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=30` +
          `[v${i}]`
        );
      }
      return `[${i}:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1[v${i}]`;
    };

    const scaleFilters = absImages.map((_, i) =>
      buildImageScaleFilter(i, imageDurations[i] ?? audioDuration)
    ).join(";");
    const concatIn  = absImages.map((_, i) => `[v${i}]`).join("");
    const escapedAss = escapeAssPath(assPath);
    const fontsDir = resolveFontsDir();
    const assFilter = fontsDir
      ? `ass='${escapedAss}':fontsdir='${escapeAssPath(fontsDir)}'`
      : `ass='${escapedAss}'`;
    const coverWindowExpr = `between(t,0,${coverDuration.toFixed(3)})`;
    const titleScrim = `drawbox=x=0:y=0:w=iw:h=360:color=black@0.14:t=fill:enable='${coverWindowExpr}'`;
    const titleAccent = `drawbox=x=${SHORT_COVER_ACCENT_X}:y=${SHORT_COVER_ACCENT_Y}:w=${SHORT_COVER_ACCENT_WIDTH}:h=${SHORT_COVER_ACCENT_HEIGHT}:color=white@0.96:t=fill:enable='${coverWindowExpr}'`;
    const audioInputIndex = n;
    const bgMusicInputIndex = bgMusic ? n + 1 : null;
    const shortCoverInputIndex = shortCoverIntro.enabled && shortCoverAssetPath ? n + (bgMusic ? 2 : 1) : null;
    const introFadeStart = Math.max(0, shortCoverIntro.durationSec - shortCoverIntro.fadeOutSec);

    let filterComplex: string;
    let audioMap: string;
    if (shortCoverIntro.enabled && shortCoverInputIndex !== null) {
      const introFilters = [
        scaleFilters,
        `${concatIn}concat=n=${n}:v=1:a=0[vraw]`,
        `[${shortCoverInputIndex}:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1,format=rgba,fade=t=out:st=${introFadeStart.toFixed(3)}:d=${shortCoverIntro.fadeOutSec.toFixed(3)}:alpha=1[vintro]`,
        `[vraw][vintro]overlay=0:0:enable='lt(t,${shortCoverIntro.durationSec.toFixed(3)})'[vbase]`,
        `[vbase]${assFilter}[vout]`,
      ];

      if (bgMusic && bgMusicInputIndex !== null) {
        introFilters.push(
          `[${bgMusicInputIndex}:a]volume=0.12,atrim=duration=${audioDuration.toFixed(3)}[bgm]`,
          `[${audioInputIndex}:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`
        );
        audioMap = "[aout]";
      } else {
        audioMap = `${audioInputIndex}:a`;
      }

      filterComplex = introFilters.join(";");
    } else if (bgMusic) {
      const escapedCoverAss = escapeAssPath(coverAssPath);
      const coverAssFilter = fontsDir
        ? `ass='${escapedCoverAss}':fontsdir='${escapeAssPath(fontsDir)}'`
        : `ass='${escapedCoverAss}'`;
      filterComplex = [
        scaleFilters,
        `${concatIn}concat=n=${n}:v=1:a=0[vraw]`,
        `[vraw]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.15:t=fill:enable='${coverWindowExpr}'[vdim]`,
        `[vdim]${titleScrim}[vscrim]`,
        `[vscrim]${titleAccent}[vband]`,
        `[vband]${coverAssFilter}[vcover]`,
        `[vcover]${assFilter}[vout]`,
        `[${bgMusicInputIndex}:a]volume=0.12,atrim=duration=${audioDuration.toFixed(3)}[bgm]`,
        `[${audioInputIndex}:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      ].join(";");
      audioMap = "[aout]";
    } else {
      const escapedCoverAss = escapeAssPath(coverAssPath);
      const coverAssFilter = fontsDir
        ? `ass='${escapedCoverAss}':fontsdir='${escapeAssPath(fontsDir)}'`
        : `ass='${escapedCoverAss}'`;
      filterComplex = [
        scaleFilters,
        `${concatIn}concat=n=${n}:v=1:a=0[vraw]`,
        `[vraw]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.15:t=fill:enable='${coverWindowExpr}'[vdim]`,
        `[vdim]${titleScrim}[vscrim]`,
        `[vscrim]${titleAccent}[vband]`,
        `[vband]${coverAssFilter}[vcover]`,
        `[vcover]${assFilter}[vout]`,
      ].join(";");
      audioMap = `${audioInputIndex}:a`;
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

    // Build and persist subtitle render metadata sidecar
    const subtitleMetadata = buildSubtitleRenderMetadata({
      contentId,
      videoPath:    relVideo,
      subtitlePath: assPath,   // temp path; already flushed to disk at this point
      marginV:      SHORT_SUBTITLE_MARGIN_V,
      subtitleExists: true,    // we wrote it above; any error before this would have thrown
    });
    const metadataPath = path.join(VIDEOS_DIR, `${contentId}-short-subtitle-meta.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(subtitleMetadata, null, 2), "utf-8");

    if (subtitleMetadata.validationResult === "FAIL") {
      const errMsg = `Subtitle render validation failed: ${subtitleMetadata.validationErrors.join("; ")}`;
      await db.update(contentGenerations)
        .set({ videoStatus: "error", videoErrorMessage: errMsg })
        .where(eq(contentGenerations.id, contentId));
      return { success: false, error: errMsg };
    }

    const coverSourceFields = [
      "topic",
      item.shortSelectedHook ? "shortSelectedHook" : null,
      shortContent ? "shortContent" : null,
      item.script ? "script" : null,
      item.hookPattern ? "hookPattern" : null,
      item.hookType ? "hookType" : null,
    ].filter((value): value is string => Boolean(value));
    const coverPromptVersions = mergePromptVersions(item.promptVersions, {
      cover: createPromptVersionEntry("cover", {
        mode: "short",
        details: {
          status: coverStatus,
          metadataSource: "render_pipeline_v1",
          coverText: introCoverText,
          coverReason,
          confidence: coverConfidence,
          sourceFields: coverSourceFields,
          assetPath: coverAssetRelPath,
          assetSupported: Boolean(shortCoverAssetPath || coverAssetRelPath),
          error: coverError,
        },
      }),
    });

    await db.update(contentGenerations)
      .set({
        videoStatus: "done",
        videoPath: relVideo,
        videoErrorMessage: null,
        promptVersions: coverPromptVersions,
        ...(introCoverText ? {
          shortCoverText: introCoverText,
        } : {}),
        ...(coverAssetRelPath ? {
          shortCoverAssetPath: coverAssetRelPath,
          ...(!coverWasReused ? { shortCoverGeneratedAt: new Date() } : {}),
        } : {}),
      })
      .where(eq(contentGenerations.id, contentId));

    if (
      item.channelKey === "phat_phap" &&
      PHAT_PHAP_SHORT_FORMATS.has(item.formatType ?? "") &&
      !introCoverText
    ) {
      console.warn(
        `[COVER_COVERAGE] missing metadata | contentId=${contentId} | channel=phat_phap | format=${item.formatType ?? "null"}`
      );
    }

    // When cover intro was rendered, persist experiment tracking fields.
    // Guards: write only if not already set. Experiment fields are stamped before render
    // by the controlled rollout script, so == null means "not a rollout item" → skip.
    if (shortCoverIntro.enabled && introCoverText) {
      const needsThumb      = !item.thumbnailText?.trim();
      const needsExpId      = item.experimentId      == null;
      const needsExpVariant = item.experimentVariant == null;
      if (needsThumb || needsExpId || needsExpVariant) {
        await db.update(contentGenerations)
          .set({
            ...(needsThumb      ? { thumbnailText:    introCoverText }          : {}),
            ...(needsExpId      ? { experimentId:     "short-cover-intro-v1" }  : {}),
            ...(needsExpVariant ? { experimentVariant: "intro_on_1p5s" }         : {}),
          })
          .where(eq(contentGenerations.id, contentId));
      }
    }

    return {
      success: true,
      videoPath: relVideo,
      durationMs,
      subtitleHealthScore: subtitleValidation.subtitleHealthScore,
      subtitleStatus: subtitleValidation.status,
      subtitleMetadata,
    };
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
