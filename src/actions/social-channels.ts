"use server";

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { socialChannels, uploadQueue, contentGenerations, appConfig, type SocialChannel } from "@/lib/db/schema";
import { eq, desc, and, lte, notExists, inArray, isNull, isNotNull, gte, count } from "drizzle-orm";
import { uploadToYouTube, isQuotaExceededError, isAuthError, isTokenRevokedError, isTransientError, nextQuotaResetUtc, pacificMidnightUtc } from "@/lib/social/youtube-api";
import {
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
import { buildDefaultVideoDescription, buildDefaultVideoTitle, buildFacebookQuoteText, buildYouTubeVideoMetadata } from "@/lib/social/youtube-metadata";
import { sendTelegram } from "@/lib/social/telegram";
import { upsertPublishedVideoFromUploadQueueId } from "@/actions/publishing-analytics";

type PublishQueueType = "short" | "long" | "quote";

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

// ─── Channel Management ────────────────────────────────────────────────────

export async function getChannelsAction(platform?: string): Promise<SocialChannel[]> {
  if (!platform || platform === "facebook") {
    await refreshFacebookEnvHealth().catch(() => null);
  }
  const rows = await db.query.socialChannels.findMany({
    where: platform ? (t, { eq: e }) => e(t.platform, platform) : undefined,
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
  platformAccountId: number | null;
  platformAccountName: string | null;
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
        columns: { name: true, platformAccountId: true },
        with: {
          platformAccount: {
            columns: { displayName: true },
          },
        },
      },
      content: { columns: { topic: true, nicheName: true } },
    },
    orderBy: (t, { asc, desc: d }) => [
      asc(t.scheduledAt),
      d(t.createdAt),
    ],
    limit: filters?.limit ?? 100,
  });

  return rows.map(r => ({
    id: r.id,
    contentId: r.contentId,
    channelId: r.channelId,
    channelName: r.channel.name,
    platformAccountId: r.channel.platformAccountId,
    platformAccountName: r.channel.platformAccount?.displayName ?? null,
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
  }));
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

export async function retryUploadAction(id: string): Promise<{ success: boolean }> {
  await db.update(uploadQueue)
    .set({ status: "queued", errorMessage: null, updatedAt: new Date() })
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

function findNextBulkSlot(
  windowStart: string,
  windowEnd: string,
  intervalMin: number,
  taken: number[],
  notBefore?: Date,
): Date | null {
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const [sh, sm] = windowStart.split(":").map(Number);
  const [eh, em] = windowEnd.split(":").map(Number);
  const windowEndMin = eh * 60 + em;
  const now = notBefore && notBefore.getTime() > Date.now()
    ? new Date(notBefore.getTime() - 1000)
    : new Date();
  const nowVn = new Date(now.getTime() + VN_OFFSET_MS);

  for (let day = 0; day < 14; day++) {
    const baseVn = new Date(Date.UTC(
      nowVn.getUTCFullYear(),
      nowVn.getUTCMonth(),
      nowVn.getUTCDate() + day,
      0,
      0,
      0,
      0,
    ));

    let startMin = sh * 60 + sm;
    if (day === 0) {
      const nowMin = nowVn.getUTCHours() * 60 + nowVn.getUTCMinutes();
      if (nowMin >= startMin) {
        startMin = Math.ceil((nowMin + 1) / intervalMin) * intervalMin;
      }
    }

    for (let slotMin = startMin; slotMin <= windowEndMin; slotMin += intervalMin) {
      const candidate = new Date(Date.UTC(
        baseVn.getUTCFullYear(),
        baseVn.getUTCMonth(),
        baseVn.getUTCDate(),
        Math.floor(slotMin / 60) - 7,
        slotMin % 60,
        0,
        0,
      ));
      if (candidate.getTime() <= now.getTime()) continue;
      const half = (intervalMin / 2) * 60_000;
      const conflict = taken.some(t => Math.abs(t - candidate.getTime()) < half);
      if (!conflict) return candidate;
    }
  }
  return null;
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
  const existing = await db
    .select({ scheduledAt: uploadQueue.scheduledAt })
    .from(uploadQueue)
    .innerJoin(socialChannels, eq(uploadQueue.channelId, socialChannels.id))
    .where(and(
      destinationWhere,
      inArray(uploadQueue.status, ["queued", "uploading"]),
    ));
  const taken = existing.map(r => new Date(r.scheduledAt).getTime());
  const existingForDestination = await db
    .select({ contentId: uploadQueue.contentId })
    .from(uploadQueue)
    .innerJoin(socialChannels, eq(uploadQueue.channelId, socialChannels.id))
    .where(and(
      destinationWhere,
      eq(uploadQueue.videoType, input.videoType),
      inArray(uploadQueue.status, ["queued", "uploading", "done"]),
      input.contentIds?.length ? inArray(uploadQueue.contentId, input.contentIds) : undefined,
    ));
  const existingContentIds = new Set(existingForDestination.map((row) => row.contentId));

  // Fetch content details for title/description
  const contentIds = targets.map(t => t.id);
  const contents = await db.query.contentGenerations.findMany({
    where: (t, { inArray: ia }) => ia(t.id, contentIds),
    columns: { id: true, topic: true, shortContent: true, longContent: true, longYoutubeDescription: true },
  });
  const contentMap = new Map(contents.map(c => [c.id, c]));

  let scheduled = 0;
  let skipped = 0;

  for (const target of targets) {
    if (existingContentIds.has(target.id)) {
      skipped++;
      continue;
    }
    const slot = findNextBulkSlot(input.windowStart, input.windowEnd, input.intervalMin, taken);
    if (!slot) { skipped++; continue; }

    const content = contentMap.get(target.id);
    const topic = content?.topic ?? target.topic;
    const metadata = input.videoType === "quote"
      ? {
          title: buildFacebookQuoteText({
            topic,
            shortContent: content?.shortContent,
          }).slice(0, 100),
          description: buildDefaultVideoDescription({
            platform: "facebook",
            contentType: "quote",
            topic,
            nicheName: target.nicheName,
            shortContent: content?.shortContent,
            longContent: content?.longContent,
            longYoutubeDescription: content?.longYoutubeDescription,
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
        })
      : {
          title: buildDefaultVideoTitle({
            platform: "facebook",
            contentType: input.videoType,
            topic,
          }),
          description: buildDefaultVideoDescription({
            platform: "facebook",
            contentType: input.videoType,
            topic,
            nicheName: target.nicheName,
            shortContent: content?.shortContent,
            longContent: content?.longContent,
            longYoutubeDescription: content?.longYoutubeDescription,
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
      const slot = findNextBulkSlot(
        cfg.windowStart,
        cfg.windowEnd,
        intervalMin,
        taken,
        notBefore,
      );
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
  const quoteFallback = { enabled: false, channelId: 0, windowStart: "08:00", windowEnd: "23:00", intervalMin: 60, privacyStatus: "public" as const };
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

export async function getAutoScheduleSettingsAction(): Promise<AutoScheduleSettings> {
  const row = await db.query.appConfig.findFirst({ where: eq(appConfig.key, "auto_schedule_settings") });
  if (!row) return DEFAULT_AUTO_SCHEDULE;
  try { return normalizeAutoScheduleSettings({ ...DEFAULT_AUTO_SCHEDULE, ...JSON.parse(row.value) } as AutoScheduleSettings); }
  catch { return DEFAULT_AUTO_SCHEDULE; }
}

export async function saveAutoScheduleSettingsAction(settings: AutoScheduleSettings): Promise<{ success: boolean }> {
  const normalized = normalizeAutoScheduleSettings(settings);
  await db.insert(appConfig)
    .values({ key: "auto_schedule_settings", value: JSON.stringify(normalized), updatedAt: new Date() })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: JSON.stringify(normalized), updatedAt: new Date() } });
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
      windowStart: "08:00",
      windowEnd: "23:00",
      intervalMin: 60,
      privacyStatus: "public",
    };
  }
  if (videoType === "long") return settings.long;
  return settings.short;
}

export async function autoScheduleVideoAction(
  contentId: string,
  videoType: PublishQueueType,
): Promise<void> {
  const settings = await getAutoScheduleSettingsAction();
  const destinations = getDestinationSettings(settings, videoType);
  for (const cfg of destinations) {
    if (!cfg.enabled || !cfg.channelId) continue;

    let channelId = cfg.channelId;
    const configuredChannel = await db.query.socialChannels.findFirst({
      where: eq(socialChannels.id, cfg.channelId),
    });
    if (!configuredChannel) continue;
    if (configuredChannel.platform === "facebook" && videoType === "long") continue;
    if (configuredChannel.platform === "youtube" && videoType === "quote") continue;
    const isExceeded = !!(configuredChannel.quotaExceededUntil && configuredChannel.quotaExceededUntil > new Date());
    if (configuredChannel.platform === "youtube" && isExceeded && configuredChannel.platformChannelId) {
      const altId = await findAvailableYouTubeChannel(cfg.channelId, configuredChannel.platformChannelId);
      if (altId) channelId = altId;
    }

    await bulkScheduleAction({
      videoType,
      channelId,
      windowStart: cfg.windowStart,
      windowEnd: cfg.windowEnd,
      intervalMin: cfg.intervalMin,
      privacyStatus: cfg.privacyStatus,
      contentIds: [contentId],
    });
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

export async function processUploadQueueAction(platformFilter?: string): Promise<{
  processed: number;
  results: { id: string; ok: boolean; error?: string }[];
}> {
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

  const dueFacebookItems = dueCandidates.filter((item) => item.platform === "facebook");
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
      for (const item of dueFacebookItems) {
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
  const due = [];
  const platformsThisRun = new Set<string>();
  for (const item of dueCandidates) {
    if (facebookPreflightBlocked && item.platform === "facebook") continue;
    // One upload per platform per cron run. OAuth-client rotation still works
    // because alternate credentials keep platform="youtube".
    if (platformsThisRun.has(item.platform)) continue;
    platformsThisRun.add(item.platform);
    due.push(item);
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];
  const autoScheduleSettings = await getAutoScheduleSettingsAction();

  // Channels confirmed quota-exceeded in this cron run — skip API calls for them
  const quotaExceededThisRun = new Set<number>();

  for (const item of due) {
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
      ? new Date(lastUpload.scheduledAt)
      : lastUpload?.uploadedAt
        ? new Date(lastUpload.uploadedAt)
        : null;
    const nextAllowedAt = lastAnchor
      ? new Date(lastAnchor.getTime() + intervalMin * 60_000)
      : null;
    if (nextAllowedAt && nextAllowedAt > new Date()) {
      const deferredSlot = findNextBulkSlot(
        scheduleConfig.windowStart,
        scheduleConfig.windowEnd,
        intervalMin,
        [],
        nextAllowedAt,
      ) ?? nextAllowedAt;
      await db.update(uploadQueue).set({
        scheduledAt: deferredSlot,
        errorMessage: `Dời lịch để giữ khoảng cách ${intervalMin} phút`,
        updatedAt: new Date(),
      }).where(eq(uploadQueue.id, item.id));
      results.push({ id: item.id, ok: false, error: "upload_interval_deferred" });
      continue;
    }

    // ── Atomically claim: only proceed if we successfully move queued→uploading ─
    // This prevents two concurrent processUploadQueueAction calls from
    // uploading the same item (race between SELECT and UPDATE).
    const [claimed] = await db.update(uploadQueue)
      .set({ status: "uploading", updatedAt: new Date() })
      .where(and(eq(uploadQueue.id, item.id), eq(uploadQueue.status, "queued")))
      .returning({ id: uploadQueue.id });
    if (!claimed) continue; // another caller already claimed it

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

    if (item.platform === "youtube") {
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

        results.push({ id: item.id, ok: true });

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
    if (item.videoType === "quote") {
      const sourceImage = ((item.content.imagePaths as string[] | null) ?? [])[0];
      if (!sourceImage) {
        const err = "Content chưa có ảnh short để dựng quote post";
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
          imagePath: sourceImage,
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

          results.push({ id: item.id, ok: true });
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
            results.push({ id: item.id, ok: false, error: res.error });
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

        results.push({ id: item.id, ok: true });
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

async function pauseQueuedUploadsForChannel(
  channelId: number,
  message: string,
  deferUntil: Date,
): Promise<number> {
  const result = await db.update(uploadQueue)
    .set({
      scheduledAt: deferUntil,
      errorMessage: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(and(
      eq(uploadQueue.channelId, channelId),
      eq(uploadQueue.status, "queued"),
      lte(uploadQueue.scheduledAt, deferUntil),
    ))
    .returning({ id: uploadQueue.id });
  return result.length;
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
