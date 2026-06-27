import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {

  // ── 1. All social channels ──────────────────────────────────────────────────
  const channels = await db.execute(sql`
    SELECT id, name, platform, channel_key, is_active, needs_reconnect,
           token_expires_at, last_error,
           left(access_token, 10) as token_prefix
    FROM social_channels ORDER BY channel_key, platform
  `);
  console.log("CHANNELS:", JSON.stringify(channels.rows, null, 2));

  // ── 2. Upload queue — phat_phap (all statuses, full picture) ───────────────
  const ppQueue = await db.execute(sql`
    SELECT
      uq.id as uq_id,
      uq.content_id,
      uq.channel_id,
      sc.platform,
      sc.name as channel_name,
      sc.channel_key,
      uq.video_type,
      uq.status,
      uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as scheduled_vn,
      uq.uploaded_at,
      uq.error_message,
      cg.topic,
      cg.format_type,
      cg.topic_family,
      cg.tts_status,
      cg.video_status,
      cg.video_path,
      cg.created_at as content_created_at
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    JOIN content_generations cg ON uq.content_id = cg.id
    WHERE sc.channel_key IN ('phat_phap','tang_sau')
    ORDER BY cg.created_at DESC, uq.scheduled_at ASC
  `);
  console.log("PP_QUEUE:", JSON.stringify(ppQueue.rows, null, 2));

  // ── 3. Content without any queue entry ─────────────────────────────────────
  const noQueue = await db.execute(sql`
    SELECT
      cg.id,
      cg.topic,
      cg.format_type,
      cg.channel_key,
      cg.video_status,
      cg.tts_status,
      cg.video_path,
      cg.created_at
    FROM content_generations cg
    WHERE cg.channel_key IN ('phat_phap','tang_sau')
      AND cg.video_status IN ('done','pending')
      AND cg.id NOT IN (SELECT content_id FROM upload_queue)
    ORDER BY cg.created_at DESC
    LIMIT 40
  `);
  console.log("NO_QUEUE:", JSON.stringify(noQueue.rows, null, 2));

  // ── 4. Content with queue on only ONE platform (misaligned) ────────────────
  const misaligned = await db.execute(sql`
    SELECT
      cg.id as content_id,
      cg.topic,
      cg.format_type,
      cg.channel_key,
      count(DISTINCT sc.platform) as platform_count,
      array_agg(DISTINCT sc.platform ORDER BY sc.platform) as platforms,
      array_agg(DISTINCT uq.status ORDER BY uq.status) as statuses,
      min(uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as earliest_vn,
      max(uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as latest_vn,
      extract(epoch from (
        max(uq.scheduled_at) - min(uq.scheduled_at)
      ))/3600.0 as drift_hours
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    JOIN content_generations cg ON uq.content_id = cg.id
    WHERE sc.channel_key IN ('phat_phap','tang_sau')
      AND uq.status IN ('queued','pending')
    GROUP BY cg.id, cg.topic, cg.format_type, cg.channel_key
    ORDER BY cg.created_at DESC
  `);
  console.log("MISALIGNED:", JSON.stringify(misaligned.rows, null, 2));

  // ── 5. Tang Sau deep dive ───────────────────────────────────────────────────
  const tsContent = await db.execute(sql`
    SELECT
      format_type,
      video_status,
      tts_status,
      count(*) as cnt
    FROM content_generations
    WHERE channel_key = 'tang_sau'
    GROUP BY format_type, video_status, tts_status
    ORDER BY cnt DESC
  `);
  console.log("TANG_SAU_CONTENT_STATS:", JSON.stringify(tsContent.rows, null, 2));

  const tsQueue = await db.execute(sql`
    SELECT
      uq.id, uq.content_id, uq.channel_id,
      sc.name, sc.platform, sc.is_active, sc.needs_reconnect,
      uq.status, uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as scheduled_vn,
      uq.error_message,
      cg.topic, cg.format_type, cg.video_status
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    JOIN content_generations cg ON uq.content_id = cg.id
    WHERE sc.channel_key = 'tang_sau'
    ORDER BY uq.scheduled_at ASC
    LIMIT 20
  `);
  console.log("TANG_SAU_QUEUE:", JSON.stringify(tsQueue.rows, null, 2));

  // ── 6. phat_phap quote_short items specifically ────────────────────────────
  const quoteItems = await db.execute(sql`
    SELECT
      cg.id,
      cg.topic,
      cg.format_type,
      cg.video_status,
      cg.video_path,
      cg.topic_family,
      cg.created_at,
      count(uq.id) as queue_count,
      array_agg(sc.platform ORDER BY sc.platform) FILTER (WHERE uq.id IS NOT NULL) as platforms,
      array_agg(uq.status ORDER BY sc.platform) FILTER (WHERE uq.id IS NOT NULL) as queue_statuses,
      array_agg(uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh' ORDER BY sc.platform)
        FILTER (WHERE uq.id IS NOT NULL) as scheduled_vn_list
    FROM content_generations cg
    LEFT JOIN upload_queue uq ON uq.content_id = cg.id
    LEFT JOIN social_channels sc ON uq.channel_id = sc.id
    WHERE cg.channel_key = 'phat_phap'
      AND cg.format_type = 'legacy_quote_short'
    GROUP BY cg.id, cg.topic, cg.format_type, cg.video_status, cg.video_path, cg.topic_family, cg.created_at
    ORDER BY cg.created_at DESC
    LIMIT 30
  `);
  console.log("QUOTE_ITEMS:", JSON.stringify(quoteItems.rows, null, 2));

  // ── 7. Scheduled queue slots by day/hour (VN time) — phat_phap ─────────────
  const schedule = await db.execute(sql`
    SELECT
      date_trunc('hour', uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as slot_vn,
      sc.platform,
      sc.name,
      uq.status,
      count(*) as cnt,
      array_agg(left(cg.topic, 30) ORDER BY uq.scheduled_at) as topics
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    JOIN content_generations cg ON uq.content_id = cg.id
    WHERE sc.channel_key = 'phat_phap'
      AND uq.status IN ('queued','pending')
      AND uq.scheduled_at >= now() - interval '1 day'
    GROUP BY slot_vn, sc.platform, sc.name, uq.status
    ORDER BY slot_vn ASC, sc.platform ASC
  `);
  console.log("SCHEDULE_SLOTS:", JSON.stringify(schedule.rows, null, 2));

  // ── 8. auto_schedule_settings ──────────────────────────────────────────────
  const sched = await db.execute(sql`
    SELECT value FROM app_config WHERE key = 'auto_schedule_settings'
  `);
  console.log("AUTO_SCHEDULE_SETTINGS:", JSON.stringify(sched.rows, null, 2));

  // ── 9. phat_phap done/published summary ───────────────────────────────────
  const ppSummary = await db.execute(sql`
    SELECT
      uq.status,
      sc.platform,
      sc.name,
      count(*) as cnt,
      min(uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as earliest_vn,
      max(uq.scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') as latest_vn
    FROM upload_queue uq
    JOIN social_channels sc ON uq.channel_id = sc.id
    WHERE sc.channel_key = 'phat_phap'
    GROUP BY uq.status, sc.platform, sc.name
    ORDER BY uq.status, sc.platform
  `);
  console.log("PP_QUEUE_SUMMARY:", JSON.stringify(ppSummary.rows, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
