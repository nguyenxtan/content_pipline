/**
 * One-shot: cancel the 2 HIGH blocker upload_queue rows from the 2026-06-08 pre-publish audit.
 * Verifies identity before mutating. Read-verify-mutate pattern.
 */

import { db } from "@/lib/db";
import { uploadQueue } from "@/lib/db/schema";
import { inArray, eq } from "drizzle-orm";

const TARGET_IDS = [
  "723d5781-51dd-4361-8690-3cde49c100df", // Nỗi sợ bị ruồng bỏ — ALREADY_PUBLISHED + TTS_TYPE_B_NH_PAIR
  "61c9a65b-2eec-40ac-bcd4-57809580728a", // Tìm kiếm sự thấu hiểu — ALREADY_PUBLISHED
];

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  // ── Step 1: read & verify rows ──────────────────────────────────────────
  const rows = await db.query.uploadQueue.findMany({
    where: inArray(uploadQueue.id, TARGET_IDS),
    columns: {
      id: true,
      contentId: true,
      channelId: true,
      platform: true,
      videoType: true,
      status: true,
      scheduledAt: true,
      errorMessage: true,
    },
  });

  console.log(`\n=== Pre-cancellation verification ===`);
  console.log(`Found ${rows.length} / ${TARGET_IDS.length} target rows\n`);

  for (const id of TARGET_IDS) {
    const row = rows.find((r) => r.id === id);
    if (!row) {
      console.error(`❌ ABORT: Row ${id} not found — cannot proceed.`);
      process.exit(1);
    }
    console.log(`Row: ${id.slice(0, 8)}`);
    console.log(`  platform   : ${row.platform}`);
    console.log(`  channelId  : ${row.channelId}`);
    console.log(`  status     : ${row.status}`);
    console.log(`  videoType  : ${row.videoType}`);
    console.log(`  scheduledAt: ${new Date(row.scheduledAt).toISOString()}`);
    console.log(`  errorMsg   : ${row.errorMessage ?? "—"}`);

    if (row.platform !== "facebook") {
      console.error(`❌ ABORT: Row ${id.slice(0, 8)} platform is ${row.platform}, not facebook.`);
      process.exit(1);
    }
    if (row.status !== "queued" && row.status !== "uploading") {
      console.error(`❌ ABORT: Row ${id.slice(0, 8)} status is "${row.status}", not queued/uploading. Nothing to cancel.`);
      process.exit(1);
    }
    // Tầng Sâu guard — channelId 7 is tang_sau; channelId 6 is Trí Tuệ An Nhiên
    if (row.channelId === 7) {
      console.error(`❌ ABORT: Row ${id.slice(0, 8)} is Tầng Sâu (channelId=7). Not touching.`);
      process.exit(1);
    }
    console.log(`  ✅ OK to cancel\n`);
  }

  if (DRY_RUN) {
    console.log("DRY RUN — no mutations performed.");
    process.exit(0);
  }

  // ── Step 2: count pending before ────────────────────────────────────────
  const pendingBefore = await db.query.uploadQueue.findMany({
    where: inArray(uploadQueue.status, ["queued", "uploading"]),
    columns: { id: true },
  });
  console.log(`Pending queue rows before: ${pendingBefore.length}`);

  // ── Step 3: cancel ───────────────────────────────────────────────────────
  for (const id of TARGET_IDS) {
    await db.update(uploadQueue)
      .set({
        status: "cancelled",
        errorMessage: "pre_publish_quality_audit_high_blocker",
      })
      .where(eq(uploadQueue.id, id));
    console.log(`✅ Cancelled: ${id}`);
  }

  // ── Step 4: verify post-cancellation ────────────────────────────────────
  const pendingAfter = await db.query.uploadQueue.findMany({
    where: inArray(uploadQueue.status, ["queued", "uploading"]),
    columns: { id: true },
  });
  console.log(`\nPending queue rows after : ${pendingAfter.length}`);
  console.log(`Delta: ${pendingBefore.length - pendingAfter.length} rows removed from active queue`);

  const cancelled = await db.query.uploadQueue.findMany({
    where: inArray(uploadQueue.id, TARGET_IDS),
    columns: { id: true, status: true, errorMessage: true },
  });
  console.log(`\nPost-cancellation state:`);
  for (const r of cancelled) {
    console.log(`  ${r.id.slice(0, 8)} → status=${r.status} error="${r.errorMessage}"`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
