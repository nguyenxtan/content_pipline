import { config } from "dotenv";
config({ path: require("path").join(process.cwd(), ".env.local"), override: true });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
async function main() {
  // published_videos columns
  const pv = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='published_videos' ORDER BY ordinal_position`);
  console.log("published_videos:", pv.rows.map((r:any)=>`${r.column_name}:${r.data_type}`).join(" | "));
  // sample raw_latest_json keys from youtube (not facebook)
  const yt = await db.execute(sql`SELECT raw_latest_json FROM published_videos WHERE platform='youtube' AND raw_latest_json IS NOT NULL LIMIT 2`);
  for (const r of yt.rows as any[]) {
    const j = typeof r.raw_latest_json === 'string' ? JSON.parse(r.raw_latest_json) : r.raw_latest_json;
    console.log("\nYT raw_latest_json:", JSON.stringify(j).slice(0, 400));
  }
  // check for any analytics tables
  const tabs = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
  console.log("\nAll tables:", tabs.rows.map((r:any)=>r.table_name).join(", "));
  process.exit(0);
}
main().catch(e=>{console.error(e.cause?.message||e.message);process.exit(1);});
