import fs from "fs";
import { resolveAudioPathForHost, toContainerAudioPath } from "@/lib/pipeline/tts-paths";
import {
  TTSProvider,
  TTSProviderSynthesisRequest,
  TTSProviderSynthesisResult,
  TTSProviderVoice,
} from "@/lib/pipeline/tts-providers/types";

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 15_000;
const MAX_WAIT_MS = 12 * 60 * 1000;

type TTSJobStatus = {
  status: "queued" | "processing" | "done" | "error";
  path?: string;
  error?: string;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(input: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(1_000 * attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function submitAndPollVieNeu(
  request: TTSProviderSynthesisRequest,
): Promise<TTSProviderSynthesisResult> {
  const containerOutputPath = toContainerAudioPath(request.outputPath);
  const submitRes = await fetchWithRetry(`${TTS_API_URL}/tts/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: request.text,
      voice: request.voiceId,
      content_id: request.contentId,
      output_path: containerOutputPath,
    }),
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
  }, 4);

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => "");
    throw new Error(`VieNeu submit failed (${submitRes.status}): ${body}`);
  }

  const { job_id } = await submitRes.json() as { job_id: string };
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetchWithRetry(`${TTS_API_URL}/tts/status/${job_id}`, {
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    }, 2).catch(() => null);

    if (!pollRes?.ok) continue;
    const status = await pollRes.json() as TTSJobStatus;

    if (status.status === "done") {
      const resolvedOutputPath = resolveAudioPathForHost(status.path ?? request.outputPath);
      if (!fs.existsSync(resolvedOutputPath)) {
        throw new Error("VieNeu completed but output file was not found.");
      }
      return {
        audioPath: resolvedOutputPath,
        providerId: "vieneu",
        voiceId: request.voiceId,
        engine: "VieNeu-TTS",
        model: "pnnbao-ump/VieNeu-TTS-v2",
      };
    }

    if (status.status === "error") {
      throw new Error(status.error ?? "VieNeu job failed.");
    }
  }

  throw new Error(`VieNeu timed out after ${MAX_WAIT_MS / 60_000} minutes.`);
}

export const vieneuProvider: TTSProvider = {
  providerId: "vieneu",
  displayName: "VieNeu-TTS",
  engine: "VieNeu-TTS",
  model: "pnnbao-ump/VieNeu-TTS-v2",
  defaultVoiceId: "Ly",
  supportsLongform: true,
  supportsSpeedControl: false,
  supportsProsodyControl: false,
  async checkAvailability() {
    try {
      const res = await fetchWithRetry(`${TTS_API_URL}/health`, {
        signal: AbortSignal.timeout(10_000),
      }, 2);
      if (!res.ok) return { available: false, reason: `health status ${res.status}` };
      const data = await res.json() as { status?: string; tts_engine?: string };
      return { available: data.status === "ok" && data.tts_engine === "loaded" };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  },
  async listVoices(): Promise<TTSProviderVoice[]> {
    const res = await fetchWithRetry(`${TTS_API_URL}/voices`, {
      signal: AbortSignal.timeout(10_000),
    }, 3);
    if (!res.ok) {
      throw new Error(`VieNeu voices failed (${res.status})`);
    }
    const data = await res.json() as { voices: Array<{ id: string; name: string }> };
    return data.voices.map((voice) => ({ id: voice.id, name: voice.name }));
  },
  async synthesize(request: TTSProviderSynthesisRequest): Promise<TTSProviderSynthesisResult> {
    return submitAndPollVieNeu(request);
  },
};
