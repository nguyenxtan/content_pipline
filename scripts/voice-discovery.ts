/**
 * voice-discovery.ts
 * Generates audio samples for all VieNeu-TTS voices and produces voice-samples.json.
 * Prioritises male voices, reports duration and WPM.
 *
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/voice-discovery.ts
 */
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const OUT_DIR     = path.join(process.cwd(), "media", "audio", "voice-samples");

// ~100-word Buddhist narration sample — used for all voices
const SAMPLE_TEXT = `Có những buổi sáng thức dậy, chưa kịp nhớ ra mình đang lo điều gì, \
nỗi lo đã tự chạy về trước. Như một người khách không mời mà đến, \
cứ gõ cửa mỗi ngày. Đức Phật từng nói: tâm không có nơi nương tựa vững chắc thì \
gió nhỏ cũng đủ làm nó nghiêng ngả. Nhưng điều đó không có nghĩa là ta yếu đuối. \
Đó chỉ là bản năng sinh tồn của một tâm trí chưa học được cách ở lại với hiện tại. \
Và học được điều đó, chính là hành trình mà chúng ta cùng đi hôm nay.`;

type VoiceInfo = {
  id: string;
  name: string;
  gender: "male" | "female";
  accent: "north" | "south";
};

type VoiceSampleRecord = VoiceInfo & {
  filePath: string;
  durationSec: number | null;
  wpm: number | null;
  priority: "recommended" | "secondary" | "female";
};

function classifyVoice(id: string, name: string): { gender: "male" | "female"; accent: "north" | "south" } {
  const n = name.toLowerCase();
  const gender: "male" | "female" = n.includes("nữ") ? "female" : "male";
  const accent: "north" | "south" = n.includes("miền nam") ? "south" : "north";
  return { gender, accent };
}

async function fetchVoices(): Promise<Array<{ id: string; name: string }>> {
  return new Promise((resolve, reject) => {
    http.get(`${TTS_API_URL}/voices`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data).voices ?? []); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function generateSample(voice: string, text: string, contentId: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text, voice, content_id: contentId, output_format: "wav" });
    const url = new URL(`${TTS_API_URL}/tts`);
    const options = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end",  () => {
        const buf = Buffer.concat(chunks);
        // If Content-Type is audio, return raw buffer
        if ((res.headers["content-type"] ?? "").includes("audio")) {
          resolve(buf);
        } else {
          // Try to parse as JSON error
          try {
            const json = JSON.parse(buf.toString());
            if (json.output_path) {
              // Server returned a path — read the file
              fs.readFile(json.output_path, (err, data) => {
                if (err) reject(new Error(`Cannot read output_path: ${json.output_path}`));
                else resolve(data);
              });
            } else {
              reject(new Error(`TTS returned non-audio: ${buf.toString().slice(0, 200)}`));
            }
          } catch {
            reject(new Error(`Unexpected TTS response: ${buf.toString().slice(0, 200)}`));
          }
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function generateSampleAsync(voiceId: string, text: string, contentId: string): Promise<string | null> {
  // Submit async job
  const submitBody = JSON.stringify({
    text,
    voice: voiceId,
    content_id: contentId,
    output_format: "wav",
  });

  const submitResult: { job_id?: string; output_path?: string; error?: string } = await new Promise((resolve, reject) => {
    const url = new URL(`${TTS_API_URL}/tts-async`);
    const options = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname,
      method:   "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(submitBody) },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(submitBody);
    req.end();
  });

  if (!submitResult.job_id) {
    console.warn(`  [${voiceId}] No job_id: ${JSON.stringify(submitResult)}`);
    return null;
  }

  // Poll for result
  const jobId = submitResult.job_id;
  const maxWait = 5 * 60 * 1000;
  const pollInterval = 3000;
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));

    const status: { status?: string; output_path?: string; error?: string } = await new Promise((resolve, reject) => {
      http.get(`${TTS_API_URL}/status/${jobId}`, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }).on("error", reject);
    });

    if (status.status === "done" && status.output_path) {
      return status.output_path;
    }
    if (status.status === "error") {
      throw new Error(`TTS error for ${voiceId}: ${status.error}`);
    }
  }
  throw new Error(`TTS timeout for ${voiceId}`);
}

function getWavDurationSec(buf: Buffer): number | null {
  // WAV header: bytes 24-27 = sample rate (little-endian uint32)
  // bytes 4-7 = chunk size, total file size = chunk size + 8
  // data chunk starts at byte 44 typically
  try {
    if (buf.slice(0, 4).toString() !== "RIFF") return null;
    const sampleRate = buf.readUInt32LE(24);
    const numChannels = buf.readUInt16LE(22);
    const bitsPerSample = buf.readUInt16LE(34);
    const dataSize = buf.readUInt32LE(40); // data chunk size at byte 40 (standard PCM WAV)
    if (!sampleRate || !numChannels || !bitsPerSample) return null;
    const bytesPerSample = bitsPerSample / 8;
    return dataSize / (sampleRate * numChannels * bytesPerSample);
  } catch {
    return null;
  }
}

function estimateWpm(text: string, durationSec: number): number {
  const wordCount = text.trim().split(/\s+/).length;
  return Math.round((wordCount / durationSec) * 60);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`\n=== Voice Discovery ===`);
  console.log(`Output: ${OUT_DIR}\n`);

  // Fetch available voices
  let rawVoices: Array<{ id: string; name: string }>;
  try {
    rawVoices = await fetchVoices();
    console.log(`Found ${rawVoices.length} voices: ${rawVoices.map(v => v.id).join(", ")}`);
  } catch (e) {
    console.error("Cannot reach TTS server:", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const results: VoiceSampleRecord[] = [];

  for (const raw of rawVoices) {
    const { gender, accent } = classifyVoice(raw.id, raw.name);
    const safeName = raw.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const outFile  = path.join(OUT_DIR, `voice-${safeName}-sample.wav`);
    const contentId = `voice-sample-${safeName}`;

    console.log(`\n[${raw.id}] ${raw.name} (${gender}, ${accent})`);
    console.log(`  Generating sample…`);

    let durationSec: number | null = null;
    let wpm: number | null = null;
    let filePath = `media/audio/voice-samples/voice-${safeName}-sample.wav`;

    try {
      // Try async endpoint first (more reliable for longer texts)
      let audioPath: string | null = null;
      try {
        audioPath = await generateSampleAsync(raw.id, SAMPLE_TEXT, contentId);
      } catch (asyncErr) {
        console.warn(`  Async failed (${(asyncErr as Error).message}), trying sync…`);
      }

      if (audioPath && fs.existsSync(audioPath)) {
        fs.copyFileSync(audioPath, outFile);
        const buf = fs.readFileSync(outFile);
        durationSec = getWavDurationSec(buf);
        if (durationSec) wpm = estimateWpm(SAMPLE_TEXT, durationSec);
        console.log(`  ✓ ${durationSec?.toFixed(1)}s  ${wpm} WPM  →  ${filePath}`);
      } else {
        // Sync fallback
        const buf = await generateSample(raw.id, SAMPLE_TEXT, contentId);
        fs.writeFileSync(outFile, buf);
        durationSec = getWavDurationSec(buf);
        if (durationSec) wpm = estimateWpm(SAMPLE_TEXT, durationSec);
        console.log(`  ✓ ${durationSec?.toFixed(1)}s  ${wpm} WPM  →  ${filePath}`);
      }
    } catch (err) {
      console.error(`  ✗ Failed: ${err instanceof Error ? err.message : err}`);
      filePath = "";
    }

    const priority = gender === "female" ? "female"
      : accent === "south" ? "recommended"
      : "secondary";

    results.push({
      id: raw.id,
      name: raw.name,
      gender,
      accent,
      filePath,
      durationSec,
      wpm,
      priority,
    });
  }

  // Write metadata JSON
  const jsonPath = path.join(OUT_DIR, "voice-samples.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ generated: new Date().toISOString(), sampleText: SAMPLE_TEXT, voices: results }, null, 2));
  console.log(`\nMetadata → media/audio/voice-samples/voice-samples.json`);

  // Report
  const male    = results.filter(r => r.gender === "male" && r.durationSec);
  const female  = results.filter(r => r.gender === "female" && r.durationSec);
  const southMale = male.filter(r => r.accent === "south");

  console.log("\n=== Recommended voices (male, southern accent — warm/calm narrator style) ===");
  for (const v of southMale) {
    console.log(`  [${v.id}] ${v.name}  |  ${v.durationSec?.toFixed(1)}s  ${v.wpm} WPM`);
  }

  console.log("\n=== Other male voices ===");
  for (const v of male.filter(r => r.accent !== "south")) {
    console.log(`  [${v.id}] ${v.name}  |  ${v.durationSec?.toFixed(1)}s  ${v.wpm} WPM`);
  }

  console.log("\n=== Female voices (for reference) ===");
  for (const v of female) {
    console.log(`  [${v.id}] ${v.name}  |  ${v.durationSec?.toFixed(1)}s  ${v.wpm} WPM`);
  }

  const top5 = [...southMale, ...male.filter(r => r.accent !== "south"), ...female]
    .filter(r => r.durationSec)
    .slice(0, 5);
  console.log("\n=== Top 5 recommended voices ===");
  for (const [i, v] of top5.entries()) {
    console.log(`  ${i + 1}. [${v.id}] ${v.name} (${v.gender}, ${v.accent})  — ${v.durationSec?.toFixed(1)}s / ${v.wpm} WPM`);
  }

  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
