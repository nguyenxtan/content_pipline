import "dotenv/config";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appConfig, contentSchedulerJobs, niches } from "@/lib/db/schema";
import {
  CHANNEL_KEYS,
  CHANNEL_PUBLISH_CONFIGS_KEY,
  getChannelPublishConfig,
} from "@/lib/config/channel-configs";
import {
  buildYoutubeQuoteDestinationConfig,
  getYoutubeQuoteSchedulerPolicy,
  isSameDestinationConfig,
} from "@/lib/quotes/youtube-quote-scheduler-policy";

type TargetChannelKey = "tang_sau" | "phat_phap";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readFlagValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

function computeNextWindowRunAt(windowStart: string): Date {
  const now = new Date();
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const startMin = parseMinutes(windowStart);
  const currentMin = vnNow.getUTCHours() * 60 + vnNow.getUTCMinutes();
  const nextVn = new Date(Date.UTC(
    vnNow.getUTCFullYear(),
    vnNow.getUTCMonth(),
    vnNow.getUTCDate(),
    0,
    0,
    0,
    0,
  ));
  const chosenMinutes = currentMin < startMin
    ? startMin
    : Math.ceil((currentMin + 1) / 60) * 60;
  if (chosenMinutes >= 24 * 60) nextVn.setUTCDate(nextVn.getUTCDate() + 1);
  const normalized = chosenMinutes % (24 * 60);
  nextVn.setUTCHours(Math.floor(normalized / 60), normalized % 60, 0, 0);
  return new Date(nextVn.getTime() - 7 * 60 * 60 * 1000);
}

async function resolveCanonicalYoutubeChannelId(channelKey: TargetChannelKey): Promise<number | null> {
  const platformChannelRow = await db.query.socialChannels.findFirst({
    where: (channel, { and: a, eq: e }) => a(
      e(channel.channelKey, channelKey),
      e(channel.platform, "youtube"),
      e(channel.isActive, true),
    ),
    columns: { platformChannelId: true },
  });
  if (!platformChannelRow?.platformChannelId) return null;

  const result = await db.execute<{ id: number }>(sql`
    SELECT
      sc.id
    FROM social_channels sc
    LEFT JOIN upload_queue uq ON uq.channel_id = sc.id
    WHERE sc.platform = 'youtube'
      AND sc.platform_channel_id = ${platformChannelRow.platformChannelId}
    GROUP BY sc.id, sc.channel_key, sc.is_active, sc.needs_reconnect
    ORDER BY
      CASE WHEN sc.channel_key = ${channelKey} THEN 0 ELSE 1 END ASC,
      CASE WHEN sc.is_active = true AND sc.needs_reconnect = false THEN 0 ELSE 1 END ASC,
      COUNT(uq.id) DESC,
      sc.id DESC
    LIMIT 1
  `);
  return result.rows[0]?.id ? Number(result.rows[0].id) : null;
}

async function planForChannel(channelKey: TargetChannelKey, execute: boolean) {
  const policy = getYoutubeQuoteSchedulerPolicy(channelKey);
  if (!policy) {
    return {
      channelKey,
      supported: false,
      message: "No dedicated YouTube quote scheduler lane is enabled for this channel in this phase.",
    };
  }

  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.channelKey, channelKey), eq(niches.isActive, true)),
    columns: { id: true, name: true },
  });
  if (!niche) {
    return {
      channelKey,
      supported: true,
      error: "missing_active_niche",
    };
  }

  const canonicalChannelId = await resolveCanonicalYoutubeChannelId(channelKey);
  if (!canonicalChannelId) {
    return {
      channelKey,
      supported: true,
      error: "missing_canonical_youtube_channel",
    };
  }

  const currentConfig = await getChannelPublishConfig(channelKey);
  const desiredDestination = buildYoutubeQuoteDestinationConfig(policy, canonicalChannelId);
  const currentDestination = currentConfig?.shortDestinations[0];
  const configMatches = Boolean(
    currentConfig?.autoScheduleEnabled &&
    currentConfig.shortDestinations.length === 1 &&
    currentConfig.quoteDestinations.length === 0 &&
    isSameDestinationConfig(currentDestination, desiredDestination),
  );

  const existingJob = await db.query.contentSchedulerJobs.findFirst({
    where: (job, { and: a, eq: e }) => a(
      e(job.nicheId, niche.id),
      e(job.jobType, policy.schedulerJobType),
    ),
  });
  const nextRunAt = computeNextWindowRunAt(policy.windowStart);
  const jobMatches = Boolean(
    existingJob &&
    existingJob.isEnabled &&
    existingJob.contentMode === "short" &&
    existingJob.frequency === policy.frequency &&
    (existingJob.batchSize ?? 0) === policy.maxQueueInsertPerRun,
  );

  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, CHANNEL_PUBLISH_CONFIGS_KEY),
    columns: { value: true },
  });
  const parsedConfigs = row?.value
    ? JSON.parse(row.value) as Record<string, unknown>
    : {};
  const mergedBaseConfigs = { ...parsedConfigs };
  for (const key of CHANNEL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(mergedBaseConfigs, key)) continue;
    const resolved = await getChannelPublishConfig(key);
    if (!resolved) continue;
    mergedBaseConfigs[key] = {
      publishingEnabled: resolved.publishingEnabled,
      autoScheduleEnabled: resolved.autoScheduleEnabled,
      allowLegacyEnvFallback: resolved.allowLegacyEnvFallback,
      shortDestinations: resolved.shortDestinations,
      longDestinations: resolved.longDestinations,
      quoteDestinations: resolved.quoteDestinations,
    };
  }
  const hasRuntimeConfigForChannel = Object.prototype.hasOwnProperty.call(parsedConfigs, channelKey);
  const runtimeRecordComplete = CHANNEL_KEYS.every((key) => Object.prototype.hasOwnProperty.call(parsedConfigs, key));
  const configAction = !hasRuntimeConfigForChannel
    ? "insert"
    : !runtimeRecordComplete
      ? "update"
    : configMatches
      ? "no_op"
      : "update";
  const jobAction = !existingJob
    ? "insert"
    : jobMatches
      ? "no_op"
      : "update";
  const currentChannelConfig = mergedBaseConfigs[channelKey] && typeof mergedBaseConfigs[channelKey] === "object"
    ? mergedBaseConfigs[channelKey] as Record<string, unknown>
    : {};
  const nextConfigs = {
    ...mergedBaseConfigs,
    [channelKey]: {
      ...currentChannelConfig,
      publishingEnabled: true,
      autoScheduleEnabled: true,
      shortDestinations: [desiredDestination],
      quoteDestinations: [],
    },
  };

  if (execute && (configAction === "insert" || configAction === "update")) {
    await db.insert(appConfig)
      .values({
        key: CHANNEL_PUBLISH_CONFIGS_KEY,
        value: JSON.stringify(nextConfigs),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appConfig.key,
        set: {
          value: JSON.stringify(nextConfigs),
          updatedAt: new Date(),
        },
      });
  }

  if (execute && jobAction === "insert") {
    await db.insert(contentSchedulerJobs).values({
      nicheId: niche.id,
      nicheName: niche.name,
      topic: "",
      frequency: policy.frequency,
      isEnabled: true,
      jobType: policy.schedulerJobType,
      contentMode: "short",
      batchSize: policy.maxQueueInsertPerRun,
      nextRunAt,
      bgMusic: true,
    });
  }

  if (execute && jobAction === "update" && existingJob) {
    await db.update(contentSchedulerJobs)
      .set({
        nicheName: niche.name,
        topic: "",
        frequency: policy.frequency,
        isEnabled: true,
        jobType: policy.schedulerJobType,
        contentMode: "short",
        batchSize: policy.maxQueueInsertPerRun,
        nextRunAt,
        bgMusic: true,
        updatedAt: new Date(),
      })
      .where(eq(contentSchedulerJobs.id, existingJob.id));
  }

  return {
    channelKey,
    supported: true,
    execute,
    laneType: "scheduler_job",
    configAction,
    jobAction,
    configSource: currentConfig?.source ?? "code_default",
    canonicalChannelId,
    existingJobId: existingJob?.id ?? null,
    nextRunAt: nextRunAt.toISOString(),
    targetPerDay: policy.targetPerDay,
    targetUpcomingQueueRows: policy.targetUpcomingQueueRows,
    maxQueueInsertPerRun: policy.maxQueueInsertPerRun,
    willGenerateImmediately: false,
    desiredDestination,
    status: configAction === "no_op" && jobAction === "no_op" ? "no_op" : execute ? "updated" : "dry_run_pending",
  };
}

async function main() {
  const execute = hasFlag("--execute");
  const requestedChannel = readFlagValue("--channel-key") as TargetChannelKey | null;
  const all = hasFlag("--all");
  const targets: TargetChannelKey[] = all
    ? ["tang_sau", "phat_phap"]
    : requestedChannel
      ? [requestedChannel]
      : ["tang_sau"];

  const results = [];
  for (const channelKey of targets) {
    results.push(await planForChannel(channelKey, execute));
  }

  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry_run",
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
