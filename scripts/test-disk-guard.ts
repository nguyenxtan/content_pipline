import assert from "node:assert/strict";
import { DEFAULT_DISK_GUARD_THRESHOLDS, evaluateDiskGuard } from "@/lib/ops/disk-guard";

const GB = 1024 * 1024 * 1024;
const thresholds = DEFAULT_DISK_GUARD_THRESHOLDS;

// report_only is always allowed, even with almost no free disk.
{
  const decision = evaluateDiskGuard({ action: "report_only", freeBytes: 1 * GB, thresholds });
  assert.equal(decision.allowed, true);
}

// new_production is blocked below the 40GB floor.
{
  const decision = evaluateDiskGuard({ action: "new_production", freeBytes: 39 * GB, thresholds, estimatedJobBytes: 5 * GB });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /new-episode floor/);
}

// new_production is allowed above the 40GB floor with enough headroom for the job.
{
  const decision = evaluateDiskGuard({ action: "new_production", freeBytes: 60 * GB, thresholds, estimatedJobBytes: 5 * GB });
  assert.equal(decision.allowed, true);
}

// render_or_tts is hard-blocked below the 15GB media-action floor, even though it's
// technically above the headroom requirement for a tiny job.
{
  const decision = evaluateDiskGuard({ action: "render_or_tts", freeBytes: 14 * GB, thresholds, estimatedJobBytes: 1 * GB });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /hard media-action floor/);
}

// Between 15GB and 25GB, render/TTS actions are blocked by the production floor (25GB),
// not just the media-action floor.
{
  const decision = evaluateDiskGuard({ action: "render_or_tts", freeBytes: 20 * GB, thresholds, estimatedJobBytes: 1 * GB });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /hard production floor/);
}

// Above 25GB but the estimated job (×2 + headroom) doesn't fit — blocked by headroom math.
{
  const decision = evaluateDiskGuard({ action: "render_or_tts", freeBytes: 30 * GB, thresholds, estimatedJobBytes: 12 * GB });
  // requiredFreeBytes = 12*2 + 10 = 34GB > 30GB free
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /required headroom/);
}

// Plenty of free disk and a small job — allowed.
{
  const decision = evaluateDiskGuard({ action: "render_or_tts", freeBytes: 100 * GB, thresholds, estimatedJobBytes: 5 * GB });
  assert.equal(decision.allowed, true);
}

console.log("test:disk-guard passed");
