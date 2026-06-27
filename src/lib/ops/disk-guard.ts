/**
 * Disk space guard for Audio Story production. Pure/sync where possible so
 * it's cheap to call before every media-heavy step (TTS, render, cover,
 * upload) without adding real latency.
 *
 * Thresholds are configurable via env vars (no new app_config keys — these
 * are operator/ops-level knobs, not content settings, and don't need a DB
 * round trip on every guard check).
 */

import { execFileSync } from "child_process";

export type DiskGuardThresholds = {
  /** Below this, refuse to start a NEW production episode (existing in-flight work may still finish). */
  blockNewProductionBytes: number;
  /** Below this, hard-block all production; audit/report-only actions still allowed. */
  hardBlockProductionBytes: number;
  /** Below this, hard-block all render/TTS/media-heavy actions outright. */
  hardBlockMediaActionsBytes: number;
  /** Required headroom on top of 2x the estimated job size. */
  requiredHeadroomBytes: number;
};

const GB = 1024 * 1024 * 1024;

export const DEFAULT_DISK_GUARD_THRESHOLDS: DiskGuardThresholds = {
  blockNewProductionBytes: 40 * GB,
  hardBlockProductionBytes: 25 * GB,
  hardBlockMediaActionsBytes: 15 * GB,
  requiredHeadroomBytes: 10 * GB,
};

function envBytes(key: string, fallbackBytes: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallbackBytes;
  const parsedGb = Number(raw);
  return Number.isFinite(parsedGb) ? parsedGb * GB : fallbackBytes;
}

export function getDiskGuardThresholds(): DiskGuardThresholds {
  return {
    blockNewProductionBytes: envBytes("AUDIO_STORY_DISK_BLOCK_NEW_GB", DEFAULT_DISK_GUARD_THRESHOLDS.blockNewProductionBytes),
    hardBlockProductionBytes: envBytes("AUDIO_STORY_DISK_HARD_BLOCK_GB", DEFAULT_DISK_GUARD_THRESHOLDS.hardBlockProductionBytes),
    hardBlockMediaActionsBytes: envBytes("AUDIO_STORY_DISK_HARD_BLOCK_MEDIA_GB", DEFAULT_DISK_GUARD_THRESHOLDS.hardBlockMediaActionsBytes),
    requiredHeadroomBytes: envBytes("AUDIO_STORY_DISK_HEADROOM_GB", DEFAULT_DISK_GUARD_THRESHOLDS.requiredHeadroomBytes),
  };
}

/** Free bytes on the filesystem containing the given path (defaults to cwd). Read-only `df` call. */
export function getFreeDiskBytes(targetPath: string = process.cwd()): number {
  const output = execFileSync("df", ["-k", targetPath], { encoding: "utf8" });
  const lines = output.trim().split("\n");
  const lastLine = lines[lines.length - 1]!;
  const columns = lastLine.trim().split(/\s+/);
  // df -k columns: Filesystem 1K-blocks Used Available Capacity ... Mounted-on
  const availableKb = Number(columns[3]);
  if (!Number.isFinite(availableKb)) {
    throw new Error(`Could not parse df output: ${lastLine}`);
  }
  return availableKb * 1024;
}

/**
 * Rough estimate of disk needed for one Audio Story production episode pass
 * (chapter TTS WAVs + narration assembly + mixed audio + cover + rendered
 * MP4). Based on observed sizes for a ~50 minute episode (Phượng Hoàng Trở
 * Lại Ep.1: ~278MB chapter WAVs + ~278MB preview + ~278MB mixed + ~1.7GB
 * video), rounded up generously since TTS WAVs are uncompressed PCM and
 * scale with chapter count/length.
 */
export function estimateAudioStoryEpisodeJobBytes(params?: { chapterCount?: number }): number {
  const chapterCount = params?.chapterCount ?? 9;
  const perChapterWavBytes = 40 * 1024 * 1024; // ~40MB/chapter WAV, observed range 24-38MB
  const chapterWavTotal = perChapterWavBytes * chapterCount;
  const narrationPreviewBytes = chapterWavTotal; // narration-only assembly is roughly the same total duration
  const mixedAudioBytes = chapterWavTotal; // mixed WAV is the same duration/format as narration
  const coverBytes = 5 * 1024 * 1024; // cover artwork + final composited cover
  const videoBytes = 2 * 1024 * 1024 * 1024; // rendered MP4, observed ~1.7GB for this episode length
  return chapterWavTotal + narrationPreviewBytes + mixedAudioBytes + coverBytes + videoBytes;
}

export type DiskGuardAction = "new_production" | "render_or_tts" | "report_only";

export type DiskGuardDecision = {
  freeBytes: number;
  thresholds: DiskGuardThresholds;
  estimatedJobBytes: number;
  requiredFreeBytes: number;
  allowed: boolean;
  reason: string;
};

/**
 * Decide whether an action may proceed given current free disk space.
 * `report_only` (audit/cleanup-dry-run/disk-report) is always allowed —
 * it never writes large files and operators need it precisely when disk
 * is tight.
 */
export function evaluateDiskGuard(params: {
  action: DiskGuardAction;
  freeBytes?: number;
  estimatedJobBytes?: number;
  thresholds?: DiskGuardThresholds;
}): DiskGuardDecision {
  const thresholds = params.thresholds ?? getDiskGuardThresholds();
  const freeBytes = params.freeBytes ?? getFreeDiskBytes();
  const estimatedJobBytes = params.estimatedJobBytes ?? estimateAudioStoryEpisodeJobBytes();
  const requiredFreeBytes = estimatedJobBytes * 2 + thresholds.requiredHeadroomBytes;

  if (params.action === "report_only") {
    return {
      freeBytes,
      thresholds,
      estimatedJobBytes,
      requiredFreeBytes,
      allowed: true,
      reason: "Report-only actions (audit/cleanup dry-run) are always allowed regardless of disk pressure.",
    };
  }

  if (params.action === "render_or_tts" && freeBytes < thresholds.hardBlockMediaActionsBytes) {
    return {
      freeBytes,
      thresholds,
      estimatedJobBytes,
      requiredFreeBytes,
      allowed: false,
      reason: `Free disk (${(freeBytes / GB).toFixed(1)}GB) is below the hard media-action floor (${(thresholds.hardBlockMediaActionsBytes / GB).toFixed(0)}GB) — refusing TTS/render/cover/video steps.`,
    };
  }

  if (freeBytes < thresholds.hardBlockProductionBytes) {
    return {
      freeBytes,
      thresholds,
      estimatedJobBytes,
      requiredFreeBytes,
      allowed: false,
      reason: `Free disk (${(freeBytes / GB).toFixed(1)}GB) is below the hard production floor (${(thresholds.hardBlockProductionBytes / GB).toFixed(0)}GB) — refusing all production actions.`,
    };
  }

  if (params.action === "new_production" && freeBytes < thresholds.blockNewProductionBytes) {
    return {
      freeBytes,
      thresholds,
      estimatedJobBytes,
      requiredFreeBytes,
      allowed: false,
      reason: `Free disk (${(freeBytes / GB).toFixed(1)}GB) is below the new-episode floor (${(thresholds.blockNewProductionBytes / GB).toFixed(0)}GB) — refusing to start a new production episode.`,
    };
  }

  if (freeBytes < requiredFreeBytes) {
    return {
      freeBytes,
      thresholds,
      estimatedJobBytes,
      requiredFreeBytes,
      allowed: false,
      reason: `Free disk (${(freeBytes / GB).toFixed(1)}GB) is below the required headroom for this job (estimated ${(estimatedJobBytes / GB).toFixed(1)}GB × 2 + ${(thresholds.requiredHeadroomBytes / GB).toFixed(0)}GB headroom = ${(requiredFreeBytes / GB).toFixed(1)}GB).`,
    };
  }

  return {
    freeBytes,
    thresholds,
    estimatedJobBytes,
    requiredFreeBytes,
    allowed: true,
    reason: `Free disk (${(freeBytes / GB).toFixed(1)}GB) is sufficient for this action (requires ${(requiredFreeBytes / GB).toFixed(1)}GB).`,
  };
}
