/**
 * _backfill_legacy_quote_image_paths.ts
 *
 * Backfill content_generations.image_paths for legacy_quote_short rows that
 * have video_status='done' but no image_paths set, where the bg.jpg exists on disk.
 *
 * Safety guards per row:
 *   - verify bg.jpg exists before update
 *   - WHERE id = :id AND format_type = 'legacy_quote_short' AND video_status = 'done'
 *       AND (image_paths IS NULL OR jsonb_array_length(image_paths) = 0)
 *
 * Does NOT touch: upload_queue, published_videos, any row where bg.jpg is missing.
 * Does NOT use card.jpg.
 */
import path from "path";
import fs from "fs";
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq, and, or, isNull, sql } from "drizzle-orm";

function fileExistsAbs(relOrAbs: string): boolean {
  const abs = path.isAbsolute(relOrAbs)
    ? relOrAbs
    : path.join(process.cwd(), relOrAbs);
  return fs.existsSync(abs);
}

async function main() {
  // ── Safety baseline counts ────────────────────────────────────────────────
  const uqBeforeRes = await db.execute(sql`SELECT COUNT(*) as cnt FROM upload_queue`);
  const uqBefore = Number((uqBeforeRes.rows[0] as any).cnt);
  const pvBeforeRes = await db.execute(sql`SELECT COUNT(*) as cnt FROM published_videos`);
  const pvBefore = Number((pvBeforeRes.rows[0] as any).cnt);

  // ── Fetch eligible rows ───────────────────────────────────────────────────
  const rows = await db
    .select({
      id: contentGenerations.id,
      channelKey: contentGenerations.channelKey,
      imagePaths: contentGenerations.imagePaths,
      formatType: contentGenerations.formatType,
      videoStatus: contentGenerations.videoStatus,
    })
    .from(contentGenerations)
    .where(
      and(
        eq(contentGenerations.formatType, "legacy_quote_short"),
        eq(contentGenerations.videoStatus, "done"),
        or(
          isNull(contentGenerations.imagePaths),
          sql`(${contentGenerations.imagePaths})::jsonb = '[]'::jsonb`,
          sql`jsonb_array_length((${contentGenerations.imagePaths})::jsonb) = 0`,
        ),
      ),
    );

  console.log(`\nEligible rows (missing image_paths, done, legacy_quote_short): ${rows.length}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const updatedRows: Array<{ id: string; relPath: string; channelKey: string | null }> = [];
  const skippedRows: Array<{ id: string; reason: string }> = [];

  for (const row of rows) {
    const relPath = `output/legacy-quote-short-v1/images/${row.id}-bg.jpg`;

    // Safety: never use card.jpg
    if (relPath.includes("legacy-quote-card")) {
      skippedRows.push({ id: row.id, reason: "card.jpg path detected — skipped (safety)" });
      skipped++;
      continue;
    }

    // Safety: verify bg.jpg exists on disk before touching DB
    if (!fileExistsAbs(relPath)) {
      skippedRows.push({ id: row.id, reason: "bg.jpg missing on disk" });
      skipped++;
      continue;
    }

    // Execute update with full safety WHERE clause
    try {
      const result = await db
        .update(contentGenerations)
        .set({ imagePaths: [relPath] as unknown as string })
        .where(
          and(
            eq(contentGenerations.id, row.id),
            eq(contentGenerations.formatType, "legacy_quote_short"),
            eq(contentGenerations.videoStatus, "done"),
            or(
              isNull(contentGenerations.imagePaths),
              sql`(${contentGenerations.imagePaths})::jsonb = '[]'::jsonb`,
              sql`jsonb_array_length((${contentGenerations.imagePaths})::jsonb) = 0`,
            ),
          ),
        );

      console.log(`  UPDATED id=${row.id} channel=${row.channelKey} path="${relPath}"`);
      updatedRows.push({ id: row.id, relPath, channelKey: row.channelKey });
      updated++;
    } catch (err) {
      console.error(`  FAILED id=${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  // ── Safety baseline after ─────────────────────────────────────────────────
  const uqAfterRes = await db.execute(sql`SELECT COUNT(*) as cnt FROM upload_queue`);
  const uqAfter = Number((uqAfterRes.rows[0] as any).cnt);
  const pvAfterRes = await db.execute(sql`SELECT COUNT(*) as cnt FROM published_videos`);
  const pvAfter = Number((pvAfterRes.rows[0] as any).cnt);

  // ── Post-update verification ──────────────────────────────────────────────
  const bgPathRes = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM content_generations
    WHERE format_type = 'legacy_quote_short'
      AND video_status = 'done'
      AND image_paths IS NOT NULL
      AND jsonb_array_length(image_paths::jsonb) > 0
      AND (image_paths::jsonb ->> 0) LIKE '%-bg.jpg'
  `);
  const bgPathCount = Number((bgPathRes.rows[0] as any).cnt);

  const stillMissingRes = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM content_generations
    WHERE format_type = 'legacy_quote_short'
      AND video_status = 'done'
      AND (image_paths IS NULL OR image_paths::jsonb = '[]'::jsonb OR jsonb_array_length(image_paths::jsonb) = 0)
  `);
  const stillMissingCount = Number((stillMissingRes.rows[0] as any).cnt);

  const cardJpgRes = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM content_generations
    WHERE format_type = 'legacy_quote_short'
      AND image_paths IS NOT NULL
      AND jsonb_array_length(image_paths::jsonb) > 0
      AND (image_paths::jsonb ->> 0) LIKE '%-legacy-quote-card.jpg'
  `);
  const cardJpgCount = Number((cardJpgRes.rows[0] as any).cnt);

  // ── Output ────────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("## Backfill Summary");
  console.log("| metric | count |");
  console.log("|---|---:|");
  console.log(`| eligible fixable rows | ${rows.length} |`);
  console.log(`| updated rows | ${updated} |`);
  console.log(`| skipped missing bg.jpg | ${skipped} |`);
  console.log(`| failed updates | ${failed} |`);

  console.log("\n## Sample Updated Rows (first 10)");
  console.log("| content_id | image_path | file_exists | channel_key |");
  console.log("|---|---|---|---|");
  for (const r of updatedRows.slice(0, 10)) {
    const exists = fileExistsAbs(r.relPath);
    console.log(`| ${r.id} | ${r.relPath} | ${exists ? "✅" : "❌"} | ${r.channelKey ?? "—"} |`);
  }
  if (updatedRows.length > 10) {
    console.log(`| _(+${updatedRows.length - 10} more)_ | | | |`);
  }

  if (skippedRows.length > 0) {
    console.log("\n## Remaining Missing Rows");
    console.log("| content_id | reason |");
    console.log("|---|---|");
    for (const s of skippedRows) {
      console.log(`| ${s.id} | ${s.reason} |`);
    }
  } else {
    console.log("\n## Remaining Missing Rows\n_None — all eligible rows updated._");
  }

  console.log("\n## Post-Update Verification");
  console.log(`- done rows with image_paths[0] ending in -bg.jpg: ${bgPathCount}`);
  console.log(`- done rows still missing image_paths: ${stillMissingCount}`);
  console.log(`- rows with card.jpg in image_paths: ${cardJpgCount} (expected 0)`);

  console.log("\n## Safety");
  console.log(`- upload_queue rows before: ${uqBefore}  after: ${uqAfter}  delta: ${uqAfter - uqBefore}`);
  console.log(`- published_videos rows before: ${pvBefore}  after: ${pvAfter}  delta: ${pvAfter - pvBefore}`);
  console.log(`- content_generations rows updated: ${updated}`);
  console.log(`- any card.jpg used: ${cardJpgCount === 0 ? "❌ none (safe)" : "⚠️ YES — investigate!"}`);

  // Verify no tang_sau queue rows changed (spot-check: count queued tang_sau queue rows)
  const tsQueueRes = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM upload_queue uq
    JOIN content_generations cg ON cg.id = uq.content_id
    WHERE cg.channel_key = 'tang_sau'
      AND uq.status IN ('queued', 'uploading')
  `);
  const tsQueueCount = Number((tsQueueRes.rows[0] as any).cnt);
  console.log(`- tang_sau queued/uploading rows (unchanged): ${tsQueueCount}`);

  console.log("\n## Recommendation");
  if (failed === 0 && cardJpgCount === 0 && uqAfter === uqBefore) {
    console.log("✅ Backfill completed successfully. All safety checks pass.");
    console.log(`   ${updated} legacy_quote_short rows now have image_paths set to their bg.jpg.`);
    console.log(`   ${skipped} rows skipped (bg.jpg missing on disk — cannot recover).`);
    if (stillMissingCount > 0) {
      console.log(`   ${stillMissingCount} rows still missing image_paths — these are the unfixable sample rows.`);
    }
  } else {
    console.error("⚠️  Issues detected — review above output before proceeding.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
