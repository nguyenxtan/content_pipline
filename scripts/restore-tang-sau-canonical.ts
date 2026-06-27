/**
 * restore-tang-sau-canonical.ts
 * Restores 9 tang_sau rows on ch10 that were incorrectly cancelled by queue-health-audit.
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/restore-tang-sau-canonical.ts [--execute]
 */
import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const EXECUTE = process.argv.includes("--execute");

const RESTORE_IDS = [
  "986b14f9-21ce-49bd-9df7-218ffe70a9bc",  // qgen-mq11xznu-qu186  VN 2026-06-13 h15
  "95121064-bbbc-4b93-b739-73d14a7483af",  // qgen-mq11y6kd-d1tdc  VN 2026-06-13 h21
  "29fc5fec-3c7b-460a-951e-e5277991f81d",  // qgen-mq11ydg8-zczkt  VN 2026-06-14 h21
  "3c3e3885-e43b-4f27-be81-ea698db90ee3",  // qgen-mq11yk41-5qer6  VN 2026-06-15 h17
  "1359a90f-067a-4cc4-b4aa-f8db6b3e9f29",  // qgen-mq11yruf-xn2ls  VN 2026-06-16 h07
  "420a7b70-61d5-46aa-9eea-b4ecfda7e30f",  // qgen-mq11yxwf-py32g  VN 2026-06-16 h13
  "392a2f13-283d-4167-b759-a727d77878e9",  // qgen-mq11z4rn-sfwz1  VN 2026-06-16 h19
  "3167a9a8-b125-4ab6-aa3d-83458f78b3ed",  // qgen-mq1rnjwt-bk5a8  VN 2026-06-16 h21
  "3ad2d795-401a-48c5-9008-635a4b2189b1",  // qgen-mq1ro1qk-66zl7  VN 2026-06-17 h07
];

async function main() {
  console.log(`mode: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);

  // Pre-check: confirm all rows are cancelled with correct error_message and channel_id=10
  const check = await db.execute(sql`
    SELECT uq.id, uq.status, uq.error_message, uq.channel_id, uq.scheduled_at,
           cg.channel_key, cg.topic
    FROM upload_queue uq
    JOIN content_generations cg ON cg.id = uq.content_id
    WHERE uq.id = ANY(ARRAY[${sql.raw(RESTORE_IDS.map(id => `'${id}'`).join(","))}])
    ORDER BY uq.scheduled_at
  `);

  console.log(`\nPre-check (${check.rows.length} rows found of ${RESTORE_IDS.length} expected):`);
  let allOk = true;
  for (const r of check.rows as any[]) {
    const vnDate = r.scheduled_at
      ? new Date(new Date(r.scheduled_at).getTime() + 7 * 3600_000).toISOString().slice(0, 16)
      : "null";
    const ok = r.status === "cancelled" && r.error_message === "queue_health_cap_reduction" && r.channel_id === 10;
    if (!ok) allOk = false;
    console.log(`  ${ok ? "✓" : "✗"} ${r.id.slice(0, 12)}  ch=${r.channel_id}  status=${r.status}  sched=${vnDate}VN  topic="${String(r.topic).slice(0, 40)}"`);
  }

  if (check.rows.length !== RESTORE_IDS.length) {
    console.error(`  ✗ Expected ${RESTORE_IDS.length} rows, found ${check.rows.length}. Aborting.`);
    process.exit(1);
  }
  if (!allOk) {
    console.error("  ✗ Some rows are in unexpected state. Review before restoring.");
    process.exit(1);
  }

  if (!EXECUTE) {
    console.log(`\n[DRY-RUN] Would restore ${RESTORE_IDS.length} rows to status='queued'. Re-run with --execute.`);
    process.exit(0);
  }

  // Restore
  await db.execute(sql`
    UPDATE upload_queue
    SET status = 'queued', error_message = NULL, updated_at = NOW()
    WHERE id = ANY(ARRAY[${sql.raw(RESTORE_IDS.map(id => `'${id}'`).join(","))}])
      AND status = 'cancelled'
      AND error_message = 'queue_health_cap_reduction'
  `);

  // Verify
  const verify = await db.execute(sql`
    SELECT COUNT(*)::int as cnt FROM upload_queue
    WHERE id = ANY(ARRAY[${sql.raw(RESTORE_IDS.map(id => `'${id}'`).join(","))}])
      AND status = 'queued'
  `);
  const restored = (verify.rows[0] as any).cnt;
  console.log(`\nRestored: ${restored} / ${RESTORE_IDS.length} rows`);
  if (restored !== RESTORE_IDS.length) {
    console.error("  ✗ Mismatch — check manually.");
    process.exit(1);
  }

  // Queue count
  const qCount = await db.execute(sql`SELECT COUNT(*)::int as cnt FROM upload_queue WHERE status IN ('queued','uploading')`);
  console.log(`Gate-relevant count after restore: ${(qCount.rows[0] as any).cnt} (cap 60, temporarily over — acceptable)`);

  // Confirm no cancelled canonical tang_sau rows remain
  const stillCancelled = await db.execute(sql`
    SELECT COUNT(*)::int as cnt FROM upload_queue
    WHERE error_message = 'queue_health_cap_reduction'
      AND channel_id = 10
  `);
  console.log(`tang_sau ch10 rows still cancelled by health_cap_reduction: ${(stillCancelled.rows[0] as any).cnt} (should be 0)`);
  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
