/**
 * Re-render — Loudnorm-Only Audio Policy (ADR-024)
 *
 * Re-renders all queued/unpublished phat_phap tts_short items using the new
 * loudnorm-only audio normalization policy:
 *   VieNeu raw output → loudnorm (I=-16:TP=-1.5:LRA=11) → final wav
 *   (no silenceremove, no punctuation pause injection)
 *
 * The policy is now enforced automatically in tts.ts when channelKey="phat_phap".
 * This script just triggers a skipCache re-render for each queued item.
 *
 * Priority: earliest scheduledAt first (soonest-to-publish).
 * Safety: no upload_queue mutations, no tang_sau, no already-published rows.
 *
 * QA previews for: 2f18fadb, 8d12d8ba, cbf59089
 * Output: media/qa/loudnorm-only-rerender/
 */

// Belt-and-suspenders: injection must stay off
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

const QA_DIR = path.join(process.cwd(), "media", "qa", "loudnorm-only-rerender");
const VN_TZ  = "Asia/Ho_Chi_Minh";

// ── Scope: same 26 phat_phap tts_short items from the TTS pacing audit ────────
// (source: audit-tts-pacing.ts Pass 2 remediation batch)
const SCOPE_IDS = [
  { id: "b9977f99-0a2c-482a-bd5a-37cafec4a5ba", topic: "Tìm kiếm sự chấp nhận" },
  { id: "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd", topic: "Trả giá vì tham lam" },
  { id: "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621", topic: "Ghen tị" },
  { id: "cbf59089-fc7e-4ab2-82aa-f62e06990dcb", topic: "Chờ đợi sự trở về" },
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
  { id: "45bc05a4-167f-4623-80cb-4aa334c1348c", topic: "Chấp nhận sự im lặng" },
  { id: "122386da-cf49-4164-b7b5-ff1feefd7e5a", topic: "Nỗi đau trả giá" },
  { id: "ea1c1edf-7e98-4b78-a8c8-06d6e8e865c5", topic: "Nỗi đau bị phản bội" },
  { id: "8285d11f-60ed-40dd-bf86-30ba563c87a7", topic: "Lòng tự trọng" },
];

// Items that must get QA preview clips regardless of processing order
const PREVIEW_IDS = new Set([
  "2f18fadb-18d6-4cfb-bf21-d263bea8fdbd",
  "8d12d8ba-7a84-4e0f-9a78-fe1f6c87e621",
  "cbf59089-fc7e-4ab2-82aa-f62e06990dcb",
]);

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
    const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(
      (result as { stderr?: string }).stderr ?? ""
    );
    if (!m) return null;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch { return null; }
}

async function countSilenceSegs(filePath: string, minDurSec: number): Promise<number> {
  try {
    const result = await execFileAsync(FFMPEG_PATH, [
      "-i", filePath,
      "-af", `silencedetect=noise=-50dB:d=${minDurSec}`,
      "-f", "null", "-",
    ], { timeout: 15_000 }).catch(e => e as { stderr?: string });
    const stderr = (result as { stderr?: string }).stderr ?? "";
    return (stderr.match(/silence_end/g) ?? []).length;
  } catch { return -1; }
}

async function exportPreviewClip(
  inputPath: string,
  outputPath: string,
  startSec = 0,
  durationSec = 25,
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
  outcome: "processed" | "skipped" | "failed";
  skipReason?: string;
  errorMsg?: string;
  scheduledAt: string | null;
  audioPolicy: string;
  audioDurationBefore: number | null;
  audioDurationAfter: number | null;
  pauses150After: number;
  pauses300After: number;
  subtitleStatus: string | null;
  subtitleScore: number | null;
  previewClipPath: string | null;
  topicFamily: string | null;
  topicFamilyAfter: string | null;
  totalElapsedMs: number;
};

// ── Per-item processor ────────────────────────────────────────────────────────

async function processItem(
  entry: { id: string; topic: string },
  exportPreview: boolean,
): Promise<ItemResult> {
  const { id, topic } = entry;
  const t0 = Date.now();

  const base: Omit<ItemResult, "outcome" | "totalElapsedMs"> = {
    id, topic,
    scheduledAt: null,
    audioPolicy: "loudnorm_only",
    audioDurationBefore: null, audioDurationAfter: null,
    pauses150After: 0, pauses300After: 0,
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

  // 2. Queue safety pre-flight: skip published/uploading items
  const shortEntries = await db.query.uploadQueue.findMany({
    where: and(eq(uploadQueue.contentId, id), eq(uploadQueue.videoType, "short")),
    columns: { id: true, status: true, scheduledAt: true },
  });

  const published  = shortEntries.filter(r => r.status === "published");
  const uploading  = shortEntries.filter(r => ["uploading", "processing"].includes(r.status));
  const queued     = shortEntries.filter(r => r.status === "queued");

  if (published.length > 0) return skip(`already published (${published.length} rows)`);
  if (uploading.length > 0) return skip(`currently uploading/processing (${uploading.length} rows)`);
  if (queued.length === 0)  return skip("no queued short entries");

  const earliest = queued
    .filter(r => r.scheduledAt)
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())[0];
  base.scheduledAt = earliest?.scheduledAt ? toVn(new Date(earliest.scheduledAt)) : null;

  // 3. Pre-render audio duration
  const absAudioBefore = cg.audioPath ? path.join(process.cwd(), cg.audioPath) : null;
  base.audioDurationBefore = absAudioBefore && fs.existsSync(absAudioBefore)
    ? await getAudioDurationSec(absAudioBefore) : null;

  const videoPathBefore = cg.videoPath;

  console.log(`    → runTTS (channelKey=phat_phap → loudnorm_only, skipCache=true)…`);
  const ttsT0 = Date.now();

  try {
    const ttsResult = await runTTS(id, "short", null, { skipCache: true });
    const ttsElapsed = Date.now() - ttsT0;
    if (!ttsResult.success) return fail(`runTTS failed: ${ttsResult.error}`);
    console.log(`    → TTS done (${elapsed(ttsElapsed)}) policy=loudnorm_only`);

    const absAudioAfter = path.join(process.cwd(), ttsResult.audioPath);
    if (fs.existsSync(absAudioAfter)) {
      base.audioDurationAfter = await getAudioDurationSec(absAudioAfter);
      [base.pauses150After, base.pauses300After] = await Promise.all([
        countSilenceSegs(absAudioAfter, 0.15),
        countSilenceSegs(absAudioAfter, 0.30),
      ]);
    }

    // 4. Re-render video
    console.log(`    → runShortVideo…`);
    const renderT0 = Date.now();
    const renderResult = await runShortVideo(id);
    if (!renderResult.success) return fail(`runShortVideo failed: ${renderResult.error}`);
    base.subtitleStatus = renderResult.subtitleStatus;
    base.subtitleScore  = renderResult.subtitleHealthScore ?? null;
    console.log(`    → Render done (${elapsed(Date.now() - renderT0)}) subtitle=${renderResult.subtitleStatus} score=${renderResult.subtitleHealthScore ?? "-"}`);

    // 5. Export preview clip for designated IDs
    if (exportPreview && fs.existsSync(absAudioAfter)) {
      fs.mkdirSync(QA_DIR, { recursive: true });
      const clipPath = path.join(QA_DIR, `loudnorm_only_${id.slice(0, 8)}.wav`);
      const ok = await exportPreviewClip(absAudioAfter, clipPath);
      if (ok) base.previewClipPath = path.relative(process.cwd(), clipPath);
    }

    // 6. Post-render validation
    const cgAfter = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, id),
      columns: { topicFamily: true, videoPath: true },
    });
    base.topicFamilyAfter = cgAfter?.topicFamily ?? null;

    const errors: string[] = [];
    if (base.subtitleStatus === "invalid")
      errors.push(`subtitle FAIL score=${base.subtitleScore}`);
    if (base.topicFamilyAfter !== base.topicFamily)
      errors.push(`topic_family changed: ${base.topicFamily} → ${base.topicFamilyAfter}`);
    if (videoPathBefore && cgAfter?.videoPath !== videoPathBefore)
      errors.push(`video_path changed: ${videoPathBefore} → ${cgAfter?.videoPath}`);
    // New validation: loudnorm-only should preserve pauses — warn if zero
    if (base.pauses150After === 0 && (base.audioDurationAfter ?? 0) > 10)
      errors.push(`zero pauses detected (silenceremove may still be active?)`);

    if (errors.length > 0) {
      return { ...base, outcome: "failed", errorMsg: errors.join("; "), totalElapsedMs: Date.now() - t0 };
    }

    return { ...base, outcome: "processed", totalElapsedMs: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, outcome: "failed", errorMsg: msg, totalElapsedMs: Date.now() - t0 };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.TTS_ENABLE_PUNCTUATION_PAUSES === "true") {
    console.error("ABORT: TTS_ENABLE_PUNCTUATION_PAUSES=true — must be false for this script.");
    process.exit(1);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("  Re-render — Loudnorm-Only Audio Policy (ADR-024)");
  console.log(`  Date: ${new Date().toISOString()}  (VN: ${toVn(new Date())})`);
  console.log("  Policy: phat_phap → loudnorm-only (no silenceremove, no injection)");
  console.log("════════════════════════════════════════════════════════════════════");

  // Sanity check: all scope IDs must be phat_phap tts_short
  const ids = SCOPE_IDS.map(a => a.id);
  const cgCheck = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, ids),
    columns: { id: true, channelKey: true, formatType: true },
  });
  const badRows = cgCheck.filter(r => r.channelKey !== "phat_phap" || r.formatType !== "tts_short");
  if (badRows.length > 0) {
    console.error("ABORT: non-phat_phap or non-tts_short rows:", badRows);
    process.exit(1);
  }
  const missingIds = ids.filter(id => !cgCheck.find(r => r.id === id));
  if (missingIds.length > 0) {
    console.warn(`  ⚠ Not found in DB (will be skipped): ${missingIds.map(id => id.slice(0, 8)).join(", ")}`);
  }
  console.log(`  Sanity PASS: ${cgCheck.length} rows confirmed phat_phap tts_short`);
  console.log(`  Scope: ${SCOPE_IDS.length} items | Preview targets: ${[...PREVIEW_IDS].map(id => id.slice(0, 8)).join(", ")}\n`);

  const queueCountBefore = await countQueueRows();
  console.log(`  Queue rows at start: ${queueCountBefore}\n`);

  // Load queue rows to sort by scheduledAt
  const allQueueRows = await db.query.uploadQueue.findMany({
    where: and(inArray(uploadQueue.contentId, ids), eq(uploadQueue.videoType, "short")),
    columns: { id: true, contentId: true, status: true, scheduledAt: true },
  });

  // Build scheduledAt map (earliest queued entry per content)
  const scheduledMap = new Map<string, Date>();
  for (const r of allQueueRows) {
    if (r.status === "queued" && r.scheduledAt) {
      const existing = scheduledMap.get(r.contentId);
      const d = new Date(r.scheduledAt);
      if (!existing || d < existing) scheduledMap.set(r.contentId, d);
    }
  }

  // Sort by scheduledAt ascending (soonest-to-publish first), then by array order
  const processingOrder = [...SCOPE_IDS].sort((a, b) => {
    const da = scheduledMap.get(a.id)?.getTime() ?? Infinity;
    const db_ = scheduledMap.get(b.id)?.getTime() ?? Infinity;
    return da - db_;
  });

  // Process sequentially
  const results: ItemResult[] = [];

  for (const entry of processingOrder) {
    const isPreview = PREVIEW_IDS.has(entry.id);
    const label = isPreview ? "★ PREVIEW" : "         ";
    console.log(`\n[${results.length + 1}/${processingOrder.length}] ${label} ${entry.id.slice(0, 8)} — ${entry.topic}`);

    const result = await processItem(entry, isPreview);
    results.push(result);

    if (result.outcome === "processed") {
      console.log(
        `  ✓ PASS  dur=${result.audioDurationAfter?.toFixed(1) ?? "?"}s` +
        `  pauses>150ms=${result.pauses150After}  pauses>300ms=${result.pauses300After}` +
        `  sub=${result.subtitleStatus}(${result.subtitleScore ?? "-"})` +
        `  policy=${result.audioPolicy}` +
        `  ${elapsed(result.totalElapsedMs)}`
      );
    } else if (result.outcome === "skipped") {
      console.log(`  ⏭ SKIPPED: ${result.skipReason}`);
    } else {
      console.log(`  ✗ FAILED: ${result.errorMsg}`);
    }
  }

  // ── Queue safety ──────────────────────────────────────────────────────────
  const queueCountAfter = await countQueueRows();
  const queueDelta = queueCountAfter - queueCountBefore;

  // ── Final report ──────────────────────────────────────────────────────────
  const processed = results.filter(r => r.outcome === "processed");
  const skipped   = results.filter(r => r.outcome === "skipped");
  const failed    = results.filter(r => r.outcome === "failed");

  console.log("\n\n════════════════════════════════════════════════════════════════════");
  console.log("  RE-RENDER SUMMARY — Loudnorm-Only (ADR-024)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  console.log("## Production Audio Policy");
  console.log(`- punctuationInjection: off (TTS_ENABLE_PUNCTUATION_PAUSES=false)`);
  console.log(`- silenceremove:        off for phat_phap (channelKey-gated in tts.ts)`);
  console.log(`- loudnorm:             on  (I=-16:TP=-1.5:LRA=11)`);
  console.log(`- policy applies to:    channelKey=phat_phap (ADR-024)`);

  console.log(`\n## Items Re-rendered`);
  console.log([
    "content_id".padEnd(10),
    "topic".padEnd(32),
    "scheduled_at".padEnd(20),
    "audio_policy".padEnd(13),
    "dur_s".padStart(5),
    "p>150".padStart(5),
    "p>300".padStart(5),
    "subtitle_qa".padStart(11),
    "action",
  ].join(" | "));
  console.log("-".repeat(140));

  for (const r of results) {
    const action =
      r.outcome === "skipped" ? `SKIP: ${r.skipReason?.slice(0, 35) ?? ""}` :
      r.outcome === "failed"  ? `FAIL: ${r.errorMsg?.slice(0, 35) ?? ""}` :
      `PASS${PREVIEW_IDS.has(r.id) ? " [PREVIEW]" : ""}`;
    const subQa = r.subtitleStatus === "valid"   ? `✓ ${r.subtitleScore ?? "-"}` :
                  r.subtitleStatus === "invalid" ? `✗ ${r.subtitleScore ?? "-"}` :
                  r.subtitleStatus ?? "-";
    console.log([
      r.id.slice(0, 10).padEnd(10),
      r.topic.slice(0, 32).padEnd(32),
      (r.scheduledAt ?? "-").slice(0, 20).padEnd(20),
      r.audioPolicy.padEnd(13),
      (r.audioDurationAfter?.toFixed(1) ?? "-").padStart(5),
      String(r.pauses150After).padStart(5),
      String(r.pauses300After).padStart(5),
      subQa.padStart(11),
      action,
    ].join(" | "));
  }

  console.log(`\n## Queue Safety`);
  console.log(`- upload_queue rows before: ${queueCountBefore}`);
  console.log(`- upload_queue rows after:  ${queueCountAfter}`);
  console.log(`- delta:                    ${queueDelta} ${queueDelta === 0 ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`- published rows touched:   0 (pre-flight rejects published items)`);
  console.log(`- tang_sau:                 untouched (channelKey=phat_phap filter enforced)`);
  console.log(`- total processed:          ${processed.length}`);
  console.log(`- total skipped:            ${skipped.length}`);
  console.log(`- total failed:             ${failed.length}`);

  const topicChanged = processed.filter(r => r.topicFamily !== r.topicFamilyAfter && r.topicFamilyAfter !== null);
  console.log(`- topic_family changes:     ${topicChanged.length} ${topicChanged.length === 0 ? "✓" : "✗"}`);
  for (const r of topicChanged) console.log(`    ⚠ ${r.id.slice(0, 8)}: ${r.topicFamily} → ${r.topicFamilyAfter}`);

  if (skipped.length > 0) {
    console.log(`\n- Skipped items:`);
    for (const r of skipped) console.log(`    ${r.id.slice(0, 8)} — ${r.topic}: ${r.skipReason?.slice(0, 50) ?? ""}`);
  }
  if (failed.length > 0) {
    console.log(`\n- Failed items:`);
    for (const r of failed) console.log(`    ${r.id.slice(0, 8)} — ${r.topic}: ${r.errorMsg?.slice(0, 60) ?? ""}`);
  }

  console.log(`\n## Preview Files`);
  const clips = results.filter(r => r.previewClipPath);
  if (clips.length > 0) {
    for (const r of clips) {
      console.log(
        `  ${r.id.slice(0, 8)} — ${r.topic.slice(0, 35).padEnd(35)}` +
        `  dur=${r.audioDurationAfter?.toFixed(1) ?? "?"}s` +
        `  pauses>150=${r.pauses150After}  pauses>300=${r.pauses300After}` +
        `\n    → ${r.previewClipPath}`
      );
    }
  } else {
    console.log("  (none — no designated preview items processed)");
  }

  console.log(`\n## Recommendation`);
  console.log(`  Loudnorm-only (ADR-024) is now production default for phat_phap.`);
  console.log(`  Next quality step: Option E — net-addition pause injection`);
  console.log(`    measure existing silence at each punctuation boundary,`);
  console.log(`    inject only max(0, target_ms - existing_ms).`);
  console.log(`  This preserves natural prosody while bringing pacing up to guideline.`);
  console.log(`  Re-enable TTS_ENABLE_PUNCTUATION_PAUSES=true only after Option E ships.`);

  console.log("\n════════════════════════════════════════════════════════════════════");

  if (queueDelta !== 0) {
    console.error(`\nFATAL: queue delta=${queueDelta} — unexpected queue mutation!`);
    process.exit(1);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
