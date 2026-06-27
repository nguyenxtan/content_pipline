/**
 * Cold-start verify: confirm that runShortVideo() writes experiment tracking fields
 * when SHORT_COVER_INTRO_ENABLED=true on a row with null experiment fields.
 *
 * Steps:
 *  1. Find a source row whose audio + images exist on disk.
 *  2. Insert a synthetic test row pointing to those assets (experimentId/Variant/thumbnailText all NULL).
 *  3. Force SHORT_COVER_INTRO_ENABLED=true for this process.
 *  4. Call runShortVideo(testId).
 *  5. Extract 3 frames from the output video.
 *  6. Read DB after render — confirm all three tracking fields are written.
 *  7. Delete the test row from DB (cleanup).
 *  8. Write report to output/short-cover-intro-cold-start/report.json.
 *
 * No publish. No queue. No global env change.
 * Controlled: exactly one test row created and deleted within this script.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import pg from "pg";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runShortVideo } from "@/lib/pipeline/short-video";
import { generateShortCover } from "@/lib/short-cover-engine";

const execFileAsync = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH = ffmpegInstaller.path;

const { Pool } = pg;
const CWD      = process.cwd();
const OUT_DIR  = path.join(CWD, "output", "short-cover-intro-cold-start");
const REPORT   = path.join(OUT_DIR, "report.json");

// Force cover intro on for this process only — does not touch .env.local or any file.
process.env.SHORT_COVER_INTRO_ENABLED  = "true";
process.env.SHORT_COVER_DURATION_SEC   = "1.5";
process.env.SHORT_COVER_FADE_OUT_SEC   = "0.25";

type SourceRow = {
  id: string;
  topic: string;
  niche_id: number;
  niche_name: string;
  short_content: string;
  script: string;
  short_selected_hook: string | null;
  audio_path: string;
  image_paths: string[];
};

type DbState = {
  thumbnailText: string | null;
  experimentId: string | null;
  experimentVariant: string | null;
  videoStatus: string | null;
  videoPath: string | null;
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

async function readDbState(contentId: string): Promise<DbState | null> {
  const row = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
  if (!row) return null;
  return {
    thumbnailText:    row.thumbnailText    ?? null,
    experimentId:     row.experimentId     ?? null,
    experimentVariant: row.experimentVariant ?? null,
    videoStatus:      row.videoStatus      ?? null,
    videoPath:        row.videoPath        ?? null,
  };
}

async function findSourceRow(pool: pg.Pool): Promise<SourceRow | null> {
  const { rows } = await pool.query<SourceRow & { image_paths: string[] }>(`
    SELECT cg.id, cg.topic, cg.niche_id, n.name AS niche_name,
           cg.short_content, cg.script, cg.short_selected_hook,
           cg.audio_path, cg.image_paths
    FROM content_generations cg
    JOIN niches n ON n.id = cg.niche_id
    WHERE cg.audio_path IS NOT NULL
      AND cg.image_paths IS NOT NULL
      AND cg.image_paths::text NOT IN ('null','[]')
      AND cg.content_mode IN ('short','both')
    ORDER BY cg.created_at DESC
    LIMIT 30
  `);

  for (const row of rows) {
    const audioOk = fs.existsSync(path.join(CWD, row.audio_path));
    const imgs: string[] = Array.isArray(row.image_paths) ? row.image_paths : [];
    const imgOk  = imgs.length > 0 && fs.existsSync(path.join(CWD, imgs[0]));
    if (audioOk && imgOk) {
      return { ...row, image_paths: imgs };
    }
  }
  return null;
}

async function insertTestRow(pool: pg.Pool, testId: string, src: SourceRow): Promise<void> {
  await pool.query(`
    INSERT INTO content_generations
      (id, topic, niche_id, niche_name, content_profile_key, channel_key,
       script, short_content, long_content, audio_path, image_paths,
       short_selected_hook, tts_status, images_status, video_status,
       experiment_id, experiment_variant, thumbnail_text, status)
    VALUES
      ($1, $2, $3, $4, 'buddhism', 'phat_phap',
       $5, $6, '', $7, $8::jsonb,
       $9, 'done', 'done', 'pending',
       NULL, NULL, NULL, 'completed')
  `, [
    testId,
    `[COLD-START TEST] ${src.topic}`,
    src.niche_id,
    src.niche_name,
    src.script || "",
    src.short_content || "",
    src.audio_path,
    JSON.stringify(src.image_paths),
    src.short_selected_hook ?? null,
  ]);
}

async function deleteTestRow(pool: pg.Pool, testId: string): Promise<void> {
  await pool.query("DELETE FROM content_generations WHERE id = $1", [testId]);
}

async function deleteOutputFiles(testId: string): Promise<void> {
  const videoPath = path.join(CWD, "media", "videos", `${testId}-short.mp4`);
  const thumbPath = path.join(CWD, "media", "videos", `${testId}-short-thumb.jpg`);
  const metaPath  = path.join(CWD, "media", "videos", `${testId}-short-subtitle-meta.json`);
  for (const p of [videoPath, thumbPath, metaPath]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }
  // Remove cover asset if any
  const coverDir = path.join(CWD, "media", "covers");
  if (fs.existsSync(coverDir)) {
    for (const f of fs.readdirSync(coverDir)) {
      if (f.startsWith(testId)) {
        try { fs.unlinkSync(path.join(coverDir, f)); } catch { /* ignore */ }
      }
    }
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const testId = `test-${crypto.randomUUID()}`;

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  verify-short-cover-intro-cold-start");
  console.log("  SHORT_COVER_INTRO_ENABLED=true (process-local only)");
  console.log(`  Test row ID: ${testId}`);
  console.log("═══════════════════════════════════════════════════════\n");

  const report: Record<string, unknown> = {
    testId,
    publishQueueStatus: "not_queued",
    trackingPass: false,
  };

  let testRowInserted = false;

  try {
    // ── 1. Find source row ───────────────────────────────────────
    const src = await findSourceRow(pool);
    if (!src) throw new Error("No source row with audio+images on disk found.");

    console.log(`[source] ${src.id.slice(0,8)} — ${src.topic}`);
    console.log(`         audio: ${src.audio_path}`);
    console.log(`         img:   ${src.image_paths[0]}`);

    // ── 2. Compute expected coverText ────────────────────────────
    const cover = generateShortCover({
      topic: src.topic,
      selectedHook: src.short_selected_hook,
      script: src.short_content || src.script,
    });
    report.coverText       = cover.coverText;
    report.coverReason     = cover.coverReason;
    report.coverConfidence = cover.confidence;
    console.log(`[cover]  "${cover.coverText}" (confidence=${cover.confidence})`);

    // ── 3. Insert test row ───────────────────────────────────────
    await insertTestRow(pool, testId, src);
    testRowInserted = true;
    console.log(`[insert] Test row created: ${testId}`);

    // ── 4. Read DB BEFORE render ─────────────────────────────────
    const dbBefore = await readDbState(testId);
    if (!dbBefore) throw new Error("Could not read test row from DB after insert");
    report.dbBefore = dbBefore;
    console.log(`[before] thumbnailText=${dbBefore.thumbnailText ?? "null"} experimentId=${dbBefore.experimentId ?? "null"} experimentVariant=${dbBefore.experimentVariant ?? "null"}`);

    if (dbBefore.experimentId !== null || dbBefore.experimentVariant !== null || (dbBefore.thumbnailText?.trim())) {
      throw new Error(`Test row is not clean before render: ${JSON.stringify(dbBefore)}`);
    }

    // ── 5. Render ────────────────────────────────────────────────
    console.log(`[render] Running runShortVideo(${testId}) with cover intro...`);
    const renderResult = await runShortVideo(testId);
    report.renderResult = renderResult;

    if (!renderResult.success) {
      report.renderStatus = "failed";
      throw new Error(`Render failed: ${renderResult.error}`);
    }

    report.renderStatus        = "success";
    report.subtitleStatus      = renderResult.subtitleStatus;
    report.subtitleHealthScore = renderResult.subtitleHealthScore;
    const videoAbsPath = path.join(CWD, renderResult.videoPath);
    report.outputVideoPath = renderResult.videoPath;
    console.log(`[render] PASS — subtitle=${renderResult.subtitleStatus} (${renderResult.subtitleHealthScore}/100)`);
    console.log(`         video: ${renderResult.videoPath}`);

    // ── 6. Measure video/audio delta ─────────────────────────────
    const videoDurationSec = await getMediaDurationSec(videoAbsPath);
    const audioDurationSec = await getMediaDurationSec(path.join(CWD, src.audio_path));
    const effectiveAudioSec = audioDurationSec != null ? Math.min(audioDurationSec, 60) : null;
    const deltaRaw = (videoDurationSec != null && effectiveAudioSec != null)
      ? Math.abs(videoDurationSec - effectiveAudioSec)
      : null;
    report.videoDurationSec    = videoDurationSec;
    report.audioDurationSec    = audioDurationSec;
    report.audioVideoDeltaSec  = deltaRaw;
    console.log(`[delta]  video=${videoDurationSec?.toFixed(2)}s  audio=${effectiveAudioSec?.toFixed(2)}s  delta=${deltaRaw?.toFixed(3) ?? "n/a"}s`);

    // ── 7. Extract frames ────────────────────────────────────────
    const frameFirst   = path.join(OUT_DIR, `${testId}-frame-first.jpg`);
    const frameMid     = path.join(OUT_DIR, `${testId}-frame-mid-intro.jpg`);
    const framePost    = path.join(OUT_DIR, `${testId}-frame-post-intro.jpg`);
    const [f1, f2, f3] = await Promise.all([
      extractFrame(videoAbsPath, 0.05, frameFirst),
      extractFrame(videoAbsPath, 0.75, frameMid),
      extractFrame(videoAbsPath, 1.70, framePost),
    ]);
    const framePaths = {
      first:     f1 ? frameFirst    : null,
      midIntro:  f2 ? frameMid      : null,
      postIntro: f3 ? framePost     : null,
    };
    report.framePaths = framePaths;
    console.log(`[frames] first=${f1} midIntro=${f2} postIntro=${f3}`);

    // ── 8. Read DB AFTER render ──────────────────────────────────
    const dbAfter = await readDbState(testId);
    if (!dbAfter) throw new Error("Could not read test row from DB after render");
    report.dbAfter = dbAfter;
    console.log(`[after]  thumbnailText="${dbAfter.thumbnailText ?? "null"}"  experimentId="${dbAfter.experimentId ?? "null"}"  experimentVariant="${dbAfter.experimentVariant ?? "null"}"`);

    // ── 9. Verify tracking ───────────────────────────────────────
    const thumbOk    = dbAfter.thumbnailText != null && dbAfter.thumbnailText.trim() !== "";
    const expIdOk    = dbAfter.experimentId === "short-cover-intro-v1";
    const expVarOk   = dbAfter.experimentVariant === "intro_on_1p5s";
    const trackingPass = thumbOk && expIdOk && expVarOk;
    report.trackingPass = trackingPass;
    report.trackingDetail = {
      thumbnailTextWritten:    thumbOk,
      experimentIdWritten:     expIdOk,
      experimentVariantWritten: expVarOk,
      expectedExperimentId:    "short-cover-intro-v1",
      expectedExperimentVariant: "intro_on_1p5s",
    };

    if (trackingPass) {
      console.log(`[track]  ✓ PASS — all 3 fields written correctly`);
    } else {
      console.log(`[track]  ✗ FAIL`);
      if (!thumbOk)   console.log(`         thumbnailText: expected non-null, got "${dbAfter.thumbnailText}"`);
      if (!expIdOk)   console.log(`         experimentId: expected "short-cover-intro-v1", got "${dbAfter.experimentId}"`);
      if (!expVarOk)  console.log(`         experimentVariant: expected "intro_on_1p5s", got "${dbAfter.experimentVariant}"`);
    }

    // ── 10. Keep frame files, clean up render outputs + test row ─
    await deleteOutputFiles(testId);
    await deleteTestRow(pool, testId);
    testRowInserted = false;
    console.log(`[clean]  Test row deleted. Frame files kept in ${OUT_DIR}.`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.error = msg;
    console.error(`\n[ERROR] ${msg}\n`);
  } finally {
    // Ensure test row is always deleted even on failure
    if (testRowInserted) {
      try {
        await deleteTestRow(pool, testId);
        await deleteOutputFiles(testId);
        console.log(`[clean]  Test row cleaned up after error.`);
      } catch { /* ignore cleanup errors */ }
    }
    await pool.end();
  }

  // ── 11. Write report ─────────────────────────────────────────
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n[report] ${REPORT}`);

  const pass = report.trackingPass === true;
  console.log(`\n═══ ${pass ? "✓ COLD-START VERIFY PASSED" : "✗ COLD-START VERIFY FAILED"} ═══\n`);
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
