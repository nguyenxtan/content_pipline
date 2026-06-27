/**
 * Probe script: find and detail duplicate upload_queue rows for Facebook.
 * Read-only. No mutations.
 */

import { db } from "@/lib/db";
import { uploadQueue, contentGenerations, socialChannels } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

const VN_TZ = "Asia/Ho_Chi_Minh";

function toVn(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(d as string));
}

async function main() {
  // Step 1: find all (contentId, channelId, platform, videoType) with 2+ rows
  const allRows = await db.query.uploadQueue.findMany({
    where: eq(uploadQueue.platform, "facebook"),
    columns: {
      id: true,
      contentId: true,
      channelId: true,
      platform: true,
      videoType: true,
      status: true,
      scheduledAt: true,
      uploadedAt: true,
      errorMessage: true,
      title: true,
    },
    orderBy: (t, { asc }) => [asc(t.contentId), asc(t.channelId), asc(t.scheduledAt)],
  });

  // Group by (contentId, channelId, platform, videoType)
  const groups = new Map<string, typeof allRows>();
  for (const row of allRows) {
    const key = `${row.contentId}|${row.channelId}|${row.platform}|${row.videoType}`;
    const g = groups.get(key) ?? [];
    g.push(row);
    groups.set(key, g);
  }

  const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length >= 2);
  console.log(`\n=== Facebook upload_queue duplicates ===`);
  console.log(`Total Facebook rows: ${allRows.length}`);
  console.log(`Duplicate groups (2+ rows same content+channel+platform+videoType): ${duplicateGroups.length}`);
  if (duplicateGroups.length === 0) {
    console.log("No duplicates found. Exiting.");
    process.exit(0);
  }

  // Step 2: enrich with content + channel details
  const dupContentIds = [...new Set(duplicateGroups.map(([, rows]) => rows[0].contentId))];
  const dupChannelIds = [...new Set(duplicateGroups.map(([, rows]) => rows[0].channelId))];

  const [contentRows, channelRows] = await Promise.all([
    db.query.contentGenerations.findMany({
      where: inArray(contentGenerations.id, dupContentIds),
      columns: { id: true, topic: true, nicheName: true, channelKey: true, videoStatus: true },
    }),
    db.query.socialChannels.findMany({
      where: inArray(socialChannels.id, dupChannelIds),
      columns: { id: true, name: true, platform: true, platformChannelId: true, isActive: true },
    }),
  ]);

  const contentById = new Map(contentRows.map((r) => [r.id, r]));
  const channelById = new Map(channelRows.map((r) => [r.id, r]));

  // Step 3: print full details for each duplicate group
  let pairIdx = 0;
  const statusCombinations: Record<string, number> = {};
  const timeDeltasMs: number[] = [];

  for (const [key, rows] of duplicateGroups) {
    pairIdx++;
    const content = contentById.get(rows[0].contentId);
    const channel = channelById.get(rows[0].channelId);

    console.log(`\n────────────────────────────────────────────────────────`);
    console.log(`Pair #${pairIdx}: ${content?.topic ?? rows[0].contentId}`);
    console.log(`  contentId : ${rows[0].contentId}`);
    console.log(`  nicheName : ${content?.nicheName ?? "?"}`);
    console.log(`  channelKey: ${content?.channelKey ?? "?"}`);
    console.log(`  channelId : ${rows[0].channelId} → ${channel?.name ?? "?"}`);
    console.log(`  platformChannelId: ${channel?.platformChannelId ?? "?"}`);
    console.log(`  videoType : ${rows[0].videoType}`);
    console.log(`  videoStatus: ${content?.videoStatus ?? "?"}`);

    const sortedByScheduled = [...rows].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );

    for (let i = 0; i < sortedByScheduled.length; i++) {
      const r = sortedByScheduled[i];
      console.log(`\n  Row[${i + 1}]:`);
      console.log(`    queueId    : ${r.id}`);
      console.log(`    status     : ${r.status}`);
      console.log(`    scheduledAt: ${toVn(r.scheduledAt)} (UTC: ${new Date(r.scheduledAt).toISOString()})`);
      console.log(`    uploadedAt : ${toVn(r.uploadedAt)}`);
      console.log(`    title      : ${r.title?.slice(0, 60) ?? "—"}`);
      console.log(`    error      : ${r.errorMessage?.slice(0, 80) ?? "—"}`);
    }

    if (sortedByScheduled.length === 2) {
      const deltaMs = new Date(sortedByScheduled[1].scheduledAt).getTime()
        - new Date(sortedByScheduled[0].scheduledAt).getTime();
      const deltaH = (deltaMs / 3_600_000).toFixed(2);
      console.log(`\n  ⏱ Schedule delta: ${deltaH}h between row[1] and row[2]`);
      timeDeltasMs.push(deltaMs);
      const statCombo = sortedByScheduled.map((r) => r.status).join("+");
      statusCombinations[statCombo] = (statusCombinations[statCombo] ?? 0) + 1;
    }
  }

  // Step 4: summary statistics
  console.log(`\n════════════════════════════════════════════════════════`);
  console.log(`SUMMARY`);
  console.log(`  Total duplicate groups : ${duplicateGroups.length}`);
  console.log(`  Status combinations    :`);
  for (const [combo, count] of Object.entries(statusCombinations)) {
    console.log(`    ${combo}: ${count} pairs`);
  }
  if (timeDeltasMs.length > 0) {
    const avgH = (timeDeltasMs.reduce((a, b) => a + b, 0) / timeDeltasMs.length / 3_600_000).toFixed(2);
    const minH = (Math.min(...timeDeltasMs) / 3_600_000).toFixed(2);
    const maxH = (Math.max(...timeDeltasMs) / 3_600_000).toFixed(2);
    const exactly1h = timeDeltasMs.filter((ms) => Math.abs(ms - 3_600_000) < 5 * 60_000).length;
    const exactly2h = timeDeltasMs.filter((ms) => Math.abs(ms - 7_200_000) < 5 * 60_000).length;
    console.log(`  Schedule deltas (rows apart):`);
    console.log(`    avg=${avgH}h  min=${minH}h  max=${maxH}h`);
    console.log(`    ≈1h apart: ${exactly1h}  ≈2h apart: ${exactly2h}`);
  }

  // Step 5: Check for cancelled row pattern — find if any contentId also has cancelled rows
  const allFbRowsForDupContents = await db.query.uploadQueue.findMany({
    where: eq(uploadQueue.platform, "facebook"),
    columns: { id: true, contentId: true, channelId: true, status: true, scheduledAt: true, videoType: true },
  });

  const cancelledByContent = new Map<string, number>();
  for (const r of allFbRowsForDupContents) {
    if (r.status === "cancelled") {
      const k = `${r.contentId}|${r.channelId}|${r.videoType}`;
      cancelledByContent.set(k, (cancelledByContent.get(k) ?? 0) + 1);
    }
  }

  const dupWithCancelled = duplicateGroups.filter(([key]) => cancelledByContent.has(key));
  console.log(`\n  Dup groups that ALSO have a cancelled row: ${dupWithCancelled.length}`);
  if (dupWithCancelled.length > 0) {
    for (const [key] of dupWithCancelled) {
      console.log(`    ${key} → ${cancelledByContent.get(key)} cancelled row(s)`);
    }
  }

  // Step 6: For each dup group, check if there's a published_videos match
  type PvRow = { content_id: string; platform: string };
  const publishedCheck = await db.execute(
    sql`SELECT content_id, platform FROM published_videos WHERE content_id = ANY(${dupContentIds}::text[]) AND platform = 'facebook'`
  );
  const pvRows = (publishedCheck as unknown as { rows: PvRow[] }).rows ?? [];
  console.log(`\n  published_videos matches for dup contentIds: ${pvRows.length}`);
  for (const row of pvRows) {
    console.log(`    contentId=${row.content_id} platform=${row.platform}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
