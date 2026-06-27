/**
 * F4.45 — Read-only disk/media storage audit. Never deletes anything.
 *
 * Reports filesystem free/total/used, media directory breakdown, largest
 * files/directories, stale temp/cache files, naive duplicate-size
 * candidates, and which Audio Story production artifacts are protected
 * (derived from every `*.production-state.json` snapshot on disk, not
 * hardcoded to one story).
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { getFreeDiskBytes } from "@/lib/ops/disk-guard";

const GB = 1024 * 1024 * 1024;
const AS_JSON = process.argv.includes("--json");
const STALE_DAYS = Number(process.env.AUDIT_STALE_DAYS ?? "14");

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

function duBytes(targetPath: string): number {
  if (!fs.existsSync(targetPath)) return 0;
  const output = run("du", ["-sk", targetPath]);
  const kb = Number(output.split(/\s+/)[0]);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

function listAllFiles(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) return [];
  const output = run("find", [rootPath, "-type", "f"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function topFiles(rootPath: string, limit: number): Array<{ path: string; bytes: number; mtime: Date }> {
  const files = listAllFiles(rootPath);
  const rows = files.map((filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return { path: filePath, bytes: stat.size, mtime: stat.mtime };
    } catch {
      return { path: filePath, bytes: 0, mtime: new Date(0) };
    }
  });
  return rows.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

function topDirectories(rootPath: string, limit: number): Array<{ path: string; bytes: number }> {
  if (!fs.existsSync(rootPath)) return [];
  const output = run("sh", ["-c", `find ${JSON.stringify(rootPath)} -mindepth 1 -type d -exec du -sk {} \\; 2>/dev/null | sort -rn | head -n ${limit}`]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [kb, ...rest] = line.trim().split(/\s+/);
      return { path: rest.join(" "), bytes: (Number(kb) || 0) * 1024 };
    });
}

function findProductionStateFiles(): string[] {
  const output = run("find", ["media/story-audio", "-name", "*.production-state.json", "-type", "f"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

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
      // Sibling files in the same episodes/ dir that share the production naming
      // convention (preview wav, sample clip, mixed json, etc.) are part of the
      // same production pass and are protected too.
      const dir = path.dirname(statePath);
      const label = path.basename(statePath).replace(/\.production-state\.json$/, "");
      if (fs.existsSync(dir)) {
        for (const entry of fs.readdirSync(dir)) {
          if (entry.startsWith(label)) protected_.add(path.resolve(path.join(dir, entry)));
        }
      }
      // The artwork/cover directory for this story shares the same label prefix.
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
        // All chapter body WAVs and shared intro/outro assets for this story are protected.
        const chaptersDir = `media/story-audio/${storyMatch[1]}/chapters`;
        if (fs.existsSync(chaptersDir)) {
          for (const entry of fs.readdirSync(chaptersDir)) {
            protected_.add(path.resolve(path.join(chaptersDir, entry)));
          }
        }
      }
    } catch {
      // unreadable/corrupt snapshot — still protect the file itself, just skip derived paths
    }
  }
  if (fs.existsSync("media/story-audio/assets")) {
    for (const entry of fs.readdirSync("media/story-audio/assets")) {
      protected_.add(path.resolve(path.join("media/story-audio/assets", entry)));
    }
  }
  return protected_;
}

function findStaleFiles(rootPath: string, olderThanDays: number): Array<{ path: string; bytes: number; ageDays: number }> {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  return listAllFiles(rootPath)
    .map((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return { path: filePath, bytes: stat.size, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((row): row is { path: string; bytes: number; mtimeMs: number } => row !== null && row.mtimeMs < cutoff)
    .map((row) => ({ path: row.path, bytes: row.bytes, ageDays: Math.round((Date.now() - row.mtimeMs) / (24 * 60 * 60 * 1000)) }))
    .sort((a, b) => b.bytes - a.bytes);
}

function findDuplicateSizeCandidates(rootPath: string, minBytes: number): Array<{ bytes: number; paths: string[] }> {
  const bySize = new Map<number, string[]>();
  for (const filePath of listAllFiles(rootPath)) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < minBytes) continue;
      const list = bySize.get(stat.size) ?? [];
      list.push(filePath);
      bySize.set(stat.size, list);
    } catch {
      // ignore unreadable file
    }
  }
  return [...bySize.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([bytes, paths]) => ({ bytes, paths }))
    .sort((a, b) => b.bytes * b.paths.length - a.bytes * a.paths.length);
}

function main() {
  const freeBytes = getFreeDiskBytes();
  const dfOutput = run("df", ["-k", "."]);
  const dfLine = dfOutput.split("\n").pop() ?? "";
  const dfColumns = dfLine.trim().split(/\s+/);
  const totalBytes = (Number(dfColumns[1]) || 0) * 1024;
  const usedBytes = (Number(dfColumns[2]) || 0) * 1024;

  const repoBytes = duBytes(".");
  const mediaBytes = duBytes("media");

  const categories = [
    "media/story-audio",
    "media/story-renders",
    "media/story-covers",
    "media/story-videos",
    "media/story-upload-packages",
    "media/story-audio-cache",
    "media/music",
    "media/audio",
    "media/audio-cache",
    "media/images",
    "media/covers",
    "media/videos",
    "media/cache",
    "media/backups",
    "media/news-images",
    "media/finance-news-drafts",
  ].map((dir) => ({ dir, bytes: duBytes(dir) }));

  const protectedPaths = collectProtectedPaths();
  const staleCacheDirs = ["media/audio-cache", "media/story-audio-cache", "media/cache", "media/backups"];
  const staleFiles = staleCacheDirs.flatMap((dir) => findStaleFiles(dir, STALE_DAYS));
  const staleNotProtected = staleFiles.filter((f) => !protectedPaths.has(path.resolve(f.path)));
  const staleBytes = staleNotProtected.reduce((sum, f) => sum + f.bytes, 0);

  const duplicateCandidates = findDuplicateSizeCandidates("media", 1024 * 1024).slice(0, 15);

  const largestFiles = topFiles("media", 30);
  const largestDirs = topDirectories("media", 20);

  const estimatedReclaimBytes = staleBytes;

  const report = {
    generatedAt: new Date().toISOString(),
    filesystem: {
      freeBytes,
      totalBytes,
      usedBytes,
      freeReadable: formatBytes(freeBytes),
      totalReadable: formatBytes(totalBytes),
      usedReadable: formatBytes(usedBytes),
    },
    repo: { bytes: repoBytes, readable: formatBytes(repoBytes) },
    media: { bytes: mediaBytes, readable: formatBytes(mediaBytes) },
    categories: categories.map((c) => ({ ...c, readable: formatBytes(c.bytes) })),
    largestFiles: largestFiles.map((f) => ({ ...f, readable: formatBytes(f.bytes) })),
    largestDirectories: largestDirs.map((d) => ({ ...d, readable: formatBytes(d.bytes) })),
    staleFilesOlderThanDays: STALE_DAYS,
    staleCandidateCount: staleNotProtected.length,
    staleCandidateBytes: staleBytes,
    staleCandidateReadable: formatBytes(staleBytes),
    duplicateSizeCandidateGroups: duplicateCandidates.length,
    protectedPathCount: protectedPaths.size,
    estimatedSafeReclaimBytes: estimatedReclaimBytes,
    estimatedSafeReclaimReadable: formatBytes(estimatedReclaimBytes),
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  Media Storage Audit (read-only)");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`  Free disk : ${formatBytes(freeBytes)} (${(freeBytes / GB).toFixed(1)} GB)`);
  console.log(`  Total disk: ${formatBytes(totalBytes)}`);
  console.log(`  Used disk : ${formatBytes(usedBytes)}`);
  console.log(`  Repo size : ${formatBytes(repoBytes)}`);
  console.log(`  media/    : ${formatBytes(mediaBytes)}`);

  console.log("\n  Category sizes:");
  for (const c of categories.filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes)) {
    console.log(`    ${formatBytes(c.bytes).padStart(8)}  ${c.dir}`);
  }

  console.log(`\n  Top ${largestFiles.length} largest files under media/:`);
  for (const f of largestFiles) {
    console.log(`    ${formatBytes(f.bytes).padStart(8)}  ${f.path}  (mtime ${f.mtime.toISOString().slice(0, 10)})`);
  }

  console.log(`\n  Top ${largestDirs.length} largest directories under media/:`);
  for (const d of largestDirs) {
    console.log(`    ${formatBytes(d.bytes).padStart(8)}  ${d.path}`);
  }

  console.log(`\n  Stale files (>${STALE_DAYS}d) in cache/backup dirs, excluding protected production artifacts:`);
  console.log(`    ${staleNotProtected.length} files, ${formatBytes(staleBytes)} reclaimable`);
  for (const f of staleNotProtected.slice(0, 15)) {
    console.log(`    ${formatBytes(f.bytes).padStart(8)}  age=${f.ageDays}d  ${f.path}`);
  }

  console.log(`\n  Duplicate-size candidate groups (same byte size, naive heuristic): ${duplicateCandidates.length}`);
  for (const group of duplicateCandidates.slice(0, 8)) {
    console.log(`    ${formatBytes(group.bytes)} × ${group.paths.length}: ${group.paths.slice(0, 3).join(", ")}${group.paths.length > 3 ? ", ..." : ""}`);
  }

  console.log(`\n  Protected Audio Story production paths recognized: ${protectedPaths.size}`);
  console.log(`  Estimated safe-to-reclaim (stale cache only, excludes anything protected): ${formatBytes(estimatedReclaimBytes)}`);
  console.log("\n  Read-only — no files were deleted or modified.");
  console.log("\nPASS (audit complete)\n");
}

main();
