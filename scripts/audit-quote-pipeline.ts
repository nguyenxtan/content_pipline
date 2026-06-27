import "dotenv/config";

import pg from "pg";
import { getYoutubeQuoteSchedulerPolicy } from "@/lib/quotes/youtube-quote-scheduler-policy";

const { Pool } = pg;

type QueueAuditRow = {
  id: string;
  status: string;
  scheduled_at: string;
  uploaded_at: string | null;
  channel_key: string | null;
  platform: string;
  video_type: string;
  content_id: string;
  format_type: string | null;
  prompt_versions: Record<string, unknown> | null;
};

type SchedulerJobRow = {
  id: string;
  job_type: string;
  channel_key: string | null;
  is_enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
};

type TangSauTtsContaminationRow = {
  id: string;
  created_at: string;
  topic: string;
  content_profile_key: string | null;
  topic_family: string | null;
  tts_route: string | null;
  tts_use_case: string | null;
};

type CrossChannelIncidentRow = {
  upload_queue_id: string | null;
  published_video_id: string | null;
  status: string | null;
  destination_channel_id: number;
  destination_channel_key: string | null;
  destination_channel_name: string | null;
  content_id: string;
  content_channel_key: string | null;
  content_niche_id: number | null;
  content_niche_name: string | null;
  format_type: string | null;
  video_type: string | null;
  platform: string | null;
  scheduled_at: string | null;
  uploaded_at: string | null;
  published_at: string | null;
  platform_video_url: string | null;
};

function readQuoteDetails(promptVersions: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!promptVersions || typeof promptVersions !== "object") return null;
  const quote = (promptVersions as { quote?: { details?: Record<string, unknown> } }).quote;
  return quote?.details && typeof quote.details === "object" ? quote.details : null;
}

function formatMaybeDate(value: string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function summarizeBreakdown(rows: QueueAuditRow[], key: "quoteSourceType" | "quoteStyle") {
  const breakdown = new Map<string, number>();
  for (const row of rows) {
    const details = readQuoteDetails(row.prompt_versions);
    const raw = details?.[key];
    const label = typeof raw === "string" && raw.trim() ? raw.trim() : "unknown";
    breakdown.set(label, (breakdown.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...breakdown.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function computeCadenceCheck(rows: QueueAuditRow[]) {
  const activeRows = rows.filter((row) => ["queued", "uploading", "done"].includes(row.status));
  const mismatches = activeRows.filter((row) => new Date(row.scheduled_at).getUTCMinutes() !== 5);
  return {
    checked: activeRows.length,
    hh05Compliant: mismatches.length === 0,
    mismatchCount: mismatches.length,
    mismatchIds: mismatches.slice(0, 10).map((row) => row.id),
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [
      phatPhapFbQuoteRows,
      phatPhapLegacyCounts,
      tangSauLegacyCounts,
      tangSauNewestGenerated,
      tangSauNewestPublished,
      tangSauNextQueued,
      tangSauFbChannels,
      tangSauRecentTtsContamination,
      schedulerJobs,
      channelPublishConfigs,
      autoRefillState,
      crossChannelQueueAudit,
      crossChannelPublishedAudit,
      crossChannelQueueDetails,
      crossChannelPublishedDetails,
    ] = await Promise.all([
      pool.query<QueueAuditRow>(`
        select
          uq.id,
          uq.status,
          uq.scheduled_at,
          uq.uploaded_at,
          sc.channel_key,
          uq.platform,
          uq.video_type,
          uq.content_id,
          cg.format_type,
          cg.prompt_versions
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        join content_generations cg on cg.id = uq.content_id
        where sc.channel_key = 'phat_phap'
          and uq.platform = 'facebook'
          and uq.video_type = 'quote'
        order by uq.scheduled_at desc
      `),
      pool.query<{ content_count: string; queue_count: string; upcoming_queue_count: string }>(`
        select
          (select count(*)::text from content_generations where channel_key = 'phat_phap' and format_type = 'legacy_quote_short') as content_count,
          (select count(*)::text from upload_queue uq join social_channels sc on sc.id = uq.channel_id join content_generations cg on cg.id = uq.content_id where sc.channel_key = 'phat_phap' and uq.platform = 'youtube' and cg.format_type = 'legacy_quote_short') as queue_count,
          (select count(*)::text from upload_queue uq join social_channels sc on sc.id = uq.channel_id join content_generations cg on cg.id = uq.content_id where sc.channel_key = 'phat_phap' and uq.platform = 'youtube' and cg.format_type = 'legacy_quote_short' and uq.status in ('queued','uploading') and uq.scheduled_at >= now()) as upcoming_queue_count
      `),
      pool.query<{ content_count: string; queue_count: string; upcoming_queue_count: string }>(`
        select
          (select count(*)::text from content_generations where channel_key = 'tang_sau' and format_type = 'legacy_quote_short') as content_count,
          (select count(*)::text from upload_queue uq join social_channels sc on sc.id = uq.channel_id join content_generations cg on cg.id = uq.content_id where sc.channel_key = 'tang_sau' and uq.platform = 'youtube' and cg.format_type = 'legacy_quote_short') as queue_count,
          (select count(*)::text from upload_queue uq join social_channels sc on sc.id = uq.channel_id join content_generations cg on cg.id = uq.content_id where sc.channel_key = 'tang_sau' and uq.platform = 'youtube' and cg.format_type = 'legacy_quote_short' and uq.status in ('queued','uploading') and uq.scheduled_at >= now()) as upcoming_queue_count
      `),
      pool.query<{ id: string; created_at: string; prompt_versions: Record<string, unknown> | null }>(`
        select id, created_at::text, prompt_versions
        from content_generations
        where channel_key = 'tang_sau' and format_type = 'legacy_quote_short'
        order by created_at desc
        limit 1
      `),
      pool.query<{ id: string; uploaded_at: string; scheduled_at: string }>(`
        select uq.id, uq.uploaded_at::text, uq.scheduled_at::text
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        join content_generations cg on cg.id = uq.content_id
        where sc.channel_key = 'tang_sau'
          and uq.platform = 'youtube'
          and uq.status = 'done'
          and cg.format_type = 'legacy_quote_short'
        order by coalesce(uq.uploaded_at, uq.scheduled_at) desc
        limit 1
      `),
      pool.query<{ id: string; scheduled_at: string }>(`
        select uq.id, uq.scheduled_at::text
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        join content_generations cg on cg.id = uq.content_id
        where sc.channel_key = 'tang_sau'
          and uq.platform = 'youtube'
          and uq.status = 'queued'
          and cg.format_type = 'legacy_quote_short'
          and uq.scheduled_at >= now()
        order by uq.scheduled_at asc
        limit 1
      `),
      pool.query<{ id: number; name: string; is_active: boolean }>(`
        select id, name, is_active
        from social_channels
        where channel_key = 'tang_sau' and platform = 'facebook'
        order by id asc
      `),
      pool.query<TangSauTtsContaminationRow>(`
        select
          cg.id,
          cg.created_at::text,
          cg.topic,
          cg.content_profile_key,
          cg.topic_family,
          cg.prompt_versions #>> '{tts,details,ttsRoute}' as tts_route,
          cg.prompt_versions #>> '{tts,details,ttsRecommendedUseCase}' as tts_use_case
        from content_generations cg
        where cg.channel_key = 'tang_sau'
          and cg.format_type = 'tts_short'
        order by cg.created_at desc
        limit 20
      `),
      pool.query<SchedulerJobRow>(`
        select
          csj.id,
          csj.job_type,
          n.channel_key,
          csj.is_enabled,
          csj.last_run_at::text,
          csj.next_run_at::text
        from content_scheduler_jobs csj
        join niches n on n.id = csj.niche_id
        where n.channel_key in ('phat_phap', 'tang_sau')
        order by n.channel_key asc, csj.job_type asc
      `),
      pool.query<{ value: string | null }>(`
        select value
        from app_config
        where key = 'channel_publish_configs_v1'
        limit 1
      `),
      pool.query<{ value: string | null }>(`
        select value
        from app_config
        where key = 'auto_refill_watcher_state'
        limit 1
      `),
      pool.query<{ total: string; active_total: string }>(`
        select
          count(*)::text as total,
          count(*) filter (where uq.status in ('queued','uploading'))::text as active_total
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        join content_generations cg on cg.id = uq.content_id
        where sc.channel_key <> cg.channel_key
      `),
      pool.query<{ total: string }>(`
        select count(*)::text as total
        from published_videos pv
        join social_channels sc on sc.id = pv.credential_channel_id
        join content_generations cg on cg.id = pv.content_id
        where sc.channel_key <> cg.channel_key
      `),
      pool.query<CrossChannelIncidentRow>(`
        select
          uq.id as upload_queue_id,
          null::text as published_video_id,
          uq.status,
          sc.id as destination_channel_id,
          sc.channel_key as destination_channel_key,
          sc.name as destination_channel_name,
          cg.id as content_id,
          cg.channel_key as content_channel_key,
          cg.niche_id as content_niche_id,
          cg.niche_name as content_niche_name,
          cg.format_type,
          uq.video_type,
          uq.platform,
          uq.scheduled_at::text,
          uq.uploaded_at::text,
          null::text as published_at,
          null::text as platform_video_url
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        join content_generations cg on cg.id = uq.content_id
        where sc.channel_key <> cg.channel_key
        order by
          case when uq.status in ('queued','uploading') then 0 else 1 end,
          coalesce(uq.uploaded_at, uq.scheduled_at) desc
        limit 10
      `),
      pool.query<CrossChannelIncidentRow>(`
        select
          pv.upload_queue_id as upload_queue_id,
          pv.id as published_video_id,
          uq.status,
          sc.id as destination_channel_id,
          sc.channel_key as destination_channel_key,
          sc.name as destination_channel_name,
          cg.id as content_id,
          cg.channel_key as content_channel_key,
          cg.niche_id as content_niche_id,
          cg.niche_name as content_niche_name,
          cg.format_type,
          uq.video_type,
          coalesce(uq.platform, sc.platform) as platform,
          uq.scheduled_at::text,
          uq.uploaded_at::text,
          pv.published_at::text,
          pv.platform_video_url
        from published_videos pv
        join social_channels sc on sc.id = pv.credential_channel_id
        join content_generations cg on cg.id = pv.content_id
        left join upload_queue uq on uq.id = pv.upload_queue_id
        where sc.channel_key <> cg.channel_key
        order by pv.published_at desc
        limit 10
      `),
    ]);

    const fbRows = phatPhapFbQuoteRows.rows;
    const newestDone = fbRows
      .filter((row) => row.status === "done" && row.uploaded_at)
      .sort((a, b) => new Date(b.uploaded_at!).getTime() - new Date(a.uploaded_at!).getTime())[0];
    const nextQueued = fbRows
      .filter((row) => row.status === "queued")
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
    const kineticKnownRows = fbRows
      .map((row) => readQuoteDetails(row.prompt_versions))
      .filter((details): details is Record<string, unknown> => Boolean(details && Object.prototype.hasOwnProperty.call(details, "kinetic")));
    const kineticFalseCount = kineticKnownRows.filter((details) => details.kinetic === false).length;

    const tangSauPolicy = getYoutubeQuoteSchedulerPolicy("tang_sau");
    const tangSauQuoteJob = schedulerJobs.rows.find(
      (row) => row.channel_key === "tang_sau" && row.job_type === "quote_pipeline",
    ) ?? null;
    const runtimeConfigRaw = channelPublishConfigs.rows[0]?.value
      ? JSON.parse(channelPublishConfigs.rows[0]!.value!)
      : null;
    const tangSauRuntimeConfig = runtimeConfigRaw && typeof runtimeConfigRaw === "object"
      ? (runtimeConfigRaw as Record<string, unknown>).tang_sau as Record<string, unknown> | undefined
      : undefined;
    const autoRefillStateRaw = autoRefillState.rows[0]?.value
      ? JSON.parse(autoRefillState.rows[0]!.value!)
      : null;
    const newestGeneratedDetails = readQuoteDetails(tangSauNewestGenerated.rows[0]?.prompt_versions ?? null);
    const tangSauUpcomingQueued = Number(tangSauLegacyCounts.rows[0]?.upcoming_queue_count ?? 0);

    const tangSauReason = tangSauUpcomingQueued > 0
      ? "upcoming_quote_rows_present"
      : tangSauQuoteJob
        ? "quote_lane_enabled_but_future_rows_empty"
        : autoRefillStateRaw && typeof autoRefillStateRaw === "object"
          ? String((autoRefillStateRaw as Record<string, unknown>).reason ?? "no_quote_lane_visible")
          : "no_quote_lane_visible";

    const payload = {
      generatedAt: new Date().toISOString(),
      phatPhapFacebookQuotePhoto: {
        role: "secondary_sidecar",
        countsByStatus: {
          queued: fbRows.filter((row) => row.status === "queued").length,
          uploading: fbRows.filter((row) => row.status === "uploading").length,
          done: fbRows.filter((row) => row.status === "done").length,
          failed: fbRows.filter((row) => row.status === "error").length,
          cancelled: fbRows.filter((row) => row.status === "cancelled").length,
        },
        newestDone: newestDone
          ? { id: newestDone.id, uploadedAt: formatMaybeDate(newestDone.uploaded_at) }
          : null,
        nextQueued: nextQueued
          ? { id: nextQueued.id, scheduledAt: new Date(nextQueued.scheduled_at).toISOString() }
          : null,
        cadenceCheck: computeCadenceCheck(fbRows),
        quoteSourceTypeBreakdown: summarizeBreakdown(fbRows, "quoteSourceType"),
        quoteStyleBreakdown: summarizeBreakdown(fbRows, "quoteStyle"),
        kineticFalseCompliance: {
          knownRows: kineticKnownRows.length,
          kineticFalseRows: kineticFalseCount,
          fullyCompliant: kineticKnownRows.length === 0 ? null : kineticFalseCount === kineticKnownRows.length,
        },
      },
      phatPhapYouTubeLegacyQuoteShort: phatPhapLegacyCounts.rows[0] ?? null,
      tangSauYouTubeLegacyQuoteShort: {
        ...(tangSauLegacyCounts.rows[0] ?? null),
        newestGenerated: tangSauNewestGenerated.rows[0]
          ? {
              id: tangSauNewestGenerated.rows[0].id,
              createdAt: formatMaybeDate(tangSauNewestGenerated.rows[0].created_at),
              quoteStyle: newestGeneratedDetails?.quoteStyle ?? "unknown",
              kinetic: newestGeneratedDetails?.kinetic ?? "unknown",
              quoteSourceType: newestGeneratedDetails?.quoteSourceType ?? "unknown",
            }
          : null,
        newestPublished: tangSauNewestPublished.rows[0]
          ? {
              id: tangSauNewestPublished.rows[0].id,
              uploadedAt: formatMaybeDate(tangSauNewestPublished.rows[0].uploaded_at),
              scheduledAt: formatMaybeDate(tangSauNewestPublished.rows[0].scheduled_at),
            }
          : null,
        nextQueued: tangSauNextQueued.rows[0]
          ? {
              id: tangSauNextQueued.rows[0].id,
              scheduledAt: formatMaybeDate(tangSauNextQueued.rows[0].scheduled_at),
            }
          : null,
      },
      tangSauTtsShortAudit: {
        recentCount: tangSauRecentTtsContamination.rows.length,
        buddhismProfileCount: tangSauRecentTtsContamination.rows.filter((row) => row.content_profile_key === "buddhism").length,
        phatPhapTopicFamilyCount: tangSauRecentTtsContamination.rows.filter((row) => row.topic_family === "buong_bo_chua_lanh").length,
        phatPhapUseCaseCount: tangSauRecentTtsContamination.rows.filter((row) => row.tts_use_case === "phat_phap_short").length,
        newestRows: tangSauRecentTtsContamination.rows.slice(0, 5).map((row) => ({
          id: row.id,
          createdAt: formatMaybeDate(row.created_at),
          topic: row.topic,
          contentProfileKey: row.content_profile_key,
          topicFamily: row.topic_family,
          ttsRoute: row.tts_route,
          ttsRecommendedUseCase: row.tts_use_case,
        })),
      },
      tangSauQuoteSchedulerLane: {
        enabled: tangSauPolicy?.enabled ?? false,
        primaryPlatform: tangSauPolicy?.primaryPlatform ?? "youtube",
        schedulingTarget: "shortDestinations",
        requiresQuoteDestinations: false,
        targetPerDay: tangSauPolicy?.targetPerDay ?? 0,
        targetUpcomingQueueRows: tangSauPolicy?.targetUpcomingQueueRows ?? 0,
        maxQueueInsertPerRun: tangSauPolicy?.maxQueueInsertPerRun ?? 0,
        quoteStyle: tangSauPolicy?.quoteStyle ?? "unknown",
        kinetic: tangSauPolicy?.kinetic ?? null,
        schedulerJobId: tangSauQuoteJob?.id ?? null,
        nextRunAt: formatMaybeDate(tangSauQuoteJob?.next_run_at ?? null),
        runnerConsumesJobType: Boolean(tangSauQuoteJob),
        runtimeConfigPresent: Boolean(tangSauRuntimeConfig),
        autoScheduleEnabled: tangSauRuntimeConfig?.autoScheduleEnabled ?? false,
        shortDestinationCount: Array.isArray(tangSauRuntimeConfig?.shortDestinations)
          ? tangSauRuntimeConfig.shortDestinations.length
          : 0,
        quoteDestinationCount: Array.isArray(tangSauRuntimeConfig?.quoteDestinations)
          ? tangSauRuntimeConfig.quoteDestinations.length
          : 0,
        reasonUpcomingQueuedIsZero: tangSauReason,
        schedulingTargetMismatch: false,
        warning: tangSauPolicy && !tangSauQuoteJob
          ? "Policy exists but no quote_pipeline scheduler job is configured."
          : null,
      },
      tangSauFacebookQuotePhoto: tangSauFbChannels.rows.length > 0
        ? {
            status: "configured_channel_exists",
            channels: tangSauFbChannels.rows,
          }
        : {
            status: "intentionally_unsupported",
            message: "tang_sau Facebook quote/photo remains intentionally unsupported in this phase.",
          },
      schedulerVisibility: {
        jobs: schedulerJobs.rows,
      },
      crossChannelSafety: {
        queueMismatchTotal: Number(crossChannelQueueAudit.rows[0]?.total ?? 0),
        activeQueueMismatchTotal: Number(crossChannelQueueAudit.rows[0]?.active_total ?? 0),
        publishedMismatchTotal: Number(crossChannelPublishedAudit.rows[0]?.total ?? 0),
        activeRiskState: Number(crossChannelQueueAudit.rows[0]?.active_total ?? 0) > 0
          ? "active_risk"
          : Number(crossChannelPublishedAudit.rows[0]?.total ?? 0) > 0 || Number(crossChannelQueueAudit.rows[0]?.total ?? 0) > 0
            ? "historical_only"
            : "clean",
        queueMismatches: crossChannelQueueDetails.rows.map((row) => ({
          uploadQueueId: row.upload_queue_id,
          status: row.status,
          destinationChannelId: row.destination_channel_id,
          destinationChannelKey: row.destination_channel_key,
          destinationChannelName: row.destination_channel_name,
          contentId: row.content_id,
          contentChannelKey: row.content_channel_key,
          contentNicheId: row.content_niche_id,
          contentNicheName: row.content_niche_name,
          formatType: row.format_type,
          videoType: row.video_type,
          platform: row.platform,
          scheduledAt: formatMaybeDate(row.scheduled_at),
          uploadedAt: formatMaybeDate(row.uploaded_at),
        })),
        publishedMismatches: crossChannelPublishedDetails.rows.map((row) => ({
          publishedVideoId: row.published_video_id,
          uploadQueueId: row.upload_queue_id,
          status: row.status,
          destinationChannelId: row.destination_channel_id,
          destinationChannelKey: row.destination_channel_key,
          destinationChannelName: row.destination_channel_name,
          contentId: row.content_id,
          contentChannelKey: row.content_channel_key,
          contentNicheId: row.content_niche_id,
          contentNicheName: row.content_niche_name,
          formatType: row.format_type,
          videoType: row.video_type,
          platform: row.platform,
          scheduledAt: formatMaybeDate(row.scheduled_at),
          uploadedAt: formatMaybeDate(row.uploaded_at),
          publishedAt: formatMaybeDate(row.published_at),
          platformVideoUrl: row.platform_video_url,
        })),
      },
    };

    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
