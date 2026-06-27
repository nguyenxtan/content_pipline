import "dotenv/config";

import fs from "fs";
import pg from "pg";
import { getAutoRefillConfig, runAutoRefillWatcher } from "@/lib/auto-refill-watcher";
import { getYoutubeQuoteSchedulerPolicy } from "@/lib/quotes/youtube-quote-scheduler-policy";

const { Pool } = pg;

const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
const ACTIVE_STATUSES = new Set(["queued", "uploading", "pending"]);

type QueueRow = {
  content_id: string;
  format_type: "tts_short" | "legacy_quote_short";
  platform: "youtube" | "facebook";
  video_type: string;
  status: string;
  scheduled_at: string;
};

function formatVn(value: string | Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getVnParts(value: string | Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value));

  const find = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  return {
    year: find("year"),
    month: find("month"),
    day: find("day"),
    hour: find("hour"),
    minute: find("minute"),
  };
}

function fromVnLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, 0, 0));
}

function toHourlyVnSlots(from: Date, to: Date): Date[] {
  const startParts = getVnParts(from);
  let cursor = fromVnLocal(
    startParts.year,
    startParts.month,
    startParts.day,
    startParts.minute === 0 ? startParts.hour : startParts.hour + 1,
    0,
  );

  if (cursor.getTime() < from.getTime()) {
    cursor = new Date(cursor.getTime() + 60 * 60_000);
  }

  const slots: Date[] = [];
  while (cursor.getTime() < to.getTime()) {
    const vn = getVnParts(cursor);
    if (vn.hour >= 6 && vn.hour <= 22) {
      slots.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + 60 * 60_000);
  }
  return slots;
}

function normalizeInstant(value: string | Date | null): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const autoRefillSource = fs.readFileSync("src/lib/auto-refill-watcher.ts", "utf8");
    const staticQuotePolicy = getYoutubeQuoteSchedulerPolicy("phat_phap");
    const staticQuotePolicyEnabledForPhatPhap = Boolean(staticQuotePolicy?.enabled);
    const autoRefillQuoteFallbackAvailable =
      autoRefillSource.includes("previewPhatPhapQuoteBatch(1)") &&
      autoRefillSource.includes("generatePhatPhapQuoteBatch(1)") &&
      autoRefillSource.includes('reason: "video_campaign_generated_quote_yt"') &&
      autoRefillSource.includes('reason: "video_campaign_generated_quote_fb_reel"');

    const [
      readyPool,
      lastCampaignFormat,
      activeRowsResult,
    ] = await Promise.all([
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
      pool.query<QueueRow>(`
        select
          uq.content_id,
          cg.format_type,
          uq.platform,
          uq.video_type,
          uq.status,
          uq.scheduled_at::text as scheduled_at
        from upload_queue uq
        join content_generations cg on cg.id = uq.content_id
        where cg.channel_key = 'phat_phap'
          and cg.format_type in ('tts_short', 'legacy_quote_short')
          and uq.video_type = 'short'
          and uq.status in ('queued', 'uploading', 'pending')
          and uq.scheduled_at >= now()
          and uq.scheduled_at < timestamptz '2026-06-24 00:00:00+07'
        order by uq.scheduled_at asc, uq.platform asc
      `),
    ]);

    const nextExpectedContentType =
      lastCampaignFormat.rows[0]?.format_type === "tts_short"
        ? "legacy_quote_short"
        : lastCampaignFormat.rows[0]?.format_type === "legacy_quote_short"
          ? "tts_short"
          : "tts_short";

    const autoRefill = await runAutoRefillWatcher({
      dryRun: true,
      source: "script",
    });
    const config = getAutoRefillConfig();
    const phatPhapDestination = autoRefill.destinations.find(
      (destination) => destination.destinationId === "youtube_gioi_dinh_tue",
    ) ?? null;
    const quoteDryRunPlanAvailable = autoRefill.planRows.some((row) =>
      row.destinationId === "youtube_gioi_dinh_tue" &&
      row.action === "generate_and_queue" &&
      row.formatType === "legacy_quote_short",
    );
    const quoteExecutionBlockedByLowWatermark = autoRefill.reason === "pending_above_low_watermark";

    const legacyQuoteReadyPool = readyPool.rows.find((row) => row.format_type === "legacy_quote_short") ?? null;
    const reusableLegacyQuoteCandidates = Number(legacyQuoteReadyPool?.without_short_history ?? 0);
    const readyCandidates = phatPhapDestination?.readyCandidates ?? 0;
    const candidatePoolReason =
      reusableLegacyQuoteCandidates > 0
        ? "reusable_legacy_quote_candidates_available"
        : Number(legacyQuoteReadyPool?.blocked_by_short_history ?? 0) > 0
          ? "all_legacy_quote_candidates_blocked_by_existing_short_history"
          : "no_reusable_legacy_quote_candidates_found";
    const quoteExecutionBlockedByCandidatePool =
      nextExpectedContentType === "legacy_quote_short" &&
      readyCandidates === 0;

    const activeRows = activeRowsResult.rows.filter((row) =>
      ACTIVE_STATUSES.has(row.status) &&
      row.video_type === "short",
    );
    const from = new Date();
    const to = new Date("2026-06-24T00:00:00+07:00");
    const slotReports = toHourlyVnSlots(from, to).map((slot) => {
      const slotUtc = slot.toISOString();
      const slotRows = activeRows.filter((row) => normalizeInstant(row.scheduled_at) === slotUtc);
      const distinctContentIds = [...new Set(slotRows.map((row) => row.content_id))];
      const distinctPlatformRows = new Set(slotRows.map((row) => `${row.platform}|${slotUtc}`));
      return {
        slotUtc,
        slotVn: formatVn(slot),
        rowCount: slotRows.length,
        distinctContentIds,
        distinctPlatformRows: distinctPlatformRows.size,
        clean: slotRows.length === 0,
        contentCollision: distinctContentIds.length > 1,
      };
    });
    const firstCleanContentSlot = slotReports.find((slot) => slot.clean) ?? null;
    const contentSlotCollisionExists = slotReports.some((slot) => slot.contentCollision);
    const platformSlotCollisionExists = activeRows.some((row, index) =>
      activeRows.findIndex((candidate) =>
        candidate.platform === row.platform &&
        normalizeInstant(candidate.scheduled_at) === normalizeInstant(row.scheduled_at) &&
        candidate.content_id !== row.content_id,
      ) !== index,
    );
    const plannedQuoteSlotUtc = firstCleanContentSlot?.slotUtc ?? null;
    const plannedQuoteSlotVn = firstCleanContentSlot?.slotVn ?? null;
    const quoteExecutionBlockedBySlot = !firstCleanContentSlot;

    const canAutoGenerateQuoteNow =
      autoRefillQuoteFallbackAvailable &&
      nextExpectedContentType === "legacy_quote_short" &&
      !quoteExecutionBlockedByLowWatermark &&
      !quoteExecutionBlockedBySlot &&
      !quoteExecutionBlockedByCandidatePool;

    const finalVerdict = canAutoGenerateQuoteNow
      ? "quote_auto_generation_ready_now"
      : quoteExecutionBlockedByLowWatermark
        ? "quote_auto_generation_capable_but_blocked_by_global_queue_pressure"
        : quoteExecutionBlockedBySlot
          ? "quote_auto_generation_capable_but_no_clean_content_slot_available"
          : quoteExecutionBlockedByCandidatePool
            ? "quote_auto_generation_fallback_exists_but_current_candidate_pool_is_empty"
            : autoRefillQuoteFallbackAvailable
              ? "quote_auto_generation_fallback_exists_but_current_runtime_has_no_executable_plan"
              : "quote_auto_generation_fallback_not_present";

    console.log(JSON.stringify({
      staticQuotePolicyEnabledForPhatPhap,
      autoRefillQuoteFallbackAvailable,
      quoteDryRunPlanAvailable,
      quoteExecutionBlockedByLowWatermark,
      quoteExecutionBlockedBySlot,
      quoteExecutionBlockedByCandidatePool,
      canAutoGenerateQuoteNow,
      nextExpectedContentType,
      plannedQuoteSlotUtc,
      plannedQuoteSlotVn,
      pendingBefore: autoRefill.pendingBefore,
      lowWaterMark: config.lowWaterMark,
      readyCandidates,
      reusableLegacyQuoteCandidates,
      candidatePoolReason,
      staticPolicyValue: staticQuotePolicy,
      runtime: {
        autoRefillSkipped: autoRefill.skipped,
        autoRefillReason: autoRefill.reason ?? null,
        insertBudget: autoRefill.insertBudget,
        planRows: autoRefill.planRows.filter(
          (row) => row.destinationId === "youtube_gioi_dinh_tue" || row.destinationId === "facebook_tri_tue_an_nhien",
        ),
      },
      slotGate: {
        firstCleanContentSlotUtc: firstCleanContentSlot?.slotUtc ?? null,
        firstCleanContentSlotVn: firstCleanContentSlot?.slotVn ?? null,
        contentSlotCollisionExists,
        platformSlotCollisionExists,
      },
      candidatePool: {
        destinationReadyCandidates: readyCandidates,
        legacyQuoteReadyPool: legacyQuoteReadyPool ?? null,
      },
      wording: {
        staticQuoteSchedulerPolicyEnabled:
          "Whether phat_phap has a dedicated static YouTube quote scheduler policy. This can be false while auto-refill fallback still exists.",
        autoRefillQuoteFallbackAvailable:
          "Whether auto-refill source code contains the scoped phat_phap generate-and-queue fallback for legacy_quote_short.",
        canAutoGenerateQuoteNow:
          "Whether the system could actually enqueue a new phat_phap quote video right now after policy, queue pressure, slot gate, and candidate pool are all considered together.",
      },
      finalVerdict,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
