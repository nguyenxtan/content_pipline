/**
 * generate-refill-batch-2026-06-13.ts
 *
 * Emergency phat_phap refill — 10 items
 *   6 legacy_quote_short  (renders immediately)
 *   4 tts_short           (script only — TTS + video by cron)
 *
 * Topic distribution:
 *   70% nhan_qua_nguoi_xau_bao_ung  (7: 4 tts + 3 quote)
 *   20% tri_tue_song_im_lang_nhan_nhin (2: 1 tts + 1 quote)
 *   10% buong_bo_chua_lanh          (1: 1 quote)
 *
 * SAFE: upload_queue NOT touched · no tang_sau · no existing rows modified
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/generate-refill-batch-2026-06-13.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fal } from "@fal-ai/client";
fal.config({ credentials: process.env.FAL_KEY });

import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";
import { eq, count } from "drizzle-orm";
import { generateContentAction } from "@/actions/content-generator";
import { generateQuoteShortsAction } from "@/actions/quote-generator";

const NICHE_ID = 13;          // Phật Pháp
const CHANNEL_KEY = "phat_phap";

// Fresh TTS topics — all avoided from recent 14d published list
const TTS_ITEMS: Array<{ topic: string; topicFamily: string }> = [
  {
    topic: "Kẻ gian xảo rồi sẽ gặt đúng những gì đã gieo",
    topicFamily: "nhan_qua_nguoi_xau_bao_ung",
  },
  {
    topic: "Trời cao không bỏ sót một tội ác nào",
    topicFamily: "nhan_qua_nguoi_xau_bao_ung",
  },
  {
    topic: "Người độc ác tưởng thoát nhưng nhân quả không quên",
    topicFamily: "nhan_qua_nguoi_xau_bao_ung",
  },
  {
    topic: "Kẻ biết im lặng trước người xấu mới là người thực sự mạnh",
    topicFamily: "tri_tue_song_im_lang_nhan_nhin",
  },
];

const QUOTE_BATCHES: Array<{ count: number; topicFamily: string }> = [
  { count: 3, topicFamily: "nhan_qua_nguoi_xau_bao_ung" },
  { count: 2, topicFamily: "tri_tue_song_im_lang_nhan_nhin" },
  { count: 1, topicFamily: "buong_bo_chua_lanh" },
];

function fmt(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  console.log("═".repeat(70));
  console.log("  phat_phap EMERGENCY REFILL BATCH — 2026-06-13");
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  10 items: 6 legacy_quote_short + 4 tts_short`);
  console.log("═".repeat(70));

  const [{ qBefore }] = await db.select({ qBefore: count() }).from(uploadQueue);
  const [{ cBefore }] = await db
    .select({ cBefore: count() })
    .from(contentGenerations)
    .where(eq(contentGenerations.channelKey, CHANNEL_KEY));

  console.log(`\n  baseline: upload_queue=${qBefore} · phat_phap_rows=${cBefore}`);

  const itemLog: Array<{
    id: string; topic: string; topicFamily: string;
    formatType: string; videoStatus: string; ok: boolean; error?: string;
    videoPath?: string;
  }> = [];

  // ── Section 1: 4 tts_short ─────────────────────────────────────────────────
  console.log("\n── [1/2] tts_short (script generation) ──────────────────────────────");

  for (const [i, item] of TTS_ITEMS.entries()) {
    const t0 = Date.now();
    process.stdout.write(`  [${i + 1}/4] "${item.topic.slice(0, 55)}"… `);

    const result = await generateContentAction(
      NICHE_ID,
      item.topic,
      "openai/gpt-4o-mini",
      "short",
      item.topicFamily,
    );

    if ("error" in result) {
      console.log(`✗ ${result.error}`);
      itemLog.push({ id: "—", topic: item.topic, topicFamily: item.topicFamily, formatType: "tts_short", videoStatus: "error", ok: false, error: result.error });
    } else {
      console.log(`✓ ${result.generationId} [${fmt(Date.now() - t0)}]`);
      itemLog.push({ id: result.generationId, topic: item.topic, topicFamily: item.topicFamily, formatType: "tts_short", videoStatus: "pending", ok: true });
    }
  }

  // ── Section 2: 6 legacy_quote_short ───────────────────────────────────────
  console.log("\n── [2/2] legacy_quote_short (full video pipeline) ──────────────────");

  for (const batch of QUOTE_BATCHES) {
    const t0 = Date.now();
    process.stdout.write(`  [${batch.topicFamily.split("_")[0]}] count=${batch.count}… `);

    const result = await generateQuoteShortsAction({
      count: batch.count,
      workspaceId: "buddhist_healing_workspace",
      topicFamily: batch.topicFamily,
    });

    console.log(`${result.successCount}/${result.generatedCount} OK [${fmt(Date.now() - t0)}]`);

    for (const r of result.results) {
      if (r.ok && r.contentId) {
        itemLog.push({
          id: r.contentId,
          topic: r.topic ?? "(auto)",
          topicFamily: batch.topicFamily,
          formatType: "legacy_quote_short",
          videoStatus: r.videoPath ? "done" : "pending",
          ok: true,
          videoPath: r.videoPath ?? undefined,
        });
        console.log(`    ✓ ${r.contentId}  "${(r.topic ?? "").slice(0, 50)}"  video=${r.videoPath ? "✓" : "—"}`);
      } else {
        console.log(`    ✗ FAILED [${batch.topicFamily}]: ${r.error ?? "unknown"}`);
        itemLog.push({
          id: "—", topic: "(failed)", topicFamily: batch.topicFamily,
          formatType: "legacy_quote_short", videoStatus: "error", ok: false, error: r.error ?? "unknown",
        });
      }
    }
  }

  // ── Safety post-check ──────────────────────────────────────────────────────
  const [{ qAfter }] = await db.select({ qAfter: count() }).from(uploadQueue);
  const [{ cAfter }] = await db
    .select({ cAfter: count() })
    .from(contentGenerations)
    .where(eq(contentGenerations.channelKey, CHANNEL_KEY));

  const qDelta = Number(qAfter) - Number(qBefore);
  const cDelta = Number(cAfter) - Number(cBefore);

  console.log("\n── Safety post-check ─────────────────────────────────────────────────");
  console.log(`  upload_queue  ${qBefore}→${qAfter}  delta=${qDelta >= 0 ? "+" : ""}${qDelta}  ${qDelta === 0 ? "✓ SAFE" : "✗ CRITICAL: queue mutated!"}`);
  console.log(`  content_rows  ${cBefore}→${cAfter}  delta=${cDelta >= 0 ? "+" : ""}${cDelta}`);

  if (qDelta !== 0) {
    console.error("\n  ✗ CRITICAL: upload_queue was mutated. Review immediately.");
    process.exit(1);
  }

  // ── Final report ───────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("## Generated Items");
  console.log("═".repeat(70));
  console.log();

  const ok = itemLog.filter(r => r.ok);
  const failed = itemLog.filter(r => !r.ok);
  const quotes = ok.filter(r => r.formatType === "legacy_quote_short");
  const tts = ok.filter(r => r.formatType === "tts_short");

  console.log(`  Total: ${ok.length} ok · ${failed.length} failed`);
  console.log(`  legacy_quote_short: ${quotes.length} (${quotes.filter(r => r.videoStatus === "done").length} rendered)`);
  console.log(`  tts_short:          ${tts.length} (pending cron render)`);
  console.log();

  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);
  const hdr = [pad("#", 2), pad("format", 20), pad("family", 30), pad("topic", 45), pad("status", 8), pad("id", 38)].join("  ");
  console.log("  " + hdr);
  console.log("  " + "─".repeat(hdr.length));

  itemLog.forEach((r, i) => {
    const row = [
      String(i + 1).padEnd(2),
      pad(r.formatType, 20),
      pad(r.topicFamily, 30),
      pad(r.topic, 45),
      pad(r.videoStatus, 8),
      pad(r.ok ? r.id : `✗ ${r.error ?? ""}`, 38),
    ].join("  ");
    console.log("  " + row);
  });

  const quoteIds = quotes.map(r => r.id);
  const ttsIds = tts.map(r => r.id);
  console.log(`\n  quote_ids: ${quoteIds.join(", ")}`);
  console.log(`  tts_ids:   ${ttsIds.join(", ")}`);

  if (failed.length > 0) {
    console.log(`\n  ⚠ Failed items:`);
    failed.forEach(f => console.log(`    - [${f.topicFamily}] ${f.topic}: ${f.error}`));
  }

  console.log("\n" + "═".repeat(70));
  process.exit(failed.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
