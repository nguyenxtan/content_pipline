/**
 * Renders the 7 pending phat_phap TTS items from the sprint batch test.
 * Calls runTTS → runImages → runShortVideo directly (bypasses backpressure gate).
 * Also queues quote items via autoScheduleVideoAction.
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs \
 *     --tsconfig tsconfig.json scripts/render-pending-tts.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";
import { inArray, and } from "drizzle-orm";
import { runTTS } from "@/lib/pipeline/tts";
import { runImages } from "@/lib/pipeline/images";
import { runShortVideo } from "@/lib/pipeline/short-video";
import { autoScheduleVideoAction } from "@/actions/social-channels";
import { getStrategicFamilyCoverageAction } from "@/actions/publishing-analytics";
import { STRATEGIC_FAMILY_DISPLAY, type StrategicTopicFamilyId } from "@/lib/config/topic-family-registry";

const TTS_IDS = [
  "8c0da12f-08b0-4009-bd55-80ae3b871e21",
  "9839af14-c1ed-4af4-9c2a-3d1adfabc210",
  "1fcd2512-83e1-480c-8b6b-eb282c7e76de",
  "fe2b62e4-9871-40c4-a7f2-9aa411530dd9",
  "b9757a63-ebbf-4ecc-a4e6-6ad516b80df2",
  "8d9eb929-4730-487a-bbd0-1c0f1d9ac744",
  "957b26f5-990e-489d-adff-fd7964fae7be",
];

const QUOTE_IDS = [
  "qgen-mq529m74-gfgmk",
  "qgen-mq529sg9-mkvas",
  "qgen-mq529ylj-45p4k",
];

function fmt(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── Render one TTS item: TTS → images → video → schedule ─────────────────

async function renderItem(id: string): Promise<{ ok: boolean; step?: string; error?: string; scheduled?: boolean }> {
  const short8 = id.slice(0, 8);

  // Check current state — skip already done
  const item = await db.query.contentGenerations.findFirst({
    where: (t, { eq }) => eq(t.id, id),
    columns: { id: true, videoStatus: true, ttsStatus: true, imagesStatus: true, topicFamily: true },
  });
  if (!item) return { ok: false, step: "lookup", error: "Not found" };
  if (item.videoStatus === "done") {
    console.log(`  ↩  ${short8} already done — skipping render`);
    return { ok: true };
  }

  // Step 1: TTS
  const t1 = Date.now();
  process.stdout.write(`  [${short8}] TTS… `);
  const ttsResult = await runTTS(id, "short", null);
  if (!ttsResult.success) {
    console.log(`✗ ${ttsResult.error}`);
    return { ok: false, step: "tts", error: ttsResult.error };
  }
  process.stdout.write(`✓ ${fmt(Date.now() - t1)}  `);

  // Step 2: Images
  const t2 = Date.now();
  process.stdout.write(`Images… `);
  const imgResult = await runImages(id, null, null);
  if (!imgResult.success) {
    console.log(`✗ ${imgResult.error}`);
    return { ok: false, step: "images", error: imgResult.error };
  }
  process.stdout.write(`✓ ${fmt(Date.now() - t2)}  `);

  // Step 3: Video
  const t3 = Date.now();
  process.stdout.write(`Video… `);
  const vidResult = await runShortVideo(id);
  if (!vidResult.success) {
    console.log(`✗ ${vidResult.error}`);
    return { ok: false, step: "video", error: vidResult.error };
  }
  process.stdout.write(`✓ ${fmt(Date.now() - t3)}  `);

  // Step 4: Schedule
  const t4 = Date.now();
  process.stdout.write(`Schedule… `);
  await autoScheduleVideoAction(id, "short");
  console.log(`✓ ${fmt(Date.now() - t4)}`);

  return { ok: true, scheduled: true };
}

// ── Verify final state ────────────────────────────────────────────────────

async function verifyFinalState() {
  console.log("\n── Final render status ─────────────────────────────────────");

  const rows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, TTS_IDS),
    columns: {
      id: true,
      topic: true,
      topicFamily: true,
      formatType: true,
      ttsStatus: true,
      imagesStatus: true,
      videoStatus: true,
      videoPath: true,
    },
    orderBy: (t, { asc: a }) => a(t.createdAt),
  });

  for (const r of rows) {
    const ok = r.videoStatus === "done";
    const icon = ok ? "✓" : r.videoStatus === "error" ? "✗" : "⏳";
    const family = STRATEGIC_FAMILY_DISPLAY[r.topicFamily as StrategicTopicFamilyId] ?? r.topicFamily ?? "—";
    console.log(`  ${icon} ${r.id.slice(0, 8)} | tts=${r.ttsStatus?.padEnd(7)} img=${r.imagesStatus?.padEnd(7)} vid=${r.videoStatus?.padEnd(7)} | family="${family}"`);
    if (r.videoPath) console.log(`        videoPath: ${r.videoPath}`);
  }

  const rendered = rows.filter((r) => r.videoStatus === "done").length;
  const errors = rows.filter((r) => r.videoStatus === "error" || r.ttsStatus === "error").length;
  const familyOk = rows.every((r) => r.topicFamily != null);
  return { rendered, errors, total: rows.length, familyOk };
}

// ── Check upload_queue ────────────────────────────────────────────────────

async function checkUploadQueue(ids: string[], label: string) {
  console.log(`\n── Upload queue: ${label} ────────────────────────────`);

  const queueRows = await db.query.uploadQueue.findMany({
    where: and(
      inArray(uploadQueue.contentId, ids),
      inArray(uploadQueue.status, ["queued", "uploading", "done", "pending"]),
    ),
    columns: {
      id: true,
      contentId: true,
      videoType: true,
      status: true,
      scheduledAt: true,
      uploadedAt: true,
      platformVideoId: true,
    },
    orderBy: (t, { asc: a }) => a(t.scheduledAt),
  });

  if (queueRows.length === 0) {
    console.log("  No entries in upload_queue for these IDs.");
    return;
  }

  for (const q of queueRows) {
    const published = q.platformVideoId ? `  platformVideoId=${q.platformVideoId}` : "";
    const scheduledStr = q.scheduledAt ? new Date(q.scheduledAt).toISOString().replace("T", " ").slice(0, 16) : "—";
    console.log(`  contentId=${q.contentId.slice(0, 8)} | videoType=${q.videoType?.padEnd(6)} | status=${q.status?.padEnd(10)} | scheduled=${scheduledStr}${published}`);
  }

  const queued = queueRows.filter((q) => q.status === "queued").length;
  const done = queueRows.filter((q) => q.status === "done").length;
  console.log(`\n  Queued: ${queued}  Done/published: ${done}  Total queue entries: ${queueRows.length}`);
}

// ── Queue quote items ─────────────────────────────────────────────────────

async function queueQuoteItems() {
  console.log("\n── Queueing quote/photo items ───────────────────────────────");

  for (const id of QUOTE_IDS) {
    const row = await db.query.contentGenerations.findFirst({
      where: (t, { eq }) => eq(t.id, id),
      columns: { id: true, videoStatus: true, videoPath: true, topicFamily: true },
    });

    if (!row) { console.log(`  ⚠ ${id} — not found in DB`); continue; }
    if (row.videoStatus !== "done" || !row.videoPath) {
      console.log(`  ⚠ ${id.slice(0, 16)} — videoStatus=${row.videoStatus} videoPath=${row.videoPath ?? "(none)"} — skipping`);
      continue;
    }

    process.stdout.write(`  ${id.slice(0, 16)} schedule… `);
    await autoScheduleVideoAction(id, "quote");
    console.log(`✓`);
  }
}

// ── Coverage report ───────────────────────────────────────────────────────

async function checkCoverage() {
  console.log("\n── Strategic coverage (post-render) ─────────────────────────");
  try {
    const coverage = await getStrategicFamilyCoverageAction();
    for (const r of coverage) {
      if (r.sampleDepth.total === 0) continue;
      const vq = `${r.videoCount.total}v/${r.quoteCount.total}q`;
      console.log(`  [${(r.sprintLabel ?? "—").padEnd(12)}] ${r.displayName.padEnd(40)} total=${r.sampleDepth.total} (${vq}) ${r.sampleDepthStatus}`);
    }
    console.log("  ✓ Coverage action succeeded");
  } catch (err) {
    console.error(`  ✗ Coverage action failed: ${err}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Render pending TTS items (direct pipeline, bypass backpressure)");
  console.log("  Date:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════");

  console.log("\n── Rendering 7 TTS items ────────────────────────────────────");
  let rendered = 0;
  let errors = 0;
  let scheduled = 0;

  for (const id of TTS_IDS) {
    const t0 = Date.now();
    const result = await renderItem(id);
    if (result.ok) {
      rendered++;
      if (result.scheduled) scheduled++;
    } else {
      errors++;
      console.error(`  ✗ ${id.slice(0, 8)} failed at step=${result.step}: ${result.error}`);
    }
  }

  console.log(`\n  Render pass: ${rendered} ok / ${errors} errors / ${scheduled} newly scheduled`);

  const final = await verifyFinalState();
  console.log(`\n  Render summary: ${final.rendered}/${final.total} done, ${final.errors} errors, topic_family intact: ${final.familyOk ? "✓" : "⚠"}`);

  await queueQuoteItems();

  await checkUploadQueue(TTS_IDS, "TTS items");
  await checkUploadQueue(QUOTE_IDS, "quote items");
  await checkCoverage();

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Done.");
  console.log(`  TTS rendered: ${final.rendered}/${final.total}`);
  console.log(`  Errors: ${final.errors}`);
  console.log(`  topic_family preserved: ${final.familyOk ? "yes ✓" : "⚠ check above"}`);
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
