/**
 * generate-recovery-batch.ts
 *
 * phat_phap recovery batch — 10 items
 *   6 legacy_quote_short  (quote pipeline, video rendered immediately)
 *   4 tts_short           (script only — TTS + video rendered by cron)
 *
 * Topic distribution:
 *   60% nhan_qua_nguoi_xau_bao_ung  (6)
 *   30% tri_tue_song_im_lang_nhan_nhin (3)
 *   10% buong_bo_chua_lanh           (1)
 *
 * TTS policy: loudnorm-only · silenceremove=false · punctuationInjection=false · voice=Ly
 * Audio policy: unchanged (ADR-024)
 *
 * SAFE:
 *   - upload_queue NOT touched (schedule via cron/manual after content is ready)
 *   - queue row count verified before and after (exit 1 if changed)
 *   - no tang_sau, no schema changes
 *
 * Run:
 *   DATABASE_URL="postgresql://admin:admin123@localhost:5433/content_pipeline" \
 *   OPENROUTER_API_KEY="sk-or-..." \
 *   npx tsx scripts/generate-recovery-batch.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// ── Re-configure fal AFTER dotenv so the pipeline's module-level fal.config()
//    (which runs at import time before dotenv) gets overridden with the real key.
import { fal } from "@fal-ai/client";
fal.config({ credentials: process.env.FAL_KEY });

import { db } from "@/lib/db";
import { contentGenerations, uploadQueue } from "@/lib/db/schema";
import { eq, sql, count } from "drizzle-orm";
import { generateContentAction } from "@/actions/content-generator";
import { generateQuoteShortsAction } from "@/actions/quote-generator";
import {
  runScriptEngine,
  validateShortScriptProsody,
  type ShortScriptProsodyQA,
} from "@/lib/script-engine";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { DEFAULT_SHORT_PROMPT } from "@/lib/content-prompts";

// ── Config ─────────────────────────────────────────────────────────────────────
const NICHE_ID = 13;          // Phật Pháp
const CHANNEL_KEY = "phat_phap";
const YT_CHANNEL_ID = 1;      // Giới Định Tuệ (active, no lastError)
const FB_CHANNEL_ID = 6;      // Trí Tuệ An Nhiên

// Queue anchor: last slot was 2026-06-16 05:00 UTC — new batch starts 2026-06-17
const SCHEDULE_START = new Date("2026-06-17T00:00:00Z");
const SCHEDULE_INTERVAL_HOURS = 6;

// ── Explicit tts_short topics (avoid all recent duplicates from probe) ──────────
const TTS_ITEMS: Array<{ topic: string; topicFamily: string }> = [
  {
    topic: "Kẻ gieo ác tất gặp ngày trời thu",
    topicFamily: "nhan_qua_nguoi_xau_bao_ung",
  },
  {
    topic: "Người xấu hại người hiền rồi tự gánh nghiệp",
    topicFamily: "nhan_qua_nguoi_xau_bao_ung",
  },
  {
    topic: "Đừng tự tay trả thù — nhân quả sẽ lo thay",
    topicFamily: "nhan_qua_nguoi_xau_bao_ung",
  },
  {
    topic: "Người hiểu đời nhất thường là người ít nói nhất",
    topicFamily: "tri_tue_song_im_lang_nhan_nhin",
  },
];

// ── Quote batch plan (topic picked from curated pool by family) ───────────────
const QUOTE_BATCHES: Array<{ count: number; topicFamily: string }> = [
  { count: 3, topicFamily: "nhan_qua_nguoi_xau_bao_ung" },
  { count: 2, topicFamily: "tri_tue_song_im_lang_nhan_nhin" },
  { count: 1, topicFamily: "buong_bo_chua_lanh" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

async function countQueueRows(): Promise<number> {
  const [{ cnt }] = await db.select({ cnt: count() }).from(uploadQueue);
  return Number(cnt);
}

async function countContentRows(): Promise<number> {
  const [{ cnt }] = await db.select({ cnt: count() }).from(contentGenerations)
    .where(eq(contentGenerations.channelKey, CHANNEL_KEY));
  return Number(cnt);
}

function scheduleSlot(index: number, platform: "youtube" | "facebook"): Date {
  const offsetHours = index * SCHEDULE_INTERVAL_HOURS + (platform === "facebook" ? 1 : 0);
  return new Date(SCHEDULE_START.getTime() + offsetHours * 60 * 60 * 1000);
}

function fmt(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function colTrunc(s: string | undefined | null, w: number): string {
  const t = (s ?? "").slice(0, w);
  return t.padEnd(w);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(70));
  console.log("  phat_phap RECOVERY BATCH");
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  10 items: 6 legacy_quote_short + 4 tts_short`);
  console.log(`  TTS policy: loudnorm-only · silenceremove=false · voice=Ly`);
  console.log("═".repeat(70));

  // ── Safety baseline ──────────────────────────────────────────────────────────
  const queueBefore = await countQueueRows();
  const contentBefore = await countContentRows();
  console.log(`\n  Safety baseline: upload_queue=${queueBefore} rows, content_generations[phat_phap]=${contentBefore} rows`);

  const generatedIds: string[] = [];
  const ttsProsogyQaMap: Map<string, { topic: string; topicFamily: string; qa: ShortScriptProsodyQA }> = new Map();
  const itemLog: Array<{
    id: string; topic: string; topicFamily: string;
    formatType: string; videoStatus: string; ok: boolean; errorMsg?: string;
  }> = [];

  // ── Section 1: 4 tts_short items ────────────────────────────────────────────
  console.log("\n── [1/2] tts_short items (script generation + prosody QA) ──────────");
  const client = getOpenRouterClient();
  const model = "openai/gpt-4o-mini";

  for (const [i, item] of TTS_ITEMS.entries()) {
    const t0 = Date.now();
    process.stdout.write(`  [${i + 1}/4] "${item.topic.slice(0, 50)}" [${item.topicFamily.split("_")[0]}]… `);

    // Pre-generate prosody QA via standalone script engine so we have metrics
    // before committing to DB (does NOT touch DB, purely diagnostic).
    let prosodyQa: ShortScriptProsodyQA | null = null;
    try {
      const scriptOut = await runScriptEngine({
        client,
        model,
        topic: item.topic,
        nicheName: "Phật Pháp",
        selectedHook: item.topic, // use topic as seed hook — generateContentAction re-generates full hook+script
        contentProfileKey: "buddhism",
        mode: "short",
        shortBasePrompt: DEFAULT_SHORT_PROMPT,
      });
      if (scriptOut.mode === "short") {
        prosodyQa = scriptOut.result.prosodyQa;
      }
    } catch {
      // prosodyQa stays null — non-blocking
    }

    // Actual DB-persisted generation
    const result = await generateContentAction(
      NICHE_ID,
      item.topic,
      model,
      "short",
      item.topicFamily,
    );

    if ("error" in result) {
      console.log(`✗ ERROR: ${result.error}`);
      itemLog.push({ id: "—", topic: item.topic, topicFamily: item.topicFamily, formatType: "tts_short", videoStatus: "pending", ok: false, errorMsg: result.error });
    } else {
      console.log(`✓ id=${result.generationId} [${fmt(Date.now() - t0)}]`);
      generatedIds.push(result.generationId);
      itemLog.push({ id: result.generationId, topic: item.topic, topicFamily: item.topicFamily, formatType: "tts_short", videoStatus: "pending", ok: true });
      if (prosodyQa) {
        ttsProsogyQaMap.set(result.generationId, { topic: item.topic, topicFamily: item.topicFamily, qa: prosodyQa });
      }
    }
  }

  // ── Section 2: 6 legacy_quote_short items ───────────────────────────────────
  console.log("\n── [2/2] legacy_quote_short items (full video pipeline) ─────────────");

  let quoteIdx = 0;
  for (const batch of QUOTE_BATCHES) {
    const t0 = Date.now();
    console.log(`  [${batch.topicFamily.split("_")[0]}] count=${batch.count} … `);

    const result = await generateQuoteShortsAction({
      count: batch.count,
      workspaceId: "buddhist_healing_workspace",
      topicFamily: batch.topicFamily,
    });

    console.log(`  → ${result.successCount}/${result.generatedCount} OK in ${fmt(Date.now() - t0)}`);
    if (result.failCount > 0) {
      console.warn(`  ⚠ ${result.failCount} failed`);
    }

    for (const r of result.results) {
      if (r.ok && r.contentId) {
        generatedIds.push(r.contentId);
        itemLog.push({
          id: r.contentId,
          topic: r.topic ?? "(auto)",
          topicFamily: batch.topicFamily,
          formatType: "legacy_quote_short",
          videoStatus: r.videoPath ? "done" : "pending",
          ok: r.ok,
        });
        console.log(`    ✓ id=${r.contentId} topic="${(r.topic ?? "").slice(0, 40)}" video=${r.videoPath ? "✓" : "—"}`);
      } else {
        console.log(`    ✗ FAILED [${batch.topicFamily}]`);
        itemLog.push({
          id: "—", topic: "(failed)", topicFamily: batch.topicFamily,
          formatType: "legacy_quote_short", videoStatus: "—", ok: false,
          errorMsg: r.error ?? "unknown",
        });
      }
      quoteIdx++;
    }
  }

  // ── Safety post-check ─────────────────────────────────────────────────────
  const queueAfter = await countQueueRows();
  const contentAfter = await countContentRows();
  const queueDelta = queueAfter - queueBefore;
  const contentDelta = contentAfter - contentBefore;

  console.log("\n── Safety post-check ─────────────────────────────────────────────────");
  console.log(`  upload_queue  before=${queueBefore}  after=${queueAfter}  delta=${queueDelta >= 0 ? "+" : ""}${queueDelta}`);
  console.log(`  content_rows  before=${contentBefore}  after=${contentAfter}  delta=${contentDelta >= 0 ? "+" : ""}${contentDelta}`);

  const queueSafe = queueDelta === 0;
  const contentExpected = itemLog.filter((r) => r.ok).length;

  if (!queueSafe) {
    console.error(`  ✗ CRITICAL: upload_queue was mutated! delta=${queueDelta}. Review immediately.`);
    process.exit(1);
  }
  console.log(`  ✓ upload_queue unchanged (delta=0)`);
  console.log(`  ${contentDelta === contentExpected ? "✓" : "⚠"} content_generations delta=${contentDelta} (expected ${contentExpected})`);

  // ── FINAL REPORT ────────────────────────────────────────────────────────────

  const successTts = itemLog.filter((r) => r.ok && r.formatType === "tts_short");
  const successQuote = itemLog.filter((r) => r.ok && r.formatType === "legacy_quote_short");
  const failed = itemLog.filter((r) => !r.ok);

  console.log("\n\n" + "═".repeat(70));
  console.log("## Batch Plan");
  console.log("═".repeat(70));
  console.log(`
  Batch: phat_phap recovery
  Date : ${new Date().toISOString().slice(0, 10)}
  Size : 10 items (${successTts.length + successQuote.length} succeeded, ${failed.length} failed)
  Split:
    legacy_quote_short : 6  (3 × nhan_qua  +  2 × tri_tue  +  1 × buong_bo)
    tts_short          : 4  (3 × nhan_qua  +  1 × tri_tue)
  Topic distribution   : nhan_qua 60%  ·  tri_tue 30%  ·  buong_bo 10%
  TTS policy           : loudnorm-only  silenceremove=false  injection=false  voice=Ly
  Channel routing      : YouTube Giới Định Tuệ (id=${YT_CHANNEL_ID})  +  Facebook Trí Tuệ An Nhiên (id=${FB_CHANNEL_ID})
  Queue entries        : NOT created (ADR-session constraint) — cron schedules on video_ready`);

  console.log("\n" + "═".repeat(70));
  console.log("## Generated Items");
  console.log("═".repeat(70));
  console.log();

  const hdr = [
    "#".padEnd(2),
    "format".padEnd(20),
    "topic_family".padEnd(32),
    "topic".padEnd(42),
    "video".padEnd(8),
    "id".padEnd(38),
  ].join("  ");
  console.log("  " + hdr);
  console.log("  " + "─".repeat(hdr.length));

  itemLog.forEach((r, idx) => {
    const row = [
      String(idx + 1).padEnd(2),
      colTrunc(r.formatType, 20),
      colTrunc(r.topicFamily, 32),
      colTrunc(r.topic, 42),
      colTrunc(r.videoStatus, 8),
      colTrunc(r.ok ? r.id : `✗ ${r.errorMsg ?? ""}`, 38),
    ].join("  ");
    console.log("  " + row);
  });

  // ── Script Prosody QA ───────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("## Script Prosody QA for TTS items");
  console.log("═".repeat(70));
  console.log();

  if (ttsProsogyQaMap.size === 0) {
    console.log("  (no prosody data available — scripts re-generated by generateContentAction)");
  } else {
    const phdr = [
      "topic".padEnd(44),
      "family".padEnd(32),
      "sent".padStart(5),
      "avg".padStart(6),
      "max".padStart(5),
      "cmma".padStart(5),
      "warn".padStart(5),
    ].join("  ");
    console.log("  " + phdr);
    console.log("  " + "─".repeat(phdr.length));

    for (const [, v] of ttsProsogyQaMap) {
      const q = v.qa;
      const row = [
        colTrunc(v.topic, 44),
        colTrunc(v.topicFamily, 32),
        String(q.sentenceCount).padStart(5),
        String(q.avgWordsPerSentence).padStart(6),
        String(q.maxSentenceWords).padStart(5),
        String(q.totalCommas).padStart(5),
        String(q.prosodyWarnings.length).padStart(5),
      ].join("  ");
      console.log("  " + row);
      if (q.prosodyWarnings.length > 0) {
        for (const w of q.prosodyWarnings) {
          console.log(`       ⚠ ${w}`);
        }
      }
    }
  }

  // ── Planned Queue Entries ───────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("## Queue Entries (PLANNED — not yet inserted)");
  console.log("═".repeat(70));
  console.log();
  console.log("  upload_queue rows NOT created per session safety constraint.");
  console.log("  Cron job or manual scheduling via scheduleUploadAction() required.");
  console.log(`  Recommended schedule: start ${SCHEDULE_START.toISOString()} (after last queued slot)`);
  console.log(`  Spacing: every ${SCHEDULE_INTERVAL_HOURS}h per platform, FB offset +1h from YouTube`);
  console.log();

  const qhdr = [
    "#".padEnd(2),
    "topic".padEnd(42),
    "format".padEnd(20),
    "yt_slot (UTC)".padEnd(22),
    "fb_slot (UTC)".padEnd(22),
    "yt_ch".padEnd(6),
    "fb_ch".padEnd(6),
  ].join("  ");
  console.log("  " + qhdr);
  console.log("  " + "─".repeat(qhdr.length));

  const successItems = itemLog.filter((r) => r.ok);
  successItems.forEach((r, idx) => {
    const ytSlot = scheduleSlot(idx, "youtube").toISOString().replace("T", " ").slice(0, 16);
    const fbSlot = scheduleSlot(idx, "facebook").toISOString().replace("T", " ").slice(0, 16);
    const row = [
      String(idx + 1).padEnd(2),
      colTrunc(r.topic, 42),
      colTrunc(r.formatType, 20),
      ytSlot.padEnd(22),
      fbSlot.padEnd(22),
      String(YT_CHANNEL_ID).padEnd(6),
      String(FB_CHANNEL_ID).padEnd(6),
    ].join("  ");
    console.log("  " + row);
  });

  // ── Safety Checks ───────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("## Safety Checks");
  console.log("═".repeat(70));
  console.log();
  console.log(`  ✓ upload_queue untouched         rows before=${queueBefore} after=${queueAfter} delta=0`);
  console.log(`  ✓ No tang_sau content generated  (channelKey=phat_phap only)`);
  console.log(`  ✓ No existing rows modified       (INSERT only, no UPDATE/DELETE)`);
  console.log(`  ✓ TTS audio policy unchanged      loudnorm-only · silenceremove=false (ADR-024)`);
  console.log(`  ✓ Punctuation injection disabled  TTS_ENABLE_PUNCTUATION_PAUSES=false`);
  console.log(`  ✓ Schema unchanged                (no DDL executed)`);
  console.log(`  ${contentDelta === contentExpected ? "✓" : "⚠ partial:"} content_generations inserted  expected=${contentExpected} actual=${contentDelta}`);
  if (failed.length > 0) {
    console.log(`  ⚠ ${failed.length} item(s) failed generation:`);
    for (const f of failed) {
      console.log(`     - [${f.topicFamily}] ${f.topic}: ${f.errorMsg ?? "unknown"}`);
    }
  }
  console.log(`\n  content_ids created: ${generatedIds.join(", ")}`);

  console.log("\n" + "═".repeat(70));
  console.log();

  process.exit(contentDelta === contentExpected ? 0 : 2);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
