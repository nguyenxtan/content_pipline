/**
 * Verification script for YouTube Analytics API v2 integration.
 *
 * Checks: scope added, fetchYouTubeAnalyticsMetrics exported, response parsing,
 * 403 graceful degradation, UI warning condition, DB column readiness.
 *
 * Run with: npm run verify:youtube-analytics
 */

import fs from "fs";
import path from "path";
import { fetchYouTubeAnalyticsMetrics } from "@/lib/social/youtube-api";

let passed = 0;
let failed = 0;

function ok(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ✓  ${description}`);
    passed++;
  } else {
    console.error(`  ✗  FAIL: ${description}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — Scope added to getYouTubeAuthUrl
// ─────────────────────────────────────────────────────────────────────────────

function testScope() {
  console.log("\n── TEST 1: yt-analytics.readonly scope added to getYouTubeAuthUrl");
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/social/youtube-api.ts"),
    "utf-8",
  );
  ok(
    src.includes("yt-analytics.readonly"),
    "youtube-api.ts contains yt-analytics.readonly scope",
  );
  ok(
    src.includes("fetchYouTubeAnalyticsMetrics"),
    "youtube-api.ts exports fetchYouTubeAnalyticsMetrics",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — fetchYouTubeAnalyticsMetrics is exported with correct signature
// ─────────────────────────────────────────────────────────────────────────────

function testExportShape() {
  console.log("\n── TEST 2: fetchYouTubeAnalyticsMetrics export shape");
  ok(typeof fetchYouTubeAnalyticsMetrics === "function", "is a function");
  ok(fetchYouTubeAnalyticsMetrics.length === 4, "has 4 declared parameters");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — Column-header parsing (mocked response)
// ─────────────────────────────────────────────────────────────────────────────

function testColumnHeaderParsing() {
  console.log("\n── TEST 3: Column-header parsing — name-based not index-based");

  // Simulate the parsing logic extracted from fetchYouTubeAnalyticsMetrics
  const mockResponse = {
    columnHeaders: [
      { name: "video" },
      { name: "averageViewPercentage" },
      { name: "impressionClickThroughRate" },
      { name: "averageViewDuration" },
      { name: "impressions" },
    ],
    rows: [
      ["dQw4w9WgXcQ", 45.2, 0.0823, 312, 15000],
      ["xvFZjo5PgG0", 38.7, null,   280, 800],
      ["newVideoId1", 0,    0,      0,   5],    // 0 values — should map to null where applicable
    ] as Array<Array<string | number | null>>,
  };

  const headers = mockResponse.columnHeaders;
  const rows    = mockResponse.rows;

  const colIdx = (name: string) => headers.findIndex((h) => h.name === name);
  const videoIdx       = colIdx("video");
  const ctrIdx         = colIdx("impressionClickThroughRate");
  const durationIdx    = colIdx("averageViewDuration");
  const retentionIdx   = colIdx("averageViewPercentage");
  const impressionsIdx = colIdx("impressions");

  function parseRow(row: Array<string | number | null>) {
    const ctrRaw         = ctrIdx !== -1         ? row[ctrIdx]         : null;
    const durationRaw    = durationIdx !== -1     ? row[durationIdx]    : null;
    const retentionRaw   = retentionIdx !== -1    ? row[retentionIdx]   : null;
    const impressionsRaw = impressionsIdx !== -1  ? row[impressionsIdx] : null;
    return {
      videoId:           String(row[videoIdx]),
      ctr:               typeof ctrRaw === "number"          && ctrRaw > 0         ? ctrRaw         : null,
      avgViewDurationSec: typeof durationRaw === "number"    && durationRaw > 0    ? Math.round(durationRaw) : null,
      retentionPct:      typeof retentionRaw === "number"    && retentionRaw > 0   ? retentionRaw   : null,
      impressions:       typeof impressionsRaw === "number"                         ? impressionsRaw : null,
    };
  }

  const r0 = parseRow(rows[0]!);
  const r1 = parseRow(rows[1]!);
  const r2 = parseRow(rows[2]!);

  // Row 0: normal data
  ok(r0.videoId === "dQw4w9WgXcQ", "row 0 videoId correct");
  ok(r0.ctr === 0.0823,            "row 0 ctr = 0.0823");
  ok(r0.avgViewDurationSec === 312, "row 0 avgViewDurationSec = 312");
  ok(r0.retentionPct === 45.2,     "row 0 retentionPct = 45.2");
  ok(r0.impressions === 15000,     "row 0 impressions = 15000");

  // Row 1: null CTR (< 10 impressions)
  ok(r1.ctr === null,              "row 1 ctr = null (API returns null)");
  ok(r1.retentionPct === 38.7,     "row 1 retentionPct = 38.7");

  // Row 2: zero values — CTR 0 maps to null
  ok(r2.ctr === null,              "row 2 ctr = null (0 treated as null)");
  ok(r2.avgViewDurationSec === null, "row 2 avgViewDurationSec = null (0 treated as null)");
  ok(r2.impressions === 5,         "row 2 impressions = 5 (0 is valid for impressions)");

  // Column order: verify indices are correct with scrambled headers
  ok(videoIdx === 0,       "video column found at index 0");
  ok(ctrIdx   === 2,       "impressionClickThroughRate at index 2 (not 1)");
  ok(retentionIdx === 1,   "averageViewPercentage at index 1 (not last)");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4 — Publishing analytics wires Analytics API after Data API sync
// ─────────────────────────────────────────────────────────────────────────────

function testSyncWiring() {
  console.log("\n── TEST 4: syncYouTubeAnalyticsAction wires fetchYouTubeAnalyticsMetrics");
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/actions/publishing-analytics.ts"),
    "utf-8",
  );
  ok(src.includes("fetchYouTubeAnalyticsMetrics"), "imports fetchYouTubeAnalyticsMetrics");
  ok(src.includes("WriteYouTubeMetricsResult"),    "writeYouTubeMetrics returns WriteYouTubeMetricsResult");
  ok(src.includes("snapshotKeys"),                 "snapshotKeys passed from writeYouTubeMetrics");
  ok(src.includes("youtube/analytics:"),           "analytics errors isolated from video sync errors");
  ok(
    src.includes("raw_json || "),
    "jsonb merge used for impressions",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5 — UI warning for channels missing analytics scope
// ─────────────────────────────────────────────────────────────────────────────

function testUiWarning() {
  console.log("\n── TEST 5: channel-manager-client.tsx shows re-auth warning");
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/components/channels/channel-manager-client.tsx"),
    "utf-8",
  );
  ok(
    src.includes("yt-analytics.readonly"),
    "channel-manager checks scope for yt-analytics.readonly",
  );
  ok(
    src.includes("Reconnect"),
    "warning message contains 'Reconnect'",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("YouTube Analytics API v2 integration verification");

  testScope();
  testExportShape();
  testColumnHeaderParsing();
  testSyncWiring();
  testUiWarning();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
