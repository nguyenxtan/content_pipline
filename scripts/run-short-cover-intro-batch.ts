/**
 * run-short-cover-intro-batch.ts
 *
 * Controlled render batch with SHORT_COVER_INTRO_ENABLED=true.
 * DB tracking is written ONLY after a successful render + verification pass.
 * Does NOT queue upload or publish.
 *
 * Usage:
 *   pnpm short-cover:intro-batch                              # render + DB write (limit=5)
 *   pnpm short-cover:intro-batch -- --limit=5                # explicit limit
 *   pnpm short-cover:intro-batch -- --dry-run                # show plan, no render, no DB write
 *   pnpm short-cover:intro-batch -- --overwrite-thumbnail-text  # allow overwriting existing thumbnailText
 *
 * DB write guards (all must pass before writing anything):
 *   - render succeeded (runShortVideo returned success: true)
 *   - output video file exists on disk
 *   - frame extraction succeeded
 *   - subtitle status is PASS
 *   - audio/video delta ≤ 0.15s
 *
 * Fields written (only when guards pass):
 *   thumbnailText   = coverText  (only if currently null/empty, or --overwrite-thumbnail-text)
 *   experimentId    = "short-cover-intro-v1"  (only if currently null)
 *   experimentVariant = "intro_on_1p5s"       (only if currently null)
 *
 * Output:
 *   output/short-cover-intro-controlled-batch/
 *     report.json
 *     sample-<id>/
 *       video-preview.mp4
 *       cover-asset.jpg
 *       frame-first.jpg       (t=0.05s)
 *       frame-mid-intro.jpg   (t=0.75s)
 *       frame-post-intro.jpg  (t=1.70s)
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import pg from "pg";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";

const execFileAsync = promisify(execFile);
const { Pool } = pg;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH = ffmpegInstaller.path;

const OUT_DIR         = path.join(process.cwd(), "output", "short-cover-intro-controlled-batch");
const BATCH_LIMIT     = 5;
const EXPERIMENT_ID   = "short-cover-intro-v1";
const EXPERIMENT_VARIANT = "intro_on_1p5s";

// Verification thresholds for the DB write gate
const DELTA_THRESHOLD_SEC = 0.15;

type BatchSample = {
  id: string;
  topic: string;
  short_content: string | null;
  script: string | null;
  short_selected_hook: string | null;
  audio_path: string | null;
  image_paths: string[] | null;
  video_status: string | null;
  thumbnail_text: string | null;
  experiment_id: string | null;
  experiment_variant: string | null;
};

type FramePaths = {
  first: string;
  midIntro: string;
  postIntro: string;
};

type DbWriteDecision = {
  thumbnailText: boolean;
  experimentId: boolean;
  experimentVariant: boolean;
};

type DbWriteSkippedReason = {
  thumbnailText: string | null;
  experimentId: string | null;
  experimentVariant: string | null;
};

type BatchResult = {
  contentId: string;
  topic: string;
  selectedHook: string | null;
  coverText: string;
  coverReason: string;
  coverConfidence: number;
  experimentId: string | null;
  experimentVariant: string | null;
  introEnabled: true;
  introDurationSec: number;
  fadeOutSec: number;
  coverAssetPath: string;
  outputVideoPath: string;
  outputFramePaths: FramePaths | null;
  durationSec: number;
  audioDurationSec: number;
  audioVideoDeltaSec: number;
  subtitleHealthScore: number;
  subtitleStatus: string;
  firstFrameSimilarity: number | null;
  renderStatus: "success" | "failed" | "skipped_dry_run";
  publishQueueStatus: "not_queued";
  dbWrite: DbWriteDecision | null;
  dbWriteSkippedReason: DbWriteSkippedReason | null;
  dbWriteTiming: "after_successful_render" | "skipped_render_failed" | "skipped_dry_run" | "skipped_verification_failed" | null;
  visualIssues: string[];
  error?: string;
};

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function readLimit(): number {
  const raw = process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
  const parsed = raw ? Number(raw) : BATCH_LIMIT;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(10, parsed)) : BATCH_LIMIT;
}

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

function allowOverwriteThumbnailText(): boolean {
  return process.argv.includes("--overwrite-thumbnail-text");
}

async function getMediaDurationSec(absPath: string): Promise<number> {
  const result = await execFileAsync(FFMPEG_PATH, ["-i", absPath, "-f", "null", "-"], { timeout: 30_000 })
    .catch((error: { stderr: string }) => ({ stderr: error.stderr }));
  const stderr = (result as { stderr: string }).stderr;
  const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`Could not read duration of: ${absPath}`);
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
}

async function extractFrame(videoPath: string, outputPath: string, timeSec: number): Promise<void> {
  await execFileAsync(FFMPEG_PATH, [
    "-y", "-ss", timeSec.toFixed(3), "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath,
  ], { timeout: 30_000 });
}

async function computeImageSimilarity(refPath: string, framePath: string): Promise<number> {
  const sharp = (await import("sharp")).default;
  const [ref, frame] = await Promise.all([
    sharp(refPath).resize(180, 320).removeAlpha().raw().toBuffer(),
    sharp(framePath).resize(180, 320).removeAlpha().raw().toBuffer(),
  ]);
  let diffTotal = 0;
  for (let i = 0; i < ref.length; i++) diffTotal += Math.abs(ref[i] - frame[i]);
  return Math.max(0, Math.min(1, 1 - diffTotal / ref.length / 255));
}

async function loadSamples(limit: number): Promise<{ samples: BatchSample[]; fallbackNote: string | null }> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set. Run with --env-file=.env.local.");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const rows = (await client.query<BatchSample>(`
      SELECT id, topic, short_content, script, short_selected_hook,
             audio_path, image_paths, video_status,
             thumbnail_text, experiment_id, experiment_variant
      FROM content_generations
      WHERE content_mode IN ('short', 'both')
      ORDER BY created_at DESC
      LIMIT 100
    `)).rows;

    const renderReady = rows.filter((r) => {
      const audioOk = r.audio_path && fs.existsSync(resolveProjectPath(r.audio_path));
      const imageOk = (r.image_paths ?? []).some((p) => fs.existsSync(resolveProjectPath(p)));
      return Boolean(audioOk && imageOk);
    });

    const pending = renderReady.filter((r) => r.video_status !== "done");
    if (pending.length >= limit) return { samples: pending.slice(0, limit), fallbackNote: null };

    const mixed = [...pending];
    for (const r of renderReady) {
      if (mixed.some((item) => item.id === r.id)) continue;
      mixed.push(r);
      if (mixed.length >= limit) break;
    }

    const note =
      pending.length < limit
        ? `Only ${pending.length} pending; filled to ${mixed.length} with already-rendered items.`
        : null;
    return { samples: mixed.slice(0, limit), fallbackNote: note };
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Determine what the DB write would do for a given sample, without executing it.
 * Used both by dry-run (plan only) and non-dry-run (pre-verification plan).
 */
function planDbWrite(
  sample: BatchSample,
  overwriteThumbnail: boolean,
): { decision: DbWriteDecision; skippedReason: DbWriteSkippedReason } {
  const thumbAlreadySet = Boolean(sample.thumbnail_text?.trim());
  const writeThumbnail  = overwriteThumbnail ? true : !thumbAlreadySet;
  const skipThumbReason = !writeThumbnail
    ? `already_set: "${sample.thumbnail_text}" (use --overwrite-thumbnail-text to force)`
    : null;

  const writeExpId      = sample.experiment_id === null;
  const skipExpId       = !writeExpId ? `already_set: "${sample.experiment_id}"` : null;

  const writeExpVariant = sample.experiment_variant === null;
  const skipExpVariant  = !writeExpVariant ? `already_set: "${sample.experiment_variant}"` : null;

  return {
    decision: { thumbnailText: writeThumbnail, experimentId: writeExpId, experimentVariant: writeExpVariant },
    skippedReason: { thumbnailText: skipThumbReason, experimentId: skipExpId, experimentVariant: skipExpVariant },
  };
}

/**
 * Execute DB write. Only called after successful render + verification.
 * Fields are written according to the pre-computed plan (no re-evaluation at write time).
 */
async function executeDbWrite(
  contentId: string,
  coverText: string,
  plan: DbWriteDecision,
): Promise<void> {
  if (!plan.thumbnailText && !plan.experimentId && !plan.experimentVariant) return;

  await db.update(contentGenerations)
    .set({
      ...(plan.thumbnailText    ? { thumbnailText:    coverText }          : {}),
      ...(plan.experimentId     ? { experimentId:     EXPERIMENT_ID }     : {}),
      ...(plan.experimentVariant ? { experimentVariant: EXPERIMENT_VARIANT } : {}),
    })
    .where(eq(contentGenerations.id, contentId));
}

async function main() {
  process.env.SHORT_COVER_INTRO_ENABLED = "true";
  process.env.SHORT_COVER_DURATION_SEC  = process.env.SHORT_COVER_DURATION_SEC  ?? "1.5";
  process.env.SHORT_COVER_FADE_OUT_SEC  = process.env.SHORT_COVER_FADE_OUT_SEC  ?? "0.25";

  const introDurationSec   = Number(process.env.SHORT_COVER_DURATION_SEC);
  const fadeOutSec         = Number(process.env.SHORT_COVER_FADE_OUT_SEC);
  const limit              = readLimit();
  const dryRun             = isDryRun();
  const overwriteThumbnail = allowOverwriteThumbnailText();

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  run-short-cover-intro-batch — controlled render batch");
  console.log(`  INTRO: enabled  duration=${introDurationSec}s  fade=${fadeOutSec}s`);
  console.log(`  Limit: ${limit}  |  No upload / queue / publish`);
  console.log(`  Mode : ${dryRun ? "DRY-RUN (no render, no DB write)" : "RENDER + DB write after verification"}`);
  console.log(`  Experiment: ${EXPERIMENT_ID} / ${EXPERIMENT_VARIANT}`);
  console.log(`  thumbnailText overwrite: ${overwriteThumbnail ? "YES (--overwrite-thumbnail-text)" : "NO (safe default)"}`);
  console.log(`  DB write timing: after_successful_render`);
  console.log(`  Output: ${OUT_DIR}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { samples, fallbackNote } = await loadSamples(limit);
  if (!samples.length) throw new Error("No render-ready samples found in DB.");
  if (fallbackNote) console.warn(`[warn] ${fallbackNote}`);
  console.log(`  Loaded ${samples.length} sample(s).\n`);

  const [{ runShortVideo }, { generateShortCover }, { generateShortCoverAsset }] = await Promise.all([
    import("@/lib/pipeline/short-video"),
    import("@/lib/short-cover-engine"),
    import("@/lib/image/short-cover-asset-generator"),
  ]);

  const results: BatchResult[] = [];
  const fallbackNoteCapture = fallbackNote;

  for (const [index, sample] of samples.entries()) {
    const label     = `[${index + 1}/${samples.length}]`;
    const sampleDir = path.join(OUT_DIR, `sample-${sample.id}`);
    fs.mkdirSync(sampleDir, { recursive: true });

    console.log(`${label} ${sample.topic}`);
    console.log(`  ID      : ${sample.id}`);
    console.log(`  Hook    : ${(sample.short_selected_hook ?? "—").slice(0, 100)}`);
    console.log(`  Exp now : experimentId=${sample.experiment_id ?? "null"}  variant=${sample.experiment_variant ?? "null"}`);
    console.log(`  ThumbTxt: ${sample.thumbnail_text ? `"${sample.thumbnail_text}"` : "null"}`);

    const cover = generateShortCover({
      topic: sample.topic,
      selectedHook: sample.short_selected_hook,
      script: sample.short_content ?? sample.script,
    });

    console.log(`  Cover   : "${cover.coverText}" | confidence=${cover.confidence}`);
    console.log(`  Reason  : ${cover.coverReason}`);

    const { decision: writePlan, skippedReason } = planDbWrite(sample, overwriteThumbnail);

    if (dryRun) {
      const planLines = [
        `thumbnailText=${writePlan.thumbnailText ? "WRITE" : `SKIP (${skippedReason.thumbnailText})`}`,
        `experimentId=${writePlan.experimentId ? `WRITE "${EXPERIMENT_ID}"` : `SKIP (${skippedReason.experimentId})`}`,
        `experimentVariant=${writePlan.experimentVariant ? `WRITE "${EXPERIMENT_VARIANT}"` : `SKIP (${skippedReason.experimentVariant})`}`,
      ];
      console.log(`  [dry-run] DB plan:`);
      for (const line of planLines) console.log(`    ${line}`);
      console.log(`  [dry-run] DB write timing: after_successful_render (skipped — dry-run)\n`);

      results.push({
        contentId: sample.id, topic: sample.topic, selectedHook: sample.short_selected_hook,
        coverText: cover.coverText, coverReason: cover.coverReason, coverConfidence: cover.confidence,
        experimentId: sample.experiment_id, experimentVariant: sample.experiment_variant,
        introEnabled: true, introDurationSec, fadeOutSec,
        coverAssetPath: "", outputVideoPath: "", outputFramePaths: null,
        durationSec: 0, audioDurationSec: 0, audioVideoDeltaSec: 0,
        subtitleHealthScore: 0, subtitleStatus: "—", firstFrameSimilarity: null,
        renderStatus: "skipped_dry_run", publishQueueStatus: "not_queued",
        dbWrite: writePlan, dbWriteSkippedReason: skippedReason,
        dbWriteTiming: "skipped_dry_run", visualIssues: [],
      });
      continue;
    }

    // ── Cover asset generation ────────────────────────────────────
    let coverAsset;
    try {
      coverAsset = await generateShortCoverAsset({
        contentId: sample.id,
        topic: sample.topic,
        hookOrScriptExcerpt: sample.short_selected_hook ?? sample.short_content ?? sample.script,
        sourceImagePath: sample.image_paths?.[0] ?? null,
        coverText: cover.coverText,
        layoutPreset: "short_cover_hook",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ Cover asset failed: ${msg}\n`);
      results.push({
        contentId: sample.id, topic: sample.topic, selectedHook: sample.short_selected_hook,
        coverText: cover.coverText, coverReason: cover.coverReason, coverConfidence: cover.confidence,
        experimentId: sample.experiment_id, experimentVariant: sample.experiment_variant,
        introEnabled: true, introDurationSec, fadeOutSec,
        coverAssetPath: "", outputVideoPath: "", outputFramePaths: null,
        durationSec: 0, audioDurationSec: 0, audioVideoDeltaSec: 0,
        subtitleHealthScore: 0, subtitleStatus: "FAIL", firstFrameSimilarity: null,
        renderStatus: "failed", publishQueueStatus: "not_queued",
        dbWrite: null, dbWriteSkippedReason: null, dbWriteTiming: "skipped_render_failed",
        visualIssues: ["cover_asset_failed"], error: msg,
      });
      continue;
    }

    const coverDestPath = path.join(sampleDir, "cover-asset.jpg");
    fs.copyFileSync(coverAsset.outputPath, coverDestPath);

    // ── Render ────────────────────────────────────────────────────
    console.log(`  Rendering...`);
    const renderResult = await runShortVideo(sample.id, false);
    if (!renderResult.success) {
      console.error(`  ✗ Render failed: ${renderResult.error}\n`);
      results.push({
        contentId: sample.id, topic: sample.topic, selectedHook: sample.short_selected_hook,
        coverText: cover.coverText, coverReason: cover.coverReason, coverConfidence: cover.confidence,
        experimentId: sample.experiment_id, experimentVariant: sample.experiment_variant,
        introEnabled: true, introDurationSec, fadeOutSec,
        coverAssetPath: coverDestPath, outputVideoPath: "", outputFramePaths: null,
        durationSec: 0, audioDurationSec: 0, audioVideoDeltaSec: 0,
        subtitleHealthScore: 0, subtitleStatus: "FAIL", firstFrameSimilarity: null,
        renderStatus: "failed", publishQueueStatus: "not_queued",
        dbWrite: null, dbWriteSkippedReason: null, dbWriteTiming: "skipped_render_failed",
        visualIssues: ["render_failed"], error: renderResult.error,
      });
      continue;
    }

    const videoSrcPath  = resolveProjectPath(renderResult.videoPath);
    const videoDestPath = path.join(sampleDir, "video-preview.mp4");
    fs.copyFileSync(videoSrcPath, videoDestPath);

    // ── Frame extraction ──────────────────────────────────────────
    const frameFirst = path.join(sampleDir, "frame-first.jpg");
    const frameMid   = path.join(sampleDir, "frame-mid-intro.jpg");
    const framePost  = path.join(sampleDir, "frame-post-intro.jpg");
    let framesOk = false;
    try {
      await Promise.all([
        extractFrame(videoDestPath, frameFirst, 0.05),
        extractFrame(videoDestPath, frameMid,   0.75),
        extractFrame(videoDestPath, framePost,  1.70),
      ]);
      framesOk = true;
    } catch (e) {
      console.warn(`  ⚠ Frame extraction partial/failed: ${e instanceof Error ? e.message : e}`);
    }

    // ── Verification ──────────────────────────────────────────────
    const [audioDurationSec, videoDurationSec] = await Promise.all([
      getMediaDurationSec(resolveProjectPath(sample.audio_path!)),
      getMediaDurationSec(videoDestPath),
    ]);
    const effectiveAudioSec  = Math.min(audioDurationSec, 60);
    const audioVideoDeltaSec = Number((videoDurationSec - effectiveAudioSec).toFixed(3));

    let firstFrameSimilarity: number | null = null;
    try {
      if (framesOk) {
        firstFrameSimilarity = Number(
          (await computeImageSimilarity(coverAsset.outputPath, frameFirst)).toFixed(4)
        );
      }
    } catch { /* non-fatal */ }

    const visualIssues: string[] = [];
    if (firstFrameSimilarity !== null && firstFrameSimilarity < 0.90) visualIssues.push("first_frame_cover_match_low");
    if (Math.abs(audioVideoDeltaSec) > DELTA_THRESHOLD_SEC) visualIssues.push("duration_delta_unexpected");
    if (renderResult.subtitleStatus !== "PASS")  visualIssues.push("subtitle_status_fail");
    if (renderResult.subtitleHealthScore < 90)   visualIssues.push("subtitle_health_below_90");
    if (!framesOk) visualIssues.push("frame_extraction_failed");

    // ── DB write gate ─────────────────────────────────────────────
    // Write only when render is confirmed good: video on disk, frames extracted,
    // subtitle passes, and duration delta is within tolerance.
    const videoExists         = fs.existsSync(videoDestPath);
    const subtitleOk          = renderResult.subtitleStatus === "PASS" && renderResult.subtitleHealthScore >= 90;
    const deltaOk             = Math.abs(audioVideoDeltaSec) <= DELTA_THRESHOLD_SEC;
    const verificationPassed  = videoExists && framesOk && subtitleOk && deltaOk;

    let dbWriteResult: DbWriteDecision | null = null;
    let dbWriteTiming: BatchResult["dbWriteTiming"] = null;

    if (verificationPassed) {
      await executeDbWrite(sample.id, coverAsset.coverText, writePlan);
      dbWriteResult = writePlan;
      dbWriteTiming = "after_successful_render";
      const writtenFields = Object.entries(writePlan)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ") || "none";
      console.log(`  DB write (after verification): wrote=[${writtenFields}]`);
    } else {
      dbWriteTiming = "skipped_verification_failed";
      const failReasons = [
        !videoExists   && "video_not_on_disk",
        !framesOk      && "frames_failed",
        !subtitleOk    && `subtitle_${renderResult.subtitleStatus}_${renderResult.subtitleHealthScore}`,
        !deltaOk       && `delta_${audioVideoDeltaSec}s`,
      ].filter(Boolean);
      console.warn(`  ⚠ DB write skipped (verification failed): ${failReasons.join(", ")}`);
    }

    const fileSizeKb = Math.round(fs.statSync(videoDestPath).size / 1024);
    const passIcon   = visualIssues.length === 0 ? "✅" : "⚠";

    console.log(`  ${passIcon} video=${videoDurationSec.toFixed(2)}s  audio(eff)=${effectiveAudioSec.toFixed(2)}s  delta=${audioVideoDeltaSec}s  size=${fileSizeKb}KB`);
    console.log(`     cover-sim=${firstFrameSimilarity ?? "N/A"}  subtitle=${renderResult.subtitleStatus} ${renderResult.subtitleHealthScore}/100`);
    if (visualIssues.length > 0) console.log(`     issues: ${visualIssues.join(", ")}`);
    console.log();

    results.push({
      contentId: sample.id,
      topic: sample.topic,
      selectedHook: sample.short_selected_hook,
      coverText: coverAsset.coverText,
      coverReason: cover.coverReason,
      coverConfidence: cover.confidence,
      experimentId: (dbWriteResult?.experimentId) ? EXPERIMENT_ID : sample.experiment_id,
      experimentVariant: (dbWriteResult?.experimentVariant) ? EXPERIMENT_VARIANT : sample.experiment_variant,
      introEnabled: true,
      introDurationSec,
      fadeOutSec,
      coverAssetPath: coverDestPath,
      outputVideoPath: videoDestPath,
      outputFramePaths: framesOk ? { first: frameFirst, midIntro: frameMid, postIntro: framePost } : null,
      durationSec: Number(videoDurationSec.toFixed(3)),
      audioDurationSec: Number(effectiveAudioSec.toFixed(3)),
      audioVideoDeltaSec,
      subtitleHealthScore: renderResult.subtitleHealthScore,
      subtitleStatus: renderResult.subtitleStatus,
      firstFrameSimilarity,
      renderStatus: "success",
      publishQueueStatus: "not_queued",
      dbWrite: dbWriteResult,
      dbWriteSkippedReason: dbWriteResult ? skippedReason : null,
      dbWriteTiming,
      visualIssues,
    });
  }

  const passed  = results.filter((r) => r.renderStatus === "success" && r.visualIssues.length === 0).length;
  const warned  = results.filter((r) => r.renderStatus === "success" && r.visualIssues.length > 0).length;
  const failed  = results.filter((r) => r.renderStatus === "failed").length;
  const skipped = results.filter((r) => r.renderStatus === "skipped_dry_run").length;

  const report = {
    generatedAt: new Date().toISOString(),
    mode: dryRun ? "dry-run" : "render",
    featureFlags: {
      SHORT_COVER_INTRO_ENABLED: true,
      SHORT_COVER_DURATION_SEC: introDurationSec,
      SHORT_COVER_FADE_OUT_SEC: fadeOutSec,
    },
    experiment: { id: EXPERIMENT_ID, variant: EXPERIMENT_VARIANT },
    batch: { requested: limit, processed: results.length, passed, warned, failed, skipped },
    publishQueueStatus: "not_queued — render only, no upload",
    dbTracking: {
      timing: "after_successful_render",
      guards: ["render_success", "video_exists_on_disk", "frames_extracted", "subtitle_PASS", `delta_lte_${DELTA_THRESHOLD_SEC}s`],
      thumbnailText: "write if null/empty; skip if already set (unless --overwrite-thumbnail-text)",
      experimentId: "write if null; never overwrite existing",
      experimentVariant: "write if null; never overwrite existing",
    },
    fallbackNote: fallbackNoteCapture,
    outputDir: OUT_DIR,
    results,
  };

  const reportPath = path.join(OUT_DIR, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log("═══════════════════════════════════════════════════════════════");
  if (dryRun) {
    console.log(`  Dry-run complete: ${skipped} items scanned — no render, no DB write`);
  } else {
    console.log(`  Batch complete: ${passed} pass / ${warned} warn / ${failed} fail`);
  }
  console.log(`  Report: ${reportPath}`);
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Rollback: unset SHORT_COVER_INTRO_ENABLED in .env.local");
  console.log("Intro is OFF in production until explicitly enabled.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
