/**
 * Limited rollout: generates 5 new shorts with SHORT_COVER_INTRO_ENABLED=true,
 * verifies experiment tracking per item, and writes a full report.
 *
 * - Sets SHORT_COVER_INTRO_ENABLED=true for THIS PROCESS ONLY (no .env.local change)
 * - Calls content_gen scheduler job 5 times → 5 new items
 * - For each: runTTS → runImages → runShortVideo (skips autoScheduleVideoAction)
 * - After render: verifies experimentId/experimentVariant/thumbnailText written
 * - Extracts 3 frames per item for visual inspection
 * - Stops after TARGET_COUNT items regardless of outcome
 * - Writes report to output/short-cover-intro-limited-rollout/report.json
 *
 * Constraints enforced:
 * - HOOK/HOOK_V2 rows not touched (only newly generated items processed)
 * - No publish, no upload queue
 * - No global env change (process-local only)
 * - Max TARGET_COUNT items
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runSchedulerJobAction } from "@/actions/content-generator";
import { runTTS } from "@/lib/pipeline/tts";
import { runImages } from "@/lib/pipeline/images";
import { runShortVideo } from "@/lib/pipeline/short-video";

const execFileAsync = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH = ffmpegInstaller.path;

// ── Process-local env flags ─────────────────────────────────────────────────
process.env.SHORT_COVER_INTRO_ENABLED = "true";
process.env.SHORT_COVER_DURATION_SEC  = "1.5";
process.env.SHORT_COVER_FADE_OUT_SEC  = "0.25";

const TARGET_COUNT    = 5;
const GEN_JOB_ID      = "9e3670f1-eecc-4252-b47b-9e33081ad408"; // content_gen / Phật Pháp
const CWD             = process.cwd();
const OUT_DIR         = path.join(CWD, "output", "short-cover-intro-limited-rollout");
const REPORT_PATH     = path.join(OUT_DIR, "report.json");
const EXPERIMENT_ID   = "short-cover-intro-v1";
const EXPERIMENT_VAR  = "intro_on_1p5s";

type ItemReport = {
  contentId: string;
  topic: string | null;
  selectedHook: string | null;
  genResult: "ok" | "failed" | "skipped";
  ttsResult: "ok" | "failed" | "skipped";
  imagesResult: "ok" | "failed" | "skipped";
  videoResult: "ok" | "failed";
  thumbnailText: string | null;
  experimentId: string | null;
  experimentVariant: string | null;
  trackingPass: boolean;
  trackingDetail: {
    thumbnailTextWritten: boolean;
    experimentIdWritten: boolean;
    experimentVariantWritten: boolean;
  };
  videoPath: string | null;
  framePaths: { first: string | null; midIntro: string | null; postIntro: string | null };
  subtitleStatus: string | null;
  subtitleHealthScore: number | null;
  audioVideoDeltaSec: number | null;
  publishQueueStatus: "not_queued";
  error?: string;
};

async function extractFrame(videoAbsPath: string, timeSec: number, outAbsPath: string): Promise<boolean> {
  try {
    await execFileAsync(FFMPEG_PATH, [
      "-y", "-ss", timeSec.toFixed(2), "-i", videoAbsPath,
      "-vframes", "1", "-q:v", "2", outAbsPath,
    ], { timeout: 20_000 });
    return fs.existsSync(outAbsPath);
  } catch {
    return false;
  }
}

async function getMediaDurationSec(absPath: string): Promise<number | null> {
  try {
    const r = await execFileAsync(FFMPEG_PATH, ["-i", absPath, "-f", "null", "-"], { timeout: 20_000 })
      .catch((e: { stderr: string }) => ({ stderr: e.stderr }));
    const m = (r as { stderr: string }).stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (!m) return null;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
  } catch {
    return null;
  }
}

async function readDbRow(contentId: string) {
  return db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const startTime = new Date();
  const items: ItemReport[] = [];

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  run-short-cover-intro-limited-rollout");
  console.log("  SHORT_COVER_INTRO_ENABLED=true (process-local only)");
  console.log(`  Target: ${TARGET_COUNT} items | Job: ${GEN_JOB_ID}`);
  console.log("══════════════════════════════════════════════════════════════\n");

  // ── Phase 1: Generate TARGET_COUNT new content items ─────────────────────
  const generatedIds: string[] = [];

  for (let i = 0; i < TARGET_COUNT; i++) {
    console.log(`[gen ${i + 1}/${TARGET_COUNT}] Calling content_gen job...`);
    try {
      const result = await runSchedulerJobAction(GEN_JOB_ID);

      if ("error" in result) {
        console.error(`  ✗ Job error: ${result.error}`);
        items.push({
          contentId: `gen-failed-${i}`, topic: null, selectedHook: null,
          genResult: "failed", ttsResult: "skipped", imagesResult: "skipped", videoResult: "failed",
          thumbnailText: null, experimentId: null, experimentVariant: null,
          trackingPass: false, trackingDetail: { thumbnailTextWritten: false, experimentIdWritten: false, experimentVariantWritten: false },
          videoPath: null, framePaths: { first: null, midIntro: null, postIntro: null },
          subtitleStatus: null, subtitleHealthScore: null, audioVideoDeltaSec: null,
          publishQueueStatus: "not_queued", error: result.error,
        });
        continue;
      }

      if ("skipped" in result && result.skipped) {
        const reason = result.reason ?? "backpressure";
        console.warn(`  ⊘ Skipped: ${reason}`);
        items.push({
          contentId: `gen-skipped-${i}`, topic: null, selectedHook: null,
          genResult: "skipped", ttsResult: "skipped", imagesResult: "skipped", videoResult: "failed",
          thumbnailText: null, experimentId: null, experimentVariant: null,
          trackingPass: false, trackingDetail: { thumbnailTextWritten: false, experimentIdWritten: false, experimentVariantWritten: false },
          videoPath: null, framePaths: { first: null, midIntro: null, postIntro: null },
          subtitleStatus: null, subtitleHealthScore: null, audioVideoDeltaSec: null,
          publishQueueStatus: "not_queued", error: `skipped:${reason}`,
        });
        continue;
      }

      if ("generationId" in result && result.generationId) {
        // Stamp intro experiment IDs immediately on the new row, before any rendering.
        // This happens here (not inside runShortVideo) so that runShortVideo's null-guard
        // finds them already set and skips the experiment-field write, keeping production
        // rendering logic free of rollout-specific overwrite behavior.
        await db.update(contentGenerations)
          .set({
            experimentId:      EXPERIMENT_ID,
            experimentVariant: EXPERIMENT_VAR,
          })
          .where(eq(contentGenerations.id, result.generationId));
        console.log(`  ✓ Created: ${result.generationId} — "${result.topic}" (stamped ${EXPERIMENT_ID}/${EXPERIMENT_VAR})`);
        generatedIds.push(result.generationId);
      } else {
        console.warn("  ✗ No generationId in result:", JSON.stringify(result));
        items.push({
          contentId: `gen-noid-${i}`, topic: null, selectedHook: null,
          genResult: "failed", ttsResult: "skipped", imagesResult: "skipped", videoResult: "failed",
          thumbnailText: null, experimentId: null, experimentVariant: null,
          trackingPass: false, trackingDetail: { thumbnailTextWritten: false, experimentIdWritten: false, experimentVariantWritten: false },
          videoPath: null, framePaths: { first: null, midIntro: null, postIntro: null },
          subtitleStatus: null, subtitleHealthScore: null, audioVideoDeltaSec: null,
          publishQueueStatus: "not_queued", error: "no_generationId",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Exception: ${msg}`);
      items.push({
        contentId: `gen-exc-${i}`, topic: null, selectedHook: null,
        genResult: "failed", ttsResult: "skipped", imagesResult: "skipped", videoResult: "failed",
        thumbnailText: null, experimentId: null, experimentVariant: null,
        trackingPass: false, trackingDetail: { thumbnailTextWritten: false, experimentIdWritten: false, experimentVariantWritten: false },
        videoPath: null, framePaths: { first: null, midIntro: null, postIntro: null },
        subtitleStatus: null, subtitleHealthScore: null, audioVideoDeltaSec: null,
        publishQueueStatus: "not_queued", error: msg,
      });
    }
  }

  console.log(`\n[pipeline] Generated ${generatedIds.length} items. Starting TTS → images → video...\n`);

  // ── Phase 2: Run TTS → images → video for each new item ─────────────────
  for (const contentId of generatedIds) {
    const itemReport: ItemReport = {
      contentId, topic: null, selectedHook: null,
      genResult: "ok", ttsResult: "skipped", imagesResult: "skipped", videoResult: "failed",
      thumbnailText: null, experimentId: null, experimentVariant: null,
      trackingPass: false, trackingDetail: { thumbnailTextWritten: false, experimentIdWritten: false, experimentVariantWritten: false },
      videoPath: null, framePaths: { first: null, midIntro: null, postIntro: null },
      subtitleStatus: null, subtitleHealthScore: null, audioVideoDeltaSec: null,
      publishQueueStatus: "not_queued",
    };

    console.log(`\n── ${contentId.slice(0, 8)} ─────────────────────────────────`);

    try {
      // Read initial state
      const row = await readDbRow(contentId);
      if (!row) {
        itemReport.error = "row_not_found_after_gen";
        items.push(itemReport);
        continue;
      }
      itemReport.topic       = row.topic;
      itemReport.selectedHook = row.shortSelectedHook ?? null;
      console.log(`    topic: "${row.topic}"`);
      console.log(`    ttsStatus=${row.ttsStatus}  imagesStatus=${row.imagesStatus}  videoStatus=${row.videoStatus}`);

      // TTS
      if (row.ttsStatus !== "done") {
        console.log(`    [tts] Running...`);
        const tts = await runTTS(contentId, "short", null);
        if (!tts.success) {
          itemReport.ttsResult = "failed";
          itemReport.error     = `tts: ${tts.error}`;
          console.error(`    [tts] FAILED: ${tts.error}`);
          items.push(itemReport);
          continue;
        }
        itemReport.ttsResult = "ok";
        console.log(`    [tts] OK`);
      } else {
        itemReport.ttsResult = "skipped";
        console.log(`    [tts] already done, skip`);
      }

      // Images
      const rowAfterTts = await readDbRow(contentId);
      if (!rowAfterTts) {
        itemReport.error = "row_not_found_after_tts";
        items.push(itemReport);
        continue;
      }

      if (rowAfterTts.imagesStatus !== "done") {
        console.log(`    [images] Running...`);
        const imgs = await runImages(contentId, null, null);
        if (!imgs.success) {
          itemReport.imagesResult = "failed";
          itemReport.error        = `images: ${imgs.error}`;
          console.error(`    [images] FAILED: ${imgs.error}`);
          items.push(itemReport);
          continue;
        }
        itemReport.imagesResult = "ok";
        console.log(`    [images] OK (${imgs.imagePaths?.length ?? 0} images)`);
      } else {
        itemReport.imagesResult = "skipped";
        console.log(`    [images] already done, skip`);
      }

      // Video (cover intro applied via process.env.SHORT_COVER_INTRO_ENABLED=true)
      console.log(`    [video] Running runShortVideo with cover intro...`);
      const vid = await runShortVideo(contentId);

      if (!vid.success) {
        itemReport.videoResult = "failed";
        itemReport.error       = `video: ${vid.error}`;
        console.error(`    [video] FAILED: ${vid.error}`);
        items.push(itemReport);
        continue;
      }

      itemReport.videoResult        = "ok";
      itemReport.videoPath          = vid.videoPath;
      itemReport.subtitleStatus     = vid.subtitleStatus ?? null;
      itemReport.subtitleHealthScore = vid.subtitleHealthScore ?? null;
      console.log(`    [video] OK — subtitle=${vid.subtitleStatus} (${vid.subtitleHealthScore}/100)`);
      console.log(`             path: ${vid.videoPath}`);

      // Audio/video delta
      const videoAbsPath = path.join(CWD, vid.videoPath);
      const rowAfterVideo = await readDbRow(contentId);
      const audioAbsPath  = rowAfterVideo?.audioPath ? path.join(CWD, rowAfterVideo.audioPath) : null;
      const videoDur = await getMediaDurationSec(videoAbsPath);
      const audioDur = audioAbsPath ? await getMediaDurationSec(audioAbsPath) : null;
      const effectiveAudio = audioDur != null ? Math.min(audioDur, 60) : null;
      itemReport.audioVideoDeltaSec = (videoDur != null && effectiveAudio != null)
        ? parseFloat(Math.abs(videoDur - effectiveAudio).toFixed(3))
        : null;
      console.log(`    [delta] video=${videoDur?.toFixed(2)}s  audio=${effectiveAudio?.toFixed(2)}s  delta=${itemReport.audioVideoDeltaSec ?? "n/a"}s`);

      // Extract 3 frames
      const frameDir     = OUT_DIR;
      const frameFirst   = path.join(frameDir, `${contentId.slice(0, 8)}-frame-first.jpg`);
      const frameMid     = path.join(frameDir, `${contentId.slice(0, 8)}-frame-mid-intro.jpg`);
      const framePost    = path.join(frameDir, `${contentId.slice(0, 8)}-frame-post-intro.jpg`);
      const [f1, f2, f3] = await Promise.all([
        extractFrame(videoAbsPath, 0.05, frameFirst),
        extractFrame(videoAbsPath, 0.75, frameMid),
        extractFrame(videoAbsPath, 1.70, framePost),
      ]);
      itemReport.framePaths = {
        first:     f1 ? frameFirst  : null,
        midIntro:  f2 ? frameMid    : null,
        postIntro: f3 ? framePost   : null,
      };
      console.log(`    [frames] first=${f1}  midIntro=${f2}  postIntro=${f3}`);

      // Read DB after render — verify tracking
      const dbAfter = await readDbRow(contentId);
      itemReport.thumbnailText    = dbAfter?.thumbnailText    ?? null;
      itemReport.experimentId     = dbAfter?.experimentId     ?? null;
      itemReport.experimentVariant = dbAfter?.experimentVariant ?? null;

      const thumbOk  = !!itemReport.thumbnailText?.trim();
      const expIdOk  = itemReport.experimentId === EXPERIMENT_ID;
      const expVarOk = itemReport.experimentVariant === EXPERIMENT_VAR;

      itemReport.trackingDetail = {
        thumbnailTextWritten:     thumbOk,
        experimentIdWritten:      expIdOk,
        experimentVariantWritten: expVarOk,
      };
      itemReport.trackingPass = thumbOk && expIdOk && expVarOk;

      if (itemReport.trackingPass) {
        console.log(`    [track] ✓ PASS — thumbnailText="${itemReport.thumbnailText}"  expId="${itemReport.experimentId}"  expVar="${itemReport.experimentVariant}"`);
      } else {
        console.log(`    [track] ✗ FAIL`);
        if (!thumbOk)  console.log(`             thumbnailText: "${itemReport.thumbnailText ?? "null"}"`);
        if (!expIdOk)  console.log(`             experimentId: "${itemReport.experimentId ?? "null"}" (expected "${EXPERIMENT_ID}")`);
        if (!expVarOk) console.log(`             experimentVariant: "${itemReport.experimentVariant ?? "null"}" (expected "${EXPERIMENT_VAR}")`);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      itemReport.error = msg;
      console.error(`    [error] ${msg}`);
    }

    items.push(itemReport);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const endTime = new Date();
  const totalRendered = items.filter((i) => i.videoResult === "ok").length;
  const trackingPass  = items.filter((i) => i.trackingPass).length;
  const genFailed     = items.filter((i) => i.genResult !== "ok").length;
  const videoFailed   = items.filter((i) => i.genResult === "ok" && i.videoResult === "failed").length;

  const report = {
    runAt:             startTime.toISOString(),
    finishedAt:        endTime.toISOString(),
    durationSec:       Math.round((endTime.getTime() - startTime.getTime()) / 1000),
    config: {
      SHORT_COVER_INTRO_ENABLED: "true",
      SHORT_COVER_DURATION_SEC:  "1.5",
      SHORT_COVER_FADE_OUT_SEC:  "0.25",
    },
    summary: {
      targetCount:      TARGET_COUNT,
      generated:        generatedIds.length,
      rendered:         totalRendered,
      trackingPass,
      genFailed,
      videoFailed,
      overallPass:      trackingPass === Math.min(generatedIds.length, TARGET_COUNT) && genFailed === 0,
    },
    items,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  console.log("\n══ SUMMARY ══════════════════════════════════════════════════");
  console.log(`Generated: ${generatedIds.length}/${TARGET_COUNT}`);
  console.log(`Rendered:  ${totalRendered}`);
  console.log(`Tracking PASS: ${trackingPass}/${totalRendered}`);
  console.log(`Gen failed: ${genFailed}  Video failed: ${videoFailed}`);
  console.log(`\nReport: ${REPORT_PATH}`);
  console.log(`════════════════════════════════════════════════════════════\n`);

  if (trackingPass < totalRendered || genFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
