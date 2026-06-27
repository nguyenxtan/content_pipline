import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { niches, socialChannels, contentGenerations, uploadQueue } from "@/lib/db/schema";
import { eq, and, inArray, sql, desc, notInArray } from "drizzle-orm";

async function main() {
  // 1. phat_phap channels
  const channels = await db.select().from(socialChannels)
    .where(eq(socialChannels.channelKey, "phat_phap"));
  console.log("CHANNELS:", JSON.stringify(channels.map(c => ({
    id: c.id, name: c.name, platform: c.platform, channelKey: c.channelKey,
  })), null, 2));

  // 2. phat_phap niches
  const ns = await db.select().from(niches)
    .where(eq(niches.channelKey, "phat_phap"));
  console.log("NICHES:", JSON.stringify(ns.map(n => ({
    id: n.id, name: n.name, channelKey: n.channelKey,
    contentProfileKey: (n as Record<string, unknown>).contentProfileKey,
    ttsVoice: (n as Record<string, unknown>).ttsVoice,
  })), null, 2));

  // 3. Existing queued topics (last 40 to check for duplicates)
  const queued = await db.select({
    id: contentGenerations.id,
    topic: contentGenerations.topic,
    topicFamily: contentGenerations.topicFamily,
    contentType: contentGenerations.contentType,
    ttsStatus: contentGenerations.ttsStatus,
    videoStatus: contentGenerations.videoStatus,
    channelKey: contentGenerations.channelKey,
    scheduledAt: contentGenerations.scheduledAt,
  }).from(contentGenerations)
    .where(eq(contentGenerations.channelKey, "phat_phap"))
    .orderBy(desc(contentGenerations.scheduledAt))
    .limit(40);
  console.log("RECENT_PHAT_PHAP:", JSON.stringify(queued, null, 2));

  // 4. Upload queue status
  const uq = await db.select({
    id: uploadQueue.id,
    contentId: uploadQueue.contentId,
    status: uploadQueue.status,
    platform: uploadQueue.platform,
    scheduledAt: uploadQueue.scheduledAt,
  }).from(uploadQueue)
    .orderBy(desc(uploadQueue.scheduledAt))
    .limit(10);
  console.log("RECENT_UPLOAD_QUEUE:", JSON.stringify(uq, null, 2));

  // 5. Count queued by status
  const stats = await db.select({
    channelKey: contentGenerations.channelKey,
    contentType: contentGenerations.contentType,
    videoStatus: contentGenerations.videoStatus,
    ttsStatus: contentGenerations.ttsStatus,
    cnt: sql<number>`count(*)`,
  }).from(contentGenerations)
    .where(eq(contentGenerations.channelKey, "phat_phap"))
    .groupBy(
      contentGenerations.channelKey,
      contentGenerations.contentType,
      contentGenerations.videoStatus,
      contentGenerations.ttsStatus,
    );
  console.log("STATUS_STATS:", JSON.stringify(stats, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
