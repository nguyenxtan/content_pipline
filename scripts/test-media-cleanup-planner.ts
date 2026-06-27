import assert from "node:assert/strict";
import path from "path";
import { planCleanupCandidates } from "./cleanup-media-storage";

const protectedPaths = new Set([path.resolve("media/story-renders/story-1/episode-001-ch001-ch009.preview.mp4")]);

const statSizes: Record<string, number> = {
  "media/story-renders/story-1/episode-001-ch001-ch009.preview.mp4": 1000,
  "media/story-renders/story-1/old-attempt.mp4": 500,
  "media/story-renders/story-1/scratch.tmp": 10,
  "media/story-renders/story-1/failed-render.mp4": 0,
  "media/story-covers/story-1/episode-001-ch001-ch009-cover.jpg": 200,
};

function statSync(filePath: string): { size: number } {
  return { size: statSizes[filePath] ?? 0 };
}

// Protected paths must never appear as candidates, even though they're files under the scanned root.
{
  const candidates = planCleanupCandidates({
    allFilesByRoot: { "media/story-renders": Object.keys(statSizes).filter((p) => p.includes("story-renders")) },
    statSync,
    protectedPaths,
  });
  const candidatePaths = candidates.map((c) => c.path);
  assert.equal(candidatePaths.includes("media/story-renders/story-1/episode-001-ch001-ch009.preview.mp4"), false);
}

// A .tmp file is classified SAFE regardless of protection status.
{
  const candidates = planCleanupCandidates({
    allFilesByRoot: { "media/story-renders": ["media/story-renders/story-1/scratch.tmp"] },
    statSync,
    protectedPaths,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.safety, "SAFE");
  assert.match(candidates[0]!.reason, /temp file/);
}

// A zero-byte file is classified SAFE (failed/incomplete output).
{
  const candidates = planCleanupCandidates({
    allFilesByRoot: { "media/story-renders": ["media/story-renders/story-1/failed-render.mp4"] },
    statSync,
    protectedPaths,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.safety, "SAFE");
  assert.match(candidates[0]!.reason, /zero-byte/);
}

// An unprotected, non-temp, non-zero-byte file is flagged NEEDS_REVIEW, never auto-deleted.
{
  const candidates = planCleanupCandidates({
    allFilesByRoot: { "media/story-renders": ["media/story-renders/story-1/old-attempt.mp4"] },
    statSync,
    protectedPaths,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.safety, "NEEDS_REVIEW");
}

// A cover file referenced by the protected-path set must never appear as a candidate.
{
  const coverProtected = new Set([path.resolve("media/story-covers/story-1/episode-001-ch001-ch009-cover.jpg")]);
  const candidates = planCleanupCandidates({
    allFilesByRoot: { "media/story-covers": ["media/story-covers/story-1/episode-001-ch001-ch009-cover.jpg"] },
    statSync,
    protectedPaths: coverProtected,
  });
  assert.equal(candidates.length, 0);
}

console.log("test:media-cleanup-planner passed");
