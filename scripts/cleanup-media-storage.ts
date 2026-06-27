/**
 * F4.45 — Safe Audio Story media cleanup planner. Dry-run by default;
 * only deletes when MEDIA_CLEANUP_EXECUTE=1 (and optionally
 * MEDIA_CLEANUP_CONFIRM=YES) is set.
 *
 * Scope is intentionally narrow: only the Audio Story media trees
 * (media/story-renders, media/story-covers, media/story-audio) plus
 * generic ffmpeg/concat temp-file patterns anywhere under media/. Never
 * touches anything outside `media/`. Never deletes a path that is
 * protected (referenced by a *.production-state.json snapshot, a shared
 * intro/outro asset, or a chapter body WAV).
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const EXECUTE = process.env.MEDIA_CLEANUP_EXECUTE === "1";
const CONFIRMED = process.env.MEDIA_CLEANUP_CONFIRM === "YES";
const SAFE_ROOTS = ["media/story-renders", "media/story-covers", "media/story-audio"];
const TEMP_PATTERNS = [/\.tmp$/i, /\.partial$/i, /ffmpeg-concat.*\.txt$/i, /-concat\.txt$/i, /\.ffmpeg-tmp$/i];

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }).trim();
  } catch {
    return "";
  }
}

function listAllFiles(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) return [];
  const output = run("find", [rootPath, "-type", "f"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function findProductionStateFiles(): string[] {
  const output = run("find", ["media/story-audio", "-name", "*.production-state.json", "-type", "f"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

/** Same protection logic as audit-media-storage.ts — duplicated minimally on purpose so cleanup never depends on the audit script having run first. */
function collectProtectedPaths(): Set<string> {
  const protected_ = new Set<string>();
  for (const statePath of findProductionStateFiles()) {
    protected_.add(path.resolve(statePath));
    try {
      const snapshot = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
      for (const key of ["coverPath", "mixedAudioPath", "videoPath"]) {
        const value = snapshot[key];
        if (typeof value === "string" && value) protected_.add(path.resolve(value));
      }
      const dir = path.dirname(statePath);
      const label = path.basename(statePath).replace(/\.production-state\.json$/, "");
      if (fs.existsSync(dir)) {
        for (const entry of fs.readdirSync(dir)) {
          if (entry.startsWith(label)) protected_.add(path.resolve(path.join(dir, entry)));
        }
      }
      const storyMatch = /media\/story-audio\/([^/]+)\/episodes\//.exec(statePath);
      if (storyMatch) {
        const coverDir = `media/story-covers/${storyMatch[1]}`;
        if (fs.existsSync(coverDir)) {
          for (const entry of fs.readdirSync(coverDir)) {
            if (entry.startsWith(label)) protected_.add(path.resolve(path.join(coverDir, entry)));
          }
        }
        const renderDir = `media/story-renders/${storyMatch[1]}`;
        if (fs.existsSync(renderDir)) {
          for (const entry of fs.readdirSync(renderDir)) {
            if (entry.startsWith(label)) protected_.add(path.resolve(path.join(renderDir, entry)));
          }
        }
        const chaptersDir = `media/story-audio/${storyMatch[1]}/chapters`;
        if (fs.existsSync(chaptersDir)) {
          for (const entry of fs.readdirSync(chaptersDir)) {
            protected_.add(path.resolve(path.join(chaptersDir, entry)));
          }
        }
      }
    } catch {
      // unreadable/corrupt snapshot — keep the file itself protected, skip derived paths
    }
  }
  if (fs.existsSync("media/story-audio/assets")) {
    for (const entry of fs.readdirSync("media/story-audio/assets")) {
      protected_.add(path.resolve(path.join("media/story-audio/assets", entry)));
    }
  }
  return protected_;
}

export type CleanupCandidate = {
  path: string;
  bytes: number;
  reason: string;
  safety: "SAFE" | "NEEDS_REVIEW";
};

/** Pure planning function — no fs mutation, no process.env reads. Exported for tests. */
export function planCleanupCandidates(params: {
  allFilesByRoot: Record<string, string[]>;
  statSync: (filePath: string) => { size: number };
  protectedPaths: Set<string>;
}): CleanupCandidate[] {
  const candidates: CleanupCandidate[] = [];

  for (const [root, files] of Object.entries(params.allFilesByRoot)) {
    for (const filePath of files) {
      const resolved = path.resolve(filePath);
      if (params.protectedPaths.has(resolved)) continue;

      const isTempFile = TEMP_PATTERNS.some((pattern) => pattern.test(filePath));
      let size = 0;
      try {
        size = params.statSync(filePath).size;
      } catch {
        continue;
      }

      if (isTempFile) {
        candidates.push({ path: filePath, bytes: size, reason: "ffmpeg/concat temp file pattern", safety: "SAFE" });
        continue;
      }

      if (size === 0) {
        candidates.push({ path: filePath, bytes: 0, reason: "zero-byte file — failed/incomplete output", safety: "SAFE" });
        continue;
      }

      // Any other file under the Audio Story media roots that is not referenced by
      // any production-state snapshot, shared asset, or chapter body — i.e. an
      // orphaned/superseded artifact (old preview render, stale cover artwork,
      // dangling sidecar). Flagged for review rather than auto-deleted by default,
      // since the production-state model is still young and a false negative here
      // (mis-detecting something as orphaned) would be a real loss.
      candidates.push({
        path: filePath,
        bytes: size,
        reason: `Not referenced by any production-state.json or protected asset list under ${root}`,
        safety: "NEEDS_REVIEW",
      });
    }
  }

  return candidates;
}

function main() {
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  Audio Story Media Cleanup Planner");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`  Mode: ${EXECUTE ? "🔴 EXECUTE (will delete SAFE candidates)" : "🧪 DRY RUN (default — no deletion)"}`);

  const protectedPaths = collectProtectedPaths();
  const allFilesByRoot: Record<string, string[]> = {};
  for (const root of SAFE_ROOTS) {
    allFilesByRoot[root] = listAllFiles(root);
  }

  const candidates = planCleanupCandidates({
    allFilesByRoot,
    statSync: (filePath) => fs.statSync(filePath),
    protectedPaths,
  });

  const safeCandidates = candidates.filter((c) => c.safety === "SAFE");
  const reviewCandidates = candidates.filter((c) => c.safety === "NEEDS_REVIEW");
  const safeBytes = safeCandidates.reduce((sum, c) => sum + c.bytes, 0);
  const reviewBytes = reviewCandidates.reduce((sum, c) => sum + c.bytes, 0);

  console.log(`\n  Scanned roots: ${SAFE_ROOTS.join(", ")}`);
  console.log(`  Protected paths recognized: ${protectedPaths.size}`);

  console.log(`\n  SAFE candidates (temp files, zero-byte outputs): ${safeCandidates.length}, ${formatBytes(safeBytes)}`);
  for (const c of safeCandidates) {
    console.log(`    ${formatBytes(c.bytes).padStart(8)}  ${c.path}  — ${c.reason}`);
  }

  console.log(`\n  NEEDS_REVIEW candidates (orphaned, not auto-deleted): ${reviewCandidates.length}, ${formatBytes(reviewBytes)}`);
  for (const c of reviewCandidates.slice(0, 30)) {
    console.log(`    ${formatBytes(c.bytes).padStart(8)}  ${c.path}  — ${c.reason}`);
  }
  if (reviewCandidates.length > 30) console.log(`    ... and ${reviewCandidates.length - 30} more`);

  console.log(`\n  Total reclaimable if all SAFE candidates deleted: ${formatBytes(safeBytes)}`);
  console.log(`  Total reclaimable if NEEDS_REVIEW candidates are also confirmed and deleted: ${formatBytes(safeBytes + reviewBytes)}`);

  if (!EXECUTE) {
    console.log("\n  Dry run only — no files were deleted. Set MEDIA_CLEANUP_EXECUTE=1 to delete SAFE candidates.");
    console.log("\nPASS (dry run)\n");
    return;
  }

  if (!CONFIRMED) {
    console.log("\n  MEDIA_CLEANUP_EXECUTE=1 was set but MEDIA_CLEANUP_CONFIRM=YES was not. Refusing to delete without explicit confirmation.");
    console.log("\nFAIL (confirmation missing)\n");
    process.exit(1);
  }

  if (safeCandidates.length === 0) {
    console.log("\n  Nothing to delete — no SAFE candidates found.");
    console.log("\nPASS (nothing to do)\n");
    return;
  }

  console.log("\n  Deleting SAFE candidates...");
  let deletedBytes = 0;
  for (const candidate of safeCandidates) {
    const resolved = path.resolve(candidate.path);
    if (!SAFE_ROOTS.some((root) => resolved.startsWith(path.resolve(root)))) {
      console.log(`    SKIP (outside safe roots): ${candidate.path}`);
      continue;
    }
    if (fs.lstatSync(candidate.path).isSymbolicLink()) {
      console.log(`    SKIP (symlink, not following): ${candidate.path}`);
      continue;
    }
    fs.unlinkSync(candidate.path);
    deletedBytes += candidate.bytes;
    console.log(`    DELETED  ${formatBytes(candidate.bytes).padStart(8)}  ${candidate.path}`);
  }
  console.log(`\n  Deleted ${safeCandidates.length} files, reclaimed ${formatBytes(deletedBytes)}.`);
  console.log("\nPASS (execute)\n");
}

if (require.main === module) {
  main();
}
