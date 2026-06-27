import { config } from "dotenv";
config({ path: require("path").join(process.cwd(), ".env.local"), override: true });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
async function main() {
  // Check published_videos for retention/analytics columns
  const pvFull = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='published_videos' ORDER BY ordinal_position`);
  console.log("published_videos columns:", pvFull.rows.map((r:any)=>r.column_name).join(", "));

  // Check video_metric_snapshots
  const vms = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='video_metric_snapshots' ORDER BY ordinal_position`);
  console.log("\nvideo_metric_snapshots:", vms.rows.map((r:any)=>r.column_name).join(", "));

  // Sample video_metric_snapshots
  const vmsSample = await db.execute(sql`SELECT * FROM video_metric_snapshots LIMIT 3`);
  console.log("\nSample VMS:", JSON.stringify(vmsSample.rows[0], null, 2));

  // Count rows in video_metric_snapshots
  const cnt = await db.execute(sql`SELECT COUNT(*) FROM video_metric_snapshots`);
  console.log("\nVMS count:", (cnt.rows[0] as any).count);

  // Check if published_videos has avg_view_duration_sec / retention_pct
  const pvSample = await db.execute(sql`
    SELECT id, latest_view_count, avg_view_duration_sec, retention_pct, estimated_minutes_watched, subscribers_gained 
    FROM published_videos WHERE avg_view_duration_sec IS NOT NULL LIMIT 5
  `);
  console.log("\nPV with retention data:", pvSample.rows.length > 0 ? JSON.stringify(pvSample.rows[0]) : "NONE FOUND");

  process.exit(0);
}
main().catch(e=>{console.error(e.cause?.message||e.message);process.exit(1);});
