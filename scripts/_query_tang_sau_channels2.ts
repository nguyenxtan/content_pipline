import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // Which channel_id values are used in upload_queue for tang_sau content?
  const usage = await db.execute(sql`
    SELECT
      uq.channel_id,
      sc.name,
      sc.platform,
      sc.is_active,
      sc.needs_reconnect,
      sc.token_expires_at,
      sc.created_at AS sc_created_at,
      COUNT(*) AS queue_rows,
      SUM(CASE WHEN uq.status = 'queued' THEN 1 ELSE 0 END)    AS queued,
      SUM(CASE WHEN uq.status = 'uploading' THEN 1 ELSE 0 END) AS uploading,
      SUM(CASE WHEN uq.status = 'done' THEN 1 ELSE 0 END)      AS done,
      SUM(CASE WHEN uq.status = 'error' THEN 1 ELSE 0 END)     AS errors,
      SUM(CASE WHEN uq.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    JOIN content_generations cg ON cg.id = uq.content_id
    WHERE cg.channel_key = 'tang_sau'
    GROUP BY uq.channel_id, sc.name, sc.platform, sc.is_active, sc.needs_reconnect, sc.token_expires_at, sc.created_at
    ORDER BY uq.channel_id
  `);

  console.log("\nupload_queue channel_id usage for tang_sau content:");
  for (const r of usage.rows) {
    console.log(JSON.stringify(r));
  }

  // Also check how the channel is picked in shortDestinations (channel_workspace_registry)
  const { getWorkspaceById } = await import("@/lib/channel-workspace-registry");
  const ws = getWorkspaceById("tang_sau_workspace");
  console.log("\ntang_sau_workspace:", JSON.stringify(ws, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
