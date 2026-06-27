/**
 * cleanup-orphan-media.ts
 * Deletes media/videos/* files that are NOT referenced by any content_generations row
 * where media_cleaned_at IS NULL (i.e., still pending cleanup).
 *
 * SAFETY: cross-checks every candidate file against the DB before deleting.
 * Requires --delete-orphans flag to execute. Default is dry-run.
 *
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/cleanup-orphan-media.ts [--delete-orphans]
 */
import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const DELETE = process.argv.includes("--delete-orphans");

function sizeStr(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(2)}G`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)}M`;
  if (bytes > 1e3) return `${(bytes / 1e3).toFixed(1)}K`;
  return `${bytes}B`;
}

async function main() {
  console.log(`mode: ${DELETE ? "DELETE-ORPHANS" : "DRY-RUN"}`);

  // 1. Fetch all content_generation rows that still have media_cleaned_at IS NULL
  //    and any video/audio/image paths pointing into media/videos/
  const referenced = await db.execute(sql`
    SELECT
      id,
      video_path,
      audio_path,
      long_video_path,
      long_audio_path
    FROM content_generations
    WHERE media_cleaned_at IS NULL
  `);

  // Build a set of all referenced file paths (and filename stems for fuzzy matching)
  const referencedPaths = new Set<string>();
  const referencedStems = new Set<string>(); // content_id substrings
  for (const r of referenced.rows as any[]) {
    for (const col of [r.video_path, r.audio_path, r.long_video_path, r.long_audio_path]) {
      if (col) referencedPaths.add(col);
    }
    // Also protect by content_id stem so thumbnails/ass files for same ID are kept
    referencedStems.add(r.id);
  }

  // Also fetch from upload_queue any content_id with active queued rows
  const activeQueue = await db.execute(sql`
    SELECT DISTINCT cg.id
    FROM upload_queue uq
    JOIN content_generations cg ON cg.id = uq.content_id
    WHERE uq.status IN ('queued','uploading','pending')
  `);
  for (const r of activeQueue.rows as any[]) {
    referencedStems.add(r.id);
  }

  // 2. Scan media/videos/
  const mediaVideosDir = path.resolve("media/videos");
  if (!fs.existsSync(mediaVideosDir)) {
    console.log("media/videos/ does not exist.");
    process.exit(0);
  }
  const allFiles = fs.readdirSync(mediaVideosDir);

  const orphans: Array<{ relPath: string; bytes: number }> = [];
  const protected_: Array<{ relPath: string; reason: string }> = [];

  for (const f of allFiles) {
    const relPath = `media/videos/${f}`;
    const absPath = path.resolve(mediaVideosDir, f);
    const bytes = fs.statSync(absPath).size;

    // Check if referenced by path
    if (referencedPaths.has(relPath)) {
      protected_.push({ relPath, reason: "exact path in content_generations" });
      continue;
    }

    // Check if content_id stem appears in filename
    const contentIdInFilename = [...referencedStems].find(stem => f.includes(stem));
    if (contentIdInFilename) {
      protected_.push({ relPath, reason: `content_id ${contentIdInFilename} in filename (active or pending cleanup)` });
      continue;
    }

    orphans.push({ relPath, bytes });
  }

  const orphanBytes = orphans.reduce((s, o) => s + o.bytes, 0);

  console.log(`\nTotal files in media/videos/: ${allFiles.length}`);
  console.log(`Protected (referenced)       : ${protected_.length}`);
  console.log(`Orphans (no reference)        : ${orphans.length}  ${sizeStr(orphanBytes)}`);

  if (orphans.length === 0) {
    console.log("\nNo orphans to delete.");
    process.exit(0);
  }

  console.log("\nOrphans to delete:");
  for (const o of orphans) {
    console.log(`  ${o.relPath}  (${sizeStr(o.bytes)})`);
  }

  if (!DELETE) {
    console.log(`\n[DRY-RUN] Would delete ${orphans.length} files (${sizeStr(orphanBytes)}).`);
    console.log("Re-run with --delete-orphans to execute.");
    process.exit(0);
  }

  // 3. Final safety re-check before deletion
  console.log(`\nExecuting deletion of ${orphans.length} orphan files…`);
  let deleted = 0;
  let freedBytes = 0;
  for (const o of orphans) {
    const absPath = path.resolve(o.relPath);

    // Paranoia: must be inside media/videos/
    if (!absPath.startsWith(path.resolve("media/videos"))) {
      console.error(`  SKIP (path escape): ${o.relPath}`);
      continue;
    }
    // Paranoia: must not contain any referenced stem
    const fname = path.basename(absPath);
    const stillReferenced = [...referencedStems].find(stem => fname.includes(stem));
    if (stillReferenced) {
      console.error(`  SKIP (race-condition reference): ${o.relPath} — stem ${stillReferenced}`);
      continue;
    }

    try {
      fs.unlinkSync(absPath);
      deleted++;
      freedBytes += o.bytes;
      console.log(`  ✓ deleted ${o.relPath}  (${sizeStr(o.bytes)})`);
    } catch (e: any) {
      console.error(`  ✗ failed ${o.relPath}: ${e.message}`);
    }
  }

  console.log(`\nDeleted: ${deleted} / ${orphans.length} files`);
  console.log(`Freed:   ${sizeStr(freedBytes)}`);
  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
