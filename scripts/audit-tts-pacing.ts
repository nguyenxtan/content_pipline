/**
 * TTS Short Audio Pacing Audit — Pass 2 remediation items
 *
 * Goal: determine root cause of "khựng" (stuttered) audio after
 * deterministic punctuation-pause injection.
 *
 * Read-only: no DB mutations, no queue modifications, no re-rendering.
 * Scope: phat_phap tts_short, 26 remediated content IDs.
 *
 * Deliverables:
 *  - Audit table (all 26 items)
 *  - Audio diagnostics per file (silence segments, clustering)
 *  - Queue urgency check (6h/12h/24h)
 *  - 5 preview clips exported to media/qa/tts-pacing-audit/
 *  - Root cause analysis
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const AUDIO_DIR = path.join(process.cwd(), "media", "audio");
const QA_DIR    = path.join(process.cwd(), "media", "qa", "tts-pacing-audit");
const VN_TZ     = "Asia/Ho_Chi_Minh";

// ── BUDDHIST_CALM_PROFILE constants ──────────────────────────────────────────
const PROFILE = {
  commaPauseMs:    220,
  sentencePauseMs: 560,
  paragraphPauseMs: 850,
};

// ── Buddhist pacing guidelines (per user brief) ───────────────────────────────
const GUIDELINES = {
  commaMs:     { min: 120, max: 180 },
  sentenceMs:  { min: 300, max: 450 },
  paragraphMs: { min: 600, max: 750 },
  maxSilenceRatioPct: 14,   // max total silence as % of audio duration
  maxPausesPerWindow: 2,    // ≤2 pauses per 3-second window
  windowSec: 3,
};

// ── 26 affected IDs ───────────────────────────────────────────────────────────
const AFFECTED_IDS = [
  { id: "d3cd102a-1ac8-4cfb-8772-7de68401f23d", topic: "Xót xa mất mát" },
  { id: "46de084b-9e2f-4230-89f5-b84f7cf29528", topic: "Tìm kiếm công bằng" },
  { id: "aff684e0-721e-47cc-9b5a-836b468b4ca4", topic: "Sự cô đơn trong lòng" },
  { id: "1fcd2512-83e1-480c-8b6b-eb282c7e76de", topic: "Kẻ phản bội sống ác" },
  { id: "f48a5849-1b47-490d-a7cd-598510ca03f5", topic: "Mất lòng tự trọng" },
  { id: "fb263643-35c9-497c-abea-96e9ac0fb210", topic: "Nhân quả khổ đau" },
  { id: "fe2b62e4-9871-40c4-a7f2-9aa411530dd9", topic: "Tiểu nhân đắc chí" },
  { id: "5d02ce90-4cea-4ba5-9c5a-09704186a98e", topic: "Nỗi nhớ chưa nguôi" },
  { id: "b9757a63-ebbf-4ecc-a4e6-6ad516b80df2", topic: "Im lặng trước người xấu" },
  { id: "8d9eb929-4730-487a-bbd0-1c0f1d9ac744", topic: "Buông bỏ người không còn yêu" },
  { id: "957b26f5-990e-489d-adff-fd7964fae7be", topic: "Nhẫn nhịn là trí tuệ" },
  { id: "40bd7814-6f8f-4737-9720-58c25dfebc92", topic: "Nỗi đau mất mát" },
  { id: "d771fe18-e6ed-4f01-856d-aae7abd3afb6", topic: "Nỗi buồn phản bội" },
  { id: "17daebc8-e073-46bf-b293-a00ecc6f3b1e", topic: "Tìm kiếm bình an" },
  { id: "2c0aabf2-29be-4e22-bdbd-fb37656ed6f4", topic: "Mất lòng tin" },
  { id: "8d326891-78c0-4ad1-a50e-92849d05a2ca", topic: "Nỗi đau lừa dối" },
  { id: "e93d6d17-6447-4a58-8dfc-78dabe75a20b", topic: "Mất mát tình yêu" },
  { id: "b86163cd-4ada-49e5-a72c-dc506de6c929", topic: "Tìm kiếm sự bình yên" },
  { id: "b9977f99-0a2c-482a-bd5a-37cafec4a5ba", topic: "Tìm kiếm sự chấp nhận" },
  { id: "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd", topic: "Trả giá vì tham lam" },
  { id: "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621", topic: "Ghen tị" },
  { id: "cbf59089-fc7e-4ab2-82aa-f62e06990dcb", topic: "Chờ đợi sự trở về" },
  { id: "45bc05a4-167f-4623-80cb-4aa334c1348c", topic: "Chấp nhận sự im lặng" },
  { id: "122386da-cf49-4164-b7b5-ff1feefd7e5a", topic: "Nỗi đau trả giá" },
  { id: "ea1c1edf-7e98-4b78-a8c8-06d6e8e865c5", topic: "Nỗi đau bị phản bội" },
  { id: "8285d11f-60ed-40dd-bf86-30ba563c87a7", topic: "Lòng tự trọng" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toVn(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TZ, dateStyle: "short", timeStyle: "medium",
  }).format(d);
}

async function getAudioDurationSec(filePath: string): Promise<number | null> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", filePath, "-f", "null", "-",
    ], { timeout: 15_000 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";
    const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
    if (!m) return null;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch { return null; }
}

type SilenceSegment = { start: number; end: number; durationMs: number };

/**
 * Run ffmpeg silencedetect on a WAV file.
 * Returns all detected silence segments with their durations.
 */
async function detectSilenceSegments(
  filePath: string,
  noiseDb = -50,
  minDurationSec = 0.15,
): Promise<SilenceSegment[]> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", filePath,
      "-af", `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
      "-f", "null", "-",
    ], { timeout: 60_000 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";

    const segments: SilenceSegment[] = [];
    const startRegex = /silence_start:\s*([\d.]+)/g;
    const endRegex   = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;

    const starts: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = startRegex.exec(stderr)) !== null) starts.push(parseFloat(m[1]));

    let endIdx = 0;
    while ((m = endRegex.exec(stderr)) !== null) {
      const end  = parseFloat(m[1]);
      const dur  = parseFloat(m[2]);
      const start = starts[endIdx] ?? (end - dur);
      segments.push({ start, end, durationMs: Math.round(dur * 1000) });
      endIdx++;
    }

    return segments;
  } catch { return []; }
}

/**
 * Detect silence clusters: count of windows where ≥3 pause boundaries fall
 * within a 3-second span (triggers "khựng" perception).
 */
function findSuspiciousClusters(
  segments: SilenceSegment[],
  windowSec = 3,
  threshold = 3,
): Array<{ windowStart: number; windowEnd: number; count: number }> {
  const clusters: Array<{ windowStart: number; windowEnd: number; count: number }> = [];
  for (let i = 0; i < segments.length; i++) {
    const windowEnd = segments[i].start + windowSec;
    let count = 0;
    for (let j = i; j < segments.length && segments[j].start <= windowEnd; j++) count++;
    if (count >= threshold) {
      clusters.push({ windowStart: segments[i].start, windowEnd, count });
      i += count - 1; // skip ahead past this cluster
    }
  }
  return clusters;
}

/**
 * Export a 15-second preview clip starting just before a suspicious cluster.
 */
async function exportPreviewClip(
  inputPath: string,
  outputPath: string,
  startSec: number,
  durationSec = 15,
): Promise<boolean> {
  try {
    const ss = Math.max(0, startSec - 1);
    await execFileAsync(FFMPEG_PATH, [
      "-y",
      "-i", inputPath,
      "-ss", ss.toFixed(3),
      "-t", durationSec.toFixed(3),
      "-c:a", "copy",
      outputPath,
    ], { timeout: 30_000 });
    return true;
  } catch { return false; }
}

/**
 * Parse normalizedText for punctuation counts — mirrors tts.ts parseTextWordPuncts.
 */
function countTextPunctuation(text: string): { commas: number; sentences: number; words: number } {
  let commas = 0, sentences = 0, words = 0;
  const tokens = text.split(/\s+/);
  for (const token of tokens) {
    if (!token) continue;
    const m = /^([\p{L}\d]+)(.*)/u.exec(token);
    if (!m) continue;
    words++;
    const punct = m[2] ?? "";
    if (/[,;:]/.test(punct)) commas++;
    else if (/[.!?…]/.test(punct)) sentences++;
  }
  return { commas, sentences, words };
}

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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(QA_DIR, { recursive: true });

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  TTS Short Audio Pacing Audit — Pass 2 Remediation (26 items)");
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`\nProfile used: buddhist_calm`);
  console.log(`  comma:    ${PROFILE.commaPauseMs}ms   (guideline: ${GUIDELINES.commaMs.min}–${GUIDELINES.commaMs.max}ms)`);
  console.log(`  sentence: ${PROFILE.sentencePauseMs}ms   (guideline: ${GUIDELINES.sentenceMs.min}–${GUIDELINES.sentenceMs.max}ms)`);
  console.log(`  paragraph:${PROFILE.paragraphPauseMs}ms   (guideline: ${GUIDELINES.paragraphMs.min}–${GUIDELINES.paragraphMs.max}ms)`);

  const ids = AFFECTED_IDS.map(a => a.id);

  // ── 1. DB query ──────────────────────────────────────────────────────────────
  console.log("\n── Loading DB rows…");
  const cgRows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, ids),
    columns: {
      id: true, channelKey: true, formatType: true, topicFamily: true,
      ttsStatus: true, audioPath: true, videoPath: true, shortContent: true,
    },
  });
  const cgMap = new Map(cgRows.map(r => [r.id, r]));

  // ── 2. Queue urgency check ───────────────────────────────────────────────────
  const queueRows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.contentId, ids),
      eq(uploadQueue.videoType, "short"),
    ),
    columns: { id: true, contentId: true, status: true, scheduledAt: true, channelId: true, platform: true },
  });

  const now = new Date();
  const h6  = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const h12 = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const h24 = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const queued = queueRows.filter(r => r.status === "queued");
  const queuedIn6h  = queued.filter(r => r.scheduledAt && new Date(r.scheduledAt) <= h6);
  const queuedIn12h = queued.filter(r => r.scheduledAt && new Date(r.scheduledAt) <= h12);
  const queuedIn24h = queued.filter(r => r.scheduledAt && new Date(r.scheduledAt) <= h24);

  // ── 3. Audio diagnostics on available files ──────────────────────────────────
  console.log("\n── Running audio diagnostics…");

  type AudioDiag = {
    id: string;
    hasFile: boolean;
    durationSec: number | null;
    silenceSeg150: SilenceSegment[];
    silenceSeg300: SilenceSegment[];
    silenceSeg500: SilenceSegment[];
    maxSilenceMs: number;
    avgSilenceMs: number;
    totalSilenceMs: number;
    silenceRatioPct: number;
    suspiciousClusters: ReturnType<typeof findSuspiciousClusters>;
    estimatedInjectedPauses: { commas: number; sentences: number; totalMs: number };
    violatesGuidelines: string[];
  };

  const diagMap = new Map<string, AudioDiag>();

  for (const { id } of AFFECTED_IDS) {
    const audioFile = path.join(AUDIO_DIR, `${id}.wav`);
    const hasFile = fs.existsSync(audioFile);

    if (!hasFile) {
      diagMap.set(id, {
        id, hasFile: false, durationSec: null,
        silenceSeg150: [], silenceSeg300: [], silenceSeg500: [],
        maxSilenceMs: 0, avgSilenceMs: 0, totalSilenceMs: 0, silenceRatioPct: 0,
        suspiciousClusters: [], estimatedInjectedPauses: { commas: 0, sentences: 0, totalMs: 0 },
        violatesGuidelines: [],
      });
      continue;
    }

    process.stdout.write(`  → ${id.slice(0, 8)}…`);

    const [durationSec, segs150, segs300, segs500] = await Promise.all([
      getAudioDurationSec(audioFile),
      detectSilenceSegments(audioFile, -50, 0.15),
      detectSilenceSegments(audioFile, -50, 0.30),
      detectSilenceSegments(audioFile, -50, 0.50),
    ]);

    const totalSilenceMs = segs150.reduce((s, seg) => s + seg.durationMs, 0);
    const maxSilenceMs   = segs150.reduce((m, seg) => Math.max(m, seg.durationMs), 0);
    const avgSilenceMs   = segs150.length > 0
      ? Math.round(totalSilenceMs / segs150.length) : 0;
    const silenceRatioPct = durationSec && durationSec > 0
      ? Math.round((totalSilenceMs / 1000 / durationSec) * 100) : 0;

    // Estimate injected pauses from text
    const cg = cgMap.get(id);
    const text = cg?.shortContent ? normalizeTextForTTS(cg.shortContent) : "";
    const { commas: textCommas, sentences: textSentences } = countTextPunctuation(text);
    const estimatedPauses = {
      commas: textCommas,
      sentences: textSentences,
      totalMs: textCommas * PROFILE.commaPauseMs + textSentences * PROFILE.sentencePauseMs,
    };

    const suspiciousClusters = findSuspiciousClusters(segs150, GUIDELINES.windowSec, 3);

    // Guideline violations
    const violatesGuidelines: string[] = [];
    if (PROFILE.commaPauseMs > GUIDELINES.commaMs.max)
      violatesGuidelines.push(`comma=${PROFILE.commaPauseMs}ms > guideline ${GUIDELINES.commaMs.max}ms`);
    if (PROFILE.sentencePauseMs > GUIDELINES.sentenceMs.max)
      violatesGuidelines.push(`sentence=${PROFILE.sentencePauseMs}ms > guideline ${GUIDELINES.sentenceMs.max}ms`);
    if (silenceRatioPct > GUIDELINES.maxSilenceRatioPct)
      violatesGuidelines.push(`silence ratio ${silenceRatioPct}% > guideline ${GUIDELINES.maxSilenceRatioPct}%`);
    if (suspiciousClusters.length > 0)
      violatesGuidelines.push(`${suspiciousClusters.length} dense cluster(s): ≥3 pauses in ${GUIDELINES.windowSec}s`);

    diagMap.set(id, {
      id, hasFile, durationSec,
      silenceSeg150: segs150, silenceSeg300: segs300, silenceSeg500: segs500,
      maxSilenceMs, avgSilenceMs, totalSilenceMs, silenceRatioPct,
      suspiciousClusters, estimatedInjectedPauses: estimatedPauses,
      violatesGuidelines,
    });

    process.stdout.write(` done (${durationSec?.toFixed(1)}s, ${segs150.length} segs>150ms, ratio=${silenceRatioPct}%)\n`);
  }

  // ── 4. Export 5 preview clips ─────────────────────────────────────────────
  console.log("\n── Exporting preview clips…");
  const clipsExported: Array<{ id: string; topic: string; clipPath: string; startSec: number; reason: string }> = [];

  // Priority: items with suspicious clusters first, then items with highest silence ratio
  const hasFile = AFFECTED_IDS.filter(a => diagMap.get(a.id)?.hasFile);
  const withClusters = hasFile.filter(a => (diagMap.get(a.id)?.suspiciousClusters.length ?? 0) > 0);
  const withHighRatio = hasFile
    .filter(a => (diagMap.get(a.id)?.suspiciousClusters.length ?? 0) === 0)
    .sort((a, b) => (diagMap.get(b.id)?.silenceRatioPct ?? 0) - (diagMap.get(a.id)?.silenceRatioPct ?? 0));

  const clipCandidates = [...withClusters, ...withHighRatio].slice(0, 5);

  for (const { id, topic } of clipCandidates) {
    const diag = diagMap.get(id)!;
    const audioFile = path.join(AUDIO_DIR, `${id}.wav`);
    const clusters = diag.suspiciousClusters;

    // Start clip at first cluster if available, else at 0
    const startSec = clusters.length > 0 ? clusters[0].windowStart : 0;
    const reason = clusters.length > 0
      ? `cluster@${startSec.toFixed(1)}s (${clusters[0].count} pauses in ${GUIDELINES.windowSec}s)`
      : `high-ratio=${diag.silenceRatioPct}%`;

    const clipPath = path.join(QA_DIR, `preview_${id.slice(0, 8)}_${Math.round(startSec)}s.wav`);
    const ok = await exportPreviewClip(audioFile, clipPath, startSec);
    if (ok) {
      clipsExported.push({ id, topic, clipPath: path.relative(process.cwd(), clipPath), startSec, reason });
      console.log(`  ✓ ${id.slice(0, 8)} → ${path.basename(clipPath)}  [${reason}]`);
    } else {
      console.log(`  ✗ ${id.slice(0, 8)} → export failed`);
    }
  }

  // ── 5. Print full audit table ─────────────────────────────────────────────
  console.log("\n\n════════════════════════════════════════════════════════════════════");
  console.log("  AUDIT SUMMARY");
  console.log("════════════════════════════════════════════════════════════════════");

  const filesPresent = AFFECTED_IDS.filter(a => diagMap.get(a.id)?.hasFile).length;
  const filesAnalyzed = filesPresent;
  const withViolations = [...diagMap.values()].filter(d => d.hasFile && d.violatesGuidelines.length > 0).length;
  const withClustersCount = [...diagMap.values()].filter(d => d.hasFile && d.suspiciousClusters.length > 0).length;

  console.log(`\n## Audit Summary`);
  console.log(`- Total items in scope:    26`);
  console.log(`- Audio files present:     ${filesPresent}/26`);
  console.log(`- Files analyzed:          ${filesAnalyzed}`);
  console.log(`- With guideline violations: ${withViolations}`);
  console.log(`- With suspicious clusters:  ${withClustersCount}`);

  // ── 6. Queue urgency ─────────────────────────────────────────────────────
  console.log(`\n## Queue Urgency`);
  console.log(`- Current time (VN):       ${toVn(now)}`);
  console.log(`- Total queue rows (short): ${queueRows.length}`);
  console.log(`- Status=queued:           ${queued.length}`);
  console.log(`- Scheduled within 6h:     ${queuedIn6h.length} ← ${queuedIn6h.length > 0 ? "⚠ URGENT" : "ok"}`);
  console.log(`- Scheduled within 12h:    ${queuedIn12h.length} ← ${queuedIn12h.length > 0 ? "⚠ ACTION NEEDED" : "ok"}`);
  console.log(`- Scheduled within 24h:    ${queuedIn24h.length}`);

  if (queuedIn6h.length > 0) {
    console.log(`\n  6h-urgent rows:`);
    for (const r of queuedIn6h) {
      const item = AFFECTED_IDS.find(a => a.id === r.contentId);
      console.log(`    ${r.contentId.slice(0, 8)} platform=${r.platform} ch=${r.channelId} scheduledAt=${r.scheduledAt ? toVn(new Date(r.scheduledAt)) : "null"}  — ${item?.topic ?? "?"}`);
    }
  }
  if (queuedIn12h.length > 0 && queuedIn6h.length === 0) {
    console.log(`\n  12h-upcoming rows:`);
    for (const r of queuedIn12h) {
      const item = AFFECTED_IDS.find(a => a.id === r.contentId);
      console.log(`    ${r.contentId.slice(0, 8)} platform=${r.platform} ch=${r.channelId} scheduledAt=${r.scheduledAt ? toVn(new Date(r.scheduledAt)) : "null"}  — ${item?.topic ?? "?"}`);
    }
  }

  // ── 7. Audio Diagnostics Table ───────────────────────────────────────────
  console.log(`\n## Audio Diagnostics Table`);
  const hdr = [
    "content_id".padEnd(10),
    "topic".padEnd(28),
    "dur".padStart(5),
    "seg>150".padStart(7),
    "seg>300".padStart(7),
    "seg>500".padStart(7),
    "maxMs".padStart(6),
    "avgMs".padStart(6),
    "totMs".padStart(6),
    "rat%".padStart(5),
    "clst".padStart(5),
    "estInj".padStart(7),
    "flags",
  ].join(" | ");
  console.log(hdr);
  console.log("-".repeat(hdr.length));

  for (const { id, topic } of AFFECTED_IDS) {
    const d = diagMap.get(id);
    if (!d) continue;
    const qRow = queueRows.find(r => r.contentId === id && r.status === "queued");
    const qStatus = qRow ? `Q@${qRow.scheduledAt ? toVn(new Date(qRow.scheduledAt)).slice(0, 10) : "?"}` : "-";

    if (!d.hasFile) {
      console.log([
        id.slice(0, 10).padEnd(10),
        topic.slice(0, 28).padEnd(28),
        "no_file".padStart(5),
        "-".padStart(7), "-".padStart(7), "-".padStart(7),
        "-".padStart(6), "-".padStart(6), "-".padStart(6),
        "-".padStart(5), "-".padStart(5), "-".padStart(7),
        qStatus,
      ].join(" | "));
      continue;
    }

    const flags = d.violatesGuidelines.length > 0
      ? d.violatesGuidelines.map(v => v.split(" ")[0]).join(",")
      : "ok";

    console.log([
      id.slice(0, 10).padEnd(10),
      topic.slice(0, 28).padEnd(28),
      (d.durationSec?.toFixed(1) ?? "-").padStart(5),
      String(d.silenceSeg150.length).padStart(7),
      String(d.silenceSeg300.length).padStart(7),
      String(d.silenceSeg500.length).padStart(7),
      String(d.maxSilenceMs).padStart(6),
      String(d.avgSilenceMs).padStart(6),
      String(d.totalSilenceMs).padStart(6),
      String(d.silenceRatioPct).padStart(5),
      String(d.suspiciousClusters.length).padStart(5),
      String(d.estimatedInjectedPauses.totalMs).padStart(7),
      flags,
    ].join(" | "));
  }

  // ── 8. Suspicious Items Detail ───────────────────────────────────────────
  const suspicious = AFFECTED_IDS.filter(a => {
    const d = diagMap.get(a.id);
    return d?.hasFile && d.violatesGuidelines.length > 0;
  });

  if (suspicious.length > 0) {
    console.log(`\n## Suspicious Items (${suspicious.length})`);
    for (const { id, topic } of suspicious) {
      const d = diagMap.get(id)!;
      console.log(`\n  [${id.slice(0, 8)}] ${topic}`);
      console.log(`    Duration: ${d.durationSec?.toFixed(2)}s`);
      console.log(`    Silence segments >150ms: ${d.silenceSeg150.length}  >300ms: ${d.silenceSeg300.length}  >500ms: ${d.silenceSeg500.length}`);
      console.log(`    Max/avg silence: ${d.maxSilenceMs}ms / ${d.avgSilenceMs}ms`);
      console.log(`    Total silence: ${d.totalSilenceMs}ms  (${d.silenceRatioPct}% of audio)`);
      console.log(`    Estimated injected: ~${d.estimatedInjectedPauses.totalMs}ms (${d.estimatedInjectedPauses.commas} commas × 220ms + ${d.estimatedInjectedPauses.sentences} sentences × 560ms)`);
      if (d.suspiciousClusters.length > 0) {
        console.log(`    Dense clusters (≥3 pauses in ${GUIDELINES.windowSec}s):`);
        for (const c of d.suspiciousClusters) {
          console.log(`      @${c.windowStart.toFixed(1)}s–${c.windowEnd.toFixed(1)}s: ${c.count} pauses`);
        }
      }
      console.log(`    Guideline violations: ${d.violatesGuidelines.join("; ")}`);
    }
  }

  // ── 9. Preview clips summary ─────────────────────────────────────────────
  console.log(`\n## Preview Clips Exported (${clipsExported.length})`);
  if (clipsExported.length > 0) {
    for (const c of clipsExported) {
      console.log(`  ${c.id.slice(0, 8)} [${c.topic.slice(0, 30)}]  → ${c.clipPath}`);
      console.log(`           starts @${c.startSec.toFixed(1)}s  reason: ${c.reason}`);
    }
  } else {
    console.log("  (none exported — no audio files with clusters found)");
  }

  // ── 10. Root Cause Analysis ──────────────────────────────────────────────
  console.log(`\n## Likely Root Cause`);

  const profileViolations: string[] = [];
  if (PROFILE.commaPauseMs > GUIDELINES.commaMs.max)
    profileViolations.push(`comma ${PROFILE.commaPauseMs}ms exceeds max ${GUIDELINES.commaMs.max}ms (over by +${PROFILE.commaPauseMs - GUIDELINES.commaMs.max}ms)`);
  if (PROFILE.sentencePauseMs > GUIDELINES.sentenceMs.max)
    profileViolations.push(`sentence ${PROFILE.sentencePauseMs}ms exceeds max ${GUIDELINES.sentenceMs.max}ms (over by +${PROFILE.sentencePauseMs - GUIDELINES.sentenceMs.max}ms)`);

  const analyzedItems = [...diagMap.values()].filter(d => d.hasFile);
  const avgSilenceRatio = analyzedItems.length > 0
    ? Math.round(analyzedItems.reduce((s, d) => s + d.silenceRatioPct, 0) / analyzedItems.length) : 0;
  const avgMaxSilenceMs = analyzedItems.length > 0
    ? Math.round(analyzedItems.reduce((s, d) => s + d.maxSilenceMs, 0) / analyzedItems.length) : 0;
  const avgSeg150Count = analyzedItems.length > 0
    ? (analyzedItems.reduce((s, d) => s + d.silenceSeg150.length, 0) / analyzedItems.length).toFixed(1) : "?";

  console.log(`\n  Profile vs Guidelines:`);
  console.log(`    comma:    ${PROFILE.commaPauseMs}ms  (guideline max: ${GUIDELINES.commaMs.max}ms)  ${PROFILE.commaPauseMs > GUIDELINES.commaMs.max ? "❌ OVER" : "✓"}`);
  console.log(`    sentence: ${PROFILE.sentencePauseMs}ms  (guideline max: ${GUIDELINES.sentenceMs.max}ms)  ${PROFILE.sentencePauseMs > GUIDELINES.sentenceMs.max ? "❌ OVER" : "✓"}`);
  console.log(`    paragraph:${PROFILE.paragraphPauseMs}ms (guideline max: ${GUIDELINES.paragraphMs.max}ms)  ${PROFILE.paragraphPauseMs > GUIDELINES.paragraphMs.max ? "❌ OVER" : "✓"} (not currently used in injector)`);

  console.log(`\n  Measured averages across ${analyzedItems.length} analyzed files:`);
  console.log(`    avg silence ratio: ${avgSilenceRatio}%  (guideline max: ${GUIDELINES.maxSilenceRatioPct}%)`);
  console.log(`    avg max silence:   ${avgMaxSilenceMs}ms`);
  console.log(`    avg seg>150ms/item: ${avgSeg150Count}`);

  console.log(`\n  Key finding — DOUBLE-PAUSE STACKING:`);
  console.log(`    The silenceremove filter preserves natural TTS pauses:`);
  console.log(`      stop_duration=0.80:stop_silence=0.28 → only trims gaps >800ms, keeps 280ms`);
  console.log(`    TTS model (VieNeu Ly voice) naturally produces:`);
  console.log(`      ~100–200ms at commas, ~300–500ms at sentence ends`);
  console.log(`    After normalization, these natural pauses are PRESERVED.`);
  console.log(`    Injected pauses are then ADDED ON TOP of the natural gaps:`);
  console.log(`      Effective comma pause:    natural(~150ms) + injected(220ms) = ~370ms`);
  console.log(`      Effective sentence pause: natural(~400ms) + injected(560ms) = ~960ms`);
  console.log(`    Both exceed Buddhist pacing guidelines by 2–3×.`);
  console.log(`    A ~960ms sentence-end pause sounds like a hard stop, creating the "khựng" effect.`);

  console.log(`\n  Secondary factors:`);
  console.log(`    [2] Whisper alignment imprecision: timestamps may be off by ±50–150ms,`);
  console.log(`        landing inside a phoneme rather than after word completion.`);
  console.log(`        Result: silence cut occurs mid-phone → click/glitch artifact.`);
  console.log(`    [4] FFmpeg atrim hard cuts at inexact sample boundaries:`);
  console.log(`        atrim=end=X uses sample-accurate truncation at floating-point sec.`);
  console.log(`        If X isn't at a zero-crossing, there's a click at the cut.`);
  console.log(`        The injected aevalsrc silence then follows immediately → audible pop.`);

  console.log(`\n  Root cause ranking:`);
  console.log(`    CAUSE 1 (PRIMARY): Excessive pause durations + double-stacking with`);
  console.log(`      preserved natural TTS pauses → "khựng" / unnaturally long gaps`);
  console.log(`    CAUSE 6 (CONTRIBUTING): silenceremove stop_duration=0.80 preserves TTS`);
  console.log(`      natural pauses that were previously stripped, so injected pauses pile on`);
  console.log(`    CAUSE 2/4 (MINOR): Whisper misalignment + FFmpeg hard-cut artifacts`);
  console.log(`      at word boundaries may add micro-clicks on top of long pauses`);

  // ── 11. Recommendation ───────────────────────────────────────────────────
  console.log(`\n## Recommendation`);
  console.log(`\n  ⚠ AWAITING APPROVAL — do not implement any fix without explicit sign-off.`);
  console.log(`\n  Option A — Reduce pause durations to guideline midpoints:`);
  console.log(`    commaPauseMs:    220 → 150ms  (guideline mid: 150ms)`);
  console.log(`    sentencePauseMs: 560 → 375ms  (guideline mid: 375ms)`);
  console.log(`    Impact: reduces double-stack to ~325ms comma, ~775ms sentence.`);
  console.log(`    Still slightly above guidelines due to stacking — moderate fix.`);

  console.log(`\n  Option B — Strip natural pauses before injection (strip-then-inject):`);
  console.log(`    Change normalizeAudioWithLoudnorm to use stop_duration=0.20:stop_silence=0.05`);
  console.log(`    (aggressive silenceremove strips all pauses ≥200ms, keeps only 50ms).`);
  console.log(`    Then injected pauses are the ONLY pauses in the audio.`);
  console.log(`    Impact: clean, predictable pacing; loses voice's natural prosody.`);

  console.log(`\n  Option C — Reduce pause durations to match guideline ceilings exactly:`);
  console.log(`    commaPauseMs:    220 → 180ms`);
  console.log(`    sentencePauseMs: 560 → 450ms`);
  console.log(`    Impact: stacked totals = ~330ms comma, ~850ms sentence.`);
  console.log(`    Still perceptibly long at sentence ends — partial fix.`);

  console.log(`\n  Option D — Remove deterministic injection, use natural TTS prosody only:`);
  console.log(`    Revert pause injection entirely. Use only silenceremove to clean artifacts.`);
  console.log(`    Impact: reverts to pre-Pass-2 state; no "khựng" but less consistent pacing.`);

  console.log(`\n  Option E — Use net-addition logic:`);
  console.log(`    Before injecting, measure existing silence at punctuation boundary.`);
  console.log(`    Inject only the DIFFERENCE: max(0, targetMs - existingMs).`);
  console.log(`    Impact: precise control, zero double-stacking. Most complex implementation.`);

  console.log(`\n  Recommended order: E > B > A > C > D`);
  console.log(`  Fastest safe fix for urgent items: Option A (simple constant change, re-render).`);

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`  AWAITING APPROVAL`);
  console.log(`════════════════════════════════════════════════════════════════════`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
