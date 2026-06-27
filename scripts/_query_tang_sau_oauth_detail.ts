import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await db.execute(sql`
    SELECT
      id,
      name,
      platform,
      channel_key,
      platform_channel_id,
      is_active,
      needs_reconnect,
      oauth_client_config_id,
      token_expires_at,
      last_error,
      created_at,
      updated_at,
      CASE WHEN access_token IS NOT NULL THEN 'SET' ELSE 'NULL' END  AS access_token_present,
      CASE WHEN refresh_token IS NOT NULL THEN 'SET' ELSE 'NULL' END AS refresh_token_present,
      scope
    FROM social_channels
    WHERE channel_key = 'tang_sau'
    ORDER BY id
  `);

  console.log("Tang Sau rows:");
  for (const r of rows.rows) {
    console.log(JSON.stringify(r, null, 2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
