import { findNextAvailablePublishSlot } from "@/lib/publishing/slot-occupancy";

// Pure regression check for the pauseQueuedUploadsForChannel fix in
// src/actions/social-channels.ts. Simulates the confirmed live collision (9 Facebook rows,
// mixed video_type='short'/'quote', all originally collapsed onto 2026-06-21T15:08:00.692Z)
// and asserts the new per-row, lane-aware slot assignment never repeats this bug.
// No DB access, no mutation — exercises the same exported slot helper the fix now uses.

type SimulatedRow = { id: string; videoType: "short" | "quote" };

const SIMULATED_COLLISION: SimulatedRow[] = [
  { id: "cbbc5bcc", videoType: "short" },
  { id: "c8759c83", videoType: "short" },
  { id: "c8759c83-quote", videoType: "quote" },
  { id: "059b8c0b", videoType: "short" },
  { id: "b21708da", videoType: "short" },
  { id: "b21708da-quote", videoType: "quote" },
  { id: "2c27448d", videoType: "short" },
  { id: "cbbc5bcc-quote", videoType: "quote" },
  { id: "2545789d-quote", videoType: "quote" },
];

const deferUntil = new Date("2026-06-21T09:08:00.000Z");

function assignSlots(rows: SimulatedRow[], notBefore: Date): Map<string, Date> {
  const takenByLane = new Map<string, number[]>();
  const assigned = new Map<string, Date>();

  for (const row of rows) {
    const taken = takenByLane.get(row.videoType) ?? [];
    const slotOffsetMinutes = row.videoType === "quote" ? 5 : 0;
    const nextSlot = findNextAvailablePublishSlot({
      windowStart: "06:00",
      windowEnd: "22:00",
      intervalMin: 60,
      taken,
      notBefore,
      slotOffsetMinutes,
    });
    if (!nextSlot) throw new Error(`No slot found for row ${row.id}`);
    taken.push(nextSlot.getTime());
    takenByLane.set(row.videoType, taken);
    assigned.set(row.id, nextSlot);
  }

  return assigned;
}

const failures: string[] = [];
const assigned = assignSlots(SIMULATED_COLLISION, deferUntil);

// 1. No two rows in the same lane share a scheduledAt.
const seenByLane = new Map<string, Set<number>>();
for (const row of SIMULATED_COLLISION) {
  const slot = assigned.get(row.id)!;
  const seen = seenByLane.get(row.videoType) ?? new Set<number>();
  if (seen.has(slot.getTime())) {
    failures.push(`Duplicate scheduledAt within lane "${row.videoType}": ${slot.toISOString()}`);
  }
  seen.add(slot.getTime());
  seenByLane.set(row.videoType, seen);
}

// 2. No milliseconds or seconds (canonical minute-grain timestamps only).
for (const row of SIMULATED_COLLISION) {
  const slot = assigned.get(row.id)!;
  if (slot.getUTCSeconds() !== 0 || slot.getUTCMilliseconds() !== 0) {
    failures.push(`Row ${row.id} has non-canonical seconds/ms: ${slot.toISOString()}`);
  }
}

// 3. Lane offset is respected: short -> :00, quote -> :05 (in VN time).
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
for (const row of SIMULATED_COLLISION) {
  const slot = assigned.get(row.id)!;
  const vn = new Date(slot.getTime() + VN_OFFSET_MS);
  const expectedMinute = row.videoType === "quote" ? 5 : 0;
  if (vn.getUTCMinutes() !== expectedMinute) {
    failures.push(`Row ${row.id} (${row.videoType}) landed on minute ${vn.getUTCMinutes()}, expected ${expectedMinute}`);
  }
}

// 4. No row was assigned a slot before notBefore (deferUntil).
for (const row of SIMULATED_COLLISION) {
  const slot = assigned.get(row.id)!;
  if (slot.getTime() < deferUntil.getTime()) {
    failures.push(`Row ${row.id} scheduled before deferUntil: ${slot.toISOString()} < ${deferUntil.toISOString()}`);
  }
}

console.log("## Facebook Deferral Regression Test");
console.log(`- Simulated rows: ${SIMULATED_COLLISION.length} (5 short, 4 quote — mirrors the confirmed live collision)`);
console.log(`- Failures: ${failures.length}`);
for (const row of SIMULATED_COLLISION) {
  console.log(`  ${row.id} (${row.videoType}) -> ${assigned.get(row.id)!.toISOString()}`);
}
for (const failure of failures) {
  console.log(`- FAIL: ${failure}`);
}

if (failures.length > 0) {
  process.exit(1);
}
