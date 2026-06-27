import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentGenerations, socialChannels, uploadQueue } from "@/lib/db/schema";
import { getWorkspaceById } from "@/lib/channel-workspace-registry";
import { buildDefaultVideoDescription, buildDefaultVideoTitle } from "@/lib/social/youtube-metadata";

const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
const SCOPE_FORMATS = ["tts_short", "legacy_quote_short"] as const;
const ACTIVE_STATUSES = ["queued", "uploading", "pending"] as const;

type DestinationPlatform = "youtube" | "facebook";
type QueueStatus = typeof ACTIVE_STATUSES[number] | "done" | "error" | "cancelled";
type ScopeFormat = typeof SCOPE_FORMATS[number];
type Diagnosis =
  | "complete_pair"
  | "missing_youtube"
  | "missing_facebook"
  | "misaligned_slots"
  | "wrong_lane"
  | "manual_review_required";
type PlannedAction =
  | "create_youtube_row"
  | "create_facebook_row"
  | "align_youtube_slot"
  | "align_facebook_slot"
  | "skip";

type Args = {
  apply: boolean;
  dryRun: boolean;
  from: Date;
  to: Date;
  contentId: string | null;
};

type Destination = {
  platform: DestinationPlatform;
  channelId: number;
  channelName: string;
  siblingChannelIds: number[];
};

type QueueEvidenceRow = {
  id: string;
  contentId: string;
  platform: string;
  videoType: string;
  status: QueueStatus;
  scheduledAt: Date;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: string;
  channelId: number;
};

type ContentScope = {
  id: string;
  topic: string;
  formatType: ScopeFormat;
  channelKey: string;
  nicheName: string;
  shortContent: string;
  longContent: string;
  longYoutubeDescription: string | null;
  contentProfileKey: string;
  scopedRows: QueueEvidenceRow[];
  allRows: QueueEvidenceRow[];
};

type PlanItem = {
  contentId: string;
  title: string;
  formatType: ScopeFormat;
  existingPlatformRows: string[];
  expectedRows: string[];
  diagnosis: Diagnosis;
  plannedAction: PlannedAction;
  reason: string;
  scheduledAtUtc: string | null;
  scheduledAtVn: string | null;
  cleanupEligibilityRisk: "blocked" | "paired";
};

function parseArgs(argv: string[]): Args {
  let apply = false;
  let from: Date | null = null;
  let to: Date | null = null;
  let contentId: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      continue;
    }
    if (arg === "--from") {
      from = new Date(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--to") {
      to = new Date(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--content-id") {
      contentId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const defaultFrom = new Date();
  const defaultTo = new Date(defaultFrom.getTime() + 72 * 60 * 60_000);
  const finalFrom = from ?? defaultFrom;
  const finalTo = to ?? defaultTo;

  if (Number.isNaN(finalFrom.getTime()) || Number.isNaN(finalTo.getTime())) {
    throw new Error("Invalid --from or --to");
  }
  if (finalFrom.getTime() >= finalTo.getTime()) {
    throw new Error("--from must be earlier than --to");
  }

  return {
    apply,
    dryRun: !apply,
    from: finalFrom,
    to: finalTo,
    contentId,
  };
}

function formatVn(date: Date | null): string | null {
  if (!date) return null;
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

async function getSiblingChannelIds(platform: DestinationPlatform, platformChannelId: string): Promise<number[]> {
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
  if (!workspace) throw new Error("Missing buddhist_healing_workspace");

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
    throw new Error("Missing canonical social channel mapping");
  }

  return {
    youtube: {
      platform: "youtube",
      channelId: youtubeCanonicalId,
      channelName: youtubeAccount.displayName,
      siblingChannelIds: youtubeSiblingIds.length > 0 ? youtubeSiblingIds : [youtubeCanonicalId],
    },
    facebook: {
      platform: "facebook",
      channelId: facebookCanonicalId,
      channelName: facebookAccount.displayName,
      siblingChannelIds: facebookSiblingIds.length > 0 ? facebookSiblingIds : [facebookCanonicalId],
    },
  };
}

async function loadScopedContent(args: Args): Promise<ContentScope[]> {
  const scopedQueueRows = await db.query.uploadQueue.findMany({
    where: and(
      gte(uploadQueue.scheduledAt, args.from),
      lte(uploadQueue.scheduledAt, args.to),
    ),
    with: {
      content: {
        columns: {
          id: true,
          topic: true,
          formatType: true,
          channelKey: true,
          nicheName: true,
          shortContent: true,
          longContent: true,
          longYoutubeDescription: true,
          contentProfileKey: true,
        },
      },
    },
    columns: {
      id: true,
      contentId: true,
      platform: true,
      videoType: true,
      status: true,
      scheduledAt: true,
      title: true,
      description: true,
      tags: true,
      privacyStatus: true,
      channelId: true,
    },
  });

  const filteredScopedRows = scopedQueueRows.filter((row) => {
    const inScopeContent =
      row.content.channelKey === "phat_phap" &&
      SCOPE_FORMATS.includes(row.content.formatType as ScopeFormat);
    const inScopeLane =
      (row.videoType === "short" && (row.platform === "youtube" || row.platform === "facebook")) ||
      (row.platform === "facebook" && row.videoType === "quote");
    const matchesContentId = args.contentId ? row.contentId === args.contentId : true;
    return inScopeContent && inScopeLane && matchesContentId;
  });

  const candidateContentIds = new Set(filteredScopedRows.map((row) => row.contentId));
  if (args.contentId) {
    candidateContentIds.add(args.contentId);
  }

  const contentIds = [...candidateContentIds];
  if (contentIds.length === 0) return [];

  const [contentRows, allQueueRows] = await Promise.all([
    db.query.contentGenerations.findMany({
      where: and(
        inArray(contentGenerations.id, contentIds),
        eq(contentGenerations.channelKey, "phat_phap"),
        inArray(contentGenerations.formatType, [...SCOPE_FORMATS]),
      ),
      columns: {
        id: true,
        topic: true,
        formatType: true,
        channelKey: true,
        nicheName: true,
        shortContent: true,
        longContent: true,
        longYoutubeDescription: true,
        contentProfileKey: true,
      },
    }),
    db.query.uploadQueue.findMany({
      where: inArray(uploadQueue.contentId, contentIds),
      columns: {
        id: true,
        contentId: true,
        platform: true,
        videoType: true,
        status: true,
        scheduledAt: true,
        title: true,
        description: true,
        tags: true,
        privacyStatus: true,
        channelId: true,
      },
    }),
  ]);

  const scopedMap = new Map<string, QueueEvidenceRow[]>();
  for (const row of filteredScopedRows) {
    const current = scopedMap.get(row.contentId) ?? [];
    current.push({
      id: row.id,
      contentId: row.contentId,
      platform: row.platform,
      videoType: row.videoType,
      status: row.status as QueueStatus,
      scheduledAt: row.scheduledAt,
      title: row.title,
      description: row.description,
      tags: row.tags as string[],
      privacyStatus: row.privacyStatus,
      channelId: row.channelId,
    });
    scopedMap.set(row.contentId, current);
  }

  const allMap = new Map<string, QueueEvidenceRow[]>();
  for (const row of allQueueRows) {
    const current = allMap.get(row.contentId) ?? [];
    current.push({
      id: row.id,
      contentId: row.contentId,
      platform: row.platform,
      videoType: row.videoType,
      status: row.status as QueueStatus,
      scheduledAt: row.scheduledAt,
      title: row.title,
      description: row.description,
      tags: row.tags as string[],
      privacyStatus: row.privacyStatus,
      channelId: row.channelId,
    });
    allMap.set(row.contentId, current);
  }

  return contentRows.map((content) => ({
    id: content.id,
    title: content.topic,
    topic: content.topic,
    formatType: content.formatType as ScopeFormat,
    channelKey: content.channelKey,
    nicheName: content.nicheName,
    shortContent: content.shortContent,
    longContent: content.longContent,
    longYoutubeDescription: content.longYoutubeDescription,
    contentProfileKey: content.contentProfileKey,
    scopedRows: scopedMap.get(content.id) ?? [],
    allRows: allMap.get(content.id) ?? [],
  }));
}

function isActiveFutureRow(row: QueueEvidenceRow): boolean {
  return ACTIVE_STATUSES.includes(row.status as typeof ACTIVE_STATUSES[number]) && row.scheduledAt.getTime() > Date.now();
}

async function hasSlotCollision(
  destination: Destination,
  scheduledAt: Date,
  excludedRowIds: string[],
): Promise<boolean> {
  const rows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.channelId, destination.platform === "youtube" ? destination.siblingChannelIds : [destination.channelId]),
      eq(uploadQueue.scheduledAt, scheduledAt),
      eq(uploadQueue.videoType, "short"),
      inArray(uploadQueue.status, [...ACTIVE_STATUSES, "done"]),
    ),
    columns: { id: true },
  });
  return rows.some((row) => !excludedRowIds.includes(row.id));
}

function buildExistingRowLabels(rows: QueueEvidenceRow[]): string[] {
  return rows
    .slice()
    .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime())
    .map((row) => `${row.platform}/${row.videoType}/${row.status}@${row.scheduledAt.toISOString()}`);
}

async function buildPlanItem(
  content: ContentScope,
  destinations: { youtube: Destination; facebook: Destination },
): Promise<PlanItem> {
  const shortRows = content.scopedRows.filter((row) => row.videoType === "short");
  const wrongLaneRows = content.scopedRows.filter((row) => row.platform === "facebook" && row.videoType === "quote");
  const ytShortRows = shortRows.filter((row) => row.platform === "youtube");
  const fbShortRows = shortRows.filter((row) => row.platform === "facebook");
  const existingPlatformRows = buildExistingRowLabels(content.scopedRows);

  const base = {
    contentId: content.id,
    title: content.topic,
    formatType: content.formatType,
    existingPlatformRows,
    expectedRows: ["youtube/short", "facebook/short"],
  };

  if (content.formatType === "legacy_quote_short" && wrongLaneRows.length > 0) {
    return {
      ...base,
      diagnosis: "wrong_lane",
      plannedAction: "skip",
      reason: "wrong_lane_manual_review",
      scheduledAtUtc: wrongLaneRows[0]?.scheduledAt.toISOString() ?? null,
      scheduledAtVn: formatVn(wrongLaneRows[0]?.scheduledAt ?? null),
      cleanupEligibilityRisk: "blocked",
    };
  }

  if (shortRows.length === 0) {
    return {
      ...base,
      diagnosis: "manual_review_required",
      plannedAction: "skip",
      reason: "no_required_platform_rows_in_scope",
      scheduledAtUtc: null,
      scheduledAtVn: null,
      cleanupEligibilityRisk: "blocked",
    };
  }

  if (ytShortRows.length === 0 || fbShortRows.length === 0) {
    const diagnosis: Diagnosis = ytShortRows.length === 0 ? "missing_youtube" : "missing_facebook";
    if (shortRows.length !== 1) {
      return {
        ...base,
        diagnosis,
        plannedAction: "skip",
        reason: "multiple_rows_present_manual_review_required",
        scheduledAtUtc: shortRows[0]?.scheduledAt.toISOString() ?? null,
        scheduledAtVn: formatVn(shortRows[0]?.scheduledAt ?? null),
        cleanupEligibilityRisk: "blocked",
      };
    }

    const existingRow = shortRows[0];
    if (!isActiveFutureRow(existingRow)) {
      return {
        ...base,
        diagnosis,
        plannedAction: "skip",
        reason: "existing_row_not_active_future",
        scheduledAtUtc: existingRow.scheduledAt.toISOString(),
        scheduledAtVn: formatVn(existingRow.scheduledAt),
        cleanupEligibilityRisk: "blocked",
      };
    }

    const duplicatePlatformHistory = content.allRows.some((row) =>
      row.videoType === "short" &&
      row.platform === (diagnosis === "missing_youtube" ? "youtube" : "facebook"),
    );
    if (duplicatePlatformHistory) {
      return {
        ...base,
        diagnosis,
        plannedAction: "skip",
        reason: "matching_platform_row_history_exists_manual_review",
        scheduledAtUtc: existingRow.scheduledAt.toISOString(),
        scheduledAtVn: formatVn(existingRow.scheduledAt),
        cleanupEligibilityRisk: "blocked",
      };
    }

    const collision = await hasSlotCollision(
      diagnosis === "missing_youtube" ? destinations.youtube : destinations.facebook,
      existingRow.scheduledAt,
      [],
    );
    if (collision) {
      return {
        ...base,
        diagnosis,
        plannedAction: "skip",
        reason: "target_slot_collision",
        scheduledAtUtc: existingRow.scheduledAt.toISOString(),
        scheduledAtVn: formatVn(existingRow.scheduledAt),
        cleanupEligibilityRisk: "blocked",
      };
    }

    return {
      ...base,
      diagnosis,
      plannedAction: diagnosis === "missing_youtube" ? "create_youtube_row" : "create_facebook_row",
      reason: "safe_missing_pair_repair",
      scheduledAtUtc: existingRow.scheduledAt.toISOString(),
      scheduledAtVn: formatVn(existingRow.scheduledAt),
      cleanupEligibilityRisk: "blocked",
    };
  }

  const slotSet = new Set(shortRows.map((row) => row.scheduledAt.toISOString()));
  if (slotSet.size === 1 && ytShortRows.length === 1 && fbShortRows.length === 1) {
    return {
      ...base,
      diagnosis: "complete_pair",
      plannedAction: "skip",
      reason: "already_paired",
      scheduledAtUtc: shortRows[0]?.scheduledAt.toISOString() ?? null,
      scheduledAtVn: formatVn(shortRows[0]?.scheduledAt ?? null),
      cleanupEligibilityRisk: "paired",
    };
  }

  if (ytShortRows.length !== 1 || fbShortRows.length !== 1) {
    return {
      ...base,
      diagnosis: "manual_review_required",
      plannedAction: "skip",
      reason: "multiple_platform_rows_manual_review",
      scheduledAtUtc: shortRows[0]?.scheduledAt.toISOString() ?? null,
      scheduledAtVn: formatVn(shortRows[0]?.scheduledAt ?? null),
      cleanupEligibilityRisk: "blocked",
    };
  }

  const [youtubeRow] = ytShortRows;
  const [facebookRow] = fbShortRows;
  const hasDone = [youtubeRow, facebookRow].some((row) => row.status === "done");
  const hasUploading = [youtubeRow, facebookRow].some((row) => row.status === "uploading");
  if (hasDone || hasUploading) {
    return {
      ...base,
      diagnosis: "manual_review_required",
      plannedAction: "skip",
      reason: hasDone ? "done_row_present_manual_review" : "uploading_row_present_manual_review",
      scheduledAtUtc: youtubeRow.scheduledAt.toISOString(),
      scheduledAtVn: formatVn(youtubeRow.scheduledAt),
      cleanupEligibilityRisk: "blocked",
    };
  }

  if (![youtubeRow, facebookRow].every(isActiveFutureRow)) {
    return {
      ...base,
      diagnosis: "manual_review_required",
      plannedAction: "skip",
      reason: "rows_not_both_active_future",
      scheduledAtUtc: youtubeRow.scheduledAt.toISOString(),
      scheduledAtVn: formatVn(youtubeRow.scheduledAt),
      cleanupEligibilityRisk: "blocked",
    };
  }

  const canonicalSlot = new Date(Math.min(youtubeRow.scheduledAt.getTime(), facebookRow.scheduledAt.getTime()));
  const rowToMove = youtubeRow.scheduledAt.getTime() > facebookRow.scheduledAt.getTime()
    ? { row: youtubeRow, action: "align_youtube_slot" as const, destination: destinations.youtube }
    : { row: facebookRow, action: "align_facebook_slot" as const, destination: destinations.facebook };

  const collision = await hasSlotCollision(rowToMove.destination, canonicalSlot, [rowToMove.row.id]);
  if (collision) {
    return {
      ...base,
      diagnosis: "manual_review_required",
      plannedAction: "skip",
      reason: "canonical_target_slot_collision",
      scheduledAtUtc: canonicalSlot.toISOString(),
      scheduledAtVn: formatVn(canonicalSlot),
      cleanupEligibilityRisk: "blocked",
    };
  }

  return {
    ...base,
    diagnosis: "misaligned_slots",
    plannedAction: rowToMove.action,
    reason: "safe_align_to_earliest_slot",
    scheduledAtUtc: canonicalSlot.toISOString(),
    scheduledAtVn: formatVn(canonicalSlot),
    cleanupEligibilityRisk: "blocked",
  };
}

async function insertMissingRow(
  content: ContentScope,
  scheduledAt: Date,
  platform: DestinationPlatform,
  destination: Destination,
) {
  const [inserted] = await db.insert(uploadQueue).values({
    id: randomUUID(),
    contentId: content.id,
    channelId: destination.channelId,
    platform,
    videoType: "short",
    title: buildDefaultVideoTitle({
      platform,
      contentType: "short",
      topic: content.topic,
      contentProfileKey: content.contentProfileKey,
      shortContent: content.shortContent,
    }),
    description: buildDefaultVideoDescription({
      platform,
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
  return inserted.id;
}

async function applyPlan(
  planItems: PlanItem[],
  contentMap: Map<string, ContentScope>,
  destinations: { youtube: Destination; facebook: Destination },
): Promise<string[]> {
  const mutations: string[] = [];

  for (const item of planItems) {
    if (!["create_youtube_row", "create_facebook_row", "align_youtube_slot", "align_facebook_slot"].includes(item.plannedAction)) {
      continue;
    }
    if (!item.scheduledAtUtc) continue;

    const content = contentMap.get(item.contentId);
    if (!content) continue;
    const scheduledAt = new Date(item.scheduledAtUtc);

    if (item.plannedAction === "create_youtube_row") {
      const rowId = await insertMissingRow(content, scheduledAt, "youtube", destinations.youtube);
      mutations.push(`created:${rowId}`);
      continue;
    }
    if (item.plannedAction === "create_facebook_row") {
      const rowId = await insertMissingRow(content, scheduledAt, "facebook", destinations.facebook);
      mutations.push(`created:${rowId}`);
      continue;
    }

    const targetPlatform = item.plannedAction === "align_youtube_slot" ? "youtube" : "facebook";
    const rowToMove = content.scopedRows.find((row) =>
      row.videoType === "short" &&
      row.platform === targetPlatform &&
      row.scheduledAt.toISOString() !== item.scheduledAtUtc,
    );
    if (!rowToMove) continue;
    await db.update(uploadQueue)
      .set({ scheduledAt, updatedAt: new Date() })
      .where(eq(uploadQueue.id, rowToMove.id));
    mutations.push(`aligned:${rowToMove.id}`);
  }

  return mutations;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const destinations = await getDestinations();
  const scopedContent = (await loadScopedContent(args)).filter((content) =>
    content.scopedRows.some((row) => row.videoType === "short") ||
    (
      content.formatType === "legacy_quote_short" &&
      content.scopedRows.some((row) => row.platform === "facebook" && row.videoType === "quote")
    ),
  );
  const contentMap = new Map(scopedContent.map((content) => [content.id, content]));

  const planItems: PlanItem[] = [];
  for (const content of scopedContent) {
    planItems.push(await buildPlanItem(content, destinations));
  }

  let mutations: string[] = [];
  if (args.apply) {
    const safeToApply = planItems.every((item) =>
      item.plannedAction === "skip" ||
      ["create_youtube_row", "create_facebook_row", "align_youtube_slot", "align_facebook_slot"].includes(item.plannedAction),
    );
    if (safeToApply) {
      mutations = await applyPlan(planItems, contentMap, destinations);
    }
  }

  const summary = {
    itemsScanned: planItems.length,
    completePairs: planItems.filter((item) => item.diagnosis === "complete_pair").length,
    missingYoutube: planItems.filter((item) => item.diagnosis === "missing_youtube").length,
    missingFacebook: planItems.filter((item) => item.diagnosis === "missing_facebook").length,
    misaligned: planItems.filter((item) => item.diagnosis === "misaligned_slots").length,
    wrongLane: planItems.filter((item) => item.diagnosis === "wrong_lane").length,
    manualReview: planItems.filter((item) => item.diagnosis === "manual_review_required").length,
    safeCreateActions: planItems.filter((item) => item.plannedAction === "create_youtube_row" || item.plannedAction === "create_facebook_row").length,
    safeAlignActions: planItems.filter((item) => item.plannedAction === "align_youtube_slot" || item.plannedAction === "align_facebook_slot").length,
    skipped: planItems.filter((item) => item.plannedAction === "skip").length,
  };

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry_run",
    range: {
      fromUtc: args.from.toISOString(),
      fromVn: formatVn(args.from),
      toUtc: args.to.toISOString(),
      toVn: formatVn(args.to),
    },
    contentId: args.contentId,
    summary,
    items: planItems,
    mutations,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
