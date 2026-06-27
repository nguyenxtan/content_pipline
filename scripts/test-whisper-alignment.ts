/**
 * Quick diagnostic: test Whisper alignment end-to-end on an existing .norm.tmp.wav file.
 * Run: DATABASE_URL="..." npx tsx --env-file=.env.local scripts/test-whisper-alignment.ts
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const AUDIO_DIR = path.join(process.cwd(), "media", "audio");

function toContainerAudioPath(hostPath: string): string {
  const containerAudioDir = process.env.TTS_CONTAINER_AUDIO_DIR ?? null;
  if (!containerAudioDir) return hostPath;
  const rel = path.relative(AUDIO_DIR, hostPath);
  if (rel.startsWith("..")) return hostPath;
  return path.posix.join(containerAudioDir, rel.replace(/\\/g, "/"));
}

function normWord(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
}

type TextWordEntry = { wordLower: string; pause: "comma" | "sentence" | null };
type WhisperWord = { word: string; start: number; end: number };

function parseTextWordPuncts(text: string): TextWordEntry[] {
  const result: TextWordEntry[] = [];
  const tokens = text.split(/\s+/);
  for (const token of tokens) {
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

async function main() {
  const tmpPath = path.join(AUDIO_DIR, "b9977f99-0a2c-482a-bd5a-37cafec4a5ba.norm.tmp.wav");

  // If the file doesn't exist, create it by normalizing the stored audio
  if (!fs.existsSync(tmpPath)) {
    console.log("norm.tmp.wav not found — creating via loudnorm...");
    const srcPath = path.join(AUDIO_DIR, "b9977f99-0a2c-482a-bd5a-37cafec4a5ba.wav");
    await execFileAsync(FFMPEG_PATH, [
      "-y", "-i", srcPath,
      "-af", "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05:stop_periods=-1:stop_threshold=-50dB:stop_duration=0.80:stop_silence=0.28:detection=rms,loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", tmpPath,
    ], { timeout: 60_000 });
  }

  const hostFileSize = fs.statSync(tmpPath).size;
  const containerPath = toContainerAudioPath(tmpPath);
  console.log(`\nHost path:      ${tmpPath}`);
  console.log(`Container path: ${containerPath}`);
  console.log(`File size:      ${hostFileSize} bytes`);
  console.log(`TTS_CONTAINER_AUDIO_DIR: ${process.env.TTS_CONTAINER_AUDIO_DIR ?? "(not set)"}`);

  // Fetch Whisper timestamps
  // Full short_content from DB (normalized)
  const ttsText = "Người ta quên mất rằng cái ôm thật sự cần thiết đến thế nào. Trong những khoảnh khắc ngột ngạt của cuộc sống, khi ta cảm thấy lạc lõng giữa dòng đời, chỉ một cái ôm từ người thân cũng đủ để xoa dịu nỗi đau. Nhìn những đứa trẻ chạy đến vòng tay mẹ, ta mới thấy sự chấp nhận đơn giản mà kỳ diệu. Đôi khi, chỉ cần biết mình được yêu thương, ta có thể vượt qua mọi thử thách. Trong Phật pháp, sự chấp nhận bắt đầu từ việc yêu thương chính mình. Khi ta không còn chỉ trích, ta mới có thể mở lòng với người khác. Hãy suy ngẫm xem, liệu chúng ta có đủ can đảm để ôm ấp những phần chưa hoàn hảo của bản thân mình?";

  console.log("\n--- Calling /timestamps ---");
  const res = await fetch(`${TTS_API_URL}/timestamps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio_path: containerPath }), // no text — see tts.ts comment
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json() as { success: boolean; words?: WhisperWord[]; error?: string };
  console.log(`Response: success=${data.success} words=${data.words?.length ?? 0} error=${data.error ?? "(none)"}`);

  if (!data.words?.length) {
    console.error("No words returned. Aborting.");
    return;
  }

  const whisperWords = data.words;
  console.log(`\nFirst 10 Whisper words:`);
  for (const w of whisperWords.slice(0, 10)) {
    console.log(`  [${w.start.toFixed(2)}-${w.end.toFixed(2)}] "${w.word}" → normWord="${normWord(w.word)}"`);
  }

  // Parse text
  const textWords = parseTextWordPuncts(ttsText);
  console.log(`\nFirst 10 text words (from parseTextWordPuncts):`);
  for (const [i, tw] of textWords.slice(0, 10).entries()) {
    console.log(`  [${i}] wordLower="${tw.wordLower}" pause=${tw.pause ?? "null"}`);
  }

  // Try alignment manually
  console.log(`\n--- Alignment check ---`);
  let ti = 0;
  let insertionCount = 0;
  for (let wi = 0; wi < Math.min(whisperWords.length, 20) && ti < textWords.length; wi++) {
    const wNorm = normWord(whisperWords[wi].word);
    if (!wNorm) continue;
    let matched = -1;
    for (let look = 0; look < 4 && ti + look < textWords.length; look++) {
      const tNorm = textWords[ti + look].wordLower;
      const eq = wNorm === tNorm;
      const startsWith = wNorm.length >= 2 && tNorm.length >= 2 && (wNorm.startsWith(tNorm) || tNorm.startsWith(wNorm));
      if (eq || startsWith) { matched = ti + look; break; }
    }
    const tw = matched >= 0 ? textWords[matched] : null;
    const matchStr = matched >= 0 ? `→ textWords[${matched}]="${tw?.wordLower}" pause=${tw?.pause ?? "null"}` : "→ NO MATCH";
    console.log(`  whisper[${wi}] "${wNorm}" ${matchStr}`);
    if (matched >= 0) {
      ti = matched + 1;
      if (tw?.pause) insertionCount++;
    }
  }
  console.log(`\n  Estimated insertions in first 20 whisper words: ${insertionCount}`);

  // Cleanup
  try { fs.unlinkSync(tmpPath); } catch { /* ok */ }
  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
