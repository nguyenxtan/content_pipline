/**
 * Add missing YouTube queue entries for the 3 qgen legacy_quote_short items.
 *
 * These items were generated as music-backed MP4 Shorts but were only queued
 * to Facebook (video_type='quote'). Historically, legacy_quote_short content
 * was published to YouTube Giới Định Tuệ as video_type='short'.
 *
 * Safety:
 *  - Checks for existing YouTube entries before inserting (idempotent)
 *  - Does not touch existing Facebook entries
 *  - Does not touch any non-phat_phap rows
 *  - Uses video_type='short' for YouTube (bypasses the youtube+quote guard)
 *  - Slots: Jun 11 04:00, 05:00, 06:00 UTC (after current last YouTube slot Jun 11 03:00)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations, uploadQueue, socialChannels } from "@/lib/db/schema";
import { inArray, eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Targets ────────────────────────────────────────────────────────────────
const QGEN_IDS = [
  "qgen-mq529m74-gfgmk",
  "qgen-mq529sg9-mkvas",
  "qgen-mq529ylj-45p4k",
];

// YouTube slots after current last queued slot (Jun 11 03:00 UTC)
const YOUTUBE_SLOTS = [
  new Date("2026-06-11T04:00:00.000Z"),
  new Date("2026-06-11T05:00:00.000Z"),
  new Date("2026-06-11T06:00:00.000Z"),
];

const YOUTUBE_CHANNEL_ID = 1; // Giới Định Tuệ, youtube, channel_key=phat_phap

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Add YouTube queue entries for 3 qgen legacy_quote_short items");
  console.log("  Date:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");

  // ── 1. Confirm YouTube channel ─────────────────────────────────────────
  const ytChannel = await db.query.socialChannels.findFirst({
    where: eq(socialChannels.id, YOUTUBE_CHANNEL_ID),
    columns: { id: true, name: true, platform: true, channelKey: true, isActive: true },
  });
  if (!ytChannel) throw new Error("YouTube channel id=1 not found");
  if (ytChannel.platform !== "youtube") throw new Error(`Channel ${YOUTUBE_CHANNEL_ID} is not youtube`);
  if (ytChannel.channelKey !== "phat_phap") throw new Error(`Channel ${YOUTUBE_CHANNEL_ID} is not phat_phap`);
  console.log(`\n  YouTube channel: id=${ytChannel.id} name="${ytChannel.name}" platform=${ytChannel.platform} active=${ytChannel.isActive}`);

  // ── 2. Load content rows ───────────────────────────────────────────────
  const rows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, QGEN_IDS),
    columns: { id: true, topic: true, formatType: true, topicFamily: true, videoPath: true, channelKey: true },
  });
  console.log(`\n  Content rows found: ${rows.length}/${QGEN_IDS.length}`);
  for (const r of rows) {
    console.log(`  ${r.id.slice(0, 12)} | ${r.formatType} | ${r.topicFamily} | ${r.topic}`);
    if (r.formatType !== "legacy_quote_short") {
      throw new Error(`SAFETY: ${r.id} has unexpected format_type=${r.formatType}`);
    }
    if (r.channelKey !== "phat_phap") {
      throw new Error(`SAFETY: ${r.id} is not phat_phap`);
    }
  }

  // ── 3. Duplicate check ─────────────────────────────────────────────────
  const existingYt = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.contentId, QGEN_IDS),
      eq(uploadQueue.platform, "youtube"),
    ),
    columns: { id: true, contentId: true, platform: true, videoType: true, status: true, scheduledAt: true },
  });
  console.log(`\n  Existing YouTube entries for these IDs: ${existingYt.length}`);
  for (const e of existingYt) {
    console.log(`  ⚠  ${e.contentId} already has YouTube entry: id=${e.id} status=${e.status}`);
  }
  if (existingYt.length > 0) {
    console.log("  Skipping IDs that already have YouTube entries.");
  }
  const existingYtIds = new Set(existingYt.map(e => e.contentId));

  // ── 4. Confirm YouTube slot availability ───────────────────────────────
  const existingSlots = await db.query.uploadQueue.findMany({
    where: and(
      eq(uploadQueue.channelId, YOUTUBE_CHANNEL_ID),
    ),
    columns: { scheduledAt: true, status: true },
  });
  const occupiedSlots = new Set(
    existingSlots
      .filter(s => ["queued","pending","scheduled","processing"].includes(s.status))
      .map(s => new Date(s.scheduledAt).toISOString())
  );
  console.log("\n  Checking slot availability:");
  for (const slot of YOUTUBE_SLOTS) {
    const iso = slot.toISOString();
    console.log(`  ${iso}: ${occupiedSlots.has(iso) ? "⚠ OCCUPIED" : "✓ free"}`);
  }
  for (const slot of YOUTUBE_SLOTS) {
    if (occupiedSlots.has(slot.toISOString())) {
      throw new Error(`Slot ${slot.toISOString()} is already occupied — adjust slots before running`);
    }
  }

  // ── 5. Build and insert ────────────────────────────────────────────────
  console.log("\n── Inserting YouTube queue entries ──────────────────────────");
  const toInsert = QGEN_IDS
    .filter(id => !existingYtIds.has(id))
    .map((id, i) => {
      const row = rows.find(r => r.id === id);
      if (!row) throw new Error(`Content row not found: ${id}`);
      const topic = row.topic ?? id;
      return {
        id: randomUUID(),
        contentId: id,
        channelId: YOUTUBE_CHANNEL_ID,
        platform: "youtube" as const,
        videoType: "short" as const,
        title: `${topic} #Shorts`,
        description: `${topic}\n\n#phatphap #giaodinhtu #trinhanqua #shorts`,
        tags: [],
        privacyStatus: "public",
        scheduledAt: YOUTUBE_SLOTS[i],
        status: "queued" as const,
      };
    });

  if (toInsert.length === 0) {
    console.log("  Nothing to insert — all 3 already have YouTube entries.");
    return;
  }

  for (const row of toInsert) {
    const [inserted] = await db.insert(uploadQueue).values(row).returning({ id: uploadQueue.id });
    console.log(`  ✓ inserted id=${inserted.id}`);
    console.log(`    content_id=${row.contentId}`);
    console.log(`    platform=youtube  video_type=short  channel_id=${row.channelId}`);
    console.log(`    scheduled_at=${row.scheduledAt.toISOString()}`);
    console.log(`    title="${row.title}"`);
  }

  // ── 6. Post-check ──────────────────────────────────────────────────────
  console.log("\n── Post-check ────────────────────────────────────────────────");
  const allAfter = await db.query.uploadQueue.findMany({
    where: inArray(uploadQueue.contentId, QGEN_IDS),
    columns: { id: true, contentId: true, platform: true, videoType: true, status: true, scheduledAt: true },
    orderBy: (t, { asc }) => asc(t.scheduledAt),
  });

  for (const r of allAfter) {
    const icon = r.platform === "youtube" ? "🎬" : "📘";
    console.log(`  ${icon} ${r.contentId.slice(0,12)} | ${r.platform.padEnd(8)} | ${r.videoType.padEnd(5)} | ${r.status.padEnd(7)} | ${r.scheduledAt}`);
  }

  const ytAfter = allAfter.filter(r => r.platform === "youtube");
  console.log(`\n  YouTube entries after: ${ytAfter.length}/3`);

  // Safety: confirm no non-phat_phap rows inserted
  const verifyChannelKey = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, toInsert.map(r => r.contentId)),
    columns: { id: true, channelKey: true },
  });
  const nonPhatPhap = verifyChannelKey.filter(r => r.channelKey !== "phat_phap");
  console.log(`  Non-phat_phap rows affected: ${nonPhatPhap.length === 0 ? "✓ 0" : `✗ ${nonPhatPhap.length}`}`);

  // Queue backlog
  const backlogRows = await db.query.uploadQueue.findMany({
    where: (t, { inArray: ia }) => ia(t.status, ["queued","pending","scheduled","processing"]),
    columns: { id: true },
  });
  console.log(`  Total queue backlog (all channels): ${backlogRows.length}`);

  console.log("\n  ✓ Done.");
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
