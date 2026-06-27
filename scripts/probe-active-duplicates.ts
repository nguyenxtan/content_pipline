import { db } from "@/lib/db";
import { uploadQueue, socialChannels } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

async function main() {
  const rows = await db.query.uploadQueue.findMany({
    where: and(eq(uploadQueue.platform, "facebook"), inArray(uploadQueue.status, ["queued", "uploading"])),
    columns: { id: true, contentId: true, channelId: true, platform: true, videoType: true, scheduledAt: true, status: true },
  });

  // Group by contentId+videoType to find true content-level duplicates
  const byContent = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.contentId}|${r.videoType}`;
    const g = byContent.get(k) ?? [];
    g.push(r);
    byContent.set(k, g);
  }
  const dupsByContent = [...byContent.entries()].filter(([, v]) => v.length >= 2);
  console.log(`\nActive Facebook queued pairs (same contentId+videoType): ${dupsByContent.length}`);
  for (const [k, v] of dupsByContent) {
    const channelIds = [...new Set(v.map((r) => r.channelId))];
    console.log(`  ${k.slice(0, 8)} channelIds: [${channelIds.join(",")}] rows: ${v.length}`);
    console.log(`    schedules: ${v.map((r) => new Date(r.scheduledAt).toISOString().slice(11, 16) + "Z").join(" / ")}`);
    console.log(`    queueIds: ${v.map((r) => r.id.slice(0, 8)).join(" / ")}`);
  }

  // Group by contentId+videoType+channelId to see if it's same channel or different
  const byContentChannel = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.contentId}|${r.videoType}|${r.channelId}`;
    const g = byContentChannel.get(k) ?? [];
    g.push(r);
    byContentChannel.set(k, g);
  }
  const dupsByContentChannel = [...byContentChannel.entries()].filter(([, v]) => v.length >= 2);
  console.log(`\nActive Facebook queued pairs (same contentId+videoType+channelId): ${dupsByContentChannel.length}`);

  const sc = await db.query.socialChannels.findMany({
    where: eq(socialChannels.platform, "facebook"),
    columns: { id: true, name: true, channelKey: true, platformChannelId: true, isActive: true, needsReconnect: true },
  });
  console.log(`\nFacebook social_channels (${sc.length} rows):`);
  for (const c of sc) {
    console.log(`  id=${c.id} name="${c.name}" channelKey=${c.channelKey} platformChannelId=${c.platformChannelId} active=${c.isActive} reconnect=${c.needsReconnect}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
