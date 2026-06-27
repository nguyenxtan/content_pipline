/**
 * Dry-run verification: shows what experiment tracking fields WOULD be written
 * for newly generated shorts when SHORT_COVER_INTRO_ENABLED=true.
 *
 * No DB writes. No render. No publish. Plan-only.
 *
 * Run: pnpm verify:short-cover-intro-experiment-tracking
 */
import "dotenv/config";
import pg from "pg";
import { generateShortCover } from "@/lib/short-cover-engine";

const { Pool } = pg;

const EXPERIMENT_ID      = "short-cover-intro-v1";
const EXPERIMENT_VARIANT = "intro_on_1p5s";
const PLAN_LIMIT         = 10;

type SampleRow = {
  id: string;
  topic: string | null;
  short_content: string | null;
  script: string | null;
  short_selected_hook: string | null;
  thumbnail_text: string | null;
  experiment_id: string | null;
  experiment_variant: string | null;
  video_status: string | null;
};

type FieldPlan = {
  write: boolean;
  value: string | null;
  skipReason: string | null;
};

type WritePlan = {
  thumbnailText: FieldPlan;
  experimentId: FieldPlan;
  experimentVariant: FieldPlan;
  anyWrite: boolean;
};

function planWrite(row: SampleRow, coverText: string): WritePlan {
  const thumbAlreadySet = Boolean(row.thumbnail_text?.trim());
  const thumbnailText: FieldPlan = thumbAlreadySet
    ? { write: false, value: null, skipReason: `already_set: "${row.thumbnail_text}"` }
    : { write: true,  value: coverText, skipReason: null };

  const experimentId: FieldPlan = row.experiment_id != null
    ? { write: false, value: null, skipReason: `already_set: "${row.experiment_id}"` }
    : { write: true,  value: EXPERIMENT_ID, skipReason: null };

  const experimentVariant: FieldPlan = row.experiment_variant != null
    ? { write: false, value: null, skipReason: `already_set: "${row.experiment_variant}"` }
    : { write: true,  value: EXPERIMENT_VARIANT, skipReason: null };

  return {
    thumbnailText,
    experimentId,
    experimentVariant,
    anyWrite: thumbnailText.write || experimentId.write || experimentVariant.write,
  };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query<SampleRow>(`
    SELECT id, topic, short_content, script, short_selected_hook,
           thumbnail_text, experiment_id, experiment_variant, video_status
    FROM   content_generations
    WHERE  content_mode IN ('short', 'both')
    ORDER  BY created_at DESC
    LIMIT  ${PLAN_LIMIT}
  `);

  await pool.end();

  console.log("\n=== SHORT COVER INTRO — EXPERIMENT TRACKING DRY-RUN ===\n");
  console.log(`Scenario: SHORT_COVER_INTRO_ENABLED=true applied to ${rows.length} most recent short items`);
  console.log(`Constants: experimentId="${EXPERIMENT_ID}", experimentVariant="${EXPERIMENT_VARIANT}"\n`);

  let wouldWrite = 0;
  let alreadyClean = 0;

  for (const row of rows) {
    const cover = generateShortCover({
      topic: row.topic ?? "",
      selectedHook: row.short_selected_hook,
      script: row.short_content || row.script,
    });

    const plan = planWrite(row, cover.coverText);

    console.log(`─── ${row.id.slice(0, 8)} | ${(row.topic ?? "").slice(0, 48)}`);
    console.log(`    video_status: ${row.video_status ?? "null"}`);
    console.log(`    coverText (computed): "${cover.coverText}"`);

    if (plan.anyWrite) {
      wouldWrite++;
      if (plan.thumbnailText.write)   console.log(`    ✏  thumbnailText    → "${plan.thumbnailText.value}"`);
      else                             console.log(`    ⊘  thumbnailText    skipped: ${plan.thumbnailText.skipReason}`);
      if (plan.experimentId.write)    console.log(`    ✏  experimentId     → "${plan.experimentId.value}"`);
      else                             console.log(`    ⊘  experimentId     skipped: ${plan.experimentId.skipReason}`);
      if (plan.experimentVariant.write) console.log(`    ✏  experimentVariant → "${plan.experimentVariant.value}"`);
      else                              console.log(`    ⊘  experimentVariant skipped: ${plan.experimentVariant.skipReason}`);
    } else {
      alreadyClean++;
      console.log(`    ✓  all fields already set — no write needed`);
      console.log(`       thumbnailText="${row.thumbnail_text}", experimentId="${row.experiment_id}", experimentVariant="${row.experiment_variant}"`);
    }
    console.log();
  }

  console.log("=== SUMMARY ===");
  console.log(`Items scanned: ${rows.length}`);
  console.log(`Would write ≥1 field: ${wouldWrite}`);
  console.log(`Already fully tagged:  ${alreadyClean}`);
  console.log("\nNote: This is DRY-RUN only. No DB changes made.");
  console.log("Guards: thumbnailText written only if null/empty. experimentId/experimentVariant written only if null.");
  console.log("These writes happen inside runShortVideo() after successful render, not in this script.\n");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
