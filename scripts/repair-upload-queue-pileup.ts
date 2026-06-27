import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { socialChannels, uploadQueue } from "@/lib/db/schema";
import {
  findNextAvailablePublishSlot,
  getSlotOffsetMinutes,
  getTakenUploadSlotsForDestination,
  getUploadDestinationKey,
} from "@/lib/publishing/slot-occupancy";

type PlatformFilter = "youtube" | "facebook" | "all";
type VideoTypeFilter = "short" | "quote" | "all";

type QueueRow = {
  id: string;
  contentId: string;
  channelId: number;
  channelKey: string | null;
  channelName: string;
  platform: string;
  platformChannelId: string | null;
  videoType: string;
  scheduledAt: Date;
  createdAt: Date;
};

function getArg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function formatVn(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getScheduledAtWindowUtc(dateVn: string, hourVn: string): {
  startUtc: Date;
  endUtc: Date;
} {
  const startUtc = new Date(`${dateVn}T${hourVn.padStart(2, "0")}:00:00+07:00`);
  const endUtc = new Date(startUtc.getTime() + 60 * 60 * 1000);
  return { startUtc, endUtc };
}

function countSlotCollisions(rows: Array<{ destinationKey: string; videoType: string; scheduledAt: Date }>): number {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.destinationKey}|${row.videoType}|${row.scheduledAt.toISOString()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
}

async function loadTargetRows(input: {
  dateVn: string;
  hourVn: string;
  channelKey: string;
  platform: PlatformFilter;
  videoType: VideoTypeFilter;
}): Promise<QueueRow[]> {
  const { startUtc, endUtc } = getScheduledAtWindowUtc(input.dateVn, input.hourVn);
  const rows = await db
    .select({
      id: uploadQueue.id,
      contentId: uploadQueue.contentId,
      channelId: uploadQueue.channelId,
      channelKey: socialChannels.channelKey,
      channelName: socialChannels.name,
      platform: socialChannels.platform,
      platformChannelId: socialChannels.platformChannelId,
      videoType: uploadQueue.videoType,
      scheduledAt: uploadQueue.scheduledAt,
      createdAt: uploadQueue.createdAt,
    })
    .from(uploadQueue)
    .innerJoin(socialChannels, eq(uploadQueue.channelId, socialChannels.id))
    .where(and(
      eq(uploadQueue.status, "queued"),
      eq(socialChannels.channelKey, input.channelKey),
      sql`${uploadQueue.scheduledAt} >= ${startUtc} and ${uploadQueue.scheduledAt} < ${endUtc}`,
      input.platform !== "all" ? eq(socialChannels.platform, input.platform) : undefined,
      input.videoType !== "all" ? eq(uploadQueue.videoType, input.videoType) : undefined,
    ))
    .orderBy(uploadQueue.createdAt);

  return rows;
}

async function main() {
  const execute = hasFlag("--execute");
  const dateVn = getArg("--date-vn", "2026-06-19")!;
  const hourVn = getArg("--hour-vn", "06")!;
  const channelKey = getArg("--channel-key", "phat_phap")!;
  const platform = (getArg("--platform", "all") ?? "all") as PlatformFilter;
  const videoType = (getArg("--video-type", "all") ?? "all") as VideoTypeFilter;

  assert(channelKey === "phat_phap" || hasFlag("--allow-other-channel"), "script only targets phat_phap unless --allow-other-channel is provided");

  const rows = await loadTargetRows({ dateVn, hourVn, channelKey, platform, videoType });
  if (rows.length === 0) {
    console.log("No queued rows matched the requested pileup window.");
    return;
  }

  const groups = new Map<string, QueueRow[]>();
  for (const row of rows) {
    const destinationKey = getUploadDestinationKey({
      platform: row.platform,
      platformChannelId: row.platformChannelId,
      channelId: row.channelId,
    });
    const groupKey = `${destinationKey}|${row.videoType}`;
    const list = groups.get(groupKey) ?? [];
    list.push(row);
    groups.set(groupKey, list);
  }

  const beforeCollisionCount = countSlotCollisions(
    rows.map((row) => ({
      destinationKey: getUploadDestinationKey({
        platform: row.platform,
        platformChannelId: row.platformChannelId,
        channelId: row.channelId,
      }),
      videoType: row.videoType,
      scheduledAt: row.scheduledAt,
    })),
  );

  const plan: Array<{
    id: string;
    contentId: string;
    platform: string;
    channelName: string;
    videoType: string;
    oldScheduledAt: Date;
    newScheduledAt: Date;
  }> = [];

  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const takenRows = await getTakenUploadSlotsForDestination({
      channelId: first.channelId,
      platform: first.platform,
      platformChannelId: first.platformChannelId,
      videoType: first.videoType,
      since: new Date(Date.now() - 24 * 60 * 60 * 1000),
      excludeQueueIds: groupRows.map((row) => row.id),
    });
    const taken = takenRows.map((row) => row.scheduledAt.getTime());

    for (const row of groupRows) {
      const slotOffsetMinutes =
        row.channelKey === "phat_phap" &&
        row.platform === "facebook" &&
        row.videoType === "quote"
          ? 5
          : getSlotOffsetMinutes(row.scheduledAt, 60);
      const newScheduledAt = findNextAvailablePublishSlot({
        windowStart: "06:00",
        windowEnd: "22:00",
        intervalMin: 60,
        taken,
        notBefore: row.scheduledAt,
        slotOffsetMinutes,
      });
      if (!newScheduledAt) {
        throw new Error(`No replacement slot found for queue row ${row.id}`);
      }
      taken.push(newScheduledAt.getTime());
      plan.push({
        id: row.id,
        contentId: row.contentId,
        platform: row.platform,
        channelName: row.channelName,
        videoType: row.videoType,
        oldScheduledAt: row.scheduledAt,
        newScheduledAt,
      });
    }
  }

  const afterCollisionCount = countSlotCollisions(
    plan.map((row) => ({
      destinationKey: getUploadDestinationKey({
        platform: row.platform,
        platformChannelId: rows.find((candidate) => candidate.id === row.id)?.platformChannelId ?? null,
        channelId: rows.find((candidate) => candidate.id === row.id)?.channelId ?? 0,
      }),
      videoType: row.videoType,
      scheduledAt: row.newScheduledAt,
    })),
  );

  assert(afterCollisionCount === 0, `planned repair still contains collisions (${afterCollisionCount})`);

  console.log(`mode=${execute ? "execute" : "dry-run"}`);
  console.log(`rows scanned: ${rows.length}`);
  console.log(`rows that would move: ${plan.filter((row) => row.oldScheduledAt.getTime() !== row.newScheduledAt.getTime()).length}`);
  console.log(`collision count before: ${beforeCollisionCount}`);
  console.log(`collision count after: ${afterCollisionCount}`);
  for (const row of plan) {
    console.log([
      row.platform,
      row.channelName,
      row.videoType,
      row.contentId,
      `${formatVn(row.oldScheduledAt)} VN`,
      "->",
      `${formatVn(row.newScheduledAt)} VN`,
    ].join(" | "));
  }

  if (!execute) {
    console.log("Dry run only. Re-run with --execute to update upload_queue.");
    return;
  }

  const movingRows = plan.filter((row) => row.oldScheduledAt.getTime() !== row.newScheduledAt.getTime());
  for (const row of movingRows) {
    await db.update(uploadQueue)
      .set({
        scheduledAt: row.newScheduledAt,
        updatedAt: new Date(),
      })
      .where(eq(uploadQueue.id, row.id));
  }

  console.log(`Updated ${movingRows.length} upload_queue rows.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
