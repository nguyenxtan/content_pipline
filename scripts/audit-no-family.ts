import { config } from "dotenv";
config({ path: require("path").join(process.cwd(), ".env.local"), override: true });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // Top topics WITHOUT a topicFamily — these are un-classified hits
  const res = await db.execute(sql`
    SELECT 
      cg.topic,
      cg.topic_family,
      pv.latest_view_count,
      pv.latest_like_count,
      pv.published_at,
      SUBSTRING(cg.short_content, 1, 200) as excerpt
    FROM published_videos pv
    JOIN content_generations cg ON cg.id = pv.content_id
    WHERE pv.platform = 'youtube'
      AND pv.latest_view_count IS NOT NULL
      AND pv.latest_view_count > 300
    ORDER BY pv.latest_view_count DESC
  `);

  console.log("=== ALL PUBLISHED TOPICS >300 views (with family) ===\n");
  for (const r of res.rows as any[]) {
    const fam = r.topic_family || "(unclassified)";
    console.log(`[${r.latest_view_count}v, ${r.latest_like_count}L] [${fam}] ${r.topic}`);
  }

  // Total stats
  const totals = await db.execute(sql`
    SELECT 
      COUNT(*) as total_published,
      SUM(pv.latest_view_count) as total_views,
      ROUND(AVG(pv.latest_view_count)) as avg_views,
      COUNT(CASE WHEN pv.latest_view_count > 500 THEN 1 END) as over_500,
      COUNT(CASE WHEN pv.latest_view_count > 1000 THEN 1 END) as over_1k,
      COUNT(CASE WHEN pv.latest_view_count IS NULL OR pv.latest_view_count = 0 THEN 1 END) as zero_views
    FROM published_videos pv
    WHERE pv.platform = 'youtube'
  `);
  
  const t = totals.rows[0] as any;
  console.log(`\n=== OVERALL STATS ===`);
  console.log(`Total published: ${t.total_published}`);
  console.log(`Total views: ${t.total_views}`);
  console.log(`Avg views: ${t.avg_views}`);
  console.log(`>500 views: ${t.over_500}`);
  console.log(`>1000 views: ${t.over_1k}`);
  console.log(`Zero views: ${t.zero_views}`);

  process.exit(0);
}
main().catch(e => { console.error("Fatal:", e.cause?.message || e.message); process.exit(1); });
