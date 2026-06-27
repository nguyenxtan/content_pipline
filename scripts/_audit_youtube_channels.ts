import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // All YouTube social_channels for both brands
  const channels = await db.execute(sql`
    SELECT
      sc.id, sc.name, sc.channel_key, sc.platform,
      sc.oauth_client_config_id, sc.platform_channel_id,
      sc.needs_reconnect, sc.is_active,
      sc.token_expires_at, sc.last_error,
      yoc.name AS client_name,
      COUNT(uq.id) AS queue_count
    FROM social_channels sc
    LEFT JOIN youtube_oauth_clients yoc ON yoc.id = sc.oauth_client_config_id
    LEFT JOIN upload_queue uq ON uq.channel_id = sc.id
    WHERE sc.platform = 'youtube'
      AND sc.channel_key IN ('phat_phap', 'tang_sau')
    GROUP BY sc.id, sc.name, sc.channel_key, sc.platform,
             sc.oauth_client_config_id, sc.platform_channel_id,
             sc.needs_reconnect, sc.is_active, sc.token_expires_at,
             sc.last_error, yoc.name
    ORDER BY sc.channel_key, sc.oauth_client_config_id NULLS LAST
  `);

  console.log("\n=== YouTube social_channels ===");
  for (const r of channels.rows) {
    const row = r as Record<string, unknown>;
    console.log(JSON.stringify({
      id: row.id,
      channel_key: row.channel_key,
      name: row.name,
      oauth_client_config_id: row.oauth_client_config_id,
      client_name: row.client_name,
      platform_channel_id: row.platform_channel_id,
      needs_reconnect: row.needs_reconnect,
      is_active: row.is_active,
      token_expires_at: row.token_expires_at,
      last_error: row.last_error,
      queue_count: row.queue_count,
    }));
  }

  // Canonical per brand (highest queue usage)
  const canonical = await db.execute(sql`
    SELECT DISTINCT ON (sc.channel_key)
      sc.channel_key, sc.id AS canonical_sc_id,
      sc.oauth_client_config_id, sc.name,
      COUNT(uq.id) AS queue_count
    FROM social_channels sc
    LEFT JOIN upload_queue uq ON uq.channel_id = sc.id
    WHERE sc.platform = 'youtube'
      AND sc.channel_key IN ('phat_phap', 'tang_sau')
    GROUP BY sc.channel_key, sc.id, sc.oauth_client_config_id, sc.name
    ORDER BY sc.channel_key, COUNT(uq.id) DESC
  `);

  console.log("\n=== Canonical rows (highest queue usage) ===");
  for (const r of canonical.rows) {
    const row = r as Record<string, unknown>;
    console.log(JSON.stringify(row));
  }

  // OAuth clients
  const clients = await db.execute(sql`
    SELECT id, name FROM youtube_oauth_clients ORDER BY id
  `);
  console.log("\n=== youtube_oauth_clients ===");
  for (const r of clients.rows) console.log(JSON.stringify(r));
}

main().catch((e) => { console.error(e); process.exit(1); });
