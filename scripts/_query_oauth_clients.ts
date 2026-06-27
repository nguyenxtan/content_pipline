import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const clients = await db.execute(sql`
    SELECT id, name, client_id, created_at,
      CASE WHEN client_secret IS NOT NULL THEN 'SET' ELSE 'NULL' END AS client_secret_present
    FROM youtube_oauth_clients
    ORDER BY id
  `);
  console.log("youtube_oauth_clients:");
  for (const r of clients.rows) console.log(JSON.stringify(r));
}

main().catch((e) => { console.error(e); process.exit(1); });
