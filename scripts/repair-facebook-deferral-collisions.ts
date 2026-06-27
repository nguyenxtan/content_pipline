import "dotenv/config";

import pg from "pg";
import { findNextAvailablePublishSlot } from "@/lib/publishing/slot-occupancy";

const { Pool } = pg;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

type Args = {
  dryRun: boolean;
  apply: boolean;
  channelKey: string;
  from: string | null;
  to: string | null;
  collisionAt: string | null;
  json: boolean;
};

type QueueRow = {
  id: string;
  content_id: string;
  channel_id: number;
  platform_channel_id: string | null;
  video_type: string;
  scheduled_at: string;
  created_at: string;
};

type YoutubeCounterpart = { status: string; scheduled_at: string } | null;

type PlanRow = {
  queueId: string;
  contentId: string;
  videoType: string;
  currentScheduledAtUtc: string;
  currentScheduledAtVn: string;
  proposedScheduledAtUtc: string | null;
  proposedScheduledAtVn: string | null;
  reason: string;
  pairImpact: string;
  safeToApply: boolean;
};

function parseArgs(argv: string[]): Args {
  let dryRun = true;
  let apply = false;
  let channelKey = "phat_phap";
  let from: string | null = null;
  let to: string | null = null;
  let collisionAt: string | null = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      dryRun = false;
      continue;
    }
    if (arg === "--channel-key") {
      channelKey = argv[index + 1] ?? "phat_phap";
      index += 1;
      continue;
    }
    if (arg === "--from") {
      from = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--to") {
      to = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--collision-at") {
      collisionAt = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, apply, channelKey, from, to, collisionAt, json };
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
    const whereParts = [
      "sc.channel_key = $1",
      "uq.platform = 'facebook'",
      "uq.status = 'queued'",
    ];
    const params: Array<string> = [args.channelKey];
    let paramIndex = 2;
    if (args.collisionAt) {
      whereParts.push(`uq.scheduled_at = $${paramIndex}::timestamptz`);
      params.push(args.collisionAt);
      paramIndex += 1;
    } else {
      if (args.from) {
        whereParts.push(`uq.scheduled_at >= $${paramIndex}::timestamptz`);
        params.push(args.from);
        paramIndex += 1;
      }
      if (args.to) {
        whereParts.push(`uq.scheduled_at < $${paramIndex}::timestamptz`);
        params.push(args.to);
        paramIndex += 1;
      }
    }

    const candidatesResult = await pool.query<QueueRow>(
      `
        select uq.id, uq.content_id, uq.channel_id, sc.platform_channel_id,
               uq.video_type, uq.scheduled_at::text, uq.created_at::text
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        where ${whereParts.join(" and ")}
        order by uq.scheduled_at, uq.video_type, uq.created_at
      `,
      params,
    );
    const candidates = candidatesResult.rows;

    // Group by (channel_id, video_type, scheduled_at); keep only groups with count > 1.
    const groups = new Map<string, QueueRow[]>();
    for (const row of candidates) {
      const key = `${row.channel_id}|${row.video_type}|${row.scheduled_at}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    const collisionGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);

    if (args.collisionAt && collisionGroups.length === 0) {
      // Defensive: even if not grouped as >1 yet (e.g. only one lane had a collision),
      // still surface every row at the requested timestamp for visibility.
      const exact = candidates.filter((r) => r.scheduled_at === new Date(args.collisionAt!).toISOString());
      if (exact.length > 0) collisionGroups.push([`manual:${args.collisionAt}`, exact]);
    }

    // Existing taken slots per (channelId, videoType) lane, for collision-free proposals.
    const takenResult = await pool.query<{ channel_id: number; video_type: string; scheduled_at: string }>(
      `
        select uq.channel_id, uq.video_type, uq.scheduled_at::text
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        where sc.channel_key = $1 and uq.platform = 'facebook'
          and uq.status in ('queued', 'uploading', 'done')
      `,
      [args.channelKey],
    );
    const takenByLane = new Map<string, number[]>();
    for (const row of takenResult.rows) {
      const key = `${row.channel_id}|${row.video_type}`;
      const list = takenByLane.get(key) ?? [];
      list.push(new Date(row.scheduled_at).getTime());
      takenByLane.set(key, list);
    }

    const youtubeCache = new Map<string, YoutubeCounterpart>();
    async function getYoutubeCounterpart(contentId: string): Promise<YoutubeCounterpart> {
      if (youtubeCache.has(contentId)) return youtubeCache.get(contentId) ?? null;
      const result = await pool.query<{ status: string; scheduled_at: string }>(
        `select status, scheduled_at::text from upload_queue where content_id = $1 and platform = 'youtube' and video_type = 'short' order by created_at desc limit 1`,
        [contentId],
      );
      const value = result.rows[0] ?? null;
      youtubeCache.set(contentId, value);
      return value;
    }

    const plan: PlanRow[] = [];

    for (const [, rows] of collisionGroups) {
      const laneKey = `${rows[0].channel_id}|${rows[0].video_type}`;
      const taken = takenByLane.get(laneKey) ?? [];

      for (const row of rows) {
        const yt = row.video_type === "quote" ? null : await getYoutubeCounterpart(row.content_id);
        let pairImpact: string;
        let safeToApply = true;

        if (row.video_type === "quote") {
          pairImpact = "not_applicable_quote_sidecar_lane";
        } else if (!yt) {
          pairImpact = "missing_youtube_pair_no_drift_possible";
        } else if (yt.status === "done") {
          pairImpact = `pre_existing_drift_yt_done_immutable (yt_scheduled_at=${yt.scheduled_at})`;
        } else if (yt.status === "queued" || yt.status === "uploading") {
          pairImpact = `would_create_new_drift_vs_live_youtube_row (yt_status=${yt.status}, yt_scheduled_at=${yt.scheduled_at})`;
          safeToApply = false;
        } else {
          pairImpact = `yt_row_inactive_status_${yt.status} (yt_scheduled_at=${yt.scheduled_at})`;
        }

        const slotOffsetMinutes = row.video_type === "quote" ? 5 : 0;
        const proposedSlot = safeToApply
          ? findNextAvailablePublishSlot({
              windowStart: "06:00",
              windowEnd: "22:00",
              intervalMin: 60,
              taken,
              notBefore: new Date(row.scheduled_at),
              slotOffsetMinutes,
            })
          : null;

        if (proposedSlot) taken.push(proposedSlot.getTime());
        if (safeToApply && !proposedSlot) safeToApply = false;

        plan.push({
          queueId: row.id,
          contentId: row.content_id,
          videoType: row.video_type,
          currentScheduledAtUtc: row.scheduled_at,
          currentScheduledAtVn: formatVn(row.scheduled_at),
          proposedScheduledAtUtc: proposedSlot ? proposedSlot.toISOString() : null,
          proposedScheduledAtVn: proposedSlot ? formatVn(proposedSlot.toISOString()) : null,
          reason: proposedSlot
            ? "spread off collision onto next collision-free canonical lane slot"
            : safeToApply
              ? "no safe slot found within 14-day horizon"
              : "unsafe — paired YouTube row is still live; would create new ADR-034 drift",
          pairImpact,
          safeToApply: safeToApply && proposedSlot != null,
        });
      }
    }

    let applied = 0;
    let skipped = 0;
    if (args.apply) {
      for (const item of plan) {
        if (!item.safeToApply || !item.proposedScheduledAtUtc) {
          skipped += 1;
          continue;
        }
        await pool.query(
          `update upload_queue set scheduled_at = $1::timestamptz, updated_at = now() where id = $2 and status = 'queued'`,
          [item.proposedScheduledAtUtc, item.queueId],
        );
        applied += 1;
      }
    }

    const payload = {
      mode: args.apply ? "apply" : "dry_run",
      collisionGroupsFound: collisionGroups.length,
      totalAffectedRows: plan.length,
      safeToApplyCount: plan.filter((p) => p.safeToApply).length,
      unsafeCount: plan.filter((p) => !p.safeToApply).length,
      applied,
      skipped,
      plan,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Facebook Deferral Collision Repair");
    console.log(`- Mode: ${payload.mode}`);
    console.log(`- Collision groups found: ${payload.collisionGroupsFound}`);
    console.log(`- Affected rows: ${payload.totalAffectedRows}`);
    console.log(`- Safe to apply: ${payload.safeToApplyCount}`);
    console.log(`- Unsafe (manual review): ${payload.unsafeCount}`);
    if (args.apply) {
      console.log(`- Applied: ${applied}`);
      console.log(`- Skipped: ${skipped}`);
    }
    console.log("\n| queue_id | content_id | video_type | current_vn | proposed_vn | pair_impact | safe_to_apply |");
    console.log("|---|---|---|---|---|---|---|");
    for (const item of plan) {
      console.log(
        `| ${item.queueId} | ${item.contentId} | ${item.videoType} | ${item.currentScheduledAtVn} | ${item.proposedScheduledAtVn ?? "-"} | ${item.pairImpact} | ${item.safeToApply} |`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
