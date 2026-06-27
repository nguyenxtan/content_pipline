import { config } from "dotenv";
config({ path: require("path").join(process.cwd(), ".env.local"), override: true });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
async function main() {
  // How many PV rows have a content_id that exists in content_generations?
  const r1 = await db.execute(sql`
    SELECT COUNT(*) as total,
      COUNT(cg.id) as matched_cg,
      COUNT(CASE WHEN cg.id IS NULL THEN 1 END) as no_cg,
      COUNT(CASE WHEN cg.topic IS NULL AND cg.id IS NOT NULL THEN 1 END) as null_topic
    FROM published_videos pv
    LEFT JOIN content_generations cg ON cg.id = pv.content_id
    WHERE pv.platform = 'youtube'
  `);
  console.log("PV join stats:", r1.rows[0]);

  // What content_id values look like for the orphaned PVs?
  const r2 = await db.execute(sql`
    SELECT pv.content_id, pv.title, pv.latest_view_count
    FROM published_videos pv
    LEFT JOIN content_generations cg ON cg.id = pv.content_id
    WHERE pv.platform = 'youtube' AND cg.id IS NULL
    ORDER BY pv.latest_view_count DESC NULLS LAST
    LIMIT 10
  `);
  console.log("\nOrphaned PV rows (no CG match):", r2.rows.length > 0 ? JSON.stringify(r2.rows[0]) : "none");
  for (const r of r2.rows as any[]) console.log(`  [${r.latest_view_count}v] ${r.content_id} — ${r.title?.slice(0,60)}`);

  // Check content_outputs table (alternative content store?)
  const r3 = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name='content_outputs' LIMIT 10`);
  console.log("\ncontent_outputs cols:", r3.rows.map((r:any)=>r.column_name).join(", "));

  // Check generated_contents
  const r4 = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name='generated_contents' LIMIT 10`);
  console.log("generated_contents cols:", r4.rows.map((r:any)=>r.column_name).join(", "));

  // Check content_pieces
  const r5 = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name='content_pieces' LIMIT 10`);
  console.log("content_pieces cols:", r5.rows.map((r:any)=>r.column_name).join(", "));
  process.exit(0);
}
main().catch(e=>{console.error(e.cause?.message||e.message);process.exit(1);});
