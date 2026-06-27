/**
 * One-time correction: sets experiment_id + experiment_variant for the 5 shorts
 * rendered during the limited rollout before the guard fix was applied.
 *
 * These items were rendered with SHORT_COVER_INTRO_ENABLED=true and have:
 * - thumbnailText: already written correctly (✓)
 * - experimentId:  "HOOK" → needs to be "short-cover-intro-v1"
 * - experimentVariant: "HOOK_V2" → needs to be "intro_on_1p5s"
 *
 * Safe to re-run (idempotent — only updates rows that still have the wrong values).
 */
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const ROLLOUT_IDS = [
  "9867c708-8112-46ba-888f-a40aa62f0f0d", // Mất mát tình yêu
  "d1286eeb-816a-47f1-b61b-ff90baff3f15", // Sự phản bội chính mình
  "c8e1db4d-4159-4b85-a785-8a20e0d70586", // Mất mát yêu thương
  "0236652f-6a71-4c88-ac91-5062b78924b7", // Sự hối hận
  "3e64be92-d3eb-4a86-8c4e-e998e6658e08", // Chưa được chấp nhận
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Show current state
  const before = await pool.query(
    "SELECT id, topic, thumbnail_text, experiment_id, experiment_variant FROM content_generations WHERE id = ANY($1)",
    [ROLLOUT_IDS]
  );
  console.log("\nBefore:");
  for (const r of before.rows) {
    console.log(`  ${r.id.slice(0, 8)} "${r.topic}"  expId="${r.experiment_id}"  expVar="${r.experiment_variant}"  thumb="${r.thumbnail_text}"`);
  }

  // Apply correction only where needed
  const result = await pool.query(
    `UPDATE content_generations
     SET experiment_id = 'short-cover-intro-v1',
         experiment_variant = 'intro_on_1p5s'
     WHERE id = ANY($1)
       AND (experiment_id != 'short-cover-intro-v1' OR experiment_variant != 'intro_on_1p5s')`,
    [ROLLOUT_IDS]
  );
  console.log(`\nUpdated ${result.rowCount} row(s).`);

  // Verify
  const after = await pool.query(
    "SELECT id, topic, thumbnail_text, experiment_id, experiment_variant FROM content_generations WHERE id = ANY($1)",
    [ROLLOUT_IDS]
  );
  console.log("\nAfter:");
  let allPass = true;
  for (const r of after.rows) {
    const ok = r.experiment_id === "short-cover-intro-v1" && r.experiment_variant === "intro_on_1p5s" && r.thumbnail_text;
    if (!ok) allPass = false;
    console.log(`  ${ok ? "✓" : "✗"} ${r.id.slice(0, 8)} "${r.topic}"  expId="${r.experiment_id}"  expVar="${r.experiment_variant}"  thumb="${r.thumbnail_text}"`);
  }

  await pool.end();

  if (allPass) {
    console.log("\n✓ All 5 rollout items correctly tagged.\n");
  } else {
    console.error("\n✗ Some items still incorrect.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
