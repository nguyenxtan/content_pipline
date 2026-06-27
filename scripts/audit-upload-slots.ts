/**
 * audit-upload-slots.ts
 *
 * Read-only audit of upload_queue and published_videos for:
 *   1. Same scheduled_at slot collisions (root cause of 2026-06-15 incident)
 *   2. Duplicate content candidates (same content queued twice)
 *   3. Overdue queue (queued rows past scheduled_at)
 *   4. Publish/upload volume spikes by hour
 *   5. FB quote/photo pair health for Tri Tue An Nhien (channel_id=6)
 *
 * Read-only. Does NOT mutate any rows.
 *
 * Options:
 *   --hours <n>       Look-back window (default: 48)
 *   --platform <p>    Filter: facebook | youtube (default: all)
 *
 * Run:
 *   npm run audit:upload-slots
 *   npm run audit:upload-slots -- --hours 24 --platform facebook
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import { sql, SQL } from "drizzle-orm";

// ── Arg parsing ───────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const hoursArg = rawArgs.indexOf("--hours");
const HOURS = hoursArg >= 0 && rawArgs[hoursArg + 1] ? Math.max(1, Number(rawArgs[hoursArg + 1]) || 48) : 48;

const platformArg = rawArgs.indexOf("--platform");
const PLATFORM_RAW = platformArg >= 0 ? rawArgs[platformArg + 1] ?? "" : "";
const PLATFORM_FILTER: "facebook" | "youtube" | null =
  PLATFORM_RAW === "facebook" ? "facebook" : PLATFORM_RAW === "youtube" ? "youtube" : null;

// Build a reusable platform WHERE fragment to avoid null-param issues in Drizzle
const platformWhere: SQL = PLATFORM_FILTER
  ? sql`AND uq.platform = ${PLATFORM_FILTER}`
  : sql``;

// ── Formatting helpers ────────────────────────────────────────────────────────

const HR = "-".repeat(68);

function sectionHeader(title: string) {
  console.log(`\n${HR}`);
  console.log(`## ${title}`);
  console.log(HR);
}

function pad(s: unknown, n: number, right = false): string {
  const str = String(s ?? "-").slice(0, n);
  return right ? str.padStart(n) : str.padEnd(n);
}

function tableRow(cells: [unknown, number, boolean?][]): string {
  return "  " + cells.map(([v, w, r]) => pad(v, w, r)).join("  ");
}

function tableHeader(cols: [string, number][]): void {
  console.log("  " + cols.map(([h, w]) => pad(h, w)).join("  "));
  console.log("  " + cols.map(([, w]) => "-".repeat(w)).join("  "));
}

// pg driver returns AT TIME ZONE result as a plain timestamp string — display as-is.
function fmtVn(raw: unknown): string {
  if (!raw) return "-";
  return String(raw).replace("T", " ").replace(/\.\d+.*$/, "").slice(0, 16);
}

function fmtArr(arr: unknown): string {
  if (!arr) return "-";
  if (Array.isArray(arr)) return arr.join(", ");
  return String(arr).replace(/^\{|\}$/g, "").replace(/,/g, ", ");
}

type Row = Record<string, unknown>;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const since = new Date(Date.now() - HOURS * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  console.log("\n# Upload Slot Audit");
  console.log(`\n## Time window`);
  console.log(`  Since:    ${sinceIso}  (last ${HOURS}h)`);
  console.log(`  Now:      ${new Date().toISOString()}`);
  console.log(`  Display:  Asia/Ho_Chi_Minh (UTC+7)`);
  if (PLATFORM_FILTER) console.log(`  Platform: ${PLATFORM_FILTER}`);

  // ── 1. Same scheduled_at slot collisions ──────────────────────────────────

  sectionHeader("1. Same scheduled_at Slot Collisions");
  console.log("  Groups with >1 content item at (platform, channel, video_type, scheduled_at, status).");
  console.log("  CRITICAL if status in queued/uploading/done -- recreates 2026-06-15 overposting.\n");

  const collisions = await db.execute(sql`
    SELECT
      uq.platform,
      sc.channel_key,
      uq.video_type,
      uq.status,
      (uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS slot_vn,
      COUNT(*) AS cnt,
      array_agg(DISTINCT LEFT(uq.content_id::text, 8) ORDER BY LEFT(uq.content_id::text, 8)) AS content_ids
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.scheduled_at >= ${sinceIso}::timestamptz
      ${platformWhere}
    GROUP BY uq.platform, sc.channel_key, uq.video_type, uq.scheduled_at, uq.status
    HAVING COUNT(*) > 1
    ORDER BY uq.platform, sc.channel_key, uq.video_type, uq.scheduled_at, uq.status
  `);

  const collisionRows = (collisions as { rows: Row[] }).rows;

  if (collisionRows.length === 0) {
    console.log("  OK No slot collisions found in window.");
  } else {
    let critCount = 0;
    tableHeader([
      ["SEVERITY", 10], ["platform", 9], ["channel", 12], ["type", 6],
      ["status", 10], ["slot_vn", 16], ["cnt", 4], ["content_ids (8ch)", 40],
    ]);
    for (const r of collisionRows) {
      const status = String(r.status ?? "");
      const isCritical = ["queued", "uploading", "done"].includes(status);
      if (isCritical) critCount++;
      console.log(tableRow([
        [isCritical ? "!! CRITICAL" : "   warning", 10],
        [r.platform, 9],
        [r.channel_key, 12],
        [r.video_type, 6],
        [r.status, 10],
        [fmtVn(r.slot_vn), 16],
        [r.cnt, 4, true],
        [fmtArr(r.content_ids), 40],
      ]));
    }
    console.log(`\n  Total groups: ${collisionRows.length}  |  CRITICAL: ${critCount}  |  warning: ${collisionRows.length - critCount}`);
  }

  // ── 2. Duplicate content candidates ───────────────────────────────────────

  sectionHeader("2. Duplicate Content Candidates");
  console.log("  Same (content_id, platform, channel, video_type) with >1 row -- should be 0.\n");

  const dupes = await db.execute(sql`
    SELECT
      LEFT(uq.content_id::text, 12) AS content_id_short,
      uq.platform,
      sc.channel_key,
      uq.video_type,
      COUNT(*) AS cnt,
      array_agg(uq.status ORDER BY uq.created_at) AS statuses,
      MIN(uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS earliest_slot_vn,
      MAX(uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS latest_slot_vn
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.scheduled_at >= ${sinceIso}::timestamptz
      ${platformWhere}
    GROUP BY uq.content_id, uq.platform, sc.channel_key, uq.video_type
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, uq.platform, sc.channel_key
  `);

  const dupeRows = (dupes as { rows: Row[] }).rows;

  if (dupeRows.length === 0) {
    console.log("  OK No duplicate content candidates.");
  } else {
    tableHeader([
      ["content_id", 14], ["platform", 9], ["channel", 12], ["type", 6],
      ["cnt", 4], ["statuses", 28], ["earliest_vn", 16], ["latest_vn", 16],
    ]);
    for (const r of dupeRows) {
      console.log(tableRow([
        [r.content_id_short, 14],
        [r.platform, 9],
        [r.channel_key, 12],
        [r.video_type, 6],
        [r.cnt, 4, true],
        [fmtArr(r.statuses), 28],
        [fmtVn(r.earliest_slot_vn), 16],
        [fmtVn(r.latest_slot_vn), 16],
      ]));
    }
    console.log(`\n  !! ${dupeRows.length} duplicate candidate(s) found.`);
  }

  // ── 3. Overdue queue ──────────────────────────────────────────────────────

  sectionHeader("3. Overdue Queue (queued rows past scheduled_at)");
  console.log("  Past-due queued rows drain immediately on next cron ticks -- bulk drain risk.\n");

  // GROUP BY must repeat the full CASE expression — PostgreSQL rejects aliases in GROUP BY.
  // ORDER BY uses MIN(scheduled_at) so oldest overdue (most urgent) rows appear first.
  const overdue = await db.execute(sql`
    SELECT
      uq.platform,
      sc.channel_key,
      uq.video_type,
      CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - uq.scheduled_at)) < 1800   THEN '0-30m'
        WHEN EXTRACT(EPOCH FROM (NOW() - uq.scheduled_at)) < 7200   THEN '30m-2h'
        WHEN EXTRACT(EPOCH FROM (NOW() - uq.scheduled_at)) < 43200  THEN '2-12h'
        ELSE '>12h'
      END AS age_bucket,
      COUNT(*) AS cnt,
      MIN(uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS oldest_slot_vn
    FROM upload_queue uq
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE uq.status = 'queued'
      AND uq.scheduled_at < NOW()
      ${platformWhere}
    GROUP BY uq.platform, sc.channel_key, uq.video_type,
      CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - uq.scheduled_at)) < 1800   THEN '0-30m'
        WHEN EXTRACT(EPOCH FROM (NOW() - uq.scheduled_at)) < 7200   THEN '30m-2h'
        WHEN EXTRACT(EPOCH FROM (NOW() - uq.scheduled_at)) < 43200  THEN '2-12h'
        ELSE '>12h'
      END
    ORDER BY uq.platform, sc.channel_key, uq.video_type, MIN(uq.scheduled_at)
  `);

  const overdueRows = (overdue as { rows: Row[] }).rows;

  if (overdueRows.length === 0) {
    console.log("  OK No overdue queued rows.");
  } else {
    let totalOverdue = 0;
    let highRisk = 0;
    tableHeader([
      ["platform", 9], ["channel", 12], ["type", 6], ["age", 9], ["cnt", 5], ["oldest_slot_vn", 16],
    ]);
    for (const r of overdueRows) {
      const cnt = Number(r.cnt ?? 0);
      totalOverdue += cnt;
      const age = String(r.age_bucket ?? "");
      if (age === ">12h" || age === "2-12h") highRisk += cnt;
      const flag = cnt >= 3 ? " !!" : "";
      console.log(tableRow([
        [r.platform, 9], [r.channel_key, 12], [r.video_type, 6],
        [r.age_bucket, 9], [String(cnt) + flag, 5], [fmtVn(r.oldest_slot_vn), 16],
      ]));
    }
    console.log(`\n  Total overdue: ${totalOverdue}  |  High-risk (>2h old): ${highRisk}`);
    if (highRisk > 0) {
      console.log("  !! High-risk rows drain immediately -- review before next cron tick.");
    }
  }

  // ── 4. Publish/upload volume by hour ─────────────────────────────────────

  sectionHeader("4. Publish Volume by Hour (published_videos)");
  console.log("  >3 uploads/hour on same channel/type = spike. FB spike is the 2026-06-15 pattern.\n");

  const volumes = await db.execute(sql`
    SELECT
      DATE_TRUNC('hour', pv.published_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS hour_vn,
      pv.platform,
      sc.channel_key,
      pv.video_type,
      COUNT(*) AS cnt
    FROM published_videos pv
    JOIN upload_queue uq ON uq.id = pv.upload_queue_id
    JOIN social_channels sc ON sc.id = uq.channel_id
    WHERE pv.published_at >= ${sinceIso}::timestamptz
      ${platformWhere}
    GROUP BY hour_vn, pv.platform, sc.channel_key, pv.video_type
    ORDER BY hour_vn DESC, pv.platform, sc.channel_key, pv.video_type
  `);

  const volumeRows = (volumes as { rows: Row[] }).rows;

  if (volumeRows.length === 0) {
    console.log("  (No published_videos rows in window.)");
  } else {
    let spikeCount = 0;
    tableHeader([
      ["hour_vn", 16], ["platform", 9], ["channel", 12], ["type", 6], ["cnt", 5], ["note", 12],
    ]);
    for (const r of volumeRows) {
      const cnt = Number(r.cnt ?? 0);
      const spike = cnt > 3;
      if (spike) spikeCount++;
      console.log(tableRow([
        [fmtVn(r.hour_vn), 16], [r.platform, 9], [r.channel_key, 12],
        [r.video_type, 6], [cnt, 5, true], [spike ? "!! SPIKE" : "", 12],
      ]));
    }
    if (spikeCount === 0) {
      console.log("\n  OK No publish spikes (all channels <=3/hour).");
    } else {
      console.log(`\n  !! ${spikeCount} spike(s) detected (>3 uploads/hour on same channel/type).`);
    }
  }

  // ── 5. FB quote/photo pair health ─────────────────────────────────────────

  sectionHeader("5. FB Quote/Photo Pair Health (channel_id=6)");
  console.log("  Expected: 1 quote + 1 short per campaign slot. rows > distinct_slots = collision.");
  console.log("  skip_slot_collision not in DB -- check server logs: [phatPhapCampaign] SKIP slot_collision\n");

  const fbQuoteHealth = await db.execute(sql`
    SELECT
      DATE_TRUNC('hour', uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS hour_vn,
      uq.video_type,
      uq.status,
      COUNT(*) AS cnt,
      COUNT(DISTINCT uq.scheduled_at) AS distinct_slots,
      COUNT(DISTINCT uq.content_id) AS distinct_contents
    FROM upload_queue uq
    WHERE uq.channel_id = 6
      AND uq.scheduled_at >= ${sinceIso}::timestamptz
    GROUP BY hour_vn, uq.video_type, uq.status
    ORDER BY hour_vn DESC, uq.video_type, uq.status
  `);

  const fbQuoteRows = (fbQuoteHealth as { rows: Row[] }).rows;

  const fbQuoteCollisions = await db.execute(sql`
    SELECT
      uq.video_type,
      (uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS slot_vn,
      uq.status,
      COUNT(*) AS cnt,
      array_agg(DISTINCT LEFT(uq.content_id::text, 8) ORDER BY LEFT(uq.content_id::text, 8)) AS content_ids
    FROM upload_queue uq
    WHERE uq.channel_id = 6
      AND uq.scheduled_at >= ${sinceIso}::timestamptz
    GROUP BY uq.video_type, uq.scheduled_at, uq.status
    HAVING COUNT(*) > 1
    ORDER BY uq.video_type, uq.scheduled_at DESC
  `);

  const fbCollisionRows = (fbQuoteCollisions as { rows: Row[] }).rows;

  console.log("  ### Hourly breakdown (channel_id=6)\n");
  if (fbQuoteRows.length === 0) {
    console.log("  (No rows for channel_id=6 in window.)");
  } else {
    tableHeader([
      ["hour_vn", 16], ["video_type", 10], ["status", 10],
      ["rows", 5], ["slots", 6], ["contents", 9], ["note", 10],
    ]);
    for (const r of fbQuoteRows) {
      const rows = Number(r.cnt ?? 0);
      const slots = Number(r.distinct_slots ?? 0);
      const collision = rows > slots;
      console.log(tableRow([
        [fmtVn(r.hour_vn), 16], [r.video_type, 10], [r.status, 10],
        [rows, 5, true], [slots, 6, true], [r.distinct_contents, 9, true],
        [collision ? "!! COLL" : "", 10],
      ]));
    }
    console.log("\n  Legend: rows > slots = multiple contents sharing the same scheduled_at.");
  }

  console.log("\n  ### Slot-level collisions on channel_id=6\n");
  if (fbCollisionRows.length === 0) {
    console.log("  OK No slot collisions on FB channel_id=6.");
  } else {
    tableHeader([
      ["video_type", 10], ["slot_vn", 16], ["status", 10], ["cnt", 5], ["content_ids", 36],
    ]);
    for (const r of fbCollisionRows) {
      console.log(tableRow([
        [r.video_type, 10], [fmtVn(r.slot_vn), 16], [r.status, 10],
        [r.cnt, 5, true], [fmtArr(r.content_ids), 36],
      ]));
    }
    console.log(`\n  !! ${fbCollisionRows.length} slot collision group(s) on channel_id=6.`);
    console.log("  Check logs: [phatPhapCampaign] SKIP slot_collision");
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  sectionHeader("Summary");

  const criticalCollisions = collisionRows.filter(
    (r) => ["queued", "uploading", "done"].includes(String(r.status ?? "")),
  ).length;
  const totalOverdueCount = overdueRows.reduce((s, r) => s + Number(r.cnt ?? 0), 0);
  const hasSpike = volumeRows.some((r) => Number(r.cnt) > 3);

  const checks: [string, boolean, string][] = [
    ["Slot collisions (CRITICAL)", criticalCollisions === 0, criticalCollisions === 0 ? "0" : `${criticalCollisions} !!`],
    ["Slot collisions (all)", collisionRows.length === 0, collisionRows.length === 0 ? "0" : `${collisionRows.length} !!`],
    ["Duplicate content candidates", dupeRows.length === 0, dupeRows.length === 0 ? "0" : `${dupeRows.length} !!`],
    ["Overdue queued rows", totalOverdueCount === 0, totalOverdueCount === 0 ? "0" : `${totalOverdueCount} !!`],
    ["Publish spikes (>3/hr)", !hasSpike, !hasSpike ? "none" : "found !!"],
    ["FB ch6 slot collisions", fbCollisionRows.length === 0, fbCollisionRows.length === 0 ? "0" : `${fbCollisionRows.length} !!`],
  ];

  for (const [label, ok, value] of checks) {
    const icon = ok ? "OK" : "!!";
    console.log(`  [${icon}] ${label.padEnd(38)} ${value}`);
  }

  console.log("\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e?.message ?? e);
  process.exit(1);
});
