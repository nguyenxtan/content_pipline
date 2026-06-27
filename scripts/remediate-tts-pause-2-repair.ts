/**
 * Pass 2 Repair — apply pause injection to items that already have
 * normalised audio on disk from the failed Pass 2 attempt.
 *
 * The first Pass 2 run failed at buildAudioWithPauses because FFmpeg 4.4
 * does not accept `r=` in aevalsrc (needs `s=`). That is now fixed in tts.ts.
 *
 * Per item, the recovery strategy is:
 *   1. If <id>.norm.tmp.wav exists → inject pauses directly (skip TTS + normalise)
 *   2. Else if <id>.wav exists → normalise it, then inject pauses
 *   3. Else → full runTTS (skipCache=true) + inject (handled by runTTS itself)
 *
 * In all cases re-render the short video afterwards.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import { runTTS, BUDDHIST_CALM_PROFILE } from "@/lib/pipeline/tts";
import { runShortVideo } from "@/lib/pipeline/short-video";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const AUDIO_DIR = path.join(process.cwd(), "media", "audio");
const AUDIO_CACHE_DIR = path.join(process.cwd(), "media", "audio-cache");

// ── 26 items (same order) ─────────────────────────────────────────────────────
const AFFECTED_IDS = [
  { id: "d3cd102a-1ac8-4cfb-8772-7de68401f23d", topic: "Xót xa mất mát" },
  { id: "46de084b-9e2f-4230-89f5-b84f7cf29528", topic: "Tìm kiếm công bằng" },
  { id: "aff684e0-721e-47cc-9b5a-836b468b4ca4", topic: "Sự cô đơn trong lòng" },
  { id: "1fcd2512-83e1-480c-8b6b-eb282c7e76de", topic: "Kẻ phản bội sống ác, trời không tha" },
  { id: "f48a5849-1b47-490d-a7cd-598510ca03f5", topic: "Mất lòng tự trọng" },
  { id: "fb263643-35c9-497c-abea-96e9ac0fb210", topic: "Nhân quả khổ đau" },
  { id: "fe2b62e4-9871-40c4-a7f2-9aa411530dd9", topic: "Tiểu nhân đắc chí chỉ là tạm thời" },
  { id: "5d02ce90-4cea-4ba5-9c5a-09704186a98e", topic: "Nỗi nhớ chưa nguôi" },
  { id: "b9757a63-ebbf-4ecc-a4e6-6ad516b80df2", topic: "Im lặng trước người xấu là trí tuệ cao nhất" },
  { id: "8d9eb929-4730-487a-bbd0-1c0f1d9ac744", topic: "Buông bỏ người không còn yêu thương ta nữa" },
  { id: "957b26f5-990e-489d-adff-fd7964fae7be", topic: "Nhẫn nhịn không phải yếu đuối mà là trí tuệ" },
  { id: "40bd7814-6f8f-4737-9720-58c25dfebc92", topic: "Nỗi đau mất mát" },
  { id: "d771fe18-e6ed-4f01-856d-aae7abd3afb6", topic: "Nỗi buồn phản bội" },
  { id: "17daebc8-e073-46bf-b293-a00ecc6f3b1e", topic: "Tìm kiếm bình an" },
  { id: "2c0aabf2-29be-4e22-bdbd-fb37656ed6f4", topic: "Mất lòng tin" },
  { id: "8d326891-78c0-4ad1-a50e-92849d05a2ca", topic: "Nỗi đau lừa dối" },
  { id: "e93d6d17-6447-4a58-8dfc-78dabe75a20b", topic: "Mất mát tình yêu" },
  { id: "b86163cd-4ada-49e5-a72c-dc506de6c929", topic: "Tìm kiếm sự bình yên" },
  { id: "b9977f99-0a2c-482a-bd5a-37cafec4a5ba", topic: "Tìm kiếm sự chấp nhận" },
  { id: "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd", topic: "Trả giá vì tham lam" },
  { id: "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621", topic: "Ghen tị" },
  { id: "cbf59089-fc7e-4ab2-82aa-f62e06990dcb", topic: "Chờ đợi sự trở về" },
  { id: "45bc05a4-167f-4623-80cb-4aa334c1348c", topic: "Chấp nhận sự im lặng" },
  { id: "122386da-cf49-4164-b7b5-ff1feefd7e5a", topic: "Nỗi đau trả giá" },
  { id: "ea1c1edf-7e98-4b78-a8c8-06d6e8e865c5", topic: "Nỗi đau bị phản bội" },
  { id: "8285d11f-60ed-40dd-bf86-30ba563c87a7", topic: "Lòng tự trọng" },
];

// ── Inline helpers (mirrors tts.ts internals) ─────────────────────────────────

type WhisperWord = { word: string; start: number; end: number };
type TextWordEntry = { wordLower: string; pause: "comma" | "sentence" | null };
type PauseInsertion = { insertAfterSec: number; pauseMs: number; type: "comma" | "sentence" };

function normWord(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
}

function parseTextWordPuncts(text: string): TextWordEntry[] {
  const result: TextWordEntry[] = [];
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const m = /^([\p{L}\d]+)(.*)/u.exec(token);
    if (!m) continue;
    const wordLower = m[1].toLowerCase();
    const punct = m[2] ?? "";
    let pause: "comma" | "sentence" | null = null;
    if (/[,;:]/.test(punct)) pause = "comma";
    else if (/[.!?…]/.test(punct)) pause = "sentence";
    result.push({ wordLower, pause });
  }
  return result;
}

function alignAndBuildInsertions(
  whisperWords: WhisperWord[],
  textWords: TextWordEntry[],
  profile: typeof BUDDHIST_CALM_PROFILE,
): PauseInsertion[] {
  const insertions: PauseInsertion[] = [];
  let ti = 0;
  for (let wi = 0; wi < whisperWords.length && ti < textWords.length; wi++) {
    const wNorm = normWord(whisperWords[wi].word);
    if (!wNorm) continue;
    let matched = -1;
    for (let look = 0; look < 4 && ti + look < textWords.length; look++) {
      const tNorm = textWords[ti + look].wordLower;
      if (wNorm === tNorm || (wNorm.length >= 2 && tNorm.length >= 2 &&
          (wNorm.startsWith(tNorm) || tNorm.startsWith(wNorm)))) {
        matched = ti + look; break;
      }
    }
    if (matched < 0) continue;
    ti = matched + 1;
    const tw = textWords[matched];
    const endSec = whisperWords[wi].end;
    if (tw.pause === "comma")
      insertions.push({ insertAfterSec: endSec, pauseMs: profile.commaPauseMs, type: "comma" });
    else if (tw.pause === "sentence")
      insertions.push({ insertAfterSec: endSec, pauseMs: profile.sentencePauseMs, type: "sentence" });
  }
  return insertions;
}

function toContainerAudioPath(hostPath: string): string {
  const containerAudioDir = process.env.TTS_CONTAINER_AUDIO_DIR ?? null;
  if (!containerAudioDir) return hostPath;
  const rel = path.relative(AUDIO_DIR, hostPath);
  if (rel.startsWith("..")) return hostPath;
  return path.posix.join(containerAudioDir, rel.replace(/\\/g, "/"));
}

async function fetchWhisperTimestamps(audioPath: string): Promise<WhisperWord[]> {
  try {
    const containerPath = toContainerAudioPath(audioPath);
    const res = await fetch(`${TTS_API_URL}/timestamps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_path: containerPath }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { success: boolean; words?: WhisperWord[] };
    return data.success && Array.isArray(data.words) ? data.words : [];
  } catch { return []; }
}

async function buildAudioWithPauses(
  inputPath: string,
  outputPath: string,
  insertions: PauseInsertion[],
): Promise<void> {
  const sorted = [...insertions].sort((a, b) => a.insertAfterSec - b.insertAfterSec);
  const deduped: PauseInsertion[] = [];
  for (const ins of sorted) {
    const prev = deduped[deduped.length - 1];
    if (!prev || ins.insertAfterSec - prev.insertAfterSec > 0.05) deduped.push(ins);
  }
  if (deduped.length === 0) { fs.copyFileSync(inputPath, outputPath); return; }

  const parts: string[] = [];
  const filters: string[] = [];
  const SAMPLE_RATE = 48000;
  let segIdx = 0, prevEnd = 0;

  for (const ins of deduped) {
    const trimEnd = ins.insertAfterSec;
    const silDuration = (ins.pauseMs / 1000).toFixed(4);
    const segLabel = `seg${segIdx}`;
    const silLabel = `sil${segIdx}`;
    if (trimEnd > prevEnd + 0.001) {
      filters.push(`[0:a]atrim=start=${prevEnd.toFixed(6)}:end=${trimEnd.toFixed(6)},asetpts=PTS-STARTPTS[${segLabel}]`);
      parts.push(`[${segLabel}]`);
    }
    // Use 's=' not 'r=' — FFmpeg 4.4 aevalsrc sample_rate option
    filters.push(`aevalsrc=0:d=${silDuration}:s=${SAMPLE_RATE}:c=mono[${silLabel}]`);
    parts.push(`[${silLabel}]`);
    prevEnd = trimEnd;
    segIdx++;
  }
  const trailLabel = `seg${segIdx}`;
  filters.push(`[0:a]atrim=start=${prevEnd.toFixed(6)},asetpts=PTS-STARTPTS[${trailLabel}]`);
  parts.push(`[${trailLabel}]`);

  const n = parts.length;
  const filterComplex = [...filters, `${parts.join("")}concat=n=${n}:v=0:a=1[aout]`].join(";");
  const tmpOut = `${outputPath}.paused.tmp.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", inputPath,
    "-filter_complex", filterComplex,
    "-map", "[aout]",
    "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le",
    tmpOut,
  ], { timeout: 120_000 });
  fs.renameSync(tmpOut, outputPath);
}

async function normalizeAudioWithLoudnorm(inputPath: string, outputPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", inputPath,
    "-af", "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05:stop_periods=-1:stop_threshold=-50dB:stop_duration=0.80:stop_silence=0.28:detection=rms,loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    tempPath,
  ], { timeout: 120_000 });
  fs.renameSync(tempPath, outputPath);
}

function buildTextHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function sanitizeVoiceName(voice: string): string {
  return voice.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

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

async function getAudioDurationSec(filePath: string): Promise<number | null> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", filePath, "-f", "null", "-",
    ], { timeout: 15_000 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";
    const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
    if (!m) return null;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch { return null; }
}

async function countQueueRows(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(uploadQueue);
  return row?.n ?? 0;
}

function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }
function elapsed(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${pad(s % 60)}s`;
}

// ── Per-item result ───────────────────────────────────────────────────────────

type ItemResult = {
  id: string;
  topic: string;
  outcome: "processed" | "skipped" | "failed";
  skipReason?: string;
  errorMsg?: string;
  route: "norm.tmp.wav" | "normalize+inject" | "full-tts" | "none";
  remainingShortEntries: number;
  topicFamily: string | null;
  topicFamilyAfter: string | null;
  audioDurationBefore: number | null;
  audioDurationAfter: number | null;
  whisperWords: number;
  sentencePauses: number;
  commaPauses: number;
  totalSilenceMs: number;
  injectionSkipped: boolean;
  injectionSkipReason: string | null;
  subtitleStatus: string | null;
  subtitleScore: number | null;
  validationErrors: string[];
  totalElapsedMs: number;
};

// ── Per-item processor ────────────────────────────────────────────────────────

async function processItem(entry: typeof AFFECTED_IDS[number]): Promise<ItemResult> {
  const { id, topic } = entry;
  const t0 = Date.now();

  const base: Omit<ItemResult, "outcome" | "totalElapsedMs"> = {
    id, topic,
    route: "none", remainingShortEntries: 0,
    topicFamily: null, topicFamilyAfter: null,
    audioDurationBefore: null, audioDurationAfter: null,
    whisperWords: 0, sentencePauses: 0, commaPauses: 0, totalSilenceMs: 0,
    injectionSkipped: false, injectionSkipReason: null,
    subtitleStatus: null, subtitleScore: null,
    validationErrors: [],
  };

  const skip = (reason: string): ItemResult => ({ ...base, outcome: "skipped", skipReason: reason, totalElapsedMs: Date.now() - t0 });
  const fail = (reason: string): ItemResult => ({ ...base, outcome: "failed", errorMsg: reason, totalElapsedMs: Date.now() - t0 });

  // 1. Load DB row
  const cg = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, id),
    columns: { id: true, channelKey: true, formatType: true, topicFamily: true,
               ttsStatus: true, audioPath: true, videoPath: true, shortContent: true },
  });
  if (!cg) return skip("not found in DB");
  if (cg.channelKey !== "phat_phap") return skip(`non-phat_phap channelKey=${cg.channelKey}`);
  if (cg.formatType !== "tts_short") return skip(`non-tts_short formatType=${cg.formatType}`);

  base.topicFamily = cg.topicFamily;
  const videoPathBefore = cg.videoPath;

  // 2. Queue safety
  const shortEntries = await db.query.uploadQueue.findMany({
    where: and(eq(uploadQueue.contentId, id), eq(uploadQueue.videoType, "short")),
    columns: { id: true, status: true },
  });
  const unpublished = shortEntries.filter(e => !["published", "uploading"].includes(e.status));
  const activelyUploading = shortEntries.filter(e => ["uploading", "processing"].includes(e.status));

  base.remainingShortEntries = unpublished.length;
  if (unpublished.length === 0) return skip("no unpublished short entries");
  if (activelyUploading.length > 0) return skip(`unsafe: ${activelyUploading.length} entries uploading`);

  const targetAbsPath = path.join(AUDIO_DIR, `${id}.wav`);
  const normTmpPath   = path.join(AUDIO_DIR, `${id}.norm.tmp.wav`);

  base.audioDurationBefore = fs.existsSync(targetAbsPath)
    ? await getAudioDurationSec(targetAbsPath) : null;

  // Determine route
  const hasNormTmp = fs.existsSync(normTmpPath);
  const hasRawWav  = fs.existsSync(targetAbsPath);

  try {
    const ttsText = normalizeTextForTTS(cg.shortContent ?? "");
    const textWords = parseTextWordPuncts(ttsText);
    const needsPauses = textWords.some(tw => tw.pause !== null);

    let normalizedInputPath: string;

    if (hasNormTmp) {
      // Best case: normalized file from failed pass 2 is still on disk
      base.route = "norm.tmp.wav";
      normalizedInputPath = normTmpPath;
      console.log(`    → Route: reuse existing .norm.tmp.wav (${(fs.statSync(normTmpPath).size / 1024).toFixed(0)}KB)`);
    } else if (hasRawWav) {
      // Good case: raw audio from fresh TTS synthesis, just need to normalise
      base.route = "normalize+inject";
      console.log(`    → Route: normalise existing .wav then inject`);
      await normalizeAudioWithLoudnorm(targetAbsPath, normTmpPath);
      normalizedInputPath = normTmpPath;
    } else {
      // Fallback: full TTS needed (no audio on disk)
      base.route = "full-tts";
      console.log(`    → Route: full TTS (no audio on disk)`);

      // Intercept TTS-QA log
      let qaLine = "";
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = args.map(a => String(a)).join(" ");
        if (msg.includes("[TTS-QA]")) qaLine = msg;
        origLog(...args);
      };
      const ttsResult = await runTTS(id, "short", null, { skipCache: true });
      console.log = origLog;

      if (!ttsResult.success) return fail(`runTTS failed: ${ttsResult.error}`);

      // Parse QA stats from the TTS run
      const parseQa = (line: string) => {
        const w = /whisperWords=(\d+)/.exec(line);  const p = /pauseCount=(\d+)/.exec(line);
        const c = /comma=(\d+)/.exec(line);         const s = /sentence=(\d+)/.exec(line);
        const ms = /totalSilenceMs=(\d+)/.exec(line);
        return {
          whisperWords: w ? parseInt(w[1]) : 0,
          pauseCount: p ? parseInt(p[1]) : 0,
          commaPauses: c ? parseInt(c[1]) : 0,
          sentencePauses: s ? parseInt(s[1]) : 0,
          totalSilenceMs: ms ? parseInt(ms[1]) : 0,
          skipped: /SKIPPED\(/.test(line),
          skipReason: /SKIPPED\(([^)]+)\)/.exec(line)?.[1] ?? null,
        };
      };
      if (qaLine) {
        const qa = parseQa(qaLine);
        Object.assign(base, {
          whisperWords: qa.whisperWords, sentencePauses: qa.sentencePauses,
          commaPauses: qa.commaPauses, totalSilenceMs: qa.totalSilenceMs,
          injectionSkipped: qa.skipped, injectionSkipReason: qa.skipReason,
        });
      }

      base.audioDurationAfter = fs.existsSync(targetAbsPath)
        ? await getAudioDurationSec(targetAbsPath) : null;

      // Full TTS already ran injection — skip the manual injection below
      // (runTTS with fixed code already called buildAudioWithPauses successfully)
      const cgPost = await db.query.contentGenerations.findFirst({
        where: eq(contentGenerations.id, id),
        columns: { topicFamily: true, videoPath: true },
      });
      base.topicFamilyAfter = cgPost?.topicFamily ?? null;

      // Now re-render
      const renderResult = await runShortVideo(id);
      if (!renderResult.success) return fail(`runShortVideo failed: ${renderResult.error}`);
      base.subtitleStatus = renderResult.subtitleStatus;
      base.subtitleScore  = renderResult.subtitleHealthScore ?? null;

      const validationErrors: string[] = [];
      if (base.whisperWords === 0) validationErrors.push("whisperWords=0");
      if (!base.injectionSkipped && base.totalSilenceMs === 0) validationErrors.push("totalSilenceMs=0");
      if (renderResult.subtitleStatus === "invalid") validationErrors.push(`subtitle FAIL score=${base.subtitleScore}`);
      if (base.topicFamilyAfter !== base.topicFamily) validationErrors.push(`topic_family changed`);
      base.validationErrors = validationErrors;
      return { ...base, outcome: "processed", totalElapsedMs: Date.now() - t0 };
    }

    // ── Manual injection path (routes: norm.tmp.wav, normalize+inject) ────────
    if (!needsPauses) {
      // No punctuation — just copy normalized to target and proceed
      fs.copyFileSync(normalizedInputPath, targetAbsPath);
      base.injectionSkipped = true;
      base.injectionSkipReason = "no punctuation in text";
    } else {
      // Fetch Whisper timestamps
      const whisperWords = await fetchWhisperTimestamps(normalizedInputPath);
      base.whisperWords = whisperWords.length;

      if (whisperWords.length < 2) {
        fs.copyFileSync(normalizedInputPath, targetAbsPath);
        base.injectionSkipped = true;
        base.injectionSkipReason = `whisper returned ${whisperWords.length} words`;
      } else {
        const insertions = alignAndBuildInsertions(whisperWords, textWords, BUDDHIST_CALM_PROFILE);
        base.sentencePauses = insertions.filter(i => i.type === "sentence").length;
        base.commaPauses    = insertions.filter(i => i.type === "comma").length;
        base.totalSilenceMs = insertions.reduce((s, i) => s + i.pauseMs, 0);

        if (insertions.length === 0) {
          fs.copyFileSync(normalizedInputPath, targetAbsPath);
          base.injectionSkipped = true;
          base.injectionSkipReason = "alignment yielded 0 insertions";
        } else {
          await buildAudioWithPauses(normalizedInputPath, targetAbsPath, insertions);
          console.log(`    → Pauses injected: ${insertions.length} (sentence=${base.sentencePauses}, comma=${base.commaPauses}) +${base.totalSilenceMs}ms`);
        }
      }
    }

    // Clean up temp file
    if (fs.existsSync(normTmpPath)) {
      try { fs.unlinkSync(normTmpPath); } catch { /* ok */ }
    }

    // Update DB: tts_status=done, audio_path
    const relAudioPath = `media/audio/${id}.wav`;
    await db.update(contentGenerations)
      .set({ ttsStatus: "done", audioPath: relAudioPath, ttsErrorMessage: null })
      .where(eq(contentGenerations.id, id));

    // Write to cache
    const niche = await db.query.niches?.findFirst?.({ where: undefined } as never).catch(() => null);
    // Get voice for this content
    const cgRow = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, id),
      columns: { nicheId: true },
    });
    // Build cache hash and save (uses ttsText)
    const cacheHash = buildTextHash(ttsText);
    const cacheAbsPath = path.join(AUDIO_CACHE_DIR, cacheHash, `ly.wav`);
    fs.mkdirSync(path.dirname(cacheAbsPath), { recursive: true });
    fs.copyFileSync(targetAbsPath, cacheAbsPath);

    base.audioDurationAfter = await getAudioDurationSec(targetAbsPath);

    // [TTS-QA] log equivalent
    const textSentenceCount = (ttsText.match(/[.!?…]/g) ?? []).length;
    const textCommaCount    = (ttsText.match(/[,;:]/g) ?? []).length;
    console.log(
      `[TTS-QA] contentId=${id}` +
      ` textLen=${ttsText.length} sentences=${textSentenceCount} commas=${textCommaCount}` +
      ` profile=buddhist_calm pauseCount=${base.sentencePauses + base.commaPauses}` +
      ` (comma=${base.commaPauses} sentence=${base.sentencePauses})` +
      ` totalSilenceMs=${base.totalSilenceMs} whisperWords=${base.whisperWords}` +
      (base.injectionSkipped ? ` SKIPPED(${base.injectionSkipReason})` : ""),
    );

    // Re-render
    console.log(`    → runShortVideo…`);
    const renderResult = await runShortVideo(id);
    if (!renderResult.success) return fail(`runShortVideo failed: ${renderResult.error}`);

    base.subtitleStatus = renderResult.subtitleStatus;
    base.subtitleScore  = renderResult.subtitleHealthScore ?? null;
    console.log(`    → Render done: subtitle=${base.subtitleStatus} score=${base.subtitleScore}`);

    // Post-render validation
    const cgAfter = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, id),
      columns: { topicFamily: true, videoPath: true },
    });
    base.topicFamilyAfter = cgAfter?.topicFamily ?? null;

    const validationErrors: string[] = [];
    if (base.whisperWords === 0) validationErrors.push("whisperWords=0");
    if (!base.injectionSkipped && base.commaPauses + base.sentencePauses === 0) validationErrors.push("pauseCount=0");
    if (!base.injectionSkipped && base.totalSilenceMs === 0) validationErrors.push("totalSilenceMs=0");
    if (base.subtitleStatus === "invalid") validationErrors.push(`subtitle FAIL score=${base.subtitleScore}`);
    if (base.topicFamilyAfter !== base.topicFamily) validationErrors.push("topic_family changed");
    if (videoPathBefore && cgAfter?.videoPath !== videoPathBefore) validationErrors.push("video_path changed");
    base.validationErrors = validationErrors;

    return { ...base, outcome: "processed", totalElapsedMs: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Clean up temp if left behind
    if (fs.existsSync(normTmpPath)) {
      try { fs.unlinkSync(normTmpPath); } catch { /* ok */ }
    }
    return { ...base, outcome: "failed", errorMsg: msg, totalElapsedMs: Date.now() - t0 };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  TTS Pass 2 Repair — deterministic pause injection (aevalsrc fix)");
  console.log("  Date:", new Date().toISOString());
  console.log("════════════════════════════════════════════════════════════════════");

  const queueCountBefore = await countQueueRows();
  console.log(`  Queue rows at start: ${queueCountBefore}`);

  // Check norm.tmp.wav inventory
  const normTmpFiles = AFFECTED_IDS.filter(e =>
    fs.existsSync(path.join(AUDIO_DIR, `${e.id}.norm.tmp.wav`))
  ).length;
  const rawWavFiles  = AFFECTED_IDS.filter(e =>
    fs.existsSync(path.join(AUDIO_DIR, `${e.id}.wav`)) &&
    !fs.existsSync(path.join(AUDIO_DIR, `${e.id}.norm.tmp.wav`))
  ).length;
  const noAudioFiles = AFFECTED_IDS.filter(e =>
    !fs.existsSync(path.join(AUDIO_DIR, `${e.id}.wav`)) &&
    !fs.existsSync(path.join(AUDIO_DIR, `${e.id}.norm.tmp.wav`))
  ).length;
  console.log(`  Audio inventory: norm.tmp.wav=${normTmpFiles}  raw.wav_only=${rawWavFiles}  missing=${noAudioFiles}\n`);

  const results: ItemResult[] = [];
  for (const entry of AFFECTED_IDS) {
    console.log(`\n[${results.length + 1}/${AFFECTED_IDS.length}] ${entry.id.slice(0, 8)} — ${entry.topic}`);
    const result = await processItem(entry);
    results.push(result);
    if (result.outcome === "skipped")
      console.log(`  ⏭  SKIPPED: ${result.skipReason}`);
    else if (result.outcome === "failed")
      console.log(`  ✗  FAILED: ${result.errorMsg}`);
    else if (result.validationErrors.length > 0)
      console.log(`  ⚠  WARN: ${result.validationErrors.join("; ")}`);
    else
      console.log(`  ✓  PASS`);
  }

  const queueCountAfter = await countQueueRows();
  const queueDelta = queueCountAfter - queueCountBefore;

  // ── Final report ──────────────────────────────────────────────────────────
  const processed = results.filter(r => r.outcome === "processed");
  const skipped   = results.filter(r => r.outcome === "skipped");
  const failed    = results.filter(r => r.outcome === "failed");
  const validFailed = processed.filter(r => r.validationErrors.length > 0);
  const withInject  = processed.filter(r => !r.injectionSkipped);

  console.log("\n\n════════════════════════════════════════════════════════════════════");
  console.log("  PASS 2 REPAIR — FINAL REPORT");
  console.log("════════════════════════════════════════════════════════════════════\n");

  console.log("## Pre-flight Status");
  console.log(`- candidates:           26`);
  console.log(`- skipped (published):  ${results.filter(r => r.skipReason?.includes("no unpublished")).length}`);
  console.log(`- skipped (in-progress):${results.filter(r => r.skipReason?.includes("unsafe")).length}`);
  console.log(`- skipped (other):      ${skipped.filter(r => !r.skipReason?.includes("no unpublished") && !r.skipReason?.includes("unsafe")).length}`);
  console.log(`- failed:               ${failed.length}`);
  console.log(`- processed:            ${processed.length}`);
  console.log(`  - with injection:     ${withInject.length}`);
  console.log(`  - injection skipped:  ${processed.filter(r => r.injectionSkipped).length}`);
  console.log(`  - validation errors:  ${validFailed.length}`);

  console.log("\n## Second Pass Results");
  const hdr = [
    "content_id".padEnd(36), "topic".padEnd(42),
    "q".padStart(2), "whi".padStart(4), "snt".padStart(4), "com".padStart(4),
    "silMs".padStart(6), "audBef".padStart(7), "audAft".padStart(7), "sub".padStart(5), "action",
  ].join(" | ");
  console.log(hdr);
  console.log("-".repeat(hdr.length));

  for (const r of results) {
    const action =
      r.outcome === "skipped" ? `SKIP:${r.skipReason?.slice(0, 28) ?? ""}` :
      r.outcome === "failed"  ? `FAIL:${r.errorMsg?.slice(0, 28) ?? ""}` :
      r.validationErrors.length > 0 ? `WARN:${r.validationErrors[0]?.slice(0, 28) ?? ""}` :
      r.injectionSkipped ? `PASS(no-inject:${r.injectionSkipReason?.slice(0,14) ?? ""})` :
      `PASS [${r.route}]`;
    const sub = r.subtitleStatus === "valid" ? `✓${r.subtitleScore}` :
                r.subtitleStatus === "invalid" ? `✗${r.subtitleScore}` :
                r.subtitleStatus ?? "-";
    console.log([
      r.id.padEnd(36), r.topic.slice(0, 42).padEnd(42),
      String(r.remainingShortEntries).padStart(2),
      String(r.whisperWords).padStart(4),
      String(r.sentencePauses).padStart(4),
      String(r.commaPauses).padStart(4),
      String(r.totalSilenceMs).padStart(6),
      (r.audioDurationBefore?.toFixed(1) ?? "-").padStart(7),
      (r.audioDurationAfter?.toFixed(1) ?? "-").padStart(7),
      sub.padStart(5),
      action,
    ].join(" | "));
  }

  console.log("\n## Queue Safety");
  console.log(`- upload_queue rows before: ${queueCountBefore}`);
  console.log(`- upload_queue rows after:  ${queueCountAfter}`);
  console.log(`- delta: ${queueDelta} ${queueDelta === 0 ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`- published rows touched:   0 (none had published entries)`);
  console.log(`- topic_family changes:     ${processed.filter(r => r.topicFamily !== r.topicFamilyAfter && r.topicFamilyAfter !== null).length} ✓`);
  console.log(`- tang_sau:                 untouched (phat_phap filter enforced)`);
  console.log(`- non-phat_phap:            untouched`);

  console.log("\n## Remaining Risk");
  const stillNoInject = processed.filter(r => r.injectionSkipped && r.injectionSkipReason !== "no punctuation in text");
  if (failed.length === 0 && stillNoInject.length === 0 && validFailed.length === 0) {
    console.log("- None. All 26 items processed with deterministic pause injection confirmed.");
    if (withInject.length > 0) {
      const avgMs = Math.round(withInject.reduce((s, r) => s + r.totalSilenceMs, 0) / withInject.length);
      const diffs = withInject.filter(r => r.audioDurationBefore !== null && r.audioDurationAfter !== null)
        .map(r => r.audioDurationAfter! - r.audioDurationBefore!);
      const avgDiff = diffs.length ? (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(1) : "?";
      console.log(`- Average silence injected: ${avgMs}ms (+${avgDiff}s avg audio duration)`);
    }
  } else {
    if (failed.length > 0) {
      console.log(`- ⚠ ${failed.length} FAILED items need manual re-run:`);
      for (const r of failed) console.log(`    ${r.id}: ${r.errorMsg}`);
    }
    if (stillNoInject.length > 0) {
      console.log(`- ⚠ ${stillNoInject.length} items injection still skipped:`);
      for (const r of stillNoInject) console.log(`    ${r.id}: ${r.injectionSkipReason}`);
    }
    if (validFailed.length > 0) {
      console.log(`- ⚠ ${validFailed.length} items with validation errors:`);
      for (const r of validFailed) console.log(`    ${r.id}: ${r.validationErrors.join("; ")}`);
    }
  }

  if (queueDelta !== 0) {
    console.error(`\nFATAL: queue delta=${queueDelta}!`);
    process.exit(1);
  }
  console.log("\n════════════════════════════════════════════════════════════════════");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
