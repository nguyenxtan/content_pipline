/**
 * Migration: update auto_schedule_settings posting window
 * from 08:00–21:00 to 06:00–22:00 for all destinations.
 *
 * Does NOT call saveAutoScheduleSettingsAction (which would trigger rebalance).
 * Existing queued rows keep their current scheduled times (all 08:00–21:00,
 * which remain valid inside the new 06:00–22:00 window).
 *
 * Pass --dry-run to preview without writing.
 */

import { db } from "@/lib/db";
import { appConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const KEY = "auto_schedule_settings";
const DRY_RUN = process.argv.includes("--dry-run");

const OLD_START = "08:00";
const NEW_START = "06:00";
const OLD_END   = "21:00";
const NEW_END   = "22:00";

type DestRow = { enabled: boolean; channelId: number; windowStart: string; windowEnd: string; intervalMin: number; privacyStatus: string };
type Settings = { short?: DestRow; long?: DestRow; shortDestinations?: DestRow[]; longDestinations?: DestRow[]; quoteDestinations?: DestRow[] };

function patchDest(d: DestRow): { dest: DestRow; changed: boolean } {
  let changed = false;
  const dest = { ...d };
  if (dest.windowStart === OLD_START) { dest.windowStart = NEW_START; changed = true; }
  if (dest.windowEnd === OLD_END)     { dest.windowEnd = NEW_END;     changed = true; }
  return { dest, changed };
}

function patchSettings(settings: Settings): { patched: Settings; changes: string[] } {
  const changes: string[] = [];
  const patched: Settings = { ...settings };

  const patchAndLog = (label: string, d: DestRow): DestRow => {
    const { dest, changed } = patchDest(d);
    if (changed) changes.push(`  ${label}: ${d.windowStart}–${d.windowEnd} → ${dest.windowStart}–${dest.windowEnd}`);
    return dest;
  };

  if (settings.short)  patched.short  = patchAndLog("short (legacy)", settings.short);
  if (settings.long)   patched.long   = patchAndLog("long (legacy)", settings.long);
  patched.shortDestinations = (settings.shortDestinations ?? []).map((d, i) => patchAndLog(`shortDest[${i}] channelId=${d.channelId}`, d));
  patched.longDestinations  = (settings.longDestinations ?? []).map((d, i) => patchAndLog(`longDest[${i}] channelId=${d.channelId}`, d));
  patched.quoteDestinations = (settings.quoteDestinations ?? []).map((d, i) => patchAndLog(`quoteDest[${i}] channelId=${d.channelId}`, d));

  return { patched, changes };
}

async function main() {
  const row = await db.query.appConfig.findFirst({ where: eq(appConfig.key, KEY) });
  if (!row) {
    console.log(`No "${KEY}" row in app_config. Nothing to migrate.`);
    process.exit(0);
  }

  const current: Settings = JSON.parse(row.value);
  console.log("\n=== Current auto_schedule_settings ===");
  console.log(JSON.stringify(current, null, 2));

  const { patched, changes } = patchSettings(current);

  if (changes.length === 0) {
    console.log("\nNo windows to update (already up to date). Exiting.");
    process.exit(0);
  }

  console.log(`\n=== Changes (${changes.length}) ===`);
  for (const c of changes) console.log(c);

  console.log("\n=== Patched auto_schedule_settings ===");
  console.log(JSON.stringify(patched, null, 2));

  if (DRY_RUN) {
    console.log("\nDRY RUN — no DB writes performed.");
    process.exit(0);
  }

  await db.update(appConfig)
    .set({ value: JSON.stringify(patched), updatedAt: new Date() })
    .where(eq(appConfig.key, KEY));

  console.log(`\n✅ Updated "${KEY}" in app_config. ${changes.length} window(s) changed.`);
  console.log("Note: existing queued rows were NOT rebalanced. New rows will use 06:00–22:00.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
