import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const VIETNAM_TZ = "Asia/Ho_Chi_Minh";

type QueueRow = {
  content_id: string;
  title: string;
  format_type: "tts_short" | "legacy_quote_short";
  scheduled_at: string;
  platform: "youtube" | "facebook";
  video_type: string;
  status: string;
};

type WrongLaneRow = {
  content_id: string;
  title: string;
  scheduled_at: string;
  status: string;
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

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const [shortRowsResult, wrongLaneResult] = await Promise.all([
      pool.query<QueueRow>(`
        select
          c.id as content_id,
          coalesce(nullif(c.topic, ''), c.id) as title,
          c.format_type,
          q.scheduled_at,
          q.platform,
          q.video_type,
          q.status
        from content_generations c
        join upload_queue q on q.content_id = c.id
        where c.channel_key = 'phat_phap'
          and c.format_type in ('tts_short', 'legacy_quote_short')
          and q.status in ('queued', 'uploading', 'pending')
          and q.scheduled_at >= now()
          and (
            q.video_type = 'short'
            or (q.platform = 'facebook' and q.video_type = 'quote')
          )
        order by q.scheduled_at asc, c.id asc, q.platform asc, q.video_type asc
      `),
      pool.query<WrongLaneRow>(`
        select
          c.id as content_id,
          coalesce(nullif(c.topic, ''), c.id) as title,
          q.scheduled_at,
          q.status
        from content_generations c
        join upload_queue q on q.content_id = c.id
        where c.channel_key = 'phat_phap'
          and c.format_type = 'legacy_quote_short'
          and q.platform = 'facebook'
          and q.video_type = 'quote'
          and q.status in ('queued', 'uploading', 'pending')
          and q.scheduled_at >= now()
        order by q.scheduled_at desc
      `),
    ]);

    const rows = shortRowsResult.rows;
    const wrongLaneRows = wrongLaneResult.rows;

    const grouped = new Map<string, {
      contentId: string;
      title: string;
      formatType: "tts_short" | "legacy_quote_short";
      scheduledAtUtc: string;
      scheduledAtVn: string | null;
      actualPlatformRows: string[];
      shortPlatforms: Set<string>;
      shortSlotSet: Set<string>;
      wrongLaneRows: string[];
    }>();

    for (const row of rows) {
      const shortRowsForGroup = row.video_type === "short";
      const groupKey = shortRowsForGroup
        ? `${row.content_id}|${row.scheduled_at}`
        : `${row.content_id}|wrong-lane|${row.scheduled_at}`;
      const existing = grouped.get(groupKey) ?? {
        contentId: row.content_id,
        title: row.title,
        formatType: row.format_type,
        scheduledAtUtc: row.scheduled_at,
        scheduledAtVn: formatVn(row.scheduled_at),
        actualPlatformRows: [],
        shortPlatforms: new Set<string>(),
        shortSlotSet: new Set<string>(),
        wrongLaneRows: [],
      };

      const taskLabel = `${row.platform}/${row.video_type}/${row.status}`;
      existing.actualPlatformRows.push(taskLabel);
      if (row.video_type === "short") {
        existing.shortPlatforms.add(row.platform);
        existing.shortSlotSet.add(row.scheduled_at);
      }
      if (row.platform === "facebook" && row.video_type === "quote") {
        existing.wrongLaneRows.push(taskLabel);
      }
      grouped.set(groupKey, existing);
    }

    const contentWideShortSlots = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.video_type !== "short") continue;
      const slots = contentWideShortSlots.get(row.content_id) ?? new Set<string>();
      slots.add(row.scheduled_at);
      contentWideShortSlots.set(row.content_id, slots);
    }

    const summaryRows = Array.from(grouped.values())
      .filter((item) => item.actualPlatformRows.some((row) => row.includes("/short/")))
      .map((item) => {
        const shortSlots = contentWideShortSlots.get(item.contentId) ?? new Set<string>();
        const hasYoutube = item.shortPlatforms.has("youtube");
        const hasFacebook = item.shortPlatforms.has("facebook");
        const missingPlatformRows = [
          !hasYoutube ? "YouTube Short" : null,
          !hasFacebook ? "Facebook Reel" : null,
        ].filter(Boolean) as string[];
        const sameScheduledAt = shortSlots.size <= 1;
        const wrongLane = wrongLaneRows
          .filter((row) => row.content_id === item.contentId)
          .map((row) => `facebook/quote/${row.status}@${row.scheduled_at}`);
        const cleanupEligibilityRisk =
          missingPlatformRows.length > 0 ||
          !sameScheduledAt ||
          wrongLane.length > 0
            ? "blocked"
            : "paired";

        return {
          contentId: item.contentId,
          title: item.title,
          formatType: item.formatType,
          scheduledAtUtc: item.scheduledAtUtc,
          scheduledAtVn: item.scheduledAtVn,
          expectedPlatforms: ["youtube/short", "facebook/short"],
          actualPlatformRows: item.actualPlatformRows,
          sameContentGenerationIdCheck: "pass",
          sameScheduledAtCheck: sameScheduledAt ? "pass" : "fail",
          missingPlatformRows,
          wrongFacebookQuoteLaneRows: wrongLane,
          cleanupEligibilityRisk,
        };
      })
      .sort((left, right) => new Date(left.scheduledAtUtc).getTime() - new Date(right.scheduledAtUtc).getTime());

    const completePairs = summaryRows.filter((row) =>
      row.missingPlatformRows.length === 0 &&
      row.sameScheduledAtCheck === "pass" &&
      row.wrongFacebookQuoteLaneRows.length === 0,
    ).length;
    const missingYoutubeRows = summaryRows.filter((row) => row.missingPlatformRows.includes("YouTube Short")).length;
    const missingFacebookRows = summaryRows.filter((row) => row.missingPlatformRows.includes("Facebook Reel")).length;
    const misalignedSlots = summaryRows.filter((row) => row.sameScheduledAtCheck === "fail").length;

    console.log(JSON.stringify({
      summary: {
        contentItems: summaryRows.length,
        platformRows: summaryRows.reduce((count, row) => count + row.actualPlatformRows.length, 0),
        completePairs,
        missingYoutubeRows,
        missingFacebookRows,
        misalignedSlots,
        wrongFacebookQuoteRows: wrongLaneRows.length,
      },
      items: summaryRows,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
