import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    SELECT uq.id, uq.content_id, uq.channel_id, uq.status, uq.scheduled_at, cg.topic, cg.format_type
    FROM upload_queue uq
    JOIN content_generations cg ON uq.content_id = cg.id
    ORDER BY uq.created_at DESC LIMIT 10
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
