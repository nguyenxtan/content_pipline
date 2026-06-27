/**
 * VieNeu Native Prosody Test
 *
 * Goal: determine whether VieNeu-TTS already handles Vietnamese punctuation/
 * prosody correctly, and whether our pipeline post-processing is destroying it.
 *
 * For each of 3 content IDs, exports 4 audio variants:
 *   A. raw_vieneu       — direct TTS output, zero processing
 *   B. loudnorm_only    — TTS + loudnorm only (no silenceremove, no injection)
 *   C. current_option_d — TTS + current silenceremove/loudnorm (production)
 *   D. rewritten_short  — shorter Vietnamese sentences + loudnorm only
 *
 * Output: media/qa/vieneu-native-prosody/
 * Read-only: no DB mutations, no production file changes, no queue modifications.
 */

// Injection must stay off
process.env.TTS_ENABLE_PUNCTUATION_PAUSES = "false";

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const TTS_VOICE   = "Ly";
const AUDIO_DIR   = path.join(process.cwd(), "media", "audio");
const QA_DIR      = path.join(process.cwd(), "media", "qa", "vieneu-native-prosody");

const POLL_INTERVAL_MS = 15_000;
const MAX_WAIT_MS      = 20 * 60 * 1000;

// ── 3 test items ──────────────────────────────────────────────────────────────
const TEST_ITEMS = [
  { id: "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd", topic: "Trả giá vì tham lam" },
  { id: "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621", topic: "Ghen tị" },
  { id: "cbf59089-fc7e-4ab2-82aa-f62e06990dcb", topic: "Chờ đợi sự trở về" },
];

// ── Hand-rewritten shorter Vietnamese sentences for variant D ─────────────────
// Original text split into 12-14 short, declarative sentences (≤15 words each)
// Purpose: test whether shorter sentences improve VieNeu's natural prosody
const REWRITTEN_TEXT: Record<string, string> = {
  "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd": [
    "Người sống trong tham lam không nhận ra mình đang tạo ra ngục tù.",
    "Ta thấy bạn bè miệt mài kiếm tiền nhưng vẫn lo lắng.",
    "Quý vị có bao giờ cảm thấy bận rộn mà thiếu niềm vui không?",
    "Tham lam kéo ta vào vòng xoáy.",
    "Ta quên đi những điều giản dị quý giá.",
    "Chạy theo của cải, ta đánh mất mối quan hệ.",
    "Ta mất những niềm vui nhỏ hằng ngày.",
    "Hãy dừng lại một giây.",
    "Hạnh phúc không nằm ở tài sản.",
    "Hạnh phúc nằm ở tâm hồn thanh thản.",
    "Cuộc sống là hành trình.",
    "Hãy để tâm ta được tự do.",
  ].join(" "),

  "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621": [
    "Ghen tị như con sâu âm thầm ăn mòn tâm hồn.",
    "Khi thấy bạn bè thành công, lòng mình đau.",
    "Tôi từng thấy đồng nghiệp được khen vì dự án xuất sắc.",
    "Nỗ lực của tôi lại bị bỏ qua.",
    "Nỗi buồn đó bám theo như chiếc bóng.",
    "Ta quên mất giá trị của chính mình.",
    "Khi ghen tị, ta chỉ thấy thành công của người khác.",
    "Ta không thấy những gian khổ họ đã trải qua.",
    "Cuộc sống không phải cuộc đua.",
    "Hãy trân trọng những gì mình đang có.",
    "Hạnh phúc thật không đến từ sự so sánh.",
  ].join(" "),

  "cbf59089-fc7e-4ab2-82aa-f62e06990dcb": [
    "Người ta hay chờ đợi những điều lớn lao.",
    "Họ quên mất giá trị của hiện tại.",
    "Một người mẹ ngồi bên khung cửa.",
    "Ánh mắt bà hướng về con đường xa.",
    "Đứa con đi làm ăn xa đã nhiều tháng chưa về.",
    "Tiếng cười ngày xưa nay chỉ còn là kỷ niệm.",
    "Những bữa cơm ấm cúng đã thành nỗi nhớ.",
    "Thời gian trôi qua nhưng nỗi lo không dứt.",
    "Chờ đợi đôi khi là sự trống rỗng.",
    "Mỗi giây đều quý giá.",
    "Hãy quay về với hiện tại.",
    "Ta sẽ tìm thấy niềm vui nhỏ bé ở đó.",
    "Khi biết chờ, ta biết yêu thương.",
    "Hãy để tâm hồn được tự do.",
  ].join(" "),
};

// ── Original texts (retrieved from DB in prior session; hardcoded to avoid DB dependency) ──────
const ORIGINAL_TEXT: Record<string, string> = {
  "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd": "Người sống trong tham lam thường không nhận ra mình đang tự tạo ra ngục tù. Nhìn quanh, ta thấy những người bạn miệt mài kiếm tiền, chất đống tài sản mà vẫn không ngừng lo lắng về điều mất mát. Có khi nào quý vị cảm thấy bận rộn, nhưng lại thiếu vắng niềm vui trong từng khoảnh khắc? Tham lam kéo ta vào vòng xoáy, khiến ta quên đi những điều giản dị quý giá. Khi ta chạy theo của cải, ta đánh mất những mối quan hệ, những niềm vui nho nhỏ hằng ngày. Đôi khi, chỉ cần một giây phút dừng lại, ta có thể nhận ra hạnh phúc không nằm ở số lượng tài sản, mà ở tâm hồn thanh thản. Cuộc sống là một hành trình, hãy để tâm ta được tự do.",

  "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621": "Cảm giác ghen tị như con sâu ăn mòn tâm hồn mà ta không biết. Khi quý vị nhìn thấy bạn bè thành công, có những điều mà mình từng ao ước, lòng mình như bị xát muối. Tôi nhớ có lần thấy một đồng nghiệp được khen ngợi vì dự án xuất sắc, trong khi nỗ lực của mình lại chìm vào quên lãng. Nỗi buồn ấy như chiếc bóng theo đuổi ta, khiến ta quên đi giá trị của chính mình. Khi ta ghen tị, ta chỉ thấy phần nổi của thành công mà không nhận ra những gian khổ mà người khác đã trải qua. Cuộc sống không phải là cuộc đua, mà là hành trình tự nhìn nhận bản thân. Hãy nhớ rằng, hạnh phúc thật sự không đến từ sự so sánh, mà từ sự trân trọng những gì mình đang có.",

  "cbf59089-fc7e-4ab2-82aa-f62e06990dcb": "Người ta thường chờ đợi những điều lớn lao, nhưng lại quên mất giá trị của phút giây hiện tại.\n\nTrong góc quán nhỏ, một người mẹ ngồi bên khung cửa, ánh mắt xa xăm hướng về con đường. Đã nhiều tháng rồi, đứa con trai đi làm ăn xa chưa trở về. Những kỷ niệm xưa ùa về, tiếng cười nói, những bữa cơm ấm cúng giờ chỉ còn là nỗi nhớ.\n\nThời gian trôi qua, nhưng nỗi lo lắng không thuyên giảm. Chờ đợi, đôi khi, không phải là sự mong mỏi, mà là sự trống rỗng.\n\nMỗi giây đều quý giá, và có thể, chỉ cần quay về hiện tại, ta sẽ tìm thấy niềm vui trong từng khoảnh khắc nhỏ bé. Chúng ta không thể quyết định tương lai, nhưng có thể sống trọn vẹn với hiện tại. Khi ta biết chờ, ta cũng biết yêu thương. Hãy để tâm hồn được tự do trong từng phút giây sống.",
};

// ── Text normalization (mirrors tts.ts) ───────────────────────────────────────
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

// ── TTS API ───────────────────────────────────────────────────────────────────
function resolveLocalPath(filePath: string): string {
  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) return filePath;
  return path.join(process.cwd(), filePath.replace(/^\/+/, ""));
}

async function submitAndPollTTS(text: string, contentId: string): Promise<string> {
  const submitRes = await fetch(`${TTS_API_URL}/tts/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content_id: contentId, voice: TTS_VOICE }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => "");
    throw new Error(`TTS submit failed ${submitRes.status}: ${body}`);
  }
  const { job_id } = await submitRes.json() as { job_id: string };
  console.log(`    TTS job submitted: ${job_id} (content_id=${contentId})`);

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
    const pollRes = await fetch(`${TTS_API_URL}/tts/status/${job_id}`, {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!pollRes?.ok) continue;

    const status = await pollRes.json() as {
      status: string; path?: string; error?: string;
    };
    if (status.status === "done") {
      if (!status.path) throw new Error("TTS done but no path");
      const hostPath = resolveLocalPath(status.path);
      if (!fs.existsSync(hostPath)) throw new Error(`TTS file not found: ${status.path} → ${hostPath}`);
      return hostPath;
    }
    if (status.status === "error") throw new Error(status.error ?? "TTS error");
    process.stdout.write(".");
  }
  throw new Error(`TTS timeout after ${MAX_WAIT_MS / 60000} min`);
}

// ── FFmpeg variants ───────────────────────────────────────────────────────────

/** Variant A: raw copy, no processing */
async function variantA_raw(inputPath: string, outputPath: string): Promise<void> {
  fs.copyFileSync(inputPath, outputPath);
}

/** Variant B: loudnorm only (no silenceremove) */
async function variantB_loudnorm(inputPath: string, outputPath: string): Promise<void> {
  const tmp = `${outputPath}.tmp.wav`;
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", inputPath,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    tmp,
  ], { timeout: 60_000 });
  fs.renameSync(tmp, outputPath);
}

/** Variant C: current Option D — silenceremove + loudnorm */
async function variantC_optionD(inputPath: string, outputPath: string): Promise<void> {
  const tmp = `${outputPath}.tmp.wav`;
  // All silenceremove params are colon-separated (one filter), then comma to loudnorm (next filter)
  const silenceFilter = [
    "silenceremove=start_periods=1",
    "start_threshold=-50dB",
    "start_silence=0.05",
    "stop_periods=-1",
    "stop_threshold=-50dB",
    "stop_duration=0.80",
    "stop_silence=0.28",
    "detection=rms",
  ].join(":");
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-i", inputPath,
    "-af", `${silenceFilter},loudnorm=I=-16:TP=-1.5:LRA=11`,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
    tmp,
  ], { timeout: 60_000 });
  fs.renameSync(tmp, outputPath);
}

// ── Silence diagnostics ───────────────────────────────────────────────────────

type SilenceSegment = { start: number; end: number; durationMs: number };

async function getAudioDurationSec(filePath: string): Promise<number | null> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", filePath, "-f", "null", "-",
    ], { timeout: 15_000 }).catch(e => e as { stderr?: string });
    const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(
      (result as { stderr?: string }).stderr ?? ""
    );
    if (!m) return null;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch { return null; }
}

async function detectSilenceSegments(
  filePath: string,
  noiseDb = -50,
  minDurSec = 0.15,
): Promise<SilenceSegment[]> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", filePath,
      "-af", `silencedetect=noise=${noiseDb}dB:d=${minDurSec}`,
      "-f", "null", "-",
    ], { timeout: 30_000 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";
    const starts: number[] = [];
    const segments: SilenceSegment[] = [];
    let m: RegExpExecArray | null;
    const startRe = /silence_start:\s*([\d.]+)/g;
    const endRe   = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;
    while ((m = startRe.exec(stderr)) !== null) starts.push(parseFloat(m[1]));
    let ei = 0;
    while ((m = endRe.exec(stderr)) !== null) {
      const end = parseFloat(m[1]), dur = parseFloat(m[2]);
      segments.push({ start: starts[ei] ?? (end - dur), end, durationMs: Math.round(dur * 1000) });
      ei++;
    }
    return segments;
  } catch { return []; }
}

type AudioDiag = {
  filePath: string;
  durationSec: number | null;
  seg150: number;
  seg300: number;
  seg500: number;
  maxMs: number;
  avgMs: number;
  totalMs: number;
  ratioPercent: number;
  silenceSegments150: SilenceSegment[];
  prosodyNote: string;
};

async function diagAudio(filePath: string): Promise<AudioDiag> {
  const durationSec = await getAudioDurationSec(filePath);
  const [s150, s300, s500] = await Promise.all([
    detectSilenceSegments(filePath, -50, 0.15),
    detectSilenceSegments(filePath, -50, 0.30),
    detectSilenceSegments(filePath, -50, 0.50),
  ]);
  const totalMs = s150.reduce((s, seg) => s + seg.durationMs, 0);
  const maxMs   = s150.reduce((m, seg) => Math.max(m, seg.durationMs), 0);
  const avgMs   = s150.length > 0 ? Math.round(totalMs / s150.length) : 0;
  const ratioPercent = durationSec && durationSec > 0
    ? Math.round((totalMs / 1000 / durationSec) * 100) : 0;

  // Prosody note: whether silence distribution looks like natural punctuation pauses
  let prosodyNote = "";
  if (s150.length === 0) {
    prosodyNote = "no detectable pauses (all compressed)";
  } else if (s500.length > 0 && s500.length === s300.length) {
    prosodyNote = `${s500.length} pauses ≥500ms (likely sentence boundaries respected)`;
  } else if (s300.length > 0) {
    prosodyNote = `${s300.length} pauses ≥300ms, ${s150.length - s300.length} pauses 150–300ms`;
  } else {
    prosodyNote = `${s150.length} pauses 150–300ms only (no sentence-length pauses)`;
  }

  return {
    filePath: path.relative(process.cwd(), filePath),
    durationSec, seg150: s150.length, seg300: s300.length, seg500: s500.length,
    maxMs, avgMs, totalMs, ratioPercent, silenceSegments150: s150, prosodyNote,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(QA_DIR, { recursive: true });

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  VieNeu Native Prosody Test — 4 Variants × 3 Content IDs");
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Verify TTS server is up
  const health = await fetch(`${TTS_API_URL}/health`, { signal: AbortSignal.timeout(5_000) })
    .then(r => r.json() as Promise<{ status: string }>)
    .catch(() => null);
  if (!health || health.status !== "ok") {
    console.error("ABORT: TTS server not reachable at", TTS_API_URL);
    process.exit(1);
  }
  console.log(`TTS server: OK (${TTS_API_URL})\n`);

  type ItemResult = {
    id: string;
    topic: string;
    origTextNorm: string;
    rewrittenText: string;
    variants: { label: string; name: string; diag: AudioDiag }[];
  };

  const results: ItemResult[] = [];

  for (const { id, topic } of TEST_ITEMS) {
    const id8 = id.slice(0, 8);
    console.log(`\n── ${id8} — ${topic} ──────────────────────────────────────────────`);

    // Original text (retrieved from DB in prior session)
    const rawOrigText = ORIGINAL_TEXT[id];
    if (!rawOrigText) {
      console.log(`  SKIP: no hardcoded shortContent for ${id8}`);
      continue;
    }

    const origTextNorm  = normalizeTextForTTS(rawOrigText);
    const rewrittenText = REWRITTEN_TEXT[id] ?? origTextNorm;

    console.log(`  Original text (normalized): ${origTextNorm.length} chars, ` +
      `${(origTextNorm.match(/[.!?]/g) ?? []).length} sentences, ` +
      `${(origTextNorm.match(/[,;:]/g) ?? []).length} commas`);
    console.log(`  Rewritten text:             ${rewrittenText.length} chars, ` +
      `${(rewrittenText.match(/[.!?]/g) ?? []).length} sentences, ` +
      `${(rewrittenText.match(/[,;:]/g) ?? []).length} commas\n`);

    // ── TTS call 1: original text ──────────────────────────────────────────
    const origTtsId  = `qap-orig-${id8}`;
    const origTmpWav = path.join(AUDIO_DIR, `${origTtsId}.wav`);
    let rawOrigPath: string;
    if (fs.existsSync(origTmpWav)) {
      rawOrigPath = origTmpWav;
      console.log(`  [A/B/C] Reusing cached raw TTS → ${path.relative(process.cwd(), rawOrigPath)} (${(fs.statSync(rawOrigPath).size / 1024).toFixed(0)} KB)`);
    } else {
      console.log(`  [A/B/C] Submitting TTS for original text (content_id=${origTtsId})…`);
      rawOrigPath = await submitAndPollTTS(origTextNorm, origTtsId);
      console.log(`\n  Raw TTS done → ${path.relative(process.cwd(), rawOrigPath)} (${(fs.statSync(rawOrigPath).size / 1024).toFixed(0)} KB)`);
    }

    // ── Generate variants A, B, C from same raw audio ─────────────────────
    const varA = path.join(QA_DIR, `${id8}_A_raw_vieneu.wav`);
    const varB = path.join(QA_DIR, `${id8}_B_loudnorm_only.wav`);
    const varC = path.join(QA_DIR, `${id8}_C_current_option_d.wav`);

    process.stdout.write("  Generating A (raw)…");
    await variantA_raw(rawOrigPath, varA);
    console.log(" done");

    process.stdout.write("  Generating B (loudnorm only)…");
    await variantB_loudnorm(rawOrigPath, varB);
    console.log(" done");

    process.stdout.write("  Generating C (silenceremove + loudnorm)…");
    await variantC_optionD(rawOrigPath, varC);
    console.log(" done");

    // ── TTS call 2: rewritten text ─────────────────────────────────────────
    const rwTtsId  = `qap-rw-${id8}`;
    const rwTmpWav = path.join(AUDIO_DIR, `${rwTtsId}.wav`);
    let rawRwPath: string;
    if (fs.existsSync(rwTmpWav)) {
      rawRwPath = rwTmpWav;
      console.log(`\n  [D] Reusing cached rewritten TTS → ${path.relative(process.cwd(), rawRwPath)}`);
    } else {
      console.log(`\n  [D] Submitting TTS for rewritten text (content_id=${rwTtsId})…`);
      rawRwPath = await submitAndPollTTS(rewrittenText, rwTtsId);
      console.log(`\n  Raw rewritten TTS done → ${path.relative(process.cwd(), rawRwPath)}`);
    }

    const varD = path.join(QA_DIR, `${id8}_D_rewritten_short.wav`);
    process.stdout.write("  Generating D (rewritten + loudnorm)…");
    await variantB_loudnorm(rawRwPath, varD); // same processing as B
    console.log(" done");

    // ── Clean up temp TTS files from media/audio ───────────────────────────
    for (const tmp of [rawOrigPath, rawRwPath]) {
      try { fs.unlinkSync(tmp); } catch { /* ok */ }
    }

    // ── Diagnose all 4 variants ────────────────────────────────────────────
    console.log("\n  Running silence diagnostics…");
    const variants = await Promise.all([
      diagAudio(varA).then(d => ({ label: "A", name: "raw_vieneu", diag: d })),
      diagAudio(varB).then(d => ({ label: "B", name: "loudnorm_only", diag: d })),
      diagAudio(varC).then(d => ({ label: "C", name: "current_option_d", diag: d })),
      diagAudio(varD).then(d => ({ label: "D", name: "rewritten_short", diag: d })),
    ]);

    results.push({ id, topic, origTextNorm, rewrittenText, variants });

    // Quick per-item summary
    for (const v of variants) {
      console.log(
        `  ${v.label} ${v.name.padEnd(18)} dur=${v.diag.durationSec?.toFixed(1).padStart(5) ?? "?"}s ` +
        `seg>150=${String(v.diag.seg150).padStart(2)} seg>300=${String(v.diag.seg300).padStart(2)} ` +
        `seg>500=${String(v.diag.seg500).padStart(2)} max=${String(v.diag.maxMs).padStart(4)}ms ` +
        `avg=${String(v.diag.avgMs).padStart(3)}ms ratio=${String(v.diag.ratioPercent).padStart(2)}%`
      );
    }
  }

  // ── Final report ──────────────────────────────────────────────────────────
  console.log("\n\n════════════════════════════════════════════════════════════════════");
  console.log("  NATIVE PROSODY TEST — FINAL REPORT");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // ── Native Prosody Test (per item) ────────────────────────────────────────
  console.log("## Native Prosody Test\n");
  for (const item of results) {
    const id8 = item.id.slice(0, 8);
    console.log(`### ${id8} — ${item.topic}`);
    console.log(`Original text:  ${item.origTextNorm.length} chars`);
    console.log(`Rewritten text: ${item.rewrittenText.length} chars`);
    for (const v of item.variants) {
      const d = v.diag;
      console.log(`  [${v.label}] ${v.name.padEnd(20)} ${d.durationSec?.toFixed(1).padStart(5) ?? "?"}s | ` +
        `>150ms:${d.seg150.toString().padStart(2)} >300ms:${d.seg300.toString().padStart(2)} >500ms:${d.seg500.toString().padStart(2)} | ` +
        `max:${d.maxMs.toString().padStart(4)}ms avg:${d.avgMs.toString().padStart(3)}ms ratio:${d.ratioPercent.toString().padStart(2)}% | ` +
        `${d.prosodyNote}`);
      console.log(`        → ${d.filePath}`);
    }
    console.log();
  }

  // ── Variant Comparison (aggregate) ───────────────────────────────────────
  console.log("## Variant Comparison\n");

  const variantLabels = ["A", "B", "C", "D"];
  const variantNames  = ["raw_vieneu", "loudnorm_only", "current_option_d", "rewritten_short"];

  // Compute cross-item averages
  const avgByVariant = variantLabels.map((label, li) => {
    const items = results
      .map(r => r.variants.find(v => v.label === label)?.diag)
      .filter(Boolean) as typeof results[number]["variants"][number]["diag"][];
    if (items.length === 0) return null;
    const n = items.length;
    return {
      label,
      name: variantNames[li],
      avgDur:   items.reduce((s, d) => s + (d.durationSec ?? 0), 0) / n,
      avgSeg150: items.reduce((s, d) => s + d.seg150, 0) / n,
      avgSeg300: items.reduce((s, d) => s + d.seg300, 0) / n,
      avgSeg500: items.reduce((s, d) => s + d.seg500, 0) / n,
      avgMax:   items.reduce((s, d) => s + d.maxMs, 0) / n,
      avgAvg:   items.reduce((s, d) => s + d.avgMs, 0) / n,
      avgRatio: items.reduce((s, d) => s + d.ratioPercent, 0) / n,
    };
  }).filter(Boolean);

  console.log("Variant averages across 3 items:\n");
  console.log("Variant | Name                | dur(s) | seg>150 | seg>300 | seg>500 | maxMs | avgMs | ratio%");
  console.log("--------|---------------------|--------|---------|---------|---------|-------|-------|-------");
  for (const v of avgByVariant) {
    if (!v) continue;
    console.log(
      `${v.label.padEnd(7)} | ${v.name.padEnd(19)} | ${v.avgDur.toFixed(1).padStart(6)} | ` +
      `${v.avgSeg150.toFixed(1).padStart(7)} | ${v.avgSeg300.toFixed(1).padStart(7)} | ${v.avgSeg500.toFixed(1).padStart(7)} | ` +
      `${Math.round(v.avgMax).toString().padStart(5)} | ${Math.round(v.avgAvg).toString().padStart(5)} | ${Math.round(v.avgRatio).toString().padStart(6)}`
    );
  }

  // Key analysis
  const rawA   = avgByVariant.find(v => v?.label === "A");
  const normB  = avgByVariant.find(v => v?.label === "B");
  const optC   = avgByVariant.find(v => v?.label === "C");
  const rwD    = avgByVariant.find(v => v?.label === "D");

  console.log("\n### Key comparisons:");

  if (rawA && normB) {
    const seg500Delta = normB.avgSeg500 - rawA.avgSeg500;
    const seg150Delta = normB.avgSeg150 - rawA.avgSeg150;
    if (seg500Delta < -0.5) {
      console.log(`  B vs A: loudnorm removed ${(-seg500Delta).toFixed(1)} sentence-length pauses on avg → loudnorm COMPRESSES prosody`);
    } else if (Math.abs(seg500Delta) <= 0.5) {
      console.log(`  B vs A: loudnorm preserves sentence-length pauses (Δ ≤0.5 avg) → loudnorm is SAFE`);
    } else {
      console.log(`  B vs A: loudnorm added ${seg500Delta.toFixed(1)} pauses on avg (normalizes dynamics)`);
    }
    if (seg150Delta < -1) {
      console.log(`  B vs A: loudnorm also removed ${(-seg150Delta).toFixed(1)} short pauses avg (clamps micro-rests)`);
    }
  }

  if (rawA && optC) {
    const seg500Delta = optC.avgSeg500 - rawA.avgSeg500;
    const seg150Delta = optC.avgSeg150 - rawA.avgSeg150;
    if (seg500Delta < -0.5 || seg150Delta < -1) {
      console.log(`  C vs A: silenceremove STRIPS prosody — removes ${(-seg500Delta).toFixed(1)} sentence pauses + ${(-seg150Delta).toFixed(1)} short pauses avg`);
    } else {
      console.log(`  C vs A: silenceremove with stop_duration=0.80 preserves most prosody`);
    }
  }

  if (normB && optC) {
    const durDelta = optC.avgDur - normB.avgDur;
    const segDelta = optC.avgSeg150 - normB.avgSeg150;
    if (segDelta < -1) {
      console.log(`  C vs B: silenceremove strips ${(-segDelta).toFixed(1)} extra pauses (${(-durDelta).toFixed(1)}s shorter) vs loudnorm-only`);
    } else {
      console.log(`  C vs B: silenceremove at 0.80 threshold similar to loudnorm-only (Δseg150=${segDelta.toFixed(1)})`);
    }
  }

  if (normB && rwD) {
    const durRatio = (rwD.avgDur / normB.avgDur) * 100;
    const seg500Delta = rwD.avgSeg500 - normB.avgSeg500;
    console.log(`  D vs B: rewritten text ${durRatio.toFixed(0)}% of original duration`);
    if (seg500Delta > 0.5) {
      console.log(`  D vs B: rewritten sentences produce ${seg500Delta.toFixed(1)} MORE sentence-length pauses avg → sentence structure HELPS VieNeu prosody`);
    } else if (seg500Delta < -0.5) {
      console.log(`  D vs B: rewritten sentences produce ${(-seg500Delta).toFixed(1)} FEWER sentence-length pauses avg (shorter = less room for prosody)`);
    } else {
      console.log(`  D vs B: rewritten vs original produce similar sentence-length pauses (sentence length doesn't matter much)`);
    }
  }

  // ── VieNeu raw prosody characterization ──────────────────────────────────
  console.log("\n### VieNeu raw prosody (variant A):");
  if (rawA) {
    const punctRespected = rawA.avgSeg500 >= 1.5; // at least 1.5 sentence pauses on avg
    const commaPauses    = rawA.avgSeg150 > rawA.avgSeg300; // some 150–300ms pauses = commas?
    console.log(`  Avg seg>500ms: ${rawA.avgSeg500.toFixed(1)} → sentence boundaries ${punctRespected ? "DETECTED (VieNeu respects .!?)" : "NOT consistently detected"}`);
    console.log(`  Avg seg>150ms: ${rawA.avgSeg150.toFixed(1)}, avg seg>300ms: ${rawA.avgSeg300.toFixed(1)}`);
    console.log(`  Short pauses (150–300ms): ${(rawA.avgSeg150 - rawA.avgSeg300).toFixed(1)} avg → ${commaPauses ? "suggests comma pauses are present naturally" : "no clear comma pause pattern"}`);
    console.log(`  Avg silence ratio: ${rawA.avgRatio.toFixed(0)}%`);
  }

  // ── Likely Cause ──────────────────────────────────────────────────────────
  console.log("\n## Likely Cause\n");

  if (rawA && normB && optC && rwD) {
    const vieneuHasSentencePauses = (rawA.avgSeg500 >= 1.5);
    const loudnormDestroysProsoody = (normB.avgSeg500 < rawA.avgSeg500 - 0.5);
    const silenceremoveDestroys    = (optC.avgSeg500 < normB.avgSeg500 - 0.5) ||
                                     (optC.avgSeg150 < normB.avgSeg150 - 1.5);
    const shorterSentencesHelp     = (rwD.avgSeg500 > normB.avgSeg500 + 0.5);

    if (vieneuHasSentencePauses && !loudnormDestroysProsoody && silenceremoveDestroys) {
      console.log("Cause 1 — VieNeu ALREADY handles punctuation; silenceremove (even at 0.80 threshold) strips prosody");
      console.log("  → VieNeu produces natural sentence/comma pauses in raw output");
      console.log("  → Loudnorm alone is safe (preserves pauses)");
      console.log("  → Silenceremove degrades prosody even at stop_duration=0.80");
      console.log("  → Pipeline post-processing is the primary problem");
      console.log("\n  Verdict: [1] VieNeu already handles punctuation; pipeline post-processing breaks it");
    } else if (vieneuHasSentencePauses && !loudnormDestroysProsoody && !silenceremoveDestroys) {
      console.log("Cause 1 (mild) — VieNeu handles punctuation; current Option D pipeline is acceptable");
      console.log("  → VieNeu produces natural pauses, both B and C preserve them adequately");
      console.log("  → The 'khựng' issue was caused ENTIRELY by injected silence, not by silenceremove");
      console.log("\n  Verdict: [1] VieNeu already handles punctuation; our Option D pipeline is now correct");
    } else if (!vieneuHasSentencePauses && shorterSentencesHelp) {
      console.log("Cause 2 + 4 — VieNeu needs better sentence formatting; shorter sentences help");
      console.log("  → VieNeu does NOT consistently produce sentence-length pauses from long text");
      console.log("  → Shorter sentences (variant D) produce more natural prosodic breaks");
      console.log("\n  Verdict: [4] Need sentence chunking + [2] VieNeu needs better sentence formatting");
    } else if (vieneuHasSentencePauses && loudnormDestroysProsoody) {
      console.log("Cause 1 — VieNeu handles punctuation; loudnorm compresses dynamic range too aggressively");
      console.log("  → Even loudnorm alone destroys prosodic pauses");
      console.log("\n  Verdict: [1] VieNeu already handles punctuation; even loudnorm breaks it");
    } else {
      console.log("Cause 3 — Both: VieNeu produces inconsistent prosody AND pipeline amplifies the problem");
      console.log("\n  Verdict: [3] Both: inconsistent VieNeu prosody + pipeline degradation");
    }

    if (shorterSentencesHelp) {
      console.log(`\n  Additional note: shorter sentences (D) produced ${(rwD.avgSeg500 - normB.avgSeg500).toFixed(1)} more sentence-length pauses avg`);
      console.log("  → Script rewriting may be a simple quality improvement regardless of cause");
    }
  }

  // ── Recommendation ────────────────────────────────────────────────────────
  console.log("\n## Recommendation\n");

  if (rawA && normB && optC) {
    const optionDSafe = Math.abs(optC.avgSeg500 - normB.avgSeg500) <= 0.5 &&
                        Math.abs(optC.avgSeg150 - normB.avgSeg150) <= 2;
    if (optionDSafe) {
      console.log("1. Current Option D (silenceremove 0.80 + loudnorm) is acceptable — preserves");
      console.log("   VieNeu's natural prosody adequately. The 'khựng' problem was caused by");
      console.log("   injected pauses (now disabled), not by silenceremove itself.");
      console.log("   → Keep TTS_ENABLE_PUNCTUATION_PAUSES=false");
      console.log("   → Proceed with Option E (net-addition) only if further quality testing shows");
      console.log("     that pacing still lags behind the guideline targets.");
    } else {
      console.log("1. Switch to loudnorm-only pipeline (variant B) — silenceremove strips too much prosody.");
      console.log("   Change normalizeAudioWithLoudnorm to omit silenceremove entirely.");
      console.log("   Risk: some raw TTS files may have leading silence artifacts → test on 5 items first.");
    }

    if (rwD && rwD.avgSeg500 > (normB.avgSeg500 + 0.5)) {
      console.log("2. Consider rewriting long scripts to shorter sentences (≤15 words).");
      console.log("   Variant D shows improved natural pauses. This is a low-risk quality improvement.");
      console.log("   Implement as a script_engine post-processing step or prompt instruction.");
    }
    console.log("3. Option E (net-addition pause logic) remains the correct path for controlled");
    console.log("   pacing — but only once the silenceremove vs loudnorm decision above is settled.");
  }

  console.log("\n════════════════════════════════════════════════════════════════════");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
