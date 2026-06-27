import "dotenv/config";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentSchedulerJobs, socialChannels } from "@/lib/db/schema";
import { getChannelPublishConfig } from "@/lib/config/channel-configs";
import { getContentProfile } from "@/lib/config/content-profiles";
import { getTangSauIsolationViolation } from "@/lib/content-profile-isolation";
import { DEFAULT_PSYCHOLOGY_SHORT_PROMPT } from "@/lib/content-prompts";
import { resolveQuoteSchedulingTarget } from "@/lib/quotes/quote-scheduling-target";

type TargetJob = {
  id: string;
  jobType: "content_gen" | "short_pipeline" | "quote_pipeline";
};

type RuntimePreflight = {
  activeContaminatedCount: number;
  activeCrossChannelMismatchCount: number;
  tangSauRuntimeOk: boolean;
  tangSauRuntimeDetails: {
    autoScheduleEnabled: boolean;
    shortDestinationCount: number;
    quoteDestinationCount: number;
    shortDestinationChannelId: number | null;
    shortDestinationChannelKey: string | null;
    shortDestinationPlatform: string | null;
  };
  profileResolutionOk: boolean;
  fallbackPromptOk: boolean;
  semanticGuardOk: boolean;
  quoteSchedulingTargetOk: boolean;
};

const TARGET_JOBS: TargetJob[] = [
  { id: "35f11d54-251e-4478-9906-bedb406f4409", jobType: "content_gen" },
  { id: "e19ca625-ec99-4d4b-9031-e56015145592", jobType: "short_pipeline" },
  { id: "bd602ec8-3b00-404d-8419-dc6626fa180d", jobType: "quote_pipeline" },
];

const ACTIVE_QUEUE_STATUSES = ["queued", "error", "uploading", "pending", "processing", "retryable"];
const STRONG_BUDDHIST_MARKERS = [
  "đức phật",
  "phật pháp",
  "nhân quả",
  "nghiệp",
  "quý vị",
  "buông bỏ",
  "chánh niệm",
  "tu tập",
  "chùa",
  "thiền sư",
  "bình an trong tâm",
  "an yên",
];
const PHAT_PHAP_TOPIC_FAMILIES = new Set([
  "nhan_qua_nguoi_xau_bao_ung",
  "buong_bo_chua_lanh",
  "tri_tue_song_im_lang_nhan_nhin",
  "gia_dinh_hieu_dao",
  "tinh_yeu_ton_thuong",
  "binh_yen_an_lac",
  "phuoc_bao_nghiep_duyen",
  "peace_mindfulness",
  "letting_go_forgiveness",
  "fear_anxiety",
  "karma",
  "hurt_loneliness",
  "buddhist_life_wisdom",
]);

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function psychologyFallbackPromptLooksCorrect(prompt: string): boolean {
  const source = prompt.toLocaleLowerCase("vi-VN");
  const forbiddenCarryovers = [
    'dẫn nhẹ tới một bài học mang tinh thần phật pháp hoặc nhân quả',
    '"nếu thấy hữu ích, quý vị hãy nhấn thích và theo dõi kênh để cùng nhau học những điều hay trong cuộc sống."',
    '- xưng hô: "quý vị", "chúng ta", hoặc "người ta"',
  ];
  const requiredTangSauCues = [
    "people-pleasing",
    "tự trọng",
    "bị thao túng",
    "cô đơn giữa đám đông",
    'không dùng "quý vị"',
  ];
  return forbiddenCarryovers.every((phrase) => !source.includes(phrase))
    && requiredTangSauCues.every((phrase) => source.includes(phrase));
}

function isTangSauContaminated(row: {
  contentProfileKey: string | null;
  topicFamily: string | null;
  title: string | null;
  topic: string | null;
  shortContent: string | null;
  script: string | null;
  promptVersions: unknown;
}): boolean {
  if (row.contentProfileKey === "buddhism") return true;

  const promptBlob = JSON.stringify(row.promptVersions ?? {}).toLocaleLowerCase("vi-VN");
  if (
    promptBlob.includes("phat_phap_short") ||
    promptBlob.includes("phat_phap") ||
    promptBlob.includes("buddhist")
  ) {
    return true;
  }

  if (row.topicFamily && PHAT_PHAP_TOPIC_FAMILIES.has(row.topicFamily)) return true;

  const contentBlob = [
    row.title,
    row.topic,
    row.shortContent,
    row.script,
  ].filter(Boolean).join("\n").toLocaleLowerCase("vi-VN");
  return STRONG_BUDDHIST_MARKERS.some((marker) => contentBlob.includes(marker));
}

function asIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

async function readTargetJobs() {
  const result = await db.execute<{
    id: string;
    job_type: string;
    is_enabled: boolean;
    last_run_at: Date | null;
    next_run_at: Date | null;
    niche_id: number;
    niche_name: string;
    niche_channel_key: string;
    niche_content_profile_key: string;
  }>(sql`
    select
      j.id,
      j.job_type,
      j.is_enabled,
      j.last_run_at,
      j.next_run_at,
      j.niche_id,
      j.niche_name,
      n.channel_key as niche_channel_key,
      n.content_profile_key as niche_content_profile_key
    from content_scheduler_jobs j
    join niches n on n.id = j.niche_id
    where j.id in (${sql.join(TARGET_JOBS.map((job) => sql`${job.id}`), sql`, `)})
    order by
      case j.id
        when ${TARGET_JOBS[0].id} then 1
        when ${TARGET_JOBS[1].id} then 2
        when ${TARGET_JOBS[2].id} then 3
        else 99
      end
  `);
  return result.rows.map((row) => ({
    id: row.id,
    jobType: row.job_type,
    isEnabled: row.is_enabled,
    lastRunAt: asIsoString(row.last_run_at),
    nextRunAt: asIsoString(row.next_run_at),
    nicheId: Number(row.niche_id),
    nicheName: row.niche_name,
    nicheChannelKey: row.niche_channel_key,
    nicheContentProfileKey: row.niche_content_profile_key,
  }));
}

async function runPreflight(): Promise<RuntimePreflight> {
  const activeRows = await db.execute<{
    upload_queue_id: string;
    content_profile_key: string | null;
    topic_family: string | null;
    title: string | null;
    topic: string | null;
    short_content: string | null;
    script: string | null;
    prompt_versions: unknown;
  }>(sql`
    select
      uq.id as upload_queue_id,
      cg.content_profile_key,
      cg.topic_family,
      uq.title,
      cg.topic,
      cg.short_content,
      cg.script,
      cg.prompt_versions
    from upload_queue uq
    join social_channels sc on sc.id = uq.channel_id
    join content_generations cg on cg.id = uq.content_id
    where sc.channel_key = 'tang_sau'
      and uq.status in (${sql.join(ACTIVE_QUEUE_STATUSES.map((status) => sql`${status}`), sql`, `)})
  `);
  const activeContaminated = activeRows.rows.filter((row) => isTangSauContaminated({
    contentProfileKey: row.content_profile_key,
    topicFamily: row.topic_family,
    title: row.title,
    topic: row.topic,
    shortContent: row.short_content,
    script: row.script,
    promptVersions: row.prompt_versions,
  }));

  const activeCrossChannelMismatch = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from upload_queue uq
    join social_channels sc on sc.id = uq.channel_id
    join content_generations cg on cg.id = uq.content_id
    where uq.status in (${sql.join(ACTIVE_QUEUE_STATUSES.map((status) => sql`${status}`), sql`, `)})
      and sc.channel_key = 'tang_sau'
      and cg.channel_key <> 'tang_sau'
  `);

  const tangSauConfig = await getChannelPublishConfig("tang_sau");
  const shortDestination = tangSauConfig?.shortDestinations[0] ?? null;
  const shortDestinationChannel = shortDestination
    ? await db.query.socialChannels.findFirst({
        where: eq(socialChannels.id, shortDestination.channelId),
        columns: { id: true, channelKey: true, platform: true },
      })
    : null;

  const profileResolutionOk = getContentProfile("philosophy").key === "psychology";
  const fallbackPromptOk = psychologyFallbackPromptLooksCorrect(DEFAULT_PSYCHOLOGY_SHORT_PROMPT);
  const semanticGuardOk = getTangSauIsolationViolation({
    channelKey: "tang_sau",
    nicheId: 14,
    contentProfileKey: "philosophy",
    formatType: "tts_short",
    title: "Sợ mất kiểm soát",
    shortContent: "Quý vị càng cố buông bỏ, lòng càng học được nhân quả và bình an trong tâm.",
    promptVersions: {
      tts: { details: { ttsRecommendedUseCase: "phat_phap_short" } },
    },
  })?.code === "prompt_profile_mismatch";
  const quoteSchedulingTargetOk = resolveQuoteSchedulingTarget({
    channelKey: "tang_sau",
    contentProfileKey: "philosophy",
    formatType: "legacy_quote_short",
  }) === "short";

  const tangSauRuntimeOk = Boolean(
    tangSauConfig &&
    tangSauConfig.autoScheduleEnabled &&
    tangSauConfig.shortDestinations.length >= 1 &&
    tangSauConfig.quoteDestinations.length === 0 &&
    shortDestinationChannel?.channelKey === "tang_sau" &&
    shortDestinationChannel.platform === "youtube"
  );

  return {
    activeContaminatedCount: activeContaminated.length,
    activeCrossChannelMismatchCount: Number(activeCrossChannelMismatch.rows[0]?.count ?? 0),
    tangSauRuntimeOk,
    tangSauRuntimeDetails: {
      autoScheduleEnabled: tangSauConfig?.autoScheduleEnabled ?? false,
      shortDestinationCount: tangSauConfig?.shortDestinations.length ?? 0,
      quoteDestinationCount: tangSauConfig?.quoteDestinations.length ?? 0,
      shortDestinationChannelId: shortDestination?.channelId ?? null,
      shortDestinationChannelKey: shortDestinationChannel?.channelKey ?? null,
      shortDestinationPlatform: shortDestinationChannel?.platform ?? null,
    },
    profileResolutionOk,
    fallbackPromptOk,
    semanticGuardOk,
    quoteSchedulingTargetOk,
  };
}

function validateTargetJobs(
  jobs: Awaited<ReturnType<typeof readTargetJobs>>,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (jobs.length !== TARGET_JOBS.length) {
    reasons.push(`Expected ${TARGET_JOBS.length} jobs, found ${jobs.length}`);
    return { ok: false, reasons };
  }

  for (const target of TARGET_JOBS) {
    const row = jobs.find((job) => job.id === target.id);
    if (!row) {
      reasons.push(`Missing target job ${target.id}`);
      continue;
    }
    if (row.jobType !== target.jobType) {
      reasons.push(`Job ${target.id} expected type=${target.jobType}, got ${row.jobType}`);
    }
    if (row.nicheChannelKey !== "tang_sau") {
      reasons.push(`Job ${target.id} expected niche.channel_key=tang_sau, got ${row.nicheChannelKey}`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

async function enableJobsInOrder() {
  const updated: Array<{ id: string; jobType: string; isEnabled: boolean }> = [];
  for (const target of TARGET_JOBS) {
    const result = await db.update(contentSchedulerJobs)
      .set({
        isEnabled: true,
        updatedAt: new Date(),
      })
      .where(eq(contentSchedulerJobs.id, target.id))
      .returning({
        id: contentSchedulerJobs.id,
        jobType: contentSchedulerJobs.jobType,
        isEnabled: contentSchedulerJobs.isEnabled,
      });
    updated.push(...result);
  }
  return updated;
}

async function main() {
  const execute = hasFlag("--execute");
  const beforeJobs = await readTargetJobs();
  const jobValidation = validateTargetJobs(beforeJobs);
  const preflight = await runPreflight();

  const preflightFailures: string[] = [];
  if (!jobValidation.ok) preflightFailures.push(...jobValidation.reasons);
  if (preflight.activeContaminatedCount !== 0) {
    preflightFailures.push(`active contaminated tang_sau queue rows = ${preflight.activeContaminatedCount}`);
  }
  if (preflight.activeCrossChannelMismatchCount !== 0) {
    preflightFailures.push(`active cross-channel mismatches = ${preflight.activeCrossChannelMismatchCount}`);
  }
  if (!preflight.tangSauRuntimeOk) {
    preflightFailures.push("tang_sau runtime config is not in the expected YouTube-only shortDestinations state");
  }
  if (!preflight.profileResolutionOk) preflightFailures.push("philosophy no longer resolves to psychology behavior");
  if (!preflight.fallbackPromptOk) preflightFailures.push("tang_sau fallback prompt contains Buddhist markers");
  if (!preflight.semanticGuardOk) preflightFailures.push("tang_sau semantic guard no longer rejects Buddhist prompt lineage");
  if (!preflight.quoteSchedulingTargetOk) preflightFailures.push("tang_sau legacy_quote_short no longer resolves to short scheduling target");

  if (preflightFailures.length > 0) {
    console.error(JSON.stringify({
      mode: execute ? "execute" : "dry_run",
      status: "blocked",
      preflight,
      beforeJobs,
      failures: preflightFailures,
    }, null, 2));
    process.exit(1);
  }

  let writeSummary: unknown = {
    willEnableIds: TARGET_JOBS.map((job) => job.id),
    writesPerformed: false,
  };
  if (execute) {
    writeSummary = {
      updatedRows: await enableJobsInOrder(),
      writesPerformed: true,
    };
  }

  const afterJobs = await readTargetJobs();
  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry_run",
    status: execute ? "enabled" : "dry_run_ready",
    beforeJobs,
    preflight,
    writeSummary,
    afterJobs,
    immediateQueueWritesCreated: false,
    publishTriggered: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
