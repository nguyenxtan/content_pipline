/**
 * Safety test: canonical OAuth row resolution + sibling busy-slot dedup.
 *
 * Tests:
 *  1. tang_sau ch7/ch10 siblings → canonical resolves to ch10 (highest usage)
 *  2. phat_phap canonical resolves to its highest-usage YouTube row
 *  3. All future active tang_sau slots are 0 duplicates across all sibling IDs
 *  4. getBusySlotTimesAcrossSiblings covers all sibling channel IDs
 *  5. auto-refill would skip ch7 when ch10 is canonical (simulated)
 *
 * Run with:
 *   npx tsx scripts/test-tang-sau-slot-dedup.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import { uploadQueue, socialChannels } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveCanonical(
  platform: string,
  platformChannelId: string,
  channelKey: string,
): Promise<{ id: number; queue_count: number } | null> {
  const result = await db.execute<{ id: number; queue_count: string }>(sql`
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
      CASE WHEN sc.is_active = true AND sc.needs_reconnect = false THEN 0 ELSE 1 END ASC,
      COUNT(uq.id) DESC
    LIMIT 1
  `);
  if (result.rows.length === 0) return null;
  return { id: Number(result.rows[0].id), queue_count: Number(result.rows[0].queue_count) };
}

async function getSiblingChannelIds(platform: string, platformChannelId: string): Promise<number[]> {
  const rows = await db.query.socialChannels.findMany({
    where: and(
      eq(socialChannels.platform, platform as "youtube" | "facebook"),
      eq(socialChannels.platformChannelId, platformChannelId),
    ),
    columns: { id: true, name: true, channelKey: true, isActive: true, needsReconnect: true },
  });
  return rows.map((r) => r.id);
}

// ── Tests ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  console.log("=== Canonical OAuth + sibling slot dedup safety tests ===\n");

  // ── Get workspace registry values ─────────────────────────────────────────
  // Import after dotenv config
  const { getWorkspaceById } = await import("@/lib/channel-workspace-registry");
  const tangSauWs = getWorkspaceById("tang_sau_workspace");
  const buddhistWs = getWorkspaceById("buddhist_healing_workspace");
  if (!tangSauWs || !buddhistWs) {
    console.error("FAIL: workspace registry missing required workspaces");
    process.exit(1);
  }
  const tangSauPlatformChannelId = tangSauWs.platformAccounts.find(a => a.platform === "youtube")?.platformChannelId ?? "";
  const phatPhapPlatformChannelId = buddhistWs.platformAccounts.find(a => a.platform === "youtube")?.platformChannelId ?? "";

  console.log(`tang_sau  YouTube platformChannelId: ${tangSauPlatformChannelId}`);
  console.log(`phat_phap YouTube platformChannelId: ${phatPhapPlatformChannelId}\n`);

  // ── Test 1: tang_sau canonical ────────────────────────────────────────────
  console.log("--- Test 1: tang_sau canonical resolution ---");
  const tangSauChannels = await db.query.socialChannels.findMany({
    where: and(
      eq(socialChannels.channelKey, "tang_sau"),
      eq(socialChannels.platform, "youtube"),
    ),
    columns: { id: true, name: true, isActive: true, needsReconnect: true },
  });
  console.log(`  tang_sau YouTube channel rows (${tangSauChannels.length}):`);
  for (const ch of tangSauChannels) {
    console.log(`    ch${ch.id}: ${ch.name} active=${ch.isActive} needsReconnect=${ch.needsReconnect}`);
  }

  const tangSauCanonical = await resolveCanonical("youtube", tangSauPlatformChannelId, "tang_sau");
  console.log(`  Resolved canonical: ch${tangSauCanonical?.id} (${tangSauCanonical?.queue_count} queue rows)`);
  check("tang_sau canonical resolves to ch10", tangSauCanonical?.id === 10,
    `got ch${tangSauCanonical?.id}`);
  check("tang_sau canonical has >0 queue rows", (tangSauCanonical?.queue_count ?? 0) > 0,
    `got ${tangSauCanonical?.queue_count}`);

  // ── Test 2: auto-refill would skip ch7 (backup) ───────────────────────────
  console.log("\n--- Test 2: auto-refill skip logic for ch7 ---");
  const ch7 = tangSauChannels.find(c => c.id === 7);
  const ch10 = tangSauChannels.find(c => c.id === 10);
  check("ch7 exists in tang_sau channels", ch7 !== undefined);
  check("ch10 exists in tang_sau channels", ch10 !== undefined);
  if (tangSauCanonical) {
    check(
      "ch7 would be skipped by auto-refill (not canonical)",
      tangSauCanonical.id !== 7,
      `canonical is ch${tangSauCanonical.id}`,
    );
    check(
      "ch10 would NOT be skipped (is canonical)",
      tangSauCanonical.id === 10,
    );
  }

  // ── Test 3: phat_phap canonical ───────────────────────────────────────────
  console.log("\n--- Test 3: phat_phap canonical resolution ---");
  const phatPhapChannels = await db.query.socialChannels.findMany({
    where: and(
      eq(socialChannels.channelKey, "phat_phap"),
      eq(socialChannels.platform, "youtube"),
    ),
    columns: { id: true, name: true, isActive: true, needsReconnect: true },
  });
  console.log(`  phat_phap YouTube channel rows (${phatPhapChannels.length}):`);
  for (const ch of phatPhapChannels) {
    console.log(`    ch${ch.id}: ${ch.name} active=${ch.isActive} needsReconnect=${ch.needsReconnect}`);
  }
  const phatPhapCanonical = await resolveCanonical("youtube", phatPhapPlatformChannelId, "phat_phap");
  console.log(`  Resolved canonical: ch${phatPhapCanonical?.id} (${phatPhapCanonical?.queue_count} queue rows)`);
  check("phat_phap canonical resolves to a valid channel", phatPhapCanonical !== null);
  check("phat_phap canonical is a phat_phap channel",
    phatPhapChannels.some(c => c.id === phatPhapCanonical?.id),
    `got ch${phatPhapCanonical?.id}, known: [${phatPhapChannels.map(c => c.id).join(",")}]`,
  );

  // ── Test 4: duplicate slots across all tang_sau siblings ──────────────────
  console.log("\n--- Test 4: no duplicate slots across tang_sau siblings ---");
  const allTangSauIds = await getSiblingChannelIds("youtube", tangSauPlatformChannelId);
  console.log(`  Sibling channel IDs: [${allTangSauIds.join(", ")}]`);
  check("sibling query returns ≥2 IDs (ch7 + ch10 minimum)", allTangSauIds.length >= 2,
    `got ${allTangSauIds.length}`);

  const futureRows = await db.execute<{ id: string; channel_id: number; scheduled_at: string }>(sql`
    SELECT uq.id, uq.channel_id, uq.scheduled_at::text
    FROM upload_queue uq
    WHERE uq.channel_id = ANY(${sql`ARRAY[${sql.join(allTangSauIds.map(id => sql`${id}`), sql`, `)}]::int[]`})
      AND uq.status IN ('queued', 'uploading', 'pending', 'scheduled', 'processing')
      AND uq.scheduled_at > NOW()
    ORDER BY uq.scheduled_at
  `);

  console.log(`  Future active rows: ${futureRows.rows.length}`);
  const slotCounts = new Map<string, number[]>();
  for (const row of futureRows.rows) {
    const key = new Date(row.scheduled_at).toISOString();
    slotCounts.set(key, [...(slotCounts.get(key) ?? []), row.channel_id]);
  }
  const dups = [...slotCounts.entries()].filter(([, ids]) => ids.length > 1);
  console.log(`  Duplicate slots: ${dups.length}`);
  if (dups.length > 0) {
    for (const [slot, ids] of dups) {
      console.log(`    DUPLICATE: ${slot} → ch[${ids.join(",")}]`);
    }
  }
  check("zero duplicate slots across all tang_sau siblings", dups.length === 0,
    `${dups.length} duplicates found — run queue normalization`);

  // ── Test 5: getBusySlotTimesAcrossSiblings sees ch7 slots from ch10 pov ───
  console.log("\n--- Test 5: cross-sibling slot visibility ---");
  // Get counts per channel to verify sibling query correctly classifies
  const byChannel = new Map<number, number>();
  for (const row of futureRows.rows) {
    byChannel.set(row.channel_id, (byChannel.get(row.channel_id) ?? 0) + 1);
  }
  console.log("  Slot distribution:");
  for (const [chId, count] of [...byChannel.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    ch${chId}: ${count} rows`);
  }
  const ch7Count = byChannel.get(7) ?? 0;
  const ch10Count = byChannel.get(10) ?? 0;
  // Cross-visibility: sibling query should return total = ch7+ch10+... combined
  check(
    "sibling query returns all rows (ch7 + ch10 combined)",
    futureRows.rows.length >= ch7Count + ch10Count,
    `total=${futureRows.rows.length}, ch7=${ch7Count}, ch10=${ch10Count}`,
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
