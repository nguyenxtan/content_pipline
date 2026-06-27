import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query("SELECT chapter_text, quality_check FROM story_chapters WHERE id=43");
  const row = r.rows[0];
  const text = row.chapter_text ?? "";
  console.log("=== DRAFT TEXT (first 2000 chars) ===");
  console.log(text.slice(0, 2000));
  console.log("\n=== DRAFT TEXT (last 600 chars) ===");
  console.log(text.slice(-600));
  console.log("\n=== QC JSON ===");
  console.log(JSON.stringify(row.quality_check, null, 2));
  await pool.end();
}

main().catch(console.error);
