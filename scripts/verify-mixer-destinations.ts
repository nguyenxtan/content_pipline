/**
 * Verify that Schedule Mixer routes destinations correctly per workspace.
 * Dry-run only — no upload_queue rows created.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/verify-mixer-destinations.ts
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

function ok(msg: string)   { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1; }
function info(msg: string) { console.log(`  ℹ  ${msg}`); }
function hr()              { console.log("\n" + "─".repeat(60)); }

async function main() {
  console.log("\n=== Schedule Mixer Destination Verification (DRY-RUN) ===\n");

  const { computeMixerPreview } = await import("@/lib/schedule-mixer");
  const { db } = await import("@/lib/db");

  const startAtIso = new Date(Date.now() + 2 * 60 * 60_000).toISOString(); // 2h from now

  // ── Test 1: tang_sau_workspace — YouTube only ─────────────────────────────
  hr();
  console.log("Test 1: tang_sau_workspace → YouTube only");

  const tsPreview = await computeMixerPreview({
    startAtIso,
    intervalMin: 180,
    maxSlots: 3,
    platforms: ["youtube"],
    mixMode: "alternate",
    workspaceId: "tang_sau_workspace",
  });

  info(`ok=${tsPreview.ok}, slots=${tsPreview.slots.length}`);
  if (tsPreview.workspaceDestinationWarning) {
    info(`Workspace warning: ${tsPreview.workspaceDestinationWarning}`);
  }

  const tsChannels = new Set(tsPreview.slots.map((s) => s.channelName));
  const tsPlatforms = new Set(tsPreview.slots.map((s) => s.platform));

  if ([...tsChannels].some((n) => n.toLowerCase().includes("giới định tuệ") || n.toLowerCase().includes("định tuệ"))) {
    fail(`tang_sau slot contains Giới Định Tuệ channel: ${[...tsChannels].join(", ")}`);
  } else {
    ok(`No Giới Định Tuệ channel in tang_sau slots`);
  }

  if ([...tsChannels].some((n) => /tầng sâu/i.test(n))) {
    ok(`tang_sau slots target Tầng Sâu channel ✓`);
  } else if (tsPreview.slots.length === 0) {
    info("No slots generated (no eligible content yet — expected for new channel)");
  } else {
    fail(`tang_sau slots do not target Tầng Sâu: ${[...tsChannels].join(", ")}`);
  }

  if (tsPlatforms.has("facebook")) {
    fail(`tang_sau has facebook destination but workspace has no facebook account`);
  } else {
    ok(`No Facebook rows for tang_sau_workspace ✓`);
  }

  for (const slot of tsPreview.slots.slice(0, 3)) {
    info(`  Slot → ${slot.platform} · ${slot.channelName} · ${slot.scheduledAtVn}`);
  }

  // ── Test 2: tang_sau_workspace — Facebook requested (should warn/block) ──
  hr();
  console.log("Test 2: tang_sau_workspace with Facebook requested → should block or warn");

  const tsFbPreview = await computeMixerPreview({
    startAtIso,
    intervalMin: 180,
    maxSlots: 2,
    platforms: ["facebook"],      // tang_sau has no Facebook
    mixMode: "alternate",
    workspaceId: "tang_sau_workspace",
  });

  info(`ok=${tsFbPreview.ok}, warning=${tsFbPreview.workspaceDestinationWarning ?? "none"}`);

  if (!tsFbPreview.ok && tsFbPreview.workspaceDestinationWarning?.includes("workspace_destination_missing")) {
    ok(`Correctly blocked: workspace_destination_missing for Facebook on tang_sau ✓`);
  } else if (tsFbPreview.slots.length === 0 && tsFbPreview.workspaceDestinationWarning) {
    ok(`Correctly warned and produced 0 slots ✓`);
  } else {
    fail(`Expected workspace_destination_missing warning but got ok=${tsFbPreview.ok}, slots=${tsFbPreview.slots.length}`);
  }

  // ── Test 3: buddhist_healing_workspace ─────────────────────────────────────
  hr();
  console.log("Test 3: buddhist_healing_workspace → YouTube + Facebook");

  const bhPreview = await computeMixerPreview({
    startAtIso,
    intervalMin: 120,
    maxSlots: 3,
    platforms: ["youtube", "facebook"],
    mixMode: "alternate",
    workspaceId: "buddhist_healing_workspace",
  });

  info(`ok=${bhPreview.ok}, slots=${bhPreview.slots.length}`);
  if (bhPreview.workspaceDestinationWarning) {
    info(`Workspace warning: ${bhPreview.workspaceDestinationWarning}`);
  }

  const bhChannels = new Set(bhPreview.slots.map((s) => s.channelName));
  if ([...bhChannels].some((n) => /tầng sâu/i.test(n))) {
    fail(`buddhist_healing slot contains Tầng Sâu channel: ${[...bhChannels].join(", ")}`);
  } else {
    ok(`No Tầng Sâu channel in buddhist_healing slots ✓`);
  }

  for (const slot of bhPreview.slots.slice(0, 3)) {
    info(`  Slot → ${slot.platform} · ${slot.channelName} · ${slot.scheduledAtVn}`);
  }

  // ── Test 4: no workspaceId — default behaviour ──────────────────────────
  hr();
  console.log("Test 4: no workspaceId → default publish config");

  const defaultPreview = await computeMixerPreview({
    startAtIso,
    intervalMin: 120,
    maxSlots: 2,
    platforms: ["youtube"],
    mixMode: "alternate",
  });

  info(`ok=${defaultPreview.ok}, slots=${defaultPreview.slots.length}`);
  if (defaultPreview.workspaceDestinationWarning) {
    fail(`No workspace selected but workspaceDestinationWarning was set`);
  } else {
    ok(`No spurious workspace warning for default mode ✓`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  hr();
  const passed = (process.exitCode ?? 0) === 0;
  console.log(`\n=== Kết quả: ${passed ? "OK" : "FAILED"} ===`);
  console.log("(Không có upload_queue row nào được tạo)\n");

  await db.$client.end().catch(() => {});
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exitCode = 1;
});
