import { Pool } from "pg";

const STORY_ID = "20f30412-102b-4bae-a279-2ddb25b509eb";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const r = await pool.query(
    `SELECT chapter_number, title, LEFT(chapter_text, 5000) as chapter_text
     FROM story_chapters
     WHERE story_id = $1 AND chapter_number BETWEEN 1 AND 9
     ORDER BY chapter_number`,
    [STORY_ID],
  );

  const CHECKS = [
    { label: "Tee Audio chào", pattern: /tee\s*audio\s*chào/i },
    { label: "Văn án header", pattern: /văn\s*án/i },
    { label: "Synopsis paragraph", pattern: /an\s*hạ[,.]?\s*con\s*gái\s*ruột\s*bị\s*gia\s*tộc\s*hắt\s*hủi/i },
  ];

  let found = 0;
  for (const row of r.rows) {
    const text = row.chapter_text ?? "";
    for (const check of CHECKS) {
      if (check.pattern.test(text)) {
        console.log(`  ✖ Ch${row.chapter_number} "${row.title}": CONTAMINATED — "${check.label}"`);
        found++;
      }
    }
  }
  if (found === 0) {
    console.log("  ✅ No contamination found in Ch1–9 (Tee Audio / Văn án / synopsis paragraph)");
  }
  await pool.end();
}

main().catch(console.error);
