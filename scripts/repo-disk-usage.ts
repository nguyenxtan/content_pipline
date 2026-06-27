import { execSync } from "child_process";
import path from "path";

type SizeRow = {
  label: string;
  bytes: number | null;
};

function run(command: string): string {
  try {
    return execSync(command, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      shell: "/bin/zsh",
    }).trim();
  } catch {
    return "";
  }
}

function toBytesFromDuKilobytes(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed * 1024 : null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function sizeForTarget(target: string): number | null {
  const output = run(`du -sk ${JSON.stringify(target)} 2>/dev/null | awk '{print $1}'`);
  return output ? toBytesFromDuKilobytes(output) : null;
}

function collectTopDirectories(limit: number): Array<{ path: string; bytes: number }> {
  const output = run(`find . -type d -print0 | xargs -0 du -sk 2>/dev/null | sort -nr | head -n ${limit + 1}`);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf("\t") >= 0 ? line.indexOf("\t") : line.indexOf(" ");
      const size = line.slice(0, firstSpace).trim();
      const targetPath = line.slice(firstSpace).trim();
      return {
        path: targetPath,
        bytes: toBytesFromDuKilobytes(size) ?? 0,
      };
    })
    .slice(0, limit);
}

function collectTopFiles(limit: number): Array<{ path: string; bytes: number }> {
  const output = run(`find . -type f -print0 | xargs -0 stat -f '%z %N' 2>/dev/null | sort -nr | head -n ${limit}`);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(" ");
      return {
        bytes: Number(line.slice(0, firstSpace)),
        path: line.slice(firstSpace + 1),
      };
    })
    .filter((row) => Number.isFinite(row.bytes));
}

function collectPnpmStores(): SizeRow[] {
  const home = process.env.HOME ?? "";
  const candidates = [
    path.join(home, "Library/pnpm"),
    path.join(home, "Library/Caches/pnpm"),
    path.join(home, ".pnpm-store"),
    path.join(home, ".local/share/pnpm"),
  ];
  return candidates
    .map((candidate) => ({ label: candidate, bytes: sizeForTarget(candidate) }))
    .filter((row) => row.bytes !== null);
}

const repoRoot = process.cwd();
const codeRoot = path.resolve(repoRoot, "..");
const rows: SizeRow[] = [
  { label: "repo root total", bytes: sizeForTarget(".") },
  { label: "~/code total", bytes: sizeForTarget(codeRoot) },
  { label: "node_modules", bytes: sizeForTarget("node_modules") },
  { label: ".next", bytes: sizeForTarget(".next") },
  { label: ".git", bytes: sizeForTarget(".git") },
  { label: "media", bytes: sizeForTarget("media") },
  { label: "output", bytes: sizeForTarget("output") },
  { label: ".next/dev/cache", bytes: sizeForTarget(".next/dev/cache") },
  { label: ".next/cache", bytes: sizeForTarget(".next/cache") },
  { label: "media/audio-cache", bytes: sizeForTarget("media/audio-cache") },
  { label: "drizzle", bytes: sizeForTarget("drizzle") },
  { label: "docs", bytes: sizeForTarget("docs") },
  { label: "src", bytes: sizeForTarget("src") },
];

console.log(`# Repo Disk Usage`);
console.log(`Generated: ${new Date().toISOString()}`);
console.log("");
console.log("## Key sizes");
for (const row of rows) {
  console.log(`- ${row.label}: ${formatBytes(row.bytes)}`);
}

const pnpmStores = collectPnpmStores();
if (pnpmStores.length > 0) {
  console.log("");
  console.log("## pnpm stores");
  for (const row of pnpmStores) {
    console.log(`- ${row.label}: ${formatBytes(row.bytes)}`);
  }
}

console.log("");
console.log("## Top 20 directories");
for (const row of collectTopDirectories(20)) {
  console.log(`- ${row.path}: ${formatBytes(row.bytes)}`);
}

console.log("");
console.log("## Top 30 files");
for (const row of collectTopFiles(30)) {
  console.log(`- ${row.path}: ${formatBytes(row.bytes)}`);
}
