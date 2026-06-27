import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const RESTORE_IDS = [
  "986b14f9-21ce-49bd-9df7-218ffe70a9bc","95121064-bbbc-4b93-b739-73d14a7483af",
  "29fc5fec-3c7b-460a-951e-e5277991f81d","3c3e3885-e43b-4f27-be81-ea698db90ee3",
  "1359a90f-067a-4cc4-b4aa-f8db6b3e9f29","420a7b70-61d5-46aa-9eea-b4ecfda7e30f",
  "392a2f13-283d-4167-b759-a727d77878e9","3167a9a8-b125-4ab6-aa3d-83458f78b3ed",
  "3ad2d795-401a-48c5-9008-635a4b2189b1",
];

async function main() {
  const r1 = await db.execute(sql`SELECT COUNT(*)::int as cnt FROM upload_queue WHERE id::text = ANY(ARRAY[${sql.raw(RESTORE_IDS.map(id => `'${id}'`).join(","))}]) AND status = 'queued'`);
  console.log(`1. Restored ch10 rows active (queued): ${(r1.rows[0] as any).cnt} / ${RESTORE_IDS.length}  ${(r1.rows[0] as any).cnt === RESTORE_IDS.length ? "✓" : "✗"}`);

  const r2 = await db.execute(sql`SELECT COUNT(*)::int as cnt FROM upload_queue WHERE error_message = 'queue_health_cap_reduction' AND channel_id = 10`);
  const n2 = (r2.rows[0] as any).cnt;
  console.log(`2. tang_sau ch10 cancelled by health_cap_reduction: ${n2}  ${n2 === 0 ? "✓" : "✗ DANGER"}`);

  const r3 = await db.execute(sql`SELECT COUNT(*)::int as cnt FROM upload_queue WHERE status IN ('queued','uploading')`);
  const n3 = (r3.rows[0] as any).cnt;
  console.log(`3. Gate count: ${n3} / cap 60  ${n3 <= 60 ? "✓ under cap" : "⚠ over cap (acceptable temporarily)"}`);

  const r4 = await db.execute(sql`
    SELECT COUNT(*)::int as cnt FROM upload_queue uq
    JOIN content_generations cg ON cg.id = uq.content_id
    WHERE uq.error_message = 'queue_health_cap_reduction'
      AND cg.channel_key = 'phat_phap'
      AND uq.video_type = 'short'
  `);
  const n4 = (r4.rows[0] as any).cnt;
  console.log(`4. phat_phap short rows cancelled by health_cap_reduction: ${n4}  ${n4 === 0 ? "✓" : "✗ DANGER"}`);

  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
