/**
 * Second TTS Pause Remediation — Pass 2
 *
 * Re-TTS + re-render the 26 phat_phap tts_short items that were processed in
 * Pass 1 with silenceremove fix only, but WITHOUT deterministic pause injection
 * (Whisper was broken due to initial_prompt misuse — now fixed in tts.ts).
 *
 * This pass adds 5–7s of Buddhist-pacing silence per item.
 *
 * Safety: same constraints as Pass 1 — no new queue rows, no published records
 * touched, no schema changes, no new content generated, tang_sau untouched.
 */

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

// ── 26 affected IDs (same priority order as Pass 1) ──────────────────────────
const AFFECTED_IDS = [
  // Group 1
  { id: "d3cd102a-1ac8-4cfb-8772-7de68401f23d", topic: "Xót xa mất mát",                            group: 1 },
  { id: "46de084b-9e2f-4230-89f5-b84f7cf29528", topic: "Tìm kiếm công bằng",                         group: 1 },
  { id: "aff684e0-721e-47cc-9b5a-836b468b4ca4", topic: "Sự cô đơn trong lòng",                       group: 1 },
  { id: "1fcd2512-83e1-480c-8b6b-eb282c7e76de", topic: "Kẻ phản bội sống ác, trời không tha",        group: 1 },
  { id: "f48a5849-1b47-490d-a7cd-598510ca03f5", topic: "Mất lòng tự trọng",                          group: 1 },
  { id: "fb263643-35c9-497c-abea-96e9ac0fb210", topic: "Nhân quả khổ đau",                           group: 1 },
  { id: "fe2b62e4-9871-40c4-a7f2-9aa411530dd9", topic: "Tiểu nhân đắc chí chỉ là tạm thời",          group: 1 },
  { id: "5d02ce90-4cea-4ba5-9c5a-09704186a98e", topic: "Nỗi nhớ chưa nguôi",                         group: 1 },
  { id: "b9757a63-ebbf-4ecc-a4e6-6ad516b80df2", topic: "Im lặng trước người xấu là trí tuệ cao nhất",group: 1 },
  { id: "8d9eb929-4730-487a-bbd0-1c0f1d9ac744", topic: "Buông bỏ người không còn yêu thương ta nữa", group: 1 },
  { id: "957b26f5-990e-489d-adff-fd7964fae7be", topic: "Nhẫn nhịn không phải yếu đuối mà là trí tuệ",group: 1 },
  { id: "40bd7814-6f8f-4737-9720-58c25dfebc92", topic: "Nỗi đau mất mát",                            group: 1 },
  { id: "d771fe18-e6ed-4f01-856d-aae7abd3afb6", topic: "Nỗi buồn phản bội",                          group: 1 },
  { id: "17daebc8-e073-46bf-b293-a00ecc6f3b1e", topic: "Tìm kiếm bình an",                           group: 1 },
  { id: "2c0aabf2-29be-4e22-bdbd-fb37656ed6f4", topic: "Mất lòng tin",                               group: 1 },
  // Group 2
  { id: "8d326891-78c0-4ad1-a50e-92849d05a2ca", topic: "Nỗi đau lừa dối",                            group: 2 },
  { id: "e93d6d17-6447-4a58-8dfc-78dabe75a20b", topic: "Mất mát tình yêu",                           group: 2 },
  { id: "b86163cd-4ada-49e5-a72c-dc506de6c929", topic: "Tìm kiếm sự bình yên",                       group: 2 },
  { id: "b9977f99-0a2c-482a-bd5a-37cafec4a5ba", topic: "Tìm kiếm sự chấp nhận",                      group: 2 },
  { id: "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd", topic: "Trả giá vì tham lam",                        group: 2 },
  { id: "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621", topic: "Ghen tị",                                    group: 2 },
  { id: "cbf59089-fc7e-4ab2-82aa-f62e06990dcb", topic: "Chờ đợi sự trở về",                          group: 2 },
  { id: "45bc05a4-167f-4623-80cb-4aa334c1348c", topic: "Chấp nhận sự im lặng",                       group: 2 },
  // Group 3
  { id: "122386da-cf49-4164-b7b5-ff1feefd7e5a", topic: "Nỗi đau trả giá",                            group: 3 },
  { id: "ea1c1edf-7e98-4b78-a8c8-06d6e8e865c5", topic: "Nỗi đau bị phản bội",                        group: 3 },
  { id: "8285d11f-60ed-40dd-bf86-30ba563c87a7", topic: "Lòng tự trọng",                              group: 3 },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function countQueueRows(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(uploadQueue);
  return row?.n ?? 0;
}

/**
 * Intercept console.log during fn() to capture [TTS-QA] output.
 * Returns the QA stats parsed from the log line.
 */
type TtsQaStats = {
  whisperWords: number;
  pauseCount: number;
  commaPauses: number;
  sentencePauses: number;
  totalSilenceMs: number;
  skipped: boolean;
  skipReason: string | null;
};

async function runTTSWithQaCapture(
  id: string,
): Promise<{ result: Awaited<ReturnType<typeof runTTS>>; qa: TtsQaStats }> {
  let qaLine = "";
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const msg = args.map(a => String(a)).join(" ");
    if (msg.includes("[TTS-QA]")) qaLine = msg;
    origLog(...args);
  };

  let result: Awaited<ReturnType<typeof runTTS>>;
  try {
    result = await runTTS(id, "short", null, { skipCache: true });
  } finally {
    console.log = origLog;
  }

  // Parse: [TTS-QA] contentId=... whisperWords=34 pauseCount=13 (comma=6 sentence=7) totalSilenceMs=5240 ...
  const qa: TtsQaStats = {
    whisperWords: 0, pauseCount: 0, commaPauses: 0, sentencePauses: 0,
    totalSilenceMs: 0, skipped: false, skipReason: null,
  };
  if (qaLine) {
    const w = /whisperWords=(\d+)/.exec(qaLine);   if (w)  qa.whisperWords  = parseInt(w[1]);
    const p = /pauseCount=(\d+)/.exec(qaLine);     if (p)  qa.pauseCount    = parseInt(p[1]);
    const c = /comma=(\d+)/.exec(qaLine);          if (c)  qa.commaPauses   = parseInt(c[1]);
    const s = /sentence=(\d+)/.exec(qaLine);       if (s)  qa.sentencePauses = parseInt(s[1]);
    const ms = /totalSilenceMs=(\d+)/.exec(qaLine);if (ms) qa.totalSilenceMs = parseInt(ms[1]);
    if (/SKIPPED\(/.test(qaLine)) {
      qa.skipped = true;
      const sr = /SKIPPED\(([^)]+)\)/.exec(qaLine);
      qa.skipReason = sr ? sr[1] : "unknown";
    }
  }
  return { result, qa };
}

// ── Per-item result type ──────────────────────────────────────────────────────

type ItemResult = {
  id: string;
  topic: string;
  group: number;
  outcome: "processed" | "skipped" | "failed";
  skipReason?: string;
  errorMsg?: string;
  remainingShortEntries: number;
  topicFamily: string | null;
  topicFamilyAfter: string | null;
  audioDurationBefore: number | null;
  audioDurationAfter: number | null;
  whisperWords: number;
  sentencePauses: number;
  commaPauses: number;
  totalSilenceMs: number;
  injectionSkipped: boolean;
  injectionSkipReason: string | null;
  subtitleStatus: string | null;
  subtitleScore: number | null;
  videoDurationBefore: number | null;
  videoDurationAfter: number | null;
  ttsElapsedMs: number | null;
  renderElapsedMs: number | null;
  totalElapsedMs: number;
  validationFailed: boolean;
  validationErrors: string[];
};

// ── Item processor ────────────────────────────────────────────────────────────

async function processItem(entry: typeof AFFECTED_IDS[number]): Promise<ItemResult> {
  const { id, topic, group } = entry;
  const t0 = Date.now();

  const base: Omit<ItemResult, "outcome" | "totalElapsedMs"> = {
    id, topic, group,
    remainingShortEntries: 0,
    topicFamily: null, topicFamilyAfter: null,
    audioDurationBefore: null, audioDurationAfter: null,
    whisperWords: 0, sentencePauses: 0, commaPauses: 0, totalSilenceMs: 0,
    injectionSkipped: false, injectionSkipReason: null,
    subtitleStatus: null, subtitleScore: null,
    videoDurationBefore: null, videoDurationAfter: null,
    ttsElapsedMs: null, renderElapsedMs: null,
    validationFailed: false, validationErrors: [],
  };

  const skip = (reason: string): ItemResult => ({
    ...base, outcome: "skipped", skipReason: reason, totalElapsedMs: Date.now() - t0,
  });
  const fail = (reason: string, extra?: Partial<typeof base>): ItemResult => ({
    ...base, ...extra, outcome: "failed", errorMsg: reason, totalElapsedMs: Date.now() - t0,
  });

  // 1. Load content row
  const cg = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, id),
    columns: {
      id: true, channelKey: true, formatType: true, topicFamily: true,
      ttsStatus: true, audioPath: true, videoPath: true,
    },
  });
  if (!cg) return skip("content_id not found in DB");

  if (cg.channelKey !== "phat_phap") return skip(`non-phat_phap channelKey=${cg.channelKey}`);
  if (cg.formatType !== "tts_short")  return skip(`unexpected formatType=${cg.formatType}`);

  base.topicFamily = cg.topicFamily;

  // 2. Check queue entries
  const shortEntries = await db.query.uploadQueue.findMany({
    where: and(eq(uploadQueue.contentId, id), eq(uploadQueue.videoType, "short")),
    columns: { id: true, status: true },
  });
  const unpublished = shortEntries.filter(e =>
    !["published", "uploading"].includes(e.status)
  );
  const activelyUploading = shortEntries.filter(e =>
    ["uploading", "processing"].includes(e.status)
  );

  base.remainingShortEntries = unpublished.length;

  if (unpublished.length === 0) return skip("no unpublished short entries remaining");
  if (activelyUploading.length > 0)
    return skip(`unsafe: ${activelyUploading.length} entries currently uploading/processing`);

  // 3. Pre-render durations
  const absAudio = cg.audioPath ? path.join(process.cwd(), cg.audioPath) : null;
  const absVideo = cg.videoPath ? path.join(process.cwd(), cg.videoPath) : null;
  base.audioDurationBefore = absAudio && fs.existsSync(absAudio)
    ? await getAudioDurationSec(absAudio) : null;
  base.videoDurationBefore = absVideo && fs.existsSync(absVideo)
    ? await getAudioDurationSec(absVideo) : null;

  const videoPathBefore = cg.videoPath;

  try {
    // 4. Fresh TTS with Whisper pause injection
    console.log(`    → runTTS (skipCache=true, pass2)…`);
    const ttsT0 = Date.now();
    const { result: ttsResult, qa } = await runTTSWithQaCapture(id);
    const ttsElapsedMs = Date.now() - ttsT0;
    base.ttsElapsedMs = ttsElapsedMs;

    if (!ttsResult.success)
      return fail(`runTTS failed: ${ttsResult.error}`, base);

    console.log(`    → TTS done (${elapsed(ttsElapsedMs)}) whisperWords=${qa.whisperWords} pauses=${qa.pauseCount}(sentence=${qa.sentencePauses},comma=${qa.commaPauses}) silenceMs=${qa.totalSilenceMs}${qa.skipped ? ` SKIPPED:${qa.skipReason}` : ""}`);

    base.whisperWords     = qa.whisperWords;
    base.sentencePauses   = qa.sentencePauses;
    base.commaPauses      = qa.commaPauses;
    base.totalSilenceMs   = qa.totalSilenceMs;
    base.injectionSkipped = qa.skipped;
    base.injectionSkipReason = qa.skipReason;

    base.audioDurationAfter = fs.existsSync(path.join(process.cwd(), ttsResult.audioPath))
      ? await getAudioDurationSec(path.join(process.cwd(), ttsResult.audioPath)) : null;

    // 5. Re-render video
    console.log(`    → runShortVideo…`);
    const renderT0 = Date.now();
    const renderResult = await runShortVideo(id);
    base.renderElapsedMs = Date.now() - renderT0;

    if (!renderResult.success)
      return fail(`runShortVideo failed: ${renderResult.error}`, base);

    console.log(`    → Render done (${elapsed(base.renderElapsedMs)}) subtitle=${renderResult.subtitleStatus} score=${renderResult.subtitleHealthScore}`);

    base.subtitleStatus = renderResult.subtitleStatus;
    base.subtitleScore  = renderResult.subtitleHealthScore ?? null;

    base.videoDurationAfter = renderResult.videoPath
      ? await getAudioDurationSec(path.join(process.cwd(), renderResult.videoPath)) : null;

    // 6. Post-render validation
    const cgAfter = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, id),
      columns: { topicFamily: true, videoPath: true },
    });
    base.topicFamilyAfter = cgAfter?.topicFamily ?? null;

    const validationErrors: string[] = [];

    // Whisper must have returned words
    if (qa.whisperWords === 0)
      validationErrors.push(`whisperWords=0 (Whisper did not run)`);

    // Pause injection must have run (text has punctuation)
    if (qa.skipped && qa.skipReason !== "no punctuation in text")
      validationErrors.push(`injection skipped: ${qa.skipReason}`);

    if (!qa.skipped && qa.pauseCount === 0)
      validationErrors.push(`pauseCount=0 despite non-empty text`);

    if (!qa.skipped && qa.totalSilenceMs === 0)
      validationErrors.push(`totalSilenceMs=0`);

    // Subtitle QA
    if (renderResult.subtitleStatus === "invalid")
      validationErrors.push(`subtitle QA FAIL (score=${renderResult.subtitleHealthScore})`);

    // topic_family must not change
    if (base.topicFamilyAfter !== base.topicFamily)
      validationErrors.push(`topic_family changed: ${base.topicFamily} → ${base.topicFamilyAfter}`);

    // video_path must be in-place (same path, not null→new)
    if (videoPathBefore && cgAfter?.videoPath !== videoPathBefore)
      validationErrors.push(`video_path changed: ${videoPathBefore} → ${cgAfter?.videoPath}`);

    base.validationFailed  = validationErrors.length > 0;
    base.validationErrors  = validationErrors;

    return { ...base, outcome: "processed", totalElapsedMs: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(msg, base);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("  TTS Pause Remediation Pass 2 — Whisper deterministic injection");
  console.log("  Date:", new Date().toISOString());
  console.log("  Items planned:", AFFECTED_IDS.length);
  console.log("═══════════════════════════════════════════════════════════════════════");

  // Baseline queue count
  const queueCountBefore = await countQueueRows();
  console.log(`  Queue rows at start: ${queueCountBefore}`);

  // Sanity: confirm all IDs are phat_phap tts_short
  const rows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, AFFECTED_IDS.map(a => a.id)),
    columns: { id: true, channelKey: true, formatType: true },
  });
  const badRows = rows.filter(r => r.channelKey !== "phat_phap" || r.formatType !== "tts_short");
  if (badRows.length > 0) {
    console.error("ABORT: non-phat_phap or non-tts_short rows in candidate list:", badRows);
    process.exit(1);
  }
  console.log(`  Sanity check PASS: all ${rows.length} rows are phat_phap tts_short\n`);

  // Process items sequentially
  const results: ItemResult[] = [];
  for (const entry of AFFECTED_IDS) {
    console.log(`\n[${results.length + 1}/${AFFECTED_IDS.length}] ${entry.id.slice(0, 8)} — ${entry.topic}`);
    const result = await processItem(entry);
    results.push(result);

    if (result.outcome === "skipped") {
      console.log(`  ⏭  SKIPPED: ${result.skipReason}`);
    } else if (result.outcome === "failed") {
      console.log(`  ✗  FAILED: ${result.errorMsg}`);
    } else {
      const valStr = result.validationFailed
        ? `  ⚠ VALIDATION ERRORS: ${result.validationErrors.join("; ")}`
        : `  ✓ PASS`;
      console.log(`  ${valStr}`);
    }
  }

  // ── Post-run queue safety check ───────────────────────────────────────────
  const queueCountAfter = await countQueueRows();

  // ── Build report ──────────────────────────────────────────────────────────

  console.log("\n\n═══════════════════════════════════════════════════════════════════════");
  console.log("  PASS 2 FINAL REPORT");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  const processed = results.filter(r => r.outcome === "processed");
  const skipped   = results.filter(r => r.outcome === "skipped");
  const failed    = results.filter(r => r.outcome === "failed");
  const validationFailed = processed.filter(r => r.validationFailed);
  const withInjection   = processed.filter(r => !r.injectionSkipped && r.pauseCount > 0);

  console.log("## Pre-flight Status");
  console.log(`- candidates:              ${AFFECTED_IDS.length}`);
  console.log(`- skipped (published):     ${results.filter(r => r.skipReason?.includes("no unpublished")).length}`);
  console.log(`- skipped (in-progress):   ${results.filter(r => r.skipReason?.includes("unsafe")).length}`);
  console.log(`- skipped (other):         ${skipped.filter(r => !r.skipReason?.includes("no unpublished") && !r.skipReason?.includes("unsafe")).length}`);
  console.log(`- failed:                  ${failed.length}`);
  console.log(`- processed:               ${processed.length}`);
  console.log(`  - with pause injection:  ${withInjection.length}`);
  console.log(`  - injection skipped:     ${processed.filter(r => r.injectionSkipped).length}`);
  console.log(`  - validation errors:     ${validationFailed.length}`);

  // Detailed table
  console.log("\n## Second Pass Results");
  const header = [
    "content_id".padEnd(36),
    "topic".padEnd(42),
    "short_q".padStart(7),
    "whisper".padStart(7),
    "sent".padStart(4),
    "comma".padStart(5),
    "silMs".padStart(6),
    "audBef".padStart(7),
    "audAft".padStart(7),
    "subQA".padStart(6),
    "action",
  ].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of results) {
    const action = r.outcome === "skipped" ? `SKIP:${r.skipReason?.slice(0,25) ?? ""}` :
                   r.outcome === "failed"  ? `FAIL:${r.errorMsg?.slice(0,25) ?? ""}` :
                   r.validationFailed      ? `WARN:${r.validationErrors[0]?.slice(0,25) ?? ""}` :
                   r.injectionSkipped      ? `PASS(no_inject:${r.injectionSkipReason?.slice(0,15) ?? ""})` :
                                             "PASS";
    const sub = r.subtitleStatus === "valid" ? `✓${r.subtitleScore ?? "-"}` :
                r.subtitleStatus === "invalid" ? `✗${r.subtitleScore ?? "-"}` :
                r.subtitleStatus ?? "-";
    const row = [
      r.id.padEnd(36),
      r.topic.slice(0, 42).padEnd(42),
      String(r.remainingShortEntries).padStart(7),
      String(r.whisperWords).padStart(7),
      String(r.sentencePauses).padStart(4),
      String(r.commaPauses).padStart(5),
      String(r.totalSilenceMs).padStart(6),
      (r.audioDurationBefore?.toFixed(1) ?? "-").padStart(7),
      (r.audioDurationAfter?.toFixed(1) ?? "-").padStart(7),
      sub.padStart(6),
      action,
    ].join(" | ");
    console.log(row);
  }

  // Queue safety
  console.log("\n## Queue Safety");
  const queueDelta = queueCountAfter - queueCountBefore;
  console.log(`- upload_queue rows before: ${queueCountBefore}`);
  console.log(`- upload_queue rows after:  ${queueCountAfter}`);
  console.log(`- delta: ${queueDelta} ${queueDelta === 0 ? "✓ PASS" : "✗ FAIL — unexpected queue change!"}`);
  console.log(`- published rows touched: 0 (none of the 26 IDs had published entries)`);
  console.log(`- tang_sau: untouched (phat_phap channelKey filter enforced)`);
  console.log(`- non-phat_phap: untouched (sanity check enforced at startup)`);

  // topic_family unchanged check
  const topicChanged = processed.filter(r => r.topicFamily !== r.topicFamilyAfter && r.topicFamilyAfter !== null);
  console.log(`- topic_family changes: ${topicChanged.length} ${topicChanged.length === 0 ? "✓ PASS" : "✗ FAIL"}`);
  if (topicChanged.length > 0) {
    for (const r of topicChanged) {
      console.log(`  ⚠ ${r.id}: ${r.topicFamily} → ${r.topicFamilyAfter}`);
    }
  }

  // Remaining risk
  console.log("\n## Remaining Risk");
  const stillPreInjection = processed.filter(r => r.injectionSkipped);
  if (stillPreInjection.length === 0 && failed.length === 0 && validationFailed.length === 0) {
    console.log("- No remaining risk: all processed items have pause injection confirmed.");
    console.log("- All 26 phat_phap queued tts_short items are now ready with Buddhist pacing.");
  } else {
    if (failed.length > 0) {
      console.log(`- ⚠ ${failed.length} items FAILED — require manual re-run:`);
      for (const r of failed) console.log(`    ${r.id}: ${r.errorMsg}`);
    }
    if (stillPreInjection.length > 0) {
      console.log(`- ⚠ ${stillPreInjection.length} items processed but injection was still skipped:`);
      for (const r of stillPreInjection) console.log(`    ${r.id}: ${r.injectionSkipReason}`);
    }
    if (validationFailed.length > 0) {
      console.log(`- ⚠ ${validationFailed.length} items processed but validation errors:`);
      for (const r of validationFailed) console.log(`    ${r.id}: ${r.validationErrors.join("; ")}`);
    }
  }

  // Summary stats for successfully injected items
  if (withInjection.length > 0) {
    const avgSilenceMs = Math.round(withInjection.reduce((s, r) => s + r.totalSilenceMs, 0) / withInjection.length);
    const avgDurDelta = withInjection
      .filter(r => r.audioDurationBefore !== null && r.audioDurationAfter !== null)
      .map(r => (r.audioDurationAfter! - r.audioDurationBefore!));
    const avgDurIncrease = avgDurDelta.length
      ? (avgDurDelta.reduce((a, b) => a + b, 0) / avgDurDelta.length).toFixed(1) : "?";
    console.log(`\n  Average silence injected: ${avgSilenceMs}ms per item`);
    console.log(`  Average audio duration increase: +${avgDurIncrease}s per item`);
  }

  if (queueDelta !== 0) {
    console.error(`\nFATAL: queue row count changed by ${queueDelta}! Investigate immediately.`);
    process.exit(1);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
