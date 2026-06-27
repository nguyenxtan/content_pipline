import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const gateCount = await db.execute(sql`SELECT status, COUNT(*)::int as cnt FROM upload_queue WHERE status IN ('queued','uploading','error','pending') GROUP BY status ORDER BY status`);
  console.log("STATUS BREAKDOWN:", JSON.stringify(gateCount.rows));

  const r = await db.execute(sql`SELECT id, channel_key, format_type, topic, video_status FROM content_generations WHERE id::text IN ('146ad564-0e16-41ad-8d40-1bb58582335b','9e80334b-032c-450e-b999-9455a00fc116','f8c52f6f-4824-43df-8f5d-5c99541db287')`);
  console.log("NEEDS_REVIEW content:", JSON.stringify(r.rows));

  const fbq = await db.execute(sql`
    SELECT uq.id, uq.status, uq.scheduled_at, cg.format_type, cg.channel_key
    FROM upload_queue uq JOIN content_generations cg ON cg.id = uq.content_id
    WHERE uq.status = 'queued' AND uq.platform = 'facebook' AND uq.video_type = 'quote'
      AND cg.channel_key = 'phat_phap'
    ORDER BY uq.scheduled_at
  `);
  console.log("FB QUOTE rows:", fbq.rows.length);
  for (const r of fbq.rows as any[]) {
    const vnH = r.scheduled_at ? (new Date(r.scheduled_at).getUTCHours() + 7) % 24 : "—";
    console.log(`  ${r.id.slice(0,12)} h${String(vnH).padStart(2,"0")} ${new Date(r.scheduled_at).toISOString().slice(0,10)} ${r.format_type ?? "—"}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
