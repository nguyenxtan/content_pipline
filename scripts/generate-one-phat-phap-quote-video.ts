import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { generateQuoteShortsAction } from "@/actions/quote-generator";
import { PHAT_PHAP_SPRINT, pickBuddhistSprintTopicFamily, sprintAllocationSummary } from "@/lib/config/sprint-config";
import { db } from "@/lib/db";
import { contentGenerations, socialChannels, uploadQueue } from "@/lib/db/schema";
import { getWorkspaceById } from "@/lib/channel-workspace-registry";
import { buildDefaultVideoDescription, buildDefaultVideoTitle } from "@/lib/social/youtube-metadata";

const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
const VN_OFFSET_HOURS = 7;
const WINDOW_START_MINUTES = 6 * 60;
const WINDOW_END_MINUTES = 22 * 60;
const ACTIVE_QUEUE_STATUSES = ["queued", "uploading", "done", "cancelled"] as const;

type DestinationPlatform = "youtube" | "facebook";

type Destination = {
  destinationId: "youtube_gioi_dinh_tue" | "facebook_tri_tue_an_nhien";
  platform: DestinationPlatform;
  platformChannelId: string;
  channelId: number;
  channelName: string;
  siblingChannelIds: number[];
};

type SmokeArgs = {
  apply: boolean;
  dryRun: boolean;
  slotIso: string | null;
  nextValidSlot: boolean;
  titlePrefix: string | null;
  allowNonEmptyQueue: boolean;
};

type SlotCheck = {
  ok: boolean;
  scheduledAtUtc: string | null;
  scheduledAtVn: string | null;
  insideWindow: boolean;
  isTopOfHour: boolean;
  isFuture: boolean;
  collisions: Array<{
    rowId: string;
    contentId: string;
    platform: string;
    videoType: string;
    status: string;
    scheduledAtUtc: string;
    scheduledAtVn: string;
  }>;
  reason: string | null;
};

function parseArgs(argv: string[]): SmokeArgs {
  let slotIso: string | null = null;
  let nextValidSlot = false;
  let apply = false;
  let titlePrefix: string | null = null;
  let allowNonEmptyQueue = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      continue;
    }
    if (arg === "--slot") {
      slotIso = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--next-valid-slot") {
      nextValidSlot = true;
      continue;
    }
    if (arg === "--title-prefix") {
      titlePrefix = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--allow-non-empty-queue") {
      allowNonEmptyQueue = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    apply,
    dryRun: !apply,
    slotIso,
    nextValidSlot,
    titlePrefix,
    allowNonEmptyQueue,
  };
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isInsidePublishingWindow(date: Date): boolean {
  const parts = toVnParts(date);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  return minuteOfDay >= WINDOW_START_MINUTES && minuteOfDay < WINDOW_END_MINUTES;
}

function isTopOfHour(date: Date): boolean {
  const parts = toVnParts(date);
  return parts.minute === 0;
}

function ceilToNextHourInVn(now: Date): Date {
  const parts = toVnParts(now);
  const base = fromVnLocal(parts.year, parts.month, parts.day, parts.hour, 0);
  return new Date(base.getTime() + 60 * 60_000);
}

async function resolveCanonicalChannelId(
  platform: DestinationPlatform,
  platformChannelId: string,
  channelKey: string,
): Promise<number | null> {
  const { sql } = await import("drizzle-orm");
  const result = await db.execute<{ id: number }>(sql`
    SELECT
      sc.id
    FROM social_channels sc
    LEFT JOIN upload_queue uq ON uq.channel_id = sc.id
    WHERE sc.platform = ${platform}
      AND sc.platform_channel_id = ${platformChannelId}
    GROUP BY sc.id, sc.channel_key, sc.is_active, sc.needs_reconnect
    ORDER BY
      CASE WHEN sc.channel_key = ${channelKey} THEN 0 ELSE 1 END ASC,
      CASE WHEN sc.is_active = true AND sc.needs_reconnect = false THEN 0 ELSE 1 END ASC,
      COUNT(uq.id) DESC
    LIMIT 1
  `);
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

async function getSiblingChannelIds(
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
  return rows.map((row) => row.id);
}

async function getDestinations(): Promise<{ youtube: Destination; facebook: Destination }> {
  const workspace = getWorkspaceById("buddhist_healing_workspace");
  if (!workspace) {
    throw new Error("Missing buddhist_healing_workspace");
  }

  const youtubeAccount = workspace.platformAccounts.find((account) => account.platform === "youtube");
  const facebookAccount = workspace.platformAccounts.find((account) => account.platform === "facebook");
  if (!youtubeAccount || !facebookAccount) {
    throw new Error("Missing phat_phap platform account mapping");
  }

  const [youtubeCanonicalId, facebookCanonicalId, youtubeSiblingIds, facebookSiblingIds] = await Promise.all([
    resolveCanonicalChannelId("youtube", youtubeAccount.platformChannelId, "phat_phap"),
    resolveCanonicalChannelId("facebook", facebookAccount.platformChannelId, "phat_phap"),
    getSiblingChannelIds("youtube", youtubeAccount.platformChannelId),
    getSiblingChannelIds("facebook", facebookAccount.platformChannelId),
  ]);

  if (!youtubeCanonicalId || !facebookCanonicalId) {
    throw new Error("Missing canonical social channel mapping for phat_phap");
  }

  return {
    youtube: {
      destinationId: "youtube_gioi_dinh_tue",
      platform: "youtube",
      platformChannelId: youtubeAccount.platformChannelId,
      channelId: youtubeCanonicalId,
      channelName: youtubeAccount.displayName,
      siblingChannelIds: youtubeSiblingIds.length > 0 ? youtubeSiblingIds : [youtubeCanonicalId],
    },
    facebook: {
      destinationId: "facebook_tri_tue_an_nhien",
      platform: "facebook",
      platformChannelId: facebookAccount.platformChannelId,
      channelId: facebookCanonicalId,
      channelName: facebookAccount.displayName,
      siblingChannelIds: facebookSiblingIds.length > 0 ? facebookSiblingIds : [facebookCanonicalId],
    },
  };
}

async function getFutureShortQueueDepth(destinations: { youtube: Destination; facebook: Destination }): Promise<number> {
  const rows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.channelId, [
        ...destinations.youtube.siblingChannelIds,
        destinations.facebook.channelId,
      ]),
      inArray(uploadQueue.status, [...ACTIVE_QUEUE_STATUSES]),
      eq(uploadQueue.videoType, "short"),
    ),
    columns: {
      id: true,
      scheduledAt: true,
    },
  });
  return rows.filter((row) => row.scheduledAt.getTime() > Date.now()).length;
}

async function getSlotCollisions(
  destinations: { youtube: Destination; facebook: Destination },
  slot: Date,
): Promise<SlotCheck["collisions"]> {
  const rows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.status, [...ACTIVE_QUEUE_STATUSES]),
      eq(uploadQueue.scheduledAt, slot),
      inArray(uploadQueue.channelId, [
        ...destinations.youtube.siblingChannelIds,
        destinations.facebook.channelId,
      ]),
    ),
    columns: {
      id: true,
      contentId: true,
      platform: true,
      videoType: true,
      status: true,
      scheduledAt: true,
    },
  });

  return rows.filter((row) =>
    row.platform === "youtube" ||
    (row.platform === "facebook" && row.videoType === "short"),
  ).map((row) => ({
    rowId: row.id,
    contentId: row.contentId,
    platform: row.platform,
    videoType: row.videoType,
    status: row.status,
    scheduledAtUtc: row.scheduledAt.toISOString(),
    scheduledAtVn: formatVn(row.scheduledAt),
  }));
}

async function inspectSlot(
  destinations: { youtube: Destination; facebook: Destination },
  slot: Date,
): Promise<SlotCheck> {
  const insideWindow = isInsidePublishingWindow(slot);
  const topOfHour = isTopOfHour(slot);
  const future = slot.getTime() > Date.now();
  const collisions = await getSlotCollisions(destinations, slot);

  let reason: string | null = null;
  if (!future) {
    reason = "slot_not_in_future";
  } else if (!insideWindow) {
    reason = "slot_outside_vn_window";
  } else if (!topOfHour) {
    reason = "slot_not_top_of_hour";
  } else if (collisions.length > 0) {
    reason = "slot_already_occupied";
  }

  return {
    ok: reason === null,
    scheduledAtUtc: slot.toISOString(),
    scheduledAtVn: formatVn(slot),
    insideWindow,
    isTopOfHour: topOfHour,
    isFuture: future,
    collisions,
    reason,
  };
}

async function findNextValidSlot(destinations: { youtube: Destination; facebook: Destination }): Promise<SlotCheck> {
  let cursor = ceilToNextHourInVn(new Date());
  for (let i = 0; i < 96; i += 1) {
    const inspected = await inspectSlot(destinations, cursor);
    if (inspected.ok) return inspected;
    cursor = new Date(cursor.getTime() + 60 * 60_000);
  }

  return {
    ok: false,
    scheduledAtUtc: null,
    scheduledAtVn: null,
    insideWindow: false,
    isTopOfHour: false,
    isFuture: false,
    collisions: [],
    reason: "no_valid_slot_found_in_next_96_hours",
  };
}

function buildQueueTitle(
  baseTitle: string,
  titlePrefix: string | null,
): string {
  if (!titlePrefix?.trim()) return baseTitle;
  return `${titlePrefix.trim()} | ${baseTitle}`;
}

async function generateOnePhatPhapQuote() {
  const sprintFamily = pickBuddhistSprintTopicFamily("phat_phap") ?? undefined;
  if (sprintFamily) {
    console.log(`[smoke] ${sprintAllocationSummary(PHAT_PHAP_SPRINT)} → selected="${sprintFamily}"`);
  }

  const generated = await generateQuoteShortsAction({
    count: 1,
    workspaceId: "buddhist_healing_workspace",
    channelProfileId: "buddhist_healing_v1",
    durationSec: 14,
    topicFamily: sprintFamily,
  });

  if (!generated.ok) {
    throw new Error(generated.error ?? "quote_generation_failed");
  }

  const success = generated.results.find((result) => result.ok && result.videoPath);
  if (!success) {
    throw new Error("quote_generation_returned_no_successful_video");
  }

  return {
    contentId: success.contentId,
    topic: success.topic,
    videoPath: success.videoPath,
  };
}

async function insertQueueRowsForContent(input: {
  contentId: string;
  scheduledAt: Date;
  titlePrefix: string | null;
  destinations: { youtube: Destination; facebook: Destination };
}) {
  const content = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, input.contentId),
    columns: {
      id: true,
      topic: true,
      formatType: true,
      videoPath: true,
      nicheName: true,
      shortContent: true,
      longContent: true,
      longYoutubeDescription: true,
      contentProfileKey: true,
    },
  });

  if (!content) {
    throw new Error(`Generated content not found: ${input.contentId}`);
  }

  const rows = [
    { platform: "youtube" as const, channelId: input.destinations.youtube.channelId, channelName: input.destinations.youtube.channelName },
    { platform: "facebook" as const, channelId: input.destinations.facebook.channelId, channelName: input.destinations.facebook.channelName },
  ];

  const createdQueueIds = await db.transaction(async (tx) => {
    const collisions = await tx.query.uploadQueue.findMany({
      where: and(
        inArray(uploadQueue.status, [...ACTIVE_QUEUE_STATUSES]),
        eq(uploadQueue.scheduledAt, input.scheduledAt),
        inArray(uploadQueue.channelId, [
          ...input.destinations.youtube.siblingChannelIds,
          input.destinations.facebook.channelId,
        ]),
      ),
      columns: {
        id: true,
        platform: true,
        videoType: true,
      },
    });

    const blocked = collisions.filter((row) =>
      row.platform === "youtube" ||
      (row.platform === "facebook" && row.videoType === "short"),
    );
    if (blocked.length > 0) {
      throw new Error("slot_became_occupied_before_insert");
    }

    const queueIds: string[] = [];
    for (const row of rows) {
      const baseTitle = buildDefaultVideoTitle({
        platform: row.platform,
        contentType: "short",
        topic: content.topic,
        contentProfileKey: content.contentProfileKey,
        shortContent: content.shortContent,
      });
      const [inserted] = await tx.insert(uploadQueue).values({
        id: randomUUID(),
        contentId: content.id,
        channelId: row.channelId,
        platform: row.platform,
        videoType: "short",
        title: buildQueueTitle(baseTitle, input.titlePrefix),
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
        scheduledAt: input.scheduledAt,
        status: "queued",
      }).returning({ id: uploadQueue.id });
      queueIds.push(inserted.id);
    }
    return queueIds;
  });

  return {
    content,
    createdQueueIds,
  };
}

async function verifyInsertedContent(contentId: string) {
  const [content, queueRows] = await Promise.all([
    db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, contentId),
      columns: {
        id: true,
        formatType: true,
        videoPath: true,
      },
    }),
    db.query.uploadQueue.findMany({
      where: eq(uploadQueue.contentId, contentId),
      columns: {
        id: true,
        platform: true,
        videoType: true,
        status: true,
        scheduledAt: true,
      },
      orderBy: (table, { asc }) => [asc(table.platform)],
    }),
  ]);

  return {
    content,
    queueRows: queueRows.map((row) => ({
      id: row.id,
      platform: row.platform,
      videoType: row.videoType,
      status: row.status,
      scheduledAtUtc: row.scheduledAt.toISOString(),
      scheduledAtVn: formatVn(row.scheduledAt),
    })),
    hasFacebookQuoteRow: queueRows.some((row) => row.platform === "facebook" && row.videoType === "quote"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const destinations = await getDestinations();
  const futureShortQueueDepth = await getFutureShortQueueDepth(destinations);

  let slotCheck: SlotCheck;
  const selectionMode = args.slotIso
    ? "provided_slot"
    : args.nextValidSlot
      ? "next_valid_slot"
      : "next_valid_slot";

  if (args.slotIso) {
    const parsed = new Date(args.slotIso);
    if (Number.isNaN(parsed.getTime())) {
      slotCheck = {
        ok: false,
        scheduledAtUtc: null,
        scheduledAtVn: null,
        insideWindow: false,
        isTopOfHour: false,
        isFuture: false,
        collisions: [],
        reason: "invalid_slot",
      };
    } else {
      slotCheck = await inspectSlot(destinations, parsed);
    }
  } else {
    slotCheck = await findNextValidSlot(destinations);
  }

  const applyRefusals: string[] = [];
  if (!args.allowNonEmptyQueue && futureShortQueueDepth > 0) {
    applyRefusals.push("future_short_queue_not_empty");
  }
  if (!slotCheck.ok) {
    applyRefusals.push(slotCheck.reason ?? "slot_invalid");
  }

  const plannedRows = slotCheck.scheduledAtUtc ? [
    {
      destinationId: destinations.youtube.destinationId,
      platform: "youtube",
      channelId: destinations.youtube.channelId,
      channelName: destinations.youtube.channelName,
      videoType: "short",
      scheduledAtUtc: slotCheck.scheduledAtUtc,
      scheduledAtVn: slotCheck.scheduledAtVn,
    },
    {
      destinationId: destinations.facebook.destinationId,
      platform: "facebook",
      channelId: destinations.facebook.channelId,
      channelName: destinations.facebook.channelName,
      videoType: "short",
      scheduledAtUtc: slotCheck.scheduledAtUtc,
      scheduledAtVn: slotCheck.scheduledAtVn,
    },
  ] : [];

  const dryRunPayload = {
    ok: applyRefusals.length === 0,
    mode: args.apply ? "apply" : "dry_run",
    dryRun: args.dryRun,
    selectionMode,
    autoRefillGuardUntouched: true,
    selectedSlotUtc: slotCheck.scheduledAtUtc,
    selectedSlotVn: slotCheck.scheduledAtVn,
    insideVnWindow: slotCheck.insideWindow,
    topOfHour: slotCheck.isTopOfHour,
    futureShortQueueDepth,
    allowNonEmptyQueue: args.allowNonEmptyQueue,
    wouldGenerate: slotCheck.ok,
    formatType: "legacy_quote_short",
    collisionCount: slotCheck.collisions.length,
    collisions: slotCheck.collisions,
    plannedRows,
    refusalReasons: applyRefusals,
  };

  if (!args.apply) {
    console.log(JSON.stringify(dryRunPayload, null, 2));
    return;
  }

  if (applyRefusals.length > 0 || !slotCheck.scheduledAtUtc) {
    console.log(JSON.stringify(dryRunPayload, null, 2));
    process.exit(2);
  }

  const generated = await generateOnePhatPhapQuote();
  const scheduledAt = new Date(slotCheck.scheduledAtUtc);
  const inserted = await insertQueueRowsForContent({
    contentId: generated.contentId,
    scheduledAt,
    titlePrefix: args.titlePrefix,
    destinations,
  });
  const verification = await verifyInsertedContent(generated.contentId);

  console.log(JSON.stringify({
    ...dryRunPayload,
    generatedContentId: generated.contentId,
    generatedTopic: generated.topic,
    generatedVideoPath: generated.videoPath,
    createdQueueIds: inserted.createdQueueIds,
    verification,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
