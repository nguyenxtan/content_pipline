"use server";

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { socialChannels, uploadQueue, contentGenerations, appConfig, type SocialChannel } from "@/lib/db/schema";
import { eq, desc, and, lte, notExists, inArray, isNull, isNotNull, gte, count, asc } from "drizzle-orm";
import { inferFormatType, type ContentFormatType } from "@/lib/content-format-type";
import {
  uploadToYouTube,
  isQuotaExceededError,
  isAuthError,
  isTokenRevokedError,
  isTransientError,
  nextQuotaResetUtc,
  pacificMidnightUtc,
  verifyYouTubeUploadDestination,
} from "@/lib/social/youtube-api";
import {
  connectFacebookPageManual,
  deleteFacebookPageContentBefore,
  previewFacebookPageDelete,
  uploadToFacebookPhotoPost,
  uploadToFacebookReel,
  refreshFacebookEnvHealth,
  rotateFacebookPageToken,
  inspectFacebookToken,
  isFacebookAuthError,
  isFacebookRateLimitError,
  isFacebookTransientError,
  type FacebookTokenInfo,
} from "@/lib/social/facebook-api";
import { renderFacebookQuoteImage } from "@/lib/social/facebook-quote";
import { resolveFacebookQuoteImageSource, type FacebookQuoteImageSourceMode } from "@/lib/social/facebook-quote-source";
import { buildDefaultVideoDescription, buildDefaultVideoTitle, buildFacebookQuoteText, buildYouTubeVideoMetadata } from "@/lib/social/youtube-metadata";
import { sendTelegram } from "@/lib/social/telegram";
import { upsertPublishedVideoFromUploadQueueId } from "@/actions/publishing-analytics";
import { logApiUsage } from "@/actions/ai-usage";
import {
  getOverdueMinutes,
  isUploadScheduledDue,
  resolveRetryScheduledAt,
} from "@/lib/upload-schedule";
import {
  CHANNEL_PUBLISH_CONFIGS_KEY,
  DEFAULT_CHANNEL_KEY,
  getChannelDefinition,
  getChannelPublishConfig,
  getChannelDestinations,
  normalizeChannelKey,
  resolveChannelKey,
} from "@/lib/config/channel-configs";
import { resolveContentProfileKey } from "@/lib/config/content-profiles";
import { inferWorkspaceFromSignals } from "@/lib/channel-workspace-registry";
import {
  findNextAvailablePublishSlot,
  getSlotOffsetMinutes,
  getTakenUploadSlotsForDestination,
  pickFullLaneSafeAnchor,
} from "@/lib/publishing/slot-occupancy";
import { createPromptVersionEntry, mergePromptVersions } from "@/lib/prompt-version-registry";
import {
  readStoredQuoteArtifactMetadata,
  resolveFacebookQuoteArtifact,
  type QuoteArtifactMetadata,
} from "@/lib/quotes/quote-pipeline";
import { getYoutubeQuoteSchedulerPolicy } from "@/lib/quotes/youtube-quote-scheduler-policy";
import { getTangSauIsolationViolation } from "@/lib/content-profile-isolation";
import {
  executePhatPhapQueueSync,
  type PhatPhapQueueSyncResult,
} from "@/lib/publishing/phat-phap-queue-sync";

type PublishQueueType = "short" | "long" | "quote";
type UploadProcessResult = {
  id: string;
  ok: boolean;
  error?: string;
  overdueMinutes?: number;
  sourceImageMode?: FacebookQuoteImageSourceMode;
  sourceImagePath?: string;
};

function logUploadEvent(event: string, payload: Record<string, unknown>): void {
  console.log(`[upload_queue] ${JSON.stringify({ event, ...payload })}`);
}

const DEFAULT_STALE_BACKLOG_THRESHOLD_MINUTES = 180;
const GLOBAL_STALE_BACKLOG_THRESHOLD_CONFIG_KEY = "publish.stale_backlog_threshold_minutes";
const PHAT_PHAP_FB_STALE_BACKLOG_THRESHOLD_CONFIG_KEY = "phat_phap.facebook.stale_backlog_threshold_minutes";

function parsePositiveIntegerConfigValue(
  value: string | null | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

async function getStaleBacklogThresholdMinutes(
  channelKey: string,
  platform: string,
): Promise<number | null> {
  if (channelKey !== DEFAULT_CHANNEL_KEY || platform !== "facebook") {
    return null;
  }

  const rows = await db
    .select({ key: appConfig.key, value: appConfig.value })
    .from(appConfig)
    .where(inArray(appConfig.key, [
      PHAT_PHAP_FB_STALE_BACKLOG_THRESHOLD_CONFIG_KEY,
      GLOBAL_STALE_BACKLOG_THRESHOLD_CONFIG_KEY,
    ]));

  const configMap = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return parsePositiveIntegerConfigValue(
    configMap[PHAT_PHAP_FB_STALE_BACKLOG_THRESHOLD_CONFIG_KEY]
      ?? configMap[GLOBAL_STALE_BACKLOG_THRESHOLD_CONFIG_KEY],
    DEFAULT_STALE_BACKLOG_THRESHOLD_MINUTES,
  );
}

async function getChannelPublishSafety(
  channelKeyValue: string | null | undefined,
  videoType: PublishQueueType,
  options?: {
    requireConfiguredDestinations?: boolean;
  },
): Promise<{ ok: true; channelKey: string; allowLegacyEnvFallback: boolean } | { ok: false; error: string }> {
  const channelKey = normalizeChannelKey(channelKeyValue);
  if (!channelKey) {
    return { ok: false, error: `Content thiếu channelKey hợp lệ: ${channelKeyValue ?? "null"}` };
  }

  const config = await getChannelPublishConfig(channelKey);
  if (!config) {
    return { ok: false, error: `Không tìm thấy publish config cho channel "${channelKey}"` };
  }
  if (!config.publishingEnabled) {
    return { ok: false, error: `Channel "${channelKey}" chưa bật publishing` };
  }

  const destinations = getChannelDestinations(config, videoType);
  const hasExplicitDestinations = destinations.length > 0;
  if (options?.requireConfiguredDestinations && !hasExplicitDestinations && channelKey !== DEFAULT_CHANNEL_KEY) {
    return {
      ok: false,
      error: `Channel "${channelKey}" chưa có destination config cho ${videoType}`,
    };
  }

  return {
    ok: true,
    channelKey,
    allowLegacyEnvFallback: config.allowLegacyEnvFallback,
  };
}

function getDestinationOwnershipError(
  contentChannelKeyValue: string | null | undefined,
  destinationChannelKeyValue: string | null | undefined,
  destinationName: string,
): string | null {
  const contentChannelKey = resolveChannelKey(contentChannelKeyValue);
  const destinationChannelKey = resolveChannelKey(destinationChannelKeyValue);
  if (contentChannelKey === destinationChannelKey) return null;

  return `Destination "${destinationName}" thuộc channel "${destinationChannelKey}", không khớp với content channel "${contentChannelKey}"`;
}

type CrossChannelScheduleGuardInput = {
  requestedVideoType: PublishQueueType;
  expectedChannelKey?: string | null;
  destination: {
    id: number;
    name: string;
    platform: string;
    channelKey: string | null | undefined;
  };
  content: {
    id: string;
    channelKey: string | null | undefined;
    nicheId?: number | null;
    contentProfileKey?: string | null;
    formatType?: string | null;
    title?: string | null;
    topic?: string | null;
    shortContent?: string | null;
    script?: string | null;
    topicFamily?: string | null;
    promptVersions?: unknown;
  };
};

function getCrossChannelScheduleError(input: CrossChannelScheduleGuardInput): string | null {
  const contentChannelKey = resolveChannelKey(input.content.channelKey);
  const destinationChannelKey = resolveChannelKey(input.destination.channelKey);
  const expectedChannelKey = input.expectedChannelKey
    ? resolveChannelKey(input.expectedChannelKey)
    : null;

  if (expectedChannelKey && contentChannelKey !== expectedChannelKey) {
    return `Expected content channel "${expectedChannelKey}" nhưng content "${input.content.id}" thuộc "${contentChannelKey}"`;
  }
  if (expectedChannelKey && destinationChannelKey !== expectedChannelKey) {
    return `Expected destination channel "${expectedChannelKey}" nhưng social_channel ${input.destination.id} thuộc "${destinationChannelKey}"`;
  }

  const ownershipError = getDestinationOwnershipError(
    contentChannelKey,
    destinationChannelKey,
    input.destination.name,
  );
  if (ownershipError) return ownershipError;

  const quotePolicy = input.destination.platform === "youtube" &&
    (input.requestedVideoType === "quote" || input.content.formatType === "legacy_quote_short")
      ? getYoutubeQuoteSchedulerPolicy(destinationChannelKey)
      : null;

  if (quotePolicy) {
    const contentProfileKey = resolveContentProfileKey(input.content.contentProfileKey);
    if (contentChannelKey !== quotePolicy.channelKey) {
      return `Quote lane destination "${destinationChannelKey}" chỉ nhận content channel "${quotePolicy.channelKey}"`;
    }
    if (input.content.formatType !== quotePolicy.formatType) {
      return `Quote lane destination "${destinationChannelKey}" chỉ nhận format "${quotePolicy.formatType}"`;
    }
    if (contentProfileKey !== "philosophy") {
      return `Quote lane destination "${destinationChannelKey}" chỉ nhận content profile "philosophy"`;
    }
  }

  const tangSauViolation = getTangSauIsolationViolation({
    channelKey: contentChannelKey,
    nicheId: input.content.nicheId,
    contentProfileKey: input.content.contentProfileKey,
    formatType: input.content.formatType,
    title: input.content.title,
    topic: input.content.topic,
    shortContent: input.content.shortContent,
    script: input.content.script,
    topicFamily: input.content.topicFamily,
    promptVersions: input.content.promptVersions,
  });
  if (tangSauViolation) {
    return `${tangSauViolation.code}: ${tangSauViolation.hits.join(", ")}`;
  }

  return null;
}

export const _getCrossChannelScheduleError = getCrossChannelScheduleError;

function getYouTubePublishGuardError(item: {
  platform: string;
  channelId: number;
  channel: {
    id: number;
    name: string;
    platform: string;
    channelKey: string | null;
    platformChannelId: string | null;
    oauthClientConfigId?: number | null;
    accessToken?: string | null;
    refreshToken?: string | null;
  };
  content: {
    id: string;
    channelKey: string | null;
  };
}): string | null {
  if (item.platform !== "youtube") return "youtube_guard_platform_mismatch";
  if (!item.channelId || !item.channel?.id) return "youtube_guard_missing_social_channel_id";
  if (item.channel.platform !== "youtube") return "youtube_guard_social_channel_platform_mismatch";
  if (!item.channel.platformChannelId) return "youtube_guard_missing_platform_channel_id";
  const ownershipError = getDestinationOwnershipError(
    item.content.channelKey,
    item.channel.channelKey,
    item.channel.name,
  );
  if (ownershipError) return ownershipError;
  if (!item.channel.accessToken && !item.channel.refreshToken) {
    return "youtube_guard_missing_credential";
  }
  return null;
}

// ─── Facebook env-based connect ───────────────────────────────────────────

export async function verifyFacebookEnvAction(): Promise<
  | { ok: true; channelId?: number; name: string; pageId: string; message: string }
  | { ok: false; error: string; pageId: string | null; needsReconnect: boolean; channelId?: number }
> {
  const health = await refreshFacebookEnvHealth();
  if (!health.ok) {
    return {
      ok: false,
      error: health.message,
      pageId: health.pageId,
      needsReconnect: health.needsReconnect,
      channelId: health.channelId,
    };
  }
  return {
    ok: true,
    channelId: health.channelId,
    name: health.pageName,
    pageId: health.pageId,
    message: health.message,
  };
}

export async function inspectFacebookTokenAction(channelId?: number): Promise<FacebookTokenInfo> {
  return inspectFacebookToken(channelId);
}

export async function rotateFacebookPageTokenAction(userAccessToken: string): Promise<
  | { ok: true; channelId: number; name: string; pageId: string; message: string }
  | { ok: false; error: string }
> {
  const rotated = await rotateFacebookPageToken(userAccessToken);
  if (!rotated.ok) return rotated;
  return {
    ok: true,
    channelId: rotated.channelId,
    name: rotated.pageName,
    pageId: rotated.pageId,
    message: rotated.message,
  };
}

export async function connectFacebookPageManualAction(input: {
  channelKey: string;
  pageId: string;
  pageAccessToken: string;
}): Promise<
  | { ok: true; channelId: number; name: string; pageId: string; channelKey: string; message: string }
  | { ok: false; error: string }
> {
  const channelKey = normalizeChannelKey(input.channelKey);
  if (!channelKey) {
    return { ok: false, error: "channelKey không hợp lệ" };
  }

  const channelDefinition = getChannelDefinition(channelKey);
  if (channelDefinition.allowLegacyEnvFallback) {
    return { ok: false, error: "Kết nối Facebook thủ công chỉ dành cho channel không dùng env fallback." };
  }

  const result = await connectFacebookPageManual({
    channelKey,
    pageId: input.pageId,
    pageAccessToken: input.pageAccessToken,
  });
  if (!result.ok) return result;

  return {
    ok: true,
    channelId: result.channelId,
    name: result.pageName,
    pageId: result.pageId,
    channelKey: result.channelKey,
    message: result.message,
  };
}

// ─── Channel Management ────────────────────────────────────────────────────

export async function getChannelsAction(platform?: string, channelKeyValue?: string): Promise<SocialChannel[]> {
  if (!platform || platform === "facebook") {
    await refreshFacebookEnvHealth().catch(() => null);
  }
  const channelKey = normalizeChannelKey(channelKeyValue);
  const rows = await db.query.socialChannels.findMany({
    where: (t, { and, eq: e }) => {
      const conds = [];
      if (platform) conds.push(e(t.platform, platform));
      if (channelKey) conds.push(e(t.channelKey, channelKey));
      return conds.length ? and(...conds) : undefined;
    },
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  return rows;
}

export async function deleteChannelAction(id: number): Promise<{ success: boolean }> {
  await db.delete(socialChannels).where(eq(socialChannels.id, id));
  return { success: true };
}

export async function toggleChannelAction(id: number, isActive: boolean): Promise<{ success: boolean }> {
  await db.update(socialChannels)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(socialChannels.id, id));
  return { success: true };
}

export async function previewFacebookBulkDeleteAction(channelId: number, cutoffDate: string) {
  return previewFacebookPageDelete(channelId, cutoffDate);
}

export async function deleteFacebookBulkDeleteAction(channelId: number, cutoffDate: string) {
  return deleteFacebookPageContentBefore(channelId, cutoffDate);
}

// ─── Upload Queue ──────────────────────────────────────────────────────────

export type UploadQueueRow = {
  id: string;
  contentId: string;
  channelId: number;
  channelName: string;
  channelKey: string | null;
  platformChannelId: string | null;
  platformAccountId: number | null;
  platformAccountName: string | null;
  oauthClientConfigId: number | null;
  oauthClientName: string | null;
  platform: string;
  videoType: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: string;
  scheduledAt: Date;
  status: string;
  errorMessage: string | null;
  platformVideoId: string | null;
  platformVideoUrl: string | null;
  uploadedAt: Date | null;
  createdAt: Date;
  // joined from content
  topic: string;
  nicheName: string;
  contentExperimentId: string | null;
  contentExperimentVariant: string | null;
  contentChannelKey: string | null;
  contentProfileKey: string | null;
  formatType: ContentFormatType;
  workspaceId: string | null;
  workspaceName: string | null;
  workspacePromptProfileId: string | null;
};

export async function getUploadQueueAction(filters?: {
  status?: string;
  channelId?: number;
  platform?: string;
  limit?: number;
}): Promise<UploadQueueRow[]> {
  const rows = await db.query.uploadQueue.findMany({
    where: (t, { and: a, eq: e }) => {
      const conds = [];
      if (filters?.status) conds.push(e(t.status, filters.status));
      if (filters?.channelId) conds.push(e(t.channelId, filters.channelId));
      if (filters?.platform) conds.push(e(t.platform, filters.platform));
      return conds.length ? a(...conds) : undefined;
    },
    with: {
      channel: {
        columns: {
          name: true,
          platformAccountId: true,
          channelKey: true,
          platformChannelId: true,
          oauthClientConfigId: true,
        },
        with: {
          platformAccount: {
            columns: { displayName: true },
          },
          oauthClient: {
            columns: { name: true },
          },
        },
      },
      content: {
        columns: {
          topic: true,
          nicheName: true,
          experimentId: true,
          experimentVariant: true,
          formatType: true,
          contentMode: true,
          channelKey: true,
          contentProfileKey: true,
        },
      },
    },
    orderBy: (t, { desc: d }) => [
      // DESC so upcoming queued rows (future scheduledAt) surface before old done/cancelled rows.
      // Without this, old history fills the limit window and active rows are never returned.
      d(t.scheduledAt),
      d(t.createdAt),
    ],
    limit: filters?.limit ?? 300,
  });

  return rows.map((r) => {
    const workspace = inferWorkspaceFromSignals({
      channelKey: r.content.channelKey ?? r.channel.channelKey,
      platform: r.platform,
      platformChannelId: r.channel.platformChannelId,
    });

    return {
      id: r.id,
      contentId: r.contentId,
      channelId: r.channelId,
      channelName: r.channel.name,
      channelKey: r.channel.channelKey,
      platformChannelId: r.channel.platformChannelId,
      platformAccountId: r.channel.platformAccountId,
      platformAccountName: r.channel.platformAccount?.displayName ?? null,
      oauthClientConfigId: r.channel.oauthClientConfigId,
      oauthClientName: r.channel.oauthClient?.name ?? null,
      platform: r.platform,
      videoType: r.videoType,
      title: r.title,
      description: r.description,
      tags: (r.tags as string[]) ?? [],
      privacyStatus: r.privacyStatus,
      scheduledAt: r.scheduledAt,
      status: r.status,
      errorMessage: r.errorMessage,
      platformVideoId: r.platformVideoId,
      platformVideoUrl: r.platformVideoUrl,
      uploadedAt: r.uploadedAt,
      createdAt: r.createdAt,
      topic: r.content.topic,
      nicheName: r.content.nicheName,
      contentExperimentId: r.content.experimentId,
      contentExperimentVariant: r.content.experimentVariant,
      contentChannelKey: r.content.channelKey,
      contentProfileKey: r.content.contentProfileKey,
      formatType:
        r.videoType === "quote"
          ? "facebook_quote_photo"
          : r.videoType === "long"
            ? "long_video"
            : inferFormatType({
                formatType: r.content.formatType,
                experimentId: r.content.experimentId,
                contentMode: r.content.contentMode,
              }),
      workspaceId: workspace?.workspaceId ?? null,
      workspaceName: workspace?.displayName ?? null,
      workspacePromptProfileId: workspace?.promptProfileId ?? null,
    };
  });
}

export async function scheduleUploadAction(input: {
  contentId: string;
  channelId: number;
  videoType: PublishQueueType;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: "public" | "private" | "unlisted";
  scheduledAt: Date;
}): Promise<{ id: string } | { error: string }> {
  const content = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, input.contentId),
  });
  if (!content) return { error: "Không tìm thấy content" };

  if (input.videoType === "long" && !content.longVideoPath) {
    return { error: "Video long chưa được tạo" };
  }
  if (input.videoType === "short" && !content.videoPath) {
    return { error: "Video short chưa được tạo" };
  }
  if (input.videoType === "quote" && (!content.imagePaths || content.imagePaths.length === 0)) {
    return { error: "Ảnh short chưa được tạo để đăng bài Facebook" };
  }

  const channel = await db.query.socialChannels.findFirst({
    where: eq(socialChannels.id, input.channelId),
  });
  if (!channel) return { error: "Kênh không tồn tại" };
  const publishSafety = await getChannelPublishSafety(content.channelKey, input.videoType);
  if (!publishSafety.ok) return { error: publishSafety.error };
  const ownershipError = getDestinationOwnershipError(content.channelKey, channel.channelKey, channel.name);
  if (ownershipError) return { error: ownershipError };
  if (channel.platform === "facebook" && input.videoType === "long") {
    return { error: "Facebook hiện chỉ hỗ trợ đăng short/reel hoặc bài ảnh quote trong app này" };
  }
  if (channel.platform === "youtube" && input.videoType === "quote") {
    return { error: "Quote post chỉ hỗ trợ cho Facebook" };
  }

  const [row] = await db.insert(uploadQueue).values({
    contentId: input.contentId,
    channelId: input.channelId,
    platform: channel.platform,
    videoType: input.videoType,
    title: input.title,
    description: input.description,
    tags: input.tags,
    privacyStatus: channel.platform === "facebook" ? "public" : input.privacyStatus,
    scheduledAt: input.scheduledAt,
    status: "queued",
  }).returning({ id: uploadQueue.id });

  return { id: row.id };
}

export async function cancelUploadAction(id: string): Promise<{ success: boolean }> {
  await db.update(uploadQueue)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(uploadQueue.id, id));
  return { success: true };
}

export async function retryUploadAction(
  id: string,
  options?: { forcePublish?: boolean },
): Promise<{ success: boolean }> {
  const row = await db.query.uploadQueue.findFirst({
    where: eq(uploadQueue.id, id),
  });
  if (!row) return { success: false };

  await db.update(uploadQueue)
    .set({
      status: "queued",
      errorMessage: null,
      scheduledAt: resolveRetryScheduledAt(row.scheduledAt, options),
      updatedAt: new Date(),
    })
    .where(eq(uploadQueue.id, id));
  return { success: true };
}

export async function deleteUploadAction(id: string): Promise<{ success: boolean }> {
  await db.delete(uploadQueue).where(eq(uploadQueue.id, id));
  return { success: true };
}

export async function getUploadQueueStatsAction(): Promise<Record<string, number>> {
  const rows = await db.query.uploadQueue.findMany({
    columns: { status: true },
  });
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  return counts;
}

export async function syncPhatPhapQueuePairsAction(input: {
  from: Date;
  to: Date;
  contentId?: string | null;
  apply?: boolean;
}): Promise<PhatPhapQueueSyncResult> {
  return executePhatPhapQueueSync({
    from: input.from,
    to: input.to,
    contentId: input.contentId ?? null,
    apply: input.apply ?? false,
  });
}

// ─── Ready-to-publish videos ───────────────────────────────────────────────

export type ReadyVideoRow = {
  id: string;
  topic: string;
  nicheName: string;
  nicheId: number;
  videoType: PublishQueueType;
  createdAt: Date;
};

export async function getReadyVideosAction(): Promise<ReadyVideoRow[]> {
  // Short videos: done, not yet queued/uploading/done in upload_queue
  const shortReady = await db
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      nicheName: contentGenerations.nicheName,
      nicheId: contentGenerations.nicheId,
      createdAt: contentGenerations.createdAt,
    })
    .from(contentGenerations)
    .where(
      and(
        eq(contentGenerations.videoStatus, "done"),
        inArray(contentGenerations.contentMode, ["short", "both"]),
        notExists(
          db.select({ _: uploadQueue.id }).from(uploadQueue).where(
            and(
              eq(uploadQueue.contentId, contentGenerations.id),
              eq(uploadQueue.videoType, "short"),
              inArray(uploadQueue.status, ["queued", "uploading", "done"]),
            )
          )
        ),
      )
    )
    .orderBy(desc(contentGenerations.createdAt))
    .limit(100);

  // Long videos: done, not yet queued/uploading/done in upload_queue
  const longReady = await db
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      nicheName: contentGenerations.nicheName,
      nicheId: contentGenerations.nicheId,
      createdAt: contentGenerations.createdAt,
    })
    .from(contentGenerations)
    .where(
      and(
        eq(contentGenerations.longVideoStatus, "done"),
        inArray(contentGenerations.contentMode, ["long", "both"]),
        notExists(
          db.select({ _: uploadQueue.id }).from(uploadQueue).where(
            and(
              eq(uploadQueue.contentId, contentGenerations.id),
              eq(uploadQueue.videoType, "long"),
              inArray(uploadQueue.status, ["queued", "uploading", "done"]),
            )
          )
        ),
      )
    )
    .orderBy(desc(contentGenerations.createdAt))
    .limit(100);

  // Quote posts: short pipeline done, no quote queued/uploading/done yet
  const quoteReady = await db
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      nicheName: contentGenerations.nicheName,
      nicheId: contentGenerations.nicheId,
      createdAt: contentGenerations.createdAt,
    })
    .from(contentGenerations)
    .where(
      and(
        eq(contentGenerations.videoStatus, "done"),
        inArray(contentGenerations.contentMode, ["short", "both"]),
        notExists(
          db.select({ _: uploadQueue.id }).from(uploadQueue).where(
            and(
              eq(uploadQueue.contentId, contentGenerations.id),
              eq(uploadQueue.videoType, "quote"),
              inArray(uploadQueue.status, ["queued", "uploading", "done"]),
            )
          )
        ),
      )
    )
    .orderBy(desc(contentGenerations.createdAt))
    .limit(100);

  return [
    ...shortReady.map(r => ({ ...r, videoType: "short" as const })),
    ...quoteReady.map(r => ({ ...r, videoType: "quote" as const })),
    ...longReady.map(r => ({ ...r, videoType: "long" as const })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function bulkScheduleAction(input: {
  videoType: PublishQueueType;
  channelId: number;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  privacyStatus: "public" | "unlisted" | "private";
  contentIds?: string[];
}): Promise<{ scheduled: number; skipped: number; error?: string }> {
  const channel = await db.query.socialChannels.findFirst({
    where: eq(socialChannels.id, input.channelId),
  });
  if (!channel) return { scheduled: 0, skipped: 0, error: "Kênh không tồn tại" };
  const destinationChannelKey = resolveChannelKey(channel.channelKey);
  if (channel.platform === "facebook" && input.videoType === "long") {
    return { scheduled: 0, skipped: 0, error: "Facebook hiện chỉ hỗ trợ đăng short/reel hoặc bài ảnh quote trong app này" };
  }
  if (channel.platform === "youtube" && input.videoType === "quote") {
    return { scheduled: 0, skipped: 0, error: "Quote post chỉ hỗ trợ cho Facebook" };
  }

  // Get target videos. When contentIds are provided we bypass the generic
  // "ready" list so the same short can be queued to multiple platforms.
  let targets: ReadyVideoRow[] = [];
  if (input.contentIds?.length) {
    const rows = await db.query.contentGenerations.findMany({
      where: (t, { inArray: ia }) => ia(t.id, input.contentIds!),
      columns: {
        id: true,
        topic: true,
        nicheName: true,
        nicheId: true,
        createdAt: true,
        videoStatus: true,
        longVideoStatus: true,
      },
    });
    targets = rows
      .filter((row) =>
        input.videoType === "quote"
          ? row.videoStatus === "done"
          : input.videoType === "short"
            ? row.videoStatus === "done"
            : row.longVideoStatus === "done"
      )
      .map((row) => ({
        id: row.id,
        topic: row.topic,
        nicheName: row.nicheName,
        nicheId: row.nicheId,
        videoType: input.videoType,
        createdAt: row.createdAt,
      }));
  } else {
    const allReady = await getReadyVideosAction();
    targets = allReady.filter((r) => r.videoType === input.videoType);
    if (input.videoType === "quote") {
      targets = [];
    }
  }
  if (input.videoType === "quote" && !input.contentIds?.length) {
    const quoteReady = await db
      .select({
        id: contentGenerations.id,
        topic: contentGenerations.topic,
        nicheName: contentGenerations.nicheName,
        nicheId: contentGenerations.nicheId,
        createdAt: contentGenerations.createdAt,
      })
      .from(contentGenerations)
      .where(
        and(
          eq(contentGenerations.videoStatus, "done"),
          inArray(contentGenerations.contentMode, ["short", "both"]),
          notExists(
            db.select({ _: uploadQueue.id }).from(uploadQueue).where(
              and(
                eq(uploadQueue.contentId, contentGenerations.id),
                eq(uploadQueue.videoType, "quote"),
                inArray(uploadQueue.status, ["queued", "uploading", "done"]),
              )
            )
          ),
        )
      )
      .orderBy(desc(contentGenerations.createdAt))
      .limit(100);
    targets = quoteReady.map((row) => ({
      ...row,
      videoType: "quote" as const,
    }));
  }
  if (targets.length === 0) return { scheduled: 0, skipped: 0 };

  // Existing slots for this real destination. Multiple social_channels rows can
  // point to the same YouTube channel when they use different OAuth clients.
  const destinationWhere = channel.platformChannelId
    ? and(
        eq(socialChannels.platform, channel.platform),
        eq(socialChannels.platformChannelId, channel.platformChannelId),
      )
    : eq(uploadQueue.channelId, input.channelId);
  // Include 'done' so recently-published slots aren't re-used when rescheduling.
  // Scope to last 24 h — past-done rows before that window can't conflict with
  // future candidates since findNextBulkSlot only picks slots > now.
  const takenSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db
    .select({ scheduledAt: uploadQueue.scheduledAt })
    .from(uploadQueue)
    .innerJoin(socialChannels, eq(uploadQueue.channelId, socialChannels.id))
    .where(and(
      destinationWhere,
      inArray(uploadQueue.status, ["queued", "uploading", "done"]),
      gte(uploadQueue.scheduledAt, takenSince),
    ));
  const taken = existing.map(r => new Date(r.scheduledAt).getTime());
  const existingForDestination = await db
    .select({ contentId: uploadQueue.contentId })
    .from(uploadQueue)
    .innerJoin(socialChannels, eq(uploadQueue.channelId, socialChannels.id))
    .where(and(
      destinationWhere,
      eq(uploadQueue.videoType, input.videoType),
      inArray(uploadQueue.status, ["queued", "uploading", "done", "cancelled"]),
      input.contentIds?.length ? inArray(uploadQueue.contentId, input.contentIds) : undefined,
    ));
  const existingContentIds = new Set(existingForDestination.map((row) => row.contentId));

  // Fetch content details for title/description
  const contentIds = targets.map(t => t.id);
  const contents = await db.query.contentGenerations.findMany({
    where: (t, { inArray: ia }) => ia(t.id, contentIds),
    columns: {
      id: true,
      topic: true,
      shortContent: true,
      longContent: true,
      longYoutubeDescription: true,
      contentProfileKey: true,
      channelKey: true,
      nicheId: true,
      formatType: true,
    },
  });
  const contentMap = new Map(contents.map(c => [c.id, c]));

  let scheduled = 0;
  let skipped = 0;

  for (const target of targets) {
    if (existingContentIds.has(target.id)) {
      skipped++;
      continue;
    }
    const slot = findNextAvailablePublishSlot({
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      intervalMin: input.intervalMin,
      taken,
    });
    if (!slot) { skipped++; continue; }

    const content = contentMap.get(target.id);
    const publishSafety = await getChannelPublishSafety(content?.channelKey, input.videoType);
    if (!publishSafety.ok) {
      skipped++;
      continue;
    }
    const crossChannelError = content
      ? getCrossChannelScheduleError({
          requestedVideoType: input.videoType,
          destination: {
            id: channel.id,
            name: channel.name,
            platform: channel.platform,
            channelKey: destinationChannelKey,
          },
          content: {
            id: target.id,
            channelKey: content.channelKey,
            nicheId: content.nicheId,
            contentProfileKey: content.contentProfileKey,
            formatType: content.formatType,
          },
        })
      : null;
    if (crossChannelError) {
      console.error(
        `[cross_channel_guard] bulk_schedule_block contentId=${target.id} destinationChannelId=${channel.id} platform=${channel.platform} requestedVideoType=${input.videoType} error=${crossChannelError}`,
      );
      skipped++;
      continue;
    }
    const topic = content?.topic ?? target.topic;
    const metadata = input.videoType === "quote"
      ? {
          title: buildFacebookQuoteText({
            topic,
            shortContent: content?.shortContent,
            contentProfileKey: content?.contentProfileKey,
          }).slice(0, 100),
          description: buildDefaultVideoDescription({
            platform: "facebook",
            contentType: "quote",
            topic,
            nicheName: target.nicheName,
            shortContent: content?.shortContent,
            longContent: content?.longContent,
            longYoutubeDescription: content?.longYoutubeDescription,
            contentProfileKey: content?.contentProfileKey,
          }),
          tags: [] as string[],
        }
      : channel.platform === "youtube"
      ? buildYouTubeVideoMetadata({
          contentType: input.videoType as "short" | "long",
          topic,
          nicheName: target.nicheName,
          shortContent: content?.shortContent,
          longContent: content?.longContent,
          longYoutubeDescription: content?.longYoutubeDescription,
          contentProfileKey: content?.contentProfileKey,
        })
      : {
          title: buildDefaultVideoTitle({
            platform: "facebook",
            contentType: input.videoType,
            topic,
            contentProfileKey: content?.contentProfileKey,
            shortContent: content?.shortContent,
          }),
          description: buildDefaultVideoDescription({
            platform: "facebook",
            contentType: input.videoType,
            topic,
            nicheName: target.nicheName,
            shortContent: content?.shortContent,
            longContent: content?.longContent,
            longYoutubeDescription: content?.longYoutubeDescription,
            contentProfileKey: content?.contentProfileKey,
          }),
          tags: [] as string[],
        };

    await db.insert(uploadQueue).values({
      contentId: target.id,
      channelId: input.channelId,
      platform: channel.platform,
      videoType: input.videoType,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      privacyStatus: channel.platform === "facebook" ? "public" : input.privacyStatus,
      scheduledAt: slot,
      status: "queued",
    });

    taken.push(slot.getTime());
    existingContentIds.add(target.id);
    scheduled++;
  }

  return { scheduled, skipped };
}

export async function rebalanceQueuedUploadsAction(platform = "youtube"): Promise<{ updated: number }> {
  const settings = await getAutoScheduleSettingsAction();
  const rows = await db.query.uploadQueue.findMany({
    where: (t, { and: a, eq: e }) => a(e(t.status, "queued"), e(t.platform, platform)),
    with: {
      channel: {
        columns: { id: true, platform: true, platformChannelId: true, platformAccountId: true },
      },
    },
    orderBy: (t, { asc }) => [asc(t.scheduledAt), asc(t.createdAt)],
  });

  let updated = 0;
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.channel.platformAccountId
      ? `${row.platform}:${row.channel.platformAccountId}`
      : `${row.platform}:channel:${row.channelId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const destinationWhere = first.channel.platformChannelId
      ? and(
          eq(socialChannels.platform, first.platform),
          eq(socialChannels.platformChannelId, first.channel.platformChannelId),
        )
      : eq(uploadQueue.channelId, first.channelId);

    const [lastUpload] = await db
      .select({
        uploadedAt: uploadQueue.uploadedAt,
        scheduledAt: uploadQueue.scheduledAt,
        videoType: uploadQueue.videoType,
      })
      .from(uploadQueue)
      .innerJoin(socialChannels, eq(uploadQueue.channelId, socialChannels.id))
      .where(and(
        destinationWhere,
        eq(uploadQueue.platform, first.platform),
        eq(uploadQueue.status, "done"),
        isNotNull(uploadQueue.uploadedAt),
      ))
      .orderBy(desc(uploadQueue.uploadedAt))
      .limit(1);

    const taken: number[] = [];
    let currentAnchor = lastUpload?.scheduledAt
      ? new Date(lastUpload.scheduledAt)
      : lastUpload?.uploadedAt
        ? new Date(lastUpload.uploadedAt)
        : null;

    for (const row of groupRows) {
      const cfg = await resolveDestinationSettingForChannel(settings, row.videoType as PublishQueueType, {
        id: row.channelId,
        platformChannelId: row.channel.platformChannelId ?? null,
      })
        ?? getFallbackDestinationSetting(settings, row.videoType as PublishQueueType);
      const intervalMin = normalizeIntervalMin(
        cfg.intervalMin || 120,
        getMinIntervalForVideoType(row.videoType as PublishQueueType),
      );
      const notBefore = currentAnchor
        ? new Date(Math.max(
            currentAnchor.getTime() + intervalMin * 60_000,
            new Date().getTime(),
          ))
        : new Date(new Date().getTime());
      const slot = findNextAvailablePublishSlot({
        windowStart: cfg.windowStart,
        windowEnd: cfg.windowEnd,
        intervalMin,
        taken,
        notBefore,
        slotOffsetMinutes: getSlotOffsetMinutes(new Date(row.scheduledAt), intervalMin),
      });
      if (!slot) continue;

      if (slot.getTime() !== new Date(row.scheduledAt).getTime()) {
        await db.update(uploadQueue)
          .set({ scheduledAt: slot, updatedAt: new Date() })
          .where(eq(uploadQueue.id, row.id));
        updated++;
      }

      taken.push(slot.getTime());
      currentAnchor = slot;
    }
  }

  return { updated };
}

// ─── Auto-schedule settings ───────────────────────────────────────────────

export type AutoScheduleVideoSetting = {
  enabled: boolean;
  channelId: number;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  privacyStatus: "public" | "unlisted" | "private";
};

export type AutoScheduleSettings = {
  short: AutoScheduleVideoSetting;
  long: AutoScheduleVideoSetting;
  shortDestinations: AutoScheduleVideoSetting[];
  longDestinations: AutoScheduleVideoSetting[];
  quoteDestinations: AutoScheduleVideoSetting[];
};

const DEFAULT_AUTO_SCHEDULE: AutoScheduleSettings = {
  short: { enabled: false, channelId: 0, windowStart: "06:00", windowEnd: "22:00", intervalMin: 60, privacyStatus: "public" },
  long:  { enabled: false, channelId: 0, windowStart: "06:00", windowEnd: "22:00", intervalMin: 120, privacyStatus: "public" },
  shortDestinations: [],
  longDestinations: [],
  quoteDestinations: [],
};

function normalizeIntervalMin(value: number, min = 120): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.round(value));
}

function getMinIntervalForVideoType(videoType: PublishQueueType): number {
  return videoType === "long" ? 120 : 60;
}

function normalizeTimeValue(value: string, fallback: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

function normalizeVideoSetting(
  settings: Partial<AutoScheduleVideoSetting> | undefined,
  fallback: AutoScheduleVideoSetting,
  minInterval = 120,
): AutoScheduleVideoSetting {
  return {
    enabled: !!settings?.enabled,
    channelId: Number(settings?.channelId ?? 0),
    windowStart: normalizeTimeValue(settings?.windowStart ?? fallback.windowStart, fallback.windowStart),
    windowEnd: normalizeTimeValue(settings?.windowEnd ?? fallback.windowEnd, fallback.windowEnd),
    intervalMin: normalizeIntervalMin(settings?.intervalMin ?? fallback.intervalMin, minInterval),
    privacyStatus: settings?.privacyStatus ?? fallback.privacyStatus,
  };
}

function normalizeDestinationList(
  settings: unknown,
  fallback: AutoScheduleVideoSetting,
  minInterval = 120,
): AutoScheduleVideoSetting[] {
  if (!Array.isArray(settings)) return [];
  return settings.map((item) => normalizeVideoSetting(item as Partial<AutoScheduleVideoSetting>, fallback, minInterval));
}

function normalizeAutoScheduleSettings(settings: AutoScheduleSettings): AutoScheduleSettings {
  const shortLegacy = normalizeVideoSetting(settings.short, DEFAULT_AUTO_SCHEDULE.short, 60);
  const longLegacy = normalizeVideoSetting(settings.long, DEFAULT_AUTO_SCHEDULE.long, 120);
  const shortDestinations = normalizeDestinationList(settings.shortDestinations, DEFAULT_AUTO_SCHEDULE.short, 60);
  const longDestinations = normalizeDestinationList(settings.longDestinations, DEFAULT_AUTO_SCHEDULE.long, 120);
  const quoteFallback = { enabled: false, channelId: 0, windowStart: "06:00", windowEnd: "22:00", intervalMin: 60, privacyStatus: "public" as const };
  const quoteDestinations = normalizeDestinationList(settings.quoteDestinations, quoteFallback, 60);
  const mergedShort = shortDestinations.length > 0
    ? shortDestinations
    : (shortLegacy.channelId || shortLegacy.enabled ? [shortLegacy] : []);
  const mergedLong = longDestinations.length > 0
    ? longDestinations
    : (longLegacy.channelId || longLegacy.enabled ? [longLegacy] : []);
  return {
    short: mergedShort[0] ?? shortLegacy,
    long: mergedLong[0] ?? longLegacy,
    shortDestinations: mergedShort,
    longDestinations: mergedLong,
    quoteDestinations,
  };
}

type ChannelPublishConfigRecord = Record<string, {
  publishingEnabled: boolean;
  autoScheduleEnabled: boolean;
  allowLegacyEnvFallback: boolean;
  shortDestinations: AutoScheduleVideoSetting[];
  longDestinations: AutoScheduleVideoSetting[];
  quoteDestinations: AutoScheduleVideoSetting[];
}>;

async function loadChannelPublishConfigsRecord(): Promise<ChannelPublishConfigRecord> {
  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, CHANNEL_PUBLISH_CONFIGS_KEY),
  });
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as ChannelPublishConfigRecord;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildUiSettingsFromChannelPublishConfigs(
  configs: ChannelPublishConfigRecord,
): AutoScheduleSettings {
  const shortDestinations = Object.values(configs).flatMap((config) => config.shortDestinations ?? []);
  const longDestinations = Object.values(configs).flatMap((config) => config.longDestinations ?? []);
  const quoteDestinations = Object.values(configs).flatMap((config) => config.quoteDestinations ?? []);
  return normalizeAutoScheduleSettings({
    short: shortDestinations[0] ?? DEFAULT_AUTO_SCHEDULE.short,
    long: longDestinations[0] ?? DEFAULT_AUTO_SCHEDULE.long,
    shortDestinations,
    longDestinations,
    quoteDestinations,
  });
}

async function buildChannelPublishConfigsRecordFromUiSettings(
  settings: AutoScheduleSettings,
): Promise<ChannelPublishConfigRecord> {
  const channelIds = [
    ...settings.shortDestinations.map((destination) => destination.channelId),
    ...settings.longDestinations.map((destination) => destination.channelId),
    ...settings.quoteDestinations.map((destination) => destination.channelId),
  ].filter((channelId) => channelId > 0);

  const channels = channelIds.length > 0
    ? await db.query.socialChannels.findMany({
        where: inArray(socialChannels.id, channelIds),
        columns: { id: true, channelKey: true },
      })
    : [];
  const channelKeyById = new Map(
    channels.map((channel) => [channel.id, normalizeChannelKey(channel.channelKey)]),
  );
  const existing = await loadChannelPublishConfigsRecord();
  const next: ChannelPublishConfigRecord = { ...existing };

  const upsertDestinations = (
    destinationType: "shortDestinations" | "longDestinations" | "quoteDestinations",
    destinations: AutoScheduleVideoSetting[],
  ) => {
    for (const destination of destinations) {
      const channelKey = channelKeyById.get(destination.channelId);
      if (!channelKey) continue;
      const base = next[channelKey] ?? {
        publishingEnabled: getChannelDefinition(channelKey).publishingEnabled,
        autoScheduleEnabled: getChannelDefinition(channelKey).autoScheduleEnabled,
        allowLegacyEnvFallback: getChannelDefinition(channelKey).allowLegacyEnvFallback,
        shortDestinations: [],
        longDestinations: [],
        quoteDestinations: [],
      };
      next[channelKey] = {
        ...base,
        [destinationType]: [
          ...base[destinationType].filter((item) => item.channelId !== destination.channelId),
          destination,
        ],
      };
    }
  };

  for (const channelKey of [DEFAULT_CHANNEL_KEY, "tang_sau"] as const) {
    const base = next[channelKey] ?? {
      publishingEnabled: getChannelDefinition(channelKey).publishingEnabled,
      autoScheduleEnabled: getChannelDefinition(channelKey).autoScheduleEnabled,
      allowLegacyEnvFallback: getChannelDefinition(channelKey).allowLegacyEnvFallback,
      shortDestinations: [],
      longDestinations: [],
      quoteDestinations: [],
    };
    next[channelKey] = {
      ...base,
      shortDestinations: [],
      longDestinations: [],
      quoteDestinations: [],
    };
  }

  upsertDestinations("shortDestinations", settings.shortDestinations);
  upsertDestinations("longDestinations", settings.longDestinations);
  upsertDestinations("quoteDestinations", settings.quoteDestinations);

  for (const [channelKey, config] of Object.entries(next)) {
    const hasEnabledDestination = [
      ...config.shortDestinations,
      ...config.longDestinations,
      ...config.quoteDestinations,
    ].some((destination) => destination.enabled && destination.channelId > 0);
    next[channelKey] = {
      ...config,
      autoScheduleEnabled: hasEnabledDestination,
    };
  }

  return next;
}

export async function getAutoScheduleSettingsAction(): Promise<AutoScheduleSettings> {
  const channelConfigs = await loadChannelPublishConfigsRecord();
  if (Object.keys(channelConfigs).length > 0) {
    return buildUiSettingsFromChannelPublishConfigs(channelConfigs);
  }
  const row = await db.query.appConfig.findFirst({ where: eq(appConfig.key, "auto_schedule_settings") });
  if (!row) return DEFAULT_AUTO_SCHEDULE;
  try { return normalizeAutoScheduleSettings({ ...DEFAULT_AUTO_SCHEDULE, ...JSON.parse(row.value) } as AutoScheduleSettings); }
  catch { return DEFAULT_AUTO_SCHEDULE; }
}

export async function saveAutoScheduleSettingsAction(settings: AutoScheduleSettings): Promise<{ success: boolean }> {
  const normalized = normalizeAutoScheduleSettings(settings);
  const channelPublishConfigs = await buildChannelPublishConfigsRecordFromUiSettings(normalized);
  await db.insert(appConfig)
    .values({ key: "auto_schedule_settings", value: JSON.stringify(normalized), updatedAt: new Date() })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: JSON.stringify(normalized), updatedAt: new Date() } });
  await db.insert(appConfig)
    .values({
      key: CHANNEL_PUBLISH_CONFIGS_KEY,
      value: JSON.stringify(channelPublishConfigs),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: JSON.stringify(channelPublishConfigs),
        updatedAt: new Date(),
      },
    });
  await rebalanceQueuedUploadsAction("youtube");
  await rebalanceQueuedUploadsAction("facebook");
  return { success: true };
}

function getDestinationSettings(
  settings: AutoScheduleSettings,
  videoType: PublishQueueType,
): AutoScheduleVideoSetting[] {
  if (videoType === "long") return settings.longDestinations;
  if (videoType === "quote") return settings.quoteDestinations;
  return settings.shortDestinations;
}

function getDestinationSettingForChannel(
  settings: AutoScheduleSettings,
  videoType: PublishQueueType,
  channelId: number,
): AutoScheduleVideoSetting | null {
  const found = getDestinationSettings(settings, videoType).find((cfg) => cfg.channelId === channelId);
  if (found) return found;
  if (videoType === "quote") return null;
  const legacy = videoType === "long" ? settings.long : settings.short;
  return legacy.channelId === channelId ? legacy : null;
}

async function resolveDestinationSettingForChannel(
  settings: AutoScheduleSettings,
  videoType: PublishQueueType,
  channel: { id: number; platformChannelId: string | null },
): Promise<AutoScheduleVideoSetting | null> {
  const direct = getDestinationSettingForChannel(settings, videoType, channel.id);
  if (direct) return direct;
  if (!channel.platformChannelId) return null;

  const destinationIds = getDestinationSettings(settings, videoType)
    .map((cfg) => cfg.channelId)
    .filter((id) => id > 0);
  if (destinationIds.length === 0) return null;

  const rows = await db.query.socialChannels.findMany({
    where: inArray(socialChannels.id, destinationIds),
    columns: { id: true, platformChannelId: true },
  });
  const matched = rows.find((row) => row.platformChannelId === channel.platformChannelId);
  if (!matched) return null;
  return getDestinationSettingForChannel(settings, videoType, matched.id);
}

function getFallbackDestinationSetting(
  settings: AutoScheduleSettings,
  videoType: PublishQueueType,
): AutoScheduleVideoSetting {
  if (videoType === "quote") {
    return {
      enabled: false,
      channelId: 0,
      windowStart: "06:00",
      windowEnd: "22:00",
      intervalMin: 60,
      privacyStatus: "public",
    };
  }
  if (videoType === "long") return settings.long;
  return settings.short;
}

/**
 * Result codes returned by insertPhatPhapCampaignFbRow.
 * Used by callers and tests to assert which path was taken.
 */
export type PhatPhapCampaignFbResult =
  | "inserted"               // FB row successfully inserted at campaign slot
  | "wait_for_yt_slot"       // no queued YT short row yet; skip this pass, next cron will retry
  | "skip_dup"               // FB row already exists for this content/channel/type
  | "skip_slot_collision"    // a different content item already occupies (channel, slot, type)
  | "skip_no_content";       // content_id not found in content_generations

const PHAT_PHAP_CAMPAIGN_QUEUE_STATUSES = [
  "queued",
  "uploading",
  "done",
] as const;

function isPhatPhapCampaignQueueItem(input: {
  channelKey: string | null | undefined;
  platform: string;
  videoType: string;
}): boolean {
  return resolveChannelKey(input.channelKey) === DEFAULT_CHANNEL_KEY && (
    (input.platform === "youtube" && input.videoType === "short") ||
    (input.platform === "facebook" && (input.videoType === "short" || input.videoType === "quote"))
  );
}

async function findAlignedPhatPhapPrimaryShortRow(input: {
  contentId: string;
  quoteScheduledAt: Date;
}): Promise<{ id: string; platform: string; scheduledAt: Date; status: string } | null> {
  const primarySlot = new Date(input.quoteScheduledAt.getTime() - 5 * 60_000);
  const row = await db.query.uploadQueue.findFirst({
    where: and(
      eq(uploadQueue.contentId, input.contentId),
      eq(uploadQueue.videoType, "short"),
      eq(uploadQueue.scheduledAt, primarySlot),
      inArray(uploadQueue.status, [...PHAT_PHAP_CAMPAIGN_QUEUE_STATUSES]),
    ),
    columns: {
      id: true,
      platform: true,
      scheduledAt: true,
      status: true,
    },
    orderBy: [desc(uploadQueue.createdAt)],
  });

  return row
    ? {
        id: row.id,
        platform: row.platform,
        scheduledAt: new Date(row.scheduledAt),
        status: row.status,
      }
    : null;
}

// Finds an HH:00 anchor (HH:05 for the quote sidecar) where EVERY lane a phat_phap content
// item actually occupies (YouTube short, Facebook short/reel, Facebook quote sidecar) is
// simultaneously collision-free — not just the single lane that triggered the cooldown
// check. A candidate that is free on one lane but occupied on a sibling lane is rejected
// and the search continues forward. This is the fix for the root cause where
// findNextAvailablePublishSlot was only ever asked about the triggering row's own lane.
async function findFullLaneSafePhatPhapAnchor(input: {
  contentId: string;
  notBefore: Date;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  lanes: Array<{ platform: "youtube" | "facebook"; videoType: "short" | "quote"; channelId: number; platformChannelId: string | null }>;
}): Promise<{ anchor: Date | null; reason: string | null }> {
  const takenByLane = await Promise.all(
    input.lanes.map((lane) =>
      getTakenUploadSlotsForDestination({
        channelId: lane.channelId,
        platform: lane.platform,
        platformChannelId: lane.platformChannelId,
        videoType: lane.videoType,
      }),
    ),
  );

  return pickFullLaneSafeAnchor({
    notBefore: input.notBefore,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    intervalMin: input.intervalMin,
    lanes: input.lanes.map((lane, index) => ({
      videoType: lane.videoType,
      takenMs: takenByLane[index]
        .filter((row) => row.contentId !== input.contentId)
        .map((row) => row.scheduledAt.getTime()),
    })),
  });
}

type PhatPhapCampaignSyncResult = {
  moved: Array<{ id: string; platform: string; videoType: string; scheduledAt: string }>;
  blocked: boolean;
  reason: string | null;
};

async function syncQueuedPhatPhapCampaignRows(input: {
  contentId: string;
  anchorShortScheduledAt: Date;
  errorMessage: string;
  windowStart?: string;
  windowEnd?: string;
  intervalMin?: number;
}): Promise<PhatPhapCampaignSyncResult> {
  const rows = await db.query.uploadQueue.findMany({
    where: and(
      eq(uploadQueue.contentId, input.contentId),
      inArray(uploadQueue.status, ["queued"]),
      inArray(uploadQueue.platform, ["youtube", "facebook"]),
      inArray(uploadQueue.videoType, ["short", "quote"]),
    ),
    columns: {
      id: true,
      platform: true,
      videoType: true,
      scheduledAt: true,
      channelId: true,
    },
    with: {
      channel: { columns: { platformChannelId: true } },
    },
  });

  if (rows.length === 0) return { moved: [], blocked: false, reason: null };

  const lanes = rows.map((row) => ({
    platform: row.platform as "youtube" | "facebook",
    videoType: row.videoType as "short" | "quote",
    channelId: row.channelId,
    platformChannelId: row.channel?.platformChannelId ?? null,
  }));

  const { anchor, reason } = await findFullLaneSafePhatPhapAnchor({
    contentId: input.contentId,
    notBefore: input.anchorShortScheduledAt,
    windowStart: input.windowStart ?? "06:00",
    windowEnd: input.windowEnd ?? "22:00",
    intervalMin: input.intervalMin ?? 60,
    lanes,
  });

  if (!anchor) {
    return { moved: [], blocked: true, reason };
  }

  const quoteScheduledAt = new Date(anchor.getTime() + 5 * 60_000);
  const moved: Array<{ id: string; platform: string; videoType: string; scheduledAt: string }> = [];

  for (const row of rows) {
    const nextScheduledAt = row.videoType === "quote" ? quoteScheduledAt : anchor;
    if (new Date(row.scheduledAt).getTime() === nextScheduledAt.getTime()) continue;

    await db.update(uploadQueue).set({
      scheduledAt: nextScheduledAt,
      errorMessage: input.errorMessage,
      updatedAt: new Date(),
    }).where(eq(uploadQueue.id, row.id));

    moved.push({
      id: row.id,
      platform: row.platform,
      videoType: row.videoType,
      scheduledAt: nextScheduledAt.toISOString(),
    });
  }

  return { moved, blocked: false, reason: null };
}

/**
 * Insert a single Facebook upload_queue row anchored to the phat_phap campaign slot.
 *
 * The campaign slot is read from the ALREADY-CREATED queued YouTube short row for
 * this content. This ensures FB short = YT scheduled_at, FB quote = YT + 5 min.
 *
 * When the YouTube row does not exist yet (e.g. because the destination list is
 * processed Facebook-first, or the YT bulkScheduleAction was skipped this pass),
 * the function returns "wait_for_yt_slot" and inserts NOTHING.
 * The next cron invocation will call autoScheduleVideoAction again and the FB row
 * will be inserted once the YT row is present.
 *
 * NEVER falls back to independent next-available-FB-slot scheduling — that would
 * recreate the YT/FB drift bug this policy was designed to eliminate.
 */
async function insertPhatPhapCampaignFbRow(
  contentId: string,
  fbChannelId: number,
  videoType: "short" | "quote",
): Promise<PhatPhapCampaignFbResult> {
  // 1. Read campaign slot from the queued YouTube short row.
  //    If absent: signal WAIT_FOR_YT_SLOT — do not fall back to independent scheduling.
  const ytRow = await db.query.uploadQueue.findFirst({
    where: and(
      eq(uploadQueue.contentId, contentId),
      eq(uploadQueue.platform, "youtube"),
      eq(uploadQueue.videoType, "short"),
      inArray(uploadQueue.status, ["queued", "uploading"]),
    ),
    orderBy: [desc(uploadQueue.createdAt)],
    columns: { scheduledAt: true },
  });

  if (!ytRow) {
    // Do NOT fall back to bulkScheduleAction / independent FB slot.
    // The next cron pass will re-enter autoScheduleVideoAction and the YT duplicate
    // guard will skip YT (already queued) while FB will find the YT row and insert.
    console.warn(
      `[phatPhapCampaign] WAIT_FOR_YT_SLOT fb/${videoType} contentId=${contentId} — no queued YT short row; will retry next cron pass`,
    );
    return "wait_for_yt_slot";
  }

  const campaignSlot = new Date(ytRow.scheduledAt);
  const fbSlot =
    videoType === "quote"
      ? new Date(campaignSlot.getTime() + 5 * 60_000)
      : campaignSlot;

  // 2a. Content-level duplicate guard (same content, same channel, same type)
  const existing = await db.query.uploadQueue.findFirst({
    where: and(
      eq(uploadQueue.contentId, contentId),
      eq(uploadQueue.channelId, fbChannelId),
      eq(uploadQueue.videoType, videoType),
      inArray(uploadQueue.status, ["queued", "uploading", "done", "cancelled"]),
    ),
    columns: { id: true },
  });
  if (existing) {
    console.log(
      `[phatPhapCampaign] SKIP dup fb/${videoType} contentId=${contentId} existingId=${existing.id}`,
    );
    return "skip_dup";
  }

  // 2b. Slot-level collision guard: prevent a different content item from
  //     landing on the same (channel, scheduledAt, videoType) slot.
  //     This catches the case where multiple content items' YT rows all share
  //     the same campaign slot, which would otherwise produce N FB rows at
  //     the same time (the root cause of the 2026-06-15 overposting incident).
  const slotCollision = await db.query.uploadQueue.findFirst({
    where: and(
      eq(uploadQueue.channelId, fbChannelId),
      eq(uploadQueue.videoType, videoType),
      eq(uploadQueue.scheduledAt, fbSlot),
      inArray(uploadQueue.status, ["queued", "uploading", "done"]),
    ),
    columns: { id: true, contentId: true },
  });
  if (slotCollision && slotCollision.contentId !== contentId) {
    console.warn(
      `[phatPhapCampaign] SKIP slot_collision fb/${videoType} contentId=${contentId} — slot ${fbSlot.toISOString()} already occupied by ${slotCollision.contentId}`,
    );
    return "skip_slot_collision";
  }

  // 3. Fetch content metadata for title/description
  const content = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
    columns: {
      id: true,
      topic: true,
      nicheId: true,
      nicheName: true,
      shortContent: true,
      longContent: true,
      longYoutubeDescription: true,
      contentProfileKey: true,
      channelKey: true,
      formatType: true,
      promptVersions: true,
    },
  });
  if (!content) {
    console.warn(
      `[phatPhapCampaign] SKIP fb/${videoType} — content not found contentId=${contentId}`,
    );
    return "skip_no_content";
  }

  const fbChannel = await db.query.socialChannels.findFirst({
    where: eq(socialChannels.id, fbChannelId),
    columns: {
      id: true,
      name: true,
      platform: true,
      channelKey: true,
    },
  });
  if (!fbChannel) {
    console.warn(
      `[cross_channel_guard] skip_schedule_missing_destination contentId=${contentId} channelId=${fbChannelId}`,
    );
    return "skip_no_content";
  }
  const crossChannelError = getCrossChannelScheduleError({
    requestedVideoType: videoType,
    expectedChannelKey: content.channelKey,
    destination: fbChannel,
    content: {
      id: content.id,
      channelKey: content.channelKey,
      nicheId: content.nicheId,
      contentProfileKey: content.contentProfileKey,
      formatType: content.formatType,
    },
  });
  if (crossChannelError) {
    console.error(
      `[cross_channel_guard] skip_schedule contentId=${contentId} channelId=${fbChannelId} platform=facebook videoType=${videoType} error=${crossChannelError}`,
    );
    return "skip_no_content";
  }

  const topic = content.topic ?? "";
  let quoteArtifact: QuoteArtifactMetadata | null = null;
  if (videoType === "quote") {
    const resolvedQuote = await resolveFacebookQuoteArtifact({
      topic,
      shortContent: content.shortContent,
      contentProfileKey: content.contentProfileKey,
      channelKey: content.channelKey,
      nicheName: content.nicheName,
      sourceContentId: contentId,
      sourceFormatType: content.formatType ?? null,
    });
    quoteArtifact = resolvedQuote.metadata;
    await db.update(contentGenerations).set({
      promptVersions: mergePromptVersions(content.promptVersions, {
        quote: createPromptVersionEntry("quote", {
          model: resolvedQuote.usage?.model ?? null,
          stage: "quote",
          mode: "facebook_quote_photo",
          details: quoteArtifact as unknown as Record<string, unknown>,
        }),
      }),
    }).where(eq(contentGenerations.id, contentId));
    if (resolvedQuote.usage) {
      await logApiUsage({
        model: resolvedQuote.usage.model,
        purpose: "quote_text",
        inputTokens: resolvedQuote.usage.inputTokens,
        outputTokens: resolvedQuote.usage.outputTokens,
        contentGenerationId: contentId,
        metadata: {
          channelKey: content.channelKey,
          platform: "facebook",
          videoType: "quote",
          quoteSourceType: quoteArtifact.quoteSourceType,
          quoteStyle: quoteArtifact.quoteStyle,
          kinetic: quoteArtifact.kinetic,
        },
      });
    }
  }
  const metadata =
    videoType === "quote"
      ? {
          title: (quoteArtifact?.quoteText ?? buildFacebookQuoteText({
            topic,
            shortContent: content.shortContent,
            contentProfileKey: content.contentProfileKey,
          })).slice(0, 100),
          description: buildDefaultVideoDescription({
            platform: "facebook",
            contentType: "quote",
            topic,
            nicheName: content.nicheName,
            shortContent: content.shortContent,
            longContent: content.longContent,
            longYoutubeDescription: content.longYoutubeDescription,
            contentProfileKey: content.contentProfileKey,
            quoteText: quoteArtifact?.quoteText,
          }),
          tags: [] as string[],
        }
      : {
          title: buildDefaultVideoTitle({
            platform: "facebook",
            contentType: "short",
            topic,
            contentProfileKey: content.contentProfileKey,
            shortContent: content.shortContent,
          }),
          description: buildDefaultVideoDescription({
            platform: "facebook",
            contentType: "short",
            topic,
            nicheName: content.nicheName,
            shortContent: content.shortContent,
            longContent: content.longContent,
            longYoutubeDescription: content.longYoutubeDescription,
            contentProfileKey: content.contentProfileKey,
          }),
          tags: [] as string[],
        };

  // 4. Log intended row before insert (dry-run preview)
  const slotLabel =
    videoType === "quote"
      ? `campaign_slot+5min (${fbSlot.toISOString()})`
      : `campaign_slot (${fbSlot.toISOString()})`;
  console.log(
    `[phatPhapCampaign] INSERT fb/${videoType} contentId=${contentId} channelId=${fbChannelId} scheduledAt=${slotLabel}` +
      `${quoteArtifact ? ` quoteSourceType=${quoteArtifact.quoteSourceType}` : ""}`,
  );

  // 5. Insert the row
  await db.insert(uploadQueue).values({
    contentId,
    channelId: fbChannelId,
    platform: "facebook",
    videoType,
    title: metadata.title,
    description: metadata.description,
    tags: metadata.tags,
    privacyStatus: "public",
    scheduledAt: fbSlot,
    status: "queued",
  });

  return "inserted";
}

/**
 * @internal — test-only re-export of insertPhatPhapCampaignFbRow.
 * Allows integration tests to exercise the wait-for-yt-slot path directly
 * without routing through autoScheduleVideoAction.
 * Do NOT call this from production code.
 */
export const _phatPhapCampaignFbRow = insertPhatPhapCampaignFbRow;

export async function autoScheduleVideoAction(
  contentId: string,
  videoType: PublishQueueType,
): Promise<void> {
  const content = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
    columns: {
      id: true,
      channelKey: true,
      nicheId: true,
      topic: true,
      shortContent: true,
      script: true,
      experimentVariant: true,
      formatType: true,
      contentProfileKey: true,
      topicFamily: true,
      promptVersions: true,
    },
  });
  if (!content) return;

  // Block legacy Buddhist CTA content from being re-queued by auto-schedule.
  // requireShortCta was disabled for phat_phap on 2026-06-07; old HOOK_V1/null
  // era items still carry the baked subscriber CTA in short_content.
  if (content.channelKey === "phat_phap" && content.shortContent) {
    const hasLegacyCta =
      content.shortContent.includes("nhấn thích") ||
      content.shortContent.includes("theo dõi kênh") ||
      content.shortContent.includes("đăng ký");
    if (hasLegacyCta) {
      console.log(`[autoSchedule] blocked_legacy_buddhist_cta contentId=${contentId}`);
      return;
    }
  }

  const publishSafety = await getChannelPublishSafety(content.channelKey, videoType, {
    requireConfiguredDestinations: true,
  });
  if (!publishSafety.ok) return;

  const config = await getChannelPublishConfig(publishSafety.channelKey);
  if (!config) return;
  if (!config.autoScheduleEnabled) return;
  const destinations = getChannelDestinations(config, videoType);
  for (const cfg of destinations) {
    if (!cfg.enabled || !cfg.channelId) continue;

    let channelId = cfg.channelId;
    const configuredChannel = await db.query.socialChannels.findFirst({
      where: eq(socialChannels.id, cfg.channelId),
    });
    if (!configuredChannel) continue;
    const crossChannelError = getCrossChannelScheduleError({
      requestedVideoType: videoType,
      expectedChannelKey: publishSafety.channelKey,
      destination: {
        id: configuredChannel.id,
        name: configuredChannel.name,
        platform: configuredChannel.platform,
        channelKey: configuredChannel.channelKey,
      },
      content: {
        id: content.id,
        channelKey: content.channelKey,
        nicheId: content.nicheId,
        contentProfileKey: content.contentProfileKey,
        formatType: content.formatType,
        title: content.topic,
        topic: content.topic,
        shortContent: content.shortContent,
        script: content.script,
        topicFamily: content.topicFamily,
        promptVersions: content.promptVersions,
      },
    });
    if (crossChannelError) {
      console.error(
        `[cross_channel_guard] auto_schedule_block contentId=${content.id} destinationChannelId=${configuredChannel.id} platform=${configuredChannel.platform} requestedVideoType=${videoType} error=${crossChannelError}`,
      );
      continue;
    }
    if (configuredChannel.platform === "facebook" && videoType === "long") continue;
    // legacy_quote_short is a music-backed MP4 Short — eligible for YouTube as video_type='short'.
    // Plain quote photo posts (non-video formats) remain blocked from YouTube.
    const effectiveVideoType: PublishQueueType =
      configuredChannel.platform === "youtube" &&
      videoType === "quote" &&
      content.formatType === "legacy_quote_short"
        ? "short"
        : videoType;
    if (configuredChannel.platform === "youtube" && effectiveVideoType === "quote") continue;
    const isExceeded = !!(configuredChannel.quotaExceededUntil && configuredChannel.quotaExceededUntil > new Date());
    if (configuredChannel.platform === "youtube" && isExceeded && configuredChannel.platformChannelId) {
      const altId = await findAvailableYouTubeChannel(cfg.channelId, configuredChannel.platformChannelId);
      if (altId) channelId = altId;
    }

    // phat_phap same-slot campaign policy: FB rows are anchored to the YT short
    // campaign slot rather than independently scheduled.
    // - FB short row  → same scheduled_at as the YT short row
    // - FB quote row  → YT short scheduled_at + 5 min
    if (
      content.channelKey === "phat_phap" &&
      configuredChannel.platform === "facebook" &&
      (effectiveVideoType === "short" || effectiveVideoType === "quote")
    ) {
      await insertPhatPhapCampaignFbRow(contentId, channelId, effectiveVideoType);
    } else {
      await bulkScheduleAction({
        videoType: effectiveVideoType,
        channelId,
        windowStart: cfg.windowStart,
        windowEnd: cfg.windowEnd,
        intervalMin: cfg.intervalMin,
        privacyStatus: cfg.privacyStatus,
        contentIds: [contentId],
      });
    }
  }
}

// ─── Quota rotation helper ─────────────────────────────────────────────────

const SAFE_UPLOAD_LIMIT = 5; // conservative: 5 × 1650 = 8250 units (leave buffer)

async function findAvailableYouTubeChannel(
  currentChannelId: number,
  platformChannelId: string,
): Promise<number | null> {
  // Find other active channels for same YouTube channel that aren't exceeded
  const now = new Date();
  const candidates = await db.query.socialChannels.findMany({
    where: (t, { and: a, eq: e, ne: neq }) => a(
      e(t.platform, "youtube"),
      e(t.platformChannelId, platformChannelId),
      neq(t.id, currentChannelId),
      e(t.isActive, true),
    ),
  });

  const midnight = pacificMidnightUtc();

  for (const ch of candidates) {
    if (ch.needsReconnect) continue;
    if (ch.quotaExceededUntil && ch.quotaExceededUntil > now) continue;
    if (!ch.accessToken) continue;

    const [row] = await db
      .select({ cnt: count() })
      .from(uploadQueue)
      .where(and(
        eq(uploadQueue.channelId, ch.id),
        eq(uploadQueue.status, "done"),
        gte(uploadQueue.uploadedAt, midnight),
      ));
    if (Number(row?.cnt ?? 0) < SAFE_UPLOAD_LIMIT) return ch.id;
  }
  return null;
}

// ─── Cron: process due upload queue items ─────────────────────────────────

export async function processUploadQueueAction(input?: string | {
  platformFilter?: string;
  dryRun?: boolean;
  allowUpload?: boolean;
  source?: "cron" | "scheduler_job" | "manual" | "script" | "verify";
  runId?: string;
  job?: string;
}): Promise<{
  processed: number;
  results: UploadProcessResult[];
}> {
  type EnrichedDueCandidate = {
    item: typeof dueCandidates[number];
    channelKey: string;
    overdueMinutes: number;
    staleThresholdMinutes: number | null;
    staleGroupKey: string | null;
    isStale: boolean;
  };

  const options = typeof input === "string"
    ? { platformFilter: input }
    : (input ?? {});
  const platformFilter = options.platformFilter;
  const runId = options.runId ?? crypto.randomUUID();
  const source = options.source ?? "manual";
  const job = options.job ?? null;
  const dryRun = options.dryRun === true || (
    options.allowUpload !== true &&
    options.source != null &&
    options.source !== "cron"
  );

  // Reset items stuck in "uploading" for more than 10 minutes (crashed / OOM run)
  const stuckCutoff = new Date(Date.now() - 10 * 60 * 1000);
  await db.update(uploadQueue)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(uploadQueue.status, "uploading"), lte(uploadQueue.updatedAt, stuckCutoff)));

  const dueCandidates = await db.query.uploadQueue.findMany({
    where: (t, { and: a, eq: e, lte: lte2 }) =>
      a(
        e(t.status, "queued"),
        lte2(t.scheduledAt, new Date()),
        ...(platformFilter ? [e(t.platform, platformFilter)] : []),
      ),
    with: {
      content: true,
      channel: true,
    },
    orderBy: (t, { asc }) => asc(t.scheduledAt),
    limit: 25,
  });

  const thresholdCache = new Map<string, number | null>();
  async function resolveThreshold(channelKey: string, platform: string): Promise<number | null> {
    const cacheKey = `${channelKey}:${platform}`;
    if (thresholdCache.has(cacheKey)) return thresholdCache.get(cacheKey) ?? null;
    const threshold = await getStaleBacklogThresholdMinutes(channelKey, platform);
    thresholdCache.set(cacheKey, threshold);
    return threshold;
  }

  const enrichedCandidates: EnrichedDueCandidate[] = [];
  for (const item of dueCandidates) {
    const channelKey = resolveChannelKey(item.channel.channelKey);
    const overdueMinutes = getOverdueMinutes(new Date(item.scheduledAt), new Date());
    const staleThresholdMinutes = await resolveThreshold(channelKey, item.platform);
    const staleGroupKey = staleThresholdMinutes != null ? `${channelKey}:${item.platform}` : null;
    enrichedCandidates.push({
      item,
      channelKey,
      overdueMinutes,
      staleThresholdMinutes,
      staleGroupKey,
      isStale: staleThresholdMinutes != null && overdueMinutes >= staleThresholdMinutes,
    });
  }

  const dueFacebookItems = enrichedCandidates.filter(
    ({ item, channelKey }) =>
      item.platform === "facebook" &&
      channelKey === DEFAULT_CHANNEL_KEY,
  );
  let facebookPreflightBlocked = false;
  if (dueFacebookItems.length > 0) {
    const health = await refreshFacebookEnvHealth();
    if (!health.ok) {
      facebookPreflightBlocked = true;
      const deferUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
      const message = health.needsReconnect
        ? "Facebook token hết hạn hoặc thiếu quyền. Queue đang tạm hoãn chờ cập nhật token."
        : `Facebook chưa sẵn sàng: ${health.message}`;
      const affectedChannels = new Set<number>();
      for (const { item } of dueFacebookItems) {
        if (affectedChannels.has(item.channelId)) continue;
        affectedChannels.add(item.channelId);
        await db.update(socialChannels).set({
          needsReconnect: health.needsReconnect,
          lastError: health.message.slice(0, 500),
          updatedAt: new Date(),
        }).where(eq(socialChannels.id, item.channelId));
        await pauseQueuedUploadsForChannel(item.channelId, message, deferUntil);
      }
    }
  }
  const due: EnrichedDueCandidate[] = [];
  const candidatesByPlatform = new Map<string, EnrichedDueCandidate[]>();
  for (const candidate of enrichedCandidates) {
    const { item, channelKey } = candidate;
    if (
      facebookPreflightBlocked &&
      item.platform === "facebook" &&
      channelKey === DEFAULT_CHANNEL_KEY
    ) continue;
    const list = candidatesByPlatform.get(item.platform) ?? [];
    list.push(candidate);
    candidatesByPlatform.set(item.platform, list);
  }

  for (const [platform, candidates] of candidatesByPlatform.entries()) {
    const preferred = candidates.find((candidate) => !candidate.isStale) ?? candidates[0];
    due.push(preferred);

    const staleCandidates = candidates.filter((candidate) => candidate.isStale);
    if (staleCandidates.length > 0) {
      const staleGroupKey = preferred.staleGroupKey
        ?? staleCandidates[0]?.staleGroupKey
        ?? `${preferred.channelKey}:${platform}`;
      logUploadEvent("stale_backlog_detected", {
        cron_run_id: runId,
        source,
        job,
        channel_key: preferred.channelKey,
        platform,
        stale_group_key: staleGroupKey,
        stale_threshold_minutes: staleCandidates[0]?.staleThresholdMinutes,
        stale_candidate_ids: staleCandidates.map((candidate) => candidate.item.id),
        stale_count: staleCandidates.length,
        selected_item_id: preferred.item.id,
        selected_item_stale: preferred.isStale,
      });
    }

    for (const candidate of staleCandidates) {
      if (candidate.item.id === preferred.item.id) continue;
      logUploadEvent("skip_group_already_handled", {
        cron_run_id: runId,
        source,
        job,
        backlog_guard_action: "skip_group_already_handled",
        stale_group_key: candidate.staleGroupKey,
        stale_threshold_minutes: candidate.staleThresholdMinutes,
        channel_key: candidate.channelKey,
        platform: candidate.item.platform,
        video_type: candidate.item.videoType,
        item_id: candidate.item.id,
        content_id: candidate.item.contentId,
        old_scheduled_at: new Date(candidate.item.scheduledAt).toISOString(),
        selected_item_id: preferred.item.id,
      });
    }
  }

  logUploadEvent("selection", {
    cron_run_id: runId,
    source,
    job,
    selected_count: due.length,
    selected_items: due.map((candidate) => ({
      id: candidate.item.id,
      content_id: candidate.item.contentId,
      channel_key: candidate.channelKey,
      platform: candidate.item.platform,
      video_type: candidate.item.videoType,
      status_before_claim: candidate.item.status,
      scheduled_at: new Date(candidate.item.scheduledAt).toISOString(),
      overdue_minutes: candidate.overdueMinutes,
      stale_threshold_minutes: candidate.staleThresholdMinutes,
      stale_group_key: candidate.staleGroupKey,
      is_stale: candidate.isStale,
    })),
  });

  const results: UploadProcessResult[] = [];
  const autoScheduleSettings = await getAutoScheduleSettingsAction();

  // Channels confirmed quota-exceeded in this cron run — skip API calls for them
  const quotaExceededThisRun = new Set<number>();

  for (const candidate of due) {
    const { item, channelKey, overdueMinutes, staleThresholdMinutes, staleGroupKey, isStale } = candidate;
    const now = new Date();
    const scheduledAt = new Date(item.scheduledAt);
    const logContext = {
      cron_run_id: runId,
      source,
      job,
      item_id: item.id,
      content_id: item.contentId,
      channel_key: channelKey,
      platform: item.platform,
      video_type: item.videoType,
      status_before_claim: item.status,
      scheduled_at: scheduledAt.toISOString(),
      overdue_minutes: overdueMinutes,
      stale_threshold_minutes: staleThresholdMinutes,
      stale_group_key: staleGroupKey,
      is_stale: isStale,
    };

    if (isStale) {
      logUploadEvent("stale_backlog_allow_one", {
        ...logContext,
        backlog_guard_action: "allow_one",
      });
    }

    if (!isUploadScheduledDue(scheduledAt, now)) {
      logUploadEvent("skip_not_due", logContext);
      results.push({ id: item.id, ok: false, error: "not_due_yet", overdueMinutes });
      continue;
    }

    if (!item.channel.isActive) {
      const err = `Channel "${item.channel.name}" đang tắt nên chưa thể đăng`;
      await db.update(uploadQueue).set({
        status: "error",
        errorMessage: err,
        updatedAt: new Date(),
      }).where(eq(uploadQueue.id, item.id));
      results.push({ id: item.id, ok: false, error: err, overdueMinutes });
      continue;
    }

    const publishSafety = await getChannelPublishSafety(
      item.content.channelKey,
      item.videoType as PublishQueueType,
    );
    if (!publishSafety.ok) {
      await db.update(uploadQueue).set({
        status: "error",
        errorMessage: publishSafety.error,
        updatedAt: new Date(),
      }).where(eq(uploadQueue.id, item.id));
      results.push({ id: item.id, ok: false, error: publishSafety.error });
      continue;
    }
    const destinationOwnershipError = getDestinationOwnershipError(
      item.content.channelKey,
      item.channel.channelKey,
      item.channel.name,
    );
    if (destinationOwnershipError) {
      await db.update(uploadQueue).set({
        status: "error",
        errorMessage: destinationOwnershipError,
        updatedAt: new Date(),
      }).where(eq(uploadQueue.id, item.id));
      results.push({ id: item.id, ok: false, error: destinationOwnershipError });
      continue;
    }

    const tangSauViolation = getTangSauIsolationViolation({
      channelKey: item.content.channelKey,
      nicheId: item.content.nicheId,
      contentProfileKey: item.content.contentProfileKey,
      formatType: item.content.formatType,
      title: item.title,
      topic: item.content.topic,
      shortContent: item.content.shortContent,
      script: item.content.script,
      topicFamily: item.content.topicFamily,
      promptVersions: item.content.promptVersions,
    });
    if (tangSauViolation) {
      const err = `${tangSauViolation.code}: ${tangSauViolation.hits.join(", ")}`;
      await db.update(uploadQueue).set({
        status: "error",
        errorMessage: err,
        updatedAt: new Date(),
      }).where(eq(uploadQueue.id, item.id));
      results.push({ id: item.id, ok: false, error: err });
      continue;
    }

    if (
      resolveChannelKey(item.content.channelKey) === DEFAULT_CHANNEL_KEY &&
      item.platform === "facebook" &&
      item.videoType === "quote"
    ) {
      const alignedPrimary = await findAlignedPhatPhapPrimaryShortRow({
        contentId: item.contentId,
        quoteScheduledAt: scheduledAt,
      });
      if (!alignedPrimary) {
        const err = "quote_sidecar_missing_primary_short";
        await db.update(uploadQueue).set({
          status: "error",
          errorMessage: err,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
        logUploadEvent("quote_sidecar_missing_primary_short", logContext);
        results.push({ id: item.id, ok: false, error: err });
        continue;
      }
    }

    if (item.platform === "facebook" && item.channel.needsReconnect) {
      const deferUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
      await db.update(uploadQueue).set({
        scheduledAt: deferUntil,
        errorMessage: "Facebook token hết hạn hoặc thiếu quyền. Cần cập nhật token trước khi đăng tiếp.",
        updatedAt: new Date(),
      }).where(eq(uploadQueue.id, item.id));
      results.push({ id: item.id, ok: false, error: "facebook_reconnect_required" });
      continue;
    }

    // ── Early rotate: channel already known quota-exceeded in this run ────
    if (item.platform === "youtube" && quotaExceededThisRun.has(item.channelId)) {
      const altChannelId = await findAvailableYouTubeChannel(
        item.channelId,
        item.channel.platformChannelId ?? "",
      );
      if (altChannelId) {
        await db.update(uploadQueue).set({
          channelId: altChannelId,
          status: "queued",
          errorMessage: "Chuyển kênh dự phòng (quota)",
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
        results.push({ id: item.id, ok: false, error: "quota_rotated" });
        continue;
      }
      // No alt — defer all remaining to next reset and stop this batch
      const resetAt = nextQuotaResetUtc();
      await db.update(uploadQueue).set({
        status: "queued",
        scheduledAt: resetAt,
        errorMessage: "Hết quota tất cả kênh",
        updatedAt: new Date(),
      }).where(eq(uploadQueue.id, item.id));
      results.push({ id: item.id, ok: false, error: "quota_exceeded_all" });
      break;
    }

    const destinationWhere = item.channel.platformChannelId
      ? and(
          eq(socialChannels.platform, item.platform),
          eq(socialChannels.platformChannelId, item.channel.platformChannelId),
        )
      : eq(uploadQueue.channelId, item.channelId);
    const [lastUpload] = await db
      .select({
        uploadedAt: uploadQueue.uploadedAt,
        scheduledAt: uploadQueue.scheduledAt,
      })
      .from(uploadQueue)
      .innerJoin(socialChannels, eq(uploadQueue.channelId, socialChannels.id))
      .where(and(
        destinationWhere,
        eq(uploadQueue.platform, item.platform),
        eq(uploadQueue.status, "done"),
        isNotNull(uploadQueue.uploadedAt),
      ))
      .orderBy(desc(uploadQueue.uploadedAt))
      .limit(1);
    const resolvedDestination = await resolveDestinationSettingForChannel(
      autoScheduleSettings,
      item.videoType as PublishQueueType,
      { id: item.channelId, platformChannelId: item.channel.platformChannelId ?? null },
    );
    const scheduleConfig = resolvedDestination
      ?? getFallbackDestinationSetting(autoScheduleSettings, item.videoType as PublishQueueType);
    const intervalMin = normalizeIntervalMin(
      scheduleConfig.intervalMin || 120,
      getMinIntervalForVideoType(item.videoType as PublishQueueType),
    );
    const lastAnchor = lastUpload?.scheduledAt
      ? new Date(Math.max(
          new Date(lastUpload.scheduledAt).getTime(),
          lastUpload.uploadedAt ? new Date(lastUpload.uploadedAt).getTime() : 0,
        ))
      : lastUpload?.uploadedAt
        ? new Date(lastUpload.uploadedAt)
        : null;
    const nextAllowedAt = lastAnchor
      ? new Date(lastAnchor.getTime() + intervalMin * 60_000)
      : null;
    if (nextAllowedAt && nextAllowedAt > new Date()) {
      const takenRows = await getTakenUploadSlotsForDestination({
        channelId: item.channelId,
        platform: item.platform,
        platformChannelId: item.channel.platformChannelId ?? null,
        videoType: item.videoType,
        since: new Date(Date.now() - 24 * 60 * 60 * 1000),
        excludeQueueIds: [item.id],
      });
      const slotOffsetMinutes = getSlotOffsetMinutes(scheduledAt, intervalMin);
      const deferredTaken = takenRows.map((row) => row.scheduledAt.getTime());
      const deferredSlot = findNextAvailablePublishSlot({
        windowStart: scheduleConfig.windowStart,
        windowEnd: scheduleConfig.windowEnd,
        intervalMin,
        taken: deferredTaken,
        notBefore: nextAllowedAt,
        slotOffsetMinutes,
      }) ?? nextAllowedAt;
      const deferMessage = `Dời lịch để giữ khoảng cách ${intervalMin} phút`;
      const isPhatPhapCampaignItem = isPhatPhapCampaignQueueItem({
        channelKey: item.content.channelKey,
        platform: item.platform,
        videoType: item.videoType,
      });

      let syncedRows: Array<{ id: string; platform: string; videoType: string; scheduledAt: string }> = [];
      let syncBlockedReason: string | null = null;
      if (isPhatPhapCampaignItem) {
        const anchorShortScheduledAt = item.videoType === "quote"
          ? new Date(deferredSlot.getTime() - 5 * 60_000)
          : deferredSlot;
        const syncResult = await syncQueuedPhatPhapCampaignRows({
          contentId: item.contentId,
          anchorShortScheduledAt,
          errorMessage: deferMessage,
        });
        syncedRows = syncResult.moved;
        if (syncResult.blocked) {
          // No anchor is collision-free across every sibling lane. Leave all of this
          // content item's rows untouched rather than moving only `item` onto a slot
          // that was only ever checked against its own lane — that is the exact bug
          // being fixed here.
          syncBlockedReason = syncResult.reason;
        } else if (syncedRows.length === 0) {
          await db.update(uploadQueue).set({
            scheduledAt: deferredSlot,
            errorMessage: deferMessage,
            updatedAt: new Date(),
          }).where(eq(uploadQueue.id, item.id));
        }
      } else {
        await db.update(uploadQueue).set({
          scheduledAt: deferredSlot,
          errorMessage: deferMessage,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
      }
      if (syncBlockedReason) {
        logUploadEvent("skip_cooldown_blocked_no_safe_anchor", {
          ...logContext,
          defer_blocked_reason: syncBlockedReason,
        });
        results.push({ id: item.id, ok: false, error: `defer_blocked: ${syncBlockedReason}` });
        continue;
      }
      logUploadEvent("skip_cooldown", {
        ...logContext,
        backlog_guard_action: isStale ? "defer_due_to_cooldown" : undefined,
        last_done_scheduled_at: lastUpload?.scheduledAt
          ? new Date(lastUpload.scheduledAt).toISOString()
          : null,
        last_done_uploaded_at: lastUpload?.uploadedAt
          ? new Date(lastUpload.uploadedAt).toISOString()
          : null,
        next_allowed_publish_at: nextAllowedAt.toISOString(),
        old_scheduled_at: scheduledAt.toISOString(),
        new_scheduled_at: deferredSlot.toISOString(),
        deferred_to: deferredSlot.toISOString(),
        interval_min: intervalMin,
        synced_rows: syncedRows,
      });
      results.push({ id: item.id, ok: false, error: "upload_interval_deferred" });
      continue;
    }

    if (dryRun) {
      results.push({ id: item.id, ok: false, error: "dry_run", overdueMinutes });
      continue;
    }

    // ── Atomically claim: only proceed if we successfully move queued→uploading ─
    // This prevents two concurrent processUploadQueueAction calls from
    // uploading the same item (race between SELECT and UPDATE).
    const [claimed] = await db.update(uploadQueue)
      .set({ status: "uploading", updatedAt: new Date() })
      .where(and(eq(uploadQueue.id, item.id), eq(uploadQueue.status, "queued")))
      .returning({ id: uploadQueue.id });
    if (!claimed) {
      logUploadEvent("claim_failed", logContext);
      continue;
    }
    logUploadEvent("claim_succeeded", logContext);

    const videoPath = item.videoType === "long"
      ? item.content.longVideoPath
      : item.videoType === "short"
        ? item.content.videoPath
        : null;

    if (item.videoType !== "quote" && !videoPath) {
      const err = `Video ${item.videoType} chưa có file path`;
      await db.update(uploadQueue)
        .set({ status: "error", errorMessage: err, updatedAt: new Date() })
        .where(eq(uploadQueue.id, item.id));
      results.push({ id: item.id, ok: false, error: err });
      continue;
    }

    // TTS Short pre-publish safety check: if content starts with "---" (a Markdown
    // separator that VieNeu-TTS may speak as a prosody token, elongating the first
    // spoken word) AND the video file was rendered before the sanitizer fix was
    // applied (2026-06-04T04:33:00Z / 11:33 VN), block with a clear error so the
    // asset can be re-rendered with the fixed normalizer before going live.
    // Legacy Quote Shorts have no audioPath and are intentionally excluded.
    if (
      item.videoType === "short" &&
      item.content.audioPath &&
      /^\s*-{3,}\s*\n/.test(item.content.shortContent ?? "")
    ) {
      const SANITIZER_FIX_UTC = new Date("2026-06-04T04:33:00Z").getTime();
      const absVideoPath = path.isAbsolute(videoPath!)
        ? videoPath!
        : path.join(process.cwd(), videoPath!);
      let isPreSanitizerAsset = false;
      try {
        const stat = fs.statSync(absVideoPath);
        isPreSanitizerAsset = stat.mtimeMs < SANITIZER_FIX_UTC;
      } catch {
        // File not accessible — other checks will handle the missing-file case
      }
      if (isPreSanitizerAsset) {
        const err = "tts_asset_may_be_pre_sanitizer";
        await db.update(uploadQueue)
          .set({ status: "error", errorMessage: err, updatedAt: new Date() })
          .where(eq(uploadQueue.id, item.id));
        results.push({ id: item.id, ok: false, error: err });
        continue;
      }
    }

    if (item.platform === "youtube") {
      const guardError = getYouTubePublishGuardError(item);
      if (guardError) {
        await db.update(uploadQueue).set({
          status: "error",
          errorMessage: guardError,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
        logUploadEvent("youtube_publish_guard_failed", {
          ...logContext,
          guard_error: guardError,
          oauth_client_config_id: item.channel.oauthClientConfigId ?? null,
          destination_channel_id: item.channel.platformChannelId ?? null,
          destination_channel_name: item.channel.name,
        });
        results.push({ id: item.id, ok: false, error: guardError });
        continue;
      }

      const destinationVerification = await verifyYouTubeUploadDestination(item.channelId);
      if (!destinationVerification.ok) {
        await db.update(uploadQueue).set({
          status: "error",
          errorMessage: destinationVerification.error,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
        logUploadEvent("youtube_publish_guard_failed", {
          ...logContext,
          guard_error: destinationVerification.error,
          oauth_credential_identity: destinationVerification.oauthCredentialIdentity,
          oauth_client_config_id: destinationVerification.oauthClientConfigId,
          destination_channel_id: destinationVerification.destinationChannelId,
          destination_channel_name: destinationVerification.destinationChannelName,
          accessible_channel_ids: destinationVerification.accessibleChannelIds,
          mine_candidate_count: destinationVerification.candidateCount,
        });
        results.push({ id: item.id, ok: false, error: destinationVerification.error });
        continue;
      }

      logUploadEvent("youtube_publish_target_verified", {
        ...logContext,
        oauth_credential_identity: destinationVerification.oauthCredentialIdentity,
        oauth_client_config_id: destinationVerification.oauthClientConfigId,
        destination_channel_id: destinationVerification.destinationChannelId,
        destination_channel_name: destinationVerification.destinationChannelName,
        mine_candidate_count: destinationVerification.candidateCount,
      });

      if (item.videoType === "quote") {
        const err = "Quote post chỉ hỗ trợ cho Facebook";
        await db.update(uploadQueue).set({
          status: "error",
          errorMessage: err,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
        results.push({ id: item.id, ok: false, error: err });
        continue;
      }
      const thumbnailPath = item.videoType === "long"
        ? (item.content.longThumbnailPath ?? undefined)
        : undefined;
      const res = await uploadToYouTube(item.channelId, {
        videoPath: videoPath!,
        title: item.title,
        description: item.description,
        tags: (item.tags as string[]) ?? [],
        privacyStatus: item.privacyStatus as "public" | "private" | "unlisted",
        thumbnailPath,
      });

      if (res.success) {
        await db.update(uploadQueue).set({
          status: "done",
          platformVideoId: res.videoId,
          platformVideoUrl: res.videoUrl,
          errorMessage: null,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));

        // Mirror back to contentGenerations
        await db.update(contentGenerations).set(
          item.videoType === "long"
            ? { longYoutubeUploadStatus: "done", longYoutubeVideoUrl: res.videoUrl }
            : { youtubeUploadStatus: "done", youtubeVideoUrl: res.videoUrl }
        ).where(eq(contentGenerations.id, item.contentId));

        await upsertPublishedVideoFromUploadQueueId(item.id).catch(() => {});

        await cleanupUploadedMediaFiles(item.contentId, item.videoType as PublishQueueType);

        logUploadEvent("publish_succeeded", {
          ...logContext,
          platform_video_id: res.videoId,
          platform_video_url: res.videoUrl,
        });
        results.push({ id: item.id, ok: true, overdueMinutes });

      } else if (isQuotaExceededError(res.error)) {
        // Mark channel quota-exceeded (both in DB and in-run set)
        quotaExceededThisRun.add(item.channelId);
        await db.update(socialChannels).set({
          quotaExceededUntil: nextQuotaResetUtc(),
          updatedAt: new Date(),
        }).where(eq(socialChannels.id, item.channelId));

        const altChannelId = await findAvailableYouTubeChannel(
          item.channelId,
          item.channel.platformChannelId ?? "",
        );

        if (altChannelId) {
          await db.update(uploadQueue).set({
            channelId: altChannelId,
            status: "queued",
            errorMessage: "Chuyển kênh dự phòng (quota kênh cũ hết)",
            updatedAt: new Date(),
          }).where(eq(uploadQueue.id, item.id));

          const altChannel = await db.query.socialChannels.findFirst({ where: eq(socialChannels.id, altChannelId) });
          await sendTelegram(
            `🔄 <b>Auto-rotate quota YouTube</b>\n\n` +
            `📹 ${item.videoType === "short" ? "Short" : "Long"}: <b>${item.title.slice(0, 60)}</b>\n` +
            `📺 ${item.channel.name} → ${altChannel?.name ?? `kênh #${altChannelId}`}\n` +
            `⏱ Sẽ đăng trong lần cron tiếp theo`
          );
          results.push({ id: item.id, ok: false, error: "quota_rotated" });
          continue;
        }

        // No available channel → defer batch to next quota reset
        const resetAt = nextQuotaResetUtc();
        await db.update(uploadQueue).set({
          status: "queued",
          scheduledAt: resetAt,
          errorMessage: res.error,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));

        await sendTelegram(
          `⏸ <b>Hết quota tất cả kênh YouTube</b>\n\n` +
          `📹 ${item.videoType === "short" ? "Short" : "Long"}: <b>${item.title.slice(0, 60)}</b>\n` +
          `🔄 Sẽ tự retry lúc ${resetAt.toISOString().slice(0, 16)} UTC`
        );
        results.push({ id: item.id, ok: false, error: "quota_exceeded_all" });
        break;

      } else if (isTokenRevokedError(res.error)) {
        // Token revoked on one OAuth client → rotate to another credential for
        // the same real YouTube channel when possible.
        const altChannelId = await findAvailableYouTubeChannel(
          item.channelId,
          item.channel.platformChannelId ?? "",
        );
        if (altChannelId) {
          await db.update(uploadQueue).set({
            channelId: altChannelId,
            status: "queued",
            errorMessage: "Chuyển kênh dự phòng (auth kênh cũ lỗi)",
            updatedAt: new Date(),
          }).where(eq(uploadQueue.id, item.id));
          results.push({ id: item.id, ok: false, error: "auth_rotated" });
          continue;
        }

        await db.update(uploadQueue).set({
          status: "error",
          errorMessage: res.error,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
        results.push({ id: item.id, ok: false, error: res.error });

      } else if (isAuthError(res.error)) {
        const altChannelId = await findAvailableYouTubeChannel(
          item.channelId,
          item.channel.platformChannelId ?? "",
        );
        if (altChannelId) {
          await db.update(uploadQueue).set({
            channelId: altChannelId,
            status: "queued",
            errorMessage: "Chuyển kênh dự phòng (auth retry)",
            updatedAt: new Date(),
          }).where(eq(uploadQueue.id, item.id));
          results.push({ id: item.id, ok: false, error: "auth_rotated" });
          continue;
        }

        // No alternative → keep queued and retry next cron.
        await db.update(uploadQueue).set({
          status: "queued",
          errorMessage: res.error,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
        results.push({ id: item.id, ok: false, error: "auth_retry" });

      } else if (isTransientError(res.error)) {
        // Network / 5xx → keep queued, retry next cron
        await db.update(uploadQueue).set({
          status: "queued",
          errorMessage: res.error,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
        results.push({ id: item.id, ok: false, error: "transient_retry" });

      } else {
        // Permanent upload error
        await db.update(uploadQueue).set({
          status: "error",
          errorMessage: res.error,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));

        await sendTelegram(
          `❌ <b>Lỗi đăng YouTube</b>\n\n` +
          `📹 ${item.videoType === "short" ? "Short" : "Long"}: <b>${item.title.slice(0, 60)}</b>\n` +
          `📺 Kênh: ${item.channel.name}\n` +
          `💥 Lỗi: <code>${res.error.slice(0, 200)}</code>`
        );
        logUploadEvent("publish_failed", {
          ...logContext,
          error: res.error,
        });
        results.push({ id: item.id, ok: false, error: res.error });
      }

    } else {
    if (item.videoType === "long") {
      const err = "Facebook hiện chỉ hỗ trợ đăng short/reel hoặc bài ảnh quote trong app này";
      await db.update(uploadQueue).set({
        status: "error",
        errorMessage: err,
        updatedAt: new Date(),
      }).where(eq(uploadQueue.id, item.id));
      await db.update(contentGenerations).set({
        facebookUploadStatus: "error",
        facebookUploadError: err,
      }).where(eq(contentGenerations.id, item.contentId));
      results.push({ id: item.id, ok: false, error: err });
      continue;
    }
    if (!publishSafety.allowLegacyEnvFallback && !item.channel.accessToken) {
      const err = `Channel "${publishSafety.channelKey}" không được phép dùng Facebook env fallback`;
      await db.update(uploadQueue).set({
        status: "error",
        errorMessage: err,
        updatedAt: new Date(),
      }).where(eq(uploadQueue.id, item.id));
      results.push({ id: item.id, ok: false, error: err });
      continue;
    }
    if (item.videoType === "quote") {
      const storedQuoteArtifact = readStoredQuoteArtifactMetadata(item.content.promptVersions);
      const sourceImage = resolveFacebookQuoteImageSource({
        contentId: item.contentId,
        imagePaths: item.content.imagePaths as string[] | null,
      });
      if (!sourceImage.ok) {
        const err = sourceImage.error;
        await db.update(uploadQueue).set({
          status: "error",
          errorMessage: err,
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));
        results.push({ id: item.id, ok: false, error: err });
        continue;
      }

      let tempImagePath: string | null = null;
      try {
        const rendered = await renderFacebookQuoteImage({
          contentId: item.contentId,
          topic: item.content.topic,
          shortContent: item.content.shortContent,
          quoteText: storedQuoteArtifact?.quoteText ?? null,
          imagePath: sourceImage.sourceImagePath,
          channelKey: item.content.channelKey,
          contentProfileKey: item.content.contentProfileKey,
          nicheName: item.content.nicheName,
        });
        tempImagePath = rendered.imagePath;
        const res = await uploadToFacebookPhotoPost(item.channelId, {
          imagePath: rendered.imagePath,
          message: item.description?.trim()
            ? item.description.trim()
            : buildDefaultVideoDescription({
                platform: "facebook",
                contentType: "quote",
                topic: item.content.topic,
                nicheName: item.content.nicheName,
                shortContent: item.content.shortContent,
                longContent: item.content.longContent,
                longYoutubeDescription: item.content.longYoutubeDescription,
                contentProfileKey: item.content.contentProfileKey,
              }),
        });

        if (res.success) {
          await db.update(uploadQueue).set({
            status: "done",
            platformVideoId: res.postId || res.photoId,
            platformVideoUrl: res.postUrl,
            errorMessage: null,
            uploadedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(uploadQueue.id, item.id));

          await upsertPublishedVideoFromUploadQueueId(item.id).catch(() => {});

          await cleanupUploadedMediaFiles(item.contentId, item.videoType as PublishQueueType);

          logUploadEvent("publish_succeeded", {
            ...logContext,
            platform_video_id: res.postId || res.photoId,
            platform_video_url: res.postUrl,
            quote_source_type: storedQuoteArtifact?.quoteSourceType ?? "unknown",
            quote_style: storedQuoteArtifact?.quoteStyle ?? "unknown",
            kinetic: storedQuoteArtifact?.kinetic ?? null,
          });
          results.push({
            id: item.id,
            ok: true,
            overdueMinutes,
            sourceImageMode: sourceImage.sourceImageMode,
            sourceImagePath: sourceImage.sourceImagePath,
          });
        } else {
          if (isFacebookAuthError(res.error)) {
            const deferUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
            await db.update(socialChannels).set({
              needsReconnect: true,
              lastError: res.error.slice(0, 500),
              updatedAt: new Date(),
            }).where(eq(socialChannels.id, item.channelId));
            await db.update(uploadQueue).set({
              status: "queued",
              scheduledAt: deferUntil,
              errorMessage: "Facebook token hết hạn hoặc thiếu quyền. Cần cập nhật token trước khi đăng tiếp.",
              updatedAt: new Date(),
            }).where(eq(uploadQueue.id, item.id));
            await pauseQueuedUploadsForChannel(
              item.channelId,
              "Facebook token hết hạn hoặc thiếu quyền. Queue đang tạm hoãn chờ cập nhật token.",
              deferUntil,
            );
            await sendTelegram(
              `⚠️ <b>Facebook cần cập nhật token</b>\n` +
              `Page: ${item.channel.name}\n` +
              `Lỗi: <code>${res.error.slice(0, 180)}</code>\n` +
              `Các bài Facebook đã được tạm hoãn 6 giờ để tránh spam lỗi.`
            );
            results.push({
              id: item.id,
              ok: false,
              error: "facebook_auth_paused",
              sourceImageMode: sourceImage.sourceImageMode,
              sourceImagePath: sourceImage.sourceImagePath,
            });
          } else if (isFacebookRateLimitError(res.error) || isFacebookTransientError(res.error)) {
            const deferUntil = new Date(Date.now() + 30 * 60 * 1000);
            await db.update(uploadQueue).set({
              status: "queued",
              scheduledAt: deferUntil,
              errorMessage: res.error,
              updatedAt: new Date(),
            }).where(eq(uploadQueue.id, item.id));
            results.push({
              id: item.id,
              ok: false,
              error: "facebook_retry_deferred",
              sourceImageMode: sourceImage.sourceImageMode,
              sourceImagePath: sourceImage.sourceImagePath,
            });
          } else {
            await db.update(uploadQueue).set({
              status: "error",
              errorMessage: res.error,
              updatedAt: new Date(),
            }).where(eq(uploadQueue.id, item.id));
            logUploadEvent("publish_failed", {
              ...logContext,
              error: res.error,
            });
            results.push({
              id: item.id,
              ok: false,
              error: res.error,
              sourceImageMode: sourceImage.sourceImageMode,
              sourceImagePath: sourceImage.sourceImagePath,
            });
          }
        }
      } finally {
        if (tempImagePath) {
          try { fs.unlinkSync(tempImagePath); } catch { /* ignore */ }
        }
      }
      continue;
    }
    const description = item.description?.trim()
      ? item.description.trim()
      : buildDefaultVideoDescription({
          platform: "facebook",
          contentType: "short",
          topic: item.content.topic,
          nicheName: item.content.nicheName,
          shortContent: item.content.shortContent,
          longContent: item.content.longContent,
          longYoutubeDescription: item.content.longYoutubeDescription,
          contentProfileKey: item.content.contentProfileKey,
        });
    const res = await uploadToFacebookReel(item.channelId, {
      videoPath: videoPath!,
      description,
      });

      if (res.success) {
        await db.update(uploadQueue).set({
          status: "done",
          platformVideoId: res.reelId,
          platformVideoUrl: res.reelUrl,
          errorMessage: null,
          uploadedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(uploadQueue.id, item.id));

        await db.update(contentGenerations).set({
          facebookUploadStatus: "done",
          facebookVideoUrl: res.reelUrl,
        }).where(eq(contentGenerations.id, item.contentId));

        await upsertPublishedVideoFromUploadQueueId(item.id).catch(() => {});

        await cleanupUploadedMediaFiles(item.contentId, item.videoType as PublishQueueType);

        logUploadEvent("publish_succeeded", {
          ...logContext,
          platform_video_id: res.reelId,
          platform_video_url: res.reelUrl,
        });
        results.push({ id: item.id, ok: true, overdueMinutes });
      } else {
        if (isFacebookAuthError(res.error)) {
          const deferUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
          await db.update(socialChannels).set({
            needsReconnect: true,
            lastError: res.error.slice(0, 500),
            updatedAt: new Date(),
          }).where(eq(socialChannels.id, item.channelId));
          await db.update(uploadQueue).set({
            status: "queued",
            scheduledAt: deferUntil,
            errorMessage: "Facebook token hết hạn hoặc thiếu quyền. Cần cập nhật token trước khi đăng tiếp.",
            updatedAt: new Date(),
          }).where(eq(uploadQueue.id, item.id));
          await pauseQueuedUploadsForChannel(
            item.channelId,
            "Facebook token hết hạn hoặc thiếu quyền. Queue đang tạm hoãn chờ cập nhật token.",
            deferUntil,
          );
          await db.update(contentGenerations).set({
            facebookUploadStatus: "error",
            facebookUploadError: res.error,
          }).where(eq(contentGenerations.id, item.contentId));
          await sendTelegram(
            `⚠️ <b>Facebook cần cập nhật token</b>\n` +
            `Page: ${item.channel.name}\n` +
            `Lỗi: <code>${res.error.slice(0, 180)}</code>\n` +
            `Các bài Facebook đã được tạm hoãn 6 giờ để tránh spam lỗi.`
          );
          results.push({ id: item.id, ok: false, error: "facebook_auth_paused" });
        } else if (isFacebookRateLimitError(res.error) || isFacebookTransientError(res.error)) {
          const deferUntil = new Date(Date.now() + 30 * 60 * 1000);
          await db.update(uploadQueue).set({
            status: "queued",
            scheduledAt: deferUntil,
            errorMessage: res.error,
            updatedAt: new Date(),
          }).where(eq(uploadQueue.id, item.id));
          results.push({ id: item.id, ok: false, error: "facebook_retry_deferred" });
        } else {
          await db.update(uploadQueue).set({
            status: "error",
            errorMessage: res.error,
            updatedAt: new Date(),
          }).where(eq(uploadQueue.id, item.id));

          await db.update(contentGenerations).set({
            facebookUploadStatus: "error",
            facebookUploadError: res.error,
          }).where(eq(contentGenerations.id, item.contentId));
          logUploadEvent("publish_failed", {
            ...logContext,
            error: res.error,
          });
          results.push({ id: item.id, ok: false, error: res.error });
        }
      }
    }
  }

  // ── Gửi 1 tin tổng kết thành công duy nhất sau khi xử lý xong ──────────
  // Các lỗi quan trọng (auth, quota, permanent) đã gửi Telegram riêng ở trên.
  const successCount = results.filter((r) => r.ok).length;
  if (successCount > 0) {
    const time = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    await sendTelegram(`✅ <b>Đã đăng ${successCount} video</b> lúc ${time}`);
  }

  return { processed: due.length, results };
}

// ─── Media cleanup helpers ─────────────────────────────────────────────────

function removeLocalFile(relPath: string | null | undefined): boolean {
  if (!relPath) return false;
  try {
    const abs = path.join(process.cwd(), relPath);
    if (!fs.existsSync(abs)) return false;
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}

async function cleanupUploadedMediaFiles(
  contentId: string,
  justDoneType: PublishQueueType,
): Promise<void> {
  const content = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
  if (!content) return;

  const shortFiles = [
    content.audioPath,
    content.videoPath,
    ...(((content.imagePaths as string[] | null) ?? [])),
  ];
  const longFiles = [
    content.longAudioPath,
    content.longVideoPath,
    content.longThumbnailPath,
    ...(((content.longImagePaths as string[] | null) ?? [])),
  ];

  const queueRows = await db
    .select({ platform: uploadQueue.platform, status: uploadQueue.status })
    .from(uploadQueue)
    .where(and(
      eq(uploadQueue.contentId, contentId),
      justDoneType === "quote"
        ? inArray(uploadQueue.videoType, ["short", "quote"])
        : justDoneType === "short"
          ? inArray(uploadQueue.videoType, ["short", "quote"])
          : eq(uploadQueue.videoType, "long"),
      inArray(uploadQueue.status, ["queued", "uploading", "done", "error", "cancelled"]),
    ));

  const hasBlocking = queueRows.some((row) => ["queued", "uploading", "error"].includes(row.status));
  const hasDone = queueRows.some((row) => row.status === "done");
  if (hasBlocking || !hasDone) {
    return;
  }

  const files = justDoneType === "long" ? longFiles : shortFiles;
  for (const f of files) removeLocalFile(f);

  const needsShort = ["both", "short"].includes(content.contentMode);
  const needsLong  = ["both", "long"].includes(content.contentMode);
  const [shortQueueRows, longQueueRows] = await Promise.all([
    db.select({ status: uploadQueue.status })
      .from(uploadQueue)
      .where(and(eq(uploadQueue.contentId, contentId), inArray(uploadQueue.videoType, ["short", "quote"]))),
    db.select({ status: uploadQueue.status })
      .from(uploadQueue)
      .where(and(eq(uploadQueue.contentId, contentId), eq(uploadQueue.videoType, "long"))),
  ]);
  const shortDone = !needsShort || (
    shortQueueRows.some((row) => row.status === "done") &&
    !shortQueueRows.some((row) => ["queued", "uploading", "error"].includes(row.status))
  );
  const longDone = !needsLong || (
    longQueueRows.some((row) => row.status === "done") &&
    !longQueueRows.some((row) => ["queued", "uploading", "error"].includes(row.status))
  );

  if (shortDone && longDone) {
    await db.update(contentGenerations)
      .set({
        completedAt: new Date(),
        mediaScheduledCleanAt: new Date(),
        mediaCleanedAt: new Date(),
      })
      .where(eq(contentGenerations.id, contentId));
  }
}

// Defers every queued row for this channel due at/before deferUntil onto a distinct,
// lane-aware canonical slot (short/reel -> HH:00, quote/photo sidecar -> HH:05), instead of
// bulk-writing one shared timestamp to every matching row. Rows are processed in their
// current scheduledAt order so relative ordering is preserved. If no safe future slot can
// be found for a row (14-day horizon exhausted), that row is left untouched rather than
// guessing — callers should treat a return value lower than the matched row count as a
// signal to investigate.
async function pauseQueuedUploadsForChannel(
  channelId: number,
  message: string,
  deferUntil: Date,
): Promise<number> {
  const channel = await db.query.socialChannels.findFirst({
    where: eq(socialChannels.id, channelId),
  });
  if (!channel) return 0;

  const affectedRows = await db
    .select({
      id: uploadQueue.id,
      videoType: uploadQueue.videoType,
      platform: uploadQueue.platform,
      scheduledAt: uploadQueue.scheduledAt,
    })
    .from(uploadQueue)
    .where(and(
      eq(uploadQueue.channelId, channelId),
      eq(uploadQueue.status, "queued"),
      lte(uploadQueue.scheduledAt, deferUntil),
    ))
    .orderBy(asc(uploadQueue.scheduledAt));

  if (affectedRows.length === 0) return 0;

  const takenByLane = new Map<string, number[]>();
  let updated = 0;

  for (const row of affectedRows) {
    let taken = takenByLane.get(row.videoType);
    if (!taken) {
      const existing = await getTakenUploadSlotsForDestination({
        channelId,
        platform: row.platform,
        platformChannelId: channel.platformChannelId,
        videoType: row.videoType,
        since: new Date(),
        excludeQueueIds: [row.id],
      });
      taken = existing.map((slot) => slot.scheduledAt.getTime());
      takenByLane.set(row.videoType, taken);
    }

    // Lane convention: quote/photo sidecar rides on the HH:05 offset; short/reel stays on HH:00.
    const slotOffsetMinutes = row.videoType === "quote" ? 5 : 0;
    const nextSlot = findNextAvailablePublishSlot({
      windowStart: "06:00",
      windowEnd: "22:00",
      intervalMin: 60,
      taken,
      notBefore: deferUntil,
      slotOffsetMinutes,
    });
    if (!nextSlot) continue;

    taken.push(nextSlot.getTime());

    await db.update(uploadQueue).set({
      scheduledAt: nextSlot,
      errorMessage: message.slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(uploadQueue.id, row.id));
    updated += 1;
  }

  return updated;
}

export async function cleanupMediaFilesAction(): Promise<{ cleaned: number }> {
  const due = await db.select().from(contentGenerations).where(
    and(
      lte(contentGenerations.mediaScheduledCleanAt, new Date()),
      isNull(contentGenerations.mediaCleanedAt),
    )
  );

  let cleaned = 0;
  for (const c of due) {
    const files = [
      c.audioPath,
      c.longAudioPath,
      c.videoPath,
      c.longVideoPath,
      ...((c.imagePaths as string[]) ?? []),
      ...((c.longImagePaths as string[]) ?? []),
      c.longThumbnailPath,
    ].filter(Boolean) as string[];

    for (const f of files) {
      removeLocalFile(f);
    }

    await db.update(contentGenerations)
      .set({ mediaCleanedAt: new Date() })
      .where(eq(contentGenerations.id, c.id));

    cleaned++;
  }
  return { cleaned };
}

export async function backfillLegacyUploadsAction(): Promise<{ created: number }> {
  const channel = await db.query.socialChannels.findFirst({
    where: (t, { and: a, eq: e }) => a(e(t.platform, "youtube"), e(t.isActive, true)),
  });
  if (!channel) return { created: 0 };

  let created = 0;

  // Legacy short uploads
  const legacyShorts = await db.select().from(contentGenerations).where(
    and(
      isNotNull(contentGenerations.youtubeVideoUrl),
      notExists(
        db.select({ x: uploadQueue.id }).from(uploadQueue).where(
          and(
            eq(uploadQueue.contentId, contentGenerations.id),
            eq(uploadQueue.videoType, "short"),
            eq(uploadQueue.status, "done"),
          )
        )
      ),
    )
  );

  for (const c of legacyShorts) {
    const title = c.topic
      ? `${c.topic.slice(0, 93)} #Shorts`.slice(0, 100)
      : "#Shorts";
    await db.insert(uploadQueue).values({
      contentId: c.id,
      channelId: channel.id,
      platform: "youtube",
      videoType: "short",
      title,
      description: (c.shortContent ?? "").slice(0, 4800),
      tags: [],
      privacyStatus: "public",
      scheduledAt: c.createdAt,
      status: "done",
      platformVideoUrl: c.youtubeVideoUrl,
      uploadedAt: c.createdAt,
    });
    created++;

    if (!c.mediaScheduledCleanAt) {
      const cleanAt = new Date(new Date(c.createdAt).getTime() + 3 * 24 * 60 * 60 * 1000);
      await db.update(contentGenerations)
        .set({ mediaScheduledCleanAt: cleanAt })
        .where(eq(contentGenerations.id, c.id));
    }
  }

  // Legacy long uploads
  const legacyLongs = await db.select().from(contentGenerations).where(
    and(
      isNotNull(contentGenerations.longYoutubeVideoUrl),
      notExists(
        db.select({ x: uploadQueue.id }).from(uploadQueue).where(
          and(
            eq(uploadQueue.contentId, contentGenerations.id),
            eq(uploadQueue.videoType, "long"),
            eq(uploadQueue.status, "done"),
          )
        )
      ),
    )
  );

  for (const c of legacyLongs) {
    await db.insert(uploadQueue).values({
      contentId: c.id,
      channelId: channel.id,
      platform: "youtube",
      videoType: "long",
      title: (c.topic ?? "Video").slice(0, 100),
      description: (c.longContent ?? "").slice(0, 4800),
      tags: [],
      privacyStatus: "public",
      scheduledAt: c.createdAt,
      status: "done",
      platformVideoUrl: c.longYoutubeVideoUrl,
      uploadedAt: c.createdAt,
    });
    created++;

    if (!c.mediaScheduledCleanAt) {
      const cleanAt = new Date(new Date(c.createdAt).getTime() + 3 * 24 * 60 * 60 * 1000);
      await db.update(contentGenerations)
        .set({ mediaScheduledCleanAt: cleanAt })
        .where(eq(contentGenerations.id, c.id));
    }
  }

  return { created };
}
