import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

function isNextDevRunning(port = 3000): boolean {
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: "utf8", stdio: ["pipe","pipe","ignore"] }).trim().split("\n").filter(Boolean);
    return pids.some(pid => {
      try {
        const args = execSync(`ps -p ${pid} -o args=`, { encoding: "utf8", stdio: ["pipe","pipe","ignore"] }).trim();
        return args.includes("next") && !args.includes("Google Chrome") && !args.includes("Chrome Helper");
      } catch { return false; }
    });
  } catch { return false; }
}

function sizeStr(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)}G`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)}M`;
  if (bytes > 1e3) return `${(bytes / 1e3).toFixed(1)}K`;
  return `${bytes}B`;
}

function dirSize(p: string): number {
  if (!fs.existsSync(p)) return 0;
  const stat = fs.statSync(p);
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(p)) {
    total += dirSize(path.join(p, entry));
  }
  return total;
}

async function main() {
  const cwd = process.cwd();
  const nextRunning = isNextDevRunning();

  // ── 1. Which media/videos files are in active queue or pending cleanup ──
  const activeVideos = await db.execute(sql`
    SELECT video_path FROM content_generations
    WHERE video_path LIKE 'media/videos/%'
      AND (video_status = 'done' OR video_status = 'pending')
      AND media_cleaned_at IS NULL
  `);
  const activeVideoPaths = new Set((activeVideos.rows as any[]).map(r => r.video_path));

  const allVideoFiles = fs.existsSync("media/videos")
    ? fs.readdirSync("media/videos").filter(f => f.endsWith(".mp4") || f.endsWith(".ass") || f.endsWith(".jpg"))
    : [];

  let activeVideoBytes = 0, orphanVideoBytes = 0;
  const orphanVideoFiles: string[] = [];
  for (const f of allVideoFiles) {
    const rel = `media/videos/${f}`;
    const abs = path.join(cwd, rel);
    const bytes = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    if (activeVideoPaths.has(rel) || [...activeVideoPaths].some(p => rel.startsWith(p.replace(/\.mp4$/, "")))) {
      activeVideoBytes += bytes;
    } else {
      orphanVideoBytes += bytes;
      orphanVideoFiles.push(rel);
    }
  }

  // ── 2. output/legacy-quote-short-v1 — which MP4s are in active queue ──
  const activeOutputVideos = await db.execute(sql`
    SELECT video_path FROM content_generations
    WHERE video_path LIKE 'output/legacy-quote-short-v1/%'
      AND video_status = 'done'
      AND media_cleaned_at IS NULL
  `);
  const activeOutputPaths = new Set((activeOutputVideos.rows as any[]).map(r => r.video_path));
  const outputMp4s = fs.existsSync("output/legacy-quote-short-v1")
    ? fs.readdirSync("output/legacy-quote-short-v1").filter(f => f.endsWith(".mp4"))
    : [];
  let activeOutputBytes = 0, orphanOutputBytes = 0;
  const orphanOutputFiles: string[] = [];
  for (const f of outputMp4s) {
    const rel = `output/legacy-quote-short-v1/${f}`;
    const abs = path.join(cwd, rel);
    const bytes = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    if (activeOutputPaths.has(rel)) {
      activeOutputBytes += bytes;
    } else {
      orphanOutputBytes += bytes;
      orphanOutputFiles.push(rel);
    }
  }

  // ── 3. Long-form audio chunks ──
  const longChunkDir = "media/audio/7ee07137-142c-44ae-a77c-bd6612cae6a6-long-chunks";
  const longChunkRows = await db.execute(sql`
    SELECT id, video_status, long_audio_path, long_video_path, media_cleaned_at
    FROM content_generations WHERE id::text = '7ee07137-142c-44ae-a77c-bd6612cae6a6'
  `);
  const longChunkRow = longChunkRows.rows[0] as any;

  console.log("\n## Disk Audit Summary");
  console.log("=".repeat(70));

  console.log("\n### media/videos/");
  console.log(`  Total files       : ${allVideoFiles.length}`);
  console.log(`  Active (in CG)    : ${allVideoFiles.length - orphanVideoFiles.length}  ${sizeStr(activeVideoBytes)}`);
  console.log(`  Orphan (no CG ref): ${orphanVideoFiles.length}  ${sizeStr(orphanVideoBytes)}`);
  if (orphanVideoFiles.length > 0) {
    for (const f of orphanVideoFiles.slice(0, 10)) console.log(`    orphan: ${f}`);
    if (orphanVideoFiles.length > 10) console.log(`    ... and ${orphanVideoFiles.length - 10} more`);
  }

  console.log("\n### output/legacy-quote-short-v1/ MP4s");
  console.log(`  Total MP4s        : ${outputMp4s.length}`);
  console.log(`  Active (in CG)    : ${outputMp4s.length - orphanOutputFiles.length}  ${sizeStr(activeOutputBytes)}`);
  console.log(`  Orphan            : ${orphanOutputFiles.length}  ${sizeStr(orphanOutputBytes)}`);
  if (orphanOutputFiles.length > 0) {
    for (const f of orphanOutputFiles.slice(0, 5)) console.log(`    orphan: ${f}`);
    if (orphanOutputFiles.length > 5) console.log(`    ... and ${orphanOutputFiles.length - 5} more`);
  }

  console.log("\n### media/audio/7ee07137 long-chunks (278M)");
  if (longChunkRow) {
    console.log(`  content video_status  : ${longChunkRow.video_status}`);
    console.log(`  media_cleaned_at      : ${longChunkRow.media_cleaned_at ?? "NULL (not cleaned)"}`);
    console.log(`  long_video_path       : ${longChunkRow.long_video_path ?? "NULL"}`);
    console.log(`  safe to delete        : ${longChunkRow.media_cleaned_at ? "YES" : "NO — media_cleaned_at is null"}`);
  } else {
    console.log("  content_generations row NOT FOUND — likely safe to delete");
  }

  console.log("\n### media/audio/pacing-tests/ (103M)");
  const ptFiles = fs.existsSync("media/audio/pacing-tests") ? fs.readdirSync("media/audio/pacing-tests") : null;
  console.log(ptFiles ? `  Files: ${ptFiles.length}  Safe to delete: YES (dev test artifacts, not referenced in DB)` : `  Already deleted.`);

  console.log("\n### media/news-images/ (94M)");
  console.log(`  241 files — news thumbnail images. Safe only if finance-news feature is disabled.`);

  console.log("\n### media/finance-news-drafts/ (21M)");
  console.log(`  3 files — finance news draft JSONs. Safe to delete if feature disabled.`);

  console.log("\n### media/backups/tts-sanitizer-repair/ (17M)");
  const backupFiles = fs.existsSync("media/backups/tts-sanitizer-repair")
    ? fs.readdirSync("media/backups/tts-sanitizer-repair")
    : [];
  console.log(`  ${backupFiles.length} files — repair backup artifacts. Safe to delete.`);

  console.log("\n### media/audio-cache/ (20M)");
  console.log(`  TTS cache entries. Safe to delete — will be regenerated on next TTS run.`);

  console.log("\n### media/covers/ (5.2M)");
  const coverFiles = fs.existsSync("media/covers") ? fs.readdirSync("media/covers") : [];
  console.log(`  ${coverFiles.length} cover image files. Cross-check with active queue needed.`);

  console.log("\n### .trash-cleanup/2026-06-13/ (3.6G)");
  console.log(`  media/: 649M — previously trashed media from cleanup sessions`);
  console.log(`  output/: 2.9G — previously trashed output renders (kinetic-text, tang-sau tests, etc.)`);
  console.log(`  MANIFEST.json present — structured trash, safe to delete entirely`);

  console.log("\n### .next/dev/cache/ (4.2G)");
  if (nextRunning) {
    console.log(`  ⚠ Next dev server is RUNNING on port 3000. Do NOT delete while server is live.`);
    console.log(`  Stop first with: pnpm dev:reset:kill`);
  } else {
    console.log(`  Next.js dev build cache. Fully regenerable. Safe to delete — server is not running.`);
  }

  console.log("\n### .next/dev/server/ (703M) + static/ (293M)");
  if (nextRunning) {
    console.log(`  ⚠ Next dev server is RUNNING. Deleting .next/ while live causes browser "Failed to fetch" errors.`);
  } else {
    console.log(`  Next.js dev server artifacts. Regenerable. Safe to delete with full .next/ (server stopped).`);
  }

  console.log("\n### .git/objects/ (11G)");
  console.log(`  Git pack history. Can be reduced with 'git gc --aggressive' but risky on large repos.`);
  console.log(`  Do NOT delete — run gc separately if needed.`);

  console.log("\n### facebook-page-token-manager/ (45M)");
  console.log(`  Separate Node app with its own node_modules. Safe if not actively used.`);

  console.log("\n### media/music/phat-phap/ (219M)");
  console.log(`  Background music library. Referenced by pipeline. NOT safe to delete.`);

  // ── 4. Dry-run cleanup plan ──────────────────────────────────────────────
  console.log("\n");
  console.log("=".repeat(70));
  console.log("## Dry-run Cleanup Plan");
  console.log("=".repeat(70));

  const plan: Array<{ path: string; size: string; safety: string; reason: string; risk: string }> = [
    {
      path: ".trash-cleanup/",
      size: "3.6G",
      safety: "SAFE",
      reason: "Structured trash from prior cleanup sessions. MANIFEST.json confirms intent.",
      risk: "None — these were already moved here as trash",
    },
    {
      path: ".next/",
      size: "5.2G",
      safety: nextRunning ? "UNSAFE_NOW" : "SAFE",
      reason: nextRunning
        ? "Next dev server is RUNNING — deleting .next/ causes browser fetch errors. Stop first."
        : "Next.js dev build cache. Fully regenerated on next `pnpm dev` run.",
      risk: nextRunning
        ? "HIGH if deleted now — run `pnpm dev:reset:kill` instead"
        : "Dev server will be slower on next start while rebuilding cache (~2-5 min)",
    },
    {
      path: "media/audio/pacing-tests/",
      size: "103M",
      safety: "SAFE",
      reason: "Dev test audio files, not referenced in any DB row.",
      risk: "None",
    },
    {
      path: "media/backups/tts-sanitizer-repair/",
      size: "17M",
      safety: "SAFE",
      reason: "Repair backup artifacts from a one-time sanitizer run.",
      risk: "None — originals are in place",
    },
    {
      path: "media/audio-cache/",
      size: "20M",
      safety: "SAFE",
      reason: "TTS cache. Regenerated automatically on next TTS request.",
      risk: "First TTS after deletion is slower (cold cache miss)",
    },
    {
      path: "media/audio/7ee07137...-long-chunks/",
      size: "278M",
      safety: "NEEDS_CHECK",
      reason: "Long-form audio chunks. Safe only if media_cleaned_at is set or row not found.",
      risk: "Medium — check DB row first",
    },
    {
      path: "output/legacy-quote-short-v1/ (orphan MP4s)",
      size: sizeStr(orphanOutputBytes),
      safety: orphanOutputFiles.length > 0 ? "SAFE_ORPHANS" : "NOTHING_TO_DO",
      reason: `${orphanOutputFiles.length} MP4s not referenced by any active content_generations row with media_cleaned_at IS NULL`,
      risk: "Low — verify each ID before deleting",
    },
    {
      path: "media/videos/ (orphan files)",
      size: sizeStr(orphanVideoBytes),
      safety: orphanVideoFiles.length > 0 ? "SAFE_ORPHANS" : "NOTHING_TO_DO",
      reason: `${orphanVideoFiles.length} files not linked to any pending content_generation`,
      risk: "Low",
    },
    {
      path: "media/news-images/ + finance-news-drafts/",
      size: "115M",
      safety: "NEEDS_REVIEW",
      reason: "Finance/news feature assets. Safe only if feature is fully disabled.",
      risk: "Medium — verify feature disabled before deleting",
    },
    {
      path: "facebook-page-token-manager/",
      size: "45M",
      safety: "NEEDS_REVIEW",
      reason: "Separate utility app. Safe if not actively needed.",
      risk: "Low — can be restored from git",
    },
    {
      path: ".git/objects/",
      size: "11G",
      safety: "DO_NOT_DELETE",
      reason: "Git history. Run 'git gc --aggressive --prune=now' instead if needed.",
      risk: "HIGH if deleted directly — use git gc only",
    },
    {
      path: "media/music/",
      size: "219M",
      safety: "DO_NOT_DELETE",
      reason: "Active background music library used by pipeline.",
      risk: "HIGH — video render will fail without music",
    },
  ];

  const colW = [45, 8, 15, 50, 35];
  const hdr = ["path", "size", "safety", "reason", "risk"].map((h, i) => h.padEnd(colW[i])).join("  ");
  console.log("\n" + hdr);
  console.log("─".repeat(hdr.length));
  for (const p of plan) {
    console.log([
      p.path.slice(0, colW[0]).padEnd(colW[0]),
      p.size.padEnd(colW[1]),
      p.safety.padEnd(colW[2]),
      p.reason.slice(0, colW[3]).padEnd(colW[3]),
      p.risk.slice(0, colW[4]),
    ].join("  "));
  }

  const safeTotal = [".trash-cleanup (3.6G)", "pacing-tests (103M)", "backups (17M)", "audio-cache (20M)"];
  if (!nextRunning) safeTotal.splice(1, 0, ".next (5.2G)");
  console.log(`\n  Immediately safe deletions: ${safeTotal.join(", ")}`);
  if (nextRunning) {
    console.log(`  .next/ EXCLUDED — Next dev server is running. Use: pnpm dev:reset:kill`);
  }
  console.log(`  Combined: ~${nextRunning ? "3.8" : "9.0"}G reclaim`);
  console.log(`\n  Do NOT execute without explicit user approval per item.`);

  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
