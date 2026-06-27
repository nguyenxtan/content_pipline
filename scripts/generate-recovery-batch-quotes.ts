/**
 * generate-recovery-batch-quotes.ts
 *
 * Generates only the 6 legacy_quote_short items from the recovery batch.
 * (4 tts_short were already created in the first run — IDs below)
 *
 * Previously created tts_short:
 *   544afe4b  Kẻ gieo ác tất gặp ngày trời thu
 *   059368a3  Người xấu hại người hiền rồi tự gánh nghiệp
 *   4dca8c6f  Đừng tự tay trả thù — nhân quả sẽ lo thay
 *   6ef59e2c  Người hiểu đời nhất thường là người ít nói nhất
 *
 * SAFE: upload_queue NOT touched · no tang_sau · no existing rows modified
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// Fix: re-configure fal AFTER dotenv runs (pipeline's module-level fal.config()
// fires at import-hoist time before dotenv, so credentials are undefined then)
import { fal } from "@fal-ai/client";
fal.config({ credentials: process.env.FAL_KEY });

import { db } from "@/lib/db";
import { uploadQueue } from "@/lib/db/schema";
import { count } from "drizzle-orm";
import { generateQuoteShortsAction } from "@/actions/quote-generator";

const QUOTE_BATCHES: Array<{ count: number; topicFamily: string }> = [
  { count: 3, topicFamily: "nhan_qua_nguoi_xau_bao_ung" },
  { count: 2, topicFamily: "tri_tue_song_im_lang_nhan_nhin" },
  { count: 1, topicFamily: "buong_bo_chua_lanh" },
];

function fmt(ms: number) { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }

async function main() {
  console.log("═".repeat(60));
  console.log("  QUOTE BATCH (6 legacy_quote_short)");
  console.log(`  ${new Date().toISOString()}`);
  console.log("═".repeat(60));

  const [{ cnt: qBefore }] = await db.select({ cnt: count() }).from(uploadQueue);
  console.log(`\n  upload_queue before: ${qBefore} rows`);

  const ids: string[] = [];
  const log: Array<{ topicFamily: string; topic: string; ok: boolean; id?: string; error?: string }> = [];

  for (const batch of QUOTE_BATCHES) {
    const t0 = Date.now();
    console.log(`\n  [${batch.topicFamily}] count=${batch.count}…`);

    const result = await generateQuoteShortsAction({
      count: batch.count,
      workspaceId: "buddhist_healing_workspace",
      topicFamily: batch.topicFamily,
    });

    console.log(`  → ${result.successCount}/${result.generatedCount} OK  [${fmt(Date.now() - t0)}]`);

    for (const r of result.results) {
      if (r.ok) {
        ids.push(r.contentId);
        log.push({ topicFamily: batch.topicFamily, topic: r.topic, ok: true, id: r.contentId });
        console.log(`    ✓ ${r.contentId}  "${r.topic?.slice(0, 50)}"  video=${r.videoPath ? "✓" : "—"}`);
      } else {
        log.push({ topicFamily: batch.topicFamily, topic: r.topic ?? "(failed)", ok: false, error: r.error });
        console.log(`    ✗ FAIL  ${r.error}`);
      }
    }
  }

  const [{ cnt: qAfter }] = await db.select({ cnt: count() }).from(uploadQueue);
  const qDelta = Number(qAfter) - Number(qBefore);

  console.log("\n" + "═".repeat(60));
  console.log("## Results");
  console.log("═".repeat(60));

  const ok = log.filter(r => r.ok);
  const fail = log.filter(r => !r.ok);
  console.log(`\n  Success: ${ok.length}/6   Failed: ${fail.length}/6`);
  console.log(`  upload_queue delta: ${qDelta} (must be 0)`);
  if (qDelta !== 0) {
    console.error("  ✗ CRITICAL: upload_queue was mutated!");
    process.exit(1);
  }
  console.log(`  ✓ upload_queue unchanged`);
  console.log(`  IDs: ${ids.join(", ")}`);

  if (fail.length > 0) {
    console.log("\n  Failed items:");
    for (const f of fail) {
      console.log(`    [${f.topicFamily}] ${f.topic}: ${f.error}`);
    }
  }

  console.log("\n" + "═".repeat(60));
  process.exit(fail.length === 0 ? 0 : 2);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
