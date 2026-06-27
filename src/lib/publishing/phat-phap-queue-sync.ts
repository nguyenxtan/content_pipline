import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";
import { buildDefaultVideoDescription, buildDefaultVideoTitle } from "@/lib/social/youtube-metadata";

const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
const ACTIVE_SYNC_STATUSES = new Set(["queued", "pending", "uploading"]);
const MUTABLE_SYNC_STATUSES = new Set(["queued", "pending"]);
const SCOPE_FORMATS = new Set(["tts_short", "legacy_quote_short"]);

type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PhatPhapQueueSyncDiagnosis =
  | "complete_pair"
  | "missing_youtube"
  | "missing_facebook"
  | "misaligned_slots"
  | "content_collision"
  | "orphan_platform_row"
  | "done_row_present"
  | "wrong_lane"
  | "manual_review_required";

export type PhatPhapQueueSyncAction =
  | "create_missing_youtube_row"
  | "create_missing_facebook_row"
  | "align_youtube_to_canonical_slot"
  | "align_facebook_to_canonical_slot"
  | "skip_manual_review"
  | "skip_already_compliant"
  | "skip_unsafe";

export type QueueSyncMode = "dry_run" | "apply";

type ScopeFormat = "tts_short" | "legacy_quote_short";
type Platform = "youtube" | "facebook";

type QueueEvidenceRow = {
  queueId: string;
  contentId: string;
  title: string;
  formatType: ScopeFormat;
  shortContent: string;
  longContent: string;
  longYoutubeDescription: string | null;
  nicheName: string;
  contentProfileKey: string | null;
  scheduledAt: Date;
  status: string;
  platform: Platform;
  videoType: string;
  channelId: number;
  channelName: string;
  channelKey: string | null;
  platformChannelId: string | null;
  createdAt: Date;
  uploadedAt: Date | null;
  platformVideoUrl: string | null;
  hasPublishedVideo: boolean;
};

export type QueueSyncRowSnapshot = {
  queueId: string;
  platform: Platform;
  videoType: string;
  status: string;
  scheduledAtUtc: string;
  scheduledAtVn: string | null;
  channelId: number;
  channelName: string;
};

export type PhatPhapQueueSyncPlanItem = {
  contentId: string;
  title: string;
  formatType: ScopeFormat;
  currentYoutubeRow: QueueSyncRowSnapshot | null;
  currentFacebookRow: QueueSyncRowSnapshot | null;
  currentScheduledAtUtc: string | null;
  currentScheduledAtVn: string | null;
  diagnosis: PhatPhapQueueSyncDiagnosis;
  proposedAction: PhatPhapQueueSyncAction;
  reason: string;
  safeToApply: boolean;
  targetScheduledAtUtc: string | null;
  targetScheduledAtVn: string | null;
  targetPlatform: Platform | null;
};

export type PhatPhapQueueSyncSummary = {
  itemsScanned: number;
  completePairs: number;
  safeCreates: number;
  safeAligns: number;
  manualReview: number;
  unsafeSkipped: number;
  wrongLane: number;
  contentCollisions: number;
};

export type PhatPhapQueueSyncResult = {
  mode: QueueSyncMode;
  window: {
    fromUtc: string;
    fromVn: string | null;
    toUtc: string;
    toVn: string | null;
  };
  summary: PhatPhapQueueSyncSummary;
  items: PhatPhapQueueSyncPlanItem[];
  affectedSlotsVn: string[];
  applyResult: {
    applied: number;
    created: number;
    aligned: number;
    stateChanged: number;
    skipped: number;
  };
};

export type PhatPhapQueueSyncInput = {
  from: Date;
  to: Date;
  contentId?: string | null;
  apply?: boolean;
};

function formatVn(value: string | Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function snapshotRow(row: QueueEvidenceRow | null): QueueSyncRowSnapshot | null {
  if (!row) return null;
  return {
    queueId: row.queueId,
    platform: row.platform,
    videoType: row.videoType,
    status: row.status,
    scheduledAtUtc: row.scheduledAt.toISOString(),
    scheduledAtVn: formatVn(row.scheduledAt),
    channelId: row.channelId,
    channelName: row.channelName,
  };
}

function isInWindow(row: QueueEvidenceRow, from: Date, to: Date): boolean {
  const ts = row.scheduledAt.getTime();
  return ts >= from.getTime() && ts < to.getTime();
}

function isActiveShortRow(row: QueueEvidenceRow, from: Date, to: Date): boolean {
  return row.videoType === "short" &&
    ACTIVE_SYNC_STATUSES.has(row.status) &&
    isInWindow(row, from, to);
}

function buildCanonicalSlot(rows: QueueEvidenceRow[]): { slotUtc: string | null; ambiguous: boolean } {
  if (rows.length === 0) return { slotUtc: null, ambiguous: false };
  const slotCounts = new Map<string, Set<Platform>>();
  for (const row of rows) {
    const key = row.scheduledAt.toISOString();
    const current = slotCounts.get(key) ?? new Set<Platform>();
    current.add(row.platform);
    slotCounts.set(key, current);
  }
  const ranked = Array.from(slotCounts.entries())
    .map(([slotUtc, platforms]) => ({
      slotUtc,
      platformCount: platforms.size,
      scheduledAt: new Date(slotUtc).getTime(),
    }))
    .sort((left, right) =>
      right.platformCount - left.platformCount ||
      left.scheduledAt - right.scheduledAt,
    );
  if (ranked.length === 0) return { slotUtc: null, ambiguous: false };
  if (ranked.length > 1 &&
    ranked[0].platformCount === ranked[1].platformCount &&
    ranked[0].scheduledAt === ranked[1].scheduledAt) {
    return { slotUtc: null, ambiguous: true };
  }
  return { slotUtc: ranked[0].slotUtc, ambiguous: false };
}

async function loadScopeRows(client: DbLike, input: PhatPhapQueueSyncInput): Promise<QueueEvidenceRow[]> {
  const contentIdCondition = input.contentId ? sql`and cg.id = ${input.contentId}` : sql``;
  const result = await client.execute(sql`
    with scope_content as (
      select distinct cg.id
      from upload_queue uq
      join content_generations cg on cg.id = uq.content_id
      where cg.channel_key = 'phat_phap'
        and cg.format_type in ('tts_short', 'legacy_quote_short')
        and uq.video_type = 'short'
        and uq.status in ('queued', 'pending', 'uploading')
        and uq.scheduled_at >= ${input.from.toISOString()}::timestamptz
        and uq.scheduled_at < ${input.to.toISOString()}::timestamptz
        ${contentIdCondition}
    )
    select
      uq.id as queue_id,
      cg.id as content_id,
      coalesce(nullif(cg.topic, ''), uq.title, cg.id) as title,
      cg.format_type,
      cg.short_content,
      cg.long_content,
      cg.long_youtube_description,
      cg.niche_name,
      cg.content_profile_key,
      uq.scheduled_at,
      uq.status,
      uq.platform,
      uq.video_type,
      uq.channel_id,
      sc.name as channel_name,
      sc.channel_key,
      sc.platform_channel_id,
      uq.created_at,
      uq.uploaded_at,
      uq.platform_video_url,
      exists(
        select 1
        from published_videos pv
        where pv.upload_queue_id = uq.id
      ) as has_published_video
    from scope_content s
    join content_generations cg on cg.id = s.id
    join upload_queue uq on uq.content_id = cg.id
    join social_channels sc on sc.id = uq.channel_id
    where uq.platform in ('youtube', 'facebook')
      and uq.video_type in ('short', 'quote')
    order by uq.scheduled_at asc, uq.platform asc, uq.created_at asc
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    queueId: String(row.queue_id),
    contentId: String(row.content_id),
    title: String(row.title),
    formatType: String(row.format_type) as ScopeFormat,
    shortContent: String(row.short_content ?? ""),
    longContent: String(row.long_content ?? ""),
    longYoutubeDescription: row.long_youtube_description ? String(row.long_youtube_description) : null,
    nicheName: String(row.niche_name ?? ""),
    contentProfileKey: row.content_profile_key ? String(row.content_profile_key) : null,
    scheduledAt: new Date(String(row.scheduled_at)),
    status: String(row.status),
    platform: String(row.platform) as Platform,
    videoType: String(row.video_type),
    channelId: Number(row.channel_id),
    channelName: String(row.channel_name ?? ""),
    channelKey: row.channel_key ? String(row.channel_key) : null,
    platformChannelId: row.platform_channel_id ? String(row.platform_channel_id) : null,
    createdAt: new Date(String(row.created_at)),
    uploadedAt: row.uploaded_at ? new Date(String(row.uploaded_at)) : null,
    platformVideoUrl: row.platform_video_url ? String(row.platform_video_url) : null,
    hasPublishedVideo: Boolean(row.has_published_video),
  }));
}

async function resolveCanonicalChannelIds(
  client: DbLike,
  rows: QueueEvidenceRow[],
): Promise<Record<Platform, { channelId: number | null; ambiguous: boolean }>> {
  const platformCounts = new Map<Platform, Map<number, number>>();
  for (const row of rows) {
    if (!isActiveShortRow(row, new Date(0), new Date("9999-12-31T00:00:00Z"))) continue;
    const counts = platformCounts.get(row.platform) ?? new Map<number, number>();
    counts.set(row.channelId, (counts.get(row.channelId) ?? 0) + 1);
    platformCounts.set(row.platform, counts);
  }

  const base = { youtube: { channelId: null, ambiguous: false }, facebook: { channelId: null, ambiguous: false } } satisfies Record<Platform, { channelId: number | null; ambiguous: boolean }>;
  for (const platform of ["youtube", "facebook"] as const) {
    const counts = Array.from((platformCounts.get(platform) ?? new Map()).entries())
      .sort((left, right) => right[1] - left[1] || left[0] - right[0]);
    if (counts.length === 0) continue;
    if (counts.length > 1 && counts[0][1] === counts[1][1]) {
      base[platform] = { channelId: null, ambiguous: true };
      continue;
    }
    base[platform] = { channelId: counts[0][0], ambiguous: false };
  }

  if (!base.facebook.channelId && !base.facebook.ambiguous) {
    const result = await client.execute(sql`
      select sc.id
      from social_channels sc
      where sc.platform = 'facebook'
        and sc.channel_key = 'phat_phap'
        and sc.is_active = true
      order by sc.id asc
      limit 2
    `);
    const ids = (result.rows as Array<Record<string, unknown>>).map((row) => Number(row.id));
    if (ids.length === 1) base.facebook = { channelId: ids[0], ambiguous: false };
    if (ids.length > 1) base.facebook = { channelId: null, ambiguous: true };
  }

  return base;
}

function buildPlanFromRows(
  rows: QueueEvidenceRow[],
  input: PhatPhapQueueSyncInput,
  canonicalChannels: Record<Platform, { channelId: number | null; ambiguous: boolean }>,
): PhatPhapQueueSyncResult {
  const grouped = new Map<string, QueueEvidenceRow[]>();
  for (const row of rows) {
    if (!SCOPE_FORMATS.has(row.formatType)) continue;
    const current = grouped.get(row.contentId) ?? [];
    current.push(row);
    grouped.set(row.contentId, current);
  }

  const activeRows = rows.filter((row) => isActiveShortRow(row, input.from, input.to));
  const occupancy = new Map<string, Set<string>>();
  for (const row of activeRows) {
    const key = `${row.platform}|${row.scheduledAt.toISOString()}`;
    const current = occupancy.get(key) ?? new Set<string>();
    current.add(row.contentId);
    occupancy.set(key, current);
  }

  const items: PhatPhapQueueSyncPlanItem[] = [];
  for (const [contentId, contentRows] of grouped.entries()) {
    const activeShortRows = contentRows.filter((row) => isActiveShortRow(row, input.from, input.to));
    if (activeShortRows.length === 0) continue;
    const youtubeRows = activeShortRows.filter((row) => row.platform === "youtube" && row.videoType === "short");
    const facebookRows = activeShortRows.filter((row) => row.platform === "facebook" && row.videoType === "short");
    const wrongLaneRows = contentRows.filter((row) =>
      row.platform === "facebook" &&
      row.videoType === "quote" &&
      ACTIVE_SYNC_STATUSES.has(row.status) &&
      isInWindow(row, input.from, input.to),
    );
    const doneEvidence = contentRows.some((row) =>
      row.videoType === "short" &&
      (row.status === "done" || row.uploadedAt || row.platformVideoUrl || row.hasPublishedVideo),
    );
    const { slotUtc: canonicalSlotUtc, ambiguous } = buildCanonicalSlot(activeShortRows);
    const canonicalSlotVn = formatVn(canonicalSlotUtc);
    const formatType = activeShortRows[0]?.formatType ?? contentRows[0]?.formatType ?? "tts_short";
    const title = activeShortRows[0]?.title ?? contentRows[0]?.title ?? contentId;
    const currentYouTubeRow = youtubeRows[0] ? snapshotRow(youtubeRows[0]) : null;
    const currentFacebookRow = facebookRows[0] ? snapshotRow(facebookRows[0]) : null;

    const base = {
      contentId,
      title,
      formatType,
      currentYoutubeRow: currentYouTubeRow,
      currentFacebookRow,
      currentScheduledAtUtc: canonicalSlotUtc,
      currentScheduledAtVn: canonicalSlotVn,
      targetScheduledAtUtc: canonicalSlotUtc,
      targetScheduledAtVn: canonicalSlotVn,
      targetPlatform: null,
    };

    if (wrongLaneRows.length > 0) {
      items.push({
        ...base,
        diagnosis: "wrong_lane",
        proposedAction: "skip_unsafe",
        reason: "Active facebook/quote row exists for this content item. Video short/reel sync fails closed.",
        safeToApply: false,
      });
      continue;
    }

    if (doneEvidence) {
      items.push({
        ...base,
        diagnosis: "done_row_present",
        proposedAction: "skip_unsafe",
        reason: "Done/published evidence exists. Future queue sync must not mutate immutable rows.",
        safeToApply: false,
      });
      continue;
    }

    if (ambiguous || youtubeRows.length > 1 || facebookRows.length > 1 || activeShortRows.length > 2) {
      items.push({
        ...base,
        diagnosis: youtubeRows.length + facebookRows.length === 1 ? "orphan_platform_row" : "manual_review_required",
        proposedAction: "skip_manual_review",
        reason: "Multiple active short rows make canonical slot or platform pairing ambiguous.",
        safeToApply: false,
      });
      continue;
    }

    if (youtubeRows.length === 1 && facebookRows.length === 1) {
      const yt = youtubeRows[0];
      const fb = facebookRows[0];
      if (yt.scheduledAt.getTime() === fb.scheduledAt.getTime()) {
        items.push({
          ...base,
          diagnosis: "complete_pair",
          proposedAction: "skip_already_compliant",
          reason: "YouTube Short and Facebook Reel already share the same content item slot.",
          safeToApply: false,
        });
        continue;
      }

      const canonicalSlot = canonicalSlotUtc ? new Date(canonicalSlotUtc) : null;
      if (!canonicalSlot) {
        items.push({
          ...base,
          diagnosis: "manual_review_required",
          proposedAction: "skip_manual_review",
          reason: "Canonical slot could not be determined safely.",
          safeToApply: false,
        });
        continue;
      }
      if (!MUTABLE_SYNC_STATUSES.has(yt.status) || !MUTABLE_SYNC_STATUSES.has(fb.status)) {
        items.push({
          ...base,
          diagnosis: "misaligned_slots",
          proposedAction: "skip_unsafe",
          reason: "At least one row is uploading or otherwise immutable for safe alignment.",
          safeToApply: false,
        });
        continue;
      }

      const movePlatform: Platform = yt.scheduledAt.getTime() === canonicalSlot.getTime() ? "facebook" : "youtube";
      const collisionKey = `${movePlatform}|${canonicalSlot.toISOString()}`;
      const occupiedBy = occupancy.get(collisionKey) ?? new Set<string>();
      const occupiedByOtherContent = Array.from(occupiedBy).filter((candidate) => candidate !== contentId);
      if (occupiedByOtherContent.length > 0) {
        items.push({
          ...base,
          diagnosis: "content_collision",
          proposedAction: "skip_manual_review",
          reason: `Target ${movePlatform} slot is already occupied by another phat_phap content item.`,
          safeToApply: false,
          targetPlatform: movePlatform,
        });
        continue;
      }

      items.push({
        ...base,
        diagnosis: "misaligned_slots",
        proposedAction: movePlatform === "youtube"
          ? "align_youtube_to_canonical_slot"
          : "align_facebook_to_canonical_slot",
        reason: `Move ${movePlatform} row to the canonical content slot.`,
        safeToApply: true,
        targetPlatform: movePlatform,
      });
      continue;
    }

    if (youtubeRows.length + facebookRows.length === 1) {
      const existingRow = youtubeRows[0] ?? facebookRows[0] ?? null;
      if (!existingRow) continue;
      const missingPlatform: Platform = existingRow.platform === "youtube" ? "facebook" : "youtube";
      const channelResolution = canonicalChannels[missingPlatform];
      if (!MUTABLE_SYNC_STATUSES.has(existingRow.status)) {
        items.push({
          ...base,
          diagnosis: "orphan_platform_row",
          proposedAction: "skip_unsafe",
          reason: "Only one platform row exists and it is not safely mutable.",
          safeToApply: false,
          targetPlatform: missingPlatform,
        });
        continue;
      }
      if (!channelResolution.channelId || channelResolution.ambiguous) {
        items.push({
          ...base,
          diagnosis: "manual_review_required",
          proposedAction: "skip_manual_review",
          reason: `Canonical ${missingPlatform} social channel could not be resolved safely.`,
          safeToApply: false,
          targetPlatform: missingPlatform,
        });
        continue;
      }
      const collisionKey = `${missingPlatform}|${existingRow.scheduledAt.toISOString()}`;
      const occupiedBy = occupancy.get(collisionKey) ?? new Set<string>();
      const occupiedByOtherContent = Array.from(occupiedBy).filter((candidate) => candidate !== contentId);
      if (occupiedByOtherContent.length > 0) {
        items.push({
          ...base,
          diagnosis: "content_collision",
          proposedAction: "skip_manual_review",
          reason: `Target ${missingPlatform} slot is already occupied by another phat_phap content item.`,
          safeToApply: false,
          targetPlatform: missingPlatform,
        });
        continue;
      }

      items.push({
        ...base,
        diagnosis: missingPlatform === "youtube" ? "missing_youtube" : "missing_facebook",
        proposedAction: missingPlatform === "youtube"
          ? "create_missing_youtube_row"
          : "create_missing_facebook_row",
        reason: `Create the missing ${missingPlatform} short row at the existing content slot.`,
        safeToApply: true,
        targetPlatform: missingPlatform,
      });
      continue;
    }

    items.push({
      ...base,
      diagnosis: "manual_review_required",
      proposedAction: "skip_manual_review",
      reason: "Planner could not classify this content item into a safe synchronization action.",
      safeToApply: false,
    });
  }

  const summary: PhatPhapQueueSyncSummary = {
    itemsScanned: items.length,
    completePairs: items.filter((item) => item.diagnosis === "complete_pair").length,
    safeCreates: items.filter((item) =>
      item.proposedAction === "create_missing_youtube_row" || item.proposedAction === "create_missing_facebook_row",
    ).length,
    safeAligns: items.filter((item) =>
      item.proposedAction === "align_youtube_to_canonical_slot" || item.proposedAction === "align_facebook_to_canonical_slot",
    ).length,
    manualReview: items.filter((item) => item.proposedAction === "skip_manual_review").length,
    unsafeSkipped: items.filter((item) => item.proposedAction === "skip_unsafe").length,
    wrongLane: items.filter((item) => item.diagnosis === "wrong_lane").length,
    contentCollisions: items.filter((item) => item.diagnosis === "content_collision").length,
  };

  const affectedSlotsVn = Array.from(new Set(
    items
      .filter((item) => item.safeToApply && item.targetScheduledAtVn)
      .map((item) => item.targetScheduledAtVn as string),
  )).sort((left, right) => new Date(left).getTime() - new Date(right).getTime());

  return {
    mode: "dry_run",
    window: {
      fromUtc: input.from.toISOString(),
      fromVn: formatVn(input.from),
      toUtc: input.to.toISOString(),
      toVn: formatVn(input.to),
    },
    summary,
    items,
    affectedSlotsVn,
    applyResult: {
      applied: 0,
      created: 0,
      aligned: 0,
      stateChanged: 0,
      skipped: 0,
    },
  };
}

async function createMissingRow(
  client: DbLike,
  planned: PhatPhapQueueSyncPlanItem,
  rows: QueueEvidenceRow[],
  channelId: number,
): Promise<"created" | "state_changed"> {
  const sourceRow = rows.find((row) => row.contentId === planned.contentId && row.videoType === "short");
  if (!sourceRow || !planned.targetScheduledAtUtc || !planned.targetPlatform) return "state_changed";
  const [content] = await client
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      shortContent: contentGenerations.shortContent,
      longContent: contentGenerations.longContent,
      longYoutubeDescription: contentGenerations.longYoutubeDescription,
      nicheName: contentGenerations.nicheName,
      contentProfileKey: contentGenerations.contentProfileKey,
    })
    .from(contentGenerations)
    .where(eq(contentGenerations.id, planned.contentId))
    .limit(1);
  if (!content) return "state_changed";

  await client.insert(uploadQueue).values({
    id: randomUUID(),
    contentId: planned.contentId,
    channelId,
    platform: planned.targetPlatform,
    videoType: "short",
    title: buildDefaultVideoTitle({
      platform: planned.targetPlatform,
      contentType: "short",
      topic: content.topic,
      contentProfileKey: content.contentProfileKey,
      shortContent: content.shortContent,
    }),
    description: buildDefaultVideoDescription({
      platform: planned.targetPlatform,
      contentType: "short",
      topic: content.topic,
      nicheName: content.nicheName,
      shortContent: content.shortContent,
      longContent: content.longContent,
      longYoutubeDescription: content.longYoutubeDescription,
      contentProfileKey: content.contentProfileKey,
    }),
    tags: [],
    privacyStatus: sourceRow.platform === planned.targetPlatform ? "public" : "public",
    scheduledAt: new Date(planned.targetScheduledAtUtc),
    status: "queued",
  });

  return "created";
}

async function alignRow(
  client: DbLike,
  planned: PhatPhapQueueSyncPlanItem,
): Promise<"aligned" | "state_changed"> {
  if (!planned.targetScheduledAtUtc || !planned.targetPlatform) return "state_changed";
  const queueId = planned.targetPlatform === "youtube"
    ? planned.currentYoutubeRow?.queueId
    : planned.currentFacebookRow?.queueId;
  if (!queueId) return "state_changed";
  await client
    .update(uploadQueue)
    .set({
      scheduledAt: new Date(planned.targetScheduledAtUtc),
      updatedAt: new Date(),
    })
    .where(eq(uploadQueue.id, queueId));
  return "aligned";
}

export async function planPhatPhapQueueSync(
  input: PhatPhapQueueSyncInput,
  client: DbLike = db,
): Promise<PhatPhapQueueSyncResult> {
  const rows = await loadScopeRows(client, input);
  const canonicalChannels = await resolveCanonicalChannelIds(client, rows);
  return buildPlanFromRows(rows, input, canonicalChannels);
}

export async function executePhatPhapQueueSync(
  input: PhatPhapQueueSyncInput,
): Promise<PhatPhapQueueSyncResult> {
  const preview = await planPhatPhapQueueSync({ ...input, apply: false });
  if (!input.apply) return preview;

  const applyResult = {
    applied: 0,
    created: 0,
    aligned: 0,
    stateChanged: 0,
    skipped: 0,
  };

  await db.transaction(async (tx) => {
    for (const item of preview.items.filter((candidate) => candidate.safeToApply)) {
      const fresh = await planPhatPhapQueueSync({
        ...input,
        apply: false,
        contentId: item.contentId,
      }, tx);
      const freshItem = fresh.items[0];
      if (!freshItem || freshItem.proposedAction !== item.proposedAction || !freshItem.safeToApply) {
        applyResult.stateChanged += 1;
        continue;
      }

      const freshRows = await loadScopeRows(tx, {
        ...input,
        contentId: item.contentId,
        apply: false,
      });
      const canonicalChannels = await resolveCanonicalChannelIds(tx, freshRows);

      if (item.proposedAction === "create_missing_youtube_row" || item.proposedAction === "create_missing_facebook_row") {
        const targetPlatform = item.proposedAction === "create_missing_youtube_row" ? "youtube" : "facebook";
        const channelResolution = canonicalChannels[targetPlatform];
        if (!channelResolution.channelId || channelResolution.ambiguous) {
          applyResult.stateChanged += 1;
          continue;
        }
        const created = await createMissingRow(tx, freshItem, freshRows, channelResolution.channelId);
        if (created === "created") {
          applyResult.applied += 1;
          applyResult.created += 1;
        } else {
          applyResult.stateChanged += 1;
        }
        continue;
      }

      if (item.proposedAction === "align_youtube_to_canonical_slot" || item.proposedAction === "align_facebook_to_canonical_slot") {
        const aligned = await alignRow(tx, freshItem);
        if (aligned === "aligned") {
          applyResult.applied += 1;
          applyResult.aligned += 1;
        } else {
          applyResult.stateChanged += 1;
        }
        continue;
      }

      applyResult.skipped += 1;
    }
  });

  const after = await planPhatPhapQueueSync({ ...input, apply: false });
  return {
    ...after,
    mode: "apply",
    applyResult,
  };
}
