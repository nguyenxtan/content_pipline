/**
 * Verify the Quote Short generator end-to-end.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/verify-generate-quote-shorts.ts
 *   npx tsx --tsconfig tsconfig.json scripts/verify-generate-quote-shorts.ts --dry-run
 *
 * Flags:
 *   --dry-run   Only preview topics/quotes (no image/FFmpeg/DB writes)
 *
 * Env loading:
 *   DB-dependent modules are imported dynamically INSIDE main() so that
 *   loadEnv() runs before any Pool is constructed (same issue affects all
 *   scripts that use @/lib/db — the pool is created at module-import time).
 */

// Load env BEFORE any module that touches process.env at import time.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import fs from "fs";
import path from "path";

// Type-only imports are erased at runtime and do not trigger module init.
import type { QuoteGenPreviewItem } from "@/lib/pipeline/quote-short-pipeline";

const isDryRun = process.argv.includes("--dry-run");

// ── Helpers ───────────────────────────────────────────────────────────────

function ok(msg: string)   { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1; }
function info(msg: string) { console.log(`  ℹ  ${msg}`); }

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Quote Short Generator Verification ===");
  console.log(`Mode: ${isDryRun ? "DRY-RUN (no rendering)" : "FULL (renders 1 video)"}\n`);

  // Dynamic imports run AFTER loadEnv() so Pool gets the correct DATABASE_URL.
  const { previewQuoteGeneration, pickMusicPath, runQuoteShortBatch } =
    await import("@/lib/pipeline/quote-short-pipeline");
  const { db } = await import("@/lib/db");
  const { contentGenerations } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  // ── Step 1: preview (LLM only, no DB) ────────────────────────────────────
  console.log("Step 1: Preview topics + quotes");
  let previewItems: QuoteGenPreviewItem[];
  try {
    previewItems = await previewQuoteGeneration({
      count: 1,
      topicFamily: "peace_mindfulness",
    });
    if (previewItems.length === 0) { fail("Không trả về item nào"); return; }
    const item = previewItems[0];
    ok(`Topic: "${item.topic}"`);
    ok(`Quote: "${item.quoteText}"`);

    const words = item.quoteText.split(/\s+/).length;
    if (words >= 5 && words <= 30) ok(`Độ dài quote hợp lệ: ${words} chữ`);
    else fail(`Quote quá ngắn hoặc quá dài: ${words} chữ`);

    if (/[#@*_[\]]/.test(item.quoteText)) fail("Quote chứa ký tự bất hợp lệ");
    else ok("Quote không có hashtag/markdown");
  } catch (err) {
    fail(`Preview thất bại: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── Step 2: music guard ────────────────────────────────────────────────────
  console.log("\nStep 2: Kiểm tra nhạc nền (guard missing_background_music)");
  let musicPath: string;
  try {
    musicPath = await pickMusicPath();
    ok(`Nhạc nền tìm thấy: ${path.basename(musicPath)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("missing_background_music")) {
      ok("missing_background_music bắn lỗi đúng khi không có nhạc — guard hoạt động");
      info("Thêm nhạc tại Settings → Nhạc nền để chạy full render.");
      if (isDryRun) {
        console.log("\nDry-run hoàn thành.\n");
        await db.$client.end().catch(() => {});
        return;
      }
      fail("Không thể chạy full render: thiếu nhạc nền");
      await db.$client.end().catch(() => {});
      return;
    }
    fail(`pickMusicPath lỗi không mong đợi: ${msg}`);
    await db.$client.end().catch(() => {});
    return;
  }

  if (isDryRun) {
    console.log("\nDry-run hoàn thành — bỏ qua image/video/DB.");
    console.log("\nKết quả: OK\n");
    await db.$client.end().catch(() => {});
    return;
  }

  // ── Step 3: full generation ────────────────────────────────────────────────
  console.log("\nStep 3: Full generation (Fal.ai image + FFmpeg render)");
  info("Đang tạo ảnh và render video… (có thể mất 30-60s)");

  const batchResults = await runQuoteShortBatch(previewItems, { durationSec: 14 });
  const result = batchResults[0];

  if (!result) { fail("Không trả về kết quả"); return; }
  if (!result.ok) { fail(`Render thất bại: ${result.error}`); return; }

  ok(`contentId: ${result.contentId}`);

  // ── Step 4: verify output files ────────────────────────────────────────────
  console.log("\nStep 4: Kiểm tra file đầu ra");

  if (fs.existsSync(result.videoPath)) {
    const size = fs.statSync(result.videoPath).size;
    ok(`Video: ${path.basename(result.videoPath)} (${(size / 1024).toFixed(0)} KB)`);
  } else {
    fail(`Video không tồn tại: ${result.videoPath}`);
  }

  if (fs.existsSync(result.sidecarPath)) {
    ok(`Sidecar JSON: ${path.basename(result.sidecarPath)}`);
    const sidecar = JSON.parse(fs.readFileSync(result.sidecarPath, "utf8")) as {
      contentId?: string; experimentId?: string;
    };
    if (sidecar.contentId === result.contentId) ok("Sidecar contentId khớp");
    else fail(`Sidecar contentId sai: ${sidecar.contentId}`);
    if (sidecar.experimentId === "LEGACY_QUOTE_SHORT") ok("Sidecar experimentId = LEGACY_QUOTE_SHORT");
    else fail(`Sidecar experimentId sai: ${sidecar.experimentId}`);
  } else {
    fail(`Sidecar JSON không tồn tại: ${result.sidecarPath}`);
  }

  if (fs.existsSync(result.renderedImagePath)) {
    ok(`Thumbnail: ${path.basename(result.renderedImagePath)}`);
  } else {
    fail(`Thumbnail không tồn tại: ${result.renderedImagePath}`);
  }

  // ── Step 5: DB row ────────────────────────────────────────────────────────
  console.log("\nStep 5: Kiểm tra DB row");
  try {
    const existing = await db.query.contentGenerations.findFirst({
      where: eq(contentGenerations.id, result.contentId),
      columns: { id: true, formatType: true },
    });
    if (existing) {
      ok(`DB row tồn tại (id: ${existing.id})`);
      if (existing.formatType === "legacy_quote_short") ok("formatType = legacy_quote_short ✓");
      else fail(`formatType sai: ${existing.formatType}`);
    } else {
      info("DB row chưa có — script này không tạo row; server action mới tạo");
    }
  } catch (err) {
    fail(`DB query thất bại: ${err instanceof Error ? err.message : String(err)}`);
  }

  const hasError = (process.exitCode ?? 0) !== 0;
  console.log(`\n=== Kết quả: ${hasError ? "FAILED" : "OK"} ===\n`);
  if (!hasError) {
    console.log("Reload /content/quotes để xem item mới.\n");
  }

  await db.$client.end().catch(() => {});
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exitCode = 1;
});
