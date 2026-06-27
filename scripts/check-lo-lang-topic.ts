import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await db.execute(sql`
    SELECT id, topic, channel_key, long_tts_status, long_video_status, long_images_status,
           length(long_content) as script_len
    FROM content_generations
    WHERE topic ILIKE '%lo lắng%' OR topic ILIKE '%lo lang%'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log(JSON.stringify(rows.rows, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
