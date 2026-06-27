import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // 1. All tang_sau social_channels rows
  const channels = await db.execute(sql`
    SELECT id, name, platform, platform_channel_id, platform_account_id, is_active, quota_exceeded_until
    FROM social_channels
    WHERE channel_key = 'tang_sau'
    ORDER BY platform, id ASC
  `);
  console.log("\n## Tang Sau Channels");
  for (const r of channels.rows as any[]) {
    console.log(`  ch_id=${r.id}  name="${r.name}"  platform=${r.platform}  platform_channel_id=${r.platform_channel_id}  account_id=${r.platform_account_id}  is_active=${r.is_active}`);
  }

  // 2. Cancelled rows from health reduction
  const cancelled = await db.execute(sql`
    SELECT uq.id, uq.content_id, uq.channel_id, uq.platform, uq.video_type, uq.status,
           uq.error_message, uq.scheduled_at,
           sc.name as channel_name, sc.platform_channel_id, sc.platform_account_id,
           cg.channel_key, cg.topic
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    JOIN content_generations cg ON cg.id = uq.content_id
    WHERE uq.error_message = 'queue_health_cap_reduction'
      AND cg.channel_key = 'tang_sau'
    ORDER BY uq.scheduled_at, uq.id
  `);

  console.log("\n## Cancelled Tang Sau Rows (health_cap_reduction)");
  for (const r of cancelled.rows as any[]) {
    const vnH = r.scheduled_at ? (new Date(r.scheduled_at).getUTCHours() + 7) % 24 : "?";
    const vnDate = r.scheduled_at ? new Date(new Date(r.scheduled_at).getTime() + 7*3600_000).toISOString().slice(0,10) : "null";
    console.log(`  uq=${r.id}  content=${r.content_id}  ch_id=${r.channel_id}(${r.channel_name})  platform_ch=${r.platform_channel_id}  acct=${r.platform_account_id}  sched=VN ${vnDate} h${String(vnH).padStart(2,"0")}`);
  }
  console.log(`  Total: ${cancelled.rows.length}`);

  // 3. For each cancelled content_id, find active canonical rows
  const contentIds = [...new Set((cancelled.rows as any[]).map(r => r.content_id))];
  console.log("\n## Active rows for same content_ids (canonical check)");
  for (const cid of contentIds) {
    const active = await db.execute(sql`
      SELECT uq.id, uq.channel_id, uq.status, uq.scheduled_at, uq.platform, uq.video_type,
             sc.platform_channel_id, sc.platform_account_id, sc.name as ch_name
      FROM upload_queue uq
      JOIN social_channels sc ON sc.id = uq.channel_id
      WHERE uq.content_id = ${cid}
        AND uq.status IN ('queued','uploading','done')
      ORDER BY uq.id
    `);
    const rows = active.rows as any[];
    if (rows.length === 0) {
      console.log(`  ${cid}  → NO active row (orphaned!)`);
    } else {
      for (const r of rows) {
        console.log(`  ${cid}  ch_id=${r.channel_id}(${r.ch_name})  platform_ch=${r.platform_channel_id}  status=${r.status}  sched=${r.scheduled_at?.toISOString().slice(0,10)}`);
      }
    }
  }

  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
