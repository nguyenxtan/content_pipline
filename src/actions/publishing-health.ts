"use server";

import { db } from "@/lib/db";
import {
  contentGenerations,
  publishedVideos,
  uploadQueue,
  videoMetricSnapshots,
} from "@/lib/db/schema";
import { cleanupUploadedAssetsAction } from "@/actions/cleanup-uploaded-assets";

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type HealthDistributionRow = {
  key: string;
  count: number;
  percent: number;
};

export type PlatformBreakdownRow = {
  platform: string;
  videoType: string;
  count: number;
};

export type PublishingHealthPayload = {
  generatedAt: string;
  vietnamDayStart: string;
  queue: {
    queuedVideos: number;
    uploadingVideos: number;
    byPlatform: PlatformBreakdownRow[];
  };
  today: {
    uploaded: number;
    failed: number;
    uploadedByPlatform: PlatformBreakdownRow[];
    failedByPlatform: PlatformBreakdownRow[];
  };
  subtitleHealth: {
    averageScore: number | null;
    sampleCount: number;
    status: "available" | "not_persisted";
    note: string;
  };
  promptVersions: {
    totalContentItems: number;
    distribution: HealthDistributionRow[];
  };
  experiments: {
    totalContentItems: number;
    distribution: HealthDistributionRow[];
  };
  cleanup: {
    scanned: number;
    eligibleCount: number;
    eligibleSizeBytes: number;
    estimateLimit: number;
  };
  analytics: {
    totalPublishedVideos: number;
    videosWithAnalytics: number;
    coveragePct: number;
    youtubePublishedVideos: number;
    videosWithRetention: number;
    retentionCoveragePct: number;
  };
};

type PromptVersionSnapshotLike = Record<string, unknown>;

function vietnamDayStart(date = new Date()): Date {
  return new Date(Math.floor((date.getTime() + VIETNAM_OFFSET_MS) / DAY_MS) * DAY_MS - VIETNAM_OFFSET_MS);
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function inc(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function distributionFromMap(map: Map<string, number>, total: number): HealthDistributionRow[] {
  return [...map.entries()]
    .map(([key, count]) => ({
      key,
      count,
      percent: percent(count, total),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function platformKey(platform: string | null, videoType: string | null): string {
  return `${platform || "unknown"}:${videoType || "unknown"}`;
}

function platformBreakdownFromMap(map: Map<string, number>): PlatformBreakdownRow[] {
  return [...map.entries()]
    .map(([key, count]) => {
      const [platform, videoType] = key.split(":");
      return { platform, videoType, count };
    })
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
}

function promptDistributionKey(promptVersions: unknown): string[] {
  if (!promptVersions || typeof promptVersions !== "object" || Array.isArray(promptVersions)) {
    return ["UNASSIGNED"];
  }

  const snapshot = promptVersions as PromptVersionSnapshotLike;
  const keys = Object.entries(snapshot)
    .map(([stage, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return `${stage}:unknown`;
      }
      const version = (value as { version?: unknown }).version;
      return `${stage}:${typeof version === "string" && version.trim() ? version : "unknown"}`;
    })
    .filter(Boolean);

  return keys.length > 0 ? keys : ["UNASSIGNED"];
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getPublishingHealthAction(): Promise<PublishingHealthPayload> {
  const dayStart = vietnamDayStart();

  const [queueRows, contentRows, publishedRows, snapshotRows, cleanupDryRun] = await Promise.all([
    db
      .select({
        platform: uploadQueue.platform,
        videoType: uploadQueue.videoType,
        status: uploadQueue.status,
        uploadedAt: uploadQueue.uploadedAt,
        updatedAt: uploadQueue.updatedAt,
      })
      .from(uploadQueue),
    db
      .select({
        promptVersions: contentGenerations.promptVersions,
        experimentId: contentGenerations.experimentId,
        experimentVariant: contentGenerations.experimentVariant,
      })
      .from(contentGenerations),
    db
      .select({
        id: publishedVideos.id,
        platform: publishedVideos.platform,
        latestFetchedAt: publishedVideos.latestFetchedAt,
      })
      .from(publishedVideos),
    db
      .select({
        publishedVideoId: videoMetricSnapshots.publishedVideoId,
        retentionPct: videoMetricSnapshots.retentionPct,
        avgViewDurationSec: videoMetricSnapshots.avgViewDurationSec,
      })
      .from(videoMetricSnapshots),
    cleanupUploadedAssetsAction({ dryRun: true, limit: 500 }),
  ]);

  const queuedByPlatform = new Map<string, number>();
  const uploadedByPlatform = new Map<string, number>();
  const failedByPlatform = new Map<string, number>();
  let queuedVideos = 0;
  let uploadingVideos = 0;
  let uploadedToday = 0;
  let failedToday = 0;

  for (const row of queueRows) {
    if (row.status === "queued") {
      queuedVideos += 1;
      inc(queuedByPlatform, platformKey(row.platform, row.videoType));
    }

    if (row.status === "uploading") {
      uploadingVideos += 1;
      inc(queuedByPlatform, platformKey(row.platform, row.videoType));
    }

    if (row.status === "done" && row.uploadedAt && new Date(row.uploadedAt).getTime() >= dayStart.getTime()) {
      uploadedToday += 1;
      inc(uploadedByPlatform, platformKey(row.platform, row.videoType));
    }

    if (row.status === "error" && row.updatedAt && new Date(row.updatedAt).getTime() >= dayStart.getTime()) {
      failedToday += 1;
      inc(failedByPlatform, platformKey(row.platform, row.videoType));
    }
  }

  const promptMap = new Map<string, number>();
  const experimentMap = new Map<string, number>();

  for (const row of contentRows) {
    for (const key of promptDistributionKey(row.promptVersions)) {
      inc(promptMap, key);
    }

    const experimentKey = row.experimentVariant
      ? `${row.experimentId || "BASELINE"}:${row.experimentVariant}`
      : "UNASSIGNED";
    inc(experimentMap, experimentKey);
  }

  const publishedIds = new Set(publishedRows.map((row) => row.id));
  const videosWithAnalytics = new Set(
    publishedRows
      .filter((row) => row.latestFetchedAt)
      .map((row) => row.id)
  );
  for (const row of snapshotRows) {
    if (publishedIds.has(row.publishedVideoId)) {
      videosWithAnalytics.add(row.publishedVideoId);
    }
  }

  const youtubePublishedIds = new Set(
    publishedRows
      .filter((row) => row.platform === "youtube")
      .map((row) => row.id)
  );
  const videosWithRetention = new Set(
    snapshotRows
      .filter((row) => youtubePublishedIds.has(row.publishedVideoId) && toNumber(row.retentionPct) !== null)
      .map((row) => row.publishedVideoId)
  );

  const cleanupEligible = cleanupDryRun.results.filter((row) => !row.skippedReason);
  const cleanupEligibleSizeBytes = cleanupEligible.reduce((total, row) => total + row.bytesFreed, 0);

  return {
    generatedAt: new Date().toISOString(),
    vietnamDayStart: dayStart.toISOString(),
    queue: {
      queuedVideos,
      uploadingVideos,
      byPlatform: platformBreakdownFromMap(queuedByPlatform),
    },
    today: {
      uploaded: uploadedToday,
      failed: failedToday,
      uploadedByPlatform: platformBreakdownFromMap(uploadedByPlatform),
      failedByPlatform: platformBreakdownFromMap(failedByPlatform),
    },
    subtitleHealth: {
      averageScore: null,
      sampleCount: 0,
      status: "not_persisted",
      note: "Subtitle health score is validated during render but is not stored in the database yet.",
    },
    promptVersions: {
      totalContentItems: contentRows.length,
      distribution: distributionFromMap(promptMap, Math.max(1, contentRows.length)),
    },
    experiments: {
      totalContentItems: contentRows.length,
      distribution: distributionFromMap(experimentMap, Math.max(1, contentRows.length)),
    },
    cleanup: {
      scanned: cleanupDryRun.scanned,
      eligibleCount: cleanupEligible.length,
      eligibleSizeBytes: cleanupEligibleSizeBytes,
      estimateLimit: cleanupDryRun.limit,
    },
    analytics: {
      totalPublishedVideos: publishedRows.length,
      videosWithAnalytics: videosWithAnalytics.size,
      coveragePct: percent(videosWithAnalytics.size, publishedRows.length),
      youtubePublishedVideos: youtubePublishedIds.size,
      videosWithRetention: videosWithRetention.size,
      retentionCoveragePct: percent(videosWithRetention.size, youtubePublishedIds.size),
    },
  };
}
