import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  TTSProvider,
  TTSProviderSynthesisRequest,
  TTSProviderSynthesisResult,
  TTSProviderVoice,
} from "@/lib/pipeline/tts-providers/types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;
const SAY_PATH = "/usr/bin/say";

type ParsedVoice = TTSProviderVoice & {
  sample?: string;
};

let cachedVoices: ParsedVoice[] | null = null;

function inferGender(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.includes("grandma")) return "female";
  if (lower.includes("grandpa")) return "male";
  if (["linh", "alice", "anna", "amira", "amelie", "kyoko", "karen", "joana", "luciana", "lana", "laura"].includes(lower)) {
    return "female";
  }
  return undefined;
}

async function parseVoices(): Promise<ParsedVoice[]> {
  if (cachedVoices) return cachedVoices;
  const result = await execFileAsync(SAY_PATH, ["-v", "?"], { timeout: 15_000 });
  const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  cachedVoices = lines.map((line) => {
    const match = /^(.*?)\s+([a-z]{2}_[A-Z]{2}|[a-z]{2}_[0-9A-Z]{2,})\s+#\s(.*)$/.exec(line);
    if (!match) {
      return { id: line, name: line };
    }
    const id = match[1].trim();
    const locale = match[2].trim();
    return {
      id,
      name: id,
      locale,
      sample: match[3].trim(),
      gender: inferGender(id),
      accent: locale === "vi_VN" ? "vietnamese" : undefined,
    };
  });
  return cachedVoices;
}

async function convertAiffToWav(inputPath: string, outputPath: string): Promise<void> {
  const tmpPath = `${outputPath}.tmp.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-i", inputPath,
    "-ar", "48000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    tmpPath,
  ], { timeout: 120_000 });
  fs.renameSync(tmpPath, outputPath);
}

async function synthesizeWithSay(request: TTSProviderSynthesisRequest): Promise<TTSProviderSynthesisResult> {
  fs.mkdirSync(path.dirname(request.outputPath), { recursive: true });
  const tempAiffPath = path.join(
    os.tmpdir(),
    `macos-say-${Date.now()}-${Math.random().toString(36).slice(2)}.aiff`,
  );

  const args = ["-v", request.voiceId];
  if (request.speed && Number.isFinite(request.speed)) {
    args.push("-r", String(Math.max(90, Math.min(280, Math.round(request.speed)))));
  }
  args.push("-o", tempAiffPath, request.text);

  await execFileAsync(SAY_PATH, args, { timeout: 180_000, maxBuffer: 1024 * 1024 * 8 });
  await convertAiffToWav(tempAiffPath, request.outputPath);
  try { fs.rmSync(tempAiffPath, { force: true }); } catch { /* ignore */ }

  return {
    audioPath: request.outputPath,
    providerId: "macos-say",
    voiceId: request.voiceId,
    engine: "macOS say",
    model: null,
  };
}

export const macosSayProvider: TTSProvider = {
  providerId: "macos-say",
  displayName: "macOS say",
  engine: "macOS say",
  model: null,
  defaultVoiceId: "Linh",
  supportsLongform: true,
  supportsSpeedControl: true,
  supportsProsodyControl: false,
  async checkAvailability() {
    if (!fs.existsSync(SAY_PATH)) {
      return { available: false, reason: "`say` command not found" };
    }
    try {
      const voices = await parseVoices();
      const hasVietnamese = voices.some((voice) => voice.locale === "vi_VN");
      return {
        available: hasVietnamese,
        reason: hasVietnamese ? undefined : "No vi_VN macOS voice installed",
      };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  },
  async listVoices(): Promise<TTSProviderVoice[]> {
    return parseVoices();
  },
  async synthesize(request: TTSProviderSynthesisRequest): Promise<TTSProviderSynthesisResult> {
    return synthesizeWithSay(request);
  },
};
