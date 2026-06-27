import { pickFullLaneSafeAnchor, type PhatPhapCampaignLaneOccupancy } from "@/lib/publishing/slot-occupancy";

// Pure regression check for the cooldown-deferral sync fix in
// src/actions/social-channels.ts (findFullLaneSafePhatPhapAnchor / syncQueuedPhatPhapCampaignRows).
// No DB access, no mutation — exercises the exact pure picker the production code now
// delegates to, with fabricated taken-slot data standing in for "another content item
// already occupies this lane."
//
// All timestamps are computed relative to Date.now() (several days out) rather than fixed
// calendar literals, so the test is deterministic regardless of which real-world date it
// runs on (pickFullLaneSafeAnchor's own notBefore-vs-Date.now() floor logic otherwise makes
// fixed-date fixtures fragile).

const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Anchor everything 5 days in the future, at a fixed VN hour (08:00), so it is always
// comfortably after both "now" and "notBefore" regardless of when this test runs.
function futureVnHourUtcMs(daysFromNow: number, vnHour: number, vnMinute = 0): number {
  const future = new Date(Date.now() + daysFromNow * DAY_MS);
  const futureVn = new Date(future.getTime() + VN_OFFSET_MS);
  const vnMidnight = Date.UTC(futureVn.getUTCFullYear(), futureVn.getUTCMonth(), futureVn.getUTCDate(), 0, 0, 0, 0);
  return vnMidnight + (vnHour * 60 + vnMinute) * 60_000 - VN_OFFSET_MS;
}

const OCCUPIED_ANCHOR = futureVnHourUtcMs(5, 8, 0); // 08:00 VN, 5 days out
const OCCUPIED_QUOTE_SLOT = OCCUPIED_ANCHOR + 5 * 60_000;
const notBefore = new Date(futureVnHourUtcMs(5, 1, 0)); // 01:00 VN same day — well before 08:00

// Scenario 1: a content item needs YouTube short + Facebook short + Facebook quote
// sidecar. YouTube short and Facebook quote sidecar are both occupied by a different
// content item at 08:00/08:05 VN — exactly the confirmed live bug (f1897108/387c1575),
// where the triggering lane alone being free was incorrectly treated as sufficient.
const lanes: PhatPhapCampaignLaneOccupancy[] = [
  { videoType: "short", takenMs: [OCCUPIED_ANCHOR] }, // YouTube short lane — occupied at 08:00
  { videoType: "short", takenMs: [] }, // Facebook short lane — free everywhere
  { videoType: "quote", takenMs: [OCCUPIED_QUOTE_SLOT] }, // Facebook quote sidecar — occupied at 08:05
];

const result = pickFullLaneSafeAnchor({
  notBefore,
  windowStart: "06:00",
  windowEnd: "22:00",
  intervalMin: 60,
  lanes,
});

console.log("## phat_phap Cooldown Sync Regression Test");
console.log(`- Occupied anchor under test: ${new Date(OCCUPIED_ANCHOR).toISOString()} (YouTube short + Facebook quote sidecar both taken by another content)`);
console.log(`- Picked anchor: ${result.anchor?.toISOString() ?? "(none)"}`);

assert(result.anchor !== null, "Expected a valid anchor to be found (a later hour should be fully free)");

if (result.anchor) {
  // 1. The picked anchor must NOT be the occupied one — the triggering lane being free
  //    elsewhere is not enough; it must skip past the occupied slot entirely.
  assert(
    result.anchor.getTime() !== OCCUPIED_ANCHOR,
    `Picker returned the occupied anchor (${result.anchor.toISOString()}) — the triggering lane alone being free was incorrectly treated as sufficient`,
  );

  // 2. Canonical grid: zero seconds/milliseconds, minute aligned to :00 for short lanes.
  assert(result.anchor.getUTCSeconds() === 0 && result.anchor.getUTCMilliseconds() === 0, "Anchor has non-canonical seconds/ms");
  const vnMinute = new Date(result.anchor.getTime() + VN_OFFSET_MS).getUTCMinutes();
  assert(vnMinute === 0, `Anchor minute is ${vnMinute}, expected :00 for the short lane`);

  // 3. Derive the quote sidecar slot (+5min) and confirm it is also collision-free and canonical.
  const quoteSlot = new Date(result.anchor.getTime() + 5 * 60_000);
  assert(quoteSlot.getTime() !== OCCUPIED_QUOTE_SLOT, "Derived quote slot collides with the occupied quote slot");
  const quoteVnMinute = new Date(quoteSlot.getTime() + VN_OFFSET_MS).getUTCMinutes();
  assert(quoteVnMinute === 5, `Quote slot minute is ${quoteVnMinute}, expected :05`);

  // 4. All resulting per-lane slots must be mutually unique (short != quote).
  assert(result.anchor.getTime() !== quoteSlot.getTime(), "Short anchor and quote slot resolved to the same timestamp");
}

// Scenario 2: the only allowed hour-of-day (a single-instant window) is occupied for
// every day in the 14-day search horizon — picker must report blocked rather than guess.
const blockedNotBefore = new Date(futureVnHourUtcMs(10, 1, 0));
const blockedOccupied = Array.from({ length: 16 }, (_, day) => futureVnHourUtcMs(10 + day, 8, 0));
const blockedResult = pickFullLaneSafeAnchor({
  notBefore: blockedNotBefore,
  windowStart: "08:00",
  windowEnd: "08:00",
  intervalMin: 60,
  lanes: [{ videoType: "short", takenMs: blockedOccupied }],
});
assert(blockedResult.anchor === null, "Expected blocked result (no anchor) when every candidate in the horizon is occupied");
assert(blockedResult.reason !== null, "Expected a reason string when blocked");

console.log(`- Blocked-scenario result: anchor=${blockedResult.anchor}, reason=${blockedResult.reason}`);
console.log(`- Failures: ${failures.length}`);
for (const failure of failures) {
  console.log(`- FAIL: ${failure}`);
}

if (failures.length > 0) {
  process.exit(1);
}
