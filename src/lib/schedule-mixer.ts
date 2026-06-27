/**
 * Schedule Mixer — blends TTS Shorts and Legacy Quote Shorts into a single
 * alternating or ratio-based publish schedule.
 *
 * No uploads, no cron calls. Only builds proposed upload_queue rows.
 */

import fs from "fs";
import path from "path";
import { and, eq, gte, inArray, isNull, notInArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contentGenerations,
  niches,
  socialChannels,
  uploadQueue,
} from "@/lib/db/schema";
import { DEFAULT_CHANNEL_KEY, getChannelPublishConfig } from "@/lib/config/channel-configs";
import { inferStrategicTopicFamily } from "@/lib/config/topic-family-registry";
import { buildDefaultVideoTitle, buildDefaultVideoDescription } from "@/lib/social/youtube-metadata";
import { getLegacyQuoteSampleRecords } from "@/lib/quote-shorts-assets";
import { getThresholds } from "@/lib/production-capacity";
import { getWorkspaceById, getWorkspaceByProfileId } from "@/lib/channel-workspace-registry";

// ── Constants ─────────────────────────────────────────────────────────────

const VN_TZ = "Asia/Ho_Chi_Minh";
const VN_OFFSET_H = 7;
const LEGACY_QUOTE_EXPERIMENT = "LEGACY_QUOTE_SHORT";

// ── Public types ──────────────────────────────────────────────────────────

export type MixMode = "alternate" | "ratio";
export type ContentFormat = "tts_short" | "legacy_quote_short";

export type MixerOptions = {
  startAtIso: string;
  intervalMin: number;
  maxSlots: number;
  platforms?: Array<"youtube" | "facebook">;
  mixMode: MixMode;
  ttsWeight?: number;
  quoteWeight?: number;
  /**
   * When set, destinations are resolved from the workspace's platformAccounts
   * (via platform_channel_id) instead of the default channel publish config.
   * Prevents cross-channel scheduling mistakes.
   */
  workspaceId?: string;
};

export type MixerSlot = {
  contentId: string;
  topic: string;
  displayLabel: string;
  formatType: ContentFormat;
  platform: "youtube" | "facebook";
  channelId: number;
  channelName: string;
  privacyStatus: "public" | "unlisted" | "private";
  scheduledAtUtc: string;
  scheduledAtVn: string;
  willCreate: boolean;
  reason?: string;
  warnings?: string[];
};

export type MixerPreviewResult = {
  ok: boolean;
  mode: "dry_run" | "execute";
  slots: MixerSlot[];
  insertableCount: number;
  skippedCount: number;
  ttsCount: number;
  quoteCount: number;
  pendingBefore: number;
  pendingAfter: number;
  pendingThreshold: number;
  thresholdExceeded: boolean;
  hardBlockReasons?: string[];
  warningCounts?: Record<string, number>;
  balanceWarnings?: string[];
  pendingBreakdown?: {
    youtubePending: number;
    facebookPending: number;
    facebookQuotePending: number;
    facebookShortPending: number;
    maxPending: number;
    headroomBefore: number;
    headroomAfter: number;
  };
  /** Set when a workspace is selected but has no active credential for a requested platform. */
  workspaceDestinationWarning?: string;
  message?: string;
};

// ── Internal types ────────────────────────────────────────────────────────

type MixerDestination = {
  platform: "youtube" | "facebook";
  channelId: number;
  channelName: string;
  privacyStatus: "public" | "unlisted" | "private";
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  /**
   * Physical channel ID on the platform (same as social_channels.platform_channel_id).
   * When present, getTakenTimesByDest will include sibling OAuth credential rows in
   * the taken-times calculation to prevent duplicate slots across backup credentials.
   */
  platformChannelId?: string;
};

type EligibleItem = {
  contentId: string;
  topic: string;
  formatType: ContentFormat;
  quoteText: string;
  workspaceId?: string;
  channelProfileId?: string;
  channelName?: string;
  // For building upload_queue title/description (populated from DB at execute time):
  nicheName: string;
  shortContent: string;
  longContent: string;
  longYoutubeDescription: string | null;
  contentProfileKey: string;
  channelKey: string;
};

type ExistingState = "queued" | "uploading" | "done";
type QuoteEligibilityResult = {
  items: EligibleItem[];
  warningCounts: Record<string, number>;
};

// ── Slot-math helpers (Vietnam timezone) ──────────────────────────────────

function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toVnParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute,
  };
}

function fromVnLocal(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - VN_OFFSET_H, mi, 0, 0));
}

function formatVn(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TZ, dateStyle: "short", timeStyle: "short",
  }).format(date);
}

function alignToWindow(date: Date, windowStart: string, windowEnd: string): Date {
  const vn = toVnParts(date);
  const now = vn.hour * 60 + vn.minute;
  const start = parseMinutes(windowStart);
  const end = parseMinutes(windowEnd);
  if (now < start) {
    return fromVnLocal(vn.year, vn.month, vn.day, Math.floor(start / 60), start % 60);
  }
  if (now > end) {
    const next = toVnParts(new Date(date.getTime() + 86_400_000));
    return fromVnLocal(next.year, next.month, next.day, Math.floor(start / 60), start % 60);
  }
  return date;
}

function getCommonWindow(dests: MixerDestination[]) {
  const start = Math.max(...dests.map((d) => parseMinutes(d.windowStart)));
  const end = Math.min(...dests.map((d) => parseMinutes(d.windowEnd)));
  if (start > end) throw new Error("Không có khung giờ chồng lấp giữa các destination.");
  const intervalMin = Math.max(...dests.map((d) => d.intervalMin));
  const pad = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  return { windowStart: pad(start), windowEnd: pad(end), intervalMin };
}

function findSafeSlot(
  anchor: Date,
  intervalMin: number,
  windowStart: string,
  windowEnd: string,
  takenMs: Map<string, number[]>,
  dests: MixerDestination[],
): Date {
  let candidate = alignToWindow(anchor, windowStart, windowEnd);
  const minGap = Math.max(30, intervalMin / 2) * 60_000;

  for (let attempt = 0; attempt < 200; attempt++) {
    const aligned = alignToWindow(candidate, windowStart, windowEnd);
    const conflict = dests.some((d) => {
      const key = `${d.platform}|${d.channelId}`;
      return (takenMs.get(key) ?? []).some((t) => Math.abs(t - aligned.getTime()) < minGap);
    });
    if (!conflict) {
      for (const d of dests) {
        const key = `${d.platform}|${d.channelId}`;
        takenMs.set(key, [...(takenMs.get(key) ?? []), aligned.getTime()]);
      }
      return aligned;
    }
    candidate = new Date(aligned.getTime() + intervalMin * 60_000);
  }
  throw new Error("Không tìm được slot an toàn trong khung giờ.");
}

// ── Content eligibility queries ───────────────────────────────────────────

async function getEligibleTtsItems(workspaceId?: string): Promise<EligibleItem[]> {
  const workspace = workspaceId ? getWorkspaceById(workspaceId) : null;
  const ttsEnabled = workspace ? workspace.defaultFormats.tts_short !== false : true;
  if (!ttsEnabled) return [];

  const rows = await db.query.contentGenerations.findMany({
    where: and(
      eq(contentGenerations.videoStatus, "done"),
      inArray(contentGenerations.contentMode, ["short", "both"]),
      isNull(contentGenerations.mediaCleanedAt),
      or(
        eq(contentGenerations.formatType, "tts_short"),
        and(
          isNull(contentGenerations.formatType),
          // exclude rows identified as legacy quote by experimentId
          or(
            isNull(contentGenerations.experimentId),
            notInArray(contentGenerations.experimentId, [LEGACY_QUOTE_EXPERIMENT]),
          ),
        ),
      ),
    ),
    columns: {
      id: true, topic: true, nicheName: true, contentProfileKey: true,
      channelKey: true, shortContent: true, longContent: true,
      longYoutubeDescription: true, videoPath: true,
    },
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 200,
  });

  return rows
    .filter((r) => {
      if (!workspace) return true;
      return r.channelKey === workspace.channelKey;
    })
    .filter((r) => {
      if (!r.videoPath) return false;
      const abs = path.isAbsolute(r.videoPath)
        ? r.videoPath
        : path.join(process.cwd(), r.videoPath);
      return fs.existsSync(abs);
    })
    .map((r) => ({
      contentId: r.id,
      topic: r.topic,
      formatType: "tts_short" as const,
      quoteText: r.shortContent ?? r.topic,
      workspaceId: workspace?.workspaceId,
      channelName: workspace?.displayName,
      nicheName: r.nicheName,
      shortContent: r.shortContent ?? "",
      longContent: r.longContent ?? "",
      longYoutubeDescription: r.longYoutubeDescription ?? null,
      contentProfileKey: r.contentProfileKey ?? "buddhism",
      channelKey: r.channelKey ?? DEFAULT_CHANNEL_KEY,
    }));
}

function inferQuoteWorkspace(sample: {
  workspaceId?: string;
  channelProfileId?: string;
  topicFamily?: string;
}) {
  if (sample.workspaceId) {
    return getWorkspaceById(sample.workspaceId);
  }
  if (sample.channelProfileId) {
    return getWorkspaceByProfileId(sample.channelProfileId);
  }
  // Safe default for old legacy sidecars created before workspace/profile tagging.
  return getWorkspaceById("buddhist_healing_workspace");
}

async function getEligibleQuoteItems(workspaceId?: string): Promise<QuoteEligibilityResult> {
  const records = getLegacyQuoteSampleRecords();
  const workspace = workspaceId ? getWorkspaceById(workspaceId) : null;
  const nicheRows = await db.query.niches.findMany({
    where: eq(niches.isActive, true),
    columns: { name: true, contentProfileKey: true, channelKey: true },
  });
  const nicheByChannelKey = new Map(nicheRows.map((row) => [row.channelKey, row]));
  const dbRows = records.samples.length === 0
    ? []
    : await db.query.contentGenerations.findMany({
        where: inArray(contentGenerations.id, records.samples.map((sample) => sample.contentId)),
        columns: {
          id: true,
          channelKey: true,
          contentProfileKey: true,
          formatType: true,
        },
      });
  const dbMetaById = new Map(dbRows.map((row) => [row.id, row]));
  const warningCounts: Record<string, number> = {};
  const items: EligibleItem[] = [];

  for (const sample of records.samples) {
    if (!fs.existsSync(sample.outputVideoPath)) continue;

    const inferredWorkspace = inferQuoteWorkspace(sample);
    const dbMeta = dbMetaById.get(sample.contentId);
    const hasTaggedWorkspace = Boolean(sample.workspaceId);
    const hasTaggedProfile = Boolean(sample.channelProfileId);
    const matchesDbTangSau =
      dbMeta?.channelKey === "tang_sau" &&
      dbMeta?.formatType === "legacy_quote_short" &&
      dbMeta?.contentProfileKey === "philosophy";

    if (workspace?.workspaceId === "tang_sau_workspace") {
      const strongSourceOk = sample.workspaceId === "tang_sau_workspace" || matchesDbTangSau;
      if (!strongSourceOk) {
        warningCounts.untagged_quote_excluded = (warningCounts.untagged_quote_excluded ?? 0) + 1;
        continue;
      }
      if (sample.workspaceId && sample.workspaceId !== "tang_sau_workspace") {
        warningCounts.workspace_profile_mismatch = (warningCounts.workspace_profile_mismatch ?? 0) + 1;
        continue;
      }
      if (sample.channelProfileId && sample.channelProfileId !== "tang_sau_v1") {
        warningCounts.workspace_profile_mismatch = (warningCounts.workspace_profile_mismatch ?? 0) + 1;
        continue;
      }
      const text = `${sample.topic} ${sample.quoteText}`.toLowerCase();
      if (/(phật|phat|phật pháp|nhân quả|nghiệp|chánh niệm|từ bi|phước|quý vị)/i.test(text)) {
        warningCounts.tang_sau_topic_mismatch = (warningCounts.tang_sau_topic_mismatch ?? 0) + 1;
        continue;
      }
    } else if (workspace && inferredWorkspace?.workspaceId !== workspace.workspaceId) {
      continue;
    }

    const sampleWorkspace =
      workspace?.workspaceId === "tang_sau_workspace"
        ? (getWorkspaceById("tang_sau_workspace") ?? inferredWorkspace)
        : inferredWorkspace;
    const niche = nicheByChannelKey.get(
      (workspace?.workspaceId === "tang_sau_workspace" && matchesDbTangSau)
        ? "tang_sau"
        : (sampleWorkspace?.channelKey ?? dbMeta?.channelKey ?? DEFAULT_CHANNEL_KEY),
    );

    if (workspace?.workspaceId === "tang_sau_workspace" && (!hasTaggedWorkspace || !hasTaggedProfile)) {
      warningCounts.untagged_quote_excluded = warningCounts.untagged_quote_excluded ?? 0;
    }

    items.push({
      contentId: sample.contentId,
      topic: sample.topic,
      formatType: "legacy_quote_short" as const,
      quoteText: sample.quoteText,
      workspaceId: sampleWorkspace?.workspaceId,
      channelProfileId: sample.channelProfileId ?? sampleWorkspace?.promptProfileId,
      channelName: sample.channelName ?? sampleWorkspace?.displayName,
      nicheName: niche?.name ?? "",
      shortContent: sample.quoteText,
      longContent: sample.quoteText,
      longYoutubeDescription: null,
      contentProfileKey: niche?.contentProfileKey ?? (matchesDbTangSau ? "philosophy" : "buddhism"),
      channelKey: niche?.channelKey ?? dbMeta?.channelKey ?? DEFAULT_CHANNEL_KEY,
    });
  }

  return { items, warningCounts };
}

async function getPendingQueueCount(): Promise<number> {
  const rows = await db
    .select({ contentId: uploadQueue.contentId })
    .from(uploadQueue)
    .where(inArray(uploadQueue.status, ["queued", "uploading"]));
  return rows.length;
}

async function getTakenTimesByDest(
  dests: MixerDestination[],
): Promise<Map<string, number[]>> {
  // Step 1: build sibling channel ID → dest key mapping so that slots queued
  // on backup OAuth credentials are visible to the canonical dest's slot check.
  // Example: tang_sau has ch7 (env OAuth) and ch10 (GCP3) for the same YouTube
  // channel. If the mixer resolved to ch10, ch7's existing slots are still
  // "taken" and must block new slot choices.
  const siblingToDestKey = new Map<number, string>(); // siblingChannelId → dest map key
  const destsWithPlatformChannelId = dests.filter((d) => d.platformChannelId);

  if (destsWithPlatformChannelId.length > 0) {
    const siblingRows = await db.query.socialChannels.findMany({
      where: and(
        inArray(
          socialChannels.platformChannelId,
          destsWithPlatformChannelId.map((d) => d.platformChannelId!),
        ),
        inArray(
          socialChannels.platform,
          destsWithPlatformChannelId.map((d) => d.platform) as string[],
        ),
      ),
      columns: { id: true, platform: true, platformChannelId: true },
    });
    for (const sibling of siblingRows) {
      const dest = destsWithPlatformChannelId.find(
        (d) => d.platform === sibling.platform && d.platformChannelId === sibling.platformChannelId,
      );
      if (dest) {
        siblingToDestKey.set(sibling.id, `${dest.platform}|${dest.channelId}`);
      }
    }
  }

  // Step 2: query own + sibling channel IDs in one pass
  const allChannelIds = [
    ...dests.map((d) => d.channelId),
    ...[...siblingToDestKey.keys()].filter((id) => !dests.some((d) => d.channelId === id)),
  ];

  // Include 'done' so recently-published slots aren't re-used when rescheduling.
  // Scope to last 24 h to avoid loading all historical rows — past-done slots
  // before that window can't conflict with future candidates anyway.
  const takenSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.status, ["queued", "uploading", "done"]),
      eq(uploadQueue.videoType, "short"),
      inArray(uploadQueue.channelId, allChannelIds),
      gte(uploadQueue.scheduledAt, takenSince),
    ),
    columns: { channelId: true, scheduledAt: true, platform: true },
  });

  const map = new Map<string, number[]>();
  for (const d of dests) map.set(`${d.platform}|${d.channelId}`, []);

  for (const row of rows) {
    const ts = new Date(row.scheduledAt).getTime();
    // Own dest?
    for (const d of dests) {
      if (d.channelId === row.channelId) {
        map.get(`${d.platform}|${d.channelId}`)!.push(ts);
      }
    }
    // Sibling? Map its slot to the canonical dest's key.
    const siblingDestKey = siblingToDestKey.get(row.channelId);
    if (siblingDestKey && map.has(siblingDestKey) && !dests.some((d) => d.channelId === row.channelId)) {
      map.get(siblingDestKey)!.push(ts);
    }
  }

  return map;
}

async function getExistingQueueKeyStates(contentIds: string[]): Promise<Map<string, ExistingState>> {
  if (contentIds.length === 0) return new Map();
  const rows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.contentId, contentIds),
      eq(uploadQueue.videoType, "short"),
      inArray(uploadQueue.status, ["queued", "uploading", "done", "cancelled"]),
    ),
    columns: { contentId: true, platform: true, channelId: true, status: true },
  });
  const map = new Map<string, ExistingState>();
  for (const row of rows) {
    map.set(`${row.contentId}|${row.platform}|${row.channelId}`, row.status as ExistingState);
  }
  return map;
}

async function getUpcomingDuplicateSignals(
  dests: MixerDestination[],
): Promise<Map<string, string[]>> {
  if (dests.length === 0) return new Map();
  const rows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.channelId, dests.map((dest) => dest.channelId)),
      eq(uploadQueue.videoType, "short"),
      inArray(uploadQueue.status, ["queued", "uploading"]),
    ),
    with: {
      content: {
        columns: {
          topic: true,
          shortContent: true,
        },
      },
    },
    columns: {
      channelId: true,
      platform: true,
      title: true,
    },
  });
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const key = `${row.platform}|${row.channelId}`;
    const current = map.get(key) ?? [];
    current.push(row.content.shortContent || row.content.topic || row.title);
    map.set(key, current);
  }
  return map;
}

function normalizeSimilarityText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateText(a: string, b: string): boolean {
  const left = normalizeSimilarityText(a);
  const right = normalizeSimilarityText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 12 && right.length >= 12 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size < 3 || rightTokens.size < 3) return false;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }
  const ratio = overlap / Math.max(leftTokens.size, rightTokens.size);
  return ratio >= 0.8;
}

function countWarningCodes(slots: MixerSlot[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of slots) {
    for (const code of slot.warnings ?? []) {
      counts[code] = (counts[code] ?? 0) + 1;
    }
    if (slot.reason) {
      counts[slot.reason] = (counts[slot.reason] ?? 0) + 1;
    }
  }
  return counts;
}

function mergeCountMaps(...maps: Array<Record<string, number> | undefined>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

async function getPendingPlatformBreakdown() {
  const rows = await db
    .select({
      platform: uploadQueue.platform,
      videoType: uploadQueue.videoType,
    })
    .from(uploadQueue)
    .where(inArray(uploadQueue.status, ["queued", "uploading"]));

  let youtubePending = 0;
  let facebookPending = 0;
  let facebookQuotePending = 0;
  let facebookShortPending = 0;

  for (const row of rows) {
    if (row.platform === "youtube") youtubePending++;
    if (row.platform === "facebook") {
      facebookPending++;
      if (row.videoType === "quote") facebookQuotePending++;
      if (row.videoType === "short") facebookShortPending++;
    }
  }

  return {
    youtubePending,
    facebookPending,
    facebookQuotePending,
    facebookShortPending,
  };
}

async function getUpcomingYouTubeGaps(
  dests: MixerDestination[],
  intervalMin: number,
): Promise<boolean> {
  const youtubeDests = dests.filter((dest) => dest.platform === "youtube");
  if (youtubeDests.length === 0) return false;

  const rows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.channelId, youtubeDests.map((dest) => dest.channelId)),
      eq(uploadQueue.platform, "youtube"),
      eq(uploadQueue.videoType, "short"),
      inArray(uploadQueue.status, ["queued", "uploading"]),
    ),
    columns: {
      channelId: true,
      scheduledAt: true,
    },
    orderBy: (t, { asc }) => [asc(t.channelId), asc(t.scheduledAt)],
  });

  const rowsByChannel = new Map<number, number[]>();
  for (const row of rows) {
    const list = rowsByChannel.get(row.channelId) ?? [];
    list.push(new Date(row.scheduledAt).getTime());
    rowsByChannel.set(row.channelId, list);
  }

  const gapThresholdMs = Math.max(intervalMin * 2, 6 * 60) * 60_000;
  for (const dest of youtubeDests) {
    const times = rowsByChannel.get(dest.channelId) ?? [];
    if (times.length === 0) return true;
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] > gapThresholdMs) {
        return true;
      }
    }
  }

  return false;
}

// ── Destinations ──────────────────────────────────────────────────────────

type DestinationResult = {
  destinations: MixerDestination[];
  /** Set when workspace is provided but has no active credential for a requested platform. */
  workspaceDestinationWarning?: string;
};

/**
 * Resolve publish destinations.
 *
 * Two code paths:
 *  A) workspaceId provided → look up workspace.platformAccounts by platform_channel_id.
 *     Never falls back to DEFAULT_CHANNEL_KEY to prevent cross-channel scheduling.
 *  B) no workspaceId → use the default channel's publish config (existing behaviour).
 */
async function getMixerDestinations(
  opts: Pick<MixerOptions, "platforms" | "workspaceId" | "intervalMin">,
): Promise<DestinationResult> {
  const requested = new Set(opts.platforms ?? (["youtube", "facebook"] as const));

  // ── Path A: workspace-scoped destinations ─────────────────────────────
  if (opts.workspaceId) {
    const workspace = getWorkspaceById(opts.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace "${opts.workspaceId}" không tồn tại.`);
    }

    // Collect platform_channel_ids the workspace has for requested platforms
    const wsPlatformChannelIds = workspace.platformAccounts
      .filter((acc) => requested.has(acc.platform))
      .map((acc) => acc.platformChannelId);

    if (wsPlatformChannelIds.length === 0) {
      return {
        destinations: [],
        workspaceDestinationWarning:
          `workspace_destination_missing: Workspace "${workspace.displayName}" không có tài khoản nào ` +
          `cho platform ${[...requested].join(", ")}. Không tạo lịch để tránh đăng nhầm kênh.`,
      };
    }

    // Find active DB credentials matching these platform_channel_ids
    const rows = await db.query.socialChannels.findMany({
      where: and(
        inArray(socialChannels.platformChannelId, wsPlatformChannelIds),
        eq(socialChannels.isActive, true),
      ),
    });

    // Per platform_channel_id, pick the first non-reconnect credential
    const pickedByPlatformChannelId = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      if (!row.needsReconnect && row.platformChannelId) {
        const key = `${row.platform}|${row.platformChannelId}`;
        if (!pickedByPlatformChannelId.has(key)) {
          pickedByPlatformChannelId.set(key, row);
        }
      }
    }

    const window = workspace.schedulePlan.postingWindows[0] ?? { start: "06:00", end: "22:00" };
    const intervalMin = Math.max(opts.intervalMin, workspace.schedulePlan.intervalMinutes);

    const destinations: MixerDestination[] = [];
    const missingPlatforms: string[] = [];

    for (const acc of workspace.platformAccounts) {
      if (!requested.has(acc.platform)) continue;
      const key = `${acc.platform}|${acc.platformChannelId}`;
      const ch = pickedByPlatformChannelId.get(key);
      if (!ch) {
        missingPlatforms.push(`${acc.platform} (${acc.displayName})`);
        continue;
      }
      destinations.push({
        platform: acc.platform,
        channelId: ch.id,
        channelName: ch.name,
        privacyStatus: acc.platform === "facebook" ? "public" : "public",
        windowStart: window.start,
        windowEnd: window.end,
        intervalMin,
        platformChannelId: acc.platformChannelId,
      });
    }

    const warning = missingPlatforms.length > 0
      ? `workspace_destination_missing: Không tìm thấy credential hoạt động cho ${missingPlatforms.join(", ")} trong workspace "${workspace.displayName}".`
      : undefined;

    return { destinations, workspaceDestinationWarning: warning };
  }

  // ── Path B: default channel publish config ────────────────────────────
  const config = await getChannelPublishConfig(DEFAULT_CHANNEL_KEY);
  if (!config) throw new Error(`Không tìm thấy publish config cho channel ${DEFAULT_CHANNEL_KEY}`);

  const enabled = config.shortDestinations.filter((d) => d.enabled);
  if (enabled.length === 0) return { destinations: [] };

  const channelIds = enabled.map((d) => d.channelId);
  const channels = await db.query.socialChannels.findMany({
    where: inArray(socialChannels.id, channelIds),
  });
  const chMap = new Map(channels.map((c) => [c.id, c]));

  const destinations: MixerDestination[] = enabled.flatMap((d) => {
    const ch = chMap.get(d.channelId);
    if (!ch || !ch.isActive || ch.needsReconnect) return [];
    const plat = ch.platform as "youtube" | "facebook";
    if (!requested.has(plat)) return [];
    return [{
      platform: plat,
      channelId: ch.id,
      channelName: ch.name,
      privacyStatus: plat === "facebook" ? "public" : d.privacyStatus,
      windowStart: d.windowStart,
      windowEnd: d.windowEnd,
      intervalMin: d.intervalMin,
      platformChannelId: ch.platformChannelId ?? undefined,
    }];
  });

  return { destinations };
}

// ── Mix-sequence builder ──────────────────────────────────────────────────

function buildFormatSequence(
  ttsAvail: number,
  quoteAvail: number,
  maxSlots: number,
  mixMode: MixMode,
  ttsW: number,
  quoteW: number,
): ContentFormat[] {
  const seq: ContentFormat[] = [];
  let ttsLeft = ttsAvail;
  let quoteLeft = quoteAvail;
  let ttsBucket = 0;
  let quoteBucket = 0;

  for (let i = 0; i < maxSlots; i++) {
    if (ttsLeft === 0 && quoteLeft === 0) break;

    let pick: ContentFormat | null = null;

    if (mixMode === "alternate") {
      // Strict alternation; if one side is exhausted, use the other
      const wantTts = i % 2 === 0;
      if (wantTts && ttsLeft > 0) pick = "tts_short";
      else if (!wantTts && quoteLeft > 0) pick = "legacy_quote_short";
      else if (ttsLeft > 0) pick = "tts_short";
      else if (quoteLeft > 0) pick = "legacy_quote_short";
    } else {
      // Ratio mode: weighted round-robin
      if (ttsBucket <= 0 && quoteBucket <= 0) {
        ttsBucket = ttsW;
        quoteBucket = quoteW;
      }
      if (ttsBucket > 0 && ttsLeft > 0) {
        pick = "tts_short";
        ttsBucket--;
      } else if (quoteBucket > 0 && quoteLeft > 0) {
        pick = "legacy_quote_short";
        quoteBucket--;
      } else if (ttsLeft > 0) {
        pick = "tts_short";
      } else {
        pick = "legacy_quote_short";
      }
    }

    if (!pick) break;
    seq.push(pick);
    if (pick === "tts_short") ttsLeft--;
    else quoteLeft--;
  }

  return seq;
}

// ── Dedup key ─────────────────────────────────────────────────────────────

// ── Core preview builder ──────────────────────────────────────────────────

export async function computeMixerPreview(
  opts: MixerOptions,
): Promise<MixerPreviewResult & { _ttsItems: EligibleItem[]; _quoteItems: EligibleItem[]; _dests: MixerDestination[] }> {
  const { destinations: dests, workspaceDestinationWarning } = await getMixerDestinations(opts);

  if (dests.length === 0) {
    const pending = await getPendingQueueCount();
    return {
      ok: false, mode: "dry_run", slots: [], insertableCount: 0, skippedCount: 0,
      ttsCount: 0, quoteCount: 0, pendingBefore: pending, pendingAfter: pending,
      pendingThreshold: getThresholds().maxPendingUploadQueue, thresholdExceeded: false,
      workspaceDestinationWarning,
      message: workspaceDestinationWarning ?? "Không có destination short nào đang hoạt động.",
      _ttsItems: [], _quoteItems: [], _dests: [],
    };
  }

  const startAt = new Date(opts.startAtIso);
  if (isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    const pending = await getPendingQueueCount();
    return {
      ok: false, mode: "dry_run", slots: [], insertableCount: 0, skippedCount: 0,
      ttsCount: 0, quoteCount: 0, pendingBefore: pending, pendingAfter: pending,
      pendingThreshold: getThresholds().maxPendingUploadQueue, thresholdExceeded: false,
      workspaceDestinationWarning,
      message: "Thời gian bắt đầu phải là tương lai.",
      _ttsItems: [], _quoteItems: [], _dests: dests,
    };
  }

  const maxPending = getThresholds().maxPendingUploadQueue;
  const { windowStart, windowEnd, intervalMin } = getCommonWindow(dests);
  const effectiveInterval = Math.max(opts.intervalMin, intervalMin);
  const ttsW = Math.max(1, opts.ttsWeight ?? 1);
  const quoteW = Math.max(1, opts.quoteWeight ?? 1);

  const [ttsItemsRaw, quoteEligibility, pendingBefore, takenMs, upcomingSignals, pendingBreakdownBase, youtubeScheduleHasGaps] = await Promise.all([
    getEligibleTtsItems(opts.workspaceId),
    getEligibleQuoteItems(opts.workspaceId),
    getPendingQueueCount(),
    getTakenTimesByDest(dests),
    getUpcomingDuplicateSignals(dests),
    getPendingPlatformBreakdown(),
    getUpcomingYouTubeGaps(dests, effectiveInterval),
  ]);

  const quoteItemsRaw = quoteEligibility.items;
  const initialContentIds = [
    ...ttsItemsRaw.map((item) => item.contentId),
    ...quoteItemsRaw.map((item) => item.contentId),
  ];
  const initialExistingStates = await getExistingQueueKeyStates(initialContentIds);

  const canCreateForAnyDestination = (item: EligibleItem) =>
    dests.some((dest) => !initialExistingStates.has(`${item.contentId}|${dest.platform}|${dest.channelId}`));

  const ttsItems = ttsItemsRaw.filter(canCreateForAnyDestination);
  const quoteItems = quoteItemsRaw.filter(canCreateForAnyDestination);

  const formatSeq = buildFormatSequence(
    ttsItems.length, quoteItems.length,
    opts.maxSlots, opts.mixMode, ttsW, quoteW,
  );

  // Assign items to format slots
  const ttsQueue = [...ttsItems];
  const quoteQueue = [...quoteItems];
  const assignments: EligibleItem[] = [];
  for (const fmt of formatSeq) {
    const item = fmt === "tts_short" ? ttsQueue.shift() : quoteQueue.shift();
    if (item) assignments.push(item);
  }

  const allContentIds = assignments.map((a) => a.contentId);
  const existingStates = new Map(
    [...initialExistingStates.entries()].filter(([key]) =>
      allContentIds.some((contentId) => key.startsWith(`${contentId}|`)),
    ),
  );
  const scheduledBatchTexts = new Map<string, string[]>();

  const slots: MixerSlot[] = [];
  let anchor = startAt;

  for (const item of assignments) {
    const requestedAnchor = alignToWindow(anchor, windowStart, windowEnd);
    const slot = findSafeSlot(anchor, effectiveInterval, windowStart, windowEnd, takenMs, dests);
    for (const dest of dests) {
      const dedupeKey = `${item.contentId}|${dest.platform}|${dest.channelId}`;
      const existingState = existingStates.get(dedupeKey);
      const willCreate = !existingState;
      const warnings: string[] = [];
      const destinationKey = `${dest.platform}|${dest.channelId}`;
      const currentTexts = scheduledBatchTexts.get(destinationKey) ?? [];
      const existingTexts = upcomingSignals.get(destinationKey) ?? [];
      if (slot.getTime() !== requestedAnchor.getTime()) {
        warnings.push("slot_conflict");
      }
      if (currentTexts.some((text) => isNearDuplicateText(text, item.quoteText))) {
        warnings.push("near_duplicate_topic");
      }
      if (existingTexts.some((text) => isNearDuplicateText(text, item.quoteText))) {
        warnings.push("near_duplicate_topic");
      }
      if (willCreate) {
        currentTexts.push(item.quoteText);
        scheduledBatchTexts.set(destinationKey, currentTexts);
      }
      slots.push({
        contentId: item.contentId,
        topic: item.topic,
        displayLabel: item.formatType === "tts_short" ? "TTS Short" : "Quote Short",
        formatType: item.formatType,
        platform: dest.platform,
        channelId: dest.channelId,
        channelName: dest.channelName,
        privacyStatus: dest.privacyStatus,
        scheduledAtUtc: slot.toISOString(),
        scheduledAtVn: formatVn(slot),
        willCreate,
        reason: !willCreate
          ? existingState === "done"
            ? "already_published"
            : "already_queued"
          : undefined,
        warnings: warnings.length ? Array.from(new Set(warnings)) : undefined,
      });
    }
    anchor = new Date(slot.getTime() + effectiveInterval * 60_000);
  }

  const insertableCount = slots.filter((s) => s.willCreate).length;
  const skippedCount = slots.filter((s) => !s.willCreate).length;
  const ttsCount = assignments.filter((a) => a.formatType === "tts_short").length;
  const quoteCount = assignments.filter((a) => a.formatType === "legacy_quote_short").length;
  const pendingAfter = pendingBefore + insertableCount;
  const thresholdExceeded = pendingAfter > maxPending;
  const balanceWarnings: string[] = [];
  const pendingBreakdown = {
    ...pendingBreakdownBase,
    maxPending,
    headroomBefore: Math.max(0, maxPending - pendingBefore),
    headroomAfter: Math.max(0, maxPending - pendingAfter),
  };

  if (pendingBreakdown.facebookQuotePending > 15) balanceWarnings.push("facebook_quote_soft_cap_exceeded");
  if (pendingBreakdown.facebookPending > 25) balanceWarnings.push("facebook_total_soft_cap_exceeded");
  if (pendingBreakdown.facebookPending > pendingBreakdown.youtubePending) balanceWarnings.push("facebook_dominates_queue");
  if (pendingBreakdown.headroomAfter < 20) balanceWarnings.push("youtube_protected_headroom_low");
  if (youtubeScheduleHasGaps) balanceWarnings.push("youtube_schedule_gaps");
  if (thresholdExceeded) balanceWarnings.push("threshold_exceeded");

  return {
    ok: true, mode: "dry_run",
    slots, insertableCount, skippedCount, ttsCount, quoteCount,
    pendingBefore, pendingAfter,
    pendingThreshold: maxPending,
    thresholdExceeded,
    hardBlockReasons: thresholdExceeded ? ["threshold_exceeded"] : [],
    warningCounts: mergeCountMaps(quoteEligibility.warningCounts, countWarningCodes(slots)),
    balanceWarnings,
    pendingBreakdown,
    workspaceDestinationWarning,
    _ttsItems: ttsItems, _quoteItems: quoteItems, _dests: dests,
  };
}

// ── Execute ───────────────────────────────────────────────────────────────

async function ensureContentRow(item: EligibleItem): Promise<void> {
  if (item.formatType !== "legacy_quote_short") return; // TTS rows already exist
  const existing = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, item.contentId),
    columns: { id: true },
  });
  if (existing) return;

  const workspace =
    (item.workspaceId ? getWorkspaceById(item.workspaceId) : null) ??
    (item.channelProfileId ? getWorkspaceByProfileId(item.channelProfileId) : null);
  const targetChannelKey = workspace?.channelKey ?? item.channelKey ?? DEFAULT_CHANNEL_KEY;
  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.channelKey, targetChannelKey), eq(niches.isActive, true)),
    columns: { id: true, name: true, contentProfileKey: true, channelKey: true },
  });
  if (!niche) throw new Error(`Niche active không tìm thấy cho ${targetChannelKey}`);

  await db.insert(contentGenerations).values({
    id: item.contentId,
    topic: item.topic,
    nicheId: niche.id,
    nicheName: niche.name,
    contentProfileKey: niche.contentProfileKey ?? "buddhism",
    channelKey: niche.channelKey ?? DEFAULT_CHANNEL_KEY,
    script: item.quoteText,
    shortContent: item.quoteText,
    shortSelectedHook: item.quoteText,
    longContent: item.quoteText,
    experimentId: LEGACY_QUOTE_EXPERIMENT,
    experimentVariant: "LEGACY_QUOTE_NO_VOICE_V2",
    thumbnailText: item.quoteText,
    status: "completed",
    ttsStatus: "done",
    imagesStatus: "done",
    videoStatus: "done",
    contentMode: "short",
    formatType: "legacy_quote_short",
    topicFamily: item.channelKey === "phat_phap" ? inferStrategicTopicFamily(item.topic) : null,
  });
}

export async function executeMixerSchedule(
  opts: MixerOptions,
): Promise<MixerPreviewResult & { createdIds: string[]; _ttsItems: EligibleItem[]; _quoteItems: EligibleItem[]; _dests: MixerDestination[] }> {
  const maxPending = getThresholds().maxPendingUploadQueue;

  // Re-run preview to get fresh assignments
  const preview = await computeMixerPreview(opts);
  if (!preview.ok) {
    return { ...preview, mode: "execute", createdIds: [] };
  }

  // Hard block if over threshold
  const freshPending = await getPendingQueueCount();
  const insertable = preview.slots.filter((s) => s.willCreate).length;
  if (freshPending + insertable > maxPending) {
    return {
      ...preview,
      ok: false,
      mode: "execute",
      pendingBefore: freshPending,
      pendingAfter: freshPending + insertable,
      thresholdExceeded: true,
      createdIds: [],
      message: `Queue đang có ${freshPending} item. Thêm ${insertable} row sẽ vượt ngưỡng ${maxPending}.`,
    };
  }

  // Build a map of all eligible items by contentId for title/description
  const allItems = new Map<string, EligibleItem>();
  for (const item of [...preview._ttsItems, ...preview._quoteItems]) {
    allItems.set(item.contentId, item);
  }

  // Ensure contentGenerations rows for legacy quotes
  const legacyIds = new Set(
    preview.slots.filter((s) => s.willCreate && s.formatType === "legacy_quote_short").map((s) => s.contentId),
  );
  for (const contentId of legacyIds) {
    const item = allItems.get(contentId);
    if (item) await ensureContentRow(item);
  }

  const existingStates = await getExistingQueueKeyStates([...allItems.keys()]);
  const createdIds: string[] = [];

  for (const slot of preview.slots) {
    if (!slot.willCreate) continue;
    const dedupeKey = `${slot.contentId}|${slot.platform}|${slot.channelId}`;
    if (existingStates.has(dedupeKey)) continue;

    const item = allItems.get(slot.contentId);
    if (!item) continue;

    const [inserted] = await db.insert(uploadQueue).values({
      contentId: slot.contentId,
      channelId: slot.channelId,
      platform: slot.platform,
      videoType: "short",
      title: buildDefaultVideoTitle({
        platform: slot.platform,
        contentType: "short",
        topic: item.topic,
        contentProfileKey: item.contentProfileKey,
        shortContent: item.shortContent,
      }),
      description: buildDefaultVideoDescription({
        platform: slot.platform,
        contentType: "short",
        topic: item.topic,
        nicheName: item.nicheName,
        shortContent: item.shortContent,
        longContent: item.longContent,
        longYoutubeDescription: item.longYoutubeDescription,
        contentProfileKey: item.contentProfileKey,
      }),
      tags: [],
      privacyStatus: slot.privacyStatus,
      scheduledAt: new Date(slot.scheduledAtUtc),
      status: "queued",
    }).returning({ id: uploadQueue.id });

    createdIds.push(inserted.id);
    existingStates.set(dedupeKey, "queued");
  }

  return {
    ...preview,
    mode: "execute",
    insertableCount: createdIds.length,
    skippedCount: preview.slots.length - createdIds.length,
    pendingAfter: freshPending + createdIds.length,
    thresholdExceeded: freshPending + createdIds.length > maxPending,
    hardBlockReasons: freshPending + createdIds.length > maxPending ? ["threshold_exceeded"] : [],
    warningCounts: preview.warningCounts,
    balanceWarnings: preview.balanceWarnings,
    pendingBreakdown: preview.pendingBreakdown,
    createdIds,
  };
}
