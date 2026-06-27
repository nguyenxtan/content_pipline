import { config } from "dotenv";
import path from "path";
config({ path: path.join(process.cwd(), ".env.local"), override: true });

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const res = await db.execute(sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name='content_generations' ORDER BY ordinal_position
  `);
  console.log(res.rows.map((r: any) => r.column_name).join("\n"));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
