import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { uploadQueue, contentGenerations, socialChannels } from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

async function main() {
  // Which channel_id values appear in upload_queue for tang_sau content?
  const tsContent = await db.select({ id: contentGenerations.id })
    .from(contentGenerations)
    .where(eq(contentGenerations.channelKey, "tang_sau"));
  const tsIds = tsContent.map(r => r.id);

  if (tsIds.length === 0) { console.log("No tang_sau content"); return; }

  const queueChannelUsage = await db.execute(sql`
    SELECT
      uq.channel_id,
      sc.name,
      sc.platform,
      sc.is_active,
      sc.needs_reconnect,
      COUNT(*) as queue_rows,
      SUM(CASE WHEN uq.status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN uq.status = 'done' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN uq.status = 'error' THEN 1 ELSE 0 END) as errors
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.content_id = ANY(${tsIds})
    GROUP BY uq.channel_id, sc.name, sc.platform, sc.is_active, sc.needs_reconnect
    ORDER BY uq.channel_id
  `);

  console.log("\nupload_queue channel_id usage for tang_sau content:");
  for (const r of queueChannelUsage.rows) {
    console.log(JSON.stringify(r));
  }

  // How does autoScheduleVideoAction pick which channel row?
  // Let's also see what channel row the scheduler queries use.
  // Check the channel_workspace_registry for tang_sau
}

main().catch((e) => { console.error(e); process.exit(1); });
