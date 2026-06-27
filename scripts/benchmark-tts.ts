import "dotenv/config";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { chunkTextForTTS } from "@/services/tts/chunking";
import { getTTSProvider, listAvailableTTSProviders, resolveVoiceForProvider } from "@/lib/pipeline/tts-providers/registry";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const INPUT_PATH = process.argv[2] ?? path.join(process.cwd(), "tts_benchmark", "story_15min.txt");
const REPORT_PATH = path.join(process.cwd(), "reports", "tts-benchmark.json");
const OUTPUT_BASE = path.join(process.cwd(), "media", "audio", "tts-provider-eval", "benchmark");
const PROVIDER_IDS = ["vieneu", "aimax"] as const;

type ProviderBenchmarkResult = {
  providerId: string;
  available: boolean;
  reason?: string;
  voiceId?: string;
  chunkCount?: number;
  renderTimeMs?: number;
  audioDurationSec?: number | null;
  failures?: number;
  retries?: number;
  mergedAudioPath?: string | null;
  mergedSrtPath?: string | null;
  segmentPaths?: string[];
};

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function durationSec(audioPath: string): Promise<number | null> {
  const result = await execFileAsync(FFMPEG_PATH, ["-i", audioPath, "-f", "null", "-"], {
    timeout: 30_000,
  }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
  const match = ((result as { stderr?: string }).stderr ?? "").match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!match) return null;
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
}

async function mergeAudio(segmentPaths: string[], outputPath: string): Promise<void> {
  const listPath = `${outputPath}.concat.txt`;
  fs.writeFileSync(listPath, segmentPaths.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`).join("\n"));
  await execFileAsync(FFMPEG_PATH, [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-ar", "48000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    outputPath,
  ], { timeout: 300_000 });
}

function parseTimestampToSec(value: string): number {
  const [time, ms] = value.split(",");
  const [hh, mm, ss] = time.split(":").map(Number);
  return hh * 3600 + mm * 60 + ss + Number(ms) / 1000;
}

function secToTimestamp(totalSec: number): string {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = Math.floor(totalSec % 60);
  const millis = Math.round((totalSec - Math.floor(totalSec)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

async function mergeSrt(segmentSrtPaths: Array<string | null | undefined>, segmentDurations: number[], outputPath: string): Promise<string | null> {
  const validSegments = segmentSrtPaths
    .map((srtPath, index) => ({ srtPath, index }))
    .filter((entry) => entry.srtPath && fs.existsSync(entry.srtPath));
  if (validSegments.length === 0) return null;

  let offsetSec = 0;
  let cueIndex = 1;
  const lines: string[] = [];

  for (let i = 0; i < segmentSrtPaths.length; i++) {
    const srtPath = segmentSrtPaths[i];
    if (srtPath && fs.existsSync(srtPath)) {
      const content = fs.readFileSync(srtPath, "utf8");
      for (const block of content.split(/\n\s*\n/)) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        const cueLines = trimmed.split("\n");
        const timingLine = cueLines.find((line) => line.includes("-->"));
        if (!timingLine) continue;
        const [startRaw, endRaw] = timingLine.split("-->").map((part) => part.trim());
        const start = secToTimestamp(parseTimestampToSec(startRaw) + offsetSec);
        const end = secToTimestamp(parseTimestampToSec(endRaw) + offsetSec);
        const textLines = cueLines.filter((line) => !/^\d+$/.test(line.trim()) && !line.includes("-->"));
        lines.push(String(cueIndex++));
        lines.push(`${start} --> ${end}`);
        lines.push(...textLines);
        lines.push("");
      }
    }
    offsetSec += segmentDurations[i] ?? 0;
  }

  if (lines.length === 0) return null;
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
  return outputPath;
}

async function benchmarkProvider(providerId: typeof PROVIDER_IDS[number], storyText: string): Promise<ProviderBenchmarkResult> {
  const provider = await getTTSProvider(providerId);
  const preferredVoice = providerId === "vieneu"
    ? process.env.VIENEU_BENCHMARK_VOICE ?? "Binh"
    : process.env.AIMAX_VOICE_ID ?? provider.defaultVoiceId ?? null;
  const voice = await resolveVoiceForProvider(provider, preferredVoice);
  const chunks = chunkTextForTTS(storyText, {
    maxCharsPerChunk: Number(process.env.TTS_MAX_CHARS_PER_CHUNK ?? 2000),
  });
  const providerDir = path.join(OUTPUT_BASE, provider.providerId, voice.id.replace(/[^a-z0-9_-]/gi, "_").toLowerCase());
  fs.mkdirSync(providerDir, { recursive: true });

  const startedAt = Date.now();
  const segmentPaths: string[] = [];
  const segmentSrtPaths: Array<string | null | undefined> = [];
  const segmentDurations: number[] = [];
  let failures = 0;
  let retries = 0;

  for (const chunk of chunks) {
    const outputPath = path.join(providerDir, `segment-${String(chunk.index + 1).padStart(2, "0")}.wav`);
    let succeeded = false;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await provider.synthesize({
          text: chunk.text,
          voiceId: voice.id,
          outputPath,
          contentId: `tts-benchmark-${provider.providerId}-${chunk.index + 1}`,
          chapterId: `chunk-${chunk.index + 1}`,
          language: "Vietnamese",
          enableSrt: true,
          normalize: true,
        });
        segmentPaths.push(result.audioPath);
        segmentSrtPaths.push(result.srtPath);
        segmentDurations.push(result.durationSec ?? await durationSec(result.audioPath) ?? 0);
        succeeded = true;
        retries += attempt - 1;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!succeeded) {
      failures += 1;
      throw new Error(`Provider ${provider.providerId} failed at chunk ${chunk.index + 1}: ${lastError ?? "unknown error"}`);
    }
  }

  const mergedAudioPath = path.join(providerDir, "merged.wav");
  await mergeAudio(segmentPaths, mergedAudioPath);
  const mergedSrtPath = await mergeSrt(segmentSrtPaths, segmentDurations, path.join(providerDir, "merged.srt"));

  return {
    providerId,
    available: true,
    voiceId: voice.id,
    chunkCount: chunks.length,
    renderTimeMs: Date.now() - startedAt,
    audioDurationSec: await durationSec(mergedAudioPath),
    failures,
    retries,
    mergedAudioPath,
    mergedSrtPath,
    segmentPaths,
  };
}

async function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`Benchmark input missing: ${INPUT_PATH}`);
  }

  const storyText = fs.readFileSync(INPUT_PATH, "utf8").trim();
  if (!storyText) {
    throw new Error(`Benchmark input is empty: ${INPUT_PATH}`);
  }

  const availability = await listAvailableTTSProviders();
  const results: ProviderBenchmarkResult[] = [];

  for (const providerId of PROVIDER_IDS) {
    const providerState = availability.find((entry) => entry.providerId === providerId);
    if (!providerState || "availabilityReason" in providerState) {
      results.push({
        providerId,
        available: false,
        reason: providerState && "availabilityReason" in providerState
          ? providerState.availabilityReason
          : "provider not registered",
      });
      continue;
    }

    try {
      results.push(await benchmarkProvider(providerId, storyText));
    } catch (error) {
      results.push({
        providerId,
        available: true,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    inputPath: INPUT_PATH,
    inputWordCount: countWords(storyText),
    maxCharsPerChunk: Number(process.env.TTS_MAX_CHARS_PER_CHUNK ?? 2000),
    results,
  }, null, 2));

  console.log(JSON.stringify({
    reportPath: REPORT_PATH,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
