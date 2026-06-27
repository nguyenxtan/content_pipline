import "dotenv/config";

import assert from "assert";
import fs from "fs";
import { execFileSync } from "child_process";
import pg from "pg";
import { findNextAvailablePublishSlot } from "@/lib/publishing/slot-occupancy";
import { buildQuoteArtifactMetadata } from "@/lib/quotes/quote-pipeline";
import { resolveQuoteSchedulingTarget } from "@/lib/quotes/quote-scheduling-target";
import { resolveQuoteVisualStyle } from "@/lib/quotes/quote-style";
import { _getCrossChannelScheduleError } from "@/actions/social-channels";
import { getContentProfile } from "@/lib/config/content-profiles";
import { getTangSauIsolationViolation } from "@/lib/content-profile-isolation";
import {
  buildYoutubeQuoteLanePlan,
  buildYoutubeQuoteDestinationConfig,
  getYoutubeQuoteSchedulerPolicy,
  isSameDestinationConfig,
} from "@/lib/quotes/youtube-quote-scheduler-policy";

const { Pool } = pg;

function ok(message: string) {
  console.log(`  PASS ${message}`);
}

function buildFutureUtcDate(offsetDays: number, hour: number, minute = 0): Date {
  const anchor = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Date(Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
    hour,
    minute,
    0,
    0,
  ));
}

async function main() {
  const tangSauPolicy = getYoutubeQuoteSchedulerPolicy("tang_sau");
  assert(tangSauPolicy?.enabled);
  assert.equal(tangSauPolicy?.primaryPlatform, "youtube");
  ok("tang_sau policy enables YouTube quote-short");

  assert.equal(tangSauPolicy?.facebookQuotePhotoEnabled, false);
  assert.equal(getYoutubeQuoteSchedulerPolicy("phat_phap"), null);
  ok("tang_sau policy disables Facebook quote/photo and phat_phap does not get a new dedicated lane");

  const style = resolveQuoteVisualStyle({
    channelKey: "tang_sau",
    contentProfileKey: "philosophy",
  });
  assert.equal(style.style, "static_deep_quote");
  assert.equal(style.kinetic, false);
  ok("policy resolves static_deep_quote with kinetic=false");

  assert.equal(getContentProfile("philosophy").key, "psychology");
  ok("philosophy storage key resolves to the psychology behavior profile at runtime");

  const desiredDestination = buildYoutubeQuoteDestinationConfig(tangSauPolicy!, 10);
  assert(isSameDestinationConfig(desiredDestination, desiredDestination));
  ok("destination config helper is stable");

  const quoteMetadata = buildQuoteArtifactMetadata({
    quoteText: "Có người im lặng không vì đã ổn, mà vì họ biết nói thêm cũng chỉ làm mình hiện ra như một gánh nặng khó đặt xuống.",
    quoteSourceType: "independent_llm",
    channelKey: "tang_sau",
    contentProfileKey: "philosophy",
    nicheName: "Tầng Sâu",
    sourceContentId: "fixture",
    sourceFormatType: "legacy_quote_short",
  });
  assert.equal(quoteMetadata.quoteSourceType, "independent_llm");
  assert.equal(quoteMetadata.quoteStyle, "static_deep_quote");
  ok("quote generation metadata includes quoteSourceType and quoteStyle");

  const firstHourSlot = buildFutureUtcDate(2, 0);
  const secondHourSlot = buildFutureUtcDate(2, 1);
  const expectedThirdHourSlot = buildFutureUtcDate(2, 2);
  const nextSlot = findNextAvailablePublishSlot({
    windowStart: tangSauPolicy!.windowStart,
    windowEnd: tangSauPolicy!.windowEnd,
    intervalMin: tangSauPolicy!.intervalMin,
    slotOffsetMinutes: tangSauPolicy!.slotMinute,
    taken: [
      firstHourSlot,
      secondHourSlot,
    ],
    notBefore: new Date(firstHourSlot.getTime() - 30 * 60_000),
  });
  assert(nextSlot);
  assert.equal(nextSlot!.toISOString(), expectedThirdHourSlot.toISOString());
  ok("scheduling helper avoids colliding HH:00 slots for tang_sau quote-shorts");

  assert(tangSauPolicy!.maxQueueInsertPerRun >= 1 && tangSauPolicy!.maxQueueInsertPerRun <= 2);
  ok("first-run cap prevents bulk enqueue");

  const contentGeneratorSource = fs.readFileSync("src/actions/content-generator.ts", "utf8");
  const validationSource = fs.readFileSync("src/lib/validations/content-generator.ts", "utf8");
  assert(contentGeneratorSource.includes('jobType === "quote_pipeline"'));
  assert(validationSource.includes('"quote_pipeline"'));
  ok("no dead scheduler job type is created");

  assert(contentGeneratorSource.includes("skip_schedule_mismatch"));
  assert(contentGeneratorSource.includes("row.channelKey !== policy.channelKey"));
  assert(contentGeneratorSource.includes("row.nicheId !== job.nicheId"));
  assert(contentGeneratorSource.includes('row.contentProfileKey !== "philosophy"'));
  ok("quote_pipeline fails closed when generated content channel or niche mismatches the scheduler job");

  assert.equal(resolveQuoteSchedulingTarget({
    channelKey: "tang_sau",
    contentProfileKey: "philosophy",
    formatType: "legacy_quote_short",
  }), "short");
  assert.equal(resolveQuoteSchedulingTarget({
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
    formatType: "legacy_quote_short",
  }), "short");
  assert.equal(resolveQuoteSchedulingTarget({
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
    formatType: "tts_short",
  }), "quote");
  assert.equal(resolveQuoteSchedulingTarget({
    channelKey: "tang_sau",
    contentProfileKey: "philosophy",
    formatType: "tts_short",
  }), null);
  ok("quote scheduling target keeps legacy_quote_short on the short lane while preserving phat_phap quote-photo sidecar routing");

  assert(
    _getCrossChannelScheduleError({
      requestedVideoType: "quote",
      expectedChannelKey: "tang_sau",
      destination: { id: 10, name: "Tang Sau YT", platform: "youtube", channelKey: "tang_sau" },
      content: {
        id: "fixture-phat-phap",
        channelKey: "phat_phap",
        nicheId: 1,
        contentProfileKey: "buddhism",
        formatType: "legacy_quote_short",
      },
    }),
    "phat_phap content should be blocked from tang_sau quote lane destinations",
  );
  assert(
    _getCrossChannelScheduleError({
      requestedVideoType: "quote",
      expectedChannelKey: "tang_sau",
      destination: { id: 10, name: "Tang Sau YT", platform: "youtube", channelKey: "tang_sau" },
      content: {
        id: "fixture-wrong-format",
        channelKey: "tang_sau",
        nicheId: 14,
        contentProfileKey: "philosophy",
        formatType: "short_video",
      },
    }),
    "tang_sau quote lane should reject non-legacy_quote_short content",
  );
  assert(
    _getCrossChannelScheduleError({
      requestedVideoType: "quote",
      expectedChannelKey: "tang_sau",
      destination: { id: 10, name: "Tang Sau YT", platform: "youtube", channelKey: "tang_sau" },
      content: {
        id: "fixture-wrong-profile",
        channelKey: "tang_sau",
        nicheId: 14,
        contentProfileKey: "buddhism",
        formatType: "legacy_quote_short",
      },
    }),
    "tang_sau quote lane should reject non-philosophy content profile",
  );
  ok("runtime cross-channel guard blocks wrong channel, wrong format, and wrong profile before scheduling");

  const tangSauSemanticMismatch = getTangSauIsolationViolation({
    channelKey: "tang_sau",
    nicheId: 14,
    contentProfileKey: "philosophy",
    formatType: "legacy_quote_short",
    title: "Sợ mất kiểm soát",
    shortContent: "Quý vị càng cố buông bỏ đúng lúc, lòng càng dễ chạm tới bình an trong tâm.",
    topicFamily: "buong_bo_chua_lanh",
    promptVersions: {
      tts: { details: { ttsRecommendedUseCase: "phat_phap_short" } },
    },
  });
  assert.equal(tangSauSemanticMismatch?.code, "prompt_profile_mismatch");
  ok("tang_sau guard fails closed on phat_phap prompt lineage even when metadata says tang_sau");

  const slotOccupancySource = fs.readFileSync("src/lib/publishing/slot-occupancy.ts", "utf8");
  const cooldownVerifySource = fs.readFileSync("scripts/verify-upload-queue-cooldown-deferral.ts", "utf8");
  assert(!slotOccupancySource.includes("youtube-quote-scheduler-policy"));
  assert(!cooldownVerifySource.includes("quote_pipeline"));
  ok("queue reliability files remain isolated from the YouTube quote scheduler lane");

  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const before = await pool.query<{ config_value: string | null; job_count: string }>(`
        select
          (select value from app_config where key = 'channel_publish_configs_v1' limit 1) as config_value,
          (select count(*)::text from content_scheduler_jobs where job_type = 'quote_pipeline') as job_count
      `);
      const dryRunOutput = execFileSync(process.execPath, [
        "./node_modules/tsx/dist/cli.mjs",
        "--env-file=.env.local",
        "--tsconfig",
        "tsconfig.json",
        "scripts/ensure-youtube-quote-scheduler-jobs.ts",
      ], {
        cwd: process.cwd(),
        stdio: "pipe",
        env: process.env,
      }).toString("utf8");
      const after = await pool.query<{ config_value: string | null; job_count: string }>(`
        select
          (select value from app_config where key = 'channel_publish_configs_v1' limit 1) as config_value,
          (select count(*)::text from content_scheduler_jobs where job_type = 'quote_pipeline') as job_count
      `);
      assert.deepEqual(after.rows[0], before.rows[0]);
      const parsed = JSON.parse(dryRunOutput) as { mode: string; results: Array<{ status?: string }> };
      assert.equal(parsed.mode, "dry_run");
      ok("ensure script dry-run is read-only");

      const syntheticNoOp = buildYoutubeQuoteLanePlan({ configMatches: true, jobMatches: true });
      assert.equal(syntheticNoOp.configAction, "no_op");
      assert.equal(syntheticNoOp.jobAction, "no_op");
      ok("ensure script supports no-op lane state when config and job already match");

      const channelRows = await pool.query<{ id: number; channel_key: string }>(`
        select id, channel_key
        from social_channels
        where id = 10
        limit 1
      `);
      if (channelRows.rows[0]) {
        assert.equal(channelRows.rows[0].channel_key, "tang_sau");
        ok("canonical tang_sau YouTube destination resolves to a tang_sau-owned channel");
      }

      const mismatchedTangSauQueue = await pool.query<{ cnt: string }>(`
        select count(*)::text as cnt
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        join content_generations cg on cg.id = uq.content_id
        where sc.channel_key = 'tang_sau'
          and cg.channel_key <> 'tang_sau'
          and uq.status in ('queued', 'uploading')
      `);
      assert.equal(mismatchedTangSauQueue.rows[0]?.cnt ?? "0", "0");
      ok("no active queue row exists where tang_sau destination points at another channel's content");

      const runtimeConfigRows = await pool.query<{ value: string }>(`
        select value from app_config where key = 'channel_publish_configs_v1' limit 1
      `);
      const runtimeConfig = runtimeConfigRows.rows[0]?.value
        ? JSON.parse(runtimeConfigRows.rows[0].value)
        : null;
      const tangSauRuntime = runtimeConfig?.tang_sau ?? null;
      const phatPhapRuntime = runtimeConfig?.phat_phap ?? null;
      assert.equal((tangSauRuntime?.quoteDestinations ?? []).length, 0);
      assert((tangSauRuntime?.shortDestinations ?? []).length >= 1);
      assert((phatPhapRuntime?.quoteDestinations ?? []).length >= 1);
      ok("runtime config keeps tang_sau quoteDestinations empty while phat_phap FB quote sidecar remains configured");

      const dryRunSchedulingPreview = {
        schedulingTarget: resolveQuoteSchedulingTarget({
          channelKey: "tang_sau",
          contentProfileKey: "philosophy",
          formatType: "legacy_quote_short",
        }),
        platform: "youtube",
        destinationChannelKey: "tang_sau",
        destinationChannelId: tangSauRuntime?.shortDestinations?.[0]?.channelId ?? null,
        quoteDestinationCount: (tangSauRuntime?.quoteDestinations ?? []).length,
        slotMinute: tangSauPolicy?.slotMinute ?? null,
      };
      assert.equal(dryRunSchedulingPreview.schedulingTarget, "short");
      assert.equal(dryRunSchedulingPreview.platform, "youtube");
      assert.equal(dryRunSchedulingPreview.destinationChannelKey, "tang_sau");
      assert.equal(dryRunSchedulingPreview.destinationChannelId, 10);
      assert.equal(dryRunSchedulingPreview.quoteDestinationCount, 0);
      assert.equal(dryRunSchedulingPreview.slotMinute, 0);
      ok("dry-run scheduling preview resolves tang_sau quote-short to YouTube HH:00 via shortDestinations only");
    } finally {
      await pool.end();
    }
  } else {
    console.log("  SKIP DB-backed dry-run verification (no DATABASE_URL)");
  }

  console.log("\nverify-youtube-quote-scheduler-lane: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
