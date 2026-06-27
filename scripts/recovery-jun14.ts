/**
 * recovery-jun14.ts
 * phat_phap Jun 14 recovery: OAuth check, schedule 2 quotes, reset ce43aeef, TTS status
 * Run: node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/recovery-jun14.ts [--execute]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import { socialChannels, uploadQueue, contentGenerations } from "@/lib/db/schema";
import { eq, and, gte, lt, sql, inArray } from "drizzle-orm";

const EXECUTE = process.argv.includes("--execute");

// Jun 14 VN = Jun 13 17:00 UTC → Jun 14 17:00 UTC
const JUN14_START = new Date("2026-06-13T17:00:00Z");
const JUN14_END = new Date("2026-06-14T17:00:00Z");

const QUOTE_IDS = ["qgen-mqbnz57r-zs1o3", "qgen-mqbnzd7f-dmdvk"];
const TTS_IDS = [
  "9b900a05-39f6-4877-96e1-ff80bb7b56ce",
  "ccb0a358-f090-4fb0-bce7-d5654149e98c",
  "eb23d624-7d11-43b4-a9e5-73bb2277e011",
  "99cca615-ead9-4133-9474-996548116b1b",
];
const CE43_ID = "ce43aeef-1b18-4003-9449-5d8dfd619f63";
const YT_CH3_ID = 3; // phat_phap ch3 (used for legacy_quote_short)
const FB_CH6_ID = 6; // phat_phap ch6 (Facebook)

async function main() {
  console.log("═".repeat(70));
  console.log("  phat_phap Jun 14 Recovery");
  console.log(`  mode: ${EXECUTE ? "EXECUTE" : "DRY-run"}`);
  console.log("═".repeat(70));

  // ── 1. OAuth status ──────────────────────────────────────────────────────
  console.log("\n## OAuth Status");
  const ch1Rows = await db.execute(
    sql`SELECT id, name, is_active, quota_exceeded_until,
               (access_token IS NOT NULL) as has_token,
               (refresh_token IS NOT NULL) as has_refresh
        FROM social_channels WHERE id = 1`
  );
  const ch1 = ch1Rows.rows[0] as any;
  if (ch1) {
    console.log(`  ch1 name         : ${ch1.name}`);
    console.log(`  is_active        : ${ch1.is_active}`);
    console.log(`  has_token        : ${ch1.has_token}`);
    console.log(`  has_refresh      : ${ch1.has_refresh}`);
    console.log(`  quota_exceeded   : ${ch1.quota_exceeded_until ?? "none"}`);
    const oauthOk = ch1.has_token && ch1.has_refresh && ch1.is_active;
    console.log(`  status           : ${oauthOk ? "✓ OK" : "✗ NEEDS RECONNECT"}`);
  } else {
    console.log("  ch1 not found");
  }

  // ── 2. Check quote MP4s ──────────────────────────────────────────────────
  console.log("\n## Quote MP4 Status");
  const quoteRows = await db.execute(
    sql`SELECT id, topic, video_status, video_path, format_type
        FROM content_generations
        WHERE id = ANY(ARRAY[${sql.raw(QUOTE_IDS.map(id => `'${id}'`).join(","))}])`
  );
  const quoteMap = new Map((quoteRows.rows as any[]).map(r => [r.id, r]));
  for (const id of QUOTE_IDS) {
    const r = quoteMap.get(id) as any;
    if (r) console.log(`  ${id}  status=${r.video_status}  video=${r.video_path ? "✓" : "—"}  "${String(r.topic ?? "").slice(0, 50)}"`);
    else console.log(`  ${id}  NOT FOUND`);
  }

  // ── 3. Jun 14 occupied slots ─────────────────────────────────────────────
  console.log("\n## Jun 14 VN existing slots (phat_phap)");
  const jun14Rows = await db.execute(
    sql`SELECT uq.scheduled_at, uq.platform, uq.video_type, uq.status, uq.content_id
        FROM upload_queue uq
        JOIN content_generations cg ON cg.id = uq.content_id
        WHERE uq.scheduled_at >= ${JUN14_START}
          AND uq.scheduled_at < ${JUN14_END}
          AND cg.channel_key = 'phat_phap'
          AND uq.video_type IN ('short','long')
          AND uq.status != 'cancelled'
        ORDER BY uq.scheduled_at, uq.platform`
  );

  // Track occupied hours by content_id (both YT and FB)
  const occupiedByHour = new Map<number, { contentId: string; hasYT: boolean; hasFBReel: boolean; ytStatus: string }>();
  for (const r of jun14Rows.rows as any[]) {
    const utcH = new Date(r.scheduled_at).getUTCHours();
    const vnH = (utcH + 7) % 24;
    if (!occupiedByHour.has(vnH)) {
      occupiedByHour.set(vnH, { contentId: r.content_id, hasYT: false, hasFBReel: false, ytStatus: "" });
    }
    const slot = occupiedByHour.get(vnH)!;
    if (r.platform === "youtube" && r.video_type === "short") { slot.hasYT = true; slot.ytStatus = r.status; }
    if (r.platform === "facebook" && r.video_type === "short") slot.hasFBReel = true;
  }

  const occupiedHours = new Set(occupiedByHour.keys());
  for (const [h, s] of [...occupiedByHour.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  h${String(h).padStart(2,"0")}  YT:${s.hasYT ? s.ytStatus : "—"}  FBReel:${s.hasFBReel ? "yes" : "MISSING"}  ${s.contentId.slice(0,22)}`);
  }

  // ── 4. Find free slots for 2 quotes ──────────────────────────────────────
  console.log("\n## Slot allocation for 2 quotes");
  const CAMPAIGN_HOURS = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21];
  const freeHours = CAMPAIGN_HOURS.filter(h => !occupiedHours.has(h));
  console.log(`  Occupied: ${[...occupiedHours].sort((a,b)=>a-b).map(h=>"h"+String(h).padStart(2,"0")).join(", ")}`);
  console.log(`  Free    : ${freeHours.map(h=>"h"+String(h).padStart(2,"0")).join(", ")}`);

  if (freeHours.length < 2) {
    console.log("  ✗ Not enough free slots for 2 quotes on Jun 14!");
    // still continue with other tasks
  }

  const assignedSlots = freeHours.slice(0, 2);
  const quoteAssignments: Array<{ id: string; hour: number; scheduledAtUtc: Date }> = [];
  for (let i = 0; i < Math.min(assignedSlots.length, QUOTE_IDS.length); i++) {
    const vnH = assignedSlots[i];
    const utcH = (vnH - 7 + 24) % 24;
    const scheduledAt = new Date(`2026-06-13T${String(utcH).padStart(2,"0")}:00:00Z`);
    // Jun 14 VN h0-h16 UTC is Jun 13, h17+ UTC is Jun 14
    const scheduledAtJun14 = new Date(`2026-06-14T${String(utcH).padStart(2,"0")}:00:00Z`);
    // For VN Jun 14, UTC base is Jun 13 17:00 UTC for h00 VN
    // vnH=06 → UTC=23:00 Jun 13; vnH=07 → UTC=00:00 Jun 14; etc.
    const utcDate = new Date(JUN14_START.getTime() + (vnH - 7 + 24) % 24 * 3600_000);
    // Simpler: JUN14_START is Jun 13 17:00 UTC = VN Jun 14 00:00
    // vnH 6 = VN Jun 14 06:00 = UTC Jun 13 23:00
    const finalAt = new Date(JUN14_START.getTime() + ((vnH + 17) % 24) * 3600_000);
    // Actually: VN Jun 14 vnH:00 = UTC Jun 13 (vnH-7) if vnH>=7, else UTC Jun 14 (vnH+17)
    // VN = UTC+7. VN Jun 14 hH = UTC Jun 14 (hH-7) when hH>=7, else UTC Jun 13 (hH+17)
    let utcTs: Date;
    if (vnH >= 7) {
      utcTs = new Date(`2026-06-14T${String(vnH - 7).padStart(2,"0")}:00:00Z`);
    } else {
      utcTs = new Date(`2026-06-13T${String(vnH + 17).padStart(2,"0")}:00:00Z`);
    }
    quoteAssignments.push({ id: QUOTE_IDS[i], hour: vnH, scheduledAtUtc: utcTs });
    console.log(`  h${String(vnH).padStart(2,"0")} → ${QUOTE_IDS[i]}  UTC:${utcTs.toISOString()}`);
  }

  // ── 5. Get YT ch3 title/desc for quotes ──────────────────────────────────
  // We'll use the topic as title, and short_selected_hook as description
  const quoteCgRows = await db.execute(
    sql`SELECT id, topic, short_selected_hook, short_content, video_path, format_type
        FROM content_generations
        WHERE id = ANY(ARRAY[${sql.raw(QUOTE_IDS.map(id => `'${id}'`).join(","))}])`
  );
  const cgById = new Map((quoteCgRows.rows as any[]).map(r => [r.id, r]));

  // ── 6. Execute or dry-run ─────────────────────────────────────────────────
  console.log(`\n## Jun 14 Schedule ${EXECUTE ? "(EXECUTING)" : "(DRY-RUN)"}`);
  const insertLog: string[] = [];
  for (const { id, hour, scheduledAtUtc } of quoteAssignments) {
    const cg = cgById.get(id) as any;
    if (!cg) { console.log(`  ✗ ${id} not in DB, skipping`); continue; }
    const title = (cg.topic ?? "").slice(0, 100);
    const desc = (cg.short_selected_hook ?? cg.short_content ?? "").slice(0, 500);

    console.log(`\n  h${String(hour).padStart(2,"0")} → ${id}`);
    console.log(`    topic    : "${title}"`);
    console.log(`    video    : ${cg.video_path ?? "—"}`);
    console.log(`    YT ch3   : ${EXECUTE ? "inserting" : "would insert"}`);
    console.log(`    FB ch6   : ${EXECUTE ? "inserting" : "would insert"}`);

    if (EXECUTE) {
      const base = { contentId: id, status: "queued" as const, scheduledAt: scheduledAtUtc, title, description: desc, tags: [] as string[], privacyStatus: "public" as const };
      await db.insert(uploadQueue).values({ ...base, platform: "youtube", videoType: "short", channelId: YT_CH3_ID });
      await db.insert(uploadQueue).values({ ...base, platform: "facebook", videoType: "short", channelId: FB_CH6_ID });
      insertLog.push(`h${String(hour).padStart(2,"0")} ${id} ✓`);
      console.log(`    ✓ inserted`);
    }
  }

  // ── 7. TTS status ─────────────────────────────────────────────────────────
  console.log("\n## Pending TTS Status");
  const ttsRows = await db.execute(
    sql`SELECT cg.id, cg.topic, cg.video_status, cg.images_status, cg.audio_path, cg.video_path,
               COUNT(uq.id) as uq_count,
               MAX(uq.status) as uq_status
        FROM content_generations cg
        LEFT JOIN upload_queue uq ON uq.content_id = cg.id AND uq.status != 'cancelled'
        WHERE cg.id::text = ANY(ARRAY[${sql.raw(TTS_IDS.map(id => `'${id}'`).join(","))}])
        GROUP BY cg.id, cg.topic, cg.video_status, cg.images_status, cg.audio_path, cg.video_path`
  );
  for (const r of ttsRows.rows as any[]) {
    const rendered = r.video_path ? "✓ rendered" : (r.audio_path ? "audio_only" : "pending");
    console.log(`  ${r.id}  video_status=${r.video_status}  ${rendered}  uq_rows=${r.uq_count}(${r.uq_status ?? "—"})`);
    console.log(`    topic: "${String(r.topic ?? "").slice(0, 60)}"`);
  }

  // ── 8. Reset ce43aeef ─────────────────────────────────────────────────────
  console.log("\n## ce43aeef Reset");
  const ce43Before = await db.execute(
    sql`SELECT id, images_status, images_error_message, video_status FROM content_generations WHERE id::text = ${CE43_ID}`
  );
  const ce43 = ce43Before.rows[0] as any;
  if (ce43) {
    console.log(`  Before: images_status=${ce43.images_status}  video_status=${ce43.video_status}`);
    console.log(`  Error : ${String(ce43.images_error_message ?? "none").slice(0, 120)}`);
    if (EXECUTE) {
      await db.execute(
        sql`UPDATE content_generations SET images_status = 'pending', images_error_message = NULL WHERE id::text = ${CE43_ID}`
      );
      console.log("  ✓ Reset to images_status='pending'");
    } else {
      console.log("  [DRY-RUN] Would set images_status='pending', images_error_message=NULL");
    }
  } else {
    console.log(`  ✗ ${CE43_ID} not found`);
  }

  // ── 9. Safety summary ────────────────────────────────────────────────────
  console.log("\n## Safety");
  const qTotal = await db.execute(sql`SELECT COUNT(*)::int as cnt FROM upload_queue`);
  const qQueued = await db.execute(sql`SELECT COUNT(*)::int as cnt FROM upload_queue WHERE status='queued'`);
  console.log(`  upload_queue total : ${(qTotal.rows[0] as any)?.cnt ?? "?"}`);
  console.log(`  upload_queue queued: ${(qQueued.rows[0] as any)?.cnt ?? "?"}`);
  console.log(`  published_videos   : NOT TOUCHED`);
  console.log(`  tang_sau           : NOT TOUCHED`);
  console.log(`  content_generations deletions: NONE`);

  console.log("\n" + "═".repeat(70));
  if (!EXECUTE) console.log("  Re-run with --execute to apply changes.");
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
