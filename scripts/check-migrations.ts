import { config } from "dotenv";
import path from "path";
config({ path: path.join(process.cwd(), ".env.local"), override: true });

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  try {
    const res = await db.execute(sql`SELECT 1 as ok`);
    console.log("DB connection OK:", res.rows);
  } catch (e: any) {
    console.error("DB ping failed:");
    console.error("  message:", e.message);
    console.error("  cause:", e.cause);
    console.error("  cause.message:", e.cause?.message);
    console.error("  cause.code:", e.cause?.code);
    console.error("  cause.detail:", e.cause?.detail);
  }
  process.exit(0);
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
