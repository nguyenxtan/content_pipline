import { db } from "@/lib/db";
import { contentGenerations, niches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const AUDIO_DIR = path.join(process.cwd(), "media", "audio");
const AUDIO_CACHE_DIR = path.join(process.cwd(), "media", "audio-cache");

const POLL_INTERVAL_MS = 15_000;   // 15 seconds between status checks
const MAX_WAIT_MS      = 25 * 60 * 1000; // 25-minute overall timeout

export type TTSResult =
  | { success: true; audioPath: string; ttsDurationMs: number }
  | { success: false; error: string };

function buildTextHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function sanitizeVoiceName(voice: string): string {
  return voice.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

function normalizeTextForTTS(text: string): string {
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
    .trim();
}

function resolveLocalPath(filePath: string): string {
  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
    return filePath;
  }
  return path.join(process.cwd(), filePath.replace(/^\/+/, ""));
}

async function normalizeAudioWithLoudnorm(inputPath: string, outputPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-i", inputPath,
    "-af",
    "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05:stop_periods=-1:stop_threshold=-50dB:stop_duration=0.35:stop_silence=0.16:detection=rms,loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar", "48000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    tempPath,
  ], { timeout: 120_000 });
  fs.renameSync(tempPath, outputPath);
}

export async function runTTS(
  contentId: string,
  contentType: "short" | "long",
  voiceOverride?: string | null,
): Promise<TTSResult> {
  const item = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
  if (!item) return { success: false, error: "Không tìm thấy content" };

  const niche = await db.query.niches.findFirst({ where: eq(niches.id, item.nicheId) });
  const nicheVoice = (niche as { ttsVoice?: string | null } | undefined)?.ttsVoice ?? "Ly";
  const ttsVoice = voiceOverride || nicheVoice;

  const isLong = contentType === "long";
  const text   = isLong ? item.longContent : item.shortContent;
  const ttsText = normalizeTextForTTS(text);
  const fileId = isLong ? `${contentId}-long` : contentId;
  const targetRelPath = `media/audio/${fileId}.wav`;
  const targetAbsPath = path.join(AUDIO_DIR, `${fileId}.wav`);
  const cacheHash = buildTextHash(ttsText);
  const cacheAbsPath = path.join(AUDIO_CACHE_DIR, cacheHash, `${sanitizeVoiceName(ttsVoice)}.wav`);

  await db.update(contentGenerations)
    .set(isLong
      ? { longTtsStatus: "processing", longTtsErrorMessage: null }
      : { ttsStatus: "processing", ttsErrorMessage: null }
    )
    .where(eq(contentGenerations.id, contentId));

  const ttsStart = Date.now();

  try {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });

    if (fs.existsSync(cacheAbsPath)) {
      fs.copyFileSync(cacheAbsPath, targetAbsPath);
      const ttsDurationMs = Date.now() - ttsStart;
      await db.update(contentGenerations)
        .set(isLong
          ? { longTtsStatus: "done", longAudioPath: targetRelPath, longTtsErrorMessage: null, longTtsDurationMs: ttsDurationMs }
          : { ttsStatus: "done", audioPath: targetRelPath, ttsErrorMessage: null, ttsDurationMs }
        )
        .where(eq(contentGenerations.id, contentId));
      return { success: true, audioPath: targetRelPath, ttsDurationMs };
    }

    // Submit async job — returns immediately with job_id
    const submitRes = await fetch(`${TTS_API_URL}/tts/async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: ttsText, content_id: fileId, voice: ttsVoice }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const body = await submitRes.text().catch(() => "");
      throw new Error(`TTS submit thất bại (${submitRes.status}): ${body}`);
    }

    const { job_id } = await submitRes.json() as { job_id: string };

    // Poll until done or timeout
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollRes = await fetch(`${TTS_API_URL}/tts/status/${job_id}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!pollRes.ok) continue; // transient poll error — keep waiting

      const status = await pollRes.json() as {
        status: string;
        path?: string;
        duration_seconds?: number;
        error?: string;
      };

      if (status.status === "done") {
        if (!status.path) throw new Error("TTS done nhưng không có path");
        const rawAudioPath = resolveLocalPath(status.path);
        if (!fs.existsSync(rawAudioPath)) {
          throw new Error(`TTS done nhưng file không tồn tại: ${status.path}`);
        }
        await normalizeAudioWithLoudnorm(rawAudioPath, targetAbsPath);
        fs.mkdirSync(path.dirname(cacheAbsPath), { recursive: true });
        fs.copyFileSync(targetAbsPath, cacheAbsPath);
        const ttsDurationMs = Date.now() - ttsStart;

        await db.update(contentGenerations)
          .set(isLong
            ? { longTtsStatus: "done", longAudioPath: targetRelPath, longTtsErrorMessage: null, longTtsDurationMs: ttsDurationMs }
            : { ttsStatus: "done", audioPath: targetRelPath, ttsErrorMessage: null, ttsDurationMs }
          )
          .where(eq(contentGenerations.id, contentId));

        return { success: true, audioPath: targetRelPath, ttsDurationMs };
      }

      if (status.status === "error") {
        throw new Error(status.error ?? "TTS thất bại");
      }
      // "queued" or "processing" — keep polling
    }

    throw new Error(`TTS timeout sau ${MAX_WAIT_MS / 60_000} phút`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(contentGenerations)
      .set(isLong
        ? { longTtsStatus: "error", longTtsErrorMessage: message }
        : { ttsStatus: "error", ttsErrorMessage: message }
      )
      .where(eq(contentGenerations.id, contentId));
    return { success: false, error: message };
  }
}
