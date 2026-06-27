/**
 * Storage usage report for local generated assets.
 *
 * Scans media/, output/ and related directories, cross-references DB state,
 * and classifies every file as safe-to-delete / pending-upload / must-keep.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/storage-report.ts
 *   DATABASE_URL=... npx tsx scripts/storage-report.ts --json  (machine-readable)
 */

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";
import { inArray, or, eq } from "drizzle-orm";

const ROOT = process.cwd();
const JSON_MODE = process.argv.includes("--json");

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  if (bytes >= 1048576)    return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024)       return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtPad(bytes: number, width = 10): string {
  return fmt(bytes).padStart(width);
}

interface FileEntry {
  absPath: string;
  relPath: string;
  sizeBytes: number;
  mtime: Date;
}

function scanDir(dir: string): FileEntry[] {
  if (!fs.existsSync(dir)) return [];
  const results: FileEntry[] = [];
  const recurse = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      if (name.startsWith(".")) continue;
      const full = path.join(d, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        recurse(full);
      } else {
        results.push({
          absPath: full,
          relPath: full.replace(ROOT + "/", ""),
          sizeBytes: stat.size,
          mtime: stat.mtime,
        });
      }
    }
  };
  recurse(dir);
  return results;
}

function sumBytes(files: FileEntry[]): number {
  return files.reduce((s, f) => s + f.sizeBytes, 0);
}

// Extract content ID from file path (looks for UUID pattern)
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
function extractContentId(f: FileEntry): string | null {
  const m = f.relPath.match(UUID_RE);
  return m ? m[1] : null;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. DB state ────────────────────────────────────────────────────────────

  const pendingQueueRows = await db
    .select({ contentId: uploadQueue.contentId, status: uploadQueue.status, platform: uploadQueue.platform, videoType: uploadQueue.videoType })
    .from(uploadQueue)
    .where(or(eq(uploadQueue.status, "queued"), eq(uploadQueue.status, "uploading")));

  const pendingContentIds = new Set(pendingQueueRows.map((r) => r.contentId));

  const allContent = await db
    .select({ id: contentGenerations.id, videoPath: contentGenerations.videoPath, audioPath: contentGenerations.audioPath,
              imagePaths: contentGenerations.imagePaths, mediaCleanedAt: contentGenerations.mediaCleanedAt,
              videoStatus: contentGenerations.videoStatus, ttsStatus: contentGenerations.ttsStatus })
    .from(contentGenerations);

  const cleanedIds  = new Set(allContent.filter((c) => c.mediaCleanedAt).map((c) => c.id));
  const activeVideoPaths  = new Set(allContent.map((c) => c.videoPath).filter(Boolean) as string[]);
  const activeAudioPaths  = new Set(allContent.map((c) => c.audioPath).filter(Boolean) as string[]);

  // image paths are jsonb arrays
  const activeImagePaths = new Set<string>();
  for (const c of allContent) {
    for (const p of (c.imagePaths as string[] | null) ?? []) activeImagePaths.add(p);
  }

  // ── 2. Scan directories ────────────────────────────────────────────────────

  const DIRS = {
    audio:         path.join(ROOT, "media/audio"),
    audioCache:    path.join(ROOT, "media/audio-cache"),
    images:        path.join(ROOT, "media/images"),
    videos:        path.join(ROOT, "media/videos"),
    covers:        path.join(ROOT, "media/covers"),
    music:         path.join(ROOT, "media/music"),
    output:        path.join(ROOT, "output"),
  };

  const scans: Record<string, FileEntry[]> = {};
  for (const [k, d] of Object.entries(DIRS)) scans[k] = scanDir(d);

  const allFiles = Object.values(scans).flat();

  // ── 3. Classification ──────────────────────────────────────────────────────

  type Category = "tmp_stale" | "test_dev" | "experiment_output" | "audio_cache" | "music_static"
    | "active_video" | "active_audio" | "active_image" | "cover" | "thumbnail";

  interface ClassifiedFile extends FileEntry {
    category: Category;
    protection: "safe_now" | "blocked_pending" | "keep";
    reason: string;
  }

  function classify(f: FileEntry): ClassifiedFile {
    const rel = f.relPath;
    const name = path.basename(rel);

    // Temp/stale
    if (name.includes(".tmp.") || name.includes(".repair.")) {
      return { ...f, category: "tmp_stale", protection: "safe_now", reason: "leftover normalization temp" };
    }

    // Test/dev audio
    if (rel.startsWith("media/audio/tts-quick-") || rel.startsWith("media/audio/test-")) {
      return { ...f, category: "test_dev", protection: "safe_now", reason: "TTS voice test file" };
    }

    // audio-cache: always keep (TTS cache reduces re-synthesis)
    if (rel.startsWith("media/audio-cache/")) {
      return { ...f, category: "audio_cache", protection: "keep", reason: "TTS cache — saves 2-8 min re-synthesis per reuse" };
    }

    // Music: static assets
    if (rel.startsWith("media/music/")) {
      return { ...f, category: "music_static", protection: "keep", reason: "background music asset" };
    }

    // output/ subtree — experiment and test outputs
    if (rel.startsWith("output/")) {
      // Exception: cleanup dryrun log is informational
      if (name.endsWith(".jsonlog") || name.endsWith(".json") || name.endsWith(".html") || name.endsWith(".log")) {
        return { ...f, category: "experiment_output", protection: "safe_now", reason: "experiment log/manifest" };
      }
      return { ...f, category: "experiment_output", protection: "safe_now", reason: "experiment/test output — not in DB" };
    }

    // covers
    if (rel.startsWith("media/covers/")) {
      const cid = extractContentId(f);
      if (cid && pendingContentIds.has(cid)) {
        return { ...f, category: "cover", protection: "blocked_pending", reason: `cover for pending upload ${cid.slice(0, 8)}` };
      }
      return { ...f, category: "cover", protection: "keep", reason: "short cover overlay — active" };
    }

    // thumbnails inside media/videos/
    if (rel.startsWith("media/videos/") && name.endsWith("-thumb.jpg")) {
      const cid = extractContentId(f);
      if (cid && pendingContentIds.has(cid)) {
        return { ...f, category: "thumbnail", protection: "blocked_pending", reason: `thumb for pending ${cid.slice(0, 8)}` };
      }
      if (cid && activeVideoPaths.has(`media/videos/${cid}-short.mp4`)) {
        return { ...f, category: "thumbnail", protection: "keep", reason: "thumb for active video" };
      }
      return { ...f, category: "thumbnail", protection: "safe_now", reason: "orphaned thumbnail (no matching mp4 in DB)" };
    }

    // video mp4
    if (rel.startsWith("media/videos/") && name.endsWith(".mp4")) {
      const cid = extractContentId(f);
      if (cid && pendingContentIds.has(cid)) {
        return { ...f, category: "active_video", protection: "blocked_pending", reason: `video for pending upload ${cid.slice(0, 8)}` };
      }
      if (cid && cleanedIds.has(cid)) {
        return { ...f, category: "active_video", protection: "safe_now", reason: "cleaned in DB — orphaned on disk" };
      }
      if (cid && activeVideoPaths.has(`media/videos/${cid}-short.mp4`)) {
        return { ...f, category: "active_video", protection: "keep", reason: "active rendered video" };
      }
      return { ...f, category: "active_video", protection: "keep", reason: "rendered video — not yet queued" };
    }

    // audio
    if (rel.startsWith("media/audio/")) {
      // normalised path stored without leading slash
      const normRel = rel.replace(/^\//, "");
      if (activeAudioPaths.has(normRel)) {
        if (extractContentId(f) && pendingContentIds.has(extractContentId(f)!)) {
          return { ...f, category: "active_audio", protection: "blocked_pending", reason: "audio for pending upload" };
        }
        return { ...f, category: "active_audio", protection: "keep", reason: "audio referenced in DB" };
      }
      return { ...f, category: "active_audio", protection: "safe_now", reason: "audio not in any DB row (orphaned)" };
    }

    // images
    if (rel.startsWith("media/images/")) {
      const cid = extractContentId(f);
      if (cid && pendingContentIds.has(cid)) {
        return { ...f, category: "active_image", protection: "blocked_pending", reason: `image for pending upload ${cid.slice(0, 8)}` };
      }
      if (cid && activeImagePaths.has(rel)) {
        return { ...f, category: "active_image", protection: "keep", reason: "source image in DB" };
      }
      return { ...f, category: "active_image", protection: "safe_now", reason: "image not referenced in DB" };
    }

    return { ...f, category: "test_dev", protection: "keep", reason: "uncategorised" };
  }

  const classified = allFiles.map(classify);

  // ── 4. Totals by directory ─────────────────────────────────────────────────

  const dirTotals: Record<string, number> = {};
  for (const [k, files] of Object.entries(scans)) {
    dirTotals[k] = sumBytes(files);
  }

  // ── 5. Largest 30 files ────────────────────────────────────────────────────

  const top30 = [...classified].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 30);

  // ── 6. Largest 20 content IDs ─────────────────────────────────────────────

  const byContentId: Record<string, number> = {};
  for (const f of classified) {
    const cid = extractContentId(f);
    if (cid) byContentId[cid] = (byContentId[cid] ?? 0) + f.sizeBytes;
  }
  const top20ContentIds = Object.entries(byContentId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // ── 7. Size by asset type ─────────────────────────────────────────────────

  const byCategory: Record<string, number> = {};
  const byProtection: Record<string, number> = {};
  for (const f of classified) {
    byCategory[f.category]     = (byCategory[f.category] ?? 0) + f.sizeBytes;
    byProtection[f.protection] = (byProtection[f.protection] ?? 0) + f.sizeBytes;
  }

  // ── 8. Safe-to-delete file list ───────────────────────────────────────────

  const safeNow = classified.filter((f) => f.protection === "safe_now").sort((a, b) => b.sizeBytes - a.sizeBytes);
  const blocked  = classified.filter((f) => f.protection === "blocked_pending").sort((a, b) => b.sizeBytes - a.sizeBytes);
  const mustKeep = classified.filter((f) => f.protection === "keep").sort((a, b) => b.sizeBytes - a.sizeBytes);

  const safeNowBytes  = sumBytes(safeNow);
  const blockedBytes  = sumBytes(blocked);
  const mustKeepBytes = sumBytes(mustKeep);

  // ── Output ────────────────────────────────────────────────────────────────

  if (JSON_MODE) {
    console.log(JSON.stringify({ dirTotals, top30, top20ContentIds, byCategory, byProtection, safeNow, blocked, mustKeep }, null, 2));
    return;
  }

  const lines: string[] = [];
  const p = (s = "") => lines.push(s);

  p("# Storage Usage Report");
  p(`Generated: ${new Date().toISOString().replace("T", " ").slice(0, 19)}`);
  p();

  p("## 1. Total Size by Directory");
  p();
  p("| Directory | Size |");
  p("|---|---|");
  const dirOrder: [string, string][] = [
    ["videos", "media/videos"],
    ["output", "output/"],
    ["audioCache", "media/audio-cache"],
    ["music", "media/music"],
    ["audio", "media/audio"],
    ["images", "media/images"],
    ["covers", "media/covers"],
  ];
  let grandTotal = 0;
  for (const [k, label] of dirOrder) {
    const sz = dirTotals[k] ?? 0;
    grandTotal += sz;
    p(`| \`${label}\` | ${fmt(sz)} |`);
  }
  p(`| **Total** | **${fmt(grandTotal)}** |`);
  p();

  p("## 2. Largest 30 Files");
  p();
  p("| Size | Path | Status |");
  p("|---|---|---|");
  for (const f of top30) {
    p(`| ${fmtPad(f.sizeBytes, 8)} | \`${f.relPath}\` | ${f.protection} |`);
  }
  p();

  p("## 3. Largest 20 Content IDs by Total Asset Size");
  p();
  p("| Rank | Content ID | Total Size | Queue Status |");
  p("|---|---|---|---|");
  for (const [i, [cid, sz]] of top20ContentIds.entries()) {
    const qStatus = pendingContentIds.has(cid) ? "⏳ pending upload"
                  : cleanedIds.has(cid)        ? "✅ cleaned"
                  : "📦 not queued";
    p(`| ${i + 1} | \`${cid}\` | ${fmt(sz)} | ${qStatus} |`);
  }
  p();

  p("## 4. Size by Asset Type");
  p();
  p("| Asset Type | Size |");
  p("|---|---|");
  const catLabels: Record<string, string> = {
    active_video:       "Rendered videos (media/videos/*.mp4 + thumbs)",
    experiment_output:  "Experiment / test outputs (output/)",
    audio_cache:        "TTS audio cache (media/audio-cache/)",
    music_static:       "Background music (media/music/)",
    active_audio:       "Active TTS audio (media/audio/)",
    active_image:       "Source images (media/images/)",
    cover:              "Short cover overlays (media/covers/)",
    thumbnail:          "Video thumbnails (media/videos/*.jpg)",
    tmp_stale:          "Stale temp files (*.tmp.wav, *.repair.*)",
    test_dev:           "Test / dev audio files",
  };
  for (const [cat, label] of Object.entries(catLabels)) {
    const sz = byCategory[cat] ?? 0;
    if (sz > 0) p(`| ${label} | ${fmt(sz)} |`);
  }
  p();

  p("## 5. Files Safe to Delete Now");
  p();
  p(`Total immediately deletable: **${fmt(safeNowBytes)}** (${safeNow.length} files)`);
  p();
  p("| Size | File | Reason |");
  p("|---|---|---|");
  for (const f of safeNow.slice(0, 60)) {
    p(`| ${fmtPad(f.sizeBytes, 8)} | \`${f.relPath}\` | ${f.reason} |`);
  }
  if (safeNow.length > 60) p(`| ... | _(${safeNow.length - 60} more files)_ | |`);
  p();

  p("## 6. Files That Must NOT Be Deleted");
  p();
  p("### Protected by pending upload queue");
  p();
  p(`Bytes blocked by pending uploads: **${fmt(blockedBytes)}** (${blocked.length} files, ${pendingQueueRows.length} queue entries across ${pendingContentIds.size} content items)`);
  p();
  p("### Must keep (audio cache, music, active content)");
  p();
  p(`Bytes in must-keep category: **${fmt(mustKeepBytes)}** (${mustKeep.length} files)`);
  p();
  const keepByType: Record<string, number> = {};
  for (const f of mustKeep) keepByType[f.category] = (keepByType[f.category] ?? 0) + f.sizeBytes;
  p("| Type | Size |");
  p("|---|---|");
  for (const [k, sz] of Object.entries(keepByType).sort((a, b) => b[1] - a[1])) {
    p(`| ${catLabels[k] ?? k} | ${fmt(sz)} |`);
  }
  p();

  p("## 7. Space Estimates");
  p();
  p("| Scenario | Bytes | Notes |");
  p("|---|---|---|");
  p(`| Safe to delete now | **${fmt(safeNowBytes)}** | Temp files + all output/ experiment/test dirs |`);
  p(`| Deletable after upload completes | **${fmt(blockedBytes)}** | Audio/video/images held by pending queue |`);
  p(`| Blocked / must keep | **${fmt(mustKeepBytes)}** | Cache, music, active non-queued content |`);
  p(`| Total scanned | **${fmt(grandTotal)}** | media/ + output/ |`);
  p();

  p("## 8. Recommended Cleanup Actions");
  p();
  p("### Priority 1 — Immediate (safe, no upload risk)");
  p();

  // Group safe-now by category
  const safeByCat: Record<string, FileEntry[]> = {};
  for (const f of safeNow) {
    if (!safeByCat[f.category]) safeByCat[f.category] = [];
    safeByCat[f.category].push(f);
  }

  const action1Items: Array<{label: string; cmd: string; size: number}> = [];

  if (safeByCat["tmp_stale"]?.length) {
    const sz = sumBytes(safeByCat["tmp_stale"]);
    action1Items.push({
      label: `Delete ${safeByCat["tmp_stale"].length} stale .tmp.wav files (${fmt(sz)})`,
      cmd: "find media/audio -name '*.tmp.wav' -o -name '*.repair.wav' | xargs rm -f",
      size: sz,
    });
  }
  if (safeByCat["test_dev"]?.length) {
    const sz = sumBytes(safeByCat["test_dev"]);
    action1Items.push({
      label: `Delete ${safeByCat["test_dev"].length} TTS test audio files (${fmt(sz)})`,
      cmd: "rm -f media/audio/tts-quick-*.wav media/audio/test-*.wav",
      size: sz,
    });
  }
  if (safeByCat["experiment_output"]?.length) {
    const sz = sumBytes(safeByCat["experiment_output"]);
    action1Items.push({
      label: `Delete entire output/ experiment directory (${fmt(sz)}) — all sub-dirs are test outputs not in DB`,
      cmd: "rm -rf output/short-cover-intro-experiment output/short-cover-intro-batch output/short-cover-hook output/test_thumbnails output/facebook-quote-style output/social-image-enhancer output/phase4 output/phase5 output/manifests output/demo_thumbnail.jpg output/demo_thumbnail.json",
      size: sz,
    });
  }

  for (const item of action1Items.sort((a, b) => b.size - a.size)) {
    p(`**${item.label}**`);
    p("```bash");
    p(item.cmd);
    p("```");
    p();
  }

  p("### Priority 2 — After pending uploads complete");
  p();
  p("Run the existing cleanup script once all queued items reach `status=done`:");
  p("```bash");
  p("# Dry run first:");
  p("pnpm cleanup:uploaded-assets");
  p("# Then delete:");
  p("pnpm cleanup:uploaded-assets:delete");
  p("```");
  p(`This will free up to **${fmt(blockedBytes)}** once uploads are done.`);
  p();

  p("### Priority 3 — Audio cache (optional, long-term)");
  p();
  p(`The TTS audio cache at \`media/audio-cache/\` holds **${fmt(dirTotals["audioCache"] ?? 0)}** of normalized WAV files.`);
  p("Each entry saves 2–8 minutes of TTS re-synthesis for repeated scripts.");
  p("Consider pruning only if cache entries are older than 90 days and the corresponding content is already published and cleaned.");
  p();

  p("### Do NOT touch");
  p();
  p("- `media/audio-cache/` — TTS cache; deletion forces full re-synthesis");
  p("- `media/music/` — static background music; not regenerable");
  p("- Any file whose content ID appears in `upload_queue WHERE status IN ('queued','uploading')`");

  const report = lines.join("\n");
  console.log(report);

  // Also write to docs/
  const reportPath = path.join(ROOT, "docs/STORAGE_USAGE_REPORT.md");
  fs.writeFileSync(reportPath, report, "utf-8");
  process.stderr.write(`\nReport written to: ${reportPath}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
