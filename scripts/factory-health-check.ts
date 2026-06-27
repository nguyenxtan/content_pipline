import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // Replicate production-capacity.ts gate checks directly from DB + env

  const maxQueue    = parseInt(process.env.MAX_PENDING_UPLOAD_QUEUE       ?? "60");
  const maxRendered = parseInt(process.env.MAX_UNPUBLISHED_RENDERED_VIDEOS ?? "150");
  const maxDaily    = parseInt(process.env.MAX_DAILY_NEW_CONTENT           ?? "20");

  // Gate 1: upload_queue_too_large → queued + uploading
  const queueR = await db.execute(sql`
    SELECT status, COUNT(*)::int as cnt
    FROM upload_queue
    WHERE status IN ('queued','uploading','error')
    GROUP BY status
  `);
  const byStatus: Record<string, number> = {};
  for (const r of queueR.rows as any[]) byStatus[r.status] = r.cnt;
  const pendingUpload = (byStatus["queued"] ?? 0) + (byStatus["uploading"] ?? 0);
  const failedUpload  = byStatus["error"] ?? 0;

  // Gate 2: unpublished_rendered_videos_too_many → done + media_cleaned_at IS NULL
  const renderedR = await db.execute(sql`
    SELECT COUNT(*)::int as cnt
    FROM content_generations
    WHERE video_status = 'done' AND media_cleaned_at IS NULL
  `);
  const renderedCount = (renderedR.rows[0] as any).cnt;

  // Gate 3: daily_generation_limit_reached → created today (UTC)
  const todayStart = new Date(); todayStart.setUTCHours(0,0,0,0);
  const dailyR = await db.execute(sql`
    SELECT COUNT(*)::int as cnt
    FROM content_generations
    WHERE created_at >= ${todayStart}
  `);
  const dailyCount = (dailyR.rows[0] as any).cnt;

  // Gate 4: quota_exceeded – any YouTube channel with quota_exceeded_until in future
  const quotaR = await db.execute(sql`
    SELECT id, name, quota_exceeded_until
    FROM social_channels
    WHERE platform = 'youtube'
      AND quota_exceeded_until IS NOT NULL
      AND quota_exceeded_until > NOW()
  `);
  const quotaExceeded = quotaR.rows as any[];

  // Gate 5: needs_reconnect – any active YouTube channel needing reconnect
  const reconnectR = await db.execute(sql`
    SELECT id, name, needs_reconnect
    FROM social_channels
    WHERE platform = 'youtube' AND is_active = true AND needs_reconnect = true
  `);
  const needsReconnect = reconnectR.rows as any[];

  // Evaluate gates
  const gates = [
    {
      name: "upload_queue_too_large",
      current: pendingUpload,
      threshold: maxQueue,
      pass: pendingUpload <= maxQueue,
    },
    {
      name: "unpublished_rendered_too_many",
      current: renderedCount,
      threshold: maxRendered,
      pass: renderedCount <= maxRendered,
    },
    {
      name: "daily_generation_limit",
      current: dailyCount,
      threshold: maxDaily,
      pass: dailyCount <= maxDaily,
    },
    {
      name: "youtube_quota_exceeded",
      current: quotaExceeded.length,
      threshold: 0,
      pass: quotaExceeded.length === 0,
      detail: quotaExceeded.map((c: any) => `ch${c.id}(${c.name}) until ${c.quota_exceeded_until}`).join(", ") || "none",
    },
    {
      name: "youtube_needs_reconnect",
      current: needsReconnect.length,
      threshold: 0,
      pass: needsReconnect.length === 0,
      detail: needsReconnect.map((c: any) => `ch${c.id}(${c.name})`).join(", ") || "none",
    },
  ];

  const blockers = gates.filter(g => !g.pass);
  const status = blockers.length === 0 ? "✓ RUNNING" : "⚠ PAUSED / DEGRADED";

  console.log(`\n## Factory Health`);
  console.log(`Status: ${status}`);
  console.log(`\n| gate | current | threshold | status |`);
  console.log(`|---|---:|---:|---|`);
  for (const g of gates) {
    const s = g.pass ? "✓ OK" : "✗ BLOCKED";
    const detail = (g as any).detail ? ` — ${(g as any).detail}` : "";
    console.log(`| ${g.name} | ${g.current} | ${g.threshold} | ${s}${detail} |`);
  }

  console.log(`\n## Blockers (${blockers.length})`);
  if (blockers.length === 0) {
    console.log("  None — factory is healthy.");
  } else {
    for (const g of blockers) {
      console.log(`  ✗ ${g.name}: ${g.current} > ${g.threshold}`);
    }
  }

  console.log(`\n## Additional Metrics`);
  console.log(`  upload_queue failed (error): ${failedUpload}`);
  console.log(`  MAX_PENDING_UPLOAD_QUEUE   : ${maxQueue}`);
  console.log(`  MAX_UNPUBLISHED_RENDERED   : ${maxRendered}`);
  console.log(`  MAX_DAILY_NEW_CONTENT      : ${maxDaily}`);

  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
