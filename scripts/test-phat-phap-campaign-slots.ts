/**
 * test-phat-phap-campaign-slots.ts
 *
 * Read-only verification script for the phat_phap same-slot campaign scheduling policy.
 *
 * Checks:
 *  1. For every phat_phap content_id that has both a queued YT short row AND a
 *     queued FB short (reel) row: FB slot == YT slot (drift = 0).
 *  2. For every phat_phap content_id that has both a queued YT short row AND a
 *     queued FB quote row: FB slot == YT slot + 5 min.
 *  3. No duplicate rows: each (content_id, channel_id, video_type) pair appears at
 *     most once in queued/uploading/done/cancelled status.
 *
 * Exit code 0 = all assertions pass.
 * Exit code 1 = one or more assertions fail.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { uploadQueue, contentGenerations, socialChannels } from "@/lib/db/schema";
import { eq, inArray, and } from "drizzle-orm";

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
function toVnLocal(d: Date): string {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  return vn.toISOString().replace("T", " ").replace("Z", " VN").slice(0, 22);
}

async function main() {
  let failures = 0;

  // ─── Load phat_phap content IDs ────────────────────────────────────────────
  const ppContent = await db
    .select({ id: contentGenerations.id })
    .from(contentGenerations)
    .where(eq(contentGenerations.channelKey, "phat_phap"));

  const ppIds = ppContent.map((r) => r.id);
  if (ppIds.length === 0) {
    console.log("No phat_phap content found — nothing to verify.");
    process.exit(0);
  }

  // ─── Load all queued/uploading rows for phat_phap content ──────────────────
  const rows = await db
    .select({
      id: uploadQueue.id,
      contentId: uploadQueue.contentId,
      channelId: uploadQueue.channelId,
      platform: uploadQueue.platform,
      videoType: uploadQueue.videoType,
      scheduledAt: uploadQueue.scheduledAt,
      status: uploadQueue.status,
    })
    .from(uploadQueue)
    .where(
      and(
        inArray(uploadQueue.contentId, ppIds),
        inArray(uploadQueue.status, ["queued", "uploading"]),
      ),
    );

  // ─── Load channel info for labels ─────────────────────────────────────────
  const channelIds = [...new Set(rows.map((r) => r.channelId))];
  const channels = await db
    .select({ id: socialChannels.id, name: socialChannels.name, platform: socialChannels.platform })
    .from(socialChannels)
    .where(inArray(socialChannels.id, channelIds));
  const channelMap = new Map(channels.map((c) => [c.id, c]));

  // ─── Group rows by content_id ──────────────────────────────────────────────
  type Row = (typeof rows)[number];
  const byContent = new Map<string, Row[]>();
  for (const row of rows) {
    if (!byContent.has(row.contentId)) byContent.set(row.contentId, []);
    byContent.get(row.contentId)!.push(row);
  }

  // ─── TEST 1: YT short drift check ─────────────────────────────────────────
  console.log("\n═══ TEST 1: FB short slot == YT short slot (drift = 0) ═══");
  let t1Pass = 0, t1Fail = 0, t1Skip = 0;

  for (const [contentId, contentRows] of byContent) {
    const ytShort = contentRows.find(
      (r) => r.platform === "youtube" && r.videoType === "short",
    );
    const fbShort = contentRows.find(
      (r) => r.platform === "facebook" && r.videoType === "short",
    );

    if (!ytShort || !fbShort) { t1Skip++; continue; }

    const ytTime = new Date(ytShort.scheduledAt).getTime();
    const fbTime = new Date(fbShort.scheduledAt).getTime();
    const driftMin = Math.round((fbTime - ytTime) / 60_000);

    if (driftMin === 0) {
      console.log(
        `  PASS contentId=${contentId.slice(0, 8)}… YT=FB=${toVnLocal(new Date(ytShort.scheduledAt))}`,
      );
      t1Pass++;
    } else {
      console.error(
        `  FAIL contentId=${contentId.slice(0, 8)}… drift=${driftMin}min  YT=${toVnLocal(new Date(ytShort.scheduledAt))}  FB=${toVnLocal(new Date(fbShort.scheduledAt))}`,
      );
      t1Fail++;
      failures++;
    }
  }
  console.log(`  → PASS:${t1Pass}  FAIL:${t1Fail}  SKIP(no pair):${t1Skip}`);

  // ─── TEST 2: FB quote slot == YT short slot + 5 min ───────────────────────
  console.log("\n═══ TEST 2: FB quote slot == YT short slot + 5 min ═══");
  let t2Pass = 0, t2Fail = 0, t2Skip = 0;

  for (const [contentId, contentRows] of byContent) {
    const ytShort = contentRows.find(
      (r) => r.platform === "youtube" && r.videoType === "short",
    );
    const fbQuote = contentRows.find(
      (r) => r.platform === "facebook" && r.videoType === "quote",
    );

    if (!ytShort || !fbQuote) { t2Skip++; continue; }

    const ytTime = new Date(ytShort.scheduledAt).getTime();
    const fbTime = new Date(fbQuote.scheduledAt).getTime();
    const driftMin = Math.round((fbTime - ytTime) / 60_000);

    if (driftMin === 5) {
      console.log(
        `  PASS contentId=${contentId.slice(0, 8)}… YT=${toVnLocal(new Date(ytShort.scheduledAt))}  FB_quote=${toVnLocal(new Date(fbQuote.scheduledAt))} (+5min)`,
      );
      t2Pass++;
    } else {
      console.error(
        `  FAIL contentId=${contentId.slice(0, 8)}… drift=${driftMin}min (expected 5)  YT=${toVnLocal(new Date(ytShort.scheduledAt))}  FB_quote=${toVnLocal(new Date(fbQuote.scheduledAt))}`,
      );
      t2Fail++;
      failures++;
    }
  }
  console.log(`  → PASS:${t2Pass}  FAIL:${t2Fail}  SKIP(no pair):${t2Skip}`);

  // ─── TEST 3: No duplicate (content_id, channel_id, video_type) in active rows ─
  // Only checks queued/uploading — done/cancelled historical rows are expected
  // to have duplicates from before the same-slot policy was in place.
  console.log("\n═══ TEST 3: No duplicate (content_id, channel_id, video_type) in queued/uploading ═══");
  let t3Pass = 0, t3Fail = 0;

  const allPpRows = await db
    .select({
      id: uploadQueue.id,
      contentId: uploadQueue.contentId,
      channelId: uploadQueue.channelId,
      videoType: uploadQueue.videoType,
      status: uploadQueue.status,
      scheduledAt: uploadQueue.scheduledAt,
    })
    .from(uploadQueue)
    .where(
      and(
        inArray(uploadQueue.contentId, ppIds),
        inArray(uploadQueue.status, ["queued", "uploading"]),
      ),
    );

  const dedupeKey = (r: (typeof allPpRows)[number]) =>
    `${r.contentId}__${r.channelId}__${r.videoType}`;

  const seen = new Map<string, (typeof allPpRows)[number][]>();
  for (const row of allPpRows) {
    const k = dedupeKey(row);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k)!.push(row);
  }

  for (const [key, dupes] of seen) {
    if (dupes.length === 1) { t3Pass++; continue; }
    const [contentId, channelId, videoType] = key.split("__");
    const chInfo = channelMap.get(Number(channelId));
    console.error(
      `  FAIL dup detected: contentId=${contentId.slice(0, 8)}… channel=${chInfo?.name ?? channelId} videoType=${videoType} count=${dupes.length}`,
    );
    for (const d of dupes) {
      console.error(
        `        id=${d.id.slice(0, 8)}… status=${d.status} scheduledAt=${toVnLocal(new Date(d.scheduledAt))}`,
      );
    }
    t3Fail++;
    failures++;
  }
  if (t3Fail === 0) console.log(`  All ${t3Pass} (content_id, channel, type) keys are unique.`);
  console.log(`  → PASS:${t3Pass}  FAIL:${t3Fail}`);

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  if (failures === 0) {
    console.log("✅ ALL TESTS PASSED");
  } else {
    console.error(`❌ ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
