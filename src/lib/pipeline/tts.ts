import { db } from "@/lib/db";
import { contentGenerations, niches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  AIMAX_DEFAULTS,
  getAiMaxRuntimeConfig,
  isAudioStoryContext,
} from "@/lib/aimax-settings";
import { getContentProfile } from "@/lib/config/content-profiles";
import { getAiMaxVoiceMetadata } from "@/lib/aimax-voice-metadata";
import { runLongformNarration } from "@/lib/pipeline/longform-narration";
import { toContainerAudioPath } from "@/lib/pipeline/tts-paths";
import { createPromptVersionEntry, mergePromptVersions } from "@/lib/prompt-version-registry";
import { getFallbackVoice } from "@/lib/voice-rotation";
import {
  buildEffectiveTTSMetadata,
  getShortTtsProfileRoutingError,
  resolveConfiguredTTSVoice,
  resolvePipelineTTSConfig,
} from "@/services/tts/TTSService";
import { recordCacheHitUsage } from "@/services/tts/providers/AiMaxProvider";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const AUDIO_DIR = path.join(process.cwd(), "media", "audio");
const AUDIO_CACHE_DIR = path.join(process.cwd(), "media", "audio-cache");

export type TTSResult =
  | { success: true; audioPath: string; ttsDurationMs: number }
  | { success: false; error: string };

// ── Pause profiles ────────────────────────────────────────────────────────────

export type PauseProfile = {
  name: string;
  /** Silence injected after comma / semicolon / colon (ms) */
  commaPauseMs: number;
  /** Silence injected after period / question / exclamation (ms) */
  sentencePauseMs: number;
  /** Silence injected at paragraph boundaries (collapsed ". " from "\n\n") (ms) */
  paragraphPauseMs: number;
};

/** Default profile for Buddhist calm narration. */
export const BUDDHIST_CALM_PROFILE: PauseProfile = {
  name: "buddhist_calm",
  commaPauseMs: 220,
  sentencePauseMs: 560,
  paragraphPauseMs: 850,
};

/** Pause profile for serialized fiction audio stories.
 *  Shorter pauses than Buddhist narration to match faster fiction pacing.
 *  Used when Whisper injection is available; AiMax handles prosody internally. */
export const FICTION_STORY_PROFILE: PauseProfile = {
  name: "fiction_story",
  commaPauseMs: 120,
  sentencePauseMs: 280,
  paragraphPauseMs: 480,
};

function buildTextHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function sanitizeVoiceName(voice: string): string {
  return voice.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

function normalizeTuningNumber(value: number | null | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function buildShortCacheKey(params: {
  providerId: string;
  voiceId: string;
  speed: number | null | undefined;
  pitch: number | null | undefined;
  volume: number | null | undefined;
  normalize: boolean | null | undefined;
  model: string | null | undefined;
  language: string | null | undefined;
  textHash: string;
}): string {
  return crypto.createHash("sha256")
    .update([
      params.providerId,
      params.voiceId,
      normalizeTuningNumber(params.speed, 1).toFixed(3),
      normalizeTuningNumber(params.pitch, 0).toFixed(3),
      normalizeTuningNumber(params.volume, 1).toFixed(3),
      String(params.normalize ?? true),
      params.model ?? "",
      params.language ?? "",
      params.textHash,
    ].join("\0"), "utf8")
    .digest("hex");
}

async function persistShortTTSMetadata(params: {
  contentId: string;
  existingPromptVersions: unknown;
  metadata: ReturnType<typeof buildEffectiveTTSMetadata>;
  ttsDurationMs: number;
  audioPath: string;
}): Promise<void> {
  await db.update(contentGenerations)
    .set({
      ttsStatus: "done",
      audioPath: params.audioPath,
      ttsErrorMessage: null,
      ttsDurationMs: params.ttsDurationMs,
      promptVersions: mergePromptVersions(params.existingPromptVersions, {
        tts: createPromptVersionEntry("tts", {
          stage: "short_tts",
          mode: "short",
          details: params.metadata,
        }),
      }),
    })
    .where(eq(contentGenerations.id, params.contentId));
}

export function normalizeTextForTTS(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    // Prompt output can include Markdown separators like "---" at the start.
    // VieNeu-TTS may treat them as speakable/prosody tokens and stretch the
    // first real word, so strip standalone separators before newline folding.
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    // VieNeu-TTS (ngoc voice) elongates the second word in "nhX, nhY" pairs
    // (e.g. "nhà, như") — two words sharing the nh- initial across a comma.
    // Confirmed on GxR_7Ib73Nw: "như" stretched 10× (1.68s) at 00:11.
    // Convert the comma to a period to force a prosody break.
    // \p{L} required: \w is ASCII-only and misses Vietnamese diacritics.
    .replace(/(nh\p{L}*),\s*(nh)/gu, "$1. $2")
    .trim();
}

/**
 * Normalize raw TTS audio to broadcast-safe loudness.
 *
 * Two modes, selected by `useSilenceremove`:
 *
 *   false (phat_phap — ADR-024): loudnorm only.
 *     VieNeu-TTS natively produces 150–350ms prosodic pauses. silenceremove
 *     was found to strip 70–100% of these (native prosody test, 2026-06-12).
 *     Loudnorm alone preserves them faithfully and is safe to use.
 *
 *   true (other channels): silenceremove + loudnorm.
 *     Strips leading silence and interior dead-air > 800ms while keeping 280ms.
 *     Retained for channels where per-channel prosody audit has not been done.
 */
export async function normalizeAudioWithLoudnorm(
  inputPath: string,
  outputPath: string,
  options: { useSilenceremove?: boolean } = {},
): Promise<void> {
  const useSilenceremove = options.useSilenceremove ?? true;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp.wav`;
  const afFilter = useSilenceremove
    // silenceremove gated: strip leading silence + dead-air > 800ms, then loudnorm
    ? "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05:stop_periods=-1:stop_threshold=-50dB:stop_duration=0.80:stop_silence=0.28:detection=rms,loudnorm=I=-16:TP=-1.5:LRA=11"
    // loudnorm-only: preserve all native VieNeu prosodic pauses (ADR-024)
    : "loudnorm=I=-16:TP=-1.5:LRA=11";
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-i", inputPath,
    "-af", afFilter,
    "-ar", "48000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    tempPath,
  ], { timeout: 120_000 });
  fs.renameSync(tempPath, outputPath);
}

// ── Audio diagnostics helpers ─────────────────────────────────────────────────

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

/** Count silence segments ≥ minDurSec in an audio file using ffprobe silencedetect. */
async function countSilenceSegs(audioPath: string, minDurSec: number): Promise<number> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", audioPath,
      "-af", `silencedetect=noise=-50dB:d=${minDurSec}`,
      "-f", "null", "-",
    ], { timeout: 15_000 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";
    return (stderr.match(/silence_end/g) ?? []).length;
  } catch { return -1; }
}

// ── Whisper-backed punctuation pause injection ────────────────────────────────

type WhisperWord = { word: string; start: number; end: number };

/**
 * Fetch word-level timestamps from the TTS server's /timestamps endpoint.
 *
 * The TTS server may run inside Docker where AUDIO_DIR is mounted at a
 * different path. toContainerAudioPath() translates the host path to the
 * container-visible path before sending the request.
 *
 * Returns [] on any failure (pause injection is gracefully skipped).
 */
async function fetchWhisperTimestamps(audioPath: string): Promise<WhisperWord[]> {
  try {
    const containerPath = toContainerAudioPath(audioPath);
    // NOTE: Do NOT pass text as initial_prompt. Whisper treats initial_prompt as
    // "previously transcribed context" — sending the full audio text causes it to
    // skip the beginning of the audio and start transcribing from wherever it thinks
    // the audio "picks up" after the prompt. language="vi" in the server config is
    // sufficient for reliable Vietnamese transcription.
    const res = await fetch(`${TTS_API_URL}/timestamps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_path: containerPath }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { success: boolean; words?: WhisperWord[] };
    return data.success && Array.isArray(data.words) ? data.words : [];
  } catch {
    return [];
  }
}

/** Strip leading/trailing punctuation and lowercase for loose matching. */
function normWord(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
}

/**
 * Parse the normalizedText into (word, pauseType) pairs, tracking which words
 * are followed by punctuation that should trigger a pause.
 *
 * "paragraph boundary" is represented in normalizedText as ". " (from the
 * `\n{2,} → ". "` replacement in normalizeTextForTTS). We detect it by looking
 * for a sentence-ending period that was inserted between two sentence-case words
 * — but since we can't reliably distinguish real periods from injected ones, we
 * treat all "." as sentence pauses and use paragraphPauseMs only when a capital
 * letter follows (i.e. a real paragraph break was present in the original).
 */
type TextWordEntry = {
  wordLower: string;
  pause: "comma" | "sentence" | null;
};

function parseTextWordPuncts(text: string): TextWordEntry[] {
  const result: TextWordEntry[] = [];
  // Token-by-token: split on whitespace, extract leading word and trailing punctuation
  const tokens = text.split(/\s+/);
  for (const token of tokens) {
    if (!token) continue;
    // Extract leading word chars and trailing punct
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

/**
 * Align Whisper words to textWords by greedy forward scan with a small
 * lookahead window, then record pause-insertion points where textWords have
 * trailing punctuation.
 */
type PauseInsertion = {
  insertAfterSec: number;
  pauseMs: number;
  type: "comma" | "sentence";
};

function alignAndBuildInsertions(
  whisperWords: WhisperWord[],
  textWords: TextWordEntry[],
  profile: PauseProfile,
): PauseInsertion[] {
  const insertions: PauseInsertion[] = [];
  let ti = 0;

  for (let wi = 0; wi < whisperWords.length && ti < textWords.length; wi++) {
    const wNorm = normWord(whisperWords[wi].word);
    if (!wNorm) continue;

    // Look ahead up to 4 text tokens to find a match (handles Whisper splits/merges)
    let matched = -1;
    for (let look = 0; look < 4 && ti + look < textWords.length; look++) {
      const tNorm = textWords[ti + look].wordLower;
      if (
        wNorm === tNorm ||
        (wNorm.length >= 2 && tNorm.length >= 2 && (wNorm.startsWith(tNorm) || tNorm.startsWith(wNorm)))
      ) {
        matched = ti + look;
        break;
      }
    }

    if (matched < 0) continue;

    ti = matched + 1;
    const tw = textWords[matched];
    const endSec = whisperWords[wi].end;

    if (tw.pause === "comma") {
      insertions.push({ insertAfterSec: endSec, pauseMs: profile.commaPauseMs, type: "comma" });
    } else if (tw.pause === "sentence") {
      insertions.push({ insertAfterSec: endSec, pauseMs: profile.sentencePauseMs, type: "sentence" });
    }
  }

  return insertions;
}

/**
 * Build a single FFmpeg filter_complex that inserts silence at each pause point.
 * Audio must be 48000 Hz mono PCM (guaranteed by normalizeAudioWithLoudnorm output).
 *
 * Produces N+1 audio segments interleaved with N silence segments → concat.
 */
async function buildAudioWithPauses(
  inputPath: string,
  outputPath: string,
  insertions: PauseInsertion[],
): Promise<void> {
  // Deduplicate and sort by time; skip insertions too close together (< 50ms apart)
  const sorted = [...insertions].sort((a, b) => a.insertAfterSec - b.insertAfterSec);
  const deduped: PauseInsertion[] = [];
  for (const ins of sorted) {
    const prev = deduped[deduped.length - 1];
    if (!prev || ins.insertAfterSec - prev.insertAfterSec > 0.05) {
      deduped.push(ins);
    }
  }

  if (deduped.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }

  // Build filter_complex with atrim segments + aevalsrc silence + concat
  const parts: string[] = [];   // filter labels in order
  const filters: string[] = [];

  const SAMPLE_RATE = 48000;
  let segIdx = 0;
  let prevEnd = 0;

  for (const ins of deduped) {
    const trimEnd = ins.insertAfterSec;
    const silDuration = (ins.pauseMs / 1000).toFixed(4);
    const segLabel = `seg${segIdx}`;
    const silLabel = `sil${segIdx}`;

    if (trimEnd > prevEnd + 0.001) {
      filters.push(
        `[0:a]atrim=start=${prevEnd.toFixed(6)}:end=${trimEnd.toFixed(6)},asetpts=PTS-STARTPTS[${segLabel}]`
      );
      parts.push(`[${segLabel}]`);
    }
    // aevalsrc generates silence: 0 (mono), duration, 48kHz
    // Use 's' for sample_rate (not 'r') — compatible with FFmpeg 4.4+
    filters.push(
      `aevalsrc=0:d=${silDuration}:s=${SAMPLE_RATE}:c=mono[${silLabel}]`
    );
    parts.push(`[${silLabel}]`);

    prevEnd = trimEnd;
    segIdx++;
  }

  // Trailing segment after last insertion
  const trailLabel = `seg${segIdx}`;
  filters.push(`[0:a]atrim=start=${prevEnd.toFixed(6)},asetpts=PTS-STARTPTS[${trailLabel}]`);
  parts.push(`[${trailLabel}]`);

  const n = parts.length;
  const filterComplex = [...filters, `${parts.join("")}concat=n=${n}:v=0:a=1[aout]`].join(";");

  const tmpOut = `${outputPath}.paused.tmp.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-i", inputPath,
    "-filter_complex", filterComplex,
    "-map", "[aout]",
    "-ar", String(SAMPLE_RATE),
    "-ac", "1",
    "-c:a", "pcm_s16le",
    tmpOut,
  ], { timeout: 120_000 });

  fs.renameSync(tmpOut, outputPath);
}

/**
 * Inject deterministic punctuation pauses into a normalized TTS audio file.
 *
 * Steps:
 *  1. Fetch Whisper word timestamps from TTS server
 *  2. Align words to punctuation in normalizedText
 *  3. Insert silence at each punctuation boundary via FFmpeg filter_complex
 *  4. Return QA stats (for logging/validation)
 *
 * Fails gracefully: if Whisper is unavailable or alignment yields 0 insertions,
 * the audio is copied unchanged and stats reflect 0 pauses inserted.
 */
async function injectPunctuationPauses(
  inputPath: string,
  outputPath: string,
  normalizedText: string,
  profile: PauseProfile,
): Promise<{
  pauseCount: number;
  totalSilenceMs: number;
  commaCount: number;
  sentenceCount: number;
  whisperWordCount: number;
  skipped: boolean;
  skipReason?: string;
}> {
  const textWords = parseTextWordPuncts(normalizedText);
  const needsPauses = textWords.some(tw => tw.pause !== null);

  if (!needsPauses) {
    fs.copyFileSync(inputPath, outputPath);
    return { pauseCount: 0, totalSilenceMs: 0, commaCount: 0, sentenceCount: 0, whisperWordCount: 0, skipped: true, skipReason: "no punctuation in text" };
  }

  const whisperWords = await fetchWhisperTimestamps(inputPath);
  if (whisperWords.length < 2) {
    fs.copyFileSync(inputPath, outputPath);
    return { pauseCount: 0, totalSilenceMs: 0, commaCount: 0, sentenceCount: 0, whisperWordCount: whisperWords.length, skipped: true, skipReason: `whisper returned ${whisperWords.length} words` };
  }

  const insertions = alignAndBuildInsertions(whisperWords, textWords, profile);

  if (insertions.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    return { pauseCount: 0, totalSilenceMs: 0, commaCount: 0, sentenceCount: 0, whisperWordCount: whisperWords.length, skipped: true, skipReason: "alignment yielded 0 insertions" };
  }

  await buildAudioWithPauses(inputPath, outputPath, insertions);

  const commaCount = insertions.filter(i => i.type === "comma").length;
  const sentenceCount = insertions.filter(i => i.type === "sentence").length;
  const totalSilenceMs = insertions.reduce((sum, i) => sum + i.pauseMs, 0);

  return { pauseCount: insertions.length, totalSilenceMs, commaCount, sentenceCount, whisperWordCount: whisperWords.length, skipped: false };
}

// ── Submit + poll helper ──────────────────────────────────────────────────────

// ── runTTS ────────────────────────────────────────────────────────────────────

export async function runTTS(
  contentId: string,
  contentType: "short" | "long",
  voiceOverride?: string | null,
  options?: { skipCache?: boolean },
): Promise<TTSResult> {
  if (contentType === "long") {
    return runLongformNarration(contentId, voiceOverride, options);
  }

  const item = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
  if (!item) return { success: false, error: "Không tìm thấy content" };

  const channelKey = item.channelKey ?? "phat_phap";
  const niche = await db.query.niches.findFirst({ where: eq(niches.id, item.nicheId) });
  const nicheVoice = (niche as { ttsVoice?: string | null } | undefined)?.ttsVoice ?? null;

  // Voice priority (highest → lowest):
  //   1. item.ttsVoice  — locked at INSERT by voice-rotation.ts (Voice Rotation V1)
  //   2. voiceOverride  — explicit caller override (scheduler job, manual re-TTS)
  //   3. nicheVoice     — niche-level default
  const itemVoice = (item as Record<string, unknown>).ttsVoice as string | null | undefined;
  const routeConfig = await resolvePipelineTTSConfig("short", {
    contentType: "short",
    channelKey,
    contentProfileKey: item.contentProfileKey,
    formatType: item.formatType,
    nicheTtsVoice: nicheVoice,
  }, {
    voiceOverride,
    itemVoice,
    nicheVoice,
  });
  const provider = routeConfig.provider;
  const aiMaxConfig = provider.providerId === "aimax" ? await getAiMaxRuntimeConfig() : null;
  const preferredVoiceCandidates = routeConfig.preferredVoiceCandidates;
  const selectedVoice = (await resolveConfiguredTTSVoice(provider, preferredVoiceCandidates)).id;
  const fallbackVoice = getFallbackVoice(channelKey);
  const behaviorProfileKey = getContentProfile(item.contentProfileKey).key;
  const isAudioStory = isAudioStoryContext({
    contentType: "short",
    channelKey,
    contentProfileKey: item.contentProfileKey,
    formatType: item.formatType,
    nicheTtsVoice: nicheVoice,
  });
  const effectiveSpeed = provider.providerId === "aimax"
    ? (routeConfig.speed ?? (isAudioStory && selectedVoice === "hn_female_ngochuyen_full_48k-fhg" ? 1.05 : aiMaxConfig?.speed ?? AIMAX_DEFAULTS.speed))
    : null;
  const effectivePitch = provider.providerId === "aimax"
    ? (routeConfig.pitch ?? (isAudioStory && selectedVoice === "hn_female_ngochuyen_full_48k-fhg" ? 2 : aiMaxConfig?.pitch ?? AIMAX_DEFAULTS.pitch))
    : null;
  const effectiveVolume = provider.providerId === "aimax"
    ? (routeConfig.volume ?? aiMaxConfig?.volume ?? AIMAX_DEFAULTS.volume)
    : null;
  const effectiveNormalize = provider.providerId === "aimax"
    ? (routeConfig.normalize ?? aiMaxConfig?.normalize ?? AIMAX_DEFAULTS.normalize)
    : null;
  const effectiveModel = provider.providerId === "aimax"
    ? (routeConfig.model ?? aiMaxConfig?.model ?? provider.model ?? null)
    : provider.model ?? null;
  const effectiveLanguage = provider.providerId === "aimax"
    ? (routeConfig.language ?? aiMaxConfig?.language ?? "Vietnamese")
    : "Vietnamese";

  // contentType === "long" was handled by the early-return above; this is short-only.
  const ttsText = normalizeTextForTTS(item.shortContent);
  const fileId = contentId;
  const targetRelPath = `media/audio/${fileId}.wav`;
  const targetAbsPath = path.join(AUDIO_DIR, `${fileId}.wav`);
  const cacheHash = buildTextHash(ttsText);
  const cacheKey = buildShortCacheKey({
    providerId: provider.providerId,
    voiceId: selectedVoice,
    speed: effectiveSpeed,
    pitch: effectivePitch,
    volume: effectiveVolume,
    normalize: effectiveNormalize,
    model: effectiveModel,
    language: effectiveLanguage,
    textHash: cacheHash,
  });
  const cacheAbsPath = path.join(AUDIO_CACHE_DIR, provider.providerId, cacheHash, `${sanitizeVoiceName(selectedVoice)}-${cacheKey}.wav`);
  const selectedTtsMetadata = buildEffectiveTTSMetadata({
    provider,
    voiceId: selectedVoice,
    route: routeConfig.route,
    speed: effectiveSpeed,
    pitch: effectivePitch,
    volume: effectiveVolume,
    normalize: effectiveNormalize,
    model: effectiveModel,
    language: effectiveLanguage,
    cacheIdentity: cacheKey,
    recommendedUseCaseOverride: routeConfig.route?.recommendedUseCase ?? null,
    settingsSource: routeConfig.settingsSource,
  });
  const selectedVoiceMetadata = provider.providerId === "aimax"
    ? getAiMaxVoiceMetadata(selectedVoice)
    : null;

  const routingError = provider.providerId === "aimax"
    ? getShortTtsProfileRoutingError({
        channelKey,
        behaviorProfileKey,
        routeKey: routeConfig.route?.routeKey ?? null,
        preferredVoiceCandidateCount: routeConfig.preferredVoiceCandidates.length,
        selectedVoiceId: selectedVoice,
        selectedVoiceRecommendedUseCase: selectedVoiceMetadata?.recommendedUseCase ?? null,
        effectiveRecommendedUseCase: selectedTtsMetadata.ttsRecommendedUseCase ?? null,
      })
    : null;

  if (routingError === "tts_profile_mismatch") {
    return {
      success: false,
      error: `tts_profile_mismatch: tang_sau short TTS resolved to Buddhist lineage voice/use case (${selectedVoice})`,
    };
  }

  if (routingError === "tts_profile_route_missing") {
    return {
      success: false,
      error: "tts_profile_route_missing: tang_sau short TTS route has no configured AiMax voice candidates",
    };
  }

  await db.update(contentGenerations)
    .set({ ttsStatus: "processing", ttsErrorMessage: null })
    .where(eq(contentGenerations.id, contentId));

  const ttsStart = Date.now();

  try {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });

    // skipCache: delete stale cache entry so fresh TTS+pause-injection runs
    if (options?.skipCache && fs.existsSync(cacheAbsPath)) {
      fs.unlinkSync(cacheAbsPath);
    }

    const usageCtx = {
      pipelineRoute: routeConfig.route?.routeKey ?? "generic_short",
      contentProfileKey: item.contentProfileKey ?? null,
      nicheName: (niche as { name?: string } | undefined)?.name ?? null,
      formatType: item.formatType ?? null,
      voiceLabel: selectedTtsMetadata.ttsVoiceLabel,
      voiceFamily: selectedTtsMetadata.ttsVoiceFamily,
      textHash: cacheHash,
      textCharCount: ttsText.length,
      cacheIdentity: cacheKey,
    };

    if (fs.existsSync(cacheAbsPath)) {
      fs.copyFileSync(cacheAbsPath, targetAbsPath);
      const ttsDurationMs = Date.now() - ttsStart;
      await persistShortTTSMetadata({
        contentId,
        existingPromptVersions: item.promptVersions,
        metadata: selectedTtsMetadata,
        ttsDurationMs,
        audioPath: targetRelPath,
      });
      console.log(
        `[TTS-QA] content_id=${contentId}` +
        ` provider=${selectedTtsMetadata.ttsProvider}` +
        ` voice=${selectedTtsMetadata.ttsVoiceId}` +
        ` voice_label=${selectedTtsMetadata.ttsVoiceLabel}` +
        ` voice_family=${selectedTtsMetadata.ttsVoiceFamily}` +
        ` channel_key=${channelKey}` +
        ` profile=${selectedTtsMetadata.ttsRoute ?? "default"}` +
        ` speed=${selectedTtsMetadata.ttsEffectiveSpeed ?? "n/a"}` +
        ` pitch=${selectedTtsMetadata.ttsEffectivePitch ?? "n/a"}` +
        ` cache=hit`,
      );
      if (provider.providerId === "aimax") {
        void recordCacheHitUsage({
          contentId,
          voiceId: selectedVoice,
          usageContext: usageCtx,
          speed: effectiveSpeed,
          pitch: effectivePitch,
          durationMs: ttsDurationMs,
        });
      }
      return { success: true, audioPath: targetRelPath, ttsDurationMs };
    }

    const rawAudioPath = path.join(AUDIO_DIR, `${fileId}.${provider.providerId}.raw.wav`);
    console.log(
      `[TTS-QA] select content_id=${contentId}` +
      ` provider=${selectedTtsMetadata.ttsProvider}` +
      ` voice=${selectedTtsMetadata.ttsVoiceId}` +
      ` voice_label=${selectedTtsMetadata.ttsVoiceLabel}` +
      ` voice_family=${selectedTtsMetadata.ttsVoiceFamily}` +
      ` channel_key=${channelKey}` +
      ` profile=${selectedTtsMetadata.ttsRoute ?? "default"}` +
      ` speed=${selectedTtsMetadata.ttsEffectiveSpeed ?? "n/a"}` +
      ` pitch=${selectedTtsMetadata.ttsEffectivePitch ?? "n/a"}`,
    );
    const synthesize = async (voiceId: string) =>
      provider.synthesize({
        text: ttsText,
        voiceId,
        outputPath: rawAudioPath,
        contentId: fileId,
        model: effectiveModel ?? undefined,
        language: effectiveLanguage,
        normalize: effectiveNormalize,
        enableSrt: aiMaxConfig?.enableSrt,
        speed: effectiveSpeed,
        pitch: effectivePitch,
        volume: effectiveVolume,
        usageContext: usageCtx,
      });

    // ── Provider synthesize with single fallback retry for VieNeu only ───────
    let synthResult:
      | Awaited<ReturnType<typeof synthesize>>
      | null = null;
    let effectiveVoice = selectedVoice;
    let synthError: string | null = null;

    try {
      synthResult = await synthesize(selectedVoice);
    } catch (error) {
      synthError = error instanceof Error ? error.message : String(error);
    }

    // Fallback: if primary voice fails and it's not already the fallback voice,
    // retry once with Ly. Log clearly — never silently change the voice.
    if (!synthResult && provider.providerId === "vieneu" && selectedVoice !== fallbackVoice) {
      console.warn(
      `[TTS-QA] voice_fallback content_id=${contentId}` +
        ` from=${selectedVoice} to=${fallbackVoice}` +
        ` reason="${synthError}"`,
      );
      try {
        synthResult = await synthesize(fallbackVoice);
        effectiveVoice = fallbackVoice;
      } catch (error) {
        synthError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!synthResult) {
      throw new Error(synthError ?? `TTS provider '${provider.providerId}' failed.`);
    }

    const providerRawAudioPath = synthResult.audioPath;
    const effectiveCacheKey = effectiveVoice === selectedVoice
      ? cacheKey
      : buildShortCacheKey({
          providerId: provider.providerId,
          voiceId: effectiveVoice,
          speed: effectiveSpeed,
          pitch: effectivePitch,
          volume: effectiveVolume,
          normalize: effectiveNormalize,
          model: effectiveModel,
          language: effectiveLanguage,
          textHash: cacheHash,
        });
    const effectiveCacheAbsPath = effectiveVoice === selectedVoice
      ? cacheAbsPath
      : path.join(AUDIO_CACHE_DIR, provider.providerId, cacheHash, `${sanitizeVoiceName(effectiveVoice)}-${effectiveCacheKey}.wav`);
    const effectiveTtsMetadata = buildEffectiveTTSMetadata({
      provider,
      voiceId: effectiveVoice,
      route: routeConfig.route,
      speed: effectiveSpeed,
      pitch: effectivePitch,
      volume: effectiveVolume,
      normalize: effectiveNormalize,
      model: effectiveModel,
      language: effectiveLanguage,
      cacheIdentity: effectiveCacheKey,
      recommendedUseCaseOverride: routeConfig.route?.recommendedUseCase ?? null,
      settingsSource: routeConfig.settingsSource,
    });

    const finalizedRoutingError = provider.providerId === "aimax"
      ? getShortTtsProfileRoutingError({
          channelKey,
          behaviorProfileKey,
          routeKey: routeConfig.route?.routeKey ?? null,
          preferredVoiceCandidateCount: routeConfig.preferredVoiceCandidates.length,
          selectedVoiceId: effectiveVoice,
          selectedVoiceRecommendedUseCase: getAiMaxVoiceMetadata(effectiveVoice).recommendedUseCase ?? null,
          effectiveRecommendedUseCase: effectiveTtsMetadata.ttsRecommendedUseCase ?? null,
        })
      : null;

    if (finalizedRoutingError === "tts_profile_mismatch") {
      throw new Error(`tts_profile_mismatch: tang_sau short TTS finalized with Buddhist lineage voice/use case (${effectiveVoice})`);
    }
    if (finalizedRoutingError === "tts_profile_route_missing") {
      throw new Error("tts_profile_route_missing: tang_sau short TTS route lost its configured AiMax voice candidates");
    }

    // Determine audio normalization policy by channel (ADR-024):
    // phat_phap → loudnorm-only (VieNeu prosody preserved)
    // other     → silenceremove + loudnorm (pre-ADR-024 behaviour, pending per-channel audit)
    const useSilenceremove = provider.providerId === "vieneu" ? channelKey !== "phat_phap" : false;

    // Step 1: normalize to temp file inside AUDIO_DIR so the TTS Docker container
    // can access it via the /media/audio mount when running Whisper timestamps.
    const normalizedTmpPath = path.join(AUDIO_DIR, `${fileId}.norm.tmp.wav`);
    await normalizeAudioWithLoudnorm(providerRawAudioPath, normalizedTmpPath, { useSilenceremove });

    // Step 2: inject deterministic punctuation pauses (buddhist_calm profile)
    // Gated by TTS_ENABLE_PUNCTUATION_PAUSES env flag (default: false).
    // Set to "true" only after Option E (net-addition logic) is implemented.
    // Reason: current injection causes double-pause stacking — injected silence
    // piles on top of natural TTS prosody preserved by the silenceremove pass,
    // producing "khựng" (hard-stop) artifacts. See docs/OPERATIONS.md § TTS Pacing Audit.
    const pauseInjectionEnabled =
      provider.providerId === "vieneu" && process.env.TTS_ENABLE_PUNCTUATION_PAUSES === "true";
    let pauseStats: Awaited<ReturnType<typeof injectPunctuationPauses>>;
    if (pauseInjectionEnabled) {
      pauseStats = await injectPunctuationPauses(
        normalizedTmpPath,
        targetAbsPath,
        ttsText,
        BUDDHIST_CALM_PROFILE,
      );
    } else {
      // Injection disabled: copy normalized audio as-is (natural TTS prosody only)
      fs.copyFileSync(normalizedTmpPath, targetAbsPath);
      pauseStats = {
        pauseCount: 0, totalSilenceMs: 0, commaCount: 0, sentenceCount: 0,
        whisperWordCount: 0, skipped: true,
        skipReason: "TTS_ENABLE_PUNCTUATION_PAUSES=false",
      };
    }

    // Clean up intermediate normalized file
    try { fs.unlinkSync(normalizedTmpPath); } catch { /* ignore */ }

    // QA logging — run silence diagnostics on final output (cheap: ~0.1s for 35s WAV)
    const textSentenceCount = (ttsText.match(/[.!?…]/g) ?? []).length;
    const textCommaCount    = (ttsText.match(/[,;:]/g) ?? []).length;
    const [audioDurSec, segs150, segs300] = await Promise.all([
      getAudioDurationSec(targetAbsPath),
      countSilenceSegs(targetAbsPath, 0.15),
      countSilenceSegs(targetAbsPath, 0.30),
    ]);
    console.log(
      `[TTS-QA] content_id=${contentId}` +
      ` provider=${effectiveTtsMetadata.ttsProvider}` +
      ` voice=${effectiveTtsMetadata.ttsVoiceId}` +
      ` voice_label=${effectiveTtsMetadata.ttsVoiceLabel}` +
      ` voice_family=${effectiveTtsMetadata.ttsVoiceFamily}` +
      (effectiveVoice !== selectedVoice ? ` (fallback_from=${selectedVoice})` : "") +
      ` channel_key=${channelKey}` +
      ` profile=${effectiveTtsMetadata.ttsRoute ?? "default"}` +
      ` speed=${effectiveTtsMetadata.ttsEffectiveSpeed ?? "n/a"}` +
      ` pitch=${effectiveTtsMetadata.ttsEffectivePitch ?? "n/a"}` +
      ` loudnorm=true` +
      ` silenceremove=${useSilenceremove}` +
      ` injection=${pauseInjectionEnabled ? "on" : "off(disabled)"}` +
      ` duration=${audioDurSec?.toFixed(1) ?? "?"}s` +
      ` pauses_150ms=${segs150}` +
      ` pauses_300ms=${segs300}` +
      ` textLen=${ttsText.length}` +
      ` sentences=${textSentenceCount}` +
      ` commas=${textCommaCount}` +
      ` pauseCount=${pauseStats.pauseCount}` +
      ` (comma=${pauseStats.commaCount} sentence=${pauseStats.sentenceCount})` +
      ` totalSilenceMs=${pauseStats.totalSilenceMs}` +
      ` whisperWords=${pauseStats.whisperWordCount}` +
      (pauseStats.skipped ? ` SKIPPED(${pauseStats.skipReason})` : ""),
    );

    // Validation warnings (only relevant when injection is on)
    if (pauseInjectionEnabled) {
      if (textSentenceCount > 1 && pauseStats.sentenceCount === 0 && !pauseStats.skipped) {
        console.warn(`[TTS-QA] ⚠ WARN: ${textSentenceCount} sentences in text but 0 sentence pauses inserted (contentId=${contentId})`);
      }
      if (textSentenceCount > 0 && pauseStats.skipped) {
        console.warn(`[TTS-QA] ⚠ WARN: pause injection skipped for content with punctuation — reason: ${pauseStats.skipReason} (contentId=${contentId})`);
      }
    }

    fs.mkdirSync(path.dirname(effectiveCacheAbsPath), { recursive: true });
    fs.copyFileSync(targetAbsPath, effectiveCacheAbsPath);
    const ttsDurationMs = Date.now() - ttsStart;

    await persistShortTTSMetadata({
      contentId,
      existingPromptVersions: item.promptVersions,
      metadata: effectiveTtsMetadata,
      ttsDurationMs,
      audioPath: targetRelPath,
    });

    return { success: true, audioPath: targetRelPath, ttsDurationMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(contentGenerations)
      .set({ ttsStatus: "error", ttsErrorMessage: message })
      .where(eq(contentGenerations.id, contentId));
    return { success: false, error: message };
  }
}
