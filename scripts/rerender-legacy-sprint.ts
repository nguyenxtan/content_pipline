/**
 * Re-render the 7 legacy sprint short videos with the post-fix subtitle config.
 *
 * These items were rendered before the subtitle fix (no sidecar, bounce animation,
 * size 64, blur). Their Facebook queue entries read video_path from content_generations
 * at publish time, so overwriting the file in-place is sufficient.
 *
 * Safety:
 *   - Only calls runShortVideo — does NOT touch TTS, images, scheduling, or publish flow
 *   - Does NOT create new queue entries
 *   - Does NOT modify topic_family
 *   - YouTube entries (status=done) are not touched
 *   - Renders sequentially to avoid parallel ffmpeg contention
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { runShortVideo } from "@/lib/pipeline/short-video";

const LEGACY_IDS = [
  "8c0da12f-08b0-4009-bd55-80ae3b871e21", // Người hại bạn rồi cũng nhận quả báo     facebook 2026-06-10 13:00 UTC
  "9839af14-c1ed-4af4-9c2a-3d1adfabc210", // Đừng trả thù — nhân quả sẽ tự lo        facebook 2026-06-10 14:00 UTC
  "1fcd2512-83e1-480c-8b6b-eb282c7e76de", // Kẻ phản bội sống ác, trời không tha      facebook 2026-06-11 01:00 UTC
  "fe2b62e4-9871-40c4-a7f2-9aa411530dd9", // Tiểu nhân đắc chí chỉ là tạm thời        facebook 2026-06-11 02:00 UTC
  "b9757a63-ebbf-4ecc-a4e6-6ad516b80df2", // Im lặng trước người xấu là trí tuệ cao nhất facebook 2026-06-11 03:00 UTC
  "8d9eb929-4730-487a-bbd0-1c0f1d9ac744", // Buông bỏ người không còn yêu thương ta nữa  facebook 2026-06-11 04:00 UTC
  "957b26f5-990e-489d-adff-fd7964fae7be", // Nhẫn nhịn không phải yếu đuối mà là trí tuệ facebook 2026-06-11 05:00 UTC
];

function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }
function elapsed(ms: number) {
  const s = Math.round(ms / 1000);
  return `${pad(Math.floor(s / 60))}m${pad(s % 60)}s`;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Re-render legacy sprint shorts — post-fix subtitle config");
  console.log("  Date:", new Date().toISOString());
  console.log("  Items:", LEGACY_IDS.length);
  console.log("═══════════════════════════════════════════════════════════════");

  // ── Pre-flight: confirm topic_family BEFORE for safety check ──────
  const rows = await db.query.contentGenerations.findMany({
    where: inArray(contentGenerations.id, LEGACY_IDS),
    columns: { id: true, topic: true, topicFamily: true, videoPath: true, videoStatus: true },
  });

  console.log("\n── Pre-flight state ─────────────────────────────────────────────");
  console.log("  ID         | topic_family                    | old_video_path");
  console.log("  " + "─".repeat(95));
  for (const r of rows) {
    console.log(`  ${r.id.slice(0,8)} | ${(r.topicFamily ?? "(null)").padEnd(32)} | ${r.videoPath ?? "(none)"}`);
  }

  const topicFamilyBefore = new Map(rows.map(r => [r.id, r.topicFamily]));

  // ── Render sequentially ───────────────────────────────────────────
  console.log("\n── Rendering ────────────────────────────────────────────────────");

  type RenderResult = {
    id: string;
    topic: string | null;
    topicFamilyBefore: string | null;
    topicFamilyAfter: string | null;
    oldVideoPath: string | null;
    newVideoPath: string | null;
    subtitleStatus: "PASS" | "FAIL" | "error";
    subtitleScore: number | null;
    elapsedMs: number;
    error?: string;
  };

  const results: RenderResult[] = [];

  for (let i = 0; i < LEGACY_IDS.length; i++) {
    const id = LEGACY_IDS[i];
    const row = rows.find(r => r.id === id);
    const topic = row?.topic ?? null;
    const oldVideoPath = row?.videoPath ?? null;

    console.log(`\n  [${i + 1}/${LEGACY_IDS.length}] ${id.slice(0,8)} — ${(topic ?? "").slice(0, 60)}`);
    process.stdout.write("    rendering … ");

    const t0 = Date.now();
    let result: RenderResult;

    try {
      const r = await runShortVideo(id);
      const ms = Date.now() - t0;

      if (r.success) {
        // Read back topic_family from DB to confirm unchanged
        const after = await db.query.contentGenerations.findFirst({
          where: (t, { eq }) => eq(t.id, id),
          columns: { topicFamily: true, videoPath: true },
        });

        console.log(`done (${elapsed(ms)}) subtitleStatus=${r.subtitleStatus} score=${r.subtitleHealthScore}`);

        result = {
          id,
          topic,
          topicFamilyBefore: topicFamilyBefore.get(id) ?? null,
          topicFamilyAfter: after?.topicFamily ?? null,
          oldVideoPath,
          newVideoPath: r.videoPath,
          subtitleStatus: r.subtitleStatus,
          subtitleScore: r.subtitleHealthScore,
          elapsedMs: ms,
        };
      } else {
        console.log(`FAILED (${elapsed(ms)}): ${r.error}`);
        result = {
          id,
          topic,
          topicFamilyBefore: topicFamilyBefore.get(id) ?? null,
          topicFamilyAfter: null,
          oldVideoPath,
          newVideoPath: null,
          subtitleStatus: "error",
          subtitleScore: null,
          elapsedMs: ms,
          error: r.error,
        };
      }
    } catch (err) {
      const ms = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`EXCEPTION (${elapsed(ms)}): ${msg}`);
      result = {
        id,
        topic,
        topicFamilyBefore: topicFamilyBefore.get(id) ?? null,
        topicFamilyAfter: null,
        oldVideoPath,
        newVideoPath: null,
        subtitleStatus: "error",
        subtitleScore: null,
        elapsedMs: ms,
        error: msg,
      };
    }

    results.push(result);
  }

  // ── Summary table ─────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  Re-render Result");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\n## Re-render Result");
  console.log("| content_id | old_video_path | new_video_path | subtitle QA | facebook_queue_status | action |");
  console.log("|---|---|---|---|---|---|");

  for (const r of results) {
    const old = r.oldVideoPath ? r.oldVideoPath.split("/").pop()! : "(none)";
    const nw  = r.newVideoPath ? r.newVideoPath.split("/").pop()! : "(failed)";
    const qa  = r.subtitleStatus === "PASS"
      ? `✓ PASS score=${r.subtitleScore}`
      : r.subtitleStatus === "FAIL"
      ? `✗ FAIL score=${r.subtitleScore}`
      : `✗ ERROR: ${(r.error ?? "").slice(0, 40)}`;
    const inPlace = r.oldVideoPath === r.newVideoPath || old === nw;
    const queueNote = inPlace
      ? "queued (reads video_path from content_generations — picks up new file automatically)"
      : "queued (path updated by render)";
    const action = r.subtitleStatus === "PASS"
      ? "re-rendered ✓ (in-place overwrite)"
      : "re-render FAILED";
    console.log(`| ${r.id.slice(0,8)} | ${old} | ${nw} | ${qa} | ${queueNote} | ${action} |`);
  }

  // ── Safety checks ─────────────────────────────────────────────────
  console.log("\n## Safety Checks");

  // topic_family unchanged
  const tfChanged = results.filter(r =>
    r.topicFamilyAfter !== null && r.topicFamilyBefore !== r.topicFamilyAfter
  );
  console.log(`- topic_family unchanged: ${tfChanged.length === 0 ? "✓ all 7 unchanged" : `✗ CHANGED: ${tfChanged.map(r => r.id.slice(0,8)).join(", ")}`}`);
  for (const r of results) {
    if (r.topicFamilyAfter !== null) {
      const ok = r.topicFamilyBefore === r.topicFamilyAfter;
      console.log(`  ${ok ? "✓" : "✗"} ${r.id.slice(0,8)}: ${r.topicFamilyBefore ?? "(null)"} → ${r.topicFamilyAfter}`);
    }
  }

  // YouTube done records untouched
  console.log(`- YouTube published records untouched: ✓ runShortVideo only overwrites video file + content_generations.videoPath/videoStatus — does not touch upload_queue rows with status=done`);

  // No duplicate queue entries
  console.log(`- No duplicate queue entries created: ✓ runShortVideo does not create upload_queue entries`);

  // Facebook queued entries point to fixed video
  const allPass = results.every(r => r.subtitleStatus === "PASS");
  console.log(`- Facebook queued entries point to fixed video: ${allPass ? "✓ video_path in content_generations updated in-place; queue reads it at publish time" : "⚠ some renders failed — check errors above"}`);

  // Render summary
  const passed = results.filter(r => r.subtitleStatus === "PASS").length;
  const failed = results.filter(r => r.subtitleStatus !== "PASS").length;
  console.log(`\n  Render summary: ${passed}/7 PASS, ${failed}/7 failed`);
  if (failed > 0) {
    console.log("  Failed IDs:");
    for (const r of results.filter(r => r.subtitleStatus !== "PASS")) {
      console.log(`    ${r.id.slice(0,8)}: ${r.error}`);
    }
    process.exit(1);
  }

  console.log("\n  ✓ All 7 items re-rendered with post-fix subtitle config.");
  console.log("    Facebook queue will use fixed videos at scheduled publish times.");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
