import { config } from "dotenv";
config({ path: require("path").join(process.cwd(), ".env.local"), override: true });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
async function main() {
  // Sample rows WITH retention data to understand the values
  const withRet = await db.execute(sql`
    SELECT vms.avg_view_duration_sec, vms.retention_pct, vms.view_count, vms.published_video_id
    FROM video_metric_snapshots vms
    WHERE vms.avg_view_duration_sec IS NOT NULL
    ORDER BY vms.fetched_at DESC
    LIMIT 5
  `);
  console.log("VMS with retention:", JSON.stringify(withRet.rows, null, 2));

  // Join with content topic + family for full picture on retention data
  const richData = await db.execute(sql`
    SELECT 
      cg.topic, cg.topic_family,
      pv.latest_view_count,
      ROUND(AVG(vms.avg_view_duration_sec)) as avg_dur,
      ROUND(AVG(vms.retention_pct::numeric), 1) as avg_ret_pct,
      MAX(vms.fetched_at) as last_fetched
    FROM published_videos pv
    JOIN content_generations cg ON cg.id = pv.content_id
    JOIN video_metric_snapshots vms ON vms.published_video_id = pv.id
    WHERE pv.platform = 'youtube'
      AND vms.avg_view_duration_sec IS NOT NULL
    GROUP BY cg.topic, cg.topic_family, pv.latest_view_count
    ORDER BY pv.latest_view_count DESC
    LIMIT 20
  `);
  console.log("\nTop 20 with retention data:");
  for (const r of richData.rows as any[]) {
    console.log(`[${r.latest_view_count}v, ${r.avg_dur}s, ${r.avg_ret_pct}%] [${r.topic_family||'?'}] ${r.topic}`);
  }

  // Retention stats by family
  const famRet = await db.execute(sql`
    SELECT 
      cg.topic_family,
      COUNT(DISTINCT pv.id) as vids_with_ret,
      ROUND(AVG(vms.avg_view_duration_sec)) as avg_dur_sec,
      ROUND(AVG(vms.retention_pct::numeric), 1) as avg_ret_pct,
      ROUND(AVG(pv.latest_view_count)) as avg_views
    FROM published_videos pv
    JOIN content_generations cg ON cg.id = pv.content_id
    JOIN video_metric_snapshots vms ON vms.published_video_id = pv.id
    WHERE pv.platform = 'youtube'
      AND vms.avg_view_duration_sec IS NOT NULL
      AND cg.topic_family IS NOT NULL
    GROUP BY cg.topic_family
    ORDER BY avg_ret_pct DESC
  `);
  console.log("\nRetention by family:");
  for (const r of famRet.rows as any[]) {
    console.log(`${r.topic_family}: ${r.vids_with_ret} vids, ${r.avg_dur_sec}s dur, ${r.avg_ret_pct}% ret, ${r.avg_views} avg views`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e.cause?.message||e.message);process.exit(1);});
