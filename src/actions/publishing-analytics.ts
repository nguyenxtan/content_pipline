"use server";

import { db } from "@/lib/db";
import {
  appConfig,
  contentGenerations,
  platformAccounts,
  publishedVideos,
  socialChannels,
  uploadQueue,
  videoMetricSnapshots,
} from "@/lib/db/schema";
import {
  and,
  eq,
  inArray,
  isNotNull,
} from "drizzle-orm";
import {
  fetchYouTubeAnalyticsMetrics,
  isAuthError,
  isQuotaExceededError,
  isTokenRevokedError,
  isTransientError,
  listYouTubeVideos,
  nextQuotaResetUtc,
} from "@/lib/social/youtube-api";
import { sendTelegram } from "@/lib/social/telegram";
import { getContentProfile } from "@/lib/config/content-profiles";
import {
  STRATEGIC_FAMILY_DISPLAY,
  type StrategicTopicFamilyId,
  inferStrategicTopicFamily,
  normalizeTopicFamily,
  NEEDS_REVIEW_FAMILY,
} from "@/lib/config/topic-family-registry";
import { PHAT_PHAP_SPRINT } from "@/lib/config/sprint-config";
import { HOOK_TYPE_DISPLAY, type HookType } from "@/lib/hook-engine";

const SUPPORTED_PLATFORMS = ["youtube", "facebook", "tiktok"] as const;
type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];
const ANALYTICS_REPORT_CONFIG_KEY = "publishing_analytics_report_config_v1";
const ANALYTICS_REPORT_PERIODS = ["7d", "14d", "30d", "monthly"] as const;
export type AnalyticsReportPeriod = (typeof ANALYTICS_REPORT_PERIODS)[number];

type UploadQueueDoneRow = {
  id: string;
  contentId: string;
  channelId: number;
  platform: string;
  videoType: string;
  title: string;
  description: string;
  tags: unknown;
  privacyStatus: string;
  scheduledAt: Date;
  platformVideoId: string | null;
  platformVideoUrl: string | null;
  uploadedAt: Date | null;
  channel: {
    platformAccountId: number | null;
  };
};
type PublishedVideoRow = Awaited<ReturnType<typeof db.query.publishedVideos.findMany>>[number];

export type AnalyticsPlatformSummary = {
  platform: SupportedPlatform;
  label: string;
  totalChannels: number;
  connectedCredentials: number;
  totalVideos: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  staleVideos: number;
  lastSyncedAt: Date | null;
};

export type AnalyticsChannelSummary = {
  id: number;
  displayName: string;
  handle: string | null;
  thumbnailUrl: string | null;
  connectedCredentials: number;
  activeCredentials: number;
  totalVideos: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  latestPublishedAt: Date | null;
  lastSyncedAt: Date | null;
};

export type AnalyticsVideoRow = {
  id: string;
  platformAccountId: number;
  channelName: string;
  channelHandle: string | null;
  platformVideoId: string;
  platformVideoUrl: string | null;
  title: string;
  videoType: string;
  privacyStatus: string | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  lastFetchedAt: Date | null;
  topic: string | null;
  nicheName: string | null;
};

export type PublishingAnalyticsPayload = {
  selectedPlatform: SupportedPlatform;
  selectedPlatformAccountId: number | null;
  platforms: AnalyticsPlatformSummary[];
  channels: AnalyticsChannelSummary[];
  videos: AnalyticsVideoRow[];
  totals: {
    totalVideos: number;
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    staleVideos: number;
    lastSyncedAt: Date | null;
  };
};

export type TopicPerformanceRow = {
  topic: string;
  niche: string | null;
  contentProfileKey: string | null;
  videoCount: number;
  avgViews: number;
  avgViewDurationSec: number | null;
  avgRetentionPct: number | null;
  lastPublishedAt: Date | null;
};

export type TopicPerformanceSummary = {
  highPerformers: TopicPerformanceRow[];
  mediumPerformers: TopicPerformanceRow[];
  lowPerformers: TopicPerformanceRow[];
  topKeywords: string[];
  weakKeywords: string[];
  observations: string[];
};

export type HookPerformanceRow = {
  hookText: string;
  hookPattern: string | null;
  hookType: string | null;
  topic: string | null;
  niche: string | null;
  videoCount: number;
  avgViews: number;
  avgViewDurationSec: number | null;
  avgRetentionPct: number | null;
  lastPublishedAt: Date | null;
  lowConfidence: boolean;
};

export type HookTypePerformanceRow = {
  hookType: string;
  displayName: string;
  videoCount: number;
  avgViews: number;
  avgViewDurationSec: number | null;
  avgRetentionPct: number | null;
  lowConfidence: boolean;
};

export type TopicCoverageClusterRow = {
  clusterName: string;
  videoCount: number;
  avgViews: number;
  avgRetentionPct: number | null;
  avgWatchDurationSec: number | null;
  topicCount: number;
  topics: string[];
};

export type StrategicFamilyWindow = {
  total: number;
  last3d: number;
  last7d: number;
  last30d: number;
};

export type StrategicFamilyCoverageRow = {
  familyId: string;
  displayName: string;
  sprintLabel: "Focus" | "Secondary" | "Explore" | "Low priority" | "Needs review" | null;
  sampleDepth: StrategicFamilyWindow;
  videoCount: StrategicFamilyWindow;
  quoteCount: StrategicFamilyWindow;
  sampleDepthStatus: string;
  topics: string[];
};

export type SyncAnalyticsResult = {
  platform: SupportedPlatform;
  accountsTouched: number;
  videosRequested: number;
  videosUpdated: number;
  errors: string[];
};

export type AnalyticsReportConfig = {
  enabled: boolean;
  platform: SupportedPlatform;
  period: AnalyticsReportPeriod;
  platformAccountId: number | null;
  sendHour: number;
  sendMinute: number;
  lastSentMarker: string | null;
};

export type AnalyticsReportResult = {
  title: string;
  period: AnalyticsReportPeriod;
  marker: string;
  lines: string[];
  text: string;
};

function platformLabel(platform: SupportedPlatform): string {
  switch (platform) {
    case "youtube":
      return "YouTube";
    case "facebook":
      return "Facebook";
    case "tiktok":
      return "TikTok";
  }
}

function toCount(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toRetentionPctDbValue(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  // DB column is numeric(5,2). Very short videos can report extreme replay
  // percentages, so cap rather than failing the whole analytics sync.
  return String(Math.min(999.99, Math.max(0, value)));
}

const TOPIC_STOPWORDS = new Set([
  "bi",
  "biết",
  "bí",
  "bình",
  "bí ẩn",
  "bước",
  "cách",
  "cảm",
  "chiêm",
  "chuyện",
  "con",
  "con đường",
  "của",
  "cuộc",
  "đau",
  "đến",
  "điều",
  "đời",
  "định",
  "đó",
  "được",
  "giải",
  "gì",
  "giữa",
  "giúp",
  "hành",
  "học",
  "hiểu",
  "hơn",
  "hướng",
  "khám",
  "khỏi",
  "khi",
  "không",
  "là",
  "lời",
  "lực",
  "mỗi",
  "một",
  "ngày",
  "nghệ",
  "người",
  "nhẹ",
  "những",
  "phá",
  "phần",
  "qua",
  "quyết",
  "ra",
  "sự",
  "sống",
  "sức",
  "sức mạnh",
  "tâm",
  "theo",
  "thế",
  "thức",
  "thuật",
  "trải",
  "trong",
  "từ",
  "và",
  "về",
  "với",
]);

const EMOTIONAL_ANGLE_RULES = getContentProfile("buddhism").analyticsEmotionalAngleRules;
const TOPIC_CLUSTER_RULES = getContentProfile("buddhism").analyticsTopicClusterRules;

function parseIsoDurationToSeconds(input?: string | null): number | null {
  if (!input) return null;
  const match = input.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function getDefaultAnalyticsReportConfig(): AnalyticsReportConfig {
  return {
    enabled: false,
    platform: "youtube",
    period: "7d",
    platformAccountId: null,
    sendHour: 8,
    sendMinute: 0,
    lastSentMarker: null,
  };
}

function normalizeAnalyticsReportConfig(
  input: Partial<AnalyticsReportConfig> | null | undefined
): AnalyticsReportConfig {
  const base = getDefaultAnalyticsReportConfig();
  return {
    enabled: Boolean(input?.enabled),
    platform: SUPPORTED_PLATFORMS.includes((input?.platform ?? base.platform) as SupportedPlatform)
      ? (input?.platform ?? base.platform) as SupportedPlatform
      : base.platform,
    period: ANALYTICS_REPORT_PERIODS.includes((input?.period ?? base.period) as AnalyticsReportPeriod)
      ? (input?.period ?? base.period) as AnalyticsReportPeriod
      : base.period,
    platformAccountId:
      input?.platformAccountId == null || Number.isNaN(Number(input.platformAccountId))
        ? null
        : Number(input.platformAccountId),
    sendHour: Math.min(23, Math.max(0, Number(input?.sendHour ?? base.sendHour))),
    sendMinute: Math.min(59, Math.max(0, Number(input?.sendMinute ?? base.sendMinute))),
    lastSentMarker: input?.lastSentMarker ?? null,
  };
}

function getLocalDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function percentileRank(values: number[], target: number | null): number | null {
  if (target == null || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const lessOrEqual = sorted.filter((value) => value <= target).length;
  return Number((lessOrEqual / sorted.length).toFixed(4));
}

function averageNumbers(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function normalizeTopicWords(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !TOPIC_STOPWORDS.has(word));
}

function collectKeywordCounts(rows: TopicPerformanceRow[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const word of normalizeTopicWords(row.topic)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], "vi");
  });
}

function detectRecurringAngles(rows: TopicPerformanceRow[]): string[] {
  const labels: string[] = [];
  const topicBlob = rows.map((row) => row.topic.toLowerCase()).join(" || ");
  const rules = rows.length > 0
    ? getContentProfile(rows[0].contentProfileKey).analyticsEmotionalAngleRules
    : EMOTIONAL_ANGLE_RULES;
  for (const rule of rules) {
    if (rule.keywords.some((keyword) => topicBlob.includes(keyword))) {
      labels.push(rule.label);
    }
  }
  return labels;
}

function resolveTopicClusterName(topic: string, contentProfileKey?: string | null): string {
  const normalized = topic.toLowerCase();
  const rules = getContentProfile(contentProfileKey).analyticsTopicClusterRules;
  for (const rule of rules) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.label;
    }
  }
  return "Khác / chưa phân cụm";
}

function getReportWindow(period: AnalyticsReportPeriod, now: Date) {
  const local = getLocalDateParts(now);
  const end = new Date(now);
  if (period === "monthly") {
    const startMonth = local.month === 1 ? 12 : local.month - 1;
    const startYear = local.month === 1 ? local.year - 1 : local.year;
    const start = new Date(Date.UTC(startYear, startMonth - 1, 1, 0, 0, 0));
    const nextMonth = new Date(Date.UTC(local.year, local.month - 1, 1, 0, 0, 0));
    const marker = `${startYear}-${String(startMonth).padStart(2, "0")}`;
    return {
      start,
      end: nextMonth,
      marker,
      title: `Báo cáo tháng ${marker}`,
      shouldSendTodayOnlyOnDay: 1,
    };
  }

  const days = period === "7d" ? 7 : period === "14d" ? 14 : 30;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    start,
    end,
    marker: `${period}:${local.isoDate}`,
    title: `Báo cáo ${days} ngày`,
    shouldSendTodayOnlyOnDay: null,
  };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function shouldSyncVideo(video: {
  publishedAt: Date | null;
  latestFetchedAt: Date | null;
}): boolean {
  if (!video.latestFetchedAt) return true;

  const now = Date.now();
  const fetchedAgeHours = (now - new Date(video.latestFetchedAt).getTime()) / 3_600_000;
  const publishedAgeHours = video.publishedAt
    ? (now - new Date(video.publishedAt).getTime()) / 3_600_000
    : Infinity;

  if (publishedAgeHours <= 48) return fetchedAgeHours >= 6;
  if (publishedAgeHours <= 30 * 24) return fetchedAgeHours >= 24;
  return fetchedAgeHours >= 72;
}

type FacebookReelMetricItem = {
  id: string;
  description?: string;
  created_time?: string;
  permalink_url?: string;
  length?: number;
  views?: number | string;
};

async function ensurePlatformAccountsLinked(): Promise<void> {
  const channels = await db.query.socialChannels.findMany({
    where: isNotNull(socialChannels.platformChannelId),
    orderBy: (t, { asc: orderAsc }) => [orderAsc(t.platform), orderAsc(t.id)],
  });
  if (channels.length === 0) return;

  const existingAccounts = await db.query.platformAccounts.findMany();
  const accountMap = new Map(
    existingAccounts.map((account) => [
      `${account.platform}::${account.platformAccountId}`,
      account,
    ])
  );

  for (const channel of channels) {
    const platformChannelId = channel.platformChannelId?.trim();
    if (!platformChannelId) continue;

    const key = `${channel.platform}::${platformChannelId}`;
    let account = accountMap.get(key);

    if (!account) {
      const [created] = await db
        .insert(platformAccounts)
        .values({
          platform: channel.platform,
          platformAccountId: platformChannelId,
          displayName: channel.name,
          handle: channel.platformHandle,
          thumbnailUrl: channel.thumbnailUrl,
          isActive: channel.isActive,
          updatedAt: new Date(),
        })
        .returning();
      account = created;
      accountMap.set(key, created);
    } else {
      const needsAccountUpdate =
        account.displayName !== channel.name ||
        account.handle !== channel.platformHandle ||
        account.thumbnailUrl !== channel.thumbnailUrl ||
        account.isActive !== channel.isActive;

      if (needsAccountUpdate) {
        const [updated] = await db
          .update(platformAccounts)
          .set({
            displayName: channel.name,
            handle: channel.platformHandle,
            thumbnailUrl: channel.thumbnailUrl,
            isActive: channel.isActive,
            updatedAt: new Date(),
          })
          .where(eq(platformAccounts.id, account.id))
          .returning();
        account = updated;
        accountMap.set(key, updated);
      }
    }

    if (channel.platformAccountId !== account.id) {
      await db
        .update(socialChannels)
        .set({
          platformAccountId: account.id,
          updatedAt: new Date(),
        })
        .where(eq(socialChannels.id, channel.id));
    }
  }
}

function mapQueueRowToPublishedVideo(row: UploadQueueDoneRow) {
  const accountId = row.channel.platformAccountId;
  if (!accountId || !row.platformVideoId) return null;

  return {
    uploadQueueId: row.id,
    contentId: row.contentId,
    platform: row.platform,
    platformAccountId: accountId,
    credentialChannelId: row.channelId,
    platformVideoId: row.platformVideoId,
    platformVideoUrl: row.platformVideoUrl,
    videoType: row.videoType,
    title: row.title,
    description: row.description,
    tags: (row.tags as string[]) ?? [],
    privacyStatus: row.privacyStatus,
    publishedAt: row.uploadedAt ?? row.scheduledAt,
    updatedAt: new Date(),
  };
}

export async function upsertPublishedVideoFromUploadQueueId(
  uploadQueueId: string,
): Promise<{ success: boolean; skipped?: boolean }> {
  await ensurePlatformAccountsLinked();

  const row = await db.query.uploadQueue.findFirst({
    where: eq(uploadQueue.id, uploadQueueId),
    with: {
      channel: true,
      content: true,
    },
  });
  if (!row || row.status !== "done" || !row.platformVideoId) {
    return { success: false, skipped: true };
  }

  const mapped = mapQueueRowToPublishedVideo(row);
  if (!mapped) return { success: false, skipped: true };

  await db
    .insert(publishedVideos)
    .values(mapped)
    .onConflictDoUpdate({
      target: [publishedVideos.platform, publishedVideos.platformVideoId],
      set: {
        uploadQueueId: mapped.uploadQueueId,
        contentId: mapped.contentId,
        platformAccountId: mapped.platformAccountId,
        credentialChannelId: mapped.credentialChannelId,
        platformVideoUrl: mapped.platformVideoUrl,
        videoType: mapped.videoType,
        title: mapped.title,
        description: mapped.description,
        tags: mapped.tags,
        privacyStatus: mapped.privacyStatus,
        publishedAt: mapped.publishedAt,
        updatedAt: new Date(),
      },
    });

  return { success: true };
}

export async function backfillPublishedVideosAction(): Promise<{ upserted: number }> {
  await ensurePlatformAccountsLinked();

  const rows = await db.query.uploadQueue.findMany({
    where: eq(uploadQueue.status, "done"),
    with: {
      channel: true,
      content: true,
    },
    orderBy: (t, { desc: orderDesc }) => orderDesc(t.uploadedAt),
  });

  let upserted = 0;
  for (const row of rows) {
    if (!row.platformVideoId) continue;
    const mapped = mapQueueRowToPublishedVideo(row);
    if (!mapped) continue;

    await db
      .insert(publishedVideos)
      .values(mapped)
      .onConflictDoUpdate({
        target: [publishedVideos.platform, publishedVideos.platformVideoId],
        set: {
          uploadQueueId: mapped.uploadQueueId,
          contentId: mapped.contentId,
          platformAccountId: mapped.platformAccountId,
          credentialChannelId: mapped.credentialChannelId,
          platformVideoUrl: mapped.platformVideoUrl,
          videoType: mapped.videoType,
          title: mapped.title,
          description: mapped.description,
          tags: mapped.tags,
          privacyStatus: mapped.privacyStatus,
          publishedAt: mapped.publishedAt,
          updatedAt: new Date(),
        },
      });
    upserted++;
  }

  return { upserted };
}

async function fetchYouTubeCredentialCandidates(platformAccountId: number) {
  const rows = await db.query.socialChannels.findMany({
    where: and(
      eq(socialChannels.platform, "youtube"),
      eq(socialChannels.platformAccountId, platformAccountId),
      eq(socialChannels.isActive, true),
    ),
    with: { oauthClient: true },
    orderBy: (t, { asc: orderAsc }) => orderAsc(t.id),
  });

  const now = new Date();
  return rows.filter((row) => {
    if (!row.accessToken) return false;
    if (row.needsReconnect) return false;
    if (row.quotaExceededUntil && row.quotaExceededUntil > now) return false;
    if (row.oauthClient && !row.oauthClient.isActive) return false;
    return true;
  });
}

async function fetchFacebookCredentialCandidates(platformAccountId: number) {
  const rows = await db.query.socialChannels.findMany({
    where: and(
      eq(socialChannels.platform, "facebook"),
      eq(socialChannels.platformAccountId, platformAccountId),
      eq(socialChannels.isActive, true),
    ),
    orderBy: (t, { asc: orderAsc }) => orderAsc(t.id),
  });

  return rows.filter((row) => {
    if (!row.accessToken) return false;
    if (!row.platformChannelId) return false;
    if (row.needsReconnect) return false;
    return true;
  });
}

async function listFacebookReels(
  pageId: string,
  accessToken: string,
  limit = 50,
): Promise<FacebookReelMetricItem[]> {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: "id,description,created_time,permalink_url,length,views",
    limit: String(Math.max(1, Math.min(limit, 100))),
  });

  const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/video_reels?${params.toString()}`, {
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok || json.error) {
    const msg = json?.error?.message ?? text ?? `Facebook API error ${res.status}`;
    throw new Error(msg);
  }

  return Array.isArray(json.data) ? json.data as FacebookReelMetricItem[] : [];
}

type WriteYouTubeMetricsResult = {
  updated: number;
  fetchedAt: Date;
  snapshotKeys: Array<{ platformVideoId: string; publishedVideoId: string }>;
};

async function writeYouTubeMetrics(
  accountId: number,
  credentialChannelId: number,
  items: Awaited<ReturnType<typeof listYouTubeVideos>>,
): Promise<WriteYouTubeMetricsResult> {
  const videoIds = items
    .map((item) => item.id)
    .filter((value): value is string => !!value);
  if (videoIds.length === 0) return { updated: 0, fetchedAt: new Date(), snapshotKeys: [] };

  const existing = await db.query.publishedVideos.findMany({
    where: and(
      eq(publishedVideos.platform, "youtube"),
      eq(publishedVideos.platformAccountId, accountId),
      inArray(publishedVideos.platformVideoId, videoIds),
    ),
  });
  const byVideoId = new Map(existing.map((row) => [row.platformVideoId, row]));

  const now = new Date();
  let updated = 0;
  const snapshotKeys: Array<{ platformVideoId: string; publishedVideoId: string }> = [];

  for (const item of items) {
    if (!item.id) continue;
    const row = byVideoId.get(item.id);
    if (!row) continue;

    const durationSeconds = parseIsoDurationToSeconds(item.contentDetails?.duration);
    const viewCount = toCount(item.statistics?.viewCount);
    const likeCount = toCount(item.statistics?.likeCount);
    const commentCount = toCount(item.statistics?.commentCount);
    const favoriteCount = toCount(item.statistics?.favoriteCount);
    const privacyStatus = item.status?.privacyStatus ?? row.privacyStatus ?? null;
    const publishedAt = item.snippet?.publishedAt
      ? new Date(item.snippet.publishedAt)
      : row.publishedAt;

    await db
      .update(publishedVideos)
      .set({
        credentialChannelId,
        title: item.snippet?.title ?? row.title,
        description: item.snippet?.description ?? row.description,
        tags: item.snippet?.tags ?? row.tags,
        privacyStatus,
        durationSeconds,
        publishedAt,
        latestViewCount: viewCount,
        latestLikeCount: likeCount,
        latestCommentCount: commentCount,
        latestFetchedAt: now,
        rawLatestJson: item,
        updatedAt: now,
      })
      .where(eq(publishedVideos.id, row.id));

    await db.insert(videoMetricSnapshots).values({
      publishedVideoId: row.id,
      fetchedAt: now,
      viewCount,
      likeCount,
      commentCount,
      favoriteCount,
      privacyStatus,
      durationSeconds,
      rawJson: item,
    });

    snapshotKeys.push({ platformVideoId: item.id, publishedVideoId: row.id });
    updated++;
  }

  await db
    .update(platformAccounts)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(platformAccounts.id, accountId));

  return { updated, fetchedAt: now, snapshotKeys };
}

async function writeFacebookMetrics(
  accountId: number,
  credentialChannelId: number,
  items: FacebookReelMetricItem[],
): Promise<number> {
  const videoIds = items.map((item) => item.id).filter(Boolean);
  if (videoIds.length === 0) return 0;

  const existing = await db.query.publishedVideos.findMany({
    where: and(
      eq(publishedVideos.platform, "facebook"),
      eq(publishedVideos.platformAccountId, accountId),
      inArray(publishedVideos.platformVideoId, videoIds),
    ),
  });
  const byVideoId = new Map(existing.map((row) => [row.platformVideoId, row]));

  let updated = 0;
  for (const item of items) {
    const row = byVideoId.get(item.id);
    if (!row) continue;

    const now = new Date();
    const publishedAt = item.created_time ? new Date(item.created_time) : row.publishedAt;
    const platformVideoUrl = item.permalink_url
      ? `https://www.facebook.com${item.permalink_url}`
      : row.platformVideoUrl;
    const viewCount = toCount(item.views);
    const durationSeconds = item.length != null ? Number(item.length) : row.durationSeconds;

    await db
      .update(publishedVideos)
      .set({
        credentialChannelId,
        description: item.description ?? row.description,
        platformVideoUrl,
        durationSeconds,
        publishedAt,
        latestViewCount: viewCount,
        latestFetchedAt: now,
        rawLatestJson: item,
        updatedAt: now,
      })
      .where(eq(publishedVideos.id, row.id));

    await db.insert(videoMetricSnapshots).values({
      publishedVideoId: row.id,
      fetchedAt: now,
      viewCount,
      likeCount: row.latestLikeCount ?? 0,
      commentCount: row.latestCommentCount ?? 0,
      favoriteCount: 0,
      privacyStatus: row.privacyStatus,
      durationSeconds,
      rawJson: item,
    });

    updated++;
  }

  await db
    .update(platformAccounts)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(platformAccounts.id, accountId));

  return updated;
}

export async function syncYouTubeAnalyticsAction(input?: {
  platformAccountId?: number | null;
  limitVideos?: number;
  force?: boolean;
}): Promise<SyncAnalyticsResult> {
  await ensurePlatformAccountsLinked();
  await backfillPublishedVideosAction();

  const allVideos = await db.query.publishedVideos.findMany({
    where: eq(publishedVideos.platform, "youtube"),
    orderBy: (t, { desc: orderDesc, asc: orderAsc }) => [
      orderAsc(t.latestFetchedAt),
      orderDesc(t.publishedAt),
    ],
  });

  const filteredVideos = allVideos.filter((video) => {
    if (input?.platformAccountId && video.platformAccountId !== input.platformAccountId) {
      return false;
    }
    return input?.force ? true : shouldSyncVideo(video);
  });

  const limitVideos = Math.max(1, Math.min(input?.limitVideos ?? 40, 120));
  const targets = filteredVideos.slice(0, limitVideos);

  const grouped = new Map<number, PublishedVideoRow[]>();
  for (const video of targets) {
    const arr = grouped.get(video.platformAccountId) ?? [];
    arr.push(video);
    grouped.set(video.platformAccountId, arr);
  }

  const result: SyncAnalyticsResult = {
    platform: "youtube",
    accountsTouched: 0,
    videosRequested: targets.length,
    videosUpdated: 0,
    errors: [],
  };

  for (const [accountId, videos] of grouped) {
    const candidates = await fetchYouTubeCredentialCandidates(accountId);
    if (candidates.length === 0) {
      result.errors.push(`youtube/account:${accountId} không có credential khả dụng`);
      continue;
    }

    const videoIds = videos.map((video) => video.platformVideoId);
    let synced = false;

    for (const credential of candidates) {
      try {
        const items = await listYouTubeVideos(credential.id, videoIds);
        const writeResult = await writeYouTubeMetrics(accountId, credential.id, items);
        result.videosUpdated += writeResult.updated;
        result.accountsTouched++;
        synced = true;

        // YouTube Analytics API: fetch CTR + retention for the just-written snapshots
        if (writeResult.snapshotKeys.length > 0) {
          try {
            const endDate   = writeResult.fetchedAt.toISOString().slice(0, 10);
            const startDate = new Date(writeResult.fetchedAt.getTime() - 90 * 24 * 60 * 60 * 1000)
              .toISOString().slice(0, 10);
            const platformVideoIds = writeResult.snapshotKeys.map((k) => k.platformVideoId);

            const analyticsMap = await fetchYouTubeAnalyticsMetrics(
              credential.id,
              platformVideoIds,
              startDate,
              endDate,
            );

            for (const { platformVideoId, publishedVideoId } of writeResult.snapshotKeys) {
              const metrics = analyticsMap.get(platformVideoId);
              if (!metrics) continue;
              await db
                .update(videoMetricSnapshots)
                .set({
                  ctr:                     metrics.ctr !== null ? String(metrics.ctr) : null,
                  avgViewDurationSec:      metrics.avgViewDurationSec,
                  retentionPct:            toRetentionPctDbValue(metrics.retentionPct),
                  shareCount:              metrics.shareCount ?? null,
                  estimatedMinutesWatched: metrics.estimatedMinutesWatched ?? null,
                  subscribersGained:       metrics.subscribersGained ?? null,
                  subscribersLost:         metrics.subscribersLost ?? null,
                })
                .where(
                  and(
                    eq(videoMetricSnapshots.publishedVideoId, publishedVideoId),
                    eq(videoMetricSnapshots.fetchedAt, writeResult.fetchedAt),
                  ),
                );
            }
          } catch (analyticsErr) {
            const analyticsMsg = analyticsErr instanceof Error ? analyticsErr.message : String(analyticsErr);
            result.errors.push(`youtube/analytics:${accountId} ${analyticsMsg.slice(0, 180)}`);
          }
        }

        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isQuotaExceededError(error)) {
          await db
            .update(socialChannels)
            .set({
              quotaExceededUntil: nextQuotaResetUtc(),
              updatedAt: new Date(),
            })
            .where(eq(socialChannels.id, credential.id));
          result.errors.push(`youtube/account:${accountId} quota ở credential ${credential.id}`);
          continue;
        }

        if (isTokenRevokedError(error) || isAuthError(error) || isTransientError(error)) {
          result.errors.push(`youtube/account:${accountId} credential ${credential.id}: ${message.slice(0, 180)}`);
          continue;
        }

        result.errors.push(`youtube/account:${accountId} credential ${credential.id}: ${message.slice(0, 180)}`);
      }
    }

    if (!synced) {
      result.errors.push(`youtube/account:${accountId} sync thất bại`);
    }
  }

  return result;
}

export async function syncFacebookAnalyticsAction(input?: {
  platformAccountId?: number | null;
  limitVideos?: number;
  force?: boolean;
}): Promise<SyncAnalyticsResult> {
  await ensurePlatformAccountsLinked();
  await backfillPublishedVideosAction();

  const allVideos = await db.query.publishedVideos.findMany({
    where: eq(publishedVideos.platform, "facebook"),
    orderBy: (t, { desc: orderDesc, asc: orderAsc }) => [
      orderAsc(t.latestFetchedAt),
      orderDesc(t.publishedAt),
    ],
  });

  const filteredVideos = allVideos.filter((video) => {
    if (video.videoType === "quote") {
      return false;
    }
    if (input?.platformAccountId && video.platformAccountId !== input.platformAccountId) {
      return false;
    }
    return input?.force ? true : shouldSyncVideo(video);
  });

  const limitVideos = Math.max(1, Math.min(input?.limitVideos ?? 40, 120));
  const targets = filteredVideos.slice(0, limitVideos);

  const grouped = new Map<number, PublishedVideoRow[]>();
  for (const video of targets) {
    const arr = grouped.get(video.platformAccountId) ?? [];
    arr.push(video);
    grouped.set(video.platformAccountId, arr);
  }

  const result: SyncAnalyticsResult = {
    platform: "facebook",
    accountsTouched: 0,
    videosRequested: targets.length,
    videosUpdated: 0,
    errors: [],
  };

  for (const [accountId, videos] of grouped) {
    const candidates = await fetchFacebookCredentialCandidates(accountId);
    if (candidates.length === 0) {
      result.errors.push(`facebook/account:${accountId} không có credential khả dụng`);
      continue;
    }

    let synced = false;
    for (const credential of candidates) {
      try {
        const items = await listFacebookReels(
          credential.platformChannelId!,
          credential.accessToken!,
          Math.max(videos.length + 10, 25),
        );
        result.videosUpdated += await writeFacebookMetrics(accountId, credential.id, items);
        result.accountsTouched++;
        synced = true;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`facebook/account:${accountId} credential ${credential.id}: ${message.slice(0, 180)}`);
      }
    }

    if (!synced) {
      result.errors.push(`facebook/account:${accountId} sync thất bại`);
    }
  }

  return result;
}

export async function getAnalyticsReportConfigAction(): Promise<AnalyticsReportConfig> {
  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, ANALYTICS_REPORT_CONFIG_KEY),
  });
  if (!row) return getDefaultAnalyticsReportConfig();

  try {
    return normalizeAnalyticsReportConfig(JSON.parse(row.value));
  } catch {
    return getDefaultAnalyticsReportConfig();
  }
}

export async function saveAnalyticsReportConfigAction(
  input: AnalyticsReportConfig
): Promise<{ success: boolean }> {
  const normalized = normalizeAnalyticsReportConfig(input);
  await db
    .insert(appConfig)
    .values({
      key: ANALYTICS_REPORT_CONFIG_KEY,
      value: JSON.stringify(normalized),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: JSON.stringify(normalized),
        updatedAt: new Date(),
      },
    });
  return { success: true };
}

export async function buildPublishingAnalyticsReportAction(input?: {
  platform?: SupportedPlatform;
  platformAccountId?: number | null;
  period?: AnalyticsReportPeriod;
  sendToTelegram?: boolean;
}): Promise<AnalyticsReportResult> {
  await ensurePlatformAccountsLinked();
  await backfillPublishedVideosAction();

  const platform = input?.platform ?? "youtube";
  const period = input?.period ?? "7d";
  const now = new Date();
  const window = getReportWindow(period, now);

  const videos = await db.query.publishedVideos.findMany({
    where: input?.platformAccountId
      ? and(
          eq(publishedVideos.platform, platform),
          eq(publishedVideos.platformAccountId, input.platformAccountId)
        )
      : eq(publishedVideos.platform, platform),
    with: {
      platformAccount: true,
      content: true,
    },
    orderBy: (t, { desc: orderDesc }) => orderDesc(t.publishedAt),
  });

  const filteredVideos = videos.filter((video) => {
    const publishedAt = video.publishedAt ? new Date(video.publishedAt).getTime() : 0;
    return publishedAt >= window.start.getTime() && publishedAt < window.end.getTime();
  });
  const reportVideos = filteredVideos.length > 0 ? filteredVideos : videos.slice(0, 20);

  const snapshots = reportVideos.length === 0
    ? []
    : await db.query.videoMetricSnapshots.findMany({
        where: inArray(videoMetricSnapshots.publishedVideoId, reportVideos.map((video) => video.id)),
        orderBy: (t, { asc: orderAsc }) => [orderAsc(t.publishedVideoId), orderAsc(t.fetchedAt)],
      });

  const snapshotsByVideo = new Map<string, typeof snapshots>();
  for (const snapshot of snapshots) {
    const arr = snapshotsByVideo.get(snapshot.publishedVideoId) ?? [];
    arr.push(snapshot);
    snapshotsByVideo.set(snapshot.publishedVideoId, arr);
  }

  const scopeLabel = input?.platformAccountId
    ? videos.find((video) => video.platformAccountId === input.platformAccountId)?.platformAccount.displayName ?? "Kênh đã chọn"
    : platformLabel(platform);

  const ranked = reportVideos.map((video) => {
    const chain = snapshotsByVideo.get(video.id) ?? [];
    const inWindow = chain.filter((snapshot) => {
      const fetched = new Date(snapshot.fetchedAt).getTime();
      return fetched >= window.start.getTime() && fetched < window.end.getTime();
    });
    const earliest = inWindow[0] ?? chain[0] ?? null;
    const latest = inWindow[inWindow.length - 1] ?? chain[chain.length - 1] ?? null;
    const deltaViews = Math.max(
      0,
      toCount(latest?.viewCount ?? video.latestViewCount) - toCount(earliest?.viewCount)
    );
    return {
      video,
      latestViews: toCount(video.latestViewCount),
      latestLikes: toCount(video.latestLikeCount),
      latestComments: toCount(video.latestCommentCount),
      deltaViews,
    };
  });

  const topByViews = [...ranked].sort((a, b) => b.latestViews - a.latestViews).slice(0, 5);
  const topByGrowth = [...ranked].sort((a, b) => b.deltaViews - a.deltaViews).slice(0, 3);
  const totalViews = ranked.reduce((sum, row) => sum + row.latestViews, 0);
  const totalLikes = ranked.reduce((sum, row) => sum + row.latestLikes, 0);
  const totalComments = ranked.reduce((sum, row) => sum + row.latestComments, 0);
  const totalDeltaViews = ranked.reduce((sum, row) => sum + row.deltaViews, 0);

  const lines = [
    `<b>${escapeHtml(window.title)}</b>`,
    `Scope: <b>${escapeHtml(scopeLabel)}</b>`,
    `Video trong kỳ: <b>${filteredVideos.length}</b>`,
    `Views hiện tại: <b>${toCount(totalViews).toLocaleString("vi-VN")}</b>`,
    `Tăng views ghi nhận: <b>${toCount(totalDeltaViews).toLocaleString("vi-VN")}</b>`,
    `Likes: <b>${toCount(totalLikes).toLocaleString("vi-VN")}</b> · Comments: <b>${toCount(totalComments).toLocaleString("vi-VN")}</b>`,
  ];

  if (topByViews.length > 0) {
    lines.push("", `<b>Top video theo views</b>`);
    topByViews.forEach((row, index) => {
      lines.push(
        `${index + 1}. ${escapeHtml(row.video.title.slice(0, 80))} · ${row.latestViews.toLocaleString("vi-VN")} views`
      );
    });
  }

  if (topByGrowth.some((row) => row.deltaViews > 0)) {
    lines.push("", `<b>Video tăng tốt trong kỳ</b>`);
    topByGrowth
      .filter((row) => row.deltaViews > 0)
      .forEach((row, index) => {
        lines.push(
          `${index + 1}. ${escapeHtml(row.video.title.slice(0, 80))} · +${row.deltaViews.toLocaleString("vi-VN")} views`
        );
      });
  }

  const text = lines.join("\n");

  if (input?.sendToTelegram) {
    await sendTelegram(text);
  }

  return {
    title: window.title,
    period,
    marker: window.marker,
    lines,
    text,
  };
}

export async function maybeSendScheduledAnalyticsReportAction(): Promise<{
  sent: boolean;
  reason?: string;
  marker?: string;
}> {
  const config = await getAnalyticsReportConfigAction();
  if (!config.enabled) return { sent: false, reason: "disabled" };

  const now = new Date();
  const local = getLocalDateParts(now);
  if (local.hour !== config.sendHour || local.minute !== config.sendMinute) {
    return { sent: false, reason: "not_due_time" };
  }

  const window = getReportWindow(config.period, now);
  if (window.shouldSendTodayOnlyOnDay && local.day !== window.shouldSendTodayOnlyOnDay) {
    return { sent: false, reason: "not_due_day" };
  }
  if (config.lastSentMarker === window.marker) {
    return { sent: false, reason: "already_sent", marker: window.marker };
  }

  await buildPublishingAnalyticsReportAction({
    platform: config.platform,
    platformAccountId: config.platformAccountId,
    period: config.period,
    sendToTelegram: true,
  });

  await saveAnalyticsReportConfigAction({
    ...config,
    lastSentMarker: window.marker,
  });

  return { sent: true, marker: window.marker };
}

export async function getPublishingAnalyticsAction(filters?: {
  platform?: SupportedPlatform;
  platformAccountId?: number | null;
  limit?: number;
}): Promise<PublishingAnalyticsPayload> {
  await ensurePlatformAccountsLinked();
  await backfillPublishedVideosAction();

  const selectedPlatform = filters?.platform ?? "youtube";
  const selectedPlatformAccountId = filters?.platformAccountId ?? null;
  const limit = Math.max(20, Math.min(filters?.limit ?? 120, 300));

  const [accounts, credentials, allVideos] = await Promise.all([
    db.query.platformAccounts.findMany({
      orderBy: (t, { asc: orderAsc }) => [orderAsc(t.platform), orderAsc(t.displayName)],
    }),
    db.query.socialChannels.findMany({
      orderBy: (t, { asc: orderAsc }) => [orderAsc(t.platform), orderAsc(t.id)],
    }),
    db.query.publishedVideos.findMany({
      with: {
        platformAccount: true,
        content: true,
      },
      orderBy: (t, { desc: orderDesc }) => orderDesc(t.publishedAt),
    }),
  ]);

  const platformSummaries: AnalyticsPlatformSummary[] = SUPPORTED_PLATFORMS.map((platform) => {
    const platformAccountsRows = accounts.filter((account) => account.platform === platform);
    const platformCredentialsRows = credentials.filter((credential) => credential.platform === platform);
    const platformVideosRows = allVideos.filter((video) => video.platform === platform);
    const staleVideos = platformVideosRows.filter((video) => shouldSyncVideo(video)).length;
    const lastSyncedAtCandidates = [
      ...platformAccountsRows.map((account) => account.lastSyncedAt).filter(Boolean),
      ...platformVideosRows.map((video) => video.latestFetchedAt).filter(Boolean),
    ] as Date[];

    return {
      platform,
      label: platformLabel(platform),
      totalChannels: platformAccountsRows.length,
      connectedCredentials: platformCredentialsRows.length,
      totalVideos: platformVideosRows.length,
      totalViews: platformVideosRows.reduce((sum, video) => sum + toCount(video.latestViewCount), 0),
      totalLikes: platformVideosRows.reduce((sum, video) => sum + toCount(video.latestLikeCount), 0),
      totalComments: platformVideosRows.reduce((sum, video) => sum + toCount(video.latestCommentCount), 0),
      staleVideos,
      lastSyncedAt: lastSyncedAtCandidates.length
        ? new Date(Math.max(...lastSyncedAtCandidates.map((date) => new Date(date).getTime())))
        : null,
    };
  });

  const selectedAccounts = accounts.filter((account) => account.platform === selectedPlatform);
  const selectedCredentials = credentials.filter((credential) => credential.platform === selectedPlatform);
  const selectedVideos = allVideos.filter((video) => {
    if (video.platform !== selectedPlatform) return false;
    if (selectedPlatformAccountId && video.platformAccountId !== selectedPlatformAccountId) return false;
    return true;
  });

  const channels: AnalyticsChannelSummary[] = selectedAccounts.map((account) => {
    const accountCredentials = selectedCredentials.filter(
      (credential) => credential.platformAccountId === account.id
    );
    const accountVideos = selectedVideos.filter((video) => video.platformAccountId === account.id);
    const latestPublishedAt = accountVideos.length
      ? new Date(
          Math.max(
            ...accountVideos
              .map((video) => video.publishedAt?.getTime() ?? 0)
              .filter((value) => value > 0)
          )
        )
      : null;
    const lastSyncedAtCandidates = [
      account.lastSyncedAt,
      ...accountVideos.map((video) => video.latestFetchedAt),
    ].filter(Boolean) as Date[];

    return {
      id: account.id,
      displayName: account.displayName,
      handle: account.handle,
      thumbnailUrl: account.thumbnailUrl,
      connectedCredentials: accountCredentials.length,
      activeCredentials: accountCredentials.filter((credential) => credential.isActive).length,
      totalVideos: accountVideos.length,
      totalViews: accountVideos.reduce((sum, video) => sum + toCount(video.latestViewCount), 0),
      totalLikes: accountVideos.reduce((sum, video) => sum + toCount(video.latestLikeCount), 0),
      totalComments: accountVideos.reduce((sum, video) => sum + toCount(video.latestCommentCount), 0),
      latestPublishedAt,
      lastSyncedAt: lastSyncedAtCandidates.length
        ? new Date(Math.max(...lastSyncedAtCandidates.map((date) => new Date(date).getTime())))
        : null,
    };
  });

  const videos: AnalyticsVideoRow[] = selectedVideos
    .slice(0, limit)
    .map((video) => ({
      id: video.id,
      platformAccountId: video.platformAccountId,
      channelName: video.platformAccount.displayName,
      channelHandle: video.platformAccount.handle,
      platformVideoId: video.platformVideoId,
      platformVideoUrl: video.platformVideoUrl,
      title: video.title,
      videoType: video.videoType,
      privacyStatus: video.privacyStatus,
      durationSeconds: video.durationSeconds,
      publishedAt: video.publishedAt,
      viewCount: toCount(video.latestViewCount),
      likeCount: toCount(video.latestLikeCount),
      commentCount: toCount(video.latestCommentCount),
      lastFetchedAt: video.latestFetchedAt,
      topic: video.content?.topic ?? null,
      nicheName: video.content?.nicheName ?? null,
    }));

  const totalLastSyncedCandidates = [
    ...channels.map((channel) => channel.lastSyncedAt),
    ...videos.map((video) => video.lastFetchedAt),
  ].filter(Boolean) as Date[];

  return {
    selectedPlatform,
    selectedPlatformAccountId,
    platforms: platformSummaries,
    channels,
    videos,
    totals: {
      totalVideos: selectedVideos.length,
      totalViews: selectedVideos.reduce((sum, video) => sum + toCount(video.latestViewCount), 0),
      totalLikes: selectedVideos.reduce((sum, video) => sum + toCount(video.latestLikeCount), 0),
      totalComments: selectedVideos.reduce((sum, video) => sum + toCount(video.latestCommentCount), 0),
      staleVideos: selectedVideos.filter((video) => shouldSyncVideo(video)).length,
      lastSyncedAt: totalLastSyncedCandidates.length
        ? new Date(Math.max(...totalLastSyncedCandidates.map((date) => new Date(date).getTime())))
        : null,
    },
  };
}

export async function getTopicPerformanceAction(filters?: {
  platform?: SupportedPlatform;
  platformAccountId?: number | null;
  limit?: number;
}): Promise<TopicPerformanceRow[]> {
  await ensurePlatformAccountsLinked();
  await backfillPublishedVideosAction();

  const selectedPlatform = filters?.platform ?? "youtube";
  const selectedPlatformAccountId = filters?.platformAccountId ?? null;
  const limit = Math.max(5, Math.min(filters?.limit ?? 50, 200));

  const videos = await db.query.publishedVideos.findMany({
    with: {
      content: true,
    },
    where: selectedPlatformAccountId != null
      ? and(
          eq(publishedVideos.platform, selectedPlatform),
          eq(publishedVideos.platformAccountId, selectedPlatformAccountId),
        )
      : eq(publishedVideos.platform, selectedPlatform),
    orderBy: (t, { desc: orderDesc }) => orderDesc(t.publishedAt),
  });

  const topicVideos = videos.filter((video) => {
    const topic = video.content?.topic?.trim();
    return Boolean(topic);
  });

  const snapshotRows = topicVideos.length === 0
    ? []
    : await db.query.videoMetricSnapshots.findMany({
        where: inArray(videoMetricSnapshots.publishedVideoId, topicVideos.map((video) => video.id)),
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.fetchedAt)],
      });

  const latestSnapshotByVideo = new Map<string, typeof snapshotRows[number]>();
  for (const row of snapshotRows) {
    if (!latestSnapshotByVideo.has(row.publishedVideoId)) {
      latestSnapshotByVideo.set(row.publishedVideoId, row);
    }
  }

  const aggregate = new Map<string, {
    topic: string;
    niche: string | null;
    contentProfileKey: string | null;
    videoCount: number;
    totalViews: number;
    durationSum: number;
    durationCount: number;
    retentionSum: number;
    retentionCount: number;
    lastPublishedAt: Date | null;
  }>();

  for (const video of topicVideos) {
    const topic = video.content?.topic?.trim();
    if (!topic) continue;
    const niche = video.content?.nicheName ?? null;
    const contentProfileKey = video.content?.contentProfileKey ?? null;
    const snapshot = latestSnapshotByVideo.get(video.id);
    const views = snapshot ? toCount(snapshot.viewCount) : toCount(video.latestViewCount);
    const duration = snapshot?.avgViewDurationSec ?? null;
    const retention = snapshot?.retentionPct == null ? null : Number(snapshot.retentionPct);

    const existing = aggregate.get(topic) ?? {
      topic,
      niche,
      contentProfileKey,
      videoCount: 0,
      totalViews: 0,
      durationSum: 0,
      durationCount: 0,
      retentionSum: 0,
      retentionCount: 0,
      lastPublishedAt: null,
    };

    existing.videoCount += 1;
    existing.totalViews += views;
    if (duration != null && Number.isFinite(duration)) {
      existing.durationSum += duration;
      existing.durationCount += 1;
    }
    if (retention != null && Number.isFinite(retention)) {
      existing.retentionSum += retention;
      existing.retentionCount += 1;
    }
    if (
      video.publishedAt &&
      (!existing.lastPublishedAt || video.publishedAt.getTime() > existing.lastPublishedAt.getTime())
    ) {
      existing.lastPublishedAt = video.publishedAt;
    }
    aggregate.set(topic, existing);
  }

  return Array.from(aggregate.values())
    .map((row) => ({
      topic: row.topic,
      niche: row.niche,
      contentProfileKey: row.contentProfileKey,
      videoCount: row.videoCount,
      avgViews: row.videoCount > 0 ? Math.round(row.totalViews / row.videoCount) : 0,
      avgViewDurationSec: row.durationCount > 0 ? Math.round(row.durationSum / row.durationCount) : null,
      avgRetentionPct: row.retentionCount > 0
        ? Number((row.retentionSum / row.retentionCount).toFixed(2))
        : null,
      lastPublishedAt: row.lastPublishedAt,
    }))
    .sort((a, b) => {
      if (b.avgViews !== a.avgViews) return b.avgViews - a.avgViews;
      if (b.videoCount !== a.videoCount) return b.videoCount - a.videoCount;
      return a.topic.localeCompare(b.topic, "vi");
    })
    .slice(0, limit);
}

export async function getTopicPerformanceSummaryAction(filters?: {
  platform?: SupportedPlatform;
  platformAccountId?: number | null;
  limit?: number;
}): Promise<TopicPerformanceSummary> {
  const rows = await getTopicPerformanceAction({
    platform: filters?.platform,
    platformAccountId: filters?.platformAccountId,
    limit: Math.max(10, Math.min(filters?.limit ?? 200, 200)),
  });

  if (rows.length === 0) {
    return {
      highPerformers: [],
      mediumPerformers: [],
      lowPerformers: [],
      topKeywords: [],
      weakKeywords: [],
      observations: ["Chưa có đủ dữ liệu published video để tổng hợp topic performance."],
    };
  }

  const viewValues = rows.map((row) => row.avgViews);
  const retentionValues = rows
    .map((row) => row.avgRetentionPct)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const durationValues = rows
    .map((row) => row.avgViewDurationSec)
    .filter((value): value is number => value != null && Number.isFinite(value));

  const scoredRows = rows.map((row) => {
    const viewRank = percentileRank(viewValues, row.avgViews) ?? 0;
    const retentionRank = percentileRank(retentionValues, row.avgRetentionPct) ?? null;
    const durationRank = percentileRank(durationValues, row.avgViewDurationSec) ?? null;
    const composite = averageNumbers([viewRank, retentionRank, durationRank]) ?? viewRank;
    return {
      row,
      score: Number(composite.toFixed(4)),
    };
  });

  const highPerformers = scoredRows
    .filter((entry) => entry.score >= 0.67)
    .map((entry) => entry.row);
  const lowPerformers = scoredRows
    .filter((entry) => entry.score <= 0.34)
    .map((entry) => entry.row);
  const mediumPerformers = scoredRows
    .filter((entry) => entry.score > 0.34 && entry.score < 0.67)
    .map((entry) => entry.row);

  const topKeywords = collectKeywordCounts(highPerformers)
    .slice(0, 8)
    .map(([keyword]) => keyword);
  const weakKeywords = collectKeywordCounts(lowPerformers)
    .slice(0, 8)
    .map(([keyword]) => keyword);

  const highAngles = detectRecurringAngles(highPerformers);
  const lowAngles = detectRecurringAngles(lowPerformers);
  const observations: string[] = [];

  const averageViewsHigh = averageNumbers(highPerformers.map((row) => row.avgViews)) ?? 0;
  const averageViewsLow = averageNumbers(lowPerformers.map((row) => row.avgViews)) ?? 0;
  const averageRetentionHigh = averageNumbers(highPerformers.map((row) => row.avgRetentionPct));
  const averageRetentionLow = averageNumbers(lowPerformers.map((row) => row.avgRetentionPct));

  if (highPerformers.length > 0) {
    observations.push(
      `Nhóm hiệu suất cao hiện nghiêng về các topic mang keyword: ${topKeywords.slice(0, 5).join(", ") || "chưa rõ"}.`
    );
  }
  if (highAngles.length > 0) {
    observations.push(
      `Các góc cảm xúc lặp lại ở nhóm tốt: ${highAngles.join(", ")}.`
    );
  }
  if (lowPerformers.length > 0) {
    observations.push(
      `Nhóm hiệu suất thấp xuất hiện nhiều ở keyword: ${weakKeywords.slice(0, 5).join(", ") || "chưa rõ"}.`
    );
  }
  if (lowAngles.length > 0) {
    observations.push(
      `Các góc cảm xúc dễ hụt hiệu suất hiện tại: ${lowAngles.join(", ")}.`
    );
  }
  if (highPerformers.length > 0 && lowPerformers.length > 0) {
    observations.push(
      `Avg views nhóm cao khoảng ${Math.round(averageViewsHigh).toLocaleString("vi-VN")} so với ${Math.round(averageViewsLow).toLocaleString("vi-VN")} ở nhóm thấp.`
    );
  }
  if (averageRetentionHigh != null || averageRetentionLow != null) {
    observations.push(
      `Retention trung bình nhóm cao: ${averageRetentionHigh != null ? averageRetentionHigh.toFixed(2) : "n/a"}% · nhóm thấp: ${averageRetentionLow != null ? averageRetentionLow.toFixed(2) : "n/a"}%.`
    );
  }
  const lowConfidenceCount = rows.filter((row) => row.videoCount < 2).length;
  if (lowConfidenceCount > 0) {
    observations.push(
      `${lowConfidenceCount}/${rows.length} topic hiện mới có dưới 2 video, nên pattern vẫn cần đọc như tín hiệu sớm chứ chưa phải kết luận chắc.`
    );
  }

  return {
    highPerformers,
    mediumPerformers,
    lowPerformers,
    topKeywords,
    weakKeywords,
    observations,
  };
}

export async function getTopicCoverageReportAction(filters?: {
  platform?: SupportedPlatform;
  platformAccountId?: number | null;
  limit?: number;
}): Promise<TopicCoverageClusterRow[]> {
  const rows = await getTopicPerformanceAction({
    platform: filters?.platform,
    platformAccountId: filters?.platformAccountId,
    limit: Math.max(20, Math.min(filters?.limit ?? 200, 200)),
  });

  const aggregate = new Map<string, {
    clusterName: string;
    videoCount: number;
    totalViews: number;
    durationWeightedSum: number;
    durationVideoCount: number;
    retentionWeightedSum: number;
    retentionVideoCount: number;
    topics: string[];
  }>();

  for (const row of rows) {
    const clusterName = resolveTopicClusterName(row.topic, row.contentProfileKey);
    const current = aggregate.get(clusterName) ?? {
      clusterName,
      videoCount: 0,
      totalViews: 0,
      durationWeightedSum: 0,
      durationVideoCount: 0,
      retentionWeightedSum: 0,
      retentionVideoCount: 0,
      topics: [],
    };

    current.videoCount += row.videoCount;
    current.totalViews += row.avgViews * row.videoCount;
    if (row.avgViewDurationSec != null) {
      current.durationWeightedSum += row.avgViewDurationSec * row.videoCount;
      current.durationVideoCount += row.videoCount;
    }
    if (row.avgRetentionPct != null) {
      current.retentionWeightedSum += row.avgRetentionPct * row.videoCount;
      current.retentionVideoCount += row.videoCount;
    }
    current.topics.push(row.topic);
    aggregate.set(clusterName, current);
  }

  return Array.from(aggregate.values())
    .map((row) => ({
      clusterName: row.clusterName,
      videoCount: row.videoCount,
      avgViews: row.videoCount > 0 ? Math.round(row.totalViews / row.videoCount) : 0,
      avgRetentionPct: row.retentionVideoCount > 0
        ? Number((row.retentionWeightedSum / row.retentionVideoCount).toFixed(2))
        : null,
      avgWatchDurationSec: row.durationVideoCount > 0
        ? Math.round(row.durationWeightedSum / row.durationVideoCount)
        : null,
      topicCount: row.topics.length,
      topics: row.topics.sort((a, b) => a.localeCompare(b, "vi")),
    }))
    .sort((a, b) => {
      if (b.videoCount !== a.videoCount) return b.videoCount - a.videoCount;
      if (b.avgViews !== a.avgViews) return b.avgViews - a.avgViews;
      return a.clusterName.localeCompare(b.clusterName, "vi");
    });
}

// ── Strategic topic family coverage (Phase 3A) ────────────────────────────

function getSampleDepthStatus(count: number): string {
  if (count === 0) return "No data";
  if (count <= 4) return "Too thin";
  if (count <= 9) return "Early signal";
  if (count <= 19) return "Usable signal";
  if (count <= 49) return "Decision-ready";
  return "Strong sample";
}

function getSprintLabel(
  familyId: string,
): StrategicFamilyCoverageRow["sprintLabel"] {
  if (familyId === NEEDS_REVIEW_FAMILY) return "Needs review";
  if (familyId === PHAT_PHAP_SPRINT.focusFamily) return "Focus";
  if (PHAT_PHAP_SPRINT.secondaryFamilies.includes(familyId as StrategicTopicFamilyId)) return "Secondary";
  if (PHAT_PHAP_SPRINT.exploreFamilies.includes(familyId as StrategicTopicFamilyId)) return "Explore";
  if (PHAT_PHAP_SPRINT.lowPriorityFamilies.includes(familyId as StrategicTopicFamilyId)) return "Low priority";
  return null;
}

function isQuoteFormat(formatType: string | null): boolean {
  return formatType === "legacy_quote_short" || formatType === "quote_short";
}

/**
 * Returns strategic topic family coverage for the phat_phap channel.
 * Queries content_generations directly — includes both published and unpublished content.
 * Does NOT include retention metrics (quote/photo would skew video-only retention data).
 */
export async function getStrategicFamilyCoverageAction(): Promise<StrategicFamilyCoverageRow[]> {
  const now = new Date();
  const ms3d = now.getTime() - 3 * 24 * 60 * 60 * 1000;
  const ms7d = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const ms30d = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const cut3d = new Date(ms3d);
  const cut7d = new Date(ms7d);
  const cut30d = new Date(ms30d);

  const rows = await db.query.contentGenerations.findMany({
    where: and(
      eq(contentGenerations.channelKey, "phat_phap"),
      eq(contentGenerations.status, "completed"),
    ),
    columns: {
      topic: true,
      topicFamily: true,
      formatType: true,
      createdAt: true,
    },
    orderBy: (t, { desc: d }) => d(t.createdAt),
  });

  type FamilyAgg = {
    familyId: string;
    total: number; last3d: number; last7d: number; last30d: number;
    videoTotal: number; videoLast3d: number; videoLast7d: number; videoLast30d: number;
    quoteTotal: number; quoteLast3d: number; quoteLast7d: number; quoteLast30d: number;
    topics: Set<string>;
  };

  const agg = new Map<string, FamilyAgg>();

  const ensure = (fid: string): FamilyAgg => {
    if (!agg.has(fid)) {
      agg.set(fid, {
        familyId: fid,
        total: 0, last3d: 0, last7d: 0, last30d: 0,
        videoTotal: 0, videoLast3d: 0, videoLast7d: 0, videoLast30d: 0,
        quoteTotal: 0, quoteLast3d: 0, quoteLast7d: 0, quoteLast30d: 0,
        topics: new Set(),
      });
    }
    return agg.get(fid)!;
  };

  for (const row of rows) {
    const rawFamily = row.topicFamily
      ? normalizeTopicFamily(row.topicFamily)
      : null;
    const familyId = rawFamily ?? inferStrategicTopicFamily(row.topic ?? "");
    const bucket = ensure(familyId);

    const createdAt = row.createdAt ?? now;
    const inLast3d = createdAt >= cut3d;
    const inLast7d = createdAt >= cut7d;
    const inLast30d = createdAt >= cut30d;
    const isQuote = isQuoteFormat(row.formatType);

    bucket.total += 1;
    if (inLast3d) bucket.last3d += 1;
    if (inLast7d) bucket.last7d += 1;
    if (inLast30d) bucket.last30d += 1;

    if (isQuote) {
      bucket.quoteTotal += 1;
      if (inLast3d) bucket.quoteLast3d += 1;
      if (inLast7d) bucket.quoteLast7d += 1;
      if (inLast30d) bucket.quoteLast30d += 1;
    } else {
      bucket.videoTotal += 1;
      if (inLast3d) bucket.videoLast3d += 1;
      if (inLast7d) bucket.videoLast7d += 1;
      if (inLast30d) bucket.videoLast30d += 1;
    }

    if (row.topic) bucket.topics.add(row.topic);
  }

  // Ensure all sprint families appear even if empty
  const allFamilies = [
    PHAT_PHAP_SPRINT.focusFamily,
    ...PHAT_PHAP_SPRINT.secondaryFamilies,
    ...PHAT_PHAP_SPRINT.exploreFamilies,
    ...PHAT_PHAP_SPRINT.lowPriorityFamilies,
    NEEDS_REVIEW_FAMILY,
  ];
  for (const fid of allFamilies) ensure(fid);

  const SPRINT_ORDER: Record<string, number> = { Focus: 0, Secondary: 1, Explore: 2, "Low priority": 3, "Needs review": 4 };

  return Array.from(agg.values())
    .map((b): StrategicFamilyCoverageRow => ({
      familyId: b.familyId,
      displayName: STRATEGIC_FAMILY_DISPLAY[b.familyId as StrategicTopicFamilyId] ?? b.familyId,
      sprintLabel: getSprintLabel(b.familyId),
      sampleDepth: { total: b.total, last3d: b.last3d, last7d: b.last7d, last30d: b.last30d },
      videoCount: { total: b.videoTotal, last3d: b.videoLast3d, last7d: b.videoLast7d, last30d: b.videoLast30d },
      quoteCount: { total: b.quoteTotal, last3d: b.quoteLast3d, last7d: b.quoteLast7d, last30d: b.quoteLast30d },
      sampleDepthStatus: getSampleDepthStatus(b.total),
      topics: Array.from(b.topics).sort((a, z) => a.localeCompare(z, "vi")).slice(0, 20),
    }))
    .sort((a, b) => {
      const ao = SPRINT_ORDER[a.sprintLabel ?? ""] ?? 3;
      const bo = SPRINT_ORDER[b.sprintLabel ?? ""] ?? 3;
      if (ao !== bo) return ao - bo;
      return b.sampleDepth.total - a.sampleDepth.total;
    });
}

export async function getHookPerformanceAction(filters?: {
  platform?: SupportedPlatform;
  platformAccountId?: number | null;
  limit?: number;
}): Promise<HookPerformanceRow[]> {
  await ensurePlatformAccountsLinked();
  await backfillPublishedVideosAction();

  const selectedPlatform = filters?.platform ?? "youtube";
  const selectedPlatformAccountId = filters?.platformAccountId ?? null;
  const limit = Math.max(5, Math.min(filters?.limit ?? 100, 300));

  const videos = await db.query.publishedVideos.findMany({
    with: { content: true },
    where: selectedPlatformAccountId != null
      ? and(
          eq(publishedVideos.platform, selectedPlatform),
          eq(publishedVideos.platformAccountId, selectedPlatformAccountId),
          eq(publishedVideos.videoType, "short"),
        )
      : and(
          eq(publishedVideos.platform, selectedPlatform),
          eq(publishedVideos.videoType, "short"),
        ),
    orderBy: (t, { desc: orderDesc }) => orderDesc(t.publishedAt),
  });

  const hookVideos = videos.filter((v) => v.content?.shortSelectedHook?.trim());

  const snapshotRows = hookVideos.length === 0
    ? []
    : await db.query.videoMetricSnapshots.findMany({
        where: inArray(videoMetricSnapshots.publishedVideoId, hookVideos.map((v) => v.id)),
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.fetchedAt)],
      });

  const latestSnapshotByVideo = new Map<string, typeof snapshotRows[number]>();
  for (const row of snapshotRows) {
    if (!latestSnapshotByVideo.has(row.publishedVideoId)) {
      latestSnapshotByVideo.set(row.publishedVideoId, row);
    }
  }

  const aggregate = new Map<string, {
    hookText: string;
    hookPattern: string | null;
    hookType: string | null;
    topic: string | null;
    niche: string | null;
    videoCount: number;
    totalViews: number;
    durationSum: number;
    durationCount: number;
    retentionSum: number;
    retentionCount: number;
    lastPublishedAt: Date | null;
  }>();

  for (const video of hookVideos) {
    const hookText = video.content!.shortSelectedHook!.trim();
    const hookPattern = video.content?.hookPattern ?? null;
    const hookType = video.content?.hookType ?? null;
    const topic = video.content?.topic ?? null;
    const niche = video.content?.nicheName ?? null;
    const snapshot = latestSnapshotByVideo.get(video.id);
    const views = snapshot ? toCount(snapshot.viewCount) : toCount(video.latestViewCount);
    const duration = snapshot?.avgViewDurationSec ?? null;
    const retention = snapshot?.retentionPct == null ? null : Number(snapshot.retentionPct);

    const existing = aggregate.get(hookText) ?? {
      hookText,
      hookPattern,
      hookType,
      topic,
      niche,
      videoCount: 0,
      totalViews: 0,
      durationSum: 0,
      durationCount: 0,
      retentionSum: 0,
      retentionCount: 0,
      lastPublishedAt: null,
    };

    existing.videoCount += 1;
    existing.totalViews += views;
    if (duration != null && Number.isFinite(duration)) {
      existing.durationSum += duration;
      existing.durationCount += 1;
    }
    if (retention != null && Number.isFinite(retention)) {
      existing.retentionSum += retention;
      existing.retentionCount += 1;
    }
    if (
      video.publishedAt &&
      (!existing.lastPublishedAt || video.publishedAt.getTime() > existing.lastPublishedAt.getTime())
    ) {
      existing.lastPublishedAt = video.publishedAt;
    }
    aggregate.set(hookText, existing);
  }

  return Array.from(aggregate.values())
    .map((row) => ({
      hookText: row.hookText,
      hookPattern: row.hookPattern,
      hookType: row.hookType,
      topic: row.topic,
      niche: row.niche,
      videoCount: row.videoCount,
      avgViews: row.videoCount > 0 ? Math.round(row.totalViews / row.videoCount) : 0,
      avgViewDurationSec: row.durationCount > 0 ? Math.round(row.durationSum / row.durationCount) : null,
      avgRetentionPct: row.retentionCount > 0
        ? Number((row.retentionSum / row.retentionCount).toFixed(2))
        : null,
      lastPublishedAt: row.lastPublishedAt,
      lowConfidence: row.videoCount < 2,
    }))
    .sort((a, b) => {
      const aR = a.avgRetentionPct ?? -1;
      const bR = b.avgRetentionPct ?? -1;
      if (bR !== aR) return bR - aR;
      return b.avgViews - a.avgViews;
    })
    .slice(0, limit);
}

export async function getHookTypePerformanceAction(filters?: {
  platform?: SupportedPlatform;
  platformAccountId?: number | null;
}): Promise<HookTypePerformanceRow[]> {
  await ensurePlatformAccountsLinked();
  await backfillPublishedVideosAction();

  const selectedPlatform = filters?.platform ?? "youtube";
  const selectedPlatformAccountId = filters?.platformAccountId ?? null;

  const videos = await db.query.publishedVideos.findMany({
    with: { content: true },
    where: selectedPlatformAccountId != null
      ? and(
          eq(publishedVideos.platform, selectedPlatform),
          eq(publishedVideos.platformAccountId, selectedPlatformAccountId),
          eq(publishedVideos.videoType, "short"),
        )
      : and(
          eq(publishedVideos.platform, selectedPlatform),
          eq(publishedVideos.videoType, "short"),
        ),
    orderBy: (t, { desc: orderDesc }) => orderDesc(t.publishedAt),
  });

  const hookVideos = videos.filter((v) => v.content?.shortSelectedHook?.trim());

  const snapshotRows = hookVideos.length === 0
    ? []
    : await db.query.videoMetricSnapshots.findMany({
        where: inArray(videoMetricSnapshots.publishedVideoId, hookVideos.map((v) => v.id)),
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.fetchedAt)],
      });

  const latestSnapshotByVideo = new Map<string, typeof snapshotRows[number]>();
  for (const row of snapshotRows) {
    if (!latestSnapshotByVideo.has(row.publishedVideoId)) {
      latestSnapshotByVideo.set(row.publishedVideoId, row);
    }
  }

  type TypeAgg = {
    videoCount: number;
    totalViews: number;
    durationSum: number;
    durationCount: number;
    retentionSum: number;
    retentionCount: number;
  };
  const typeMap = new Map<string, TypeAgg>();

  for (const video of hookVideos) {
    const hookType = (video.content?.hookType as HookType | null | undefined) ?? "other";
    const snapshot = latestSnapshotByVideo.get(video.id);
    const views = snapshot ? toCount(snapshot.viewCount) : toCount(video.latestViewCount);
    const duration = snapshot?.avgViewDurationSec ?? null;
    const retention = snapshot?.retentionPct == null ? null : Number(snapshot.retentionPct);

    const existing = typeMap.get(hookType) ?? {
      videoCount: 0,
      totalViews: 0,
      durationSum: 0,
      durationCount: 0,
      retentionSum: 0,
      retentionCount: 0,
    };
    existing.videoCount += 1;
    existing.totalViews += views;
    if (duration != null && Number.isFinite(duration)) {
      existing.durationSum += duration;
      existing.durationCount += 1;
    }
    if (retention != null && Number.isFinite(retention)) {
      existing.retentionSum += retention;
      existing.retentionCount += 1;
    }
    typeMap.set(hookType, existing);
  }

  return Array.from(typeMap.entries())
    .map(([hookType, agg]) => ({
      hookType,
      displayName: HOOK_TYPE_DISPLAY[hookType as HookType] ?? hookType,
      videoCount: agg.videoCount,
      avgViews: agg.videoCount > 0 ? Math.round(agg.totalViews / agg.videoCount) : 0,
      avgViewDurationSec: agg.durationCount > 0 ? Math.round(agg.durationSum / agg.durationCount) : null,
      avgRetentionPct: agg.retentionCount > 0
        ? Number((agg.retentionSum / agg.retentionCount).toFixed(2))
        : null,
      lowConfidence: agg.videoCount < 3,
    }))
    .sort((a, b) => {
      const aR = a.avgRetentionPct ?? -1;
      const bR = b.avgRetentionPct ?? -1;
      if (bR !== aR) return bR - aR;
      return b.avgViews - a.avgViews;
    });
}
