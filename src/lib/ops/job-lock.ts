/**
 * Minimal exclusive file-lock helper for single-machine cron/scheduler
 * jobs (e.g. the nightly Audio Story production wrapper). Not a
 * distributed lock — this repo's pipeline already runs cron on one
 * machine (ADR-010), so a PID-checked lock file is sufficient.
 */

import fs from "fs";
import path from "path";

export type JobLockPayload = {
  pid: number;
  startedAt: string;
  mode?: string | null;
};

export type JobLockResult =
  | {
      acquired: true;
      replacedStale?: JobLockReplacement;
    }
  | {
      acquired: false;
      reason: string;
      existing: JobLockPayload | null;
    };

export type JobLockReplacement = {
  reason: string;
  previous: JobLockPayload | null;
};

export type AcquireJobLockOptions = {
  mode?: string | null;
};

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseLockPayload(raw: string): JobLockPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const legacyPid = Number(trimmed);
  if (Number.isFinite(legacyPid) && legacyPid > 0) {
    return {
      pid: legacyPid,
      startedAt: new Date(0).toISOString(),
      mode: null,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<JobLockPayload>;
    if (!parsed || typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid) || parsed.pid <= 0) {
      return null;
    }

    return {
      pid: parsed.pid,
      startedAt: typeof parsed.startedAt === "string" && parsed.startedAt ? parsed.startedAt : new Date(0).toISOString(),
      mode: typeof parsed.mode === "string" ? parsed.mode : null,
    };
  } catch {
    return null;
  }
}

function readLockPayload(lockPath: string): JobLockPayload | null {
  try {
    return parseLockPayload(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function writeLockFile(lockPath: string, payload: JobLockPayload) {
  const fd = fs.openSync(lockPath, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(payload), "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** Acquires the lock atomically, reclaiming it if the previous holder's PID is no longer running. */
export function acquireJobLock(lockPath: string, options?: AcquireJobLockOptions): JobLockResult {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const payload: JobLockPayload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    mode: options?.mode ?? null,
  };

  let replacedStale: JobLockReplacement | undefined;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      writeLockFile(lockPath, payload);
      return replacedStale ? { acquired: true, replacedStale } : { acquired: true };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "EEXIST") {
        throw error;
      }

      const existing = readLockPayload(lockPath);
      const stillRunning = existing?.pid ? isPidAlive(existing.pid) : false;
      if (stillRunning) {
        return {
          acquired: false,
          reason: `Lock held by running pid ${existing.pid}.`,
          existing,
        };
      }

      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkError) {
        const unlinkNodeError = unlinkError as NodeJS.ErrnoException;
        if (unlinkNodeError.code !== "ENOENT") {
          throw unlinkError;
        }
      }

      replacedStale = {
        reason: existing?.pid
          ? `Replaced stale lock from pid ${existing.pid}.`
          : "Replaced stale or malformed lock file.",
        previous: existing,
      };
    }
  }

  throw new Error(`Unable to acquire lock after repeated stale-lock retries: ${lockPath}`);
}

/** Releases the lock only if it's still owned by the current process (avoids releasing a lock reclaimed by another process). */
export function releaseJobLock(lockPath: string): void {
  try {
    const existing = readLockPayload(lockPath);
    if (existing?.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // best-effort; a leftover lock will be reclaimed next run if this process is gone
  }
}
