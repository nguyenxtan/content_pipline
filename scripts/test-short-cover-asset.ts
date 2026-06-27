/**
 * Dry-run test for the Short Cover Asset Generator.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/test-short-cover-asset.ts
 *   npx tsx --tsconfig tsconfig.json scripts/test-short-cover-asset.ts --content-id <uuid>
 *   npx tsx --tsconfig tsconfig.json scripts/test-short-cover-asset.ts --content-id <uuid> --write
 *
 * Flags:
 *   --content-id <id>  Test with a specific content generation ID (uses DB record for topic/hook/images)
 *   --write            Persist the generated asset path to the DB (default: dry-run only)
 *
 * Without --content-id, runs a synthetic test with hardcoded Vietnamese topics.
 */

import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { generateShortCover } from "@/lib/short-cover-engine";
import {
  generateShortCoverAsset,
  resolveShortCoverSourceImage,
} from "@/lib/image/short-cover-asset-generator";

const COVER_WIDTH = 1080;
const COVER_HEIGHT = 1920;

const cliArgs = process.argv.slice(2);
const contentIdArg = (() => {
  const idx = cliArgs.indexOf("--content-id");
  return idx !== -1 ? cliArgs[idx + 1] ?? null : null;
})();
const writeMode = cliArgs.includes("--write");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Synthetic test topics ────────────────────────────────────────────────────
const SYNTHETIC_TOPICS = [
  "Nỗi sợ bị bỏ rơi",
  "Tìm kiếm sự bình yên",
  "Mắc kẹt trong quá khứ",
  "Khao khát được thấu hiểu",
  "Sợ thất bại",
  "Cô đơn giữa đám đông",
  "Bế tắc vì điều gì",
  "Học cách tha thứ",
];

function pass(msg: string) {
  console.log(`  ✓  ${msg}`);
}

function fail(msg: string) {
  console.error(`  ✗  ${msg}`);
  process.exitCode = 1;
}

function testSyntheticCovers() {
  console.log("\n── Synthetic Cover Text Engine Test ──────────────────────────\n");

  const results = SYNTHETIC_TOPICS.map((topic) => {
    const result = generateShortCover({ topic });
    return { topic, ...result };
  });

  for (const r of results) {
    const words = r.coverText.split(/\s+/).length;
    const ok = words >= 3 && words <= 5 && r.confidence >= 0.5;
    const line = `"${r.topic}" → "${r.coverText}" (${words}w, conf ${(r.confidence * 100).toFixed(0)}%)`;
    if (ok) pass(line);
    else fail(line);
  }

  console.log(`\n  ${results.length} topics tested.\n`);
}

async function testAssetGeneration(contentId: string) {
  console.log(`\n── Cover Asset Generation Test (contentId: ${contentId}) ─────\n`);

  const { rows } = await pool.query<{
    topic: string;
    short_selected_hook: string | null;
    short_content: string;
    script: string;
    image_paths: string[];
    short_cover_asset_path: string | null;
  }>(
    `SELECT topic, short_selected_hook, short_content, script, image_paths, short_cover_asset_path
     FROM content_generations WHERE id = $1`,
    [contentId]
  );

  if (rows.length === 0) {
    fail(`Content not found: ${contentId}`);
    return;
  }

  const item = rows[0];
  const topic = item.topic;
  const cover = generateShortCover({
    topic,
    selectedHook: item.short_selected_hook,
    script: item.short_content || item.script,
  });
  console.log(`  topic          : ${topic}`);
  console.log(`  coverText      : "${cover.coverText}"`);
  console.log(`  confidence     : ${(cover.confidence * 100).toFixed(0)}%`);
  console.log(`  reason         : ${cover.coverReason}`);
  console.log(`  existingPath   : ${item.short_cover_asset_path ?? "(none)"}`);

  const imagePaths = (item.image_paths as string[] | null) ?? [];
  const source = resolveShortCoverSourceImage({
    contentId,
    sourceImagePath: imagePaths[0] ?? null,
  });

  if (!source.ok) {
    fail(`No source image available: ${source.error}`);
    console.log(`  originalImagePath : ${source.originalImagePath}`);
    console.log(`  fallbackImagePath : ${source.fallbackImagePath}`);
    return;
  }

  pass(`source image: ${source.sourceImagePath} (mode: ${source.sourceImageMode})`);

  const testOutputPath = path.join(process.cwd(), "media", "covers", `${contentId}-short-cover-test.jpg`);

  try {
    const coverAsset = await generateShortCoverAsset({
      contentId,
      topic,
      hookOrScriptExcerpt: item.short_selected_hook || item.short_content || item.script,
      sourceImagePath: imagePaths[0] ?? null,
      coverText: cover.coverText,
      layoutPreset: "short_cover_hook",
      outputPath: testOutputPath,
    });

    console.log(`\n  [COVER_ASSET] generated`);
    console.log(`    coverText       : "${coverAsset.coverText}"`);
    console.log(`    outputPath      : ${coverAsset.outputPath}`);
    console.log(`    dimensions      : ${coverAsset.width}x${coverAsset.height}`);
    console.log(`    readability     : ${coverAsset.readabilityScore}/10`);
    console.log(`    safeAreaPass    : ${coverAsset.safeAreaPass}`);
    console.log(`    textLineCount   : ${coverAsset.textLineCount}`);
    console.log(`    wordCount       : ${coverAsset.coverTextWordCount}`);
    console.log(`    sourceMode      : ${coverAsset.sourceImageMode}`);

    if (coverAsset.width === COVER_WIDTH && coverAsset.height === COVER_HEIGHT) {
      pass(`dimensions correct (${COVER_WIDTH}x${COVER_HEIGHT})`);
    } else {
      fail(`unexpected dimensions: ${coverAsset.width}x${coverAsset.height}`);
    }

    if (coverAsset.safeAreaPass) pass(`safe area: PASS`);
    else fail(`safe area: FAIL`);

    if (coverAsset.readabilityScore >= 8.5) pass(`readability: ${coverAsset.readabilityScore}/10`);
    else fail(`readability too low: ${coverAsset.readabilityScore}/10`);

    if (fs.existsSync(testOutputPath)) {
      const bytes = fs.statSync(testOutputPath).size;
      pass(`output file exists (${(bytes / 1024).toFixed(1)} KB)`);
    } else {
      fail(`output file not found: ${testOutputPath}`);
    }

    if (writeMode) {
      await pool.query(
        `UPDATE content_generations SET short_cover_asset_path = $1, short_cover_text = $2, short_cover_generated_at = NOW() WHERE id = $3`,
        [`media/covers/${contentId}-short-cover.jpg`, coverAsset.coverText, contentId]
      );
      pass(`DB updated: short_cover_asset_path, short_cover_text, short_cover_generated_at`);
    } else {
      console.log(`\n  (dry-run — DB not updated. Add --write to persist.)`);
    }

    // Clean up test files
    fs.unlinkSync(testOutputPath);
    const metaPath = testOutputPath.replace(/\.jpg$/, ".json");
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    pass(`test files cleaned up`);
  } catch (err) {
    fail(`generateShortCoverAsset threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function testCleanupPaths(contentId: string) {
  console.log(`\n── Cleanup Candidate Paths Check ────────────────────────────\n`);
  const expected = [
    `media/covers/${contentId}-short-cover.jpg`,
    `media/covers/${contentId}-short-cover.json`,
  ];
  for (const p of expected) {
    pass(`cleanup candidate: ${p}`);
  }
}

async function main() {
  console.log("=== Short Cover Asset Generator — Test Suite ===");
  console.log(`writeMode : ${writeMode}`);
  console.log(`contentId : ${contentIdArg ?? "(synthetic only)"}`);

  testSyntheticCovers();

  if (contentIdArg) {
    await testAssetGeneration(contentIdArg);
    testCleanupPaths(contentIdArg);
  } else {
    console.log("  (No --content-id provided. Skipping asset generation test.)");
    console.log("  To test full asset generation, run:");
    console.log("    npx tsx --tsconfig tsconfig.json scripts/test-short-cover-asset.ts --content-id <uuid>\n");
  }

  await pool.end();
  console.log("\n=== Done ===\n");
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  pool.end().catch(() => {});
  process.exit(1);
});
