/**
 * Phat Phap Video Calendar Audit + Normalization.
 *
 * Two-calendar model:
 *   A. VIDEO CAMPAIGN CALENDAR  06:00–21:00 VN, hourly.
 *      Content: tts_short and legacy_quote_short (MP4 video).
 *      Rule: one video campaign per hour = one content_id published as
 *            YouTube Short + Facebook Reel at the same scheduledAt.
 *      TTS and quote must alternate.
 *
 *   B. FACEBOOK-ONLY POST CALENDAR  08:00–21:00 VN.
 *      Content: videoType != "short" (quote/photo/text).
 *      These posts do NOT block or count against video campaign hours.
 *
 * Audit flags:
 *   SAME_CONTENT_DUPLICATE_YOUTUBE_SLOT
 *     Same content_id + same scheduledAt on two+ sibling YT channel rows.
 *     → Cancel extra row(s); keep earliest-created.
 *
 *   DUPLICATE_YOUTUBE_SLOT
 *     Different content_ids at the EXACT same scheduledAt (slot-level collision).
 *     → Reschedule extra content campaign to next free slot; move paired FB Reel.
 *
 *   MULTI_CONTENT_CAMPAIGN_HOUR
 *     Two+ distinct content_ids within the same 60-min campaign hour (may or may
 *     not share exact scheduledAt).  Always implies DUPLICATE_YOUTUBE_SLOT or
 *     OUTSIDE_VIDEO_WINDOW as root cause.
 *     → Reschedule extra content campaign to next free slot.
 *
 *   MISSING_FB_REEL           YT Short has no paired FB Reel in same campaign hour.
 *   MISSING_YT_ROW            FB Reel has no paired YT Short in same campaign hour.
 *   OUTSIDE_VIDEO_WINDOW      Video row outside 06:00–21:00 VN.
 *   FB_ONLY_OUTSIDE_WINDOW    FB-only post outside 08:00–21:00 VN.
 *
 * Normalization rules:
 *   SAME_CONTENT_DUPLICATE  → status='cancelled', error_message='duplicate_youtube_sibling_row_cancelled'
 *                              (no reschedule — same content is already kept on the primary row)
 *   DIFFERENT_CONTENT_HOUR_COLLISION → UPDATE scheduled_at to next free 06:00–21:00 VN slot
 *                                       UPDATE paired FB Reel scheduled_at to same new slot
 *
 * Run modes:
 *   npx tsx scripts/audit-phat-phap-video-calendar.ts              # audit only
 *   npx tsx scripts/audit-phat-phap-video-calendar.ts --normalize  # audit + SQL dry-run (no writes)
 *   npx tsx scripts/audit-phat-phap-video-calendar.ts --execute    # audit + apply (USE WITH CARE)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import { uploadQueue, contentGenerations } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// ── Config ────────────────────────────────────────────────────────────────────

const VN_TZ = "Asia/Ho_Chi_Minh";
const VN_OFFSET_H = 7;
const VIDEO_CAMPAIGN_START_H = 6;  // 06:00 inclusive
const VIDEO_CAMPAIGN_END_H   = 21; // 21:00 exclusive (last valid hour = 20)
const FB_ONLY_START_H = 8;
const FB_ONLY_END_H   = 21;

// phat_phap social_channel IDs.
// YouTube canonical: ch1. All YT credentials for phat_phap: ch1–ch4.
// Facebook canonical: ch6.
const YT_CHANNEL_IDS = [1, 2, 3, 4];
const FB_CHANNEL_IDS = [6];
const ALL_PP_CHANNEL_IDS = [...YT_CHANNEL_IDS, ...FB_CHANNEL_IDS];

const CANCEL_REASON = "duplicate_youtube_sibling_row_cancelled";

// ── VN time helpers ───────────────────────────────────────────────────────────

function toVnParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), m: Number(p.minute) };
}

function toVnString(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TZ, hour12: false,
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function campaignHourKey(d: Date): string {
  const { y, mo, d: day, h } = toVnParts(d);
  return `${y}-${String(mo).padStart(2,"0")}-${String(day).padStart(2,"0")} ${String(h).padStart(2,"0")}`;
}

function vnHour(d: Date): number { return toVnParts(d).h; }

function fromVnLocal(y: number, mo: number, day: number, h: number, m: number): Date {
  return new Date(Date.UTC(y, mo - 1, day, h - VN_OFFSET_H, m, 0, 0));
}

function isInsideVideoWindow(d: Date): boolean {
  const h = vnHour(d);
  return h >= VIDEO_CAMPAIGN_START_H && h < VIDEO_CAMPAIGN_END_H;
}

function isInsideFbOnlyWindow(d: Date): boolean {
  const h = vnHour(d);
  return h >= FB_ONLY_START_H && h < FB_ONLY_END_H;
}

// ── DB types ──────────────────────────────────────────────────────────────────

type QRow = {
  id: string;
  contentId: string;
  channelId: number;
  platform: string;
  videoType: string;
  status: string;
  scheduledAt: Date;
  createdAt: Date;
  formatType: string | null;
  topic: string;
};

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchRows(): Promise<QRow[]> {
  const qRows = await db
    .select({
      id: uploadQueue.id,
      contentId: uploadQueue.contentId,
      channelId: uploadQueue.channelId,
      platform: uploadQueue.platform,
      videoType: uploadQueue.videoType,
      status: uploadQueue.status,
      scheduledAt: uploadQueue.scheduledAt,
      createdAt: uploadQueue.createdAt,
    })
    .from(uploadQueue)
    .where(and(
      inArray(uploadQueue.channelId, ALL_PP_CHANNEL_IDS),
      inArray(uploadQueue.status, ["queued", "uploading", "pending", "scheduled", "processing"]),
    ));

  if (qRows.length === 0) return [];

  const contentIds = [...new Set(qRows.map(r => r.contentId))];
  const cRows = await db
    .select({ id: contentGenerations.id, formatType: contentGenerations.formatType, topic: contentGenerations.topic })
    .from(contentGenerations)
    .where(inArray(contentGenerations.id, contentIds));
  const cMap = new Map(cRows.map(c => [c.id, c]));

  return qRows.map(r => ({
    ...r,
    formatType: cMap.get(r.contentId)?.formatType ?? null,
    topic: cMap.get(r.contentId)?.topic ?? "(unknown)",
  }));
}

// ── Audit ─────────────────────────────────────────────────────────────────────

type Flag = {
  type: string;
  rowId: string;
  contentId: string;
  platform: string;
  videoType: string;
  formatType: string | null;
  scheduledAtVn: string;
  createdAtVn: string;
  issue: string;
};

function runAudit(rows: QRow[], now: Date): Flag[] {
  const flags: Flag[] = [];
  const future = rows.filter(r => r.scheduledAt > now);

  const ytVideo = future.filter(r => YT_CHANNEL_IDS.includes(r.channelId) && r.videoType === "short");
  const fbReel  = future.filter(r => FB_CHANNEL_IDS.includes(r.channelId) && r.videoType === "short");
  const fbOnly  = future.filter(r => FB_CHANNEL_IDS.includes(r.channelId) && r.videoType !== "short");

  const flag = (type: string, r: QRow, issue: string) =>
    flags.push({
      type, rowId: r.id, contentId: r.contentId,
      platform: r.platform, videoType: r.videoType, formatType: r.formatType,
      scheduledAtVn: toVnString(r.scheduledAt), createdAtVn: toVnString(r.createdAt),
      issue,
    });

  // ── SAME_CONTENT_DUPLICATE_YOUTUBE_SLOT ────────────────────────────────────
  // Same content_id + same exact scheduledAt on different YT sibling channel rows.
  // Group by (contentId, scheduledAt); any group with >1 row = sibling duplicate.
  const ytByCidSlot = new Map<string, QRow[]>();
  for (const r of ytVideo) {
    const k = `${r.contentId}::${r.scheduledAt.toISOString()}`;
    ytByCidSlot.set(k, [...(ytByCidSlot.get(k) ?? []), r]);
  }
  for (const [, slotRows] of ytByCidSlot) {
    if (slotRows.length < 2) continue;
    const sorted = [...slotRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const keeper = sorted[0];
    for (const dup of sorted.slice(1)) {
      flag("SAME_CONTENT_DUPLICATE_YOUTUBE_SLOT", dup,
        `Same content_id ${dup.contentId.slice(0,8)} at same scheduledAt on ch${dup.channelId} ` +
        `— duplicate of keeper row ${keeper.id.slice(0,8)} on ch${keeper.channelId}; will be cancelled`);
    }
    // Also tag the keeper so it appears in the audit table with context
    flag("SAME_CONTENT_DUPLICATE_YOUTUBE_SLOT", keeper,
      `Keeper row for content ${keeper.contentId.slice(0,8)} at ${toVnString(keeper.scheduledAt)} ` +
      `— ${sorted.length - 1} duplicate(s) will be cancelled`);
  }

  // ── DUPLICATE_YOUTUBE_SLOT — different content_ids at exact same scheduledAt
  // (also covered by MULTI_CONTENT_CAMPAIGN_HOUR below, but flagged separately for clarity)
  const ytBySlot = new Map<string, QRow[]>();
  for (const r of ytVideo) {
    const k = r.scheduledAt.toISOString();
    ytBySlot.set(k, [...(ytBySlot.get(k) ?? []), r]);
  }
  for (const [, slotRows] of ytBySlot) {
    const uniqCids = new Set(slotRows.map(r => r.contentId));
    if (uniqCids.size < 2) continue; // same-content handled above; skip if only one distinct contentId
    for (const r of slotRows) {
      flag("DUPLICATE_YOUTUBE_SLOT", r,
        `${slotRows.length} rows with ${uniqCids.size} distinct content_ids at same slot ` +
        `${r.scheduledAt.toISOString()} — will reschedule extra content campaigns`);
    }
  }

  // ── MULTI_CONTENT_CAMPAIGN_HOUR — two+ distinct content_ids in same 60-min hour
  const ytByHour = new Map<string, QRow[]>();
  for (const r of ytVideo) {
    const k = campaignHourKey(r.scheduledAt);
    ytByHour.set(k, [...(ytByHour.get(k) ?? []), r]);
  }
  for (const [hour, hourRows] of ytByHour) {
    const uniqCids = new Set(hourRows.map(r => r.contentId));
    if (uniqCids.size < 2) continue;
    for (const r of hourRows) {
      flag("MULTI_CONTENT_CAMPAIGN_HOUR", r,
        `Campaign hour ${hour} has ${uniqCids.size} distinct content_ids: ` +
        `[${[...uniqCids].map(x => x.slice(0,8)).join(", ")}]`);
    }
  }

  // ── OUTSIDE_VIDEO_WINDOW ─────────────────────────────────────────────────────
  for (const r of [...ytVideo, ...fbReel]) {
    if (!isInsideVideoWindow(r.scheduledAt)) {
      flag("OUTSIDE_VIDEO_WINDOW", r,
        `${r.formatType ?? "?"} outside 06:00–21:00 VN (hour=${vnHour(r.scheduledAt)})`);
    }
  }

  // ── FB_ONLY_OUTSIDE_WINDOW ───────────────────────────────────────────────────
  for (const r of fbOnly) {
    if (!isInsideFbOnlyWindow(r.scheduledAt)) {
      flag("FB_ONLY_OUTSIDE_WINDOW", r,
        `FB-only post outside 08:00–21:00 VN (hour=${vnHour(r.scheduledAt)})`);
    }
  }

  // ── MISSING_FB_REEL — YT Short has no paired FB Reel in same campaign hour ──
  const fbReelByCidHour = new Map<string, boolean>();
  for (const r of fbReel) fbReelByCidHour.set(`${r.contentId}::${campaignHourKey(r.scheduledAt)}`, true);
  for (const r of ytVideo) {
    if (!fbReelByCidHour.has(`${r.contentId}::${campaignHourKey(r.scheduledAt)}`)) {
      flag("MISSING_FB_REEL", r,
        `YT Short at ${toVnString(r.scheduledAt)} has no paired FB Reel in same campaign hour`);
    }
  }

  // ── MISSING_YT_ROW — FB Reel has no paired YT Short in same campaign hour ───
  const ytByCidHour = new Map<string, boolean>();
  for (const r of ytVideo) ytByCidHour.set(`${r.contentId}::${campaignHourKey(r.scheduledAt)}`, true);
  for (const r of fbReel) {
    if (!ytByCidHour.has(`${r.contentId}::${campaignHourKey(r.scheduledAt)}`)) {
      flag("MISSING_YT_ROW", r,
        `FB Reel at ${toVnString(r.scheduledAt)} has no paired YT Short in same campaign hour`);
    }
  }

  return flags;
}

// ── Normalization plan types ───────────────────────────────────────────────────

/**
 * Cancel a same-content sibling duplicate.
 * Sets status='cancelled', error_message=CANCEL_REASON.
 * Does NOT reschedule — the content is already queued on the keeper row.
 */
type CancelSpec = {
  kind: "cancel";
  rowId: string;
  contentId: string;
  channelId: number;
  scheduledAt: Date;
  keeperRowId: string;
  keeperChannelId: number;
};

/**
 * Reschedule a different-content campaign to a free slot.
 * Updates scheduled_at on the YT row (and paired FB Reel if found).
 */
type MoveSpec = {
  kind: "move";
  rowId: string;
  contentId: string;
  channelId: number;
  oldScheduledAt: Date;
  newScheduledAt: Date;
  reason: string;
  pairedFbRowId?: string;
};

type NormPlan = {
  cancels: CancelSpec[];
  moves: MoveSpec[];
};

// ── Free-slot resolver ────────────────────────────────────────────────────────

function findNextFreeCampaignSlot(occupiedKeys: Set<string>, afterDate: Date): Date {
  const { y, mo, d, h } = toVnParts(afterDate);
  let candidate = fromVnLocal(y, mo, d, h + 1, 0);
  for (let i = 0; i < 200; i++) {
    const { h: ch } = toVnParts(candidate);
    if (ch >= VIDEO_CAMPAIGN_START_H && ch < VIDEO_CAMPAIGN_END_H) {
      if (!occupiedKeys.has(campaignHourKey(candidate))) return candidate;
    }
    candidate = new Date(candidate.getTime() + 60 * 60_000);
  }
  return candidate; // fallback (should never reach)
}

// ── Build normalization plan ──────────────────────────────────────────────────

function buildNormalizationPlan(rows: QRow[], now: Date): NormPlan {
  const cancels: CancelSpec[] = [];
  const moves: MoveSpec[] = [];

  const future = rows.filter(r => r.scheduledAt > now);
  const ytVideo = future.filter(r => YT_CHANNEL_IDS.includes(r.channelId) && r.videoType === "short");
  const fbReel  = future.filter(r => FB_CHANNEL_IDS.includes(r.channelId) && r.videoType === "short");

  // Track IDs already processed so we don't double-handle a row.
  const handled = new Set<string>();

  // ── Pass 1: same-content sibling duplicates → cancel ──────────────────────
  // Group YT rows by (contentId, exact scheduledAt); any group >1 = sibling dups.
  const byCidSlot = new Map<string, QRow[]>();
  for (const r of ytVideo) {
    const k = `${r.contentId}::${r.scheduledAt.toISOString()}`;
    byCidSlot.set(k, [...(byCidSlot.get(k) ?? []), r]);
  }
  for (const [, slotRows] of byCidSlot) {
    if (slotRows.length < 2) continue;
    const sorted = [...slotRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const keeper = sorted[0];
    handled.add(keeper.id);
    for (const dup of sorted.slice(1)) {
      handled.add(dup.id);
      cancels.push({
        kind: "cancel",
        rowId: dup.id,
        contentId: dup.contentId,
        channelId: dup.channelId,
        scheduledAt: dup.scheduledAt,
        keeperRowId: keeper.id,
        keeperChannelId: keeper.channelId,
      });
    }
  }

  // ── Pass 2: different-content campaign-hour collisions → reschedule ────────
  // Build occupied set from ALL currently-scheduled video hours (before any moves).
  const occupiedKeys = new Set([
    ...ytVideo.map(r => campaignHourKey(r.scheduledAt)),
    ...fbReel.map(r => campaignHourKey(r.scheduledAt)),
  ]);

  // Group unhandled YT rows by campaign hour.
  const byHour = new Map<string, QRow[]>();
  for (const r of ytVideo) {
    if (handled.has(r.id)) continue;
    const k = campaignHourKey(r.scheduledAt);
    byHour.set(k, [...(byHour.get(k) ?? []), r]);
  }

  for (const [hour, hourRows] of byHour) {
    const uniqCids = new Set(hourRows.map(r => r.contentId));
    if (uniqCids.size < 2) continue; // no collision

    // Keep the earliest-created row; reschedule the rest.
    const sorted = [...hourRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const keeper = sorted[0];
    handled.add(keeper.id);

    for (const extra of sorted.slice(1)) {
      if (handled.has(extra.id)) continue;
      handled.add(extra.id);

      // Find the last occupied key to search from.
      const lastKey = [...occupiedKeys].sort().at(-1);
      const searchFrom = lastKey
        ? (() => {
            const [datePart, hPart] = lastKey.split(" ");
            const [y2, mo2, d2] = datePart.split("-").map(Number);
            return fromVnLocal(y2, mo2, d2, Number(hPart), 0);
          })()
        : new Date(now.getTime() + 60 * 60_000);

      const newSlot = findNextFreeCampaignSlot(occupiedKeys, searchFrom);
      occupiedKeys.add(campaignHourKey(newSlot));

      // Find paired FB Reel (same contentId, same original campaign hour).
      const pairedFb = fbReel.find(
        r => r.contentId === extra.contentId && campaignHourKey(r.scheduledAt) === hour,
      );

      moves.push({
        kind: "move",
        rowId: extra.id,
        contentId: extra.contentId,
        channelId: extra.channelId,
        oldScheduledAt: extra.scheduledAt,
        newScheduledAt: newSlot,
        reason: `Hour ${hour} collision (keeper content ${keeper.contentId.slice(0,8)} on ch${keeper.channelId}): reschedule to free slot`,
        pairedFbRowId: pairedFb?.id,
      });
    }
  }

  return { cancels, moves };
}

// ── SQL / print helpers ───────────────────────────────────────────────────────

function printPlan(plan: NormPlan): void {
  const total = plan.cancels.length + plan.moves.length;
  if (total === 0) { console.log("  -- Nothing to do."); return; }

  console.log("-- ═══════════════════════════════════════════════");
  console.log("-- Phat Phap Normalization SQL  (DRY-RUN)");
  console.log("-- Review carefully before running against production.");
  console.log("-- ═══════════════════════════════════════════════\n");

  if (plan.cancels.length > 0) {
    console.log(`-- ── CANCEL: ${plan.cancels.length} same-content sibling duplicate(s) ──`);
    for (const c of plan.cancels) {
      console.log(`-- Cancel ch${c.channelId} row ${c.rowId.slice(0,8)} (content ${c.contentId.slice(0,8)}) @${toVnString(c.scheduledAt)}`);
      console.log(`--   Keeper: ${c.keeperRowId.slice(0,8)} on ch${c.keeperChannelId}`);
      console.log(`UPDATE upload_queue`);
      console.log(`  SET status = 'cancelled',`);
      console.log(`      error_message = '${CANCEL_REASON}'`);
      console.log(`  WHERE id = '${c.rowId}'`);
      console.log(`    AND status IN ('queued','uploading','pending','scheduled','processing');`);
      console.log();
    }
  }

  if (plan.moves.length > 0) {
    console.log(`-- ── MOVE: ${plan.moves.length} different-content campaign(s) to free slot ──`);
    for (const m of plan.moves) {
      const newIso = m.newScheduledAt.toISOString();
      console.log(`-- Move YT row ${m.rowId.slice(0,8)} (content ${m.contentId.slice(0,8)})`);
      console.log(`--   ${toVnString(m.oldScheduledAt)} → ${toVnString(m.newScheduledAt)}`);
      console.log(`--   ${m.reason}`);
      console.log(`UPDATE upload_queue SET scheduled_at = '${newIso}'`);
      console.log(`  WHERE id = '${m.rowId}';`);
      if (m.pairedFbRowId) {
        console.log(`-- Paired FB Reel → same new slot`);
        console.log(`UPDATE upload_queue SET scheduled_at = '${newIso}'`);
        console.log(`  WHERE id = '${m.pairedFbRowId}';`);
      } else {
        console.log(`-- (no paired FB Reel found for this content_id in the collision hour)`);
      }
      console.log();
    }
  }

  console.log("-- ═══════════════════════════════════════════════");
  console.log(`-- ${plan.cancels.length} cancel(s)  ${plan.moves.length} reschedule(s)`);
  console.log("-- ═══════════════════════════════════════════════");
}

// ── Execute ───────────────────────────────────────────────────────────────────

async function executePlan(plan: NormPlan): Promise<{ cancelled: number; moved: number }> {
  let cancelled = 0;
  let moved = 0;

  for (const c of plan.cancels) {
    const result = await db
      .update(uploadQueue)
      .set({ status: "cancelled", errorMessage: CANCEL_REASON })
      .where(and(
        eq(uploadQueue.id, c.rowId),
        inArray(uploadQueue.status, ["queued", "uploading", "pending", "scheduled", "processing"]),
      ))
      .returning({ id: uploadQueue.id });
    if (result.length > 0) {
      console.log(`  ✅ Cancelled ch${c.channelId} row ${c.rowId.slice(0,8)} (content ${c.contentId.slice(0,8)}) — keeper is ${c.keeperRowId.slice(0,8)}`);
      cancelled++;
    } else {
      console.log(`  ⚠️  Skipped ${c.rowId.slice(0,8)} — status changed before update (already done/published?)`);
    }
  }

  for (const m of plan.moves) {
    await db
      .update(uploadQueue)
      .set({ scheduledAt: m.newScheduledAt })
      .where(eq(uploadQueue.id, m.rowId));
    console.log(`  ✅ Moved YT ${m.rowId.slice(0,8)} (content ${m.contentId.slice(0,8)}): ${toVnString(m.oldScheduledAt)} → ${toVnString(m.newScheduledAt)}`);

    if (m.pairedFbRowId) {
      await db
        .update(uploadQueue)
        .set({ scheduledAt: m.newScheduledAt })
        .where(eq(uploadQueue.id, m.pairedFbRowId));
      console.log(`     ✅ Moved paired FB Reel ${m.pairedFbRowId.slice(0,8)} → ${toVnString(m.newScheduledAt)}`);
    }
    moved++;
  }

  return { cancelled, moved };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const doNormalize = process.argv.includes("--normalize");
  const doExecute   = process.argv.includes("--execute");
  const now = new Date();

  console.log(`\n=== Phat Phap Video Calendar Audit${doNormalize ? " + SQL dry-run" : ""}${doExecute ? " + EXECUTE" : ""} ===`);
  console.log(`Time now (VN): ${toVnString(now)}\n`);

  // ── Fetch rows ──────────────────────────────────────────────────────────────
  const rows = await fetchRows();
  const future = rows.filter(r => r.scheduledAt > now);
  const ytVideo = future.filter(r => YT_CHANNEL_IDS.includes(r.channelId) && r.videoType === "short");
  const fbReel  = future.filter(r => FB_CHANNEL_IDS.includes(r.channelId) && r.videoType === "short");
  const fbOnly  = future.filter(r => FB_CHANNEL_IDS.includes(r.channelId) && r.videoType !== "short");

  console.log(`Active rows (future, phat_phap):`);
  console.log(`  YT Short (video campaign) : ${ytVideo.length}`);
  console.log(`  FB Reel  (video campaign) : ${fbReel.length}`);
  console.log(`  FB-only  (quote/photo)    : ${fbOnly.length}`);
  console.log(`  Total                     : ${future.length}\n`);

  // ── Duplicate audit table ───────────────────────────────────────────────────
  console.log("## Duplicate Audit\n");
  console.log("| queue_id | content_id | format_type | platform | video_type | scheduled_at_vn | created_at_vn | issue |");
  console.log("|---|---|---|---|---|---|---|---|");

  const ytByHour = new Map<string, QRow[]>();
  for (const r of ytVideo) {
    const k = campaignHourKey(r.scheduledAt);
    ytByHour.set(k, [...(ytByHour.get(k) ?? []), r]);
  }

  const sortedYt = [...ytVideo].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  for (const r of sortedYt) {
    const hour = campaignHourKey(r.scheduledAt);
    const hourRows = ytByHour.get(hour)!;
    const uniqCids = new Set(hourRows.map(x => x.contentId));
    const sameSlotSameCid = hourRows.filter(
      x => x.scheduledAt.toISOString() === r.scheduledAt.toISOString() && x.contentId === r.contentId,
    );
    const hasFb = fbReel.some(fb => fb.contentId === r.contentId && campaignHourKey(fb.scheduledAt) === hour);

    let issue: string;
    if (sameSlotSameCid.length > 1) {
      const sorted = [...sameSlotSameCid].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      issue = sorted[0].id === r.id
        ? `KEEPER (${sameSlotSameCid.length - 1} sibling dup(s) will be cancelled)`
        : `SAME_CONTENT_DUPLICATE_YOUTUBE_SLOT → will cancel`;
    } else if (uniqCids.size > 1) {
      const sortedHour = [...hourRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      issue = sortedHour[0].id === r.id
        ? `KEEPER (${uniqCids.size - 1} other content_id(s) in hour will move)`
        : `MULTI_CONTENT_CAMPAIGN_HOUR → will reschedule`;
    } else {
      issue = "OK";
    }

    if (!hasFb) issue += (issue === "OK" ? "" : " + ") + "MISSING_FB_REEL";

    const fmt = (r.formatType ?? "?").padEnd(20);
    console.log(`| ${r.id.slice(0,8)} | ${r.contentId.slice(0,8)} | ${fmt} | ${r.platform} | ${r.videoType} | ${toVnString(r.scheduledAt)} | ${toVnString(r.createdAt)} | ${issue} |`);
  }

  if (sortedYt.length === 0) {
    console.log("| (no active YouTube rows found) | | | | | | | |");
  }

  // ── Run full audit flags ────────────────────────────────────────────────────
  const flags = runAudit(rows, now);
  const byType = new Map<string, Flag[]>();
  for (const f of flags) byType.set(f.type, [...(byType.get(f.type) ?? []), f]);

  console.log(`\n## Audit Flags (${flags.length} total)\n`);
  const flagOrder = [
    "SAME_CONTENT_DUPLICATE_YOUTUBE_SLOT",
    "DUPLICATE_YOUTUBE_SLOT",
    "MULTI_CONTENT_CAMPAIGN_HOUR",
    "MISSING_FB_REEL",
    "MISSING_YT_ROW",
    "OUTSIDE_VIDEO_WINDOW",
    "FB_ONLY_OUTSIDE_WINDOW",
  ];
  for (const type of flagOrder) {
    const tf = byType.get(type);
    if (!tf?.length) continue;
    console.log(`\n### [${type}] × ${tf.length}`);
    for (const f of tf) {
      console.log(`  row=${f.rowId.slice(0,8)}  content=${f.contentId.slice(0,8)}  @${f.scheduledAtVn}  created=${f.createdAtVn}`);
      console.log(`    → ${f.issue}`);
    }
  }
  if (flags.length === 0) console.log("  ✅ No flags found.");

  // ── Summary ─────────────────────────────────────────────────────────────────
  const dupHours = new Set(
    [...ytByHour.entries()].filter(([, rs]) => new Set(rs.map(r => r.contentId)).size > 1).map(([k]) => k),
  );
  console.log(`\n## Summary`);
  console.log(`  YT Short rows (future)           : ${ytVideo.length}`);
  console.log(`  FB Reel rows  (future)           : ${fbReel.length}`);
  console.log(`  FB-only posts (future)           : ${fbOnly.length}`);
  console.log(`  Unique campaign hours            : ${ytByHour.size}`);
  console.log(`  Collision hours (>1 content_id)  : ${dupHours.size}`);
  for (const type of flagOrder) {
    const n = byType.get(type)?.length ?? 0;
    if (n > 0) console.log(`  ${type.padEnd(40)}: ${n}`);
  }

  // ── Build plan ───────────────────────────────────────────────────────────────
  const criticalFlags = (byType.get("SAME_CONTENT_DUPLICATE_YOUTUBE_SLOT")?.length ?? 0) +
                        (byType.get("DUPLICATE_YOUTUBE_SLOT")?.length ?? 0) +
                        (byType.get("MULTI_CONTENT_CAMPAIGN_HOUR")?.length ?? 0);

  if (doNormalize || doExecute || criticalFlags > 0) {
    const plan = buildNormalizationPlan(rows, now);

    console.log(`\n## Normalization Plan`);
    console.log(`  Same-content duplicates to cancel  : ${plan.cancels.length}`);
    console.log(`  Different-content campaigns to move: ${plan.moves.length}`);

    if (plan.cancels.length + plan.moves.length === 0) {
      console.log("  ✅ Nothing to do.");
    } else if (doExecute) {
      console.log("\n--- Executing ---");
      const { cancelled, moved } = await executePlan(plan);

      // Re-audit after execution to show before/after counts
      console.log("\n--- Post-execute verification ---");
      const rowsAfter = await fetchRows();
      const flagsAfter = runAudit(rowsAfter, new Date());
      const critAfter = (flagsAfter.filter(f =>
        ["SAME_CONTENT_DUPLICATE_YOUTUBE_SLOT","DUPLICATE_YOUTUBE_SLOT","MULTI_CONTENT_CAMPAIGN_HOUR"].includes(f.type)
      ).length);
      console.log(`  Rows cancelled : ${cancelled}`);
      console.log(`  Rows rescheduled: ${moved}`);
      console.log(`  Critical flags before: ${criticalFlags}`);
      console.log(`  Critical flags after : ${critAfter}`);
      if (critAfter === 0) {
        console.log("\n✅ PASS: No duplicate YouTube slots or campaign-hour collisions remain.");
      } else {
        console.log(`\n⚠️  ${critAfter} critical flag(s) remain — re-run audit to investigate.`);
      }
    } else {
      // --normalize or flags present without --execute
      console.log("\n## Normalization SQL (dry-run — no writes)\n");
      printPlan(plan);
      console.log("\nTo apply: npx tsx scripts/audit-phat-phap-video-calendar.ts --execute");
    }
  }

  if (!doExecute) {
    if (criticalFlags === 0) {
      console.log("\n✅ PASS: No duplicate YouTube slots or campaign-hour collisions.");
    } else {
      console.log(`\n❌ FAIL: ${criticalFlags} critical flag(s). Run --execute to fix.`);
      process.exit(1);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
