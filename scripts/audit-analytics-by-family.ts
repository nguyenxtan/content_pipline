import { config } from "dotenv";
config({ path: require("path").join(process.cwd(), ".env.local"), override: true });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // Analytics per family (shorts, youtube platform)
  const res = await db.execute(sql`
    SELECT 
      cg.topic_family,
      COUNT(DISTINCT pv.id) as published_count,
      ROUND(AVG(pv.latest_view_count)) as avg_views,
      MAX(pv.latest_view_count) as max_views,
      MIN(pv.latest_view_count) as min_views,
      SUM(pv.latest_view_count) as total_views,
      ROUND(AVG(pv.latest_like_count)) as avg_likes
    FROM published_videos pv
    JOIN content_generations cg ON cg.id = pv.content_id
    WHERE cg.topic_family IS NOT NULL
      AND pv.platform = 'youtube'
    GROUP BY cg.topic_family
    ORDER BY avg_views DESC
  `);

  console.log("=== ANALYTICS BY TOPIC FAMILY ===\n");
  for (const r of res.rows as any[]) {
    console.log(`${r.topic_family}`);
    console.log(`  published:${r.published_count} | avg_views:${r.avg_views} | max:${r.max_views} | min:${r.min_views} | total:${r.total_views} | avg_likes:${r.avg_likes}`);
  }

  // Top 30 individual topics by views
  const topTopics = await db.execute(sql`
    SELECT 
      cg.topic,
      cg.topic_family,
      pv.latest_view_count,
      pv.latest_like_count,
      pv.published_at
    FROM published_videos pv
    JOIN content_generations cg ON cg.id = pv.content_id
    WHERE pv.platform = 'youtube'
      AND pv.latest_view_count IS NOT NULL
    ORDER BY pv.latest_view_count DESC
    LIMIT 40
  `);

  console.log("\n=== TOP 40 TOPICS BY VIEW COUNT ===\n");
  for (const r of topTopics.rows as any[]) {
    const fam = r.topic_family || "(no family)";
    console.log(`[${r.latest_view_count}v, ${r.latest_like_count}L] [${fam}] ${r.topic}`);
  }

  // Check if we have any analytics columns from youtube data api
  const sample = await db.execute(sql`
    SELECT raw_latest_json FROM published_videos WHERE raw_latest_json IS NOT NULL LIMIT 1
  `);
  if (sample.rows.length > 0) {
    const j = sample.rows[0] as any;
    const raw = typeof j.raw_latest_json === 'string' ? JSON.parse(j.raw_latest_json) : j.raw_latest_json;
    console.log("\n=== SAMPLE raw_latest_json keys ===");
    console.log(Object.keys(raw).join(", "));
  }

  process.exit(0);
}
main().catch(e => { console.error("Fatal:", e.cause?.message || e.message); process.exit(1); });
