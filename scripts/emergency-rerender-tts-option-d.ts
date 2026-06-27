/**
 * Emergency Re-render — TTS Option D (Disable Pause Injection)
 *
 * Re-renders queued/unpublished phat_phap tts_short items using:
 *  - Fresh TTS synthesis (skipCache=true)
 *  - silenceremove preservation fix only (no deterministic pause injection)
 *  - Subtitle QA must PASS
 *
 * Priority: urgent items first (by scheduledAt), then remaining in order.
 * Safety: pre-flight check per item, no queue row mutations, tang_sau untouched.
 *
 * Env: TTS_ENABLE_PUNCTUATION_PAUSES must be unset or "false" (default).
 */

// Force injection off before anything else loads
process.env.TTS_ENABLE_PUNCTUATION_PAUSES = "false";

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";
import { eq, inArray, and, count } from "drizzle-orm";
import { runTTS } from "@/lib/pipeline/tts";
import { runShortVideo } from "@/lib/pipeline/short-video";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;

const QA_DIR = path.join(process.cwd(), "media", "qa", "tts-pacing-audit");
const VN_TZ     = "Asia/Ho_Chi_Minh";

// ── Priority order: urgent items first, then remaining 26 ─────────────────────
// Urgent (sorted by scheduledAt asc): b9977f99 @13:00, 2f18fadb @15:00, 8d12d8ba @17:00
// Note: b9977f99 may already be uploading/done — pre-flight will catch it.
const URGENT_IDS = [
  { id: "b9977f99-0a2c-482a-bd5a-37cafec4a5ba", topic: "Tìm kiếm sự chấp nhận",        urgent: true },
  { id: "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd", topic: "Trả giá vì tham lam",           urgent: true },
  { id: "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621", topic: "Ghen tị",                        urgent: true },
];

const REMAINING_IDS = [
  { id: "d3cd102a-1ac8-4cfb-8772-7de68401f23d", topic: "Xót xa mất mát",                urgent: false },
  { id: "46de084b-9e2f-4230-89f5-b84f7cf29528", topic: "Tìm kiếm công bằng",             urgent: false },
  { id: "aff684e0-721e-47cc-9b5a-836b468b4ca4", topic: "Sự cô đơn trong lòng",           urgent: false },
  { id: "1fcd2512-83e1-480c-8b6b-eb282c7e76de", topic: "Kẻ phản bội sống ác",            urgent: false },
  { id: "f48a5849-1b47-490d-a7cd-598510ca03f5", topic: "Mất lòng tự trọng",              urgent: false },
  { id: "fb263643-35c9-497c-abea-96e9ac0fb210", topic: "Nhân quả khổ đau",               urgent: false },
  { id: "fe2b62e4-9871-40c4-a7f2-9aa411530dd9", topic: "Tiểu nhân đắc chí",              urgent: false },
  { id: "5d02ce90-4cea-4ba5-9c5a-09704186a98e", topic: "Nỗi nhớ chưa nguôi",             urgent: false },
  { id: "b9757a63-ebbf-4ecc-a4e6-6ad516b80df2", topic: "Im lặng trước người xấu",        urgent: false },
  { id: "8d9eb929-4730-487a-bbd0-1c0f1d9ac744", topic: "Buông bỏ người không còn yêu",  urgent: false },
  { id: "957b26f5-990e-489d-adff-fd7964fae7be", topic: "Nhẫn nhịn là trí tuệ",           urgent: false },
  { id: "40bd7814-6f8f-4737-9720-58c25dfebc92", topic: "Nỗi đau mất mát",               urgent: false },
  { id: "d771fe18-e6ed-4f01-856d-aae7abd3afb6", topic: "Nỗi buồn phản bội",             urgent: false },
  { id: "17daebc8-e073-46bf-b293-a00ecc6f3b1e", topic: "Tìm kiếm bình an",              urgent: false },
  { id: "2c0aabf2-29be-4e22-bdbd-fb37656ed6f4", topic: "Mất lòng tin",                  urgent: false },
  { id: "8d326891-78c0-4ad1-a50e-92849d05a2ca", topic: "Nỗi đau lừa dối",              urgent: false },
  { id: "e93d6d17-6447-4a58-8dfc-78dabe75a20b", topic: "Mất mát tình yêu",              urgent: false },
  { id: "b86163cd-4ada-49e5-a72c-dc506de6c929", topic: "Tìm kiếm sự bình yên",          urgent: false },
  { id: "cbf59089-fc7e-4ab2-82aa-f62e06990dcb", topic: "Chờ đợi sự trở về",             urgent: false },
  { id: "45bc05a4-167f-4623-80cb-4aa334c1348c", topic: "Chấp nhận sự im lặng",          urgent: false },
  { id: "122386da-cf49-4164-b7b5-ff1feefd7e5a", topic: "Nỗi đau trả giá",              urgent: false },
  { id: "ea1c1edf-7e98-4b78-a8c8-06d6e8e865c5", topic: "Nỗi đau bị phản bội",          urgent: false },
  { id: "8285d11f-60ed-40dd-bf86-30ba563c87a7", topic: "Lòng tự trọng",                 urgent: false },
];

const ALL_IDS = [...URGENT_IDS, ...REMAINING_IDS];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toVn(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TZ, dateStyle: "short", timeStyle: "medium",
  }).format(d);
}

function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }
function elapsed(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${pad(s % 60)}s`;
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
    ], { timeout: 30_000 }).catch(e => e as { stderr?: string });
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

function maxSilenceCluster(segs: SilenceSegment[], windowSec = 3): number {
  let max = 0;
  for (let i = 0; i < segs.length; i++) {
    const wEnd = segs[i].start + windowSec;
    let count = 0;
    for (let j = i; j < segs.length && segs[j].start <= wEnd; j++) count++;
    if (count > max) max = count;
  }
  return max;
}

async function exportPreviewClip(
  inputPath: string,
  outputPath: string,
  startSec = 0,
  durationSec = 20,
): Promise<boolean> {
  try {
    await execFileAsync(FFMPEG_PATH, [
      "-y", "-i", inputPath,
      "-ss", startSec.toFixed(3),
      "-t", durationSec.toFixed(3),
      "-c:a", "copy",
      outputPath,
    ], { timeout: 30_000 });
    return true;
  } catch { return false; }
}

async function countQueueRows(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(uploadQueue);
  return row?.n ?? 0;
}

// ── Per-item result ───────────────────────────────────────────────────────────

type ItemResult = {
  id: string;
  topic: string;
  urgent: boolean;
  outcome: "processed" | "skipped" | "failed";
  skipReason?: string;
  errorMsg?: string;
  scheduledAt: string | null;
  injectionDisabled: boolean;
  audioDurationBefore: number | null;
  audioDurationAfter: number | null;
  silenceClusters: number;
  silenceRatioPct: number;
  silenceSeg150: number;
  subtitleStatus: string | null;
  subtitleScore: number | null;
  previewClipPath: string | null;
  topicFamily: string | null;
  topicFamilyAfter: string | null;
  totalElapsedMs: number;
};

// ── Per-item processor ────────────────────────────────────────────────────────

async function processItem(
  entry: { id: string; topic: string; urgent: boolean },
  exportPreview: boolean,
): Promise<ItemResult> {
  const { id, topic, urgent } = entry;
  const t0 = Date.now();

  const base: Omit<ItemResult, "outcome" | "totalElapsedMs"> = {
    id, topic, urgent,
    scheduledAt: null,
    injectionDisabled: true,
    audioDurationBefore: null, audioDurationAfter: null,
    silenceClusters: 0, silenceRatioPct: 0, silenceSeg150: 0,
    subtitleStatus: null, subtitleScore: null,
    previewClipPath: null,
    topicFamily: null, topicFamilyAfter: null,
  };

  const skip = (reason: string): ItemResult => ({
    ...base, outcome: "skipped", skipReason: reason, totalElapsedMs: Date.now() - t0,
  });
  const fail = (reason: string): ItemResult => ({
    ...base, outcome: "failed", errorMsg: reason, totalElapsedMs: Date.now() - t0,
  });

  // 1. Load content row
  const cg = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, id),
    columns: {
      id: true, channelKey: true, formatType: true, topicFamily: true,
      ttsStatus: true, audioPath: true, videoPath: true,
    },
  });
  if (!cg) return skip("not found in DB");
  if (cg.channelKey !== "phat_phap") return skip(`non-phat_phap channelKey=${cg.channelKey}`);
  if (cg.formatType !== "tts_short")  return skip(`non-tts_short formatType=${cg.formatType}`);

  base.topicFamily = cg.topicFamily;

  // 2. Queue safety pre-flight
  const shortEntries = await db.query.uploadQueue.findMany({
    where: and(eq(uploadQueue.contentId, id), eq(uploadQueue.videoType, "short")),
    columns: { id: true, status: true, scheduledAt: true },
  });

  const queued     = shortEntries.filter(r => r.status === "queued");
  const uploading  = shortEntries.filter(r => ["uploading", "processing"].includes(r.status));
  const published  = shortEntries.filter(r => r.status === "published");

  if (published.length > 0) return skip(`already published (${published.length} rows)`);
  if (uploading.length > 0) return skip(`currently uploading/processing (${uploading.length} rows)`);
  if (queued.length === 0)  return skip("no queued short entries");

  // Earliest scheduled time
  const earliestScheduled = queued
    .filter(r => r.scheduledAt)
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())[0];
  base.scheduledAt = earliestScheduled?.scheduledAt
    ? toVn(new Date(earliestScheduled.scheduledAt))
    : null;

  // 3. Pre-render duration
  const absAudio = cg.audioPath ? path.join(process.cwd(), cg.audioPath) : null;
  base.audioDurationBefore = absAudio && fs.existsSync(absAudio)
    ? await getAudioDurationSec(absAudio) : null;

  const videoPathBefore = cg.videoPath;

  console.log(`    → runTTS (injection=off, skipCache=true)…`);
  const ttsT0 = Date.now();

  try {
    const ttsResult = await runTTS(id, "short", null, { skipCache: true });
    const ttsElapsed = Date.now() - ttsT0;

    if (!ttsResult.success) return fail(`runTTS failed: ${ttsResult.error}`);
    console.log(`    → TTS done (${elapsed(ttsElapsed)}) injection=off`);

    const absAudioAfter = path.join(process.cwd(), ttsResult.audioPath);
    base.audioDurationAfter = fs.existsSync(absAudioAfter)
      ? await getAudioDurationSec(absAudioAfter) : null;

    // 4. Re-render video
    console.log(`    → runShortVideo…`);
    const renderT0 = Date.now();
    const renderResult = await runShortVideo(id);

    if (!renderResult.success) return fail(`runShortVideo failed: ${renderResult.error}`);

    base.subtitleStatus = renderResult.subtitleStatus;
    base.subtitleScore  = renderResult.subtitleHealthScore ?? null;
    console.log(`    → Render done (${elapsed(Date.now() - renderT0)}) subtitle=${renderResult.subtitleStatus} score=${renderResult.subtitleHealthScore ?? "-"}`);

    // 5. Audio diagnostics on new audio
    if (fs.existsSync(absAudioAfter)) {
      const segs = await detectSilenceSegments(absAudioAfter, -50, 0.15);
      const totalSilMs = segs.reduce((s, seg) => s + seg.durationMs, 0);
      base.silenceSeg150 = segs.length;
      base.silenceRatioPct = base.audioDurationAfter
        ? Math.round((totalSilMs / 1000 / base.audioDurationAfter) * 100) : 0;
      base.silenceClusters = maxSilenceCluster(segs, 3);
    }

    // 6. Export preview clip for urgent items or first 3 processed
    if (exportPreview) {
      fs.mkdirSync(QA_DIR, { recursive: true });
      const clipPath = path.join(QA_DIR, `option_d_${id.slice(0, 8)}.wav`);
      const absAudioForClip = path.join(process.cwd(), ttsResult.audioPath);
      const ok = await exportPreviewClip(absAudioForClip, clipPath);
      if (ok) base.previewClipPath = path.relative(process.cwd(), clipPath);
    }

    // 7. Post-render validation
    const cgAfter = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, id),
      columns: { topicFamily: true, videoPath: true },
    });
    base.topicFamilyAfter = cgAfter?.topicFamily ?? null;

    const validationErrors: string[] = [];
    if (base.subtitleStatus === "invalid")
      validationErrors.push(`subtitle FAIL score=${base.subtitleScore}`);
    if (base.topicFamilyAfter !== base.topicFamily)
      validationErrors.push(`topic_family changed: ${base.topicFamily} → ${base.topicFamilyAfter}`);
    if (videoPathBefore && cgAfter?.videoPath !== videoPathBefore)
      validationErrors.push(`video_path changed: ${videoPathBefore} → ${cgAfter?.videoPath}`);
    if (base.silenceClusters >= 3)
      validationErrors.push(`still has ${base.silenceClusters} dense clusters`);

    if (validationErrors.length > 0) {
      return { ...base, outcome: "failed", errorMsg: validationErrors.join("; "), totalElapsedMs: Date.now() - t0 };
    }

    return { ...base, outcome: "processed", totalElapsedMs: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, outcome: "failed", errorMsg: msg, totalElapsedMs: Date.now() - t0 };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Belt-and-suspenders: verify injection is actually off
  if (process.env.TTS_ENABLE_PUNCTUATION_PAUSES === "true") {
    console.error("ABORT: TTS_ENABLE_PUNCTUATION_PAUSES=true — this script requires injection to be disabled.");
    process.exit(1);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Emergency Re-render — Option D (No Pause Injection)");
  console.log(`  Date: ${new Date().toISOString()}  (VN: ${toVn(new Date())})`);
  console.log(`  TTS_ENABLE_PUNCTUATION_PAUSES=${process.env.TTS_ENABLE_PUNCTUATION_PAUSES ?? "unset (=false)"}`);
  console.log("════════════════════════════════════════════════════════════════════");

  // Sanity: confirm all IDs are phat_phap tts_short
  const ids = ALL_IDS.map(a => a.id);
  const cgCheck = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, ids),
    columns: { id: true, channelKey: true, formatType: true },
  });
  const badRows = cgCheck.filter(r => r.channelKey !== "phat_phap" || r.formatType !== "tts_short");
  if (badRows.length > 0) {
    console.error("ABORT: non-phat_phap or non-tts_short rows:", badRows);
    process.exit(1);
  }
  console.log(`  Sanity check PASS: all ${cgCheck.length} found rows are phat_phap tts_short`);
  console.log(`  Items in scope: ${ALL_IDS.length} (${URGENT_IDS.length} urgent + ${REMAINING_IDS.length} remaining)\n`);

  // Baseline queue count
  const queueCountBefore = await countQueueRows();
  console.log(`  Queue rows at start: ${queueCountBefore}\n`);

  // Load all queue rows for the IDs upfront (for scheduledAt sort reference)
  const allQueueRowsForSort = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.contentId, ids),
      eq(uploadQueue.videoType, "short"),
    ),
    columns: { id: true, contentId: true, status: true, scheduledAt: true },
  });

  // Sort remaining IDs by earliest scheduledAt
  const scheduledMap = new Map<string, Date>();
  for (const r of allQueueRowsForSort) {
    if (r.status === "queued" && r.scheduledAt) {
      const existing = scheduledMap.get(r.contentId);
      const d = new Date(r.scheduledAt);
      if (!existing || d < existing) scheduledMap.set(r.contentId, d);
    }
  }

  const sortedRemaining = [...REMAINING_IDS].sort((a, b) => {
    const da = scheduledMap.get(a.id)?.getTime() ?? Infinity;
    const db_ = scheduledMap.get(b.id)?.getTime() ?? Infinity;
    return da - db_;
  });

  const processingOrder = [...URGENT_IDS, ...sortedRemaining];

  // Process sequentially
  const results: ItemResult[] = [];
  let previewCount = 0;

  for (const entry of processingOrder) {
    const label = entry.urgent ? "🔴 URGENT" : "   ";
    console.log(`\n[${results.length + 1}/${processingOrder.length}] ${label} ${entry.id.slice(0, 8)} — ${entry.topic}`);

    // Export previews for urgent items and first 3 total processed
    const exportPreview = entry.urgent || previewCount < 3;
    const result = await processItem(entry, exportPreview);
    results.push(result);

    if (result.outcome === "processed") {
      previewCount++;
      console.log(`  ✓  PASS  dur=${result.audioDurationAfter?.toFixed(1)}s  seg>150ms=${result.silenceSeg150}  clusters=${result.silenceClusters}  ratio=${result.silenceRatioPct}%  sub=${result.subtitleStatus}(${result.subtitleScore ?? "-"})  ${elapsed(result.totalElapsedMs)}`);
    } else if (result.outcome === "skipped") {
      console.log(`  ⏭  SKIPPED: ${result.skipReason}`);
    } else {
      console.log(`  ✗  FAILED: ${result.errorMsg}`);
    }
  }

  // ── Queue safety check ────────────────────────────────────────────────────
  const queueCountAfter = await countQueueRows();
  const queueDelta = queueCountAfter - queueCountBefore;

  // ── Final report ──────────────────────────────────────────────────────────
  console.log("\n\n════════════════════════════════════════════════════════════════════");
  console.log("  EMERGENCY ROLLBACK SUMMARY — Option D");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const processed = results.filter(r => r.outcome === "processed");
  const skipped   = results.filter(r => r.outcome === "skipped");
  const failed    = results.filter(r => r.outcome === "failed");
  const urgentResults = results.filter(r => r.urgent);

  console.log(`## Emergency Rollback Summary`);
  console.log(`- injection_disabled:     ${process.env.TTS_ENABLE_PUNCTUATION_PAUSES !== "true" ? "YES ✓" : "NO ✗"}`);
  console.log(`- tts.ts code change:     TTS_ENABLE_PUNCTUATION_PAUSES gate added`);
  console.log(`- silenceremove preserve: KEPT (stop_duration=0.80:stop_silence=0.28)`);
  console.log(`- Whisper code:           KEPT (disabled by env flag, not removed)`);
  console.log(`- total candidates:       ${ALL_IDS.length}`);
  console.log(`- processed:              ${processed.length}`);
  console.log(`- skipped:                ${skipped.length}`);
  console.log(`- failed:                 ${failed.length}`);
  console.log(`- urgent processed:       ${urgentResults.filter(r => r.outcome === "processed").length}/${URGENT_IDS.length}`);

  console.log(`\n## Items Processed`);
  console.log([
    "content_id".padEnd(10),
    "topic".padEnd(30),
    "scheduled_at".padEnd(20),
    "inj_off".padStart(7),
    "aud_dur".padStart(7),
    "clust".padStart(5),
    "ratio%".padStart(6),
    "sub_qa".padStart(6),
    "action",
  ].join(" | "));
  console.log("-".repeat(130));

  for (const r of results) {
    const action =
      r.outcome === "skipped" ? `SKIP: ${r.skipReason?.slice(0, 30) ?? ""}` :
      r.outcome === "failed"  ? `FAIL: ${r.errorMsg?.slice(0, 30) ?? ""}` :
      `PASS${r.urgent ? " [URGENT]" : ""}`;
    const subQa = r.subtitleStatus === "valid"   ? `✓${r.subtitleScore ?? "-"}` :
                  r.subtitleStatus === "invalid" ? `✗${r.subtitleScore ?? "-"}` :
                  r.subtitleStatus ?? "-";
    console.log([
      r.id.slice(0, 10).padEnd(10),
      r.topic.slice(0, 30).padEnd(30),
      (r.scheduledAt ?? "-").slice(0, 20).padEnd(20),
      (r.injectionDisabled ? "off ✓" : "on ✗").padStart(7),
      (r.audioDurationAfter?.toFixed(1) ?? "-").padStart(7),
      String(r.silenceClusters).padStart(5),
      String(r.silenceRatioPct).padStart(6),
      subQa.padStart(6),
      action,
    ].join(" | "));
  }

  console.log(`\n## Queue Safety`);
  console.log(`- upload_queue rows before: ${queueCountBefore}`);
  console.log(`- upload_queue rows after:  ${queueCountAfter}`);
  console.log(`- delta:                    ${queueDelta} ${queueDelta === 0 ? "✓ PASS" : "✗ FAIL — unexpected change!"}`);
  console.log(`- published rows touched:   0`);
  console.log(`- tang_sau:                 untouched (phat_phap filter enforced)`);
  const topicChanged = processed.filter(r => r.topicFamily !== r.topicFamilyAfter && r.topicFamilyAfter !== null);
  console.log(`- topic_family changes:     ${topicChanged.length} ${topicChanged.length === 0 ? "✓" : "✗"}`);
  for (const r of topicChanged) console.log(`    ⚠ ${r.id}: ${r.topicFamily} → ${r.topicFamilyAfter}`);

  const skippedItems = skipped.map(r => `${r.id.slice(0, 8)} (${r.skipReason?.slice(0, 40) ?? ""})`);
  if (skipped.length > 0) {
    console.log(`\n- skipped items (${skipped.length}):`);
    for (const s of skippedItems) console.log(`    ${s}`);
  }
  if (failed.length > 0) {
    console.log(`\n- failed items (${failed.length}):`);
    for (const r of failed) console.log(`    ${r.id.slice(0, 8)}: ${r.errorMsg?.slice(0, 60) ?? ""}`);
  }

  console.log(`\n## Preview Clips`);
  const clips = results.filter(r => r.previewClipPath);
  if (clips.length > 0) {
    for (const r of clips) {
      console.log(`  [${r.urgent ? "URGENT" : "      "}] ${r.id.slice(0, 8)} ${r.topic.slice(0, 30).padEnd(30)} → ${r.previewClipPath}`);
    }
  } else {
    console.log("  (none — no items processed)");
  }

  console.log(`\n## Recommendation for Proper Fix`);
  console.log(`- Option E (net-addition logic) should be implemented next.`);
  console.log(`  Approach: before injection, run Whisper to get timestamps, then for each`);
  console.log(`  punctuation boundary measure the existing silence already in the normalized audio.`);
  console.log(`  Inject only max(0, targetPauseMs - existingNaturalPauseMs).`);
  console.log(`  This eliminates double-stacking while still bringing pacing up to guideline.`);
  console.log(`  Key change in injectPunctuationPauses(): run ffmpeg silencedetect in a`);
  console.log(`  window around each insertion point, subtract existing silence before injecting.`);
  console.log(`  Estimated effort: 1–2 days. Zero risk of "khựng" artifacts.`);
  console.log(`\n  Current state: TTS_ENABLE_PUNCTUATION_PAUSES=false (default).`);
  console.log(`  To re-enable after Option E: set TTS_ENABLE_PUNCTUATION_PAUSES=true in .env.local`);
  console.log(`  or the production env. Production default remains false until explicitly changed.`);

  if (queueDelta !== 0) {
    console.error(`\nFATAL: queue delta=${queueDelta}!`);
    process.exit(1);
  }

  console.log("\n════════════════════════════════════════════════════════════════════");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
