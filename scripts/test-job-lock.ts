import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { acquireJobLock, releaseJobLock } from "@/lib/ops/job-lock";

const lockPath = path.join(os.tmpdir(), `test-job-lock-${Date.now()}.lock`);

// First acquire succeeds.
{
  const result = acquireJobLock(lockPath, { mode: "test-lock" });
  assert.equal(result.acquired, true);
  assert.equal(fs.existsSync(lockPath), true);
  const payload = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid: number; startedAt: string; mode?: string };
  assert.equal(payload.pid, process.pid);
  assert.equal(payload.mode, "test-lock");
}

// A second acquire while the current process (alive) holds the lock fails.
{
  const result = acquireJobLock(lockPath);
  assert.equal(result.acquired, false);
}

// Release clears the lock.
{
  releaseJobLock(lockPath);
  assert.equal(fs.existsSync(lockPath), false);
}

// A stale lock (PID that's not running) is reclaimed rather than blocking forever.
{
  const deadPid = 999999; // exceedingly unlikely to be a real running pid
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: deadPid,
      startedAt: new Date(0).toISOString(),
      mode: "stale-test",
    }),
    "utf8"
  );
  const result = acquireJobLock(lockPath);
  assert.equal(result.acquired, true);
  if (result.acquired) {
    assert.equal(result.replacedStale?.previous?.pid, deadPid);
  }
  releaseJobLock(lockPath);
}

console.log("test:job-lock passed");
