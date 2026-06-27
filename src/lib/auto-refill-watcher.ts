import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appConfig,
  contentGenerations,
  niches,
  socialChannels,
  uploadQueue,
} from "@/lib/db/schema";
import { getThresholds } from "@/lib/production-capacity";
import { getWorkspaceById, type ChannelWorkspace } from "@/lib/channel-workspace-registry";
import { generateQuoteShortsAction } from "@/actions/quote-generator";
import { PHAT_PHAP_SPRINT, pickBuddhistSprintTopicFamily, sprintAllocationSummary } from "@/lib/config/sprint-config";
import {
  QS_EXPERIMENT_ID,
  QS_EXPERIMENT_VARIANT,
  previewQuoteGeneration,
  runQuoteShortBatch,
  type QuoteGenBatchOptions,
} from "@/lib/pipeline/quote-short-pipeline";
import { buildQuoteArtifactMetadata } from "@/lib/quotes/quote-pipeline";
import { createPromptVersionEntry } from "@/lib/prompt-version-registry";
import { buildDefaultVideoDescription, buildDefaultVideoTitle } from "@/lib/social/youtube-metadata";

const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
const VN_OFFSET_HOURS = 7;
const AUTO_REFILL_STATE_KEY = "auto_refill_watcher_state";
const HEADROOM_RESERVE = 2;
const LOOKAHEAD_HOURS = 48;
const FACEBOOK_QUOTE_SOFT_CAP = 15;
const FACEBOOK_TOTAL_SOFT_CAP = 25;
const YOUTUBE_PROTECTED_HEADROOM = 20;
const LEGACY_QUOTE_EXPERIMENT = "LEGACY_QUOTE_SHORT";

type AutoRefillSource = "cron" | "manual" | "script";
type DestinationId =
  | "youtube_tang_sau"
  | "youtube_gioi_dinh_tue"
  | "facebook_tri_tue_an_nhien";

type DestinationPlatform = "youtube" | "facebook";
type RefillFormat = "tts_short" | "legacy_quote_short";

export type AutoRefillConfig = {
  enabled: boolean;
  lowWaterMark: number;
  targetPending: number;
  maxPendingUploadQueue: number;
  hardMaxPending: number;
  headroomReserve: number;
  maxGeneratePerRun: number;
  maxQueueInsertsPerRun: number;
};

export type AutoRefillPersistedState = {
  ranAt: string;
  source: AutoRefillSource;
  dryRun: boolean;
  skipped: boolean;
  reason: string | null;
  pendingBefore: number;
  pendingAfter: number;
  insertBudget: number;
  generatedCount: number;
  insertedCount: number;
  destinationsFilled: DestinationId[];
  warnings: string[];
};

export type AutoRefillPlanRow = {
  destinationId: DestinationId;
  workspaceId: string;
  platform: DestinationPlatform;
  channelId: number;
  channelName: string;
  formatType: RefillFormat;
  contentId: string | null;
  topic: string;
  scheduledAtUtc: string;
  scheduledAtVn: string;
  action: "queue_existing" | "generate_and_queue";
  reason?: string;
};

export type AutoRefillDestinationHealth = {
  destinationId: DestinationId;
  label: string;
  workspaceId: string;
  platform: DestinationPlatform;
  channelId: number | null;
  channelName: string;
  postingWindow: string;
  intervalMinutes: number;
  queuedCount: number;
  uploadingCount: number;
  doneLast24h: number;
  errorCount: number;
  nextScheduledAtVn: string | null;
  lastScheduledAtVn: string | null;
  gapCount: number;
  firstGapVn: string | null;
  readyCandidates: number;
  safeInsertableSlots: number;
  usedFormats: string[];
  warnings: string[];
};

export type AutoRefillHealthSnapshot = {
  config: AutoRefillConfig;
  lastRun: AutoRefillPersistedState | null;
  currentPending: number;
  currentHeadroom: number;
  nextRefillRecommendation: string;
  destinations: AutoRefillDestinationHealth[];
};

export type AutoRefillRunResult = {
  ok: boolean;
  dryRun: boolean;
  source: AutoRefillSource;
  skipped: boolean;
  reason: string | null;
  config: AutoRefillConfig;
  pendingBefore: number;
  pendingAfter: number;
  insertBudget: number;
  generatedCount: number;
  insertedCount: number;
  generatedContentIds: string[];
  insertedQueueIds: string[];
  warnings: string[];
  destinations: AutoRefillDestinationHealth[];
  planRows: AutoRefillPlanRow[];
  lastStateSaved: boolean;
};

type DestinationDefinition = {
  id: DestinationId;
  label: string;
  workspace: ChannelWorkspace;
  platform: DestinationPlatform;
  platformChannelId: string;
  channelName: string;
  preferredFormats: RefillFormat[];
};

type DestinationRuntime = DestinationDefinition & {
  channelRow: typeof socialChannels.$inferSelect | null;
  channelId: number | null;
  /**
   * The canonical channel ID for this platform + platformChannelId combination.
   * Determined by highest upload_queue usage (same physical YouTube/Facebook channel,
   * potentially multiple OAuth credential rows). Auto-refill only inserts rows onto
   * the canonical row; backup OAuth rows are skipped to prevent independent lane drift.
   */
  canonicalChannelId: number | null;
  windowStart: string;
  windowEnd: string;
  intervalMinutes: number;
};

type CandidateRow = {
  contentId: string;
  topic: string;
  formatType: RefillFormat;
  channelKey: string;
  contentProfileKey: string;
  shortContent: string;
  longContent: string;
  longYoutubeDescription: string | null;
  nicheName: string;
  videoPath: string | null;
};

type DestinationAudit = {
  health: AutoRefillDestinationHealth;
  gapSlots: Date[];
  candidates: CandidateRow[];
  /** Whether the resolved channelId is the canonical OAuth row for this brand+platform. */
  isCanonical: boolean;
  canonicalChannelId: number | null;
  /**
   * The formatType of the most recently scheduled future video-campaign row for this
   * destination. Used for alternating TTS ↔ quote format selection in auto-refill:
   * if the last row was tts_short, the next slot should prefer legacy_quote_short, and vice versa.
   * Null when the queue is empty or format is unknown.
   */
  lastCampaignFormat: RefillFormat | null;
};

function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toVnParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function fromVnLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - VN_OFFSET_HOURS, minute, 0, 0));
}

function formatVn(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TZ,
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function minutesFromHhmm(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function existsMedia(videoPath: string | null): boolean {
  if (!videoPath) return false;
  const absolutePath = path.isAbsolute(videoPath)
    ? videoPath
    : path.join(process.cwd(), videoPath);
  return fs.existsSync(absolutePath);
}

function getDestinationDefinitions(): DestinationDefinition[] {
  const buddhistWorkspace = getWorkspaceById("buddhist_healing_workspace");
  const tangSauWorkspace = getWorkspaceById("tang_sau_workspace");
  if (!buddhistWorkspace || !tangSauWorkspace) {
    throw new Error("Workspace registry is missing required workspaces.");
  }

  const buddhistYoutube = buddhistWorkspace.platformAccounts.find((account) => account.platform === "youtube");
  const buddhistFacebook = buddhistWorkspace.platformAccounts.find((account) => account.platform === "facebook");
  const tangSauYoutube = tangSauWorkspace.platformAccounts.find((account) => account.platform === "youtube");
  if (!buddhistYoutube || !buddhistFacebook || !tangSauYoutube) {
    throw new Error("Workspace registry is missing required platform accounts.");
  }

  return [
    {
      id: "youtube_tang_sau",
      label: "YouTube · Tầng Sâu",
      workspace: tangSauWorkspace,
      platform: "youtube",
      platformChannelId: tangSauYoutube.platformChannelId,
      channelName: tangSauYoutube.displayName,
      preferredFormats: ["legacy_quote_short"],
    },
    {
      id: "youtube_gioi_dinh_tue",
      label: "YouTube · Giới Định Tuệ",
      workspace: buddhistWorkspace,
      platform: "youtube",
      platformChannelId: buddhistYoutube.platformChannelId,
      channelName: buddhistYoutube.displayName,
      preferredFormats: ["tts_short", "legacy_quote_short"],
    },
    {
      id: "facebook_tri_tue_an_nhien",
      label: "Facebook · Trí Tuệ An Nhiên",
      workspace: buddhistWorkspace,
      platform: "facebook",
      platformChannelId: buddhistFacebook.platformChannelId,
      channelName: buddhistFacebook.displayName,
      preferredFormats: ["tts_short"],
    },
  ];
}

/**
 * Determines the canonical social_channel ID for a given platform +
 * platformChannelId combination.
 *
 * Selection rule (in priority order):
 *  1. Prefer rows whose channel_key matches the provided channelKey (avoids
 *     accidentally canonicalising a cross-brand credential).
 *  2. Among those, prefer is_active=true, needs_reconnect=false.
 *  3. Break remaining ties by the number of historical upload_queue rows
 *     (most-used credential wins — for tang_sau this resolves to ch10).
 *
 * Returns null when no social_channel rows exist for the given combination.
 */
async function resolveCanonicalChannelId(
  platform: DestinationPlatform,
  platformChannelId: string,
  channelKey: string,
): Promise<number | null> {
  // Pull all candidates for this platform channel, with their queue usage count.
  // Use drizzle sql`` template for safe parameterised query.
  // The multi-criteria ORDER BY (computed columns + aggregates) requires raw SQL.
  const { sql: drizzleSql } = await import("drizzle-orm");
  const result = await db.execute<{
    id: number;
    queue_count: string; // COUNT returns bigint → string in node-postgres
  }>(
    drizzleSql`
      SELECT
        sc.id,
        COUNT(uq.id) AS queue_count
      FROM social_channels sc
      LEFT JOIN upload_queue uq ON uq.channel_id = sc.id
      WHERE sc.platform            = ${platform}
        AND sc.platform_channel_id = ${platformChannelId}
      GROUP BY sc.id, sc.channel_key, sc.is_active, sc.needs_reconnect
      ORDER BY
        CASE WHEN sc.channel_key      = ${channelKey} THEN 0 ELSE 1 END ASC,
        CASE WHEN sc.is_active = true AND sc.needs_reconnect = false THEN 0 ELSE 1 END ASC,
        COUNT(uq.id) DESC
      LIMIT 1
    `,
  );
  if (result.rows.length === 0) return null;
  return Number(result.rows[0].id);
}

async function resolveDestinationRuntime(def: DestinationDefinition): Promise<DestinationRuntime> {
  const [rows, canonicalChannelId] = await Promise.all([
    db.query.socialChannels.findMany({
      where: and(
        eq(socialChannels.platform, def.platform),
        eq(socialChannels.platformChannelId, def.platformChannelId),
        eq(socialChannels.isActive, true),
      ),
    }),
    resolveCanonicalChannelId(def.platform, def.platformChannelId, def.workspace.channelKey),
  ]);
  const canonicalRow = canonicalChannelId
    ? rows.find((row) => row.id === canonicalChannelId) ?? null
    : null;
  const activeRow =
    (canonicalRow && !canonicalRow.needsReconnect ? canonicalRow : null) ??
    rows.find((row) => !row.needsReconnect) ??
    canonicalRow ??
    null;
  const window = def.workspace.schedulePlan.postingWindows[0] ?? { start: "06:00", end: "22:00" };
  return {
    ...def,
    channelRow: activeRow,
    channelId: activeRow?.id ?? null,
    canonicalChannelId,
    windowStart: window.start,
    windowEnd: window.end,
    intervalMinutes: def.workspace.schedulePlan.intervalMinutes,
  };
}

async function getPendingCount(): Promise<number> {
  const rows = await db.query.uploadQueue.findMany({
    where: inArray(uploadQueue.status, ["queued", "uploading"]),
    columns: { id: true },
  });
  return rows.length;
}

async function getPendingBreakdown() {
  const rows = await db.query.uploadQueue.findMany({
    where: inArray(uploadQueue.status, ["queued", "uploading"]),
    columns: {
      platform: true,
      videoType: true,
    },
  });
  let youtubePending = 0;
  let facebookPending = 0;
  let facebookQuotePending = 0;
  let facebookShortPending = 0;

  for (const row of rows) {
    if (row.platform === "youtube") youtubePending += 1;
    if (row.platform === "facebook") {
      facebookPending += 1;
      if (row.videoType === "quote") facebookQuotePending += 1;
      if (row.videoType === "short") facebookShortPending += 1;
    }
  }

  return {
    youtubePending,
    facebookPending,
    facebookQuotePending,
    facebookShortPending,
  };
}

async function getLastPersistedState(): Promise<AutoRefillPersistedState | null> {
  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, AUTO_REFILL_STATE_KEY),
  });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as AutoRefillPersistedState;
  } catch {
    return null;
  }
}

async function savePersistedState(state: AutoRefillPersistedState): Promise<void> {
  await db
    .insert(appConfig)
    .values({
      key: AUTO_REFILL_STATE_KEY,
      value: JSON.stringify(state),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: JSON.stringify(state),
        updatedAt: new Date(),
      },
    });
}

function getSlotsForWindow(
  now: Date,
  hoursAhead: number,
  windowStart: string,
  windowEnd: string,
  intervalMinutes: number,
): Date[] {
  const end = new Date(now.getTime() + hoursAhead * 60 * 60_000);
  const startMinutes = minutesFromHhmm(windowStart);
  const endMinutes = minutesFromHhmm(windowEnd);
  const slots: Date[] = [];

  let cursor = new Date(now);
  for (let day = 0; day <= 3; day += 1) {
    const parts = toVnParts(cursor);
    for (let minute = startMinutes; minute <= endMinutes; minute += intervalMinutes) {
      const slot = fromVnLocal(
        parts.year,
        parts.month,
        parts.day,
        Math.floor(minute / 60),
        minute % 60,
      );
      if (slot.getTime() <= now.getTime()) continue;
      if (slot.getTime() > end.getTime()) continue;
      slots.push(slot);
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60_000);
  }

  slots.sort((left, right) => left.getTime() - right.getTime());
  return slots;
}

/**
 * Returns all social_channel IDs sharing the same physical platform channel
 * (same platformChannelId + platform). Used to treat all OAuth credential rows
 * for the same brand as occupying the same schedule slots.
 *
 * Example: Tang Sau has ch7 (env OAuth) and ch10 (GCP Project 3) — both point
 * to the same YouTube channel. A slot queued on ch10 must be visible when
 * computing gaps for ch7, and vice versa.
 */
async function getAllSiblingChannelIds(
  platform: DestinationPlatform,
  platformChannelId: string,
): Promise<number[]> {
  const rows = await db.query.socialChannels.findMany({
    where: and(
      eq(socialChannels.platform, platform),
      eq(socialChannels.platformChannelId, platformChannelId),
    ),
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Returns a Set of scheduled_at ISO strings that are already occupied by any
 * active queue row across ALL credential rows for this destination's brand +
 * platform (not just the single resolved channelId).
 *
 * Active statuses that block a slot: queued, uploading, pending, scheduled,
 * processing. Cancelled/error/done do NOT block.
 */
async function getBusySlotTimesAcrossSiblings(
  runtime: DestinationRuntime,
  now: Date,
): Promise<Set<string>> {
  if (!runtime.platformChannelId) return new Set();

  const allChannelIds = await getAllSiblingChannelIds(
    runtime.platform,
    runtime.platformChannelId,
  );
  if (allChannelIds.length === 0) return new Set();

  const lookaheadEnd = now.getTime() + LOOKAHEAD_HOURS * 60 * 60_000;

  const rows = await db
    .select({ scheduledAt: uploadQueue.scheduledAt })
    .from(uploadQueue)
    .where(
      and(
        inArray(uploadQueue.channelId, allChannelIds),
        inArray(uploadQueue.status, [
          "queued",
          "uploading",
          "pending",
          "scheduled",
          "processing",
        ]),
      ),
    );

  const busy = new Set<string>();
  for (const row of rows) {
    const t = new Date(row.scheduledAt).getTime();
    if (t > now.getTime() && t <= lookaheadEnd) {
      busy.add(new Date(row.scheduledAt).toISOString());
    }
  }
  return busy;
}

async function getDestinationQueueRows(runtime: DestinationRuntime, now: Date) {
  if (!runtime.channelId) return [];
  return db.query.uploadQueue.findMany({
    where: and(
      eq(uploadQueue.channelId, runtime.channelId),
      inArray(uploadQueue.status, ["queued", "uploading", "done", "error"]),
    ),
    with: {
      content: {
        columns: {
          topic: true,
          formatType: true,
          channelKey: true,
          contentProfileKey: true,
        },
      },
    },
    orderBy: (table, { asc }) => [asc(table.scheduledAt)],
    columns: {
      id: true,
      contentId: true,
      videoType: true,
      status: true,
      scheduledAt: true,
      uploadedAt: true,
      updatedAt: true,
    },
  }).then((rows) =>
    rows.filter((row) =>
      row.scheduledAt.getTime() >= now.getTime() - 24 * 60 * 60_000 &&
      row.scheduledAt.getTime() <= now.getTime() + LOOKAHEAD_HOURS * 60 * 60_000,
    ),
  );
}

async function getDestinationCandidates(runtime: DestinationRuntime): Promise<CandidateRow[]> {
  if (!runtime.channelId) return [];

  // For YouTube channels that share the same physical channel_id (platform_channel_id),
  // exclude content already uploaded via any credential for that channel, not just the current one.
  const siblingChannelIds: number[] = [];
  if (runtime.platformChannelId) {
    const siblings = await db.query.socialChannels.findMany({
      where: and(
        eq(socialChannels.platform, runtime.platform),
        eq(socialChannels.platformChannelId, runtime.platformChannelId),
      ),
      columns: { id: true },
    });
    siblingChannelIds.push(...siblings.map((s) => s.id));
  }
  const channelIdsToExclude = siblingChannelIds.length > 0 ? siblingChannelIds : [runtime.channelId!];

  const existingRows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.channelId, channelIdsToExclude),
      inArray(uploadQueue.status, ["queued", "uploading", "done", "cancelled"]),
      eq(uploadQueue.videoType, "short"),
    ),
    columns: {
      contentId: true,
    },
  });
  const usedContentIds = new Set(existingRows.map((row) => row.contentId));

  if (runtime.id === "youtube_tang_sau") {
    // Permanently exclude content_ids cancelled for visual-topic mismatch so they can never be re-queued.
    const visualResetRows = await db.query.uploadQueue.findMany({
      where: and(
        eq(uploadQueue.channelId, runtime.channelId),
        eq(uploadQueue.status, "cancelled"),
        eq(uploadQueue.errorMessage, "tang_sau_visual_topic_reset"),
      ),
      columns: { contentId: true },
    });
    for (const row of visualResetRows) {
      usedContentIds.add(row.contentId);
    }

    const rows = await db.query.contentGenerations.findMany({
      where: and(
        eq(contentGenerations.videoStatus, "done"),
        eq(contentGenerations.formatType, "legacy_quote_short"),
        eq(contentGenerations.channelKey, "tang_sau"),
        eq(contentGenerations.contentProfileKey, "philosophy"),
      ),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      columns: {
        id: true,
        topic: true,
        formatType: true,
        channelKey: true,
        contentProfileKey: true,
        shortContent: true,
        longContent: true,
        longYoutubeDescription: true,
        nicheName: true,
        videoPath: true,
      },
      limit: 200,
    });
    return rows
      .filter((row) => !usedContentIds.has(row.id))
      .filter((row) => existsMedia(row.videoPath))
      .map((row) => ({
        contentId: row.id,
        topic: row.topic,
        formatType: "legacy_quote_short",
        channelKey: row.channelKey,
        contentProfileKey: row.contentProfileKey,
        shortContent: row.shortContent,
        longContent: row.longContent,
        longYoutubeDescription: row.longYoutubeDescription,
        nicheName: row.nicheName,
        videoPath: row.videoPath,
      }));
  }

  if (runtime.id === "youtube_gioi_dinh_tue") {
    const rows = await db.query.contentGenerations.findMany({
      where: and(
        eq(contentGenerations.videoStatus, "done"),
        isNull(contentGenerations.mediaCleanedAt),
        eq(contentGenerations.channelKey, "phat_phap"),
        or(
          eq(contentGenerations.formatType, "legacy_quote_short"),
          eq(contentGenerations.formatType, "tts_short"),
          and(
            isNull(contentGenerations.formatType),
            or(
              isNull(contentGenerations.experimentId),
              notInArray(contentGenerations.experimentId, [LEGACY_QUOTE_EXPERIMENT]),
            ),
          ),
        ),
      ),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      columns: {
        id: true,
        topic: true,
        formatType: true,
        channelKey: true,
        contentProfileKey: true,
        shortContent: true,
        longContent: true,
        longYoutubeDescription: true,
        nicheName: true,
        videoPath: true,
      },
      limit: 300,
    });
    const tts = rows
      .filter((row) => !usedContentIds.has(row.id))
      .filter((row) => existsMedia(row.videoPath))
      .filter((row) => row.formatType === "tts_short" || row.formatType === null)
      .map((row) => ({
        contentId: row.id,
        topic: row.topic,
        formatType: "tts_short" as const,
        channelKey: row.channelKey,
        contentProfileKey: row.contentProfileKey,
        shortContent: row.shortContent,
        longContent: row.longContent,
        longYoutubeDescription: row.longYoutubeDescription,
        nicheName: row.nicheName,
        videoPath: row.videoPath,
      }));
    const quotes = rows
      .filter((row) => !usedContentIds.has(row.id))
      .filter((row) => existsMedia(row.videoPath))
      .filter((row) => row.formatType === "legacy_quote_short")
      .filter((row) => (row.contentProfileKey ?? "buddhism") === "buddhism")
      .map((row) => ({
        contentId: row.id,
        topic: row.topic,
        formatType: "legacy_quote_short" as const,
        channelKey: row.channelKey,
        contentProfileKey: row.contentProfileKey,
        shortContent: row.shortContent,
        longContent: row.longContent,
        longYoutubeDescription: row.longYoutubeDescription,
        nicheName: row.nicheName,
        videoPath: row.videoPath,
      }));
    return [...tts, ...quotes];
  }

  const rows = await db.query.contentGenerations.findMany({
    where: and(
      eq(contentGenerations.videoStatus, "done"),
      isNull(contentGenerations.mediaCleanedAt),
      eq(contentGenerations.channelKey, "phat_phap"),
      or(
        eq(contentGenerations.formatType, "tts_short"),
        and(
          isNull(contentGenerations.formatType),
          or(
            isNull(contentGenerations.experimentId),
            notInArray(contentGenerations.experimentId, [LEGACY_QUOTE_EXPERIMENT]),
          ),
        ),
      ),
    ),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    columns: {
      id: true,
      topic: true,
      formatType: true,
      channelKey: true,
      contentProfileKey: true,
      shortContent: true,
      longContent: true,
      longYoutubeDescription: true,
      nicheName: true,
      videoPath: true,
    },
    limit: 300,
  });
  return rows
    .filter((row) => !usedContentIds.has(row.id))
    .filter((row) => existsMedia(row.videoPath))
    .map((row) => ({
      contentId: row.id,
      topic: row.topic,
      formatType: "tts_short",
      channelKey: row.channelKey,
      contentProfileKey: row.contentProfileKey,
      shortContent: row.shortContent,
      longContent: row.longContent,
      longYoutubeDescription: row.longYoutubeDescription,
      nicheName: row.nicheName,
      videoPath: row.videoPath,
    }));
}

async function auditDestination(runtime: DestinationRuntime, now: Date): Promise<DestinationAudit> {
  const queueRows = await getDestinationQueueRows(runtime, now);
  const candidates = await getDestinationCandidates(runtime);
  const futureRows = queueRows.filter(
    (row) =>
      ["queued", "uploading"].includes(row.status) &&
      row.scheduledAt.getTime() > now.getTime(),
  );
  const doneLast24h = queueRows.filter(
    (row) =>
      row.status === "done" &&
      row.uploadedAt &&
      row.uploadedAt.getTime() >= now.getTime() - 24 * 60 * 60_000,
  );
  const errorRows = queueRows.filter((row) => row.status === "error");

  const slots = getSlotsForWindow(now, LOOKAHEAD_HOURS, runtime.windowStart, runtime.windowEnd, runtime.intervalMinutes);
  // Build slotOccupied from ALL credential rows that share this brand's
  // physical platform channel (e.g. tang_sau ch7 env + ch10 GCP3 are both the
  // same YouTube channel). Without this, a ch7 audit blindly treats ch10-owned
  // slots as free and creates duplicate-time upload_queue rows.
  const slotOccupied = runtime.platformChannelId
    ? await getBusySlotTimesAcrossSiblings(runtime, now)
    : new Set(futureRows.map((row) => row.scheduledAt.toISOString()));
  const gapSlots = slots.filter((slot) => !slotOccupied.has(slot.toISOString()));
  const futureFormats = Array.from(
    new Set(
      futureRows.map((row) => `${row.content?.formatType ?? "(none)"}|${row.videoType}`),
    ),
  );
  const warnings: string[] = [];
  if (!runtime.channelId) warnings.push("destination_channel_missing");
  if (runtime.id === "youtube_gioi_dinh_tue" && candidates.some((candidate) => candidate.formatType === "tts_short")) {
    warnings.push("subtitle_status_not_persisted");
  }
  if (runtime.id === "facebook_tri_tue_an_nhien" && futureRows.some((row) => row.videoType === "quote")) {
    warnings.push("facebook_quote_backlog_present");
  }

  const isCanonical =
    runtime.channelId !== null &&
    runtime.canonicalChannelId !== null &&
    runtime.channelId === runtime.canonicalChannelId;

  // Track the most recently scheduled video-campaign format for alternating selection.
  // We look at video rows only (videoType="short") to ignore FB-only quote/photo rows.
  const lastCampaignVideoRow = [...futureRows]
    .reverse()
    .find((row) => row.videoType === "short");
  const lastCampaignFormat: RefillFormat | null =
    (lastCampaignVideoRow?.content?.formatType as RefillFormat | null | undefined) ?? null;

  return {
    health: {
      destinationId: runtime.id,
      label: runtime.label,
      workspaceId: runtime.workspace.workspaceId,
      platform: runtime.platform,
      channelId: runtime.channelId,
      channelName: runtime.channelName,
      postingWindow: `${runtime.windowStart}–${runtime.windowEnd}`,
      intervalMinutes: runtime.intervalMinutes,
      queuedCount: futureRows.filter((row) => row.status === "queued").length,
      uploadingCount: futureRows.filter((row) => row.status === "uploading").length,
      doneLast24h: doneLast24h.length,
      errorCount: errorRows.length,
      nextScheduledAtVn: futureRows[0] ? formatVn(futureRows[0].scheduledAt) : null,
      lastScheduledAtVn: futureRows.at(-1) ? formatVn(futureRows.at(-1)!.scheduledAt) : null,
      gapCount: gapSlots.length,
      firstGapVn: gapSlots[0] ? formatVn(gapSlots[0]) : null,
      readyCandidates: candidates.length,
      safeInsertableSlots: Math.min(gapSlots.length, candidates.length),
      usedFormats: futureFormats,
      warnings,
    },
    gapSlots,
    candidates,
    isCanonical,
    canonicalChannelId: runtime.canonicalChannelId,
    lastCampaignFormat,
  };
}

async function auditAllDestinations(now: Date): Promise<DestinationAudit[]> {
  const definitions = getDestinationDefinitions();
  const runtimes = await Promise.all(definitions.map(resolveDestinationRuntime));
  return Promise.all(runtimes.map((runtime) => auditDestination(runtime, now)));
}

function buildNextRecommendation(
  config: AutoRefillConfig,
  pending: number,
  destinations: AutoRefillDestinationHealth[],
): string {
  if (!config.enabled) return "Auto Refill đang tắt. Bật AUTO_REFILL_ENABLED=true để cron có thể tự lấp queue.";
  if (pending >= config.lowWaterMark) {
    return `Queue đang ${pending}/${config.maxPendingUploadQueue}, trên low-water mark ${config.lowWaterMark}. Chưa cần refill.`;
  }
  const firstGap = destinations.find((destination) => destination.gapCount > 0);
  if (!firstGap) {
    return "Không thấy gap cần refill trong 48 giờ tới.";
  }
  return `Queue dưới low-water mark. Destination cần ưu tiên tiếp theo: ${firstGap.label}${firstGap.firstGapVn ? ` từ ${firstGap.firstGapVn}` : ""}.`;
}

export function getAutoRefillConfig(): AutoRefillConfig {
  const thresholds = getThresholds();
  const hardMaxPending = thresholds.maxPendingUploadQueue;
  const enabled = envBool("AUTO_REFILL_ENABLED", false);
  const lowWaterMark = envInt("AUTO_REFILL_LOW_WATERMARK", 45);
  const requestedTarget = envInt("AUTO_REFILL_TARGET_PENDING", 55);
  const targetPending = Math.min(requestedTarget, hardMaxPending - HEADROOM_RESERVE);
  return {
    enabled,
    lowWaterMark,
    targetPending,
    maxPendingUploadQueue: thresholds.maxPendingUploadQueue,
    hardMaxPending,
    headroomReserve: HEADROOM_RESERVE,
    maxGeneratePerRun: envInt("AUTO_REFILL_MAX_GENERATE_PER_RUN", 8),
    maxQueueInsertsPerRun: envInt("AUTO_REFILL_MAX_QUEUE_INSERTS_PER_RUN", 12),
  };
}

export async function getAutoRefillHealthSnapshot(): Promise<AutoRefillHealthSnapshot> {
  const config = getAutoRefillConfig();
  const now = new Date();
  const [pending, lastRun, audits] = await Promise.all([
    getPendingCount(),
    getLastPersistedState(),
    auditAllDestinations(now),
  ]);
  return {
    config,
    lastRun,
    currentPending: pending,
    currentHeadroom: Math.max(0, config.maxPendingUploadQueue - pending),
    nextRefillRecommendation: buildNextRecommendation(
      config,
      pending,
      audits.map((audit) => audit.health),
    ),
    destinations: audits.map((audit) => audit.health),
  };
}

async function getActiveNicheForChannel(channelKey: string) {
  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.channelKey, channelKey), eq(niches.isActive, true)),
    columns: {
      id: true,
      name: true,
      contentProfileKey: true,
      channelKey: true,
    },
  });
  if (!niche) throw new Error(`Không tìm thấy niche active cho channel ${channelKey}`);
  return niche;
}

async function generateTangSauQuoteBatch(count: number): Promise<CandidateRow[]> {
  if (count <= 0) return [];
  const options: QuoteGenBatchOptions = {
    count,
    workspaceId: "tang_sau_workspace",
    channelProfileId: "tang_sau_v1",
    durationSec: 14,
  };
  const previewItems = await previewQuoteGeneration(options);
  if (previewItems.length === 0) return [];
  const niche = await getActiveNicheForChannel("tang_sau");
  const batchResults = await runQuoteShortBatch(previewItems, {
    durationSec: options.durationSec,
  });
  const successfulEntries = batchResults
    .map((result, index) => ({ result, item: previewItems[index] }))
    .filter((entry) => entry.result.ok && entry.result.videoPath);
  if (successfulEntries.length === 0) return [];

  await db.insert(contentGenerations).values(
    successfulEntries.map(({ result, item }) => ({
      id: result.contentId,
      topic: result.topic,
      nicheId: niche.id,
      nicheName: niche.name,
      contentProfileKey: niche.contentProfileKey ?? "philosophy",
      channelKey: niche.channelKey ?? "tang_sau",
      script: result.quoteText,
      shortContent: result.quoteText,
      shortSelectedHook: result.quoteText,
      longContent: result.quoteText,
      experimentId: QS_EXPERIMENT_ID,
      experimentVariant: result.experimentVariant ?? QS_EXPERIMENT_VARIANT,
      thumbnailText: result.quoteText,
      status: "completed",
      ttsStatus: "done",
      imagesStatus: "done",
      videoStatus: "done",
      videoPath: path.relative(process.cwd(), result.videoPath),
      contentMode: "short",
      formatType: "legacy_quote_short",
      promptVersions: {
        quote: createPromptVersionEntry("quote", {
          stage: "quote",
          mode: "independent_youtube_quote_short",
          model: item?.quoteModel ?? null,
          details: buildQuoteArtifactMetadata({
            quoteText: result.quoteText,
            quoteSourceType: item?.quoteSourceType ?? "independent_llm",
            model: item?.quoteModel ?? null,
            contentProfileKey: niche.contentProfileKey ?? "philosophy",
            channelKey: niche.channelKey ?? "tang_sau",
            nicheName: niche.name,
            sourceContentId: result.contentId,
            sourceFormatType: "legacy_quote_short",
            validationReasons: item?.quoteSourceType === "fallback" ? ["generator_fallback"] : [],
          }),
        }),
      },
    })),
  );

  return successfulEntries.map(({ result }) => ({
    contentId: result.contentId,
    topic: result.topic,
    formatType: "legacy_quote_short" as const,
    channelKey: "tang_sau",
    contentProfileKey: "philosophy",
    shortContent: result.quoteText,
    longContent: result.quoteText,
    longYoutubeDescription: null,
    nicheName: niche.name,
    videoPath: path.relative(process.cwd(), result.videoPath),
  }));
}

function buildPhatPhapQuoteBatchOptions(count: number): QuoteGenBatchOptions {
  const sprintFamily = pickBuddhistSprintTopicFamily("phat_phap") ?? undefined;
  if (sprintFamily) {
    console.log(
      `[autoRefill] ${sprintAllocationSummary(PHAT_PHAP_SPRINT)} → selected="${sprintFamily}" destination=youtube_gioi_dinh_tue`,
    );
  }
  return {
    count,
    workspaceId: "buddhist_healing_workspace",
    channelProfileId: "buddhist_healing_v1",
    durationSec: 14,
    topicFamily: sprintFamily,
  };
}

async function previewPhatPhapQuoteBatch(count: number): Promise<CandidateRow[]> {
  if (count <= 0) return [];
  const options = buildPhatPhapQuoteBatchOptions(count);
  const previewItems = await previewQuoteGeneration(options);
  const niche = await getActiveNicheForChannel("phat_phap");
  return previewItems.map((item) => ({
    contentId: `preview-phat-phap-quote-${randomUUID()}`,
    topic: item.topic,
    formatType: "legacy_quote_short" as const,
    channelKey: niche.channelKey ?? "phat_phap",
    contentProfileKey: niche.contentProfileKey ?? "buddhism",
    shortContent: item.quoteText,
    longContent: item.reflectionText ? `${item.quoteText}\n\n${item.reflectionText}` : item.quoteText,
    longYoutubeDescription: null,
    nicheName: niche.name,
    videoPath: null,
  }));
}

async function generatePhatPhapQuoteBatch(count: number): Promise<CandidateRow[]> {
  if (count <= 0) return [];
  const options = buildPhatPhapQuoteBatchOptions(count);
  const generated = await generateQuoteShortsAction(options);
  if (!generated.ok) return [];

  const successfulIds = generated.results
    .filter((result) => result.ok && result.videoPath)
    .map((result) => result.contentId);
  if (successfulIds.length === 0) return [];

  const rows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, successfulIds),
    columns: {
      id: true,
      topic: true,
      formatType: true,
      channelKey: true,
      contentProfileKey: true,
      shortContent: true,
      longContent: true,
      longYoutubeDescription: true,
      nicheName: true,
      videoPath: true,
    },
  });

  return rows
    .filter((row) => row.formatType === "legacy_quote_short")
    .filter((row) => existsMedia(row.videoPath))
    .map((row) => ({
      contentId: row.id,
      topic: row.topic,
      formatType: "legacy_quote_short" as const,
      channelKey: row.channelKey ?? "phat_phap",
      contentProfileKey: row.contentProfileKey ?? "buddhism",
      shortContent: row.shortContent,
      longContent: row.longContent,
      longYoutubeDescription: row.longYoutubeDescription,
      nicheName: row.nicheName,
      videoPath: row.videoPath,
    }));
}

/**
 * Pick the next candidate from the pool for a given destination.
 *
 * @param preferFormat When provided (e.g. for video-campaign alternating), this format
 *   is tried first. If no candidate of that format is available, falls back to the
 *   destination default preference, then any available candidate.
 */
function pickCandidateForDestination(
  destinationId: DestinationId,
  pool: CandidateRow[],
  usedContentIds: Set<string>,
  preferFormat?: RefillFormat | null,
): CandidateRow | null {
  // 1. Explicit format preference (alternating TTS ↔ quote for video campaigns).
  if (preferFormat) {
    const preferred = pool.find(
      (c) => c.formatType === preferFormat && !usedContentIds.has(c.contentId),
    );
    if (preferred) return preferred;
  }
  // 2. Destination default: phat_phap YouTube prefers TTS when no alternating override.
  if (destinationId === "youtube_gioi_dinh_tue" && !preferFormat) {
    const tts = pool.find((c) => c.formatType === "tts_short" && !usedContentIds.has(c.contentId));
    if (tts) return tts;
  }
  // 3. Any available candidate.
  return pool.find((c) => !usedContentIds.has(c.contentId)) ?? null;
}

async function buildPlan(
  config: AutoRefillConfig,
  now: Date,
  options: { dryRun: boolean },
): Promise<{
  pendingBefore: number;
  pendingAfter: number;
  insertBudget: number;
  destinations: DestinationAudit[];
  planRows: AutoRefillPlanRow[];
  generatedCount: number;
  generatedContentIds: string[];
  warnings: string[];
}> {
  const [pendingBefore, breakdown, audits, capacity] = await Promise.all([
    getPendingCount(),
    getPendingBreakdown(),
    auditAllDestinations(now),
    getThresholds(),
  ]);
  const maxPending = capacity.maxPendingUploadQueue;
  const insertBudget = Math.max(
    0,
    Math.min(
      config.targetPending - pendingBefore,
      config.maxPendingUploadQueue - pendingBefore - config.headroomReserve,
      config.maxQueueInsertsPerRun,
    ),
  );
  const warnings: string[] = [];
  if (breakdown.facebookQuotePending > FACEBOOK_QUOTE_SOFT_CAP) {
    warnings.push("facebook_quote_soft_cap_exceeded");
  }
  if (breakdown.facebookPending > FACEBOOK_TOTAL_SOFT_CAP) {
    warnings.push("facebook_total_soft_cap_exceeded");
  }
  if (Math.max(0, maxPending - pendingBefore) < YOUTUBE_PROTECTED_HEADROOM) {
    warnings.push("youtube_protected_headroom_low");
  }

  if (insertBudget <= 0) {
    return {
      pendingBefore,
      pendingAfter: pendingBefore,
      insertBudget,
      destinations: audits,
      planRows: [],
      generatedCount: 0,
      generatedContentIds: [],
      warnings,
    };
  }

  const auditMap = new Map(audits.map((audit) => [audit.health.destinationId, audit]));
  const planRows: AutoRefillPlanRow[] = [];
  const usedContentIds = new Set<string>();
  let remainingInsertBudget = insertBudget;
  let remainingGenerateBudget = config.maxGeneratePerRun;
  let generatedCount = 0;
  const generatedContentIds: string[] = [];
  const gdtAudit = auditMap.get("youtube_gioi_dinh_tue");
  const reserveForPhatPhapCampaign =
    gdtAudit &&
    gdtAudit.health.channelId &&
    gdtAudit.isCanonical &&
    gdtAudit.gapSlots.length > 0
      ? 1
      : 0;

  const tangSauAudit = auditMap.get("youtube_tang_sau");
  if (tangSauAudit && tangSauAudit.health.channelId && !tangSauAudit.isCanonical) {
    console.log(
      `[autoRefill] SKIP_BACKUP_OAUTH channel_id=${tangSauAudit.health.channelId} ` +
      `canonical=${tangSauAudit.canonicalChannelId} ` +
      `destination=youtube_tang_sau`,
    );
  }
  if (tangSauAudit && tangSauAudit.health.channelId && tangSauAudit.isCanonical) {
    const tangSauBudget = Math.max(0, remainingInsertBudget - reserveForPhatPhapCampaign);
    const needed = Math.min(tangSauAudit.gapSlots.length, tangSauBudget);
    const localPool = [...tangSauAudit.candidates];
    for (let index = 0; index < needed; index += 1) {
      const slot = tangSauAudit.gapSlots[index];
      const candidate = pickCandidateForDestination("youtube_tang_sau", localPool, usedContentIds);
      if (candidate) {
        usedContentIds.add(candidate.contentId);
        planRows.push({
          destinationId: tangSauAudit.health.destinationId,
          workspaceId: tangSauAudit.health.workspaceId,
          platform: tangSauAudit.health.platform,
          channelId: tangSauAudit.health.channelId,
          channelName: tangSauAudit.health.channelName,
          formatType: candidate.formatType,
          contentId: candidate.contentId,
          topic: candidate.topic,
          scheduledAtUtc: slot.toISOString(),
          scheduledAtVn: formatVn(slot),
          action: "queue_existing",
        });
        continue;
      }

      if (remainingGenerateBudget <= 0) break;
      if (options.dryRun) {
        const previewItems = await previewQuoteGeneration({
          count: 1,
          workspaceId: "tang_sau_workspace",
          channelProfileId: "tang_sau_v1",
          durationSec: 14,
        });
        const preview = previewItems[0];
        if (!preview) break;
        generatedCount += 1;
        remainingGenerateBudget -= 1;
        planRows.push({
          destinationId: tangSauAudit.health.destinationId,
          workspaceId: tangSauAudit.health.workspaceId,
          platform: tangSauAudit.health.platform,
          channelId: tangSauAudit.health.channelId,
          channelName: tangSauAudit.health.channelName,
          formatType: "legacy_quote_short",
          contentId: null,
          topic: preview.topic,
          scheduledAtUtc: slot.toISOString(),
          scheduledAtVn: formatVn(slot),
          action: "generate_and_queue",
        });
        continue;
      }

      const generated = await generateTangSauQuoteBatch(1);
      const generatedCandidate = generated[0];
      if (!generatedCandidate) break;
      localPool.push(generatedCandidate);
      generatedCount += 1;
      generatedContentIds.push(generatedCandidate.contentId);
      remainingGenerateBudget -= 1;
      usedContentIds.add(generatedCandidate.contentId);
      planRows.push({
        destinationId: tangSauAudit.health.destinationId,
        workspaceId: tangSauAudit.health.workspaceId,
        platform: tangSauAudit.health.platform,
        channelId: tangSauAudit.health.channelId,
        channelName: tangSauAudit.health.channelName,
        formatType: generatedCandidate.formatType,
        contentId: generatedCandidate.contentId,
        topic: generatedCandidate.topic,
        scheduledAtUtc: slot.toISOString(),
        scheduledAtVn: formatVn(slot),
        action: "generate_and_queue",
      });
    }
    remainingInsertBudget -= planRows.filter((row) => row.destinationId === "youtube_tang_sau").length;
  }

  // Resolve the phat_phap Facebook channel for paired video-campaign rows.
  // facebook_tri_tue_an_nhien rows are evaluated here so its channelId is available
  // to the GDT section for pairing; the FB destination itself no longer independently
  // fills video rows (paired insertion happens below instead).
  const fbAudit = auditMap.get("facebook_tri_tue_an_nhien");
  if (fbAudit && fbAudit.health.channelId && !fbAudit.isCanonical) {
    console.log(
      `[autoRefill] SKIP_BACKUP_OAUTH channel_id=${fbAudit.health.channelId} ` +
      `canonical=${fbAudit.canonicalChannelId} ` +
      `destination=facebook_tri_tue_an_nhien`,
    );
  }
  const pairedFbChannelId: number | null =
    fbAudit?.isCanonical ? (fbAudit.health.channelId ?? null) : null;

  if (gdtAudit && gdtAudit.health.channelId && !gdtAudit.isCanonical) {
    console.log(
      `[autoRefill] SKIP_BACKUP_OAUTH channel_id=${gdtAudit.health.channelId} ` +
      `canonical=${gdtAudit.canonicalChannelId} ` +
      `destination=youtube_gioi_dinh_tue`,
    );
  }
  if (gdtAudit && gdtAudit.health.channelId && remainingInsertBudget > 0 && gdtAudit.isCanonical) {
    // VIDEO CAMPAIGN CALENDAR: 06:00–21:00 VN, hourly slots.
    // Rule: TTS short and legacy quote short must alternate.
    //   • Each slot = one video campaign = YT Short row + paired FB Reel row at the same scheduledAt.
    //   • Distinct content_ids must not share the same campaign hour (enforced by 60-min interval).
    //   • remainingInsertBudget counts campaigns, not individual rows (a paired FB Reel is not budgeted separately).

    const localPool = [...gdtAudit.candidates];

    // Determine which format to prefer next for alternating selection.
    let preferNextFormat: RefillFormat | null =
      gdtAudit.lastCampaignFormat === "tts_short" ? "legacy_quote_short" :
      gdtAudit.lastCampaignFormat === "legacy_quote_short" ? "tts_short" :
      null; // no history → use destination default (TTS first)

    for (const slot of gdtAudit.gapSlots) {
      if (remainingInsertBudget <= 0) break;
      const quoteRequiredNext = preferNextFormat === "legacy_quote_short";
      const candidate = quoteRequiredNext
        ? localPool.find((row) => row.formatType === "legacy_quote_short" && !usedContentIds.has(row.contentId)) ?? null
        : pickCandidateForDestination(
            "youtube_gioi_dinh_tue",
            localPool,
            usedContentIds,
            preferNextFormat,
          );

      if (!candidate && quoteRequiredNext) {
        if (remainingGenerateBudget <= 0) break;

        const generated = options.dryRun
          ? await previewPhatPhapQuoteBatch(1)
          : await generatePhatPhapQuoteBatch(1);
        const generatedCandidate = generated[0] ?? null;
        if (!generatedCandidate) break;

        generatedCount += 1;
        if (!options.dryRun) {
          generatedContentIds.push(generatedCandidate.contentId);
        }
        remainingGenerateBudget -= 1;
        usedContentIds.add(generatedCandidate.contentId);
        preferNextFormat = "tts_short";

        planRows.push({
          destinationId: gdtAudit.health.destinationId,
          workspaceId: gdtAudit.health.workspaceId,
          platform: gdtAudit.health.platform,
          channelId: gdtAudit.health.channelId,
          channelName: gdtAudit.health.channelName,
          formatType: "legacy_quote_short",
          contentId: options.dryRun ? null : generatedCandidate.contentId,
          topic: generatedCandidate.topic,
          scheduledAtUtc: slot.toISOString(),
          scheduledAtVn: formatVn(slot),
          action: "generate_and_queue",
          reason: "video_campaign_generated_quote_yt",
        });

        if (pairedFbChannelId) {
          planRows.push({
            destinationId: "facebook_tri_tue_an_nhien",
            workspaceId: gdtAudit.health.workspaceId,
            platform: "facebook",
            channelId: pairedFbChannelId,
            channelName: fbAudit?.health.channelName ?? "Trí Tuệ An Nhiên",
            formatType: "legacy_quote_short",
            contentId: options.dryRun ? null : generatedCandidate.contentId,
            topic: generatedCandidate.topic,
            scheduledAtUtc: slot.toISOString(),
            scheduledAtVn: formatVn(slot),
            action: "generate_and_queue",
            reason: "video_campaign_generated_quote_fb_reel",
          });
        }

        remainingInsertBudget -= 1;
        continue;
      }

      if (!candidate) break;
      usedContentIds.add(candidate.contentId);

      // After picking, flip preference for the next slot.
      preferNextFormat = candidate.formatType === "tts_short" ? "legacy_quote_short" : "tts_short";

      // YouTube Short row.
      planRows.push({
        destinationId: gdtAudit.health.destinationId,
        workspaceId: gdtAudit.health.workspaceId,
        platform: gdtAudit.health.platform,
        channelId: gdtAudit.health.channelId,
        channelName: gdtAudit.health.channelName,
        formatType: candidate.formatType,
        contentId: candidate.contentId,
        topic: candidate.topic,
        scheduledAtUtc: slot.toISOString(),
        scheduledAtVn: formatVn(slot),
        action: "queue_existing",
        reason: "video_campaign_yt",
      });

      // Paired Facebook Reel row at the same scheduledAt (same campaign hour).
      // This ensures phat_phap video campaigns always publish to both YT + FB simultaneously.
      if (pairedFbChannelId) {
        planRows.push({
          destinationId: "facebook_tri_tue_an_nhien",
          workspaceId: gdtAudit.health.workspaceId,
          platform: "facebook",
          channelId: pairedFbChannelId,
          channelName: fbAudit?.health.channelName ?? "Trí Tuệ An Nhiên",
          formatType: candidate.formatType,
          contentId: candidate.contentId,
          topic: candidate.topic,
          scheduledAtUtc: slot.toISOString(),
          scheduledAtVn: formatVn(slot),
          action: "queue_existing",
          reason: "video_campaign_fb_reel_paired",
        });
      }

      remainingInsertBudget -= 1; // one campaign = one budget unit (YT + FB together)
    }
  }

  const youtubeHealthy = ["youtube_tang_sau", "youtube_gioi_dinh_tue"].every((id) => {
    const audit = auditMap.get(id as DestinationId);
    return !audit || audit.gapSlots.length === 0 || planRows.some((row) => row.destinationId === id);
  });

  // FACEBOOK-ONLY POST CALENDAR: 08:00–21:00 VN.
  // Rule: Quote/photo/text posts only. Must NOT block or count against video campaign slots.
  // Video campaign FB Reel rows are inserted as paired rows in the GDT section above —
  // the facebook_tri_tue_an_nhien destination no longer independently fills FB video rows.
  //
  // FB-only post auto-fill is not yet implemented here. Operator-initiated scheduling
  // (schedule-mixer with platform=facebook, videoType=quote) handles this separately.
  if (fbAudit?.health.channelId && breakdown.facebookPending >= FACEBOOK_TOTAL_SOFT_CAP && youtubeHealthy) {
    warnings.push("facebook_total_soft_cap_exceeded");
  }

  return {
    pendingBefore,
    pendingAfter: pendingBefore + planRows.length,
    insertBudget,
    destinations: audits,
    planRows,
    generatedCount,
    generatedContentIds,
    warnings,
  };
}

/**
 * Pre-resolves sibling channel IDs (same physical platform channel, different OAuth credentials)
 * for each unique YouTube channel appearing in planRows. Cached by channelId to avoid redundant
 * DB queries when multiple plan rows share the same channel.
 *
 * Used by insertQueueRows to enforce cross-credential deduplication: inserting a YouTube row
 * on ch1 at 08:00 must be blocked if ch3 already has a row at 08:00 for the same platform channel.
 */
async function resolveSiblingChannelIdMap(
  planRows: AutoRefillPlanRow[],
): Promise<Map<number, number[]>> {
  const youtubeChannelIds = [...new Set(
    planRows.filter((r) => r.platform === "youtube").map((r) => r.channelId),
  )];
  if (youtubeChannelIds.length === 0) return new Map();

  const channelMeta = await db.query.socialChannels.findMany({
    where: inArray(socialChannels.id, youtubeChannelIds),
    columns: { id: true, platform: true, platformChannelId: true },
  });

  const siblingMap = new Map<number, number[]>();
  for (const ch of channelMeta) {
    if (!ch.platformChannelId) {
      siblingMap.set(ch.id, [ch.id]);
      continue;
    }
    const siblings = await getAllSiblingChannelIds(
      ch.platform as DestinationPlatform,
      ch.platformChannelId,
    );
    siblingMap.set(ch.id, siblings.length > 0 ? siblings : [ch.id]);
  }
  return siblingMap;
}

async function insertQueueRows(planRows: AutoRefillPlanRow[]): Promise<string[]> {
  const createdIds: string[] = [];
  if (planRows.length === 0) return createdIds;

  const contentIds = planRows.map((row) => row.contentId).filter(Boolean) as string[];
  const [contentRows, siblingChannelIdMap] = await Promise.all([
    db.query.contentGenerations.findMany({
      where: inArray(contentGenerations.id, contentIds),
      columns: {
        id: true,
        topic: true,
        contentProfileKey: true,
        shortContent: true,
        longContent: true,
        longYoutubeDescription: true,
        nicheName: true,
      },
    }),
    resolveSiblingChannelIdMap(planRows),
  ]);
  const contentMap = new Map(contentRows.map((row) => [row.id, row]));

  for (const row of planRows) {
    if (!row.contentId) continue;
    const content = contentMap.get(row.contentId);
    if (!content) continue;
    const scheduledAt = new Date(row.scheduledAtUtc);
    if (scheduledAt.getTime() <= Date.now()) continue;

    // ── Duplicate check ────────────────────────────────────────────────────
    //
    // YouTube: check across ALL sibling credential rows (same physical channel,
    // different OAuth rows — e.g. phat_phap ch1/ch2/ch3/ch4).
    //   Blocks: same content_id on any sibling channel (prevents re-queuing).
    //           same scheduledAt on any sibling channel (enforces one campaign per hour).
    //   No videoType filter: YouTube only ever has "short" rows; any same-slot
    //   conflict is always a duplicate video campaign collision.
    //
    // Facebook: check on this channel only (each brand has one FB credential).
    //   Blocks: same content_id (prevents re-queuing).
    //           same scheduledAt AND same videoType (prevents two FB Reels at 08:00).
    //   Allows: different videoTypes at the same time (FB quote post + FB Reel at 08:00
    //           are two distinct posts, not duplicates).
    let duplicateCount = 0;

    if (row.platform === "youtube") {
      const siblingIds = siblingChannelIdMap.get(row.channelId) ?? [row.channelId];
      const dups = await db.query.uploadQueue.findMany({
        where: and(
          inArray(uploadQueue.channelId, siblingIds),
          inArray(uploadQueue.status, ["queued", "uploading", "done", "cancelled"]),
          or(
            eq(uploadQueue.contentId, row.contentId),
            eq(uploadQueue.scheduledAt, scheduledAt),
          ),
        ),
        columns: { id: true },
        limit: 1,
      });
      duplicateCount = dups.length;
    } else {
      // Facebook (and any future non-YT platform): single-channel check with videoType filter.
      const dups = await db.query.uploadQueue.findMany({
        where: and(
          eq(uploadQueue.channelId, row.channelId),
          inArray(uploadQueue.status, ["queued", "uploading", "done", "cancelled"]),
          or(
            eq(uploadQueue.contentId, row.contentId),
            and(
              eq(uploadQueue.scheduledAt, scheduledAt),
              eq(uploadQueue.videoType, "short"),
            ),
          ),
        ),
        columns: { id: true },
        limit: 1,
      });
      duplicateCount = dups.length;
    }

    if (duplicateCount > 0) continue;
    const [created] = await db.insert(uploadQueue).values({
      id: randomUUID(),
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
      privacyStatus: "public",
      scheduledAt,
      status: "queued",
    }).returning({ id: uploadQueue.id });
    createdIds.push(created.id);
  }

  return createdIds;
}

export async function runAutoRefillWatcher(input?: {
  dryRun?: boolean;
  source?: AutoRefillSource;
}): Promise<AutoRefillRunResult> {
  const dryRun = input?.dryRun ?? false;
  const source = input?.source ?? "manual";
  const config = getAutoRefillConfig();
  const now = new Date();
  const pendingBefore = await getPendingCount();
  const audits = await auditAllDestinations(now);
  const destinations = audits.map((audit) => audit.health);

  const baseResult = {
    ok: true,
    dryRun,
    source,
    config,
    destinations,
    insertedQueueIds: [] as string[],
    generatedContentIds: [] as string[],
    generatedCount: 0,
    insertedCount: 0,
    lastStateSaved: false,
  };

  if (!config.enabled) {
    return {
      ...baseResult,
      skipped: true,
      reason: "disabled",
      pendingBefore,
      pendingAfter: pendingBefore,
      insertBudget: 0,
      warnings: [],
      planRows: [],
    };
  }

  if (pendingBefore >= config.lowWaterMark) {
    if (dryRun) {
      const built = await buildPlan(config, now, { dryRun: true });
      return {
        ...baseResult,
        skipped: true,
        reason: "pending_above_low_watermark",
        pendingBefore: built.pendingBefore,
        pendingAfter: built.pendingAfter,
        insertBudget: built.insertBudget,
        warnings: built.warnings,
        planRows: built.planRows,
        generatedCount: built.generatedCount,
        generatedContentIds: built.generatedContentIds,
      };
    }

    const result: AutoRefillRunResult = {
      ...baseResult,
      skipped: true,
      reason: "pending_above_low_watermark",
      pendingBefore,
      pendingAfter: pendingBefore,
      insertBudget: 0,
      warnings: [],
      planRows: [],
    };
    if (!dryRun) {
      await savePersistedState({
        ranAt: new Date().toISOString(),
        source,
        dryRun,
        skipped: true,
        reason: result.reason,
        pendingBefore,
        pendingAfter: pendingBefore,
        insertBudget: 0,
        generatedCount: 0,
        insertedCount: 0,
        destinationsFilled: [],
        warnings: [],
      });
      result.lastStateSaved = true;
    }
    return result;
  }

  const built = await buildPlan(config, now, { dryRun });
  if (built.insertBudget <= 0 || built.planRows.length === 0) {
    const result: AutoRefillRunResult = {
      ...baseResult,
      skipped: true,
      reason: built.insertBudget <= 0 ? "no_insert_budget" : "no_safe_slots",
      pendingBefore: built.pendingBefore,
      pendingAfter: built.pendingAfter,
      insertBudget: built.insertBudget,
      warnings: built.warnings,
      planRows: built.planRows,
      generatedCount: built.generatedCount,
      generatedContentIds: built.generatedContentIds,
    };
    if (!dryRun) {
      await savePersistedState({
        ranAt: new Date().toISOString(),
        source,
        dryRun,
        skipped: true,
        reason: result.reason,
        pendingBefore: result.pendingBefore,
        pendingAfter: result.pendingAfter,
        insertBudget: result.insertBudget,
        generatedCount: result.generatedCount,
        insertedCount: 0,
        destinationsFilled: [],
        warnings: result.warnings,
      });
      result.lastStateSaved = true;
    }
    return result;
  }

  if (dryRun) {
    return {
      ...baseResult,
      skipped: false,
      reason: null,
      pendingBefore: built.pendingBefore,
      pendingAfter: built.pendingAfter,
      insertBudget: built.insertBudget,
      warnings: built.warnings,
      planRows: built.planRows,
      generatedCount: built.generatedCount,
      generatedContentIds: built.generatedContentIds,
    };
  }

  const insertedQueueIds = await insertQueueRows(built.planRows);
  const pendingAfter = built.pendingBefore + insertedQueueIds.length;
  const result: AutoRefillRunResult = {
    ...baseResult,
    skipped: false,
    reason: null,
    pendingBefore: built.pendingBefore,
    pendingAfter,
    insertBudget: built.insertBudget,
    warnings: built.warnings,
    planRows: built.planRows,
    generatedCount: built.generatedCount,
    generatedContentIds: built.generatedContentIds,
    insertedCount: insertedQueueIds.length,
    insertedQueueIds,
  };

  await savePersistedState({
    ranAt: new Date().toISOString(),
    source,
    dryRun,
    skipped: false,
    reason: null,
    pendingBefore: result.pendingBefore,
    pendingAfter: result.pendingAfter,
    insertBudget: result.insertBudget,
    generatedCount: result.generatedCount,
    insertedCount: result.insertedCount,
    destinationsFilled: Array.from(new Set(result.planRows.map((row) => row.destinationId))),
    warnings: result.warnings,
  });
  result.lastStateSaved = true;
  return result;
}
