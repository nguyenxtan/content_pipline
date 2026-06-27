/**
 * test-phat-phap-wait-for-yt-slot.ts
 *
 * Integration test for the WAIT_FOR_YT_SLOT hardening of phat_phap campaign scheduling.
 *
 * Tests three phases using a real phat_phap content_id and TEMPORARY queue rows
 * that are fully cleaned up after each phase.
 *
 * Phase 1 — no YT row exists:
 *   Call _phatPhapCampaignFbRow(id, ch6, "short")
 *   Expected: result="wait_for_yt_slot", NO FB row inserted.
 *
 * Phase 2 — YT row now exists (inserted temporarily):
 *   Insert a sentinel YT queue row at far-future slot (2030-01-01T12:00Z).
 *   Call _phatPhapCampaignFbRow(id, ch6, "short") → result="inserted", FB short at YT slot.
 *   Call _phatPhapCampaignFbRow(id, ch6, "quote") → result="inserted", FB quote at YT+5min.
 *   Verify slot alignment. Clean up 3 rows.
 *
 * Phase 3 — duplicate guard:
 *   Re-insert sentinel YT row, then call FB short again.
 *   Expected: result="skip_dup" (FB short already exists from Phase 2... actually cleaned up;
 *   so we re-insert YT and the FB short row, then call again).
 *   Clean up.
 *
 * Exit 0 = all assertions pass. Exit 1 = any failure.
 * No production queue rows are touched.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { uploadQueue, contentGenerations } from "@/lib/db/schema";
import { eq, and, inArray, notExists } from "drizzle-orm";
import { _phatPhapCampaignFbRow } from "@/actions/social-channels";

const CHANNEL_YT = 1;   // ch1 Giới Định Tuệ (YouTube)
const CHANNEL_FB = 6;   // ch6 Trí Tuệ An Nhiên (Facebook)
// Sentinel far-future slot so we never collide with real production rows.
const SENTINEL_YT_SLOT = new Date("2030-01-01T12:00:00.000Z");
const SENTINEL_FB_SLOT  = SENTINEL_YT_SLOT; // same for short
const SENTINEL_FB_QUOTE = new Date(SENTINEL_YT_SLOT.getTime() + 5 * 60_000); // +5 min

const VN_OFFSET = 7 * 3600_000;
const fmtVn = (d: Date) => new Date(d.getTime() + VN_OFFSET).toISOString().slice(0, 16) + " VN";

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  PASS ${msg}`);
  } else {
    console.error(`  FAIL ${msg}`);
    failures++;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function findTestContentId(): Promise<string> {
  // Find a phat_phap content with video done and NO existing upload_queue rows at
  // all for the FB channel (any status including cancelled) so the duplicate guard
  // never fires unexpectedly during the test.
  const rows = await db.query.contentGenerations.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.channelKey, "phat_phap"),
    columns: { id: true, videoStatus: true },
    limit: 500,
  });

  for (const row of rows) {
    if (row.videoStatus !== "done") continue;

    // Check for any FB queue rows (any status) for this content on ch6
    const fbRows = await db.select({ id: uploadQueue.id }).from(uploadQueue).where(
      and(
        eq(uploadQueue.contentId, row.id),
        eq(uploadQueue.channelId, CHANNEL_FB),
      )
    );
    if (fbRows.length > 0) continue;

    // Also check no active YT rows (queued/uploading) — we insert our own sentinel
    const ytRows = await db.select({ id: uploadQueue.id }).from(uploadQueue).where(
      and(
        eq(uploadQueue.contentId, row.id),
        inArray(uploadQueue.status, ["queued", "uploading"]),
      )
    );
    if (ytRows.length > 0) continue;

    return row.id;
  }
  throw new Error("No suitable phat_phap test content found (need done + zero FB queue rows)");
}

async function insertSentinelYtRow(contentId: string): Promise<string> {
  const result = await db.insert(uploadQueue).values({
    contentId,
    channelId: CHANNEL_YT,
    platform: "youtube",
    videoType: "short",
    title: "[TEST SENTINEL — will be deleted]",
    description: "",
    tags: [],
    privacyStatus: "unlisted",
    scheduledAt: SENTINEL_YT_SLOT,
    status: "queued",
  }).returning({ id: uploadQueue.id });
  return result[0].id;
}

async function countQueuedFbRows(contentId: string, videoType: "short" | "quote"): Promise<number> {
  const rows = await db.select({ id: uploadQueue.id }).from(uploadQueue).where(
    and(
      eq(uploadQueue.contentId, contentId),
      eq(uploadQueue.channelId, CHANNEL_FB),
      eq(uploadQueue.videoType, videoType),
      inArray(uploadQueue.status, ["queued", "uploading"]),
    )
  );
  return rows.length;
}

async function getFbRow(contentId: string, videoType: "short" | "quote") {
  return db.query.uploadQueue.findFirst({
    where: and(
      eq(uploadQueue.contentId, contentId),
      eq(uploadQueue.channelId, CHANNEL_FB),
      eq(uploadQueue.videoType, videoType),
      inArray(uploadQueue.status, ["queued", "uploading"]),
    ),
    columns: { id: true, scheduledAt: true },
  });
}

async function deleteRows(ids: string[]) {
  if (ids.length === 0) return;
  for (const id of ids) {
    await db.delete(uploadQueue).where(eq(uploadQueue.id, id));
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const contentId = await findTestContentId();
  console.log(`\nTest content_id: ${contentId.slice(0, 8)}…\n`);

  // ─── PHASE 1: no YT row — expect WAIT_FOR_YT_SLOT ────────────────────────
  console.log("═══ PHASE 1: no YT short row → WAIT_FOR_YT_SLOT ═══");

  const fbCountBefore1 = await countQueuedFbRows(contentId, "short");
  assert(fbCountBefore1 === 0, "precondition: no queued FB short row exists");

  const result1 = await _phatPhapCampaignFbRow(contentId, CHANNEL_FB, "short");
  assert(result1 === "wait_for_yt_slot", `result="wait_for_yt_slot" (got "${result1}")`);

  const fbCountAfter1 = await countQueuedFbRows(contentId, "short");
  assert(fbCountAfter1 === 0, "no FB row was inserted");

  // Same for quote type
  const resultQ1 = await _phatPhapCampaignFbRow(contentId, CHANNEL_FB, "quote");
  assert(resultQ1 === "wait_for_yt_slot", `quote result="wait_for_yt_slot" (got "${resultQ1}")`);
  const fbQuoteCountAfter1 = await countQueuedFbRows(contentId, "quote");
  assert(fbQuoteCountAfter1 === 0, "no FB quote row was inserted");

  // ─── PHASE 2: YT row now exists → INSERT at campaign slot ─────────────────
  console.log("\n═══ PHASE 2: YT short row exists → INSERT at campaign slot ═══");

  const ytRowId = await insertSentinelYtRow(contentId);
  console.log(`  Inserted sentinel YT row id=${ytRowId.slice(0, 8)}… scheduledAt=${fmtVn(SENTINEL_YT_SLOT)}`);

  // FB short
  const result2s = await _phatPhapCampaignFbRow(contentId, CHANNEL_FB, "short");
  assert(result2s === "inserted", `FB short result="inserted" (got "${result2s}")`);

  const fbShortRow = await getFbRow(contentId, "short");
  assert(fbShortRow !== undefined, "FB short row exists in DB");
  if (fbShortRow) {
    const drift = new Date(fbShortRow.scheduledAt).getTime() - SENTINEL_YT_SLOT.getTime();
    assert(drift === 0, `FB short scheduledAt == YT slot (drift=${drift}ms) at ${fmtVn(new Date(fbShortRow.scheduledAt))}`);
  }

  // FB quote
  const result2q = await _phatPhapCampaignFbRow(contentId, CHANNEL_FB, "quote");
  assert(result2q === "inserted", `FB quote result="inserted" (got "${result2q}")`);

  const fbQuoteRow = await getFbRow(contentId, "quote");
  assert(fbQuoteRow !== undefined, "FB quote row exists in DB");
  if (fbQuoteRow) {
    const drift = new Date(fbQuoteRow.scheduledAt).getTime() - SENTINEL_YT_SLOT.getTime();
    const expectedDrift = 5 * 60_000;
    assert(
      drift === expectedDrift,
      `FB quote scheduledAt == YT+5min (drift=${drift}ms, expected=${expectedDrift}ms) at ${fmtVn(new Date(fbQuoteRow.scheduledAt))}`,
    );
  }

  // ─── PHASE 3: duplicate guard — second call returns skip_dup ──────────────
  console.log("\n═══ PHASE 3: FB row already exists → skip_dup ═══");

  const result3s = await _phatPhapCampaignFbRow(contentId, CHANNEL_FB, "short");
  assert(result3s === "skip_dup", `FB short second call result="skip_dup" (got "${result3s}")`);

  const fbShortCount3 = await countQueuedFbRows(contentId, "short");
  assert(fbShortCount3 === 1, `still exactly 1 FB short row (got ${fbShortCount3})`);

  const result3q = await _phatPhapCampaignFbRow(contentId, CHANNEL_FB, "quote");
  assert(result3q === "skip_dup", `FB quote second call result="skip_dup" (got "${result3q}")`);

  const fbQuoteCount3 = await countQueuedFbRows(contentId, "quote");
  assert(fbQuoteCount3 === 1, `still exactly 1 FB quote row (got ${fbQuoteCount3})`);

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  const cleanupIds = [
    ytRowId,
    fbShortRow?.id,
    fbQuoteRow?.id,
  ].filter(Boolean) as string[];
  await deleteRows(cleanupIds);
  console.log(`\n  Cleaned up ${cleanupIds.length} sentinel row(s).`);

  // Verify no sentinel rows remain
  const remaining = await db.select({ id: uploadQueue.id }).from(uploadQueue).where(
    and(
      eq(uploadQueue.contentId, contentId),
      inArray(uploadQueue.status, ["queued", "uploading"]),
    )
  );
  assert(remaining.length === 0, "all sentinel rows removed — no production impact");

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  if (failures === 0) {
    console.log("✅ ALL TESTS PASSED");
  } else {
    console.error(`❌ ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("Test script error:", err);
  process.exit(1);
});
