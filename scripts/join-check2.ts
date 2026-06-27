import { config } from "dotenv";
config({ path: require("path").join(process.cwd(), ".env.local"), override: true });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
async function main() {
  // Video types and their counts for null-content_id videos
  const r = await db.execute(sql`
    SELECT video_type, COUNT(*) as cnt, SUM(latest_view_count) as total_views, ROUND(AVG(latest_view_count)) as avg_views, MAX(latest_view_count) as max_views
    FROM published_videos WHERE platform='youtube' AND content_id IS NULL
    GROUP BY video_type ORDER BY cnt DESC
  `);
  console.log("Null-cg PV by video_type:", r.rows);

  // How many null-cg PVs have duration > 60s (longform)?
  const dur = await db.execute(sql`
    SELECT duration_seconds, video_type, title, latest_view_count
    FROM published_videos WHERE platform='youtube' AND content_id IS NULL
    ORDER BY latest_view_count DESC NULLS LAST LIMIT 20
  `);
  console.log("\nTop null-cg PVs:");
  for (const r2 of dur.rows as any[]) {
    console.log(`  [${r2.latest_view_count}v, ${r2.duration_seconds}s, ${r2.video_type}] ${r2.title?.slice(0,65)}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e.cause?.message||e.message);process.exit(1);});
