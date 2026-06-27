import fs from "fs";
import path from "path";
import OpenAI from "openai";
import {
  TTSProvider,
  TTSProviderSynthesisRequest,
  TTSProviderSynthesisResult,
  TTSProviderVoice,
} from "@/lib/pipeline/tts-providers/types";

const OPENAI_MODEL = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const OPENAI_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
] as const;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing");
  }
  return new OpenAI({ apiKey });
}

function mapVoice(id: string): TTSProviderVoice {
  return {
    id,
    name: id,
    locale: "multilingual",
  };
}

async function synthesizeWithOpenAI(
  request: TTSProviderSynthesisRequest,
): Promise<TTSProviderSynthesisResult> {
  const client = getClient();
  fs.mkdirSync(path.dirname(request.outputPath), { recursive: true });

  const response = await client.audio.speech.create({
    model: OPENAI_MODEL,
    voice: request.voiceId as OpenAI.Audio.Speech.SpeechCreateParams["voice"],
    input: request.text,
    response_format: "wav",
  });

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(request.outputPath, Buffer.from(arrayBuffer));

  return {
    audioPath: request.outputPath,
    providerId: "openai",
    voiceId: request.voiceId,
    engine: "OpenAI Audio Speech",
    model: OPENAI_MODEL,
  };
}

export const openaiTTSProvider: TTSProvider = {
  providerId: "openai",
  displayName: "OpenAI TTS",
  engine: "OpenAI Audio Speech",
  model: OPENAI_MODEL,
  defaultVoiceId: "alloy",
  supportsLongform: true,
  supportsSpeedControl: false,
  supportsProsodyControl: true,
  async checkAvailability() {
    return process.env.OPENAI_API_KEY
      ? { available: true }
      : { available: false, reason: "OPENAI_API_KEY missing" };
  },
  async listVoices(): Promise<TTSProviderVoice[]> {
    return OPENAI_VOICES.map(mapVoice);
  },
  async synthesize(request: TTSProviderSynthesisRequest): Promise<TTSProviderSynthesisResult> {
    return synthesizeWithOpenAI(request);
  },
};
