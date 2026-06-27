/**
 * Backfill hook_type for content_generations rows that have short_selected_hook
 * but no hook_type yet.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-hook-types.ts
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-hook-types.ts --execute
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-hook-types.ts --execute --limit 50
 *
 * Flags:
 *   --execute   Write hook_type to DB. Default is dry-run (read-only).
 *   --limit N   Process at most N rows (default: all).
 */

import { Pool } from "pg";
import { inferHookType, HOOK_TYPE_DISPLAY } from "@/lib/hook-engine";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const limitArg = (() => {
  const idx = args.indexOf("--limit");
  return idx !== -1 ? Number(args[idx + 1]) : null;
})();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Row = { id: string; short_selected_hook: string; hook_type: string | null; topic: string };

async function main() {
  console.log(`\n=== backfill-hook-types ===`);
  console.log(`mode     : ${execute ? "EXECUTE (will write to DB)" : "DRY-RUN (read-only)"}`);
  if (limitArg != null) console.log(`limit    : ${limitArg}`);
  console.log();

  const { rows } = await pool.query<Row>(`
    SELECT id, short_selected_hook, hook_type, topic
    FROM content_generations
    WHERE short_selected_hook IS NOT NULL
      AND short_selected_hook != ''
      AND hook_type IS NULL
    ORDER BY created_at DESC
    ${limitArg != null ? `LIMIT ${limitArg}` : ""}
  `);

  if (rows.length === 0) {
    console.log("No rows need backfill (hook_type already set or no short_selected_hook).");
    await pool.end();
    return;
  }

  console.log(`Found ${rows.length} rows to backfill.\n`);

  const counts: Record<string, number> = {};
  const updates: { id: string; hookType: string }[] = [];

  for (const row of rows) {
    const hookType = inferHookType(row.short_selected_hook);
    counts[hookType] = (counts[hookType] ?? 0) + 1;
    updates.push({ id: row.id, hookType });
    console.log(
      `  [${hookType.padEnd(16)}]  "${row.short_selected_hook.slice(0, 70)}${row.short_selected_hook.length > 70 ? "…" : ""}"`,
    );
  }

  console.log("\n── Type distribution ──────────────────────────────────────");
  for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const display = HOOK_TYPE_DISPLAY[type as keyof typeof HOOK_TYPE_DISPLAY] ?? type;
    console.log(`  ${type.padEnd(18)} ${String(count).padStart(4)}  (${display})`);
  }

  if (!execute) {
    console.log(`\n  Dry-run complete — ${rows.length} rows would be updated.`);
    console.log("  Add --execute to write changes.\n");
    await pool.end();
    return;
  }

  // Write in batches of 50
  const BATCH = 50;
  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const ids = batch.map((u) => u.id);
    // Build CASE expression for each id
    const caseExpr = batch
      .map((u) => `WHEN id = '${u.id}' THEN '${u.hookType}'`)
      .join(" ");
    await pool.query(`
      UPDATE content_generations
      SET hook_type = CASE ${caseExpr} END
      WHERE id = ANY($1::text[])
    `, [ids]);
    written += batch.length;
  }

  console.log(`\n  Written: ${written} rows updated.\n`);
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
