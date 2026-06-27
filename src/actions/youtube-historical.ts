"use server";

import { db } from "@/lib/db";
import {
  contentGenerations,
  platformAccounts,
  publishedVideos,
  socialChannels,
  videoMetricSnapshots,
} from "@/lib/db/schema";
import {
  fetchYouTubeAnalyticsMetrics,
  listYouTubeChannelUploads,
  listYouTubeVideos,
  type YouTubeVideoResource,
} from "@/lib/social/youtube-api";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

export type YouTubeHistoricalFormatType =
  | "legacy_quote_footage_no_voice"
  | "pipeline_tts_ai_image"
  | "unknown";

export type YouTubeHistoricalImportResult = {
  dryRun: boolean;
  since: string;
  credentialChannelId: number;
  platformAccountId: number;
  channelTitle: string | null;
  channelPlatformId: string | null;
  uploadsPlaylistId: string | null;
  videosFound: number;
  videosFetched: number;
  alreadyInDb: number;
  imported: number;
  updated: number;
  skipped: number;
  snapshotsWritten: number;
  analyticsRowsWritten: number;
  errors: string[];
  quotaNotes: string[];
  sampleOldVideos: Array<{
    videoId: string;
    title: string;
    publishedAt: string | null;
    views: number;
    durationSeconds: number | null;
    formatType: YouTubeHistoricalFormatType;
  }>;
};

export type YouTubeHistoricalPerformanceRow = {
  formatType: YouTubeHistoricalFormatType;
  videoCount: number;
  avgViews: number;
  medianViews: number;
  avgDurationSec: number | null;
  avgViewDurationSec: number | null;
  avgRetentionPct: number | null;
  publishedFrom: Date | null;
  publishedTo: Date | null;
};

const HISTORICAL_IMPORT_VERSION = "youtube_historical_import_v1";
const DEFAULT_HISTORICAL_SINCE = new Date("2025-01-01T00:00:00.000Z");

function parseIsoDurationToSeconds(duration: string | null | undefined): number | null {
  if (!duration) return null;
  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;
  const [, d, h, m, s] = match;
  return (
    (Number(d ?? 0) * 86400) +
    (Number(h ?? 0) * 3600) +
    (Number(m ?? 0) * 60) +
    Number(s ?? 0)
  );
}

function toCount(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function toRetentionPctDbValue(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return String(Math.min(999.99, Math.max(0, value)));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function avgNullable(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function classifyHistoricalVideo(input: {
  contentId: string | null;
  publishedAt: Date | null;
  pipelineStartAt: Date | null;
  rawJson?: unknown;
}): YouTubeHistoricalFormatType {
  if (input.contentId) return "pipeline_tts_ai_image";

  const marker = (input.rawJson && typeof input.rawJson === "object")
    ? (input.rawJson as { contentPipeline?: { formatType?: unknown } }).contentPipeline
    : null;
  if (
    marker?.formatType === "legacy_quote_footage_no_voice" ||
    marker?.formatType === "pipeline_tts_ai_image" ||
    marker?.formatType === "unknown"
  ) {
    return marker.formatType;
  }

  if (input.publishedAt && input.pipelineStartAt && input.publishedAt < input.pipelineStartAt) {
    return "legacy_quote_footage_no_voice";
  }

  return "unknown";
}

async function getPipelineStartAt(): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: contentGenerations.createdAt })
    .from(contentGenerations)
    .orderBy(asc(contentGenerations.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

async function resolveYouTubeCredential(platformAccountId?: number | null) {
  const channels = await db.query.socialChannels.findMany({
    where: and(
      eq(socialChannels.platform, "youtube"),
      eq(socialChannels.isActive, true),
      eq(socialChannels.needsReconnect, false),
      isNotNull(socialChannels.platformChannelId),
    ),
    orderBy: (t, { asc: orderAsc }) => orderAsc(t.id),
  });

  const channel = channels.find((row) => {
    if (!row.accessToken) return false;
    if (platformAccountId && row.platformAccountId !== platformAccountId) return false;
    return true;
  });
  if (!channel) {
    throw new Error("Không tìm thấy YouTube credential active để sync lịch sử.");
  }

  let account = channel.platformAccountId
    ? await db.query.platformAccounts.findFirst({ where: eq(platformAccounts.id, channel.platformAccountId) })
    : null;

  if (!account && channel.platformChannelId) {
    const [upserted] = await db
      .insert(platformAccounts)
      .values({
        platform: "youtube",
        platformAccountId: channel.platformChannelId,
        displayName: channel.name,
        handle: channel.platformHandle,
        thumbnailUrl: channel.thumbnailUrl,
        isActive: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [platformAccounts.platform, platformAccounts.platformAccountId],
        set: {
          displayName: channel.name,
          handle: channel.platformHandle,
          thumbnailUrl: channel.thumbnailUrl,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    account = upserted;
    await db
      .update(socialChannels)
      .set({ platformAccountId: account.id, updatedAt: new Date() })
      .where(eq(socialChannels.id, channel.id));
  }

  if (!account) {
    throw new Error("YouTube credential chưa gắn platform account.");
  }

  return { channel, account };
}

function buildMarkedRawJson(input: {
  item: YouTubeVideoResource;
  source: "historical_import" | "pipeline_upload";
  formatType: YouTubeHistoricalFormatType;
  importedAt: Date;
}) {
  return {
    ...input.item,
    contentPipeline: {
      source: input.source,
      formatType: input.formatType,
      importVersion: HISTORICAL_IMPORT_VERSION,
      importedAt: input.importedAt.toISOString(),
    },
  };
}

export async function syncYouTubeHistoricalVideosAction(input?: {
  dryRun?: boolean;
  execute?: boolean;
  since?: Date | string;
  platformAccountId?: number | null;
  syncAnalytics?: boolean;
}): Promise<YouTubeHistoricalImportResult> {
  const dryRun = input?.execute ? false : input?.dryRun ?? true;
  const since = input?.since ? new Date(input.since) : DEFAULT_HISTORICAL_SINCE;
  if (Number.isNaN(since.getTime())) {
    throw new Error("Invalid since date for YouTube historical sync.");
  }

  const { channel, account } = await resolveYouTubeCredential(input?.platformAccountId ?? null);
  const uploads = await listYouTubeChannelUploads(channel.id, { since });
  const videoIds = uploads.items.map((item) => item.videoId);
  const items = await listYouTubeVideos(channel.id, videoIds);
  const byVideoId = new Map(items.map((item) => [item.id, item]).filter(([id]) => !!id) as Array<[string, YouTubeVideoResource]>);

  const existingRows = videoIds.length > 0
    ? await db.query.publishedVideos.findMany({
        where: and(
          eq(publishedVideos.platform, "youtube"),
          inArray(publishedVideos.platformVideoId, videoIds),
        ),
      })
    : [];
  const existingByVideoId = new Map(existingRows.map((row) => [row.platformVideoId, row]));
  const pipelineStartAt = await getPipelineStartAt();
  const now = new Date();

  const result: YouTubeHistoricalImportResult = {
    dryRun,
    since: since.toISOString(),
    credentialChannelId: channel.id,
    platformAccountId: account.id,
    channelTitle: uploads.channelTitle,
    channelPlatformId: uploads.channelId,
    uploadsPlaylistId: uploads.uploadsPlaylistId,
    videosFound: videoIds.length,
    videosFetched: items.length,
    alreadyInDb: existingRows.length,
    imported: 0,
    updated: 0,
    skipped: Math.max(0, videoIds.length - items.length),
    snapshotsWritten: 0,
    analyticsRowsWritten: 0,
    errors: [],
    quotaNotes: [
      `uploads playlist pages: about ${Math.ceil(videoIds.length / 50) || 1}`,
      `videos.list batches: ${Math.ceil(videoIds.length / 50) || 0}`,
      "YouTube Analytics API batches: 40 videos per request when --execute is used",
    ],
    sampleOldVideos: [],
  };

  const snapshotKeys: Array<{ platformVideoId: string; publishedVideoId: string }> = [];

  for (const videoId of videoIds) {
    const item = byVideoId.get(videoId);
    if (!item?.id) continue;

    const existing = existingByVideoId.get(videoId);
    const publishedAt = item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null;
    const durationSeconds = parseIsoDurationToSeconds(item.contentDetails?.duration);
    const viewCount = toCount(item.statistics?.viewCount);
    const likeCount = toCount(item.statistics?.likeCount);
    const commentCount = toCount(item.statistics?.commentCount);
    const favoriteCount = toCount(item.statistics?.favoriteCount);
    const formatType = classifyHistoricalVideo({
      contentId: existing?.contentId ?? null,
      publishedAt,
      pipelineStartAt,
      rawJson: existing?.rawLatestJson,
    });
    const source = existing?.contentId ? "pipeline_upload" : "historical_import";

    if (publishedAt && publishedAt.getUTCFullYear() === 2025 && result.sampleOldVideos.length < 5) {
      result.sampleOldVideos.push({
        videoId,
        title: item.snippet?.title ?? "(untitled)",
        publishedAt: item.snippet?.publishedAt ?? null,
        views: viewCount,
        durationSeconds,
        formatType,
      });
    }

    if (dryRun) {
      if (existing) result.updated++;
      else result.imported++;
      continue;
    }

    try {
      const rawLatestJson = buildMarkedRawJson({ item, source, formatType, importedAt: now });
      const [upserted] = await db
        .insert(publishedVideos)
        .values({
          uploadQueueId: existing?.uploadQueueId ?? null,
          contentId: existing?.contentId ?? null,
          platform: "youtube",
          platformAccountId: account.id,
          credentialChannelId: channel.id,
          platformVideoId: videoId,
          platformVideoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          videoType: durationSeconds !== null && durationSeconds <= 60 ? "short" : "long",
          title: item.snippet?.title ?? existing?.title ?? videoId,
          description: item.snippet?.description ?? existing?.description ?? "",
          tags: item.snippet?.tags ?? existing?.tags ?? [],
          privacyStatus: item.status?.privacyStatus ?? existing?.privacyStatus ?? null,
          durationSeconds,
          publishedAt,
          latestViewCount: viewCount,
          latestLikeCount: likeCount,
          latestCommentCount: commentCount,
          latestFetchedAt: now,
          rawLatestJson,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [publishedVideos.platform, publishedVideos.platformVideoId],
          set: {
            platformAccountId: account.id,
            credentialChannelId: channel.id,
            platformVideoUrl: `https://www.youtube.com/watch?v=${videoId}`,
            videoType: durationSeconds !== null && durationSeconds <= 60 ? "short" : "long",
            title: item.snippet?.title ?? existing?.title ?? videoId,
            description: item.snippet?.description ?? existing?.description ?? "",
            tags: item.snippet?.tags ?? existing?.tags ?? [],
            privacyStatus: item.status?.privacyStatus ?? existing?.privacyStatus ?? null,
            durationSeconds,
            publishedAt,
            latestViewCount: viewCount,
            latestLikeCount: likeCount,
            latestCommentCount: commentCount,
            latestFetchedAt: now,
            rawLatestJson,
            updatedAt: now,
          },
        })
        .returning();

      if (existing) result.updated++;
      else result.imported++;

      await db.insert(videoMetricSnapshots).values({
        publishedVideoId: upserted.id,
        fetchedAt: now,
        viewCount,
        likeCount,
        commentCount,
        favoriteCount,
        privacyStatus: item.status?.privacyStatus ?? existing?.privacyStatus ?? null,
        durationSeconds,
        rawJson: rawLatestJson,
      });
      result.snapshotsWritten++;
      snapshotKeys.push({ platformVideoId: videoId, publishedVideoId: upserted.id });
    } catch (err) {
      result.errors.push(`${videoId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!dryRun && (input?.syncAnalytics ?? true) && snapshotKeys.length > 0) {
    try {
      const endDate = now.toISOString().slice(0, 10);
      const startDate = since.toISOString().slice(0, 10);
      const analyticsMap = await fetchYouTubeAnalyticsMetrics(
        channel.id,
        snapshotKeys.map((k) => k.platformVideoId),
        startDate,
        endDate,
      );
      for (const { platformVideoId, publishedVideoId } of snapshotKeys) {
        const metrics = analyticsMap.get(platformVideoId);
        if (!metrics) continue;
        await db
          .update(videoMetricSnapshots)
          .set({
            ctr: metrics.ctr !== null ? String(metrics.ctr) : null,
            avgViewDurationSec: metrics.avgViewDurationSec,
            retentionPct: toRetentionPctDbValue(metrics.retentionPct),
          })
          .where(
            and(
              eq(videoMetricSnapshots.publishedVideoId, publishedVideoId),
              eq(videoMetricSnapshots.fetchedAt, now),
            ),
          );
        result.analyticsRowsWritten++;
      }
    } catch (err) {
      result.errors.push(`youtube/analytics: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!dryRun) {
    await db
      .update(platformAccounts)
      .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(platformAccounts.id, account.id));
  }

  return result;
}

export async function getYouTubeHistoricalPerformanceAction(): Promise<YouTubeHistoricalPerformanceRow[]> {
  const pipelineStartAt = await getPipelineStartAt();
  const videos = await db.query.publishedVideos.findMany({
    where: eq(publishedVideos.platform, "youtube"),
    with: {
      snapshots: {
        orderBy: (t, { desc }) => desc(t.fetchedAt),
        limit: 1,
      },
    },
  });

  const groups = new Map<YouTubeHistoricalFormatType, Array<{
    views: number;
    durationSeconds: number | null;
    avgViewDurationSec: number | null;
    retentionPct: number | null;
    publishedAt: Date | null;
  }>>();

  for (const video of videos) {
    const snap = video.snapshots?.[0] ?? null;
    const formatType = classifyHistoricalVideo({
      contentId: video.contentId,
      publishedAt: video.publishedAt,
      pipelineStartAt,
      rawJson: video.rawLatestJson,
    });
    const rows = groups.get(formatType) ?? [];
    rows.push({
      views: Number(snap?.viewCount ?? video.latestViewCount ?? 0),
      durationSeconds: snap?.durationSeconds ?? video.durationSeconds,
      avgViewDurationSec: snap?.avgViewDurationSec ?? null,
      retentionPct: snap?.retentionPct !== null && snap?.retentionPct !== undefined
        ? Number(snap.retentionPct)
        : null,
      publishedAt: video.publishedAt,
    });
    groups.set(formatType, rows);
  }

  const order: YouTubeHistoricalFormatType[] = [
    "legacy_quote_footage_no_voice",
    "pipeline_tts_ai_image",
    "unknown",
  ];

  return order
    .filter((formatType) => groups.has(formatType))
    .map((formatType) => {
      const rows = groups.get(formatType) ?? [];
      const publishedDates = rows
        .map((row) => row.publishedAt)
        .filter((date): date is Date => !!date)
        .sort((a, b) => a.getTime() - b.getTime());
      return {
        formatType,
        videoCount: rows.length,
        avgViews: avgNullable(rows.map((row) => row.views)) ?? 0,
        medianViews: median(rows.map((row) => row.views)),
        avgDurationSec: avgNullable(rows.map((row) => row.durationSeconds)),
        avgViewDurationSec: avgNullable(rows.map((row) => row.avgViewDurationSec)),
        avgRetentionPct: avgNullable(rows.map((row) => row.retentionPct)),
        publishedFrom: publishedDates[0] ?? null,
        publishedTo: publishedDates[publishedDates.length - 1] ?? null,
      };
    });
}
