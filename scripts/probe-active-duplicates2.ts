import { db } from "@/lib/db";
import { uploadQueue } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

async function main() {
  const rows = await db.query.uploadQueue.findMany({
    where: and(eq(uploadQueue.platform, "facebook"), inArray(uploadQueue.status, ["queued", "uploading"])),
    columns: { id: true, contentId: true, channelId: true, videoType: true, scheduledAt: true },
  });

  console.log(`Total active Facebook queued rows: ${rows.length}`);

  // Replicate the audit's dedup key: contentId:platform:channelKey
  // channelKey is always 'phat_phap' for channelId=6 (only FB channel)
  // The audit groups by content_id:platform:sc_channel_key (no video_type!)
  const byAuditKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.contentId}:facebook:phat_phap`; // sc_channel_key for channelId=6
    const g = byAuditKey.get(k) ?? [];
    g.push(r);
    byAuditKey.set(k, g);
  }
  const dupsByAuditKey = [...byAuditKey.entries()].filter(([, v]) => v.length >= 2);
  console.log(`\nDuplicates by audit key (contentId:platform:channelKey, no videoType): ${dupsByAuditKey.length} groups`);
  for (const [, v] of dupsByAuditKey) {
    const types = v.map((r) => r.videoType).sort().join("+");
    const times = v.map((r) => new Date(r.scheduledAt).toISOString().slice(11, 16) + "Z @ " + r.videoType).sort().join(" / ");
    console.log(`  contentId=${v[0].contentId.slice(0, 8)} videoTypes=[${types}] → ${times}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
