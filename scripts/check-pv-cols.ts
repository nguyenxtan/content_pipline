import { config } from "dotenv";
config({ path: require("path").join(process.cwd(), ".env.local"), override: true });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
async function main() {
  const r = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name='published_videos' ORDER BY ordinal_position`);
  console.log(r.rows.map((x:any)=>x.column_name).join(", "));
  process.exit(0);
}
main().catch(e=>{console.error(e.cause?.message||e.message);process.exit(1);});
