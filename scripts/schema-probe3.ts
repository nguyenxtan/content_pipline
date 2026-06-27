import { config } from "dotenv";
config({ path: require("path").join(process.cwd(), ".env.local"), override: true });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
async function main() {
  // How many VMS rows have retention data?
  const ret = await db.execute(sql`SELECT COUNT(*) as total, COUNT(avg_view_duration_sec) as with_dur, COUNT(retention_pct) as with_ret FROM video_metric_snapshots`);
  console.log("VMS retention coverage:", ret.rows[0]);

  // Latest snapshot per published video (to get most recent metrics)
  const latest = await db.execute(sql`
    SELECT pv.platform, COUNT(DISTINCT pv.id) as vids, 
           AVG(vms.view_count::numeric) as avg_views,
           MAX(vms.view_count::numeric) as max_views,
           COUNT(vms.avg_view_duration_sec) as with_dur
    FROM published_videos pv
    LEFT JOIN video_metric_snapshots vms ON vms.published_video_id = pv.id
    GROUP BY pv.platform
  `);
  console.log("\nPerf by platform:", latest.rows);

  // Date range of published videos
  const dates = await db.execute(sql`SELECT MIN(published_at)::date as oldest, MAX(published_at)::date as newest, COUNT(*) as total FROM published_videos WHERE platform='youtube'`);
  console.log("\nDate range:", dates.rows[0]);

  // Channel distribution
  const channels = await db.execute(sql`
    SELECT credential_channel_id, COUNT(*) as cnt, SUM(latest_view_count) as total_views
    FROM published_videos WHERE platform='youtube'
    GROUP BY credential_channel_id ORDER BY total_views DESC
  `);
  console.log("\nChannels:", channels.rows);

  process.exit(0);
}
main().catch(e=>{console.error(e.cause?.message||e.message);process.exit(1);});
