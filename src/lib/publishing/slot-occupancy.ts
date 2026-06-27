import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { socialChannels, uploadQueue } from "@/lib/db/schema";

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export const SLOT_BLOCKING_UPLOAD_QUEUE_STATUSES = [
  "queued",
  "uploading",
  "done",
] as const;

export type SlotBlockingUploadQueueStatus =
  (typeof SLOT_BLOCKING_UPLOAD_QUEUE_STATUSES)[number];

export function isUploadQueueStatusSlotBlocking(
  status: string | null | undefined,
): status is SlotBlockingUploadQueueStatus {
  return SLOT_BLOCKING_UPLOAD_QUEUE_STATUSES.includes(
    status as SlotBlockingUploadQueueStatus,
  );
}

export function buildUploadSlotKey(input: {
  destinationKey: string;
  videoType: string;
  scheduledAt: Date;
}): string {
  return `${input.destinationKey}|${input.videoType}|${input.scheduledAt.toISOString()}`;
}

export function getUploadDestinationKey(input: {
  platform: string;
  platformChannelId?: string | null;
  channelId: number;
}): string {
  return input.platformChannelId
    ? `${input.platform}:${input.platformChannelId}`
    : `${input.platform}:channel:${input.channelId}`;
}

export type TakenUploadSlotRow = {
  id: string;
  channelId: number;
  contentId: string;
  status: string;
  videoType: string;
  scheduledAt: Date;
};

export async function getTakenUploadSlotsForDestination(input: {
  channelId: number;
  platform: string;
  platformChannelId?: string | null;
  videoType: string;
  since?: Date;
  excludeQueueIds?: string[];
}): Promise<TakenUploadSlotRow[]> {
  const destinationWhere = input.platformChannelId
    ? and(
        eq(socialChannels.platform, input.platform),
        eq(socialChannels.platformChannelId, input.platformChannelId),
      )
    : eq(uploadQueue.channelId, input.channelId);

  return db
    .select({
      id: uploadQueue.id,
      channelId: uploadQueue.channelId,
      contentId: uploadQueue.contentId,
      status: uploadQueue.status,
      videoType: uploadQueue.videoType,
      scheduledAt: uploadQueue.scheduledAt,
    })
    .from(uploadQueue)
    .innerJoin(socialChannels, eq(uploadQueue.channelId, socialChannels.id))
    .where(and(
      destinationWhere,
      eq(uploadQueue.videoType, input.videoType),
      inArray(uploadQueue.status, [...SLOT_BLOCKING_UPLOAD_QUEUE_STATUSES]),
      input.since ? gte(uploadQueue.scheduledAt, input.since) : undefined,
      input.excludeQueueIds?.length
        ? and(...input.excludeQueueIds.map((id) => ne(uploadQueue.id, id)))
        : undefined,
    ));
}

export function getSlotOffsetMinutes(
  scheduledAt: Date,
  intervalMin: number,
): number {
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) return 0;
  const scheduledVn = new Date(scheduledAt.getTime() + VN_OFFSET_MS);
  const totalMinutes =
    scheduledVn.getUTCHours() * 60 + scheduledVn.getUTCMinutes();
  const offset = totalMinutes % intervalMin;
  return offset < 0 ? offset + intervalMin : offset;
}

export function findNextAvailablePublishSlot(input: {
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  taken: Array<number | Date>;
  notBefore?: Date;
  slotOffsetMinutes?: number;
}): Date | null {
  const [sh, sm] = input.windowStart.split(":").map(Number);
  const [eh, em] = input.windowEnd.split(":").map(Number);
  const slotOffsetMinutes = Math.max(
    0,
    Math.min(input.intervalMin - 1, Math.round(input.slotOffsetMinutes ?? 0)),
  );
  const windowStartMin = sh * 60 + sm + slotOffsetMinutes;
  const windowEndMin = eh * 60 + em + slotOffsetMinutes;
  const takenMs = input.taken.map((value) =>
    value instanceof Date ? value.getTime() : value,
  );
  const now = input.notBefore && input.notBefore.getTime() > Date.now()
    ? new Date(input.notBefore.getTime() - 1000)
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

    let startMin = windowStartMin;
    if (day === 0) {
      const nowMin = nowVn.getUTCHours() * 60 + nowVn.getUTCMinutes();
      if (nowMin >= startMin) {
        startMin = Math.ceil((nowMin + 1 - slotOffsetMinutes) / input.intervalMin) * input.intervalMin + slotOffsetMinutes;
      }
    }

    for (
      let slotMin = startMin;
      slotMin <= windowEndMin;
      slotMin += input.intervalMin
    ) {
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
      const half = (input.intervalMin / 2) * 60_000;
      const conflict = takenMs.some((t) => Math.abs(t - candidate.getTime()) < half);
      if (!conflict) return candidate;
    }
  }

  return null;
}

export type PhatPhapCampaignLaneOccupancy = {
  videoType: "short" | "quote";
  /** Epoch ms timestamps already occupied on this exact lane (other content items). */
  takenMs: number[];
};

/**
 * Pure, DB-free anchor picker for a phat_phap campaign content item. Unlike
 * findNextAvailablePublishSlot (which only ever evaluates a single lane), this checks
 * EVERY lane the content item occupies (YouTube short, Facebook short/reel, Facebook
 * quote sidecar) against the same HH:00 candidate before accepting it — a candidate that
 * is free on one lane but occupied on a sibling lane is rejected and the search continues.
 * No DB access; callers supply each lane's already-fetched taken-slot list.
 */
export function pickFullLaneSafeAnchor(input: {
  notBefore: Date;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  lanes: PhatPhapCampaignLaneOccupancy[];
}): { anchor: Date | null; reason: string | null } {
  const [sh, sm] = input.windowStart.split(":").map(Number);
  const [eh, em] = input.windowEnd.split(":").map(Number);
  const windowStartMin = sh * 60 + sm;
  const windowEndMin = eh * 60 + em;
  const now = input.notBefore.getTime() > Date.now() ? new Date(input.notBefore.getTime() - 1000) : new Date();
  const nowVn = new Date(now.getTime() + VN_OFFSET_MS);

  const takenSetByLane = input.lanes.map((lane) => new Set(lane.takenMs));

  for (let day = 0; day < 14; day += 1) {
    const baseVn = new Date(Date.UTC(nowVn.getUTCFullYear(), nowVn.getUTCMonth(), nowVn.getUTCDate() + day, 0, 0, 0, 0));
    let startMin = windowStartMin;
    if (day === 0) {
      const nowMin = nowVn.getUTCHours() * 60 + nowVn.getUTCMinutes();
      if (nowMin >= startMin) {
        startMin = Math.ceil((nowMin + 1) / input.intervalMin) * input.intervalMin;
      }
    }

    for (let slotMin = startMin; slotMin <= windowEndMin; slotMin += input.intervalMin) {
      const candidate = new Date(Date.UTC(
        baseVn.getUTCFullYear(), baseVn.getUTCMonth(), baseVn.getUTCDate(),
        Math.floor(slotMin / 60) - 7, slotMin % 60, 0, 0,
      ));
      if (candidate.getTime() <= now.getTime()) continue;

      const allLanesSafe = input.lanes.every((lane, index) => {
        const laneSlot = lane.videoType === "quote" ? candidate.getTime() + 5 * 60_000 : candidate.getTime();
        return !takenSetByLane[index].has(laneSlot);
      });

      if (allLanesSafe) return { anchor: candidate, reason: null };
    }
  }

  return { anchor: null, reason: "no_full_lane_safe_anchor_found_within_14_day_horizon" };
}
