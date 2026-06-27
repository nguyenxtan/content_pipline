/**
 * First test publish: generate and schedule one Quote Short for Tầng Sâu.
 *
 * Safety:
 *   - Does NOT call processUploadQueueAction
 *   - Does NOT upload immediately
 *   - Creates exactly 1 upload_queue row (platform=youtube, channel="Tầng Sâu")
 *   - Cron remains the only real publisher
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/tang-sau-first-publish.ts
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import fs from "fs";
import path from "path";

// ── Channel config ─────────────────────────────────────────────────────────
const TANG_SAU_CHANNEL_ID = 7; // Primary credential, no oauth_client_config quota cap
const TANG_SAU_PLATFORM = "youtube";
const TANG_SAU_CHANNEL_NAME = "Tầng Sâu";

// ── Schedule: 15 min from now ──────────────────────────────────────────────
const scheduledAt = new Date(Date.now() + 15 * 60_000);

// ── Helpers ───────────────────────────────────────────────────────────────

function ok(msg: string)   { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1; }
function info(msg: string) { console.log(`  ℹ  ${msg}`); }
function hr()              { console.log("\n" + "─".repeat(55)); }

function formatVn(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║   Tầng Sâu — First Quote Short Test Publish          ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");

  // Dynamic imports after env load so Pool picks up DATABASE_URL
  const { previewQuoteGeneration, runQuoteShortBatch } =
    await import("@/lib/pipeline/quote-short-pipeline");
  const { db } = await import("@/lib/db");
  const { contentGenerations, uploadQueue, niches, socialChannels } =
    await import("@/lib/db/schema");
  const { buildDefaultVideoTitle, buildDefaultVideoDescription } =
    await import("@/lib/social/youtube-metadata");
  const { and, eq, inArray } = await import("drizzle-orm");

  // ── Step 1: Verify channel ─────────────────────────────────────────────
  hr();
  console.log("Step 1: Kiểm tra kênh Tầng Sâu");

  const channel = await db.query.socialChannels.findFirst({
    where: and(
      eq(socialChannels.id, TANG_SAU_CHANNEL_ID),
      eq(socialChannels.platform, TANG_SAU_PLATFORM),
    ),
    columns: { id: true, name: true, platform: true, platformChannelId: true, isActive: true, needsReconnect: true, channelKey: true },
  });

  if (!channel) {
    fail(`Không tìm thấy channel id=${TANG_SAU_CHANNEL_ID}`);
    await db.$client.end().catch(() => {});
    return;
  }
  if (!channel.isActive) { fail("Channel không active"); return; }
  if (channel.needsReconnect) { fail("Channel cần reconnect token"); return; }

  ok(`Tên: ${channel.name} (id=${channel.id})`);
  ok(`Platform: ${channel.platform}`);
  ok(`YouTube channel ID: ${channel.platformChannelId}`);
  ok(`Active, không cần reconnect`);

  // ── Step 2: Check queue capacity ───────────────────────────────────────
  hr();
  console.log("Step 2: Kiểm tra dung lượng queue");

  const pendingRows = await db
    .select({ id: uploadQueue.id })
    .from(uploadQueue)
    .where(inArray(uploadQueue.status, ["queued", "uploading"]));
  const pendingBefore = pendingRows.length;
  const threshold = 50; // MAX_PENDING_UPLOAD_QUEUE default

  ok(`Pending queue hiện tại: ${pendingBefore} / ${threshold}`);
  if (pendingBefore >= threshold) {
    fail(`Queue đã đầy (${pendingBefore} >= ${threshold}). Dừng lại.`);
    await db.$client.end().catch(() => {});
    return;
  }
  ok(`Thêm 1 row sẽ đưa queue lên: ${pendingBefore + 1} / ${threshold}`);

  // ── Step 3: Get niche for content row ──────────────────────────────────
  hr();
  console.log("Step 3: Lấy thông tin niche");

  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.channelKey, channel.channelKey ?? "phat_phap"), eq(niches.isActive, true)),
    columns: { id: true, name: true, contentProfileKey: true, channelKey: true },
  });
  if (!niche) {
    fail("Không tìm thấy niche active");
    await db.$client.end().catch(() => {});
    return;
  }
  ok(`Niche: ${niche.name} (id=${niche.id})`);

  // ── Step 4: Generate Quote Short ───────────────────────────────────────
  hr();
  console.log("Step 4: Tạo Quote Short (LLM + Fal.ai + FFmpeg)");
  info("Đang tạo chủ đề và quote text qua LLM…");

  const previewItems = await previewQuoteGeneration({
    count: 1,
    topicFamily: "identity_choice", // Deep reflection — fits Tầng Sâu
    durationSec: 14,
    channelProfileId: "tang_sau_v1",
  });

  if (previewItems.length === 0) {
    fail("Không tạo được preview item");
    await db.$client.end().catch(() => {});
    return;
  }

  const item = previewItems[0];
  ok(`Topic: "${item.topic}"`);
  ok(`Quote: "${item.quoteText}"`);
  info(`topicFamily: ${item.topicFamily}`);

  info("Đang tạo ảnh nền (Fal.ai) và render video (FFmpeg)… (~30-60s)");

  const [result] = await runQuoteShortBatch(previewItems, { durationSec: 14 });

  if (!result?.ok) {
    fail(`Render thất bại: ${result?.error ?? "unknown"}`);
    await db.$client.end().catch(() => {});
    return;
  }

  ok(`contentId: ${result.contentId}`);
  ok(`Video: ${result.videoPath}`);
  ok(`Sidecar: ${result.sidecarPath}`);
  ok(`Thumbnail: ${result.renderedImagePath}`);

  // Verify files exist
  if (!fs.existsSync(result.videoPath)) {
    fail(`Video không tồn tại trên disk: ${result.videoPath}`);
    await db.$client.end().catch(() => {});
    return;
  }
  ok("Video file tồn tại trên disk ✓");

  // ── Step 5: Create contentGenerations row ─────────────────────────────
  hr();
  console.log("Step 5: Tạo content_generations row");

  const existingContent = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, result.contentId),
    columns: { id: true, formatType: true, videoStatus: true },
  });

  if (!existingContent) {
    await db.insert(contentGenerations).values({
      id: result.contentId,
      topic: item.topic,
      nicheId: niche.id,
      nicheName: niche.name,
      contentProfileKey: niche.contentProfileKey ?? "buddhism",
      channelKey: niche.channelKey ?? "phat_phap",
      script: item.quoteText,
      shortContent: item.quoteText,
      shortSelectedHook: item.quoteText,
      longContent: item.quoteText,
      experimentId: "LEGACY_QUOTE_SHORT",
      experimentVariant: "LEGACY_QUOTE_NO_VOICE_V2",
      thumbnailText: item.quoteText,
      status: "completed",
      ttsStatus: "done",
      imagesStatus: "done",
      videoStatus: "done",
      videoPath: path.relative(process.cwd(), result.videoPath),
      contentMode: "short",
      formatType: "legacy_quote_short",
    });
    ok("content_generations row tạo mới");
  } else {
    ok(`content_generations row đã tồn tại (videoStatus=${existingContent.videoStatus})`);
  }

  // Verify content row
  const contentRow = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, result.contentId),
    columns: { id: true, formatType: true, videoStatus: true, videoPath: true },
  });

  if (!contentRow) {
    fail("Không tìm thấy content row sau khi insert");
    await db.$client.end().catch(() => {});
    return;
  }
  if (contentRow.videoStatus !== "done") {
    fail(`videoStatus sai: ${contentRow.videoStatus}`);
  } else {
    ok("videoStatus = done ✓");
  }
  if (contentRow.formatType !== "legacy_quote_short") {
    fail(`formatType sai: ${contentRow.formatType}`);
  } else {
    ok("formatType = legacy_quote_short ✓");
  }

  // ── Step 6: Guard — no existing queue row ─────────────────────────────
  hr();
  console.log("Step 6: Kiểm tra dedup (không có queue row trùng)");

  const existingQueue = await db.query.uploadQueue.findFirst({
    where: and(
      eq(uploadQueue.contentId, result.contentId),
      eq(uploadQueue.channelId, TANG_SAU_CHANNEL_ID),
      eq(uploadQueue.platform, TANG_SAU_PLATFORM),
      eq(uploadQueue.videoType, "short"),
      inArray(uploadQueue.status, ["queued", "uploading", "done"]),
    ),
    columns: { id: true, status: true },
  });

  if (existingQueue) {
    fail(`Đã có queue row cho content này (id=${existingQueue.id}, status=${existingQueue.status}). Bỏ qua tạo mới.`);
    await db.$client.end().catch(() => {});
    return;
  }
  ok("Không có queue row trùng — an toàn để tạo");

  // ── Step 7: Create upload_queue row ───────────────────────────────────
  hr();
  console.log("Step 7: Tạo upload_queue row cho Tầng Sâu YouTube");

  if (scheduledAt.getTime() <= Date.now()) {
    fail("scheduledAt phải là tương lai");
    await db.$client.end().catch(() => {});
    return;
  }
  ok(`scheduledAt UTC: ${scheduledAt.toISOString()}`);
  ok(`scheduledAt VN: ${formatVn(scheduledAt)}`);

  const title = buildDefaultVideoTitle({
    platform: TANG_SAU_PLATFORM,
    contentType: "short",
    topic: item.topic,
    contentProfileKey: niche.contentProfileKey ?? "buddhism",
    shortContent: item.quoteText,
  });
  const description = buildDefaultVideoDescription({
    platform: TANG_SAU_PLATFORM,
    contentType: "short",
    topic: item.topic,
    nicheName: niche.name,
    shortContent: item.quoteText,
    longContent: item.quoteText,
    longYoutubeDescription: null,
    contentProfileKey: niche.contentProfileKey ?? "buddhism",
  });

  const [inserted] = await db.insert(uploadQueue).values({
    contentId: result.contentId,
    channelId: TANG_SAU_CHANNEL_ID,
    platform: TANG_SAU_PLATFORM,
    videoType: "short",
    title,
    description,
    tags: [],
    privacyStatus: "public",
    scheduledAt,
    status: "queued",
  }).returning({ id: uploadQueue.id });

  ok(`Queue row tạo thành công (id=${inserted.id})`);

  // ── Step 8: Post-create verification ──────────────────────────────────
  hr();
  console.log("Step 8: Xác minh sau khi tạo");

  const pendingAfterRows = await db
    .select({ id: uploadQueue.id })
    .from(uploadQueue)
    .where(inArray(uploadQueue.status, ["queued", "uploading"]));
  const pendingAfter = pendingAfterRows.length;

  ok(`Pending queue: ${pendingBefore} → ${pendingAfter} / ${threshold}`);

  const verifyQueue = await db.query.uploadQueue.findFirst({
    where: eq(uploadQueue.id, inserted.id),
    columns: { id: true, status: true, scheduledAt: true, platform: true, channelId: true, videoType: true, title: true },
  });

  if (!verifyQueue) {
    fail("Không tìm thấy queue row vừa tạo");
  } else {
    ok(`Queue id: ${verifyQueue.id}`);
    ok(`Status: ${verifyQueue.status}`);
    ok(`Platform: ${verifyQueue.platform}`);
    ok(`Channel: ${TANG_SAU_CHANNEL_NAME} (id=${verifyQueue.channelId})`);
    ok(`VideoType: ${verifyQueue.videoType}`);
    ok(`Title: ${verifyQueue.title.slice(0, 60)}…`);
    ok(`ScheduledAt VN: ${formatVn(new Date(verifyQueue.scheduledAt))}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const hasError = (process.exitCode ?? 0) !== 0;
  hr();
  console.log(`\n╔═══ KẾT QUẢ: ${hasError ? "THẤT BẠI" : "THÀNH CÔNG"} ═══╗\n`);

  if (!hasError) {
    console.log("📋 TÓM TẮT:\n");
    console.log(`  Topic:        ${item.topic}`);
    console.log(`  Quote:        "${item.quoteText}"`);
    console.log(`  contentId:    ${result.contentId}`);
    console.log(`  Video:        ${result.videoPath}`);
    console.log(`  Queue row:    ${inserted.id}`);
    console.log(`  Kênh:         ${TANG_SAU_CHANNEL_NAME} (YouTube)`);
    console.log(`  Scheduled:    ${formatVn(scheduledAt)} (VN)`);
    console.log(`  Queue depth:  ${pendingAfter} / ${threshold}`);
    console.log(`\n  ⚠️  QUAN TRỌNG:`);
    console.log(`  • Chưa có gì được upload. Cron sẽ đăng khi tới giờ.`);
    console.log(`  • Theo dõi tại /publishing (filter: Tầng Sâu)`);
    console.log(`  • Để huỷ: đổi status='cancelled' trong upload_queue (id=${inserted.id})`);
    console.log(`\n  Lệnh huỷ nếu cần:`);
    console.log(`  UPDATE upload_queue SET status='cancelled' WHERE id='${inserted.id}';\n`);
  }

  await db.$client.end().catch(() => {});
}

main().catch((err) => {
  console.error("\n❌ Unhandled error:", err);
  process.exitCode = 1;
});
