import fs from "fs";
import path from "path";
import {
  TTSProvider,
  TTSProviderSynthesisRequest,
  TTSProviderSynthesisResult,
  TTSProviderVoice,
} from "@/lib/pipeline/tts-providers/types";

const ELEVENLABS_API_BASE = process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io/v1";
const ELEVENLABS_MODEL = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_multilingual_v2";
const ELEVENLABS_DEFAULT_VOICE_ID = process.env.ELEVENLABS_TTS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
};

async function fetchWithRetry(input: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function authHeaders(): HeadersInit {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY missing");
  }
  return {
    "xi-api-key": apiKey,
  };
}

export const elevenLabsProvider: TTSProvider = {
  providerId: "elevenlabs",
  displayName: "ElevenLabs",
  engine: "ElevenLabs TTS",
  model: ELEVENLABS_MODEL,
  defaultVoiceId: ELEVENLABS_DEFAULT_VOICE_ID,
  supportsLongform: true,
  supportsSpeedControl: false,
  supportsProsodyControl: true,
  async checkAvailability() {
    return process.env.ELEVENLABS_API_KEY
      ? { available: true }
      : { available: false, reason: "ELEVENLABS_API_KEY missing" };
  },
  async listVoices(): Promise<TTSProviderVoice[]> {
    const res = await fetchWithRetry(`${ELEVENLABS_API_BASE}/voices`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(20_000),
    }, 3);
    if (!res.ok) {
      throw new Error(`ElevenLabs voices failed (${res.status})`);
    }
    const data = await res.json() as { voices: ElevenLabsVoice[] };
    return data.voices.map((voice) => ({
      id: voice.voice_id,
      name: voice.name,
      locale: voice.labels?.accent ?? voice.labels?.language,
      accent: voice.labels?.accent,
      gender: voice.labels?.gender,
    }));
  },
  async synthesize(request: TTSProviderSynthesisRequest): Promise<TTSProviderSynthesisResult> {
    fs.mkdirSync(path.dirname(request.outputPath), { recursive: true });
    const res = await fetchWithRetry(`${ELEVENLABS_API_BASE}/text-to-speech/${request.voiceId}`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: request.text,
        model_id: ELEVENLABS_MODEL,
      }),
      signal: AbortSignal.timeout(120_000),
    }, 3);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs synth failed (${res.status}): ${body}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const mp3Path = `${request.outputPath}.mp3`;
    fs.writeFileSync(mp3Path, Buffer.from(arrayBuffer));

    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
    const execFileAsync = promisify(execFile);
    const tempPath = `${request.outputPath}.tmp.wav`;
    await execFileAsync(ffmpegInstaller.path, [
      "-y",
      "-i", mp3Path,
      "-ar", "48000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      tempPath,
    ], { timeout: 180_000 });
    fs.renameSync(tempPath, request.outputPath);
    try { fs.rmSync(mp3Path, { force: true }); } catch { /* ignore */ }

    return {
      audioPath: request.outputPath,
      providerId: "elevenlabs",
      voiceId: request.voiceId,
      engine: "ElevenLabs TTS",
      model: ELEVENLABS_MODEL,
    };
  },
};
