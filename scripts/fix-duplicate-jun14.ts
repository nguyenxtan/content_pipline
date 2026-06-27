import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const EXECUTE = process.argv.includes("--execute");

async function main() {
  const r = await db.execute(sql`
    SELECT id, content_id, platform, video_type, channel_id, status, scheduled_at
    FROM upload_queue
    WHERE content_id IN ('qgen-mqbnz57r-zs1o3', 'qgen-mqbnzd7f-dmdvk')
      AND status != 'cancelled'
    ORDER BY content_id, scheduled_at, platform
  `);
  for (const row of r.rows as any[]) {
    const vnH = (new Date(row.scheduled_at).getUTCHours() + 7) % 24;
    console.log(`h${String(vnH).padStart(2,"0")} ${row.id} ${row.content_id} ${row.platform} ${row.status} ${new Date(row.scheduled_at).toISOString()}`);
  }

  // Find duplicates: keep earliest slot, cancel later ones
  const byContentPlatform = new Map<string, Array<any>>();
  for (const row of r.rows as any[]) {
    const key = `${row.content_id}|${row.platform}`;
    if (!byContentPlatform.has(key)) byContentPlatform.set(key, []);
    byContentPlatform.get(key)!.push(row);
  }

  const toCancel: string[] = [];
  for (const [key, rows] of byContentPlatform.entries()) {
    if (rows.length > 1) {
      rows.sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
      const dupes = rows.slice(1); // cancel all but earliest
      console.log(`\nDUPLICATE [${key}]: keep h${(new Date(rows[0].scheduled_at).getUTCHours() + 7) % 24}, cancel ${dupes.length} later row(s)`);
      for (const d of dupes) {
        const vnH = (new Date(d.scheduled_at).getUTCHours() + 7) % 24;
        console.log(`  cancel h${String(vnH).padStart(2,"0")} ${d.id}`);
        toCancel.push(d.id);
      }
    }
  }

  if (toCancel.length === 0) { console.log("\nNo duplicates."); return; }

  if (!EXECUTE) {
    console.log(`\n[DRY-RUN] Would cancel ${toCancel.length} rows. Re-run with --execute.`);
    return;
  }

  for (const id of toCancel) {
    await db.execute(sql`UPDATE upload_queue SET status = 'cancelled', updated_at = NOW() WHERE id = ${id}`);
    console.log(`  ✓ cancelled ${id}`);
  }
  console.log(`\nDone: cancelled ${toCancel.length} duplicate rows.`);
  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e); process.exit(1); });
