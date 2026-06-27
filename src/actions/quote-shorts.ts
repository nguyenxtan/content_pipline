"use server";

import fs from "fs";
import path from "path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentGenerations, niches, socialChannels, uploadQueue } from "@/lib/db/schema";
import { DEFAULT_CHANNEL_KEY, getChannelPublishConfig } from "@/lib/config/channel-configs";
import { normalizeTopicFamily } from "@/lib/config/topic-family-registry";
import { buildDefaultVideoDescription, buildDefaultVideoTitle } from "@/lib/social/youtube-metadata";
import {
  type LegacyQuoteBatchManifest,
  type LegacyQuoteSampleManifest,
  getLegacyQuoteSampleRecords,
} from "@/lib/quote-shorts-assets";
import { getThresholds } from "@/lib/production-capacity";
const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh";
const VIETNAM_OFFSET_HOURS = 7;

type LegacyDestination = {
  platform: "youtube" | "facebook";
  channelId: number;
  channelName: string;
  privacyStatus: "public" | "private" | "unlisted";
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
};

export type LegacyQuoteSampleRow = LegacyQuoteSampleManifest & {
  formatType: string;
  experimentId: string;
  experimentVariant: string;
  createdAt: string | null;
  queueStatus: {
    queued: number;
    uploading: number;
    done: number;
    error: number;
    cancelled: number;
  };
  queuedPlatforms: string[];
  donePlatforms: string[];
  outputVideoExists: boolean;
  musicExists: boolean;
  contactSheetExists: boolean;
  audioStatus: "ready" | "missing";
  safeAreaStatus: "unknown";
};

export type LegacyQuoteSchedulePreviewRow = {
  contentId: string;
  topic: string;
  quoteText: string;
  topicFamily: string;
  formatType: string;
  experimentId: string;
  experimentVariant: string;
  visualMode: string;
  motionStrength: string;
  musicPath: string;
  videoPath: string;
  platform: "youtube" | "facebook";
  channelId: number;
  channelName: string;
  privacyStatus: "public" | "private" | "unlisted";
  scheduledAtUtc: string;
  scheduledAtVn: string;
  willCreate: boolean;
  reason?: string;
};

export type LegacyQuoteSchedulePreview = {
  ok: boolean;
  mode: "dry_run" | "execute";
  selectedCount: number;
  selectedContentIds: string[];
  totalEligibleCount: number;
  destinations: Array<{ platform: "youtube" | "facebook"; channelId: number; channelName: string }>;
  rows: LegacyQuoteSchedulePreviewRow[];
  insertableRows: number;
  skippedRows: number;
  pendingBefore: number;
  pendingAfter: number;
  pendingThreshold: number;
  thresholdExceeded: boolean;
  message?: string;
};

function parseTimeString(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}

function toVietnamParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number.parseInt(map.year, 10),
    month: Number.parseInt(map.month, 10),
    day: Number.parseInt(map.day, 10),
    hour: Number.parseInt(map.hour, 10),
    minute: Number.parseInt(map.minute, 10),
  };
}

function fromVietnamLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - VIETNAM_OFFSET_HOURS, minute, 0, 0));
}

function formatVietnam(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function nextWindowStart(date: Date, windowStart: string): Date {
  const local = toVietnamParts(date);
  const startMin = parseTimeString(windowStart);
  const startHour = Math.floor(startMin / 60);
  const startMinute = startMin % 60;
  return fromVietnamLocal(local.year, local.month, local.day + 1, startHour, startMinute);
}

function alignToScheduleWindow(date: Date, windowStart: string, windowEnd: string): Date {
  const local = toVietnamParts(date);
  const minuteOfDay = local.hour * 60 + local.minute;
  const startMin = parseTimeString(windowStart);
  const endMin = parseTimeString(windowEnd);

  if (minuteOfDay < startMin) {
    return fromVietnamLocal(local.year, local.month, local.day, Math.floor(startMin / 60), startMin % 60);
  }

  if (minuteOfDay > endMin) {
    return nextWindowStart(date, windowStart);
  }

  return date;
}

function getCommonWindow(destinations: LegacyDestination[]): { windowStart: string; windowEnd: string; intervalMin: number } {
  const start = Math.max(...destinations.map((destination) => parseTimeString(destination.windowStart)));
  const end = Math.min(...destinations.map((destination) => parseTimeString(destination.windowEnd)));
  if (start > end) {
    throw new Error("Không có khung giờ đăng chồng lấp giữa các destination đang hoạt động.");
  }
  return {
    windowStart: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
    windowEnd: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
    intervalMin: Math.max(...destinations.map((destination) => destination.intervalMin || 60)),
  };
}

async function getLegacyDestinations(platforms?: Array<"youtube" | "facebook">): Promise<LegacyDestination[]> {
  const config = await getChannelPublishConfig(DEFAULT_CHANNEL_KEY);
  if (!config) {
    throw new Error(`Publish config not found for ${DEFAULT_CHANNEL_KEY}.`);
  }

  const requested = new Set(platforms ?? ["youtube", "facebook"]);
  const enabledShortDestinations = config.shortDestinations.filter((destination) => destination.enabled);
  if (enabledShortDestinations.length === 0) {
    return [];
  }

  const channelIds = enabledShortDestinations.map((destination) => destination.channelId);
  const channels = await db.query.socialChannels.findMany({
    where: inArray(socialChannels.id, channelIds),
  });
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  return enabledShortDestinations.flatMap((destination) => {
    const channel = channelMap.get(destination.channelId);
    if (!channel || !channel.isActive || channel.needsReconnect) return [];
    if (channel.platform !== "youtube" && channel.platform !== "facebook") return [];
    if (!requested.has(channel.platform as "youtube" | "facebook")) return [];
    return [{
      platform: channel.platform as "youtube" | "facebook",
      channelId: channel.id,
      channelName: channel.name,
      privacyStatus: channel.platform === "facebook" ? "public" : destination.privacyStatus,
      windowStart: destination.windowStart,
      windowEnd: destination.windowEnd,
      intervalMin: destination.intervalMin,
    }];
  });
}

async function getExistingShortQueueKeys(contentIds: string[]): Promise<Set<string>> {
  if (contentIds.length === 0) return new Set();
  const rows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.contentId, contentIds),
      eq(uploadQueue.videoType, "short"),
      inArray(uploadQueue.status, ["queued", "uploading", "done"]),
    ),
    columns: {
      contentId: true,
      platform: true,
      channelId: true,
    },
  });

  return new Set(rows.map((row) => `${row.contentId}|${row.platform}|${row.channelId}`));
}

async function getPendingQueueCount(): Promise<number> {
  const rows = await db.query.uploadQueue.findMany({
    where: inArray(uploadQueue.status, ["queued", "uploading"]),
    columns: { id: true },
  });
  return rows.length;
}

async function getTakenTimesByDestination(destinations: LegacyDestination[]): Promise<Map<string, number[]>> {
  const rows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.status, ["queued", "uploading"]),
      eq(uploadQueue.videoType, "short"),
      inArray(uploadQueue.channelId, destinations.map((destination) => destination.channelId)),
    ),
    columns: {
      channelId: true,
      scheduledAt: true,
    },
  });

  const result = new Map<string, number[]>();
  for (const destination of destinations) {
    result.set(`${destination.platform}|${destination.channelId}`, []);
  }
  for (const row of rows) {
    for (const destination of destinations) {
      if (destination.channelId === row.channelId) {
        result.get(`${destination.platform}|${destination.channelId}`)?.push(new Date(row.scheduledAt).getTime());
      }
    }
  }
  return result;
}

function findSafeSlot(
  startAt: Date,
  intervalMin: number,
  windowStart: string,
  windowEnd: string,
  takenTimesByDestination: Map<string, number[]>,
  destinations: LegacyDestination[],
): Date {
  let candidate = alignToScheduleWindow(startAt, windowStart, windowEnd);
  const minDistanceMs = Math.max(30, intervalMin / 2) * 60_000;

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const adjusted = alignToScheduleWindow(candidate, windowStart, windowEnd);
    const hasConflict = destinations.some((destination) => {
      const key = `${destination.platform}|${destination.channelId}`;
      const taken = takenTimesByDestination.get(key) ?? [];
      return taken.some((time) => Math.abs(time - adjusted.getTime()) < minDistanceMs);
    });

    if (!hasConflict) {
      for (const destination of destinations) {
        const key = `${destination.platform}|${destination.channelId}`;
        const taken = takenTimesByDestination.get(key) ?? [];
        taken.push(adjusted.getTime());
        takenTimesByDestination.set(key, taken);
      }
      return adjusted;
    }

    candidate = new Date(adjusted.getTime() + intervalMin * 60_000);
  }

  throw new Error("Không tìm được slot an toàn cho Quote Shorts trong khung giờ hiện tại.");
}

async function ensureLegacyContentRows(samples: LegacyQuoteSampleManifest[], manifest: LegacyQuoteBatchManifest): Promise<void> {
  const ids = samples.map((sample) => sample.contentId);
  if (ids.length === 0) return;

  const existing = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, ids),
    columns: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));

  const missing = samples.filter((sample) => !existingIds.has(sample.contentId));
  if (missing.length === 0) return;

  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.channelKey, DEFAULT_CHANNEL_KEY), eq(niches.isActive, true)),
    columns: {
      id: true,
      name: true,
      contentProfileKey: true,
      channelKey: true,
    },
  });

  if (!niche) {
    throw new Error(`Không tìm thấy niche active cho channel ${DEFAULT_CHANNEL_KEY}.`);
  }

  await db.insert(contentGenerations).values(
    missing.map((sample) => ({
      id: sample.contentId,
      topic: sample.topic,
      nicheId: niche.id,
      nicheName: niche.name,
      contentProfileKey: niche.contentProfileKey ?? "buddhism",
      channelKey: niche.channelKey ?? DEFAULT_CHANNEL_KEY,
      script: sample.quoteText,
      shortContent: sample.quoteText,
      shortSelectedHook: sample.quoteText,
      longContent: sample.quoteText,
      experimentId: manifest.experimentId,
      experimentVariant: manifest.experimentVariant,
      thumbnailText: sample.quoteText,
      status: "completed",
      ttsStatus: "done",
      imagesStatus: "done",
      videoStatus: "done",
      videoPath: path.relative(process.cwd(), sample.outputVideoPath),
      contentMode: "short",
      formatType: "legacy_quote_short",
      topicFamily: normalizeTopicFamily(sample.topicFamily),
    })),
  );
}

async function buildLegacyPreview(input: {
  selectedContentIds?: string[];
  startAtIso: string;
  intervalMin?: number;
  maxItems?: number;
  platforms?: Array<"youtube" | "facebook">;
}): Promise<LegacyQuoteSchedulePreview> {
  const sampleRecords = getLegacyQuoteSampleRecords();
  const manifest = sampleRecords.manifest;
  const destinations = await getLegacyDestinations(input.platforms);
  if (destinations.length === 0) {
    return {
      ok: false,
      mode: "dry_run",
      selectedCount: 0,
      selectedContentIds: [],
      totalEligibleCount: 0,
      destinations: [],
      rows: [],
      insertableRows: 0,
      skippedRows: 0,
      pendingBefore: await getPendingQueueCount(),
      pendingAfter: await getPendingQueueCount(),
      pendingThreshold: getThresholds().maxPendingUploadQueue,
      thresholdExceeded: false,
      message: "Không có destination short nào đang hoạt động cho Quote Shorts.",
    };
  }

  const queueRows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.contentId, sampleRecords.samples.map((sample) => sample.contentId)),
      eq(uploadQueue.videoType, "short"),
    ),
    columns: {
      contentId: true,
      status: true,
      platform: true,
    },
  });
  const queueByContentId = new Map<string, Array<{ status: string; platform: string }>>();
  for (const row of queueRows) {
    const list = queueByContentId.get(row.contentId) ?? [];
    list.push(row);
    queueByContentId.set(row.contentId, list);
  }

  const TANG_SAU_VISUAL_BLACKLIST = [
    "buddha", "temple", "monk", "prayer", "praying", "lotus", "buddhist",
    "spiritual", "meditation pose", "old temple", "chắp tay",
  ];

  const eligibleSamples = sampleRecords.samples.filter((sample) => {
    const rows = queueByContentId.get(sample.contentId) ?? [];
    if (rows.some((row) => row.status === "queued" || row.status === "uploading" || row.status === "done")) return false;
    // Block Tầng Sâu sidecars that contain pre-hotfix Buddhist visual keywords
    if (sample.workspaceId === "tang_sau_workspace" || sample.channelProfileId === "tang_sau_v1") {
      const kws = (sample.visualSearchKeywords ?? []).join(" ").toLowerCase();
      if (TANG_SAU_VISUAL_BLACKLIST.some((term) => kws.includes(term))) {
        console.warn(`[tang_sau_visual_mismatch] excluded from schedule: ${sample.contentId} — blacklist hit in visualSearchKeywords`);
        return false;
      }
    }
    return true;
  });

  const requestedSelectedIds = (input.selectedContentIds ?? []).filter(Boolean);
  const usingManualSelection = requestedSelectedIds.length > 0;
  const maxItems = Math.max(1, input.maxItems ?? eligibleSamples.length ?? 1);
  const selectedSamples = usingManualSelection
    ? requestedSelectedIds
        .map((id) => sampleRecords.samples.find((sample) => sample.contentId === id))
        .filter((sample): sample is LegacyQuoteSampleManifest => Boolean(sample))
    : eligibleSamples.slice(0, maxItems);
  const selectedIds = selectedSamples.map((sample) => sample.contentId);

  if (selectedSamples.length === 0) {
    const pendingBefore = await getPendingQueueCount();
    return {
      ok: false,
      mode: "dry_run",
      selectedCount: 0,
      selectedContentIds: [],
      totalEligibleCount: eligibleSamples.length,
      destinations: destinations.map((destination) => ({
        platform: destination.platform,
        channelId: destination.channelId,
        channelName: destination.channelName,
      })),
      rows: [],
      insertableRows: 0,
      skippedRows: 0,
      pendingBefore,
      pendingAfter: pendingBefore,
      pendingThreshold: getThresholds().maxPendingUploadQueue,
      thresholdExceeded: false,
      message: usingManualSelection
        ? "Nhóm Quote Shorts được chọn không hợp lệ hoặc đã có queue/published."
        : "Không còn Quote Short nào đủ điều kiện để lên lịch tự động.",
    };
  }

  const startAt = new Date(input.startAtIso);
  if (Number.isNaN(startAt.getTime())) {
    const pendingBefore = await getPendingQueueCount();
    return {
      ok: false,
      mode: "dry_run",
      selectedCount: selectedSamples.length,
      selectedContentIds: selectedIds,
      totalEligibleCount: eligibleSamples.length,
      destinations: destinations.map((destination) => ({
        platform: destination.platform,
        channelId: destination.channelId,
        channelName: destination.channelName,
      })),
      rows: [],
      insertableRows: 0,
      skippedRows: 0,
      pendingBefore,
      pendingAfter: pendingBefore,
      pendingThreshold: getThresholds().maxPendingUploadQueue,
      thresholdExceeded: false,
      message: "Thời gian bắt đầu không hợp lệ.",
    };
  }
  if (startAt.getTime() <= Date.now()) {
    const pendingBefore = await getPendingQueueCount();
    return {
      ok: false,
      mode: "dry_run",
      selectedCount: selectedSamples.length,
      selectedContentIds: selectedIds,
      totalEligibleCount: eligibleSamples.length,
      destinations: destinations.map((destination) => ({
        platform: destination.platform,
        channelId: destination.channelId,
        channelName: destination.channelName,
      })),
      rows: [],
      insertableRows: 0,
      skippedRows: 0,
      pendingBefore,
      pendingAfter: pendingBefore,
      pendingThreshold: getThresholds().maxPendingUploadQueue,
      thresholdExceeded: false,
      message: "scheduledAt phải nằm trong tương lai.",
    };
  }

  const commonWindow = getCommonWindow(destinations);
  const intervalMin = Math.max(60, input.intervalMin ?? commonWindow.intervalMin ?? 60);
  const takenTimesByDestination = await getTakenTimesByDestination(destinations);
  const existingKeys = await getExistingShortQueueKeys(selectedIds);
  const rows: LegacyQuoteSchedulePreviewRow[] = [];
  const pendingBefore = await getPendingQueueCount();

  let anchor = startAt;
  for (const sample of selectedSamples) {
    const slot = findSafeSlot(anchor, intervalMin, commonWindow.windowStart, commonWindow.windowEnd, takenTimesByDestination, destinations);
    for (const destination of destinations) {
      const key = `${sample.contentId}|${destination.platform}|${destination.channelId}`;
      const willCreate = !existingKeys.has(key);
      rows.push({
        contentId: sample.contentId,
        topic: sample.topic,
        quoteText: sample.quoteText,
        topicFamily: sample.topicFamily,
        formatType: manifest.formatType,
        experimentId: manifest.experimentId,
        experimentVariant: manifest.experimentVariant,
        visualMode: sample.visualMode,
        motionStrength: sample.motionStrength,
        musicPath: sample.musicPath,
        videoPath: sample.outputVideoPath,
        platform: destination.platform,
        channelId: destination.channelId,
        channelName: destination.channelName,
        privacyStatus: destination.privacyStatus,
        scheduledAtUtc: slot.toISOString(),
        scheduledAtVn: formatVietnam(slot),
        willCreate,
        reason: willCreate ? undefined : "duplicate_queue_or_published",
      });
    }
    anchor = new Date(slot.getTime() + intervalMin * 60_000);
  }

  return {
    ok: true,
    mode: "dry_run",
    selectedCount: selectedSamples.length,
    selectedContentIds: selectedIds,
    totalEligibleCount: eligibleSamples.length,
    destinations: destinations.map((destination) => ({
      platform: destination.platform,
      channelId: destination.channelId,
      channelName: destination.channelName,
    })),
    rows,
    insertableRows: rows.filter((row) => row.willCreate).length,
    skippedRows: rows.filter((row) => !row.willCreate).length,
    pendingBefore,
    pendingAfter: pendingBefore + rows.filter((row) => row.willCreate).length,
    pendingThreshold: getThresholds().maxPendingUploadQueue,
    thresholdExceeded: pendingBefore + rows.filter((row) => row.willCreate).length > getThresholds().maxPendingUploadQueue,
  };
}

export async function getLegacyQuoteSamplesAction(): Promise<{
  source: "json_manifest";
  generatedAt: string;
  formatType: string;
  experimentId: string;
  experimentVariant: string;
  samples: LegacyQuoteSampleRow[];
}> {
  const sampleRecords = getLegacyQuoteSampleRecords();
  const ids = sampleRecords.samples.map((sample) => sample.contentId);
  const [contentRows, queueRows] = await Promise.all([
    ids.length
      ? db.query.contentGenerations.findMany({
          where: inArray(contentGenerations.id, ids),
          columns: {
            id: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    ids.length
      ? db.query.uploadQueue.findMany({
          where: inArray(uploadQueue.contentId, ids),
          columns: {
            contentId: true,
            status: true,
            platform: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const contentMap = new Map(contentRows.map((row) => [row.id, row]));
  const queueMap = new Map<string, LegacyQuoteSampleRow["queueStatus"]>();
  const queuedPlatformsMap = new Map<string, Set<string>>();
  const donePlatformsMap = new Map<string, Set<string>>();

  for (const row of queueRows) {
    const current = queueMap.get(row.contentId) ?? {
      queued: 0,
      uploading: 0,
      done: 0,
      error: 0,
      cancelled: 0,
    };
    if (row.status in current) {
      current[row.status as keyof typeof current] += 1;
    }
    queueMap.set(row.contentId, current);
    if (row.status === "queued" || row.status === "uploading") {
      const set = queuedPlatformsMap.get(row.contentId) ?? new Set<string>();
      set.add(row.platform);
      queuedPlatformsMap.set(row.contentId, set);
    }
    if (row.status === "done") {
      const set = donePlatformsMap.get(row.contentId) ?? new Set<string>();
      set.add(row.platform);
      donePlatformsMap.set(row.contentId, set);
    }
  }

  return {
    source: "json_manifest",
    generatedAt: sampleRecords.manifest.generatedAt,
    formatType: sampleRecords.manifest.formatType,
    experimentId: sampleRecords.manifest.experimentId,
    experimentVariant: sampleRecords.manifest.experimentVariant,
    samples: sampleRecords.samples.map((sample) => ({
      ...sample,
      formatType: sampleRecords.manifest.formatType,
      experimentId: sampleRecords.manifest.experimentId,
      experimentVariant: sampleRecords.manifest.experimentVariant,
      createdAt: contentMap.get(sample.contentId)?.createdAt?.toISOString() ?? null,
      queueStatus: queueMap.get(sample.contentId) ?? {
        queued: 0,
        uploading: 0,
        done: 0,
        error: 0,
        cancelled: 0,
      },
      queuedPlatforms: [...(queuedPlatformsMap.get(sample.contentId) ?? new Set<string>())],
      donePlatforms: [...(donePlatformsMap.get(sample.contentId) ?? new Set<string>())],
      outputVideoExists: fs.existsSync(sample.outputVideoPath),
      musicExists: fs.existsSync(path.isAbsolute(sample.musicPath) ? sample.musicPath : path.join(process.cwd(), sample.musicPath)),
      contactSheetExists: !!sample.contactSheet && fs.existsSync(sample.contactSheet),
      audioStatus: fs.existsSync(path.isAbsolute(sample.musicPath) ? sample.musicPath : path.join(process.cwd(), sample.musicPath)) ? "ready" : "missing",
      safeAreaStatus: "unknown",
    })),
  };
}

export async function previewLegacyQuoteScheduleAction(input: {
  selectedContentIds?: string[];
  startAtIso: string;
  intervalMin?: number;
  maxItems?: number;
  platforms?: Array<"youtube" | "facebook">;
}): Promise<LegacyQuoteSchedulePreview> {
  return buildLegacyPreview(input);
}

export async function executeLegacyQuoteScheduleAction(input: {
  selectedContentIds?: string[];
  startAtIso: string;
  intervalMin?: number;
  maxItems?: number;
  platforms?: Array<"youtube" | "facebook">;
}): Promise<LegacyQuoteSchedulePreview & { createdQueueIds: string[] }> {
  const preview = await buildLegacyPreview(input);
  if (!preview.ok) {
    return {
      ...preview,
      mode: "execute",
      createdQueueIds: [],
    };
  }

  // Re-check queue depth immediately before inserting — another process may have
  // added rows since the preview was computed.
  const livePendingCount = await getPendingQueueCount();
  const maxPending = getThresholds().maxPendingUploadQueue;
  if (livePendingCount + preview.insertableRows > maxPending) {
    return {
      ...preview,
      ok: false,
      mode: "execute",
      pendingBefore: livePendingCount,
      pendingAfter: livePendingCount + preview.insertableRows,
      thresholdExceeded: true,
      createdQueueIds: [],
      message: `Queue đang có ${livePendingCount} item đang chờ. Thêm ${preview.insertableRows} row sẽ vượt ngưỡng ${maxPending}. Hãy chờ cron xử lý bớt hàng chờ trước.`,
    };
  }

  const sampleRecords = getLegacyQuoteSampleRecords();
  const manifest = sampleRecords.manifest;
  const selectedIds = new Set(preview.selectedContentIds);
  const selectedSamples = sampleRecords.samples.filter((sample) => selectedIds.has(sample.contentId));
  await ensureLegacyContentRows(selectedSamples, manifest);

  const contentRows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, [...selectedIds]),
    columns: {
      id: true,
      topic: true,
      nicheName: true,
      shortContent: true,
      longContent: true,
      longYoutubeDescription: true,
      contentProfileKey: true,
    },
  });
  const contentMap = new Map(contentRows.map((row) => [row.id, row]));
  const existingKeys = await getExistingShortQueueKeys([...selectedIds]);
  const createdQueueIds: string[] = [];

  for (const row of preview.rows) {
    if (!row.willCreate) continue;
    const dedupeKey = `${row.contentId}|${row.platform}|${row.channelId}`;
    if (existingKeys.has(dedupeKey)) continue;
    const content = contentMap.get(row.contentId);
    if (!content) continue;

    const [inserted] = await db.insert(uploadQueue).values({
      contentId: row.contentId,
      channelId: row.channelId,
      platform: row.platform,
      videoType: "short",
      title: buildDefaultVideoTitle({
        platform: row.platform,
        contentType: "short",
        topic: content.topic,
        contentProfileKey: content.contentProfileKey,
        shortContent: content.shortContent,
      }),
      description: buildDefaultVideoDescription({
        platform: row.platform,
        contentType: "short",
        topic: content.topic,
        nicheName: content.nicheName,
        shortContent: content.shortContent,
        longContent: content.longContent,
        longYoutubeDescription: content.longYoutubeDescription,
        contentProfileKey: content.contentProfileKey,
      }),
      tags: [],
      privacyStatus: row.platform === "facebook" ? "public" : row.privacyStatus,
      scheduledAt: new Date(row.scheduledAtUtc),
      status: "queued",
    }).returning({ id: uploadQueue.id });

    createdQueueIds.push(inserted.id);
    existingKeys.add(dedupeKey);
  }

  return {
    ...preview,
    mode: "execute",
    insertableRows: createdQueueIds.length,
    skippedRows: preview.rows.length - createdQueueIds.length,
    pendingAfter: preview.pendingBefore + createdQueueIds.length,
    thresholdExceeded: preview.pendingBefore + createdQueueIds.length > getThresholds().maxPendingUploadQueue,
    createdQueueIds,
  };
}
