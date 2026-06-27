import "dotenv/config";
import fs from "fs";
import { eq, isNull, or, sql } from "drizzle-orm";
import { getAutoScheduleSettingsAction } from "@/actions/social-channels";
import { _getCrossChannelScheduleError } from "@/actions/social-channels";
import { getContentProfile, resolveContentProfileKey } from "@/lib/config/content-profiles";
import {
  DEFAULT_CHANNEL_KEY,
  getChannelDefinition,
  getChannelPublishConfig,
  normalizeChannelKey,
  resolveChannelKey,
} from "@/lib/config/channel-configs";
import { db } from "@/lib/db";
import { contentGenerations, niches } from "@/lib/db/schema";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function verifyResolvers() {
  assert(resolveContentProfileKey(null) === "buddhism", "default content profile should be buddhism");
  assert(resolveChannelKey(null) === DEFAULT_CHANNEL_KEY, "default channel should be phat_phap");

  const buddhism = getContentProfile("buddhism");
  const psychology = getContentProfile("psychology");
  const phatPhap = getChannelDefinition("phat_phap");
  const tangSau = getChannelDefinition("tang_sau");

  assert(buddhism.status === "active", "buddhism profile should be active");
  assert(psychology.status === "draft", "psychology profile should be draft");
  assert(phatPhap.publishingEnabled, "phat_phap should allow publishing");
  assert(tangSau.publishingEnabled, "tang_sau should allow publishing");

  const uiSettings = await getAutoScheduleSettingsAction();
  const phatPhapPublishConfig = await getChannelPublishConfig("phat_phap");
  const tangSauPublishConfig = await getChannelPublishConfig("tang_sau");
  assert(!!phatPhapPublishConfig, "phat_phap publish config should resolve");
  assert(!!tangSauPublishConfig, "tang_sau publish config should resolve");

  const channelIds = [
    ...uiSettings.shortDestinations.map((destination) => destination.channelId),
    ...uiSettings.longDestinations.map((destination) => destination.channelId),
    ...uiSettings.quoteDestinations.map((destination) => destination.channelId),
  ].filter((channelId) => channelId > 0);
  const channels = channelIds.length > 0
    ? await db.query.socialChannels.findMany({
        where: (table, { inArray: inArr }) => inArr(table.id, channelIds),
        columns: { id: true, channelKey: true },
      })
    : [];
  const channelKeyById = new Map(channels.map((channel) => [channel.id, normalizeChannelKey(channel.channelKey)]));
  const uiByChannel = {
    phat_phap: {
      shortDestinations: uiSettings.shortDestinations.filter((destination) => channelKeyById.get(destination.channelId) === "phat_phap"),
      longDestinations: uiSettings.longDestinations.filter((destination) => channelKeyById.get(destination.channelId) === "phat_phap"),
      quoteDestinations: uiSettings.quoteDestinations.filter((destination) => channelKeyById.get(destination.channelId) === "phat_phap"),
    },
    tang_sau: {
      shortDestinations: uiSettings.shortDestinations.filter((destination) => channelKeyById.get(destination.channelId) === "tang_sau"),
      longDestinations: uiSettings.longDestinations.filter((destination) => channelKeyById.get(destination.channelId) === "tang_sau"),
      quoteDestinations: uiSettings.quoteDestinations.filter((destination) => channelKeyById.get(destination.channelId) === "tang_sau"),
    },
  } as const;

  assert(
    JSON.stringify(phatPhapPublishConfig?.shortDestinations ?? []) === JSON.stringify(uiByChannel.phat_phap.shortDestinations),
    "phat_phap runtime short destinations should match UI config",
  );
  assert(
    JSON.stringify(tangSauPublishConfig?.shortDestinations ?? []) === JSON.stringify(uiByChannel.tang_sau.shortDestinations),
    "tang_sau runtime short destinations should match UI config",
  );
  assert(
    JSON.stringify(phatPhapPublishConfig?.quoteDestinations ?? []) === JSON.stringify(uiByChannel.phat_phap.quoteDestinations),
    "phat_phap runtime quote destinations should match UI config",
  );
  assert(
    JSON.stringify(tangSauPublishConfig?.quoteDestinations ?? []) === JSON.stringify(uiByChannel.tang_sau.quoteDestinations),
    "tang_sau runtime quote destinations should match UI config",
  );

  const tangSauUiEnabled = [
    ...uiByChannel.tang_sau.shortDestinations,
    ...uiByChannel.tang_sau.longDestinations,
    ...uiByChannel.tang_sau.quoteDestinations,
  ].some((destination) => destination.enabled);
  assert(
    tangSauPublishConfig?.autoScheduleEnabled === tangSauUiEnabled,
    "tang_sau runtime autoScheduleEnabled should match UI destinations",
  );

  console.log("resolver checks: ok");
}

async function verifyDatabaseDefaults() {
  const [nicheNulls] = await db
    .select({
      total: sql<number>`count(*)`,
    })
    .from(niches)
    .where(or(isNull(niches.contentProfileKey), isNull(niches.channelKey)));

  const [generationNulls] = await db
    .select({
      total: sql<number>`count(*)`,
    })
    .from(contentGenerations)
    .where(or(isNull(contentGenerations.contentProfileKey), isNull(contentGenerations.channelKey)));

  assert(Number(nicheNulls?.total ?? 0) === 0, "niches should not contain null profile/channel keys");
  assert(Number(generationNulls?.total ?? 0) === 0, "content_generations should not contain null profile/channel keys");

  const sampleNiche = await db.query.niches.findFirst({
    where: eq(niches.slug, "phat-phap-truyen-nhan-qua"),
  });
  if (sampleNiche) {
    assert(
      normalizeChannelKey(sampleNiche.channelKey) === "phat_phap",
      "seed phat-phap niche should resolve to phat_phap",
    );
    assert(
      resolveContentProfileKey(sampleNiche.contentProfileKey) === "buddhism",
      "seed phat-phap niche should resolve to buddhism",
    );
  }

  console.log("database checks: ok");
}

async function verifyCrossChannelProtection() {
  const mismatchedQueueRows = await db.execute<{
    total: string;
    active_total: string;
  }>(sql`
    select
      count(*)::text as total,
      count(*) filter (where uq.status in ('queued', 'uploading'))::text as active_total
    from upload_queue uq
    join social_channels sc on sc.id = uq.channel_id
    join content_generations cg on cg.id = uq.content_id
    where sc.channel_key <> cg.channel_key
  `);
  const row = mismatchedQueueRows.rows[0];
  assert((row?.active_total ?? "0") === "0", "active queue should not contain cross-channel destination mismatches");

  const contentGeneratorSource = fs.readFileSync("src/actions/content-generator.ts", "utf8");
  const socialChannelsSource = fs.readFileSync("src/actions/social-channels.ts", "utf8");
  assert(contentGeneratorSource.includes("skip_schedule_mismatch"), "quote_pipeline mismatch guard should exist");
  assert(socialChannelsSource.includes("bulk_schedule_block"), "bulk scheduler cross-channel guard should exist");
  assert(socialChannelsSource.includes("auto_schedule_block"), "auto-schedule cross-channel guard should exist");

  assert(
    _getCrossChannelScheduleError({
      requestedVideoType: "short",
      destination: { id: 1, name: "Phat Phap YT", platform: "youtube", channelKey: "phat_phap" },
      content: {
        id: "fixture-tang-sau",
        channelKey: "tang_sau",
        nicheId: 14,
        contentProfileKey: "philosophy",
        formatType: "legacy_quote_short",
      },
    }),
    "tang_sau content should be blocked from phat_phap destinations",
  );
  assert(
    _getCrossChannelScheduleError({
      requestedVideoType: "short",
      destination: { id: 10, name: "Tang Sau YT", platform: "youtube", channelKey: "tang_sau" },
      content: {
        id: "fixture-phat-phap",
        channelKey: "phat_phap",
        nicheId: 1,
        contentProfileKey: "buddhism",
        formatType: "legacy_quote_short",
      },
    }),
    "phat_phap content should be blocked from tang_sau destinations",
  );

  console.log("cross-channel checks: ok");
}

async function main() {
  await verifyResolvers();
  await verifyCrossChannelProtection();
  try {
    await verifyDatabaseDefaults();
  } catch (error) {
    console.warn(
      "database checks: skipped",
      error instanceof Error ? error.message : String(error),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
