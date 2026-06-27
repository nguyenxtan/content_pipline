import "dotenv/config";

import pg from "pg";
import { getTakenUploadSlotsForDestination, pickFullLaneSafeAnchor, type PhatPhapCampaignLaneOccupancy } from "@/lib/publishing/slot-occupancy";

const { Pool } = pg;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Hard exclusion: never touch the two newly-generated experiment items.
const EXCLUDED_EXPERIMENT_CONTENT_IDS = [
  "66906ddb-b1ce-4b99-8c23-a81d81cc917e",
  "1c72518d-6227-4b20-aa2c-f57ca50cad2f",
];

type Args = { dryRun: boolean; apply: boolean; contentId: string; json: boolean };

function parseArgs(argv: string[]): Args {
  let dryRun = true;
  let apply = false;
  let contentId = "";
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--apply") {
      apply = true;
      dryRun = false;
    } else if (arg === "--content-id") {
      contentId = argv[i + 1] ?? "";
      i += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!contentId) throw new Error("--content-id <prefix> is required (the row set to move)");
  return { dryRun, apply, contentId, json };
}

function formatVn(iso: string): string {
  const date = new Date(iso);
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  const hh = String(vn.getUTCHours()).padStart(2, "0");
  const mm = String(vn.getUTCMinutes()).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  const mo = String(vn.getUTCMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} ${dd}/${mo}/${vn.getUTCFullYear()}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const resolved = await pool.query<{ id: string }>(
      `select id from content_generations where id like $1 || '%'`,
      [args.contentId],
    );
    if (resolved.rows.length !== 1) {
      console.log(`Could not resolve exactly one content_id for prefix "${args.contentId}" (found ${resolved.rows.length}). Aborting.`);
      return;
    }
    const contentId = resolved.rows[0].id;
    if (EXCLUDED_EXPERIMENT_CONTENT_IDS.includes(contentId)) {
      console.log(`Refusing to touch ${contentId} — it is one of the protected experiment items.`);
      return;
    }

    const rowsResult = await pool.query<{
      id: string; platform: string; video_type: string; status: string; scheduled_at: string;
      channel_id: number; platform_channel_id: string | null;
    }>(
      `
        select uq.id, uq.platform, uq.video_type, uq.status, uq.scheduled_at::text,
               uq.channel_id, sc.platform_channel_id
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        where uq.content_id = $1 and uq.video_type in ('short', 'quote')
        order by uq.platform, uq.video_type
      `,
      [contentId],
    );

    const queuedRows = rowsResult.rows.filter((r) => r.status === "queued");
    const doneRows = rowsResult.rows.filter((r) => r.status === "done");

    if (queuedRows.length === 0) {
      console.log(`No queued short/quote rows found for ${contentId}. Nothing to move (done rows, if any, are left untouched).`);
      return;
    }

    const lanesMeta = queuedRows.map((row) => ({
      platform: row.platform as "youtube" | "facebook",
      videoType: row.video_type as "short" | "quote",
      channelId: row.channel_id,
      platformChannelId: row.platform_channel_id,
    }));

    const takenByLane = await Promise.all(
      lanesMeta.map((lane) =>
        getTakenUploadSlotsForDestination({
          channelId: lane.channelId,
          platform: lane.platform,
          platformChannelId: lane.platformChannelId,
          videoType: lane.videoType,
        }),
      ),
    );

    const lanes: PhatPhapCampaignLaneOccupancy[] = lanesMeta.map((lane, index) => ({
      videoType: lane.videoType,
      takenMs: takenByLane[index]
        .filter((row) => row.contentId !== contentId)
        .map((row) => row.scheduledAt.getTime()),
    }));

    const earliestCurrent = queuedRows
      .map((r) => new Date(r.scheduled_at).getTime())
      .reduce((min, t) => Math.min(min, t), Infinity);

    const { anchor, reason } = pickFullLaneSafeAnchor({
      notBefore: new Date(earliestCurrent),
      windowStart: "06:00",
      windowEnd: "22:00",
      intervalMin: 60,
      lanes,
    });

    if (!anchor) {
      console.log(`## Cross-lane Collision Repair (${args.dryRun ? "dry_run" : "apply"})`);
      console.log(`- content_id: ${contentId}`);
      console.log(`- BLOCKED: ${reason}`);
      console.log(`- Done rows for this content (untouched): ${doneRows.length}`);
      return;
    }
    const quoteSlot = new Date(anchor.getTime() + 5 * 60_000);

    const plan = queuedRows.map((row) => {
      const proposed = row.video_type === "quote" ? quoteSlot : anchor;
      return {
        queueId: row.id,
        platform: row.platform,
        videoType: row.video_type,
        currentVn: formatVn(row.scheduled_at),
        proposedVn: formatVn(proposed.toISOString()),
        proposedIso: proposed.toISOString(),
        changed: new Date(row.scheduled_at).getTime() !== proposed.getTime(),
      };
    });

    if (args.json) {
      console.log(JSON.stringify({ contentId, anchor: anchor.toISOString(), plan, doneRowsUntouched: doneRows.length }, null, 2));
    } else {
      console.log(`## Cross-lane Collision Repair (${args.dryRun ? "dry_run" : "apply"})`);
      console.log(`- content_id: ${contentId}`);
      console.log(`- Full-lane-safe anchor found: ${formatVn(anchor.toISOString())}`);
      console.log(`- Done rows for this content (untouched): ${doneRows.length}`);
      console.log("\n| queue_id | platform | video_type | current_vn | proposed_vn | changed |");
      console.log("|---|---|---|---|---|---|");
      for (const item of plan) {
        console.log(`| ${item.queueId} | ${item.platform} | ${item.videoType} | ${item.currentVn} | ${item.proposedVn} | ${item.changed} |`);
      }
    }

    if (args.apply) {
      for (const item of plan) {
        if (!item.changed) continue;
        await pool.query(
          `update upload_queue set scheduled_at = $1::timestamptz, updated_at = now() where id = $2 and content_id = $3 and status = 'queued'`,
          [item.proposedIso, item.queueId, contentId],
        );
      }
      console.log(`\nApplied ${plan.filter((p) => p.changed).length} row(s).`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
