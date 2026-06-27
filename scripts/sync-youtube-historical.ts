import { config } from "dotenv";
import {
  getYouTubeHistoricalPerformanceAction,
  syncYouTubeHistoricalVideosAction,
} from "@/actions/youtube-historical";

config({ path: ".env.local" });
config();

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, true);
    }
  }
  return args;
}

function fmtDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "n/a";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const execute = args.get("execute") === true || args.get("delete") === true;
  const since = typeof args.get("since") === "string" ? String(args.get("since")) : undefined;
  const platformAccountId = typeof args.get("platform-account-id") === "string"
    ? Number(args.get("platform-account-id"))
    : null;

  console.log(`\nYouTube historical sync (${execute ? "EXECUTE" : "DRY RUN"})`);
  console.log("=".repeat(64));

  const result = await syncYouTubeHistoricalVideosAction({
    execute,
    dryRun: !execute,
    since,
    platformAccountId: Number.isFinite(platformAccountId) ? platformAccountId : null,
  });

  console.log(`Channel:          ${result.channelTitle ?? "unknown"} (${result.channelPlatformId ?? "unknown"})`);
  console.log(`Since:            ${result.since}`);
  console.log(`Videos found:     ${result.videosFound}`);
  console.log(`Videos fetched:   ${result.videosFetched}`);
  console.log(`Already in DB:    ${result.alreadyInDb}`);
  console.log(`${execute ? "Imported" : "Would import"}:   ${result.imported}`);
  console.log(`${execute ? "Updated" : "Would update"}:    ${result.updated}`);
  console.log(`Skipped:          ${result.skipped}`);
  console.log(`Snapshots:        ${result.snapshotsWritten}`);
  console.log(`Analytics rows:   ${result.analyticsRowsWritten}`);
  console.log(`Credential row:   ${result.credentialChannelId}`);
  console.log(`Platform account: ${result.platformAccountId}`);

  console.log("\nBatching / quota notes:");
  for (const note of result.quotaNotes) console.log(`- ${note}`);

  if (result.sampleOldVideos.length > 0) {
    console.log("\nSample 2025 videos:");
    for (const video of result.sampleOldVideos) {
      console.log(`- ${video.publishedAt?.slice(0, 10) ?? "n/a"} | ${video.views} views | ${video.durationSeconds ?? "?"}s | ${video.formatType} | ${video.title}`);
    }
  } else {
    console.log("\nSample 2025 videos: none found in selected range/channel");
  }

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    for (const error of result.errors) console.log(`- ${error}`);
  }

  if (execute) {
    const rows = await getYouTubeHistoricalPerformanceAction();
    console.log("\nOld vs new format comparison:");
    for (const row of rows) {
      console.log(
        [
          row.formatType,
          `videos=${row.videoCount}`,
          `avgViews=${row.avgViews.toFixed(1)}`,
          `medianViews=${row.medianViews.toFixed(1)}`,
          `avgDuration=${row.avgDurationSec?.toFixed(1) ?? "n/a"}s`,
          `avgViewDuration=${row.avgViewDurationSec?.toFixed(1) ?? "n/a"}s`,
          `avgRetention=${row.avgRetentionPct?.toFixed(1) ?? "n/a"}%`,
          `range=${fmtDate(row.publishedFrom)}..${fmtDate(row.publishedTo)}`,
        ].join(" | "),
      );
    }
  } else {
    console.log("\nNo DB writes were made. Re-run with --execute to import and sync analytics.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

