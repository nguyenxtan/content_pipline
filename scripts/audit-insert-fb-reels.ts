/**
 * audit-insert-fb-reels.ts
 *
 * Audits phat_phap video campaigns for 2026-06-13 VN and inserts
 * missing Facebook Reel rows (platform='facebook', video_type='short').
 *
 * Run with --execute to actually insert. Default is dry-run.
 *
 * node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/audit-insert-fb-reels.ts [--execute]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import { uploadQueue, contentGenerations, socialChannels } from "@/lib/db/schema";
import { eq, and, gte, lt, sql, inArray } from "drizzle-orm";

const EXECUTE = process.argv.includes("--execute");

// 2026-06-13 VN = 2026-06-12 17:00 UTC → 2026-06-13 17:00 UTC
const DAY_START = new Date("2026-06-12T17:00:00Z");
const DAY_END = new Date("2026-06-13T17:00:00Z");

// channel_id=6 is phat_phap Facebook
const FB_CHANNEL_ID = 6;
const PHAT_PHAP_KEY = "phat_phap";

function pad(s: string, n: number) { return String(s).slice(0, n).padEnd(n); }
function vnHour(d: Date) { return (d.getUTCHours() + 7) % 24; }

async function main() {
  console.log("═".repeat(80));
  console.log("  phat_phap FB Reel audit — 2026-06-13 VN");
  console.log(`  mode: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);
  console.log("═".repeat(80));

  // 1. Get all upload_queue rows for today's phat_phap video campaigns
  const uqRows = await db
    .select()
    .from(uploadQueue)
    .where(
      and(
        gte(uploadQueue.scheduledAt, DAY_START),
        lt(uploadQueue.scheduledAt, DAY_END),
        inArray(uploadQueue.videoType, ["short", "long"]),
      )
    );

  // Filter to phat_phap only
  const contentIds = [...new Set(uqRows.map(r => r.contentId))];
  if (contentIds.length === 0) {
    console.log("No upload_queue rows found for today.");
    return;
  }

  const cgRows = await db
    .select({ id: contentGenerations.id, formatType: contentGenerations.formatType, topic: contentGenerations.topic, videoPath: contentGenerations.videoPath })
    .from(contentGenerations)
    .where(
      and(
        inArray(contentGenerations.id, contentIds),
        eq(contentGenerations.channelKey, PHAT_PHAP_KEY),
      )
    );

  const cgMap = new Map(cgRows.map(r => [r.id, r]));
  const phatPhapContentIds = new Set(cgMap.keys());

  // 2. Group upload_queue by content_id, only phat_phap
  const byContent = new Map<string, typeof uqRows>();
  for (const row of uqRows) {
    if (!phatPhapContentIds.has(row.contentId)) continue;
    if (!byContent.has(row.contentId)) byContent.set(row.contentId, []);
    byContent.get(row.contentId)!.push(row);
  }

  // 3. Print audit table
  console.log("\n" + [
    pad("h(VN)", 6),
    pad("contentId", 38),
    pad("formatType", 22),
    pad("YT-short", 12),
    pad("FB-Reel", 12),
    pad("action", 10),
  ].join(" "));
  console.log("─".repeat(105));

  const toInsert: Array<{
    contentId: string;
    ytRow: typeof uqRows[0];
    cg: typeof cgRows[0];
  }> = [];

  // Sort by scheduled_at
  const sorted = [...byContent.entries()].sort((a, b) => {
    const aT = a[1][0].scheduledAt?.getTime() ?? 0;
    const bT = b[1][0].scheduledAt?.getTime() ?? 0;
    return aT - bT;
  });

  for (const [contentId, rows] of sorted) {
    const ytRow = rows.find(r => r.platform === "youtube" && r.videoType === "short");
    const fbReelRow = rows.find(r => r.platform === "facebook" && r.videoType === "short");
    const cg = cgMap.get(contentId)!;

    const hour = ytRow ? `h${String(vnHour(ytRow.scheduledAt!)).padStart(2, "0")}` : "h??";
    const ytStatus = ytRow ? ytRow.status : "—";
    const fbStatus = fbReelRow ? fbReelRow.status : "MISSING";

    let action = "ok";
    if (!fbReelRow) {
      if (ytStatus === "done") {
        action = "skip(done)";
      } else if (ytStatus === "cancelled" || !ytRow) {
        action = "skip(cancelled)";
      } else {
        action = "INSERT";
        if (ytRow && cg) toInsert.push({ contentId, ytRow, cg });
      }
    }

    console.log([
      pad(hour, 6),
      pad(contentId, 38),
      pad(cg?.formatType ?? "?", 22),
      pad(ytStatus, 12),
      pad(fbStatus, 12),
      pad(action, 10),
    ].join(" "));
  }

  console.log(`\n  Total: ${sorted.length} campaigns`);
  console.log(`  Need FB Reel insert: ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log("  Nothing to insert.");
    return;
  }

  // 4. Check queue size
  const [{ cnt: qCount }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(uploadQueue);
  const MAX_QUEUE = parseInt(process.env.MAX_PENDING_UPLOAD_QUEUE ?? "60");
  console.log(`\n  upload_queue current: ${qCount} / threshold ~${MAX_QUEUE}`);
  console.log(`  After insert would be: ${Number(qCount) + toInsert.length}`);

  if (!EXECUTE) {
    console.log("\n  [DRY-RUN] Would insert these FB Reel rows:");
    for (const { contentId, ytRow, cg } of toInsert) {
      const h = `h${String(vnHour(ytRow.scheduledAt!)).padStart(2, "0")}`;
      console.log(`    ${h}  ${contentId}  "${(cg.topic ?? "").slice(0, 50)}"  scheduledAt=${ytRow.scheduledAt?.toISOString()}`);
    }
    console.log("\n  Re-run with --execute to apply.");
    return;
  }

  // 5. Insert
  console.log("\n  Inserting FB Reel rows…");
  let inserted = 0;
  for (const { contentId, ytRow, cg } of toInsert) {
    const id = `fbreel-${contentId.slice(0, 8)}-${Date.now().toString(36)}`;
    await db.insert(uploadQueue).values({
      contentId,
      platform: "facebook",
      videoType: "short",
      channelId: FB_CHANNEL_ID,
      status: "queued",
      scheduledAt: ytRow.scheduledAt,
      title: ytRow.title,
      description: ytRow.description,
      tags: ytRow.tags ?? [],
      privacyStatus: "public",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    inserted++;
    console.log(`    ✓ inserted FB Reel for ${contentId} @ ${ytRow.scheduledAt?.toISOString()}`);
  }

  const [{ cnt: qAfter }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(uploadQueue);
  console.log(`\n  Inserted: ${inserted} rows`);
  console.log(`  upload_queue after: ${qAfter}`);
  console.log("\n" + "═".repeat(80));
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
