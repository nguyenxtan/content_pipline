import "dotenv/config";

import fs from "fs";
import pg from "pg";
import { getYoutubeQuoteSchedulerPolicy } from "@/lib/quotes/youtube-quote-scheduler-policy";
import { runAutoRefillWatcher } from "@/lib/auto-refill-watcher";

const { Pool } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const [
      contentMix,
      recentQuotes,
      recentTts,
      futureUploads,
      schedulerJobs,
      readyPool,
      lastCampaignFormat,
    ] = await Promise.all([
      pool.query(`
        select
          coalesce(format_type, '(null)') as format_type,
          coalesce(status, '(null)') as status,
          count(*)::text as count
        from content_generations
        where channel_key = 'phat_phap'
          and created_at >= timestamptz '2026-06-20 00:00:00+07'
          and created_at <  timestamptz '2026-06-22 00:00:00+07'
        group by coalesce(format_type, '(null)'), coalesce(status, '(null)')
        order by 1, 2
      `),
      pool.query(`
        select
          id,
          format_type,
          status,
          topic,
          created_at,
          video_path
        from content_generations
        where channel_key = 'phat_phap'
          and format_type = 'legacy_quote_short'
        order by created_at desc
        limit 10
      `),
      pool.query(`
        select
          id,
          format_type,
          status,
          topic,
          created_at,
          video_path
        from content_generations
        where channel_key = 'phat_phap'
          and format_type = 'tts_short'
        order by created_at desc
        limit 10
      `),
      pool.query(`
        select
          uq.platform,
          uq.video_type,
          uq.status,
          count(*)::text as count
        from upload_queue uq
        join content_generations cg on cg.id = uq.content_id
        where cg.channel_key = 'phat_phap'
          and uq.scheduled_at >= now()
        group by uq.platform, uq.video_type, uq.status
        order by uq.platform, uq.video_type, uq.status
      `),
      pool.query(`
        select
          csj.id,
          csj.job_type,
          csj.frequency,
          csj.next_run_at,
          csj.last_run_at,
          n.name as niche_name
        from content_scheduler_jobs csj
        join niches n on n.id = csj.niche_id
        where n.channel_key = 'phat_phap'
        order by csj.job_type, csj.id
      `),
      pool.query(`
        with sibling_channels as (
          select id
          from social_channels
          where platform = 'youtube'
            and platform_channel_id = (
              select platform_channel_id
              from social_channels
              where id = 2
            )
        ),
        ready as (
          select id, format_type, topic, created_at, video_path
          from content_generations
          where channel_key = 'phat_phap'
            and video_status = 'done'
            and media_cleaned_at is null
            and format_type in ('tts_short', 'legacy_quote_short')
        ),
        short_history as (
          select distinct uq.content_id
          from upload_queue uq
          where uq.channel_id in (select id from sibling_channels)
            and uq.video_type = 'short'
            and uq.status in ('queued', 'uploading', 'done', 'cancelled')
        )
        select
          r.format_type,
          count(*)::text as ready_total,
          count(*) filter (where r.video_path is not null)::text as with_video_path,
          count(*) filter (where r.video_path is not null and sh.content_id is null)::text as without_short_history,
          count(*) filter (where r.video_path is not null and sh.content_id is not null)::text as blocked_by_short_history
        from ready r
        left join short_history sh on sh.content_id = r.id
        group by r.format_type
        order by r.format_type
      `),
      pool.query(`
        with sibling_channels as (
          select id
          from social_channels
          where platform = 'youtube'
            and platform_channel_id = (
              select platform_channel_id
              from social_channels
              where id = 2
            )
        )
        select cg.format_type
        from upload_queue uq
        join content_generations cg on cg.id = uq.content_id
        where uq.channel_id in (select id from sibling_channels)
          and uq.video_type = 'short'
          and uq.status in ('queued', 'uploading')
          and uq.scheduled_at >= now()
        order by uq.scheduled_at desc, uq.created_at desc
        limit 1
      `),
    ]);

    const autoRefill = await runAutoRefillWatcher({
      dryRun: true,
      source: "script",
    });
    const phatPhapDestination = autoRefill.destinations.find(
      (destination) => destination.destinationId === "youtube_gioi_dinh_tue",
    ) ?? null;
    const quotePolicy = getYoutubeQuoteSchedulerPolicy("phat_phap");
    const autoRefillSource = fs.readFileSync("src/lib/auto-refill-watcher.ts", "utf8");
    const nextExpectedContentType =
      lastCampaignFormat.rows[0]?.format_type === "tts_short"
        ? "legacy_quote_short"
        : lastCampaignFormat.rows[0]?.format_type === "legacy_quote_short"
          ? "tts_short"
          : "tts_short";
    const staticQuotePolicyEnabledForPhatPhap = Boolean(quotePolicy?.enabled);
    const autoRefillQuoteFallbackAvailable =
      autoRefillSource.includes("previewPhatPhapQuoteBatch(1)") &&
      autoRefillSource.includes("generatePhatPhapQuoteBatch(1)") &&
      autoRefillSource.includes('reason: "video_campaign_generated_quote_yt"') &&
      autoRefillSource.includes('reason: "video_campaign_generated_quote_fb_reel"');
    const quoteDryRunPlanAvailable = autoRefill.planRows.some((row) =>
      row.destinationId === "youtube_gioi_dinh_tue" &&
      row.action === "generate_and_queue" &&
      row.formatType === "legacy_quote_short",
    );
    const quoteExecutionBlockedByLowWatermark = autoRefill.reason === "pending_above_low_watermark";
    const quoteExecutionBlockedByCandidatePool =
      nextExpectedContentType === "legacy_quote_short" &&
      (phatPhapDestination?.readyCandidates ?? 0) === 0;
    const canAutoGenerateQuoteNow =
      autoRefillQuoteFallbackAvailable &&
      nextExpectedContentType === "legacy_quote_short" &&
      !quoteExecutionBlockedByLowWatermark &&
      autoRefill.planRows.some((row) =>
        row.destinationId === "youtube_gioi_dinh_tue" &&
        row.formatType === "legacy_quote_short",
      );

    const diagnosis: string[] = [];
    if (!autoRefillQuoteFallbackAvailable) diagnosis.push("quote_fallback_missing_in_auto_refill");
    if ((phatPhapDestination?.readyCandidates ?? 0) === 0) diagnosis.push("stale_queue_rows_blocking");
    if (quoteExecutionBlockedByLowWatermark) diagnosis.push("blocked_by_low_watermark");
    if (nextExpectedContentType === "legacy_quote_short" && !quoteDryRunPlanAvailable) {
      diagnosis.push("no_generate_and_queue_plan_visible_in_current_dry_run");
    }
    if (contentMix.rows.every((row) => row.format_type !== "legacy_quote_short")) diagnosis.push("fallback_to_tts_only");

    console.log(JSON.stringify({
      window: {
        from: "2026-06-20T00:00:00+07:00",
        to: "2026-06-22T00:00:00+07:00",
      },
      publishingWindow: {
        youtubeGioiDinhTue: phatPhapDestination?.postingWindow ?? null,
        facebookTriTueAnNhien: autoRefill.destinations.find(
          (destination) => destination.destinationId === "facebook_tri_tue_an_nhien",
        )?.postingWindow ?? null,
      },
      expectedAlternatingMix: ["tts_short", "legacy_quote_short"],
      nextExpectedContentType,
      staticQuotePolicyEnabledForPhatPhap,
      autoRefillQuoteFallbackAvailable,
      quoteDryRunPlanAvailable,
      quoteExecutionBlockedByLowWatermark,
      quoteExecutionBlockedByCandidatePool,
      canAutoGenerateQuoteNow,
      phatPhapQuoteSchedulerPolicy: quotePolicy,
      schedulerJobs: schedulerJobs.rows,
      actualRecentContentRows: {
        mix: contentMix.rows,
        recentQuotes: recentQuotes.rows,
        recentTts: recentTts.rows,
      },
      actualScheduledUploadRows: futureUploads.rows,
      readyPool: readyPool.rows,
      autoRefillDryRun: {
        skipped: autoRefill.skipped,
        reason: autoRefill.reason ?? null,
        pendingBefore: autoRefill.pendingBefore,
        insertBudget: autoRefill.insertBudget,
        generatedCount: autoRefill.generatedCount,
        generatedContentIds: autoRefill.generatedContentIds,
        phatPhapDestination,
        planRows: autoRefill.planRows.filter(
          (row) => row.destinationId === "youtube_gioi_dinh_tue" || row.destinationId === "facebook_tri_tue_an_nhien",
        ),
      },
      nextGenerationDecisionIfRunNow: autoRefill.skipped
        ? {
            action: "skip",
            reason: autoRefill.reason ?? "unknown",
            nextExpectedContentType,
          }
        : {
            action: autoRefill.planRows[0]?.action ?? "none",
            formatType: autoRefill.planRows[0]?.formatType ?? null,
            nextExpectedContentType,
          },
      diagnosis,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
