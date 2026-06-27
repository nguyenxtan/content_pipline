/**
 * queue-health-audit.ts
 * Audits active upload_queue, classifies rows, and produces a safe reduction plan.
 *
 * Canonical channel resolution: replicates resolveCanonicalChannelId() from
 * src/lib/auto-refill-watcher.ts — priority:
 *   1. channel_key matches (avoids cross-brand credential)
 *   2. is_active=true AND needs_reconnect=false
 *   3. highest historical upload_queue usage (most uploads = most-used OAuth token)
 * This is the same policy that resolves tang_sau → ch10 in production.
 *
 * Run:  node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/queue-health-audit.ts [--execute]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const EXECUTE = process.argv.includes("--execute");
const HEALTH_CAP = 60;

// VN date bucket (UTC+7)
const now = new Date();
const vnNow = new Date(now.getTime() + 7 * 3600_000);
const vnToday = vnNow.toISOString().slice(0, 10);
const tomorrow = new Date(vnNow.getTime() + 86400_000).toISOString().slice(0, 10);

function vnDateOf(d: Date | null): string {
  if (!d) return "null";
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

function bucket(d: Date | null): "today" | "tomorrow" | "later" | "unset" {
  const s = vnDateOf(d);
  if (s === vnToday) return "today";
  if (s === tomorrow) return "tomorrow";
  if (s === "null") return "unset";
  return "later";
}

function pad(s: string | number, n: number) { return String(s).slice(0, n).padEnd(n); }

/**
 * Resolves the canonical channel_id for a given (platform, platform_channel_id, channel_key)
 * combination — same logic as auto-refill-watcher.ts resolveCanonicalChannelId():
 *   1. channel_key match preferred (avoids cross-brand)
 *   2. is_active=true AND needs_reconnect=false preferred
 *   3. highest upload_queue usage wins (most-used OAuth token)
 * For tang_sau this consistently resolves to ch10 because ch10 has the highest usage count.
 */
async function resolveCanonicalChannelId(
  platform: string,
  platformChannelId: string,
  channelKey: string,
): Promise<number | null> {
  const result = await db.execute<{ id: number; queue_count: string }>(
    sql`
      SELECT
        sc.id,
        COUNT(uq.id) AS queue_count
      FROM social_channels sc
      LEFT JOIN upload_queue uq ON uq.channel_id = sc.id
      WHERE sc.platform            = ${platform}
        AND sc.platform_channel_id = ${platformChannelId}
      GROUP BY sc.id, sc.channel_key, sc.is_active, sc.needs_reconnect
      ORDER BY
        CASE WHEN sc.channel_key      = ${channelKey} THEN 0 ELSE 1 END ASC,
        CASE WHEN sc.is_active = true AND (sc.needs_reconnect = false OR sc.needs_reconnect IS NULL) THEN 0 ELSE 1 END ASC,
        COUNT(uq.id) DESC
      LIMIT 1
    `,
  );
  if (result.rows.length === 0) return null;
  return Number(result.rows[0].id);
}

async function main() {
  console.log("═".repeat(80));
  console.log("  upload_queue health audit");
  console.log(`  mode: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}  cap: ${HEALTH_CAP}  vnNow: ${vnToday}`);
  console.log("═".repeat(80));

  // ── 1. Build canonical channel map ──────────────────────────────────────
  // Collect every distinct (platform, platform_channel_id, channel_key) combination
  // that appears in active upload_queue rows, then resolve canonical for each.
  const platformChannels = await db.execute(sql`
    SELECT DISTINCT sc.platform, sc.platform_channel_id, cg.channel_key
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    JOIN content_generations cg ON cg.id = uq.content_id
    WHERE uq.status IN ('queued','pending','scheduled','uploading','processing','error')
  `);

  // canonical map: "platform|platformChannelId" → canonical channel_id
  const canonicalMap = new Map<string, number | null>();
  for (const r of platformChannels.rows as any[]) {
    const key = `${r.platform}|${r.platform_channel_id}`;
    if (!canonicalMap.has(key)) {
      const cid = await resolveCanonicalChannelId(r.platform, r.platform_channel_id, r.channel_key);
      canonicalMap.set(key, cid);
    }
  }

  console.log("\n## Canonical Channel Resolution");
  for (const [key, cid] of canonicalMap.entries()) {
    console.log(`  ${key} → canonical ch_id=${cid}`);
  }

  // ── 2. Fetch all active rows ─────────────────────────────────────────────
  const activeRows = await db.execute(sql`
    SELECT
      uq.id,
      uq.content_id,
      uq.channel_id,
      uq.platform,
      uq.video_type,
      uq.status,
      uq.scheduled_at,
      uq.error_message,
      cg.channel_key,
      cg.format_type,
      cg.topic,
      sc.platform_channel_id,
      sc.platform_account_id
    FROM upload_queue uq
    JOIN content_generations cg ON cg.id = uq.content_id
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.status IN ('queued','pending','scheduled','uploading','processing','error')
    ORDER BY uq.scheduled_at NULLS LAST, uq.id
  `);

  const rows = activeRows.rows as any[];
  console.log(`\nTotal active rows: ${rows.length}`);
  const gateRows = rows.filter(r => r.status === "queued" || r.status === "uploading");
  console.log(`Gate-relevant (queued+uploading): ${gateRows.length}  Cap: ${HEALTH_CAP}  Need to remove: ${Math.max(0, gateRows.length - HEALTH_CAP)}`);

  // ── 3. Summary table ─────────────────────────────────────────────────────
  console.log("\n## Active Queue Summary");
  const summary = new Map<string, { today: number; tomorrow: number; later: number; unset: number; total: number }>();
  for (const r of rows) {
    const key = `${r.channel_key}|${r.platform}|${r.video_type}|${r.format_type ?? "—"}|${r.status}`;
    if (!summary.has(key)) summary.set(key, { today: 0, tomorrow: 0, later: 0, unset: 0, total: 0 });
    const s = summary.get(key)!;
    const b = bucket(r.scheduled_at ? new Date(r.scheduled_at) : null);
    s[b]++;
    s.total++;
  }
  console.log([
    pad("channel_key", 12), pad("platform", 10), pad("video_type", 11),
    pad("format_type", 22), pad("status", 9),
    "today".padStart(6), "tomorrow".padStart(9), "later".padStart(6), "total".padStart(6),
  ].join(" "));
  console.log("─".repeat(100));
  for (const [key, v] of [...summary.entries()].sort()) {
    const [ck, pl, vt, ft, st] = key.split("|");
    console.log([
      pad(ck, 12), pad(pl, 10), pad(vt, 11), pad(ft, 22), pad(st, 9),
      String(v.today).padStart(6), String(v.tomorrow).padStart(9),
      String(v.later).padStart(6), String(v.total).padStart(6),
    ].join(" "));
  }

  // ── 4. Classify each row ─────────────────────────────────────────────────
  type Class =
    | "KEEP_VIDEO_CAMPAIGN"
    | "KEEP_TANG_SAU_CANONICAL"
    | "CANCEL_DUPLICATE"
    | "CANCEL_BACKUP_OAUTH_ROW"
    | "CANCEL_FB_ONLY_SECONDARY"
    | "NEEDS_REVIEW";

  // Identify phat_phap video campaign content_ids (YT short or FB reel present)
  const byContent = new Map<string, any[]>();
  for (const r of rows) {
    if (!byContent.has(r.content_id)) byContent.set(r.content_id, []);
    byContent.get(r.content_id)!.push(r);
  }
  const phatPhapCampaignIds = new Set<string>();
  for (const [contentId, crows] of byContent.entries()) {
    const r0 = crows[0];
    if (r0.channel_key !== "phat_phap") continue;
    const hasVideo = crows.some((r: any) =>
      r.video_type === "short" && (r.platform === "youtube" || r.platform === "facebook")
    );
    if (hasVideo) phatPhapCampaignIds.add(contentId);
  }

  // Keeper dedup: per (content_id, platform, video_type), keep earliest-id row
  const keeperBySlot = new Map<string, string>();
  for (const r of rows) {
    const slotKey = `${r.content_id}|${r.platform}|${r.video_type}`;
    if (!keeperBySlot.has(slotKey)) keeperBySlot.set(slotKey, r.id);
  }

  const classified: Array<{ row: any; cls: Class; reason: string }> = [];

  for (const r of rows) {
    const slotKey = `${r.content_id}|${r.platform}|${r.video_type}`;
    const isKeeper = keeperBySlot.get(slotKey) === r.id;
    const canonicalKey = `${r.platform}|${r.platform_channel_id}`;
    const canonicalChId = canonicalMap.get(canonicalKey) ?? null;
    const isCanonical = canonicalChId !== null && r.channel_id === canonicalChId;

    let cls: Class;
    let reason = "";

    if (!isKeeper) {
      cls = "CANCEL_DUPLICATE";
      reason = `duplicate slot, keeper=${keeperBySlot.get(slotKey)}`;
    } else if (r.channel_key === "phat_phap" && r.video_type === "short") {
      // YT Short or FB Reel — preserve regardless of format_type (incl. NULL ready-pool items)
      cls = "KEEP_VIDEO_CAMPAIGN";
      reason = `phat_phap ${r.platform} Short/Reel video campaign`;
    } else if (r.channel_key === "phat_phap" && ["quote", "photo", "text"].includes(r.video_type)) {
      cls = "CANCEL_FB_ONLY_SECONDARY";
      reason = `phat_phap FB secondary (${r.video_type}), optional, cancelling for queue health`;
    } else if (r.channel_key === "tang_sau") {
      if (isCanonical) {
        cls = "KEEP_TANG_SAU_CANONICAL";
        reason = `tang_sau canonical ch_id=${r.channel_id} (resolved by usage-count policy)`;
      } else {
        cls = "CANCEL_BACKUP_OAUTH_ROW";
        reason = `tang_sau backup OAuth ch_id=${r.channel_id}, canonical is ch_id=${canonicalChId}`;
      }
    } else {
      cls = "NEEDS_REVIEW";
      reason = `unclassified: ck=${r.channel_key} pl=${r.platform} vt=${r.video_type}`;
    }

    classified.push({ row: r, cls, reason });
  }

  // ── 5. Safety assertion: abort if canonical tang_sau would be cancelled ──
  const dangerRows = classified.filter(c =>
    (c.cls === "CANCEL_BACKUP_OAUTH_ROW" || c.cls === "CANCEL_DUPLICATE") &&
    c.row.channel_key === "tang_sau" &&
    canonicalMap.get(`${c.row.platform}|${c.row.platform_channel_id}`) === c.row.channel_id
  );
  if (dangerRows.length > 0) {
    console.error("\n⚠ DANGER_CANONICAL_CANCEL_ATTEMPT");
    console.error(`  ${dangerRows.length} row(s) on canonical tang_sau channel would be cancelled.`);
    for (const { row: r, cls } of dangerRows) {
      console.error(`  cls=${cls} id=${r.id} ch_id=${r.channel_id} content=${r.content_id}`);
    }
    console.error("  Aborting. Fix classification before retrying.");
    process.exit(2);
  }

  // ── 6. Classification summary ────────────────────────────────────────────
  console.log("\n## Queue Classification");
  const classCounts = new Map<Class, number>();
  for (const { cls } of classified) classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
  for (const [cls, cnt] of [...classCounts.entries()].sort()) {
    console.log(`  ${pad(cls, 30)} ${cnt}`);
  }

  // ── 7. Reduction plan ───────────────────────────────────────────────────
  const cancellable = classified.filter(c =>
    c.cls === "CANCEL_DUPLICATE" ||
    c.cls === "CANCEL_BACKUP_OAUTH_ROW" ||
    c.cls === "CANCEL_FB_ONLY_SECONDARY"
  );
  // Only cancel gate-relevant rows (queued/uploading) for cap purposes,
  // but cancel all safe rows regardless for housekeeping.
  const cancelTargets = cancellable;
  const gateAfter = gateRows.length - cancelTargets.filter(c =>
    c.row.status === "queued" || c.row.status === "uploading"
  ).length;

  console.log("\n## Reduction Plan");
  console.log(`  Gate before : ${gateRows.length}  Cap: ${HEALTH_CAP}`);
  console.log(`  Safe cancels: ${cancelTargets.length} (${cancelTargets.filter(c => c.row.status === "queued" || c.row.status === "uploading").length} gate-relevant)`);
  console.log(`  Gate after  : ${gateAfter} ${gateAfter <= HEALTH_CAP ? "✓ under cap" : "⚠ still over cap — needs manual review"}`);

  console.log("\n## Dry-run Table");
  console.log([
    pad("queue_id", 20), pad("content_id", 26), pad("channel_key", 12),
    pad("platform", 10), pad("vtype", 7), pad("ch_id", 6),
    pad("sched_vn", 11), pad("class", 25), "reason",
  ].join(" "));
  console.log("─".repeat(155));
  for (const { row: r, cls, reason } of cancelTargets) {
    const schedVn = r.scheduled_at ? vnDateOf(new Date(r.scheduled_at)) : "—";
    console.log([
      pad(r.id.slice(0, 20), 20),
      pad(r.content_id.slice(0, 26), 26),
      pad(r.channel_key, 12),
      pad(r.platform, 10),
      pad(r.video_type, 7),
      pad(String(r.channel_id), 6),
      pad(schedVn, 11),
      pad(cls, 25),
      reason.slice(0, 65),
    ].join(" "));
  }

  // ── 8. Execute ──────────────────────────────────────────────────────────
  if (!EXECUTE) {
    console.log(`\n[DRY-RUN] Would cancel ${cancelTargets.length} rows → gate would be ${gateAfter}`);
    console.log("Re-run with --execute to apply.");
  } else {
    if (cancelTargets.length === 0) {
      console.log("\nNothing to cancel.");
    } else {
      console.log(`\n## Executing ${cancelTargets.length} cancellations…`);
      for (const { row: r } of cancelTargets) {
        await db.execute(sql`
          UPDATE upload_queue
          SET status = 'cancelled', error_message = 'queue_health_cap_reduction', updated_at = NOW()
          WHERE id = ${r.id}
        `);
      }
      console.log(`  ✓ ${cancelTargets.length} rows cancelled`);
    }

    // Post-execution verification
    console.log("\n## Post-Execution Verification");
    const verifyGate = await db.execute(sql`SELECT COUNT(*)::int as cnt FROM upload_queue WHERE status IN ('queued','uploading')`);
    const gateNow = (verifyGate.rows[0] as any).cnt;
    console.log(`  Gate count: ${gateRows.length} → ${gateNow} (cap ${HEALTH_CAP}) ${gateNow <= HEALTH_CAP ? "✓ OK" : "⚠ OVER CAP"}`);

    // Ensure no tang_sau canonical rows were touched
    const tsCanonicalCancelled = await db.execute(sql`
      SELECT COUNT(*)::int as cnt
      FROM upload_queue uq
      JOIN content_generations cg ON cg.id = uq.content_id
      WHERE uq.error_message = 'queue_health_cap_reduction'
        AND cg.channel_key = 'tang_sau'
        AND uq.channel_id = 10
    `);
    const tsHit = (tsCanonicalCancelled.rows[0] as any).cnt;
    console.log(`  tang_sau canonical (ch10) cancelled by this run: ${tsHit} ${tsHit === 0 ? "✓ OK" : "✗ DANGER — restore immediately"}`);

    // phat_phap video campaign pairing integrity
    const ppPairs = await db.execute(sql`
      SELECT uq.content_id, uq.platform, uq.video_type
      FROM upload_queue uq
      JOIN content_generations cg ON cg.id = uq.content_id
      WHERE cg.channel_key = 'phat_phap'
        AND uq.video_type = 'short'
        AND uq.status IN ('queued','uploading')
    `);
    const ppMap = new Map<string, { yt: boolean; fb: boolean }>();
    for (const r of ppPairs.rows as any[]) {
      if (!ppMap.has(r.content_id)) ppMap.set(r.content_id, { yt: false, fb: false });
      const s = ppMap.get(r.content_id)!;
      if (r.platform === "youtube") s.yt = true;
      if (r.platform === "facebook") s.fb = true;
    }
    let unpaired = 0;
    for (const [cid, s] of ppMap) {
      if (!s.yt || !s.fb) { console.log(`  ⚠ unpaired: ${cid} yt=${s.yt} fb=${s.fb}`); unpaired++; }
    }
    console.log(`  phat_phap YT+FB pairs: ${ppMap.size} content items, ${unpaired === 0 ? "✓ all paired" : `✗ ${unpaired} unpaired`}`);

    console.log(`\n## Queue Before/After`);
    console.log(`  Gate before  : ${gateRows.length}`);
    console.log(`  Gate after   : ${gateNow}`);
    console.log(`  Cancelled    : ${cancelTargets.length}`);
    console.log(`    duplicates        : ${cancelTargets.filter(c => c.cls === "CANCEL_DUPLICATE").length}`);
    console.log(`    backup OAuth      : ${cancelTargets.filter(c => c.cls === "CANCEL_BACKUP_OAUTH_ROW").length}`);
    console.log(`    FB secondary      : ${cancelTargets.filter(c => c.cls === "CANCEL_FB_ONLY_SECONDARY").length}`);
  }

  // ── 9. NEEDS_REVIEW ─────────────────────────────────────────────────────
  const needsReview = classified.filter(c => c.cls === "NEEDS_REVIEW");
  console.log(`\n## NEEDS_REVIEW (${needsReview.length})`);
  if (needsReview.length === 0) {
    console.log("  (none)");
  } else {
    for (const { row: r, reason } of needsReview) {
      console.log(`  ch_id=${r.channel_id} ${r.id.slice(0, 20)} ${r.channel_key} ${r.platform}/${r.video_type} — ${reason}`);
    }
  }

  console.log("\n" + "═".repeat(80));
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
