/**
 * Subtitle render QA script.
 *
 * Usage:
 *   # Check specific content IDs:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     --tsconfig tsconfig.json scripts/qa-subtitle-render.ts \
 *     8c0da12f 9839af14 1fcd2512
 *
 *   # Check recent N rendered shorts (default 20):
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     --tsconfig tsconfig.json scripts/qa-subtitle-render.ts --recent 10
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { inArray, eq, and, isNotNull, desc } from "drizzle-orm";
import {
  validateSubtitleRenderConfig,
  buildSubtitleRenderMetadata,
  SUBTITLE_RENDER_CONSTANTS,
  type SubtitleRenderMetadata,
} from "@/lib/video/subtitle";

const VIDEOS_DIR = path.join(process.cwd(), "media", "videos");

// ── Parse CLI arguments ────────────────────────────────────────
const args = process.argv.slice(2);
let recentN = 0;
const explicitIds: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--recent") {
    recentN = parseInt(args[i + 1] ?? "20", 10);
    i++;
  } else if (!args[i].startsWith("--")) {
    // Accept short-form IDs (8 chars) or full UUIDs
    explicitIds.push(args[i]);
  }
}

// ── Helpers ─────────────────────────────────────────────────────
function loadSidecarMeta(contentId: string): SubtitleRenderMetadata | null {
  const p = path.join(VIDEOS_DIR, `${contentId}-short-subtitle-meta.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as SubtitleRenderMetadata; }
  catch { return null; }
}

function inferMetaFromConfig(contentId: string, videoPath: string | null): SubtitleRenderMetadata {
  // No sidecar — build metadata from current config constants (reflects what the
  // current renderer would produce; pre-fix renders don't have sidecars).
  const videoExists = videoPath ? fs.existsSync(path.join(process.cwd(), videoPath)) : false;
  return buildSubtitleRenderMetadata({
    contentId,
    videoPath,
    subtitlePath: null,   // temp ASS is deleted after render
    marginV: SUBTITLE_RENDER_CONSTANTS.MARGIN_V,
    subtitleExists: videoExists, // proxy: video exists → subtitle was written during render
  });
}

/** Check if the video was rendered with OLD config (pre-fix) by looking at sidecar absence.
 *  Old renders: no sidecar file → we flag as "legacy, re-render recommended". */
function isLegacyRender(contentId: string): boolean {
  const p = path.join(VIDEOS_DIR, `${contentId}-short-subtitle-meta.json`);
  return !fs.existsSync(p);
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Subtitle Render QA");
  console.log("  Date:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");
  console.log("\n  Config constants:");
  console.log(`    PlayRes:        ${SUBTITLE_RENDER_CONSTANTS.RENDER_WIDTH}×${SUBTITLE_RENDER_CONSTANTS.RENDER_HEIGHT}`);
  console.log(`    Font:           ${SUBTITLE_RENDER_CONSTANTS.FONT_FAMILY} size ${SUBTITLE_RENDER_CONSTANTS.FONT_SIZE}`);
  console.log(`    MarginV:        ${SUBTITLE_RENDER_CONSTANTS.MARGIN_V}`);
  console.log(`    MaxWordsChunk:  ${SUBTITLE_RENDER_CONSTANTS.MAX_WORDS_PER_CHUNK}`);
  console.log(`    ScaleX/ScaleY:  ${SUBTITLE_RENDER_CONSTANTS.SCALE_X}/${SUBTITLE_RENDER_CONSTANTS.SCALE_Y}`);
  console.log(`    BurnStage:      ${SUBTITLE_RENDER_CONSTANTS.BURN_STAGE}`);
  console.log(`    LateScale:      ${SUBTITLE_RENDER_CONSTANTS.HAS_LATE_SCALE_AFTER_SUBTITLE}`);

  // ── Resolve target rows ─────────────────────────────────────
  let rows: Array<{
    id: string;
    topic: string | null;
    videoStatus: string | null;
    videoPath: string | null;
    createdAt: Date | null;
  }>;

  if (explicitIds.length > 0) {
    // Expand short IDs to full UUIDs if needed
    const allRows = await db.query.contentGenerations.findMany({
      where: eq(contentGenerations.channelKey, "phat_phap"),
      columns: { id: true, topic: true, videoStatus: true, videoPath: true, createdAt: true },
      orderBy: (t, { desc }) => desc(t.createdAt),
      limit: 500,
    });
    rows = allRows.filter(r =>
      explicitIds.some(id => r.id === id || r.id.startsWith(id))
    );
  } else if (recentN > 0) {
    rows = await db.query.contentGenerations.findMany({
      where: and(
        eq(contentGenerations.channelKey, "phat_phap"),
        isNotNull(contentGenerations.videoPath),
        eq(contentGenerations.videoStatus, "done"),
      ),
      columns: { id: true, topic: true, videoStatus: true, videoPath: true, createdAt: true },
      orderBy: (t, { desc }) => desc(t.createdAt),
      limit: recentN,
    });
  } else {
    // Default: sprint batch IDs
    const SPRINT_SHORT_IDS = [
      "8c0da12f", "9839af14", "1fcd2512", "fe2b62e4",
      "b9757a63", "8d9eb929", "957b26f5",
    ];
    const allRows = await db.query.contentGenerations.findMany({
      where: eq(contentGenerations.channelKey, "phat_phap"),
      columns: { id: true, topic: true, videoStatus: true, videoPath: true, createdAt: true },
      limit: 500,
    });
    rows = allRows.filter(r => SPRINT_SHORT_IDS.some(id => r.id.startsWith(id)));
  }

  if (rows.length === 0) {
    console.log("\n  No matching rows found.");
    return;
  }

  console.log(`\n  Checking ${rows.length} item(s)...\n`);

  // ── QA table ────────────────────────────────────────────────
  type QAResult = {
    id: string;
    topic: string | null;
    videoStatus: string | null;
    videoPath: string | null;
    subtitlePath: string | null;
    playRes: string;
    font: string;
    fontSize: number;
    marginV: number;
    burnStage: string;
    validation: "PASS" | "FAIL" | "LEGACY";
    errors: string[];
    legacy: boolean;
  };
  const results: QAResult[] = [];

  for (const row of rows) {
    const sidecar = loadSidecarMeta(row.id);
    const legacy  = isLegacyRender(row.id);

    let meta: SubtitleRenderMetadata;
    if (sidecar) {
      meta = sidecar;
    } else {
      meta = inferMetaFromConfig(row.id, row.videoPath ?? null);
    }

    // Re-validate live (catches config regressions even on sidecar-bearing renders)
    const recheck = validateSubtitleRenderConfig({
      playResX:                  meta.playResX,
      playResY:                  meta.playResY,
      renderWidth:               SUBTITLE_RENDER_CONSTANTS.RENDER_WIDTH,
      renderHeight:              SUBTITLE_RENDER_CONSTANTS.RENDER_HEIGHT,
      fontFamily:                meta.fontFamily,
      fontSize:                  meta.fontSize,
      marginV:                   meta.marginV,
      scaleX:                    SUBTITLE_RENDER_CONSTANTS.SCALE_X,
      scaleY:                    SUBTITLE_RENDER_CONSTANTS.SCALE_Y,
      hasLateScaleAfterSubtitle: meta.hasLateScaleAfterSubtitle,
      subtitleExists:            row.videoStatus === "done",
      maxWordsPerChunk:          SUBTITLE_RENDER_CONSTANTS.MAX_WORDS_PER_CHUNK,
    });

    const videoExists = row.videoPath
      ? fs.existsSync(path.join(process.cwd(), row.videoPath))
      : false;

    const errors = [...recheck.errors];
    if (!videoExists && row.videoStatus === "done") {
      errors.push("Video file missing from disk (videoStatus=done but file not found).");
    }

    results.push({
      id:          row.id,
      topic:       row.topic,
      videoStatus: row.videoStatus,
      videoPath:   row.videoPath ?? null,
      subtitlePath: meta.subtitlePath,
      playRes:     `${meta.playResX}×${meta.playResY}`,
      font:        `${meta.fontFamily} ${meta.fontSize}`,
      fontSize:    meta.fontSize,
      marginV:     meta.marginV,
      burnStage:   meta.burnStage,
      validation:  legacy ? "LEGACY" : (errors.length === 0 ? "PASS" : "FAIL"),
      errors,
      legacy,
    });
  }

  // ── Print table ─────────────────────────────────────────────
  console.log("  ID       | result  | play_res    | font         | mV  | burn_stage             | errors");
  console.log("  " + "─".repeat(110));
  for (const r of results) {
    const icon = r.validation === "PASS" ? "✓" : r.validation === "LEGACY" ? "⚠" : "✗";
    const errStr = r.errors.length > 0 ? r.errors[0].slice(0, 55) + (r.errors.length > 1 ? ` +${r.errors.length-1}` : "") : "—";
    console.log(
      `  ${r.id.slice(0,8)} | ${icon} ${r.validation.padEnd(5)} | ${r.playRes.padEnd(11)} | ${r.font.padEnd(12)} | ${String(r.marginV).padStart(3)} | ${r.burnStage.padEnd(22)} | ${errStr}`
    );
  }

  const passed  = results.filter(r => r.validation === "PASS").length;
  const failed  = results.filter(r => r.validation === "FAIL").length;
  const legacy  = results.filter(r => r.validation === "LEGACY").length;

  console.log(`\n  Summary: ✓ ${passed} pass  ✗ ${failed} fail  ⚠ ${legacy} legacy (pre-fix, no sidecar)`);

  if (legacy > 0) {
    console.log("\n  ⚠ Legacy items were rendered before the subtitle QA fix was applied.");
    console.log("    They have no sidecar metadata. Validation is inferred from current config.");
    console.log("    Consider re-rendering to apply: fade-only animation, size 72, max 5 words/chunk.");
    console.log("    Legacy items:");
    for (const r of results.filter(r => r.legacy)) {
      console.log(`    - ${r.id.slice(0,8)}  "${(r.topic ?? "").slice(0,60)}"  videoPath=${r.videoPath ?? "(none)"}`);
    }
  }

  if (failed > 0) {
    console.log("\n  ✗ Failed items (BLOCK from queue):");
    for (const r of results.filter(r => r.validation === "FAIL")) {
      console.log(`    - ${r.id.slice(0,8)}: ${r.errors.join("; ")}`);
    }
  }

  // ── Detail per item ──────────────────────────────────────────
  console.log("\n── Full detail per item ─────────────────────────────────────");
  for (const r of results) {
    console.log(`\n  ${r.id.slice(0,8)} — ${(r.topic ?? "").slice(0, 65)}`);
    console.log(`    validation:  ${r.validation}${r.legacy ? "  (legacy render — sidecar absent)" : ""}`);
    console.log(`    video:       ${r.videoPath ?? "(none)"}  status=${r.videoStatus}`);
    console.log(`    subtitle:    ${r.subtitlePath ?? "(temp — deleted after render)"}`);
    console.log(`    play_res:    ${r.playRes}`);
    console.log(`    font:        ${r.font}`);
    console.log(`    margin_v:    ${r.marginV}`);
    console.log(`    burn_stage:  ${r.burnStage}`);
    if (r.errors.length > 0) {
      console.log(`    errors:`);
      for (const e of r.errors) console.log(`      - ${e}`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
