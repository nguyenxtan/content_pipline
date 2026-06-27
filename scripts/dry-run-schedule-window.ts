/**
 * Dry-run: compute mixer preview for buddhist_healing_workspace
 * to verify the new 06:00–22:00 window produces slots from 06:xx.
 * Read-only, no DB mutations.
 */
import { computeMixerPreview } from "@/lib/schedule-mixer";

const VN_TZ = "Asia/Ho_Chi_Minh";

function toVn(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TZ, dateStyle: "short", timeStyle: "short",
  }).format(d);
}

async function main() {
  // Start at tomorrow 06:00 VN
  const now = new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffset);
  const tomorrow = new Date(Date.UTC(
    vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + 1,
    6 - 7, 0, 0, // 06:00 VN = 23:00 UTC previous day
  ));

  console.log(`\nDry-run start: ${toVn(tomorrow)} (UTC: ${tomorrow.toISOString()})`);
  console.log("Workspace: buddhist_healing_workspace\n");

  const result = await computeMixerPreview({
    workspaceId: "buddhist_healing_workspace",
    startAtIso: tomorrow.toISOString(),
    intervalMin: 60,
    maxSlots: 6,
    mixMode: "alternate",
    platforms: ["youtube", "facebook"],
  });

  if (!result.ok) {
    console.log("Preview not ok:", result.message);
    process.exit(0);
  }

  console.log(`Slots preview (first 6):`);
  for (const slot of result.slots.slice(0, 6)) {
    const marker = slot.willCreate ? "✅ would create" : `⏭  skip (${slot.reason})`;
    console.log(`  ${slot.platform.padEnd(9)} ch=${slot.channelId} ${slot.scheduledAtVn.padEnd(22)} ${marker}`);
  }

  // Verify earliest proposed slot hour
  const creatable = result.slots.filter((s) => s.willCreate);
  const minHour = creatable.reduce((min, s) => {
    const vn = new Intl.DateTimeFormat("en-CA", { timeZone: VN_TZ, hour: "numeric", hour12: false }).format(new Date(s.scheduledAtUtc));
    return Math.min(min, +vn);
  }, 99);

  console.log(`\nEarliest creatable slot hour (VN): ${minHour}:00`);
  if (minHour >= 6 && minHour < 8) {
    console.log("✅ Confirmed: new slots CAN start before 08:00 (window is 06:00)");
  } else if (minHour >= 8) {
    console.log("ℹ️  First new slot lands at or after 08:00 (queue already fills the 06:xx–08:xx range)");
  }

  // Destination windows
  console.log(`\nDestination windows from workspace:`);
  for (const dest of result._dests) {
    console.log(`  ${dest.platform} ch=${dest.channelId} window=${dest.windowStart}–${dest.windowEnd}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
