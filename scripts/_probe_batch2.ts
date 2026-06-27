import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { niches, socialChannels, contentGenerations } from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

async function main() {
  // Get all phat_phap channels with more detail
  const channels = await db.select().from(socialChannels)
    .where(eq(socialChannels.channelKey, "phat_phap"));
  console.log("CHANNELS:", JSON.stringify(channels, null, 2));

  // Recent phat_phap topics (last 30) to avoid duplicates
  const recent = await db.select({
    id: contentGenerations.id,
    topic: contentGenerations.topic,
    topicFamily: contentGenerations.topicFamily,
    formatType: contentGenerations.formatType,
    contentMode: contentGenerations.contentMode,
    videoStatus: contentGenerations.videoStatus,
    ttsStatus: contentGenerations.ttsStatus,
    createdAt: contentGenerations.createdAt,
  }).from(contentGenerations)
    .where(eq(contentGenerations.channelKey, "phat_phap"))
    .orderBy(desc(contentGenerations.createdAt))
    .limit(30);
  console.log("RECENT_TOPICS:", JSON.stringify(recent, null, 2));

  // Count by formatType and videoStatus for phat_phap
  const stats = await db.execute(sql`
    SELECT format_type, video_status, tts_status, count(*) as cnt
    FROM content_generations
    WHERE channel_key = 'phat_phap'
    GROUP BY format_type, video_status, tts_status
    ORDER BY cnt DESC
  `);
  console.log("STATS:", JSON.stringify(stats.rows, null, 2));

  // Latest scheduledAt from uploadQueue to find last scheduled slot
  const lastQueue = await db.execute(sql`
    SELECT uq.scheduled_at, uq.platform, uq.status, cg.topic, cg.channel_key
    FROM upload_queue uq
    JOIN content_generations cg ON uq.content_id = cg.id
    WHERE cg.channel_key = 'phat_phap'
    ORDER BY uq.scheduled_at DESC
    LIMIT 10
  `);
  console.log("LAST_QUEUE_SCHEDULE:", JSON.stringify(lastQueue.rows, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
