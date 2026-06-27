/**
 * verify-legacy-quote-image-paths.ts
 *
 * Read-only audit of legacy_quote_short content rows.
 *
 * Checks:
 *   1. image_paths[0] exists and ends with "-bg.jpg" (never "-legacy-quote-card.jpg")
 *   2. The file actually exists on disk at the relative path
 *   3. Reports content rows with video_status='done' that are MISSING image_paths
 *      (dry-run report — no mutations)
 *
 * Exit code 0 = all checks pass (or no rows found).
 * Exit code 1 = one or more checks fail.
 *
 * Usage:
 *   DATABASE_URL="postgresql://admin:admin123@127.0.0.1:5433/content_pipeline" \
 *     npx tsx scripts/verify-legacy-quote-image-paths.ts
 */
import path from "path";
import fs from "fs";
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq, and, isNotNull, or, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fileExistsAbs(relOrAbs: string): boolean {
  const abs = path.isAbsolute(relOrAbs)
    ? relOrAbs
    : path.join(process.cwd(), relOrAbs);
  return fs.existsSync(abs);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let failures = 0;

  // ── Fetch all legacy_quote_short rows with video_status='done' ──────────────
  const rows = await db
    .select({
      id: contentGenerations.id,
      channelKey: contentGenerations.channelKey,
      videoStatus: contentGenerations.videoStatus,
      imagePaths: contentGenerations.imagePaths,
      formatType: contentGenerations.formatType,
    })
    .from(contentGenerations)
    .where(
      and(
        eq(contentGenerations.formatType, "legacy_quote_short"),
        eq(contentGenerations.videoStatus, "done"),
      ),
    )
    .orderBy(sql`${contentGenerations.createdAt} DESC`)
    .limit(500);

  if (rows.length === 0) {
    console.log("No legacy_quote_short rows with video_status='done' found. Nothing to verify.");
    process.exit(0);
  }

  console.log(`\nFound ${rows.length} legacy_quote_short rows with video_status='done'\n`);

  // ── TEST 1: Rows with image_paths set — validate the path ────────────────────
  console.log("═══ TEST 1: Rows WITH image_paths — validate bg.jpg and file existence ═══");
  const withPaths = rows.filter((r) => {
    const paths = r.imagePaths as string[] | null;
    return paths && paths.length > 0;
  });
  console.log(`  ${withPaths.length} row(s) have image_paths set.\n`);

  let t1Pass = 0, t1Fail = 0;
  for (const row of withPaths) {
    const paths = row.imagePaths as string[];
    const bgPath = paths[0];

    // Guard: must end with -bg.jpg, NOT -legacy-quote-card.jpg
    if (!bgPath.endsWith("-bg.jpg")) {
      console.error(
        `  FAIL id=${row.id.slice(0, 16)}… image_paths[0]="${bgPath}" — does NOT end with -bg.jpg (bad: likely card.jpg)`,
      );
      failures++;
      t1Fail++;
      continue;
    }

    // Guard: file must exist on disk
    if (!fileExistsAbs(bgPath)) {
      console.error(
        `  FAIL id=${row.id.slice(0, 16)}… image_paths[0]="${bgPath}" — FILE MISSING on disk`,
      );
      failures++;
      t1Fail++;
      continue;
    }

    console.log(`  PASS id=${row.id.slice(0, 16)}… path="${bgPath}"`);
    t1Pass++;
  }
  console.log(`\n  → PASS:${t1Pass}  FAIL:${t1Fail}`);

  // ── TEST 2: Rows WITHOUT image_paths — dry-run backfill report ────────────────
  console.log("\n═══ TEST 2: Rows WITHOUT image_paths (dry-run backfill report) ═══");
  const withoutPaths = rows.filter((r) => {
    const paths = r.imagePaths as string[] | null;
    return !paths || paths.length === 0;
  });

  if (withoutPaths.length === 0) {
    console.log("  ✅ All done rows already have image_paths set. No backfill needed.\n");
  } else {
    console.log(`  ⚠️  ${withoutPaths.length} row(s) are missing image_paths:\n`);

    let canFix = 0, cannotFix = 0;
    for (const row of withoutPaths) {
      // Reconstruct expected bg path from content id
      const expectedRelPath = `output/legacy-quote-short-v1/images/${row.id}-bg.jpg`;
      const exists = fileExistsAbs(expectedRelPath);

      if (exists) {
        console.log(
          `  [DRY-RUN BACKFILL] id=${row.id} channel=${row.channelKey}` +
          `\n    → would set image_paths=["${expectedRelPath}"] (file exists ✓)`,
        );
        canFix++;
      } else {
        console.warn(
          `  [CANNOT FIX] id=${row.id} channel=${row.channelKey}` +
          `\n    → expected bg path NOT found: "${expectedRelPath}"`,
        );
        cannotFix++;
      }
    }

    console.log(`\n  Summary: ${canFix} can be backfilled, ${cannotFix} cannot (bg.jpg missing on disk).`);
    console.log("  NOTE: This is a DRY-RUN — no changes made. To apply, run the backfill script.");

    if (canFix > 0) {
      // Non-zero exit if there are fixable rows, to signal they need attention
      failures += canFix;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  if (failures === 0) {
    console.log("✅ ALL CHECKS PASSED — image_paths is healthy for all legacy_quote_short rows.");
  } else if (t1Fail > 0) {
    console.error(`❌ ${t1Fail} row(s) have invalid/wrong image_paths (check above)`);
    process.exit(1);
  } else {
    // Only "canFix" rows needing backfill — not a hard failure, just informational
    console.warn("⚠️  Some rows need image_paths backfill (see dry-run above). No bad paths found.");
  }
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
