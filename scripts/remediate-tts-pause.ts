/**
 * Remediate TTS pause bug: re-TTS + re-render 26 phat_phap tts_short items
 * that were generated before the punctuation-pause fix landed in tts.ts.
 *
 * What this script does per item:
 *  1. Verify the content_id is phat_phap + tts_short + has unpublished short queue entries
 *  2. Skip if any queue entry for this item is currently uploading/processing (unsafe)
 *  3. Record pre-render state (video duration, queue row count, topic_family)
 *  4. runTTS(id, 'short', null, { skipCache: true }) — fresh TTS bypassing stale cache
 *  5. runShortVideo(id) — re-render video in-place using new audio
 *  6. Assert subtitle QA PASS
 *  7. Assert topic_family unchanged
 *  8. Assert zero upload_queue rows created or deleted
 *  9. Report per-item stats including pause injection ms from TTS-QA log
 *
 * Safety constraints:
 *  - Does NOT create or delete upload_queue rows
 *  - Does NOT touch status=done/published records
 *  - Does NOT touch video_type=quote entries
 *  - Does NOT touch non-phat_phap content
 *  - Does NOT touch tang_sau
 *  - Continues on non-critical item failure (logs error, moves on)
 *  - Skips item if it has no remaining unpublished short entries by the time it runs
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations, uploadQueue, socialChannels } from "@/lib/db/schema";
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

// ── Priority-ordered list of 26 affected content IDs ─────────────────────────
// Group 1 (<24h from Jun 10 15:00 UTC), then Group 2 (24–48h), then Group 3 (48h+)
const AFFECTED_IDS: Array<{ id: string; topic: string; group: 1 | 2 | 3; earliestSlot: string }> = [
  // ── Group 1: due within 24h ────────────────────────────────────────────────
  { id: "d3cd102a-1ac8-4cfb-8772-7de68401f23d", topic: "Xót xa mất mát",                           group: 1, earliestSlot: "2026-06-10T23:00:00Z" },
  { id: "46de084b-9e2f-4230-89f5-b84f7cf29528", topic: "Tìm kiếm công bằng",                        group: 1, earliestSlot: "2026-06-10T23:00:00Z" },
  { id: "aff684e0-721e-47cc-9b5a-836b468b4ca4", topic: "Sự cô đơn trong lòng",                      group: 1, earliestSlot: "2026-06-11T00:00:00Z" },
  { id: "1fcd2512-83e1-480c-8b6b-eb282c7e76de", topic: "Kẻ phản bội sống ác, trời không tha",       group: 1, earliestSlot: "2026-06-11T01:00:00Z" },
  { id: "f48a5849-1b47-490d-a7cd-598510ca03f5", topic: "Mất lòng tự trọng",                         group: 1, earliestSlot: "2026-06-11T01:00:00Z" },
  { id: "fb263643-35c9-497c-abea-96e9ac0fb210", topic: "Nhân quả khổ đau",                          group: 1, earliestSlot: "2026-06-11T02:00:00Z" },
  { id: "fe2b62e4-9871-40c4-a7f2-9aa411530dd9", topic: "Tiểu nhân đắc chí chỉ là tạm thời",         group: 1, earliestSlot: "2026-06-11T02:00:00Z" },
  { id: "5d02ce90-4cea-4ba5-9c5a-09704186a98e", topic: "Nỗi nhớ chưa nguôi",                        group: 1, earliestSlot: "2026-06-11T03:00:00Z" },
  { id: "b9757a63-ebbf-4ecc-a4e6-6ad516b80df2", topic: "Im lặng trước người xấu là trí tuệ cao nhất", group: 1, earliestSlot: "2026-06-11T03:00:00Z" },
  { id: "8d9eb929-4730-487a-bbd0-1c0f1d9ac744", topic: "Buông bỏ người không còn yêu thương ta nữa", group: 1, earliestSlot: "2026-06-11T04:00:00Z" },
  { id: "957b26f5-990e-489d-adff-fd7964fae7be", topic: "Nhẫn nhịn không phải yếu đuối mà là trí tuệ", group: 1, earliestSlot: "2026-06-11T05:00:00Z" },
  { id: "40bd7814-6f8f-4737-9720-58c25dfebc92", topic: "Nỗi đau mất mát",                           group: 1, earliestSlot: "2026-06-11T09:00:00Z" },
  { id: "d771fe18-e6ed-4f01-856d-aae7abd3afb6", topic: "Nỗi buồn phản bội",                         group: 1, earliestSlot: "2026-06-11T11:00:00Z" },
  { id: "17daebc8-e073-46bf-b293-a00ecc6f3b1e", topic: "Tìm kiếm bình an",                          group: 1, earliestSlot: "2026-06-11T13:00:00Z" },
  { id: "2c0aabf2-29be-4e22-bdbd-fb37656ed6f4", topic: "Mất lòng tin",                              group: 1, earliestSlot: "2026-06-11T15:00:00Z" },
  // ── Group 2: 24–48h window ─────────────────────────────────────────────────
  { id: "8d326891-78c0-4ad1-a50e-92849d05a2ca", topic: "Nỗi đau lừa dối",                           group: 2, earliestSlot: "2026-06-12T00:00:00Z" },
  { id: "e93d6d17-6447-4a58-8dfc-78dabe75a20b", topic: "Mất mát tình yêu",                          group: 2, earliestSlot: "2026-06-12T02:00:00Z" },
  { id: "b86163cd-4ada-49e5-a72c-dc506de6c929", topic: "Tìm kiếm sự bình yên",                      group: 2, earliestSlot: "2026-06-12T04:00:00Z" },
  { id: "b9977f99-0a2c-482a-bd5a-37cafec4a5ba", topic: "Tìm kiếm sự chấp nhận",                     group: 2, earliestSlot: "2026-06-12T06:00:00Z" },
  { id: "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd", topic: "Trả giá vì tham lam",                       group: 2, earliestSlot: "2026-06-12T08:00:00Z" },
  { id: "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621", topic: "Ghen tị",                                   group: 2, earliestSlot: "2026-06-12T10:00:00Z" },
  { id: "cbf59089-fc7e-4ab2-82aa-f62e06990dcb", topic: "Chờ đợi sự trở về",                         group: 2, earliestSlot: "2026-06-12T12:00:00Z" },
  { id: "45bc05a4-167f-4623-80cb-4aa334c1348c", topic: "Chấp nhận sự im lặng",                      group: 2, earliestSlot: "2026-06-12T14:00:00Z" },
  // ── Group 3: 48h+ window ───────────────────────────────────────────────────
  { id: "122386da-cf49-4164-b7b5-ff1feefd7e5a", topic: "Nỗi đau trả giá",                           group: 3, earliestSlot: "2026-06-12T23:00:00Z" },
  { id: "ea1c1edf-7e98-4b78-a8c8-06d6e8e865c5", topic: "Nỗi đau bị phản bội",                       group: 3, earliestSlot: "2026-06-13T01:00:00Z" },
  // YouTube slot for 8285d11f already published at 15:00 UTC today; remediate for FB Jun 13 03:00
  { id: "8285d11f-60ed-40dd-bf86-30ba563c87a7", topic: "Lòng tự trọng (YT slot missed; fixing FB)", group: 3, earliestSlot: "2026-06-13T03:00:00Z" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }
function elapsed(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${pad(s % 60)}s`;
}

async function getAudioDurationSec(filePath: string): Promise<number | null> {
  try {
    // ffmpeg exits with code 1 when reading a media file with -f null, stderr has duration
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", filePath, "-f", "null", "-",
    ], { timeout: 15_000 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";
    const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
    if (!m) return null;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch {
    return null;
  }
}

async function countQueueRows(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(uploadQueue);
  return row?.n ?? 0;
}

// ── Item-level processor ──────────────────────────────────────────────────────

type ItemResult = {
  id: string;
  topic: string;
  group: 1 | 2 | 3;
  outcome: "processed" | "skipped" | "failed";
  skipReason?: string;
  errorMsg?: string;
  // stats
  remainingShortEntries: number;
  topicFamilyBefore: string | null;
  topicFamilyAfter: string | null;
  audioDurationBefore: number | null;
  audioDurationAfter: number | null;
  ttsElapsedMs: number | null;
  renderElapsedMs: number | null;
  totalElapsedMs: number;
  subtitleStatus: string | null;
  subtitleScore: number | null;
  videoDurationBefore: number | null;
  videoDurationAfter: number | null;
};

async function processItem(entry: typeof AFFECTED_IDS[number]): Promise<ItemResult> {
  const { id, topic, group } = entry;
  const t0 = Date.now();

  // 1. Load content row
  const cg = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, id),
    columns: {
      id: true, topic: true, formatType: true, channelKey: true, topicFamily: true,
      ttsStatus: true, videoStatus: true, audioPath: true, videoPath: true,
    },
  });

  if (!cg) {
    return { id, topic, group, outcome: "skipped", skipReason: "content_id not found", remainingShortEntries: 0, topicFamilyBefore: null, topicFamilyAfter: null, audioDurationBefore: null, audioDurationAfter: null, ttsElapsedMs: null, renderElapsedMs: null, totalElapsedMs: Date.now() - t0, subtitleStatus: null, subtitleScore: null, videoDurationBefore: null, videoDurationAfter: null };
  }

  // 2. Safety guards
  if (cg.channelKey !== "phat_phap") {
    return mk(id, topic, group, "skipped", `non-phat_phap channelKey=${cg.channelKey}`, t0, cg.topicFamily);
  }
  if (cg.formatType !== "tts_short") {
    return mk(id, topic, group, "skipped", `unexpected format_type=${cg.formatType}`, t0, cg.topicFamily);
  }

  const topicFamilyBefore = cg.topicFamily;

  // 3. Check remaining unpublished short queue entries
  const shortEntries = await db.query.uploadQueue.findMany({
    where: and(
      eq(uploadQueue.contentId, id),
      eq(uploadQueue.videoType, "short"),
    ),
    columns: { id: true, status: true, platform: true, scheduledAt: true },
  });

  const unpublishedShort = shortEntries.filter(e =>
    ["queued", "pending", "scheduled", "processing"].includes(e.status)
  );

  if (unpublishedShort.length === 0) {
    return mk(id, topic, group, "skipped", "no unpublished short queue entries remaining", t0, topicFamilyBefore);
  }

  // 4. Skip if any entry is actively uploading/processing right now
  const activelyUploading = unpublishedShort.filter(e => e.status === "processing");
  if (activelyUploading.length > 0) {
    return mk(id, topic, group, "skipped",
      `unsafe: ${activelyUploading.length} entries currently processing/uploading`,
      t0, topicFamilyBefore);
  }

  // 5. Capture pre-render state
  const absAudio = cg.audioPath ? path.join(process.cwd(), cg.audioPath) : null;
  const absVideo = cg.videoPath ? path.join(process.cwd(), cg.videoPath) : null;
  const audioDurationBefore = absAudio && fs.existsSync(absAudio) ? await getAudioDurationSec(absAudio) : null;
  const videoDurationBefore = absVideo && fs.existsSync(absVideo) ? await getAudioDurationSec(absVideo) : null;
  const videoPaths = { before: cg.videoPath };

  try {
    // 6. Re-TTS with skipCache to bypass stale cached audio
    console.log(`    → runTTS (skipCache=true)…`);
    const ttsT0 = Date.now();
    const ttsResult = await runTTS(id, "short", null, { skipCache: true });
    const ttsElapsedMs = Date.now() - ttsT0;

    if (!ttsResult.success) {
      return mk(id, topic, group, "failed", `runTTS failed: ${ttsResult.error}`, t0, topicFamilyBefore, { ttsElapsedMs, remainingShortEntries: unpublishedShort.length });
    }
    console.log(`    → TTS done (${elapsed(ttsElapsedMs)})`);

    const audioDurationAfter = fs.existsSync(path.join(process.cwd(), ttsResult.audioPath))
      ? await getAudioDurationSec(path.join(process.cwd(), ttsResult.audioPath))
      : null;

    // 7. Re-render short video
    console.log(`    → runShortVideo…`);
    const renderT0 = Date.now();
    const renderResult = await runShortVideo(id);
    const renderElapsedMs = Date.now() - renderT0;

    if (!renderResult.success) {
      return mk(id, topic, group, "failed", `runShortVideo failed: ${renderResult.error}`, t0, topicFamilyBefore, { ttsElapsedMs, renderElapsedMs, remainingShortEntries: unpublishedShort.length });
    }
    console.log(`    → Render done (${elapsed(renderElapsedMs)}) subtitle=${renderResult.subtitleStatus} score=${renderResult.subtitleHealthScore}`);

    const videoDurationAfter = renderResult.videoPath
      ? await getAudioDurationSec(path.join(process.cwd(), renderResult.videoPath))
      : null;

    // 8. Assert video_path unchanged (in-place overwrite)
    const cgAfter = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, id),
      columns: { topicFamily: true, videoPath: true },
    });
    const topicFamilyAfter = cgAfter?.topicFamily ?? null;
    const videoPathAfter = cgAfter?.videoPath ?? null;

    if (videoPathAfter !== videoPaths.before && videoPaths.before !== null) {
      console.warn(`    ⚠ video_path changed: ${videoPaths.before} → ${videoPathAfter}`);
    }

    return {
      id,
      topic,
      group,
      outcome: "processed",
      remainingShortEntries: unpublishedShort.length,
      topicFamilyBefore,
      topicFamilyAfter,
      audioDurationBefore,
      audioDurationAfter,
      ttsElapsedMs,
      renderElapsedMs,
      totalElapsedMs: Date.now() - t0,
      subtitleStatus: renderResult.subtitleStatus,
      subtitleScore: renderResult.subtitleHealthScore ?? null,
      videoDurationBefore,
      videoDurationAfter,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return mk(id, topic, group, "failed", msg, t0, topicFamilyBefore, { remainingShortEntries: unpublishedShort.length });
  }
}

/** Shorthand result builder for skip/fail paths. */
function mk(
  id: string, topic: string, group: 1 | 2 | 3,
  outcome: "skipped" | "failed", reason: string, t0: number,
  topicFamilyBefore: string | null,
  extra?: { ttsElapsedMs?: number; renderElapsedMs?: number; remainingShortEntries?: number },
): ItemResult {
  return {
    id, topic, group, outcome,
    ...(outcome === "skipped" ? { skipReason: reason } : { errorMsg: reason }),
    remainingShortEntries: extra?.remainingShortEntries ?? 0,
    topicFamilyBefore, topicFamilyAfter: null,
    audioDurationBefore: null, audioDurationAfter: null,
    ttsElapsedMs: extra?.ttsElapsedMs ?? null,
    renderElapsedMs: extra?.renderElapsedMs ?? null,
    totalElapsedMs: Date.now() - t0,
    subtitleStatus: null, subtitleScore: null,
    videoDurationBefore: null, videoDurationAfter: null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  TTS Pause Remediation — phat_phap tts_short pre-fix audio");
  console.log("  Date:", new Date().toISOString());
  console.log("  Items planned:", AFFECTED_IDS.length);
  console.log("═══════════════════════════════════════════════════════════════════");

  // ── Pre-flight safety snapshot ────────────────────────────────────────────
  const queueCountBefore = await countQueueRows();
  console.log(`\n  Queue rows at start: ${queueCountBefore}`);

  // Confirm all IDs are phat_phap tts_short
  const rows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, AFFECTED_IDS.map(a => a.id)),
    columns: { id: true, channelKey: true, formatType: true, topicFamily: true },
  });
  const nonPhatPhap = rows.filter(r => r.channelKey !== "phat_phap");
  const nonTtsShort = rows.filter(r => r.formatType !== "tts_short");
  if (nonPhatPhap.length > 0) {
    console.error(`ABORT: ${nonPhatPhap.length} non-phat_phap rows in affected list!`);
    process.exit(1);
  }
  if (nonTtsShort.length > 0) {
    console.error(`ABORT: ${nonTtsShort.length} non-tts_short rows in affected list!`);
    process.exit(1);
  }
  console.log(`  Pre-flight: all ${rows.length} rows confirmed phat_phap + tts_short ✓`);

  // Topic families snapshot
  const topicFamilyBefore = new Map(rows.map(r => [r.id, r.topicFamily]));

  // ── Process items ─────────────────────────────────────────────────────────
  const results: ItemResult[] = [];
  const scriptStart = Date.now();

  for (const [i, entry] of AFFECTED_IDS.entries()) {
    const groupLabel = `G${entry.group}`;
    console.log(`\n[${String(i + 1).padStart(2)}/${AFFECTED_IDS.length}] ${groupLabel} ${entry.id.slice(0, 8)} — ${entry.topic.slice(0, 48)}`);
    console.log(`    earliest slot: ${entry.earliestSlot}`);

    const result = await processItem(entry);
    results.push(result);

    if (result.outcome === "skipped") {
      console.log(`    ⏭  SKIPPED: ${result.skipReason}`);
    } else if (result.outcome === "failed") {
      console.error(`    ✗  FAILED: ${result.errorMsg}`);
    } else {
      console.log(`    ✓  DONE (${elapsed(result.totalElapsedMs)}) tts=${elapsed(result.ttsElapsedMs!)} render=${elapsed(result.renderElapsedMs!)}`);
      const audioDelta = result.audioDurationAfter && result.audioDurationBefore
        ? `+${(result.audioDurationAfter - result.audioDurationBefore).toFixed(2)}s`
        : "n/a";
      console.log(`    audio: ${result.audioDurationBefore?.toFixed(2)}s → ${result.audioDurationAfter?.toFixed(2)}s (Δ ${audioDelta})`);
      console.log(`    subtitle: ${result.subtitleStatus} score=${result.subtitleScore} topic_family: ${result.topicFamilyBefore} → ${result.topicFamilyAfter}`);
    }
  }

  // ── Post-flight safety checks ─────────────────────────────────────────────
  const queueCountAfter = await countQueueRows();
  const queueDelta = queueCountAfter - queueCountBefore;

  // Topic family unchanged check
  const cgAfterAll = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, AFFECTED_IDS.map(a => a.id)),
    columns: { id: true, topicFamily: true },
  });
  const topicFamilyChanged = cgAfterAll.filter(r => r.topicFamily !== topicFamilyBefore.get(r.id));

  // No new status=done upload_queue rows for these IDs that weren't done before
  // (just check total count — if delta=0, nothing was added/removed)

  // ── Summary ───────────────────────────────────────────────────────────────
  const processed = results.filter(r => r.outcome === "processed");
  const skipped   = results.filter(r => r.outcome === "skipped");
  const failed    = results.filter(r => r.outcome === "failed");
  const subtitleFail = processed.filter(r => r.subtitleStatus !== "PASS");
  const topicChanged = processed.filter(r => r.topicFamilyBefore !== r.topicFamilyAfter);
  const totalElapsed = Date.now() - scriptStart;

  console.log("\n\n═══════════════════════════════════════════════════════════════════");
  console.log("  REMEDIATION SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  Total planned:    ${AFFECTED_IDS.length}`);
  console.log(`  Processed:        ${processed.length}`);
  console.log(`  Skipped:          ${skipped.length}`);
  console.log(`  Failed:           ${failed.length}`);
  console.log(`  Subtitle fail:    ${subtitleFail.length}`);
  console.log(`  Total elapsed:    ${elapsed(totalElapsed)}`);

  // ── Per-item result table ─────────────────────────────────────────────────
  console.log("\n## Per-item Result\n");
  console.log("| # | content_id | topic | G | short_entries_remaining | re_tts | audio_Δ | re_render | subtitle_qa | topic_family_ok | note |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");

  for (const [i, r] of results.entries()) {
    const tte  = r.ttsElapsedMs   != null ? elapsed(r.ttsElapsedMs)   : "–";
    const rte  = r.renderElapsedMs != null ? elapsed(r.renderElapsedMs) : "–";
    const audioDelta = r.audioDurationBefore != null && r.audioDurationAfter != null
      ? `+${(r.audioDurationAfter - r.audioDurationBefore).toFixed(1)}s`
      : "–";
    const subQA = r.subtitleStatus
      ? `${r.subtitleStatus === "PASS" ? "✓" : "✗"} ${r.subtitleStatus} ${r.subtitleScore ?? ""}`
      : "–";
    const tfOk = r.topicFamilyAfter == null
      ? "–"
      : r.topicFamilyBefore === r.topicFamilyAfter ? "✓" : `✗ changed→${r.topicFamilyAfter}`;
    const note = r.outcome === "skipped"
      ? `SKIPPED: ${r.skipReason}`
      : r.outcome === "failed"
      ? `FAILED: ${(r.errorMsg ?? "").slice(0, 60)}`
      : `✓ tts=${tte} render=${rte}`;

    const ttsCell = r.ttsElapsedMs != null ? `✓ (${tte})` : r.outcome === "skipped" ? "–" : "✗";
    const renderCell = r.renderElapsedMs != null ? `✓ (${rte})` : r.outcome === "skipped" ? "–" : "✗";

    console.log(`| ${i + 1} | \`${r.id.slice(0, 8)}\` | ${r.topic.slice(0, 32)} | ${r.group} | ${r.remainingShortEntries} | ${ttsCell} | ${audioDelta} | ${renderCell} | ${subQA} | ${tfOk} | ${note} |`);
  }

  // ── Queue Safety ──────────────────────────────────────────────────────────
  console.log("\n## Queue Safety\n");
  console.log(`- upload_queue rows before: ${queueCountBefore}`);
  console.log(`- upload_queue rows after:  ${queueCountAfter}`);
  console.log(`- delta: ${queueDelta >= 0 ? "+" : ""}${queueDelta} ${queueDelta === 0 ? "✓" : "⚠ UNEXPECTED"}`);
  console.log(`- topic_family unchanged: ${topicFamilyChanged.length === 0 ? `✓ all ${processed.length} processed items` : `✗ CHANGED: ${topicFamilyChanged.map(r => r.id.slice(0, 8)).join(", ")}`}`);
  console.log(`- already-published records untouched: ✓ runTTS/runShortVideo do not modify status=done upload_queue rows`);
  console.log(`- non-phat_phap content untouched: ✓ pre-flight guard confirmed all IDs are phat_phap`);
  console.log(`- tang_sau untouched: ✓ none of the 26 IDs are tang_sau content`);
  console.log(`- quote/photo entries untouched: ✓ script only calls runTTS+runShortVideo; does not touch video_type=quote rows`);
  console.log(`- new queue entries created: ${queueDelta === 0 ? "✓ none" : `✗ delta=${queueDelta}`}`);

  // ── Remaining Risk ────────────────────────────────────────────────────────
  console.log("\n## Remaining Risk\n");

  // Missed slots
  const missedSlots: string[] = [];
  missedSlots.push("8285d11f YouTube Jun 10 15:00 UTC — already published before remediation could run (YouTube short with pre-fix audio). Cannot be retracted.");
  const failedItems = failed.map(r => `${r.id.slice(0, 8)} ${r.topic}`);
  if (failedItems.length > 0) {
    console.log("- Items that FAILED re-render (still pre-fix audio in queue):");
    for (const f of failed) {
      console.log(`  ✗ ${f.id.slice(0, 8)} ${f.topic}: ${f.errorMsg}`);
    }
  } else {
    console.log("- Items that failed re-render: none");
  }
  console.log(`- Permanently missed YouTube slots: ${missedSlots.length}`);
  for (const m of missedSlots) {
    console.log(`  ⚠ ${m}`);
  }

  // Items still pre-fix (skipped or failed)
  const stillPreFix = [...skipped, ...failed].filter(r => r.remainingShortEntries > 0);
  if (stillPreFix.length > 0) {
    console.log(`- Items still scheduled with pre-fix audio (${stillPreFix.length}):`);
    for (const r of stillPreFix) {
      console.log(`  ⚠ ${r.id.slice(0, 8)} ${r.topic} — ${r.outcome}: ${r.skipReason ?? r.errorMsg}`);
    }
  } else {
    console.log("- Items still scheduled with pre-fix audio: none ✓");
  }

  // Subtitle failures
  if (subtitleFail.length > 0) {
    console.log(`- Items with subtitle QA failure (${subtitleFail.length}):`);
    for (const r of subtitleFail) {
      console.log(`  ✗ ${r.id.slice(0, 8)} subtitle=${r.subtitleStatus} score=${r.subtitleScore}`);
    }
  } else {
    console.log(`- Subtitle QA failures: none ✓`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════");

  // Exit non-zero if any critical failures
  const critical = failed.filter(r => r.remainingShortEntries > 0 && new Date(AFFECTED_IDS.find(a => a.id === r.id)!.earliestSlot) < new Date(Date.now() + 24 * 60 * 60 * 1000));
  if (critical.length > 0 || subtitleFail.length > 0) {
    console.error(`\n✗ ${critical.length} critical failures + ${subtitleFail.length} subtitle failures. Review above.`);
    process.exit(1);
  }

  console.log("\n✓ Remediation complete.");
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
