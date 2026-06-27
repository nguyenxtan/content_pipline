/**
 * dev-reset.ts
 * Safely resets the Next.js dev cache (.next/).
 *
 * Without --kill: prints the process on port 3000 and asks user to stop it first.
 * With --kill: terminates the process on port 3000 before deleting .next/.
 *
 * Run:
 *   pnpm dev:reset        -- dry check, user stops server manually
 *   pnpm dev:reset:kill   -- auto-stop then clear cache
 */
import { execSync, spawnSync } from "child_process";
import fs from "fs";

const KILL = process.argv.includes("--kill");
const PORT = 3000;

function getPidsOnPort(port: number): number[] {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    return out
      .split("\n")
      .map((s) => parseInt(s.trim(), 10))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getProcessInfo(pid: number): string {
  try {
    return execSync(`ps -p ${pid} -o pid,comm,args`, { encoding: "utf8" })
      .split("\n")
      .slice(1)
      .join("\n")
      .trim();
  } catch {
    return `PID ${pid} (already gone)`;
  }
}

function isNextProcess(pid: number): boolean {
  try {
    const args = execSync(`ps -p ${pid} -o args=`, { encoding: "utf8" }).trim();
    return args.includes("next") && !args.includes("Google Chrome") && !args.includes("Chrome Helper");
  } catch {
    return false;
  }
}

function deleteNext(): void {
  if (!fs.existsSync(".next")) {
    console.log(".next/ does not exist — nothing to delete.");
    return;
  }
  fs.rmSync(".next", { recursive: true, force: true });
  if (fs.existsSync(".next")) {
    console.error("ERROR: Failed to remove .next/");
    process.exit(1);
  }
  console.log("✓ .next/ deleted.");
}

function main(): void {
  const pids = getPidsOnPort(PORT);
  const nextPids = pids.filter(isNextProcess);

  console.log(`\n=== Dev Reset (port ${PORT}) ===`);

  if (pids.length === 0) {
    console.log(`No process on port ${PORT} — safe to clear.`);
    deleteNext();
    console.log(`\nRun: pnpm dev`);
    process.exit(0);
  }

  console.log(`\nProcesses on port ${PORT}:`);
  for (const pid of pids) {
    console.log(`  ${getProcessInfo(pid)}`);
  }

  if (nextPids.length === 0) {
    console.log(`\nNo Next.js server detected on port ${PORT} (Chrome/other process holds it).`);
    console.log("Clearing .next/ anyway — it will not affect the Chrome process.");
    deleteNext();
    console.log(`\nRun: pnpm dev`);
    process.exit(0);
  }

  if (!KILL) {
    console.log(`\n⚠ Next.js dev server is running on port ${PORT} (PIDs: ${nextPids.join(", ")}).`);
    console.log("Stop it first, then re-run this script. Or use:");
    console.log("  pnpm dev:reset:kill   ← auto-stop then clear\n");
    process.exit(1);
  }

  // --kill mode
  console.log(`\nStopping Next.js server (PIDs: ${nextPids.join(", ")})...`);
  for (const pid of nextPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch { /* already gone */ }
  }

  // Also kill the parent pnpm/node wrapper
  const allNextPids = pids.filter(p => !isNextProcess(p) === false || true).filter(p => {
    // kill all node/pnpm processes on this port that aren't Chrome
    try {
      const args = execSync(`ps -p ${p} -o args=`, { encoding: "utf8" }).trim();
      return !args.includes("Google Chrome") && !args.includes("Chrome Helper");
    } catch { return false; }
  });
  for (const pid of allNextPids) {
    try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }
  }

  // Wait for port to clear
  let cleared = false;
  for (let i = 0; i < 10; i++) {
    spawnSync("sleep", ["0.5"]);
    const remaining = getPidsOnPort(PORT).filter(isNextProcess);
    if (remaining.length === 0) {
      cleared = true;
      break;
    }
  }

  if (!cleared) {
    console.log("SIGTERM did not clear port — sending SIGKILL...");
    for (const pid of nextPids) {
      try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
    }
    spawnSync("sleep", ["1"]);
  }

  console.log(`✓ Next.js server stopped.`);
  deleteNext();
  console.log(`\nRun: pnpm dev\n`);
}

main();
