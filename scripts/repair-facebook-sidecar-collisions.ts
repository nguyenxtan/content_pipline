import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { findNextAvailablePublishSlot } from "@/lib/publishing/slot-occupancy";

const { Pool } = pg;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Hard exclusion: never touch the two newly-generated experiment items, regardless of
// what the query would otherwise match.
const EXCLUDED_EXPERIMENT_CONTENT_IDS = [
  "66906ddb-b1ce-4b99-8c23-a81d81cc917e",
  "1c72518d-6227-4b20-aa2c-f57ca50cad2f",
];

type Args = {
  dryRun: boolean;
  apply: boolean;
  from: string | null;
  to: string | null;
  contentIds: string[];
  json: boolean;
};

type QueueRow = {
  id: string;
  content_id: string;
  channel_id: number;
  status: string;
  scheduled_at: string;
  created_at: string;
  image_paths: string[] | null;
};

type PlanRow = {
  queueId: string;
  contentId: string;
  oldScheduledAtUtc: string;
  oldVn: string;
  newScheduledAtUtc: string | null;
  newVn: string | null;
  mediaExists: boolean;
  canonicalHH05: boolean;
  collisionFree: boolean;
  action: "keep" | "move" | "skip_unsafe" | "skip_no_longer_queued" | "skip_missing_media";
  reason: string;
};

function parseArgs(argv: string[]): Args {
  let dryRun = true;
  let apply = false;
  let from: string | null = null;
  let to: string | null = null;
  let contentIds: string[] = [];
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--apply") {
      apply = true;
      dryRun = false;
    } else if (arg === "--from") {
      from = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--to") {
      to = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--content-ids") {
      contentIds = (argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun, apply, from, to, contentIds, json };
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

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function isCanonicalHH05(iso: string): boolean {
  const d = new Date(iso);
  return d.getUTCMinutes() === 5 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

async function checkMediaExists(pool: pg.Pool, contentId: string, imagePaths: string[] | null): Promise<boolean> {
  const firstImage = imagePaths?.[0];
  if (firstImage && fs.existsSync(resolveProjectPath(firstImage))) return true;
  const fallbackThumb = `media/videos/${contentId}-short-thumb.jpg`;
  if (fs.existsSync(resolveProjectPath(fallbackThumb))) return true;
  // Some sidecar content also stores its own dedicated quote image; check that lane too.
  const result = await pool.query<{ image_paths: string[] | null }>(
    `select image_paths from content_generations where id = $1`,
    [contentId],
  );
  const altImage = result.rows[0]?.image_paths?.[0];
  return Boolean(altImage && fs.existsSync(resolveProjectPath(altImage)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const whereParts = [
      "sc.channel_key = 'phat_phap'",
      "uq.platform = 'facebook'",
      "uq.video_type = 'quote'",
      "uq.status = 'queued'",
    ];
    const params: Array<string> = [];
    let paramIndex = 1;

    if (args.contentIds.length > 0) {
      const orParts = args.contentIds.map((prefix) => {
        params.push(prefix);
        const clause = `uq.content_id like $${paramIndex} || '%'`;
        paramIndex += 1;
        return clause;
      });
      whereParts.push(`(${orParts.join(" or ")})`);
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
        select uq.id, uq.content_id, uq.channel_id, uq.status, uq.scheduled_at::text, uq.created_at::text,
               cg.image_paths
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        left join content_generations cg on cg.id = uq.content_id
        where ${whereParts.join(" and ")}
        order by uq.scheduled_at, uq.created_at
      `,
      params,
    );

    const candidates = candidatesResult.rows.filter(
      (row) => !EXCLUDED_EXPERIMENT_CONTENT_IDS.includes(row.content_id),
    );

    // Group by (channel_id, scheduled_at); keep only groups with count > 1.
    const groups = new Map<string, QueueRow[]>();
    for (const row of candidates) {
      const key = `${row.channel_id}|${row.scheduled_at}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    const collisionGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);

    // Existing taken sidecar slots (queued + done), for collision-free proposals.
    const takenResult = await pool.query<{ channel_id: number; scheduled_at: string }>(
      `
        select uq.channel_id, uq.scheduled_at::text
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        where sc.channel_key = 'phat_phap' and uq.platform = 'facebook' and uq.video_type = 'quote'
          and uq.status in ('queued', 'uploading', 'done')
      `,
    );
    const takenByChannel = new Map<number, number[]>();
    for (const row of takenResult.rows) {
      const list = takenByChannel.get(row.channel_id) ?? [];
      list.push(new Date(row.scheduled_at).getTime());
      takenByChannel.set(row.channel_id, list);
    }

    const plan: PlanRow[] = [];

    for (const [, rows] of collisionGroups) {
      const taken = takenByChannel.get(rows[0].channel_id) ?? [];
      let isFirst = true;

      for (const row of rows) {
        const mediaExists = await checkMediaExists(pool, row.content_id, row.image_paths);
        const oldIso = new Date(row.scheduled_at).toISOString();

        if (isFirst) {
          // Earliest row in the group (by created_at) is kept in place; later rows move.
          isFirst = false;
          plan.push({
            queueId: row.id, contentId: row.content_id, oldScheduledAtUtc: oldIso, oldVn: formatVn(oldIso),
            newScheduledAtUtc: null, newVn: null, mediaExists, canonicalHH05: isCanonicalHH05(oldIso),
            collisionFree: false, action: "keep", reason: "earliest row in collision group, kept in place — only later rows move",
          });
          continue;
        }

        if (!mediaExists) {
          plan.push({
            queueId: row.id, contentId: row.content_id, oldScheduledAtUtc: oldIso, oldVn: formatVn(oldIso),
            newScheduledAtUtc: null, newVn: null, mediaExists, canonicalHH05: isCanonicalHH05(oldIso),
            collisionFree: false, action: "skip_missing_media", reason: "no resolvable source image for this sidecar row",
          });
          continue;
        }

        const nextSlot = findNextAvailablePublishSlot({
          windowStart: "06:00",
          windowEnd: "22:00",
          intervalMin: 60,
          taken,
          notBefore: new Date(row.scheduled_at),
          slotOffsetMinutes: 5,
        });

        if (!nextSlot) {
          plan.push({
            queueId: row.id, contentId: row.content_id, oldScheduledAtUtc: oldIso, oldVn: formatVn(oldIso),
            newScheduledAtUtc: null, newVn: null, mediaExists, canonicalHH05: isCanonicalHH05(oldIso),
            collisionFree: false, action: "skip_unsafe", reason: "no collision-free HH:05 slot found within 14-day horizon",
          });
          continue;
        }

        taken.push(nextSlot.getTime());
        plan.push({
          queueId: row.id, contentId: row.content_id, oldScheduledAtUtc: oldIso, oldVn: formatVn(oldIso),
          newScheduledAtUtc: nextSlot.toISOString(), newVn: formatVn(nextSlot.toISOString()),
          mediaExists, canonicalHH05: true, collisionFree: true,
          action: "move", reason: "moved to next collision-free HH:05 sidecar slot",
        });
      }
    }

    let moved = 0;
    let skipped = 0;
    let failed = 0;

    if (args.apply) {
      for (const item of plan) {
        if (item.action !== "move" || !item.newScheduledAtUtc) {
          if (item.action !== "keep") skipped += 1;
          continue;
        }
        try {
          const result = await pool.query(
            `update upload_queue set scheduled_at = $1::timestamptz, updated_at = now() where id = $2 and status = 'queued' and content_id = $3`,
            [item.newScheduledAtUtc, item.queueId, item.contentId],
          );
          if (result.rowCount && result.rowCount > 0) {
            moved += 1;
          } else {
            skipped += 1;
            item.action = "skip_no_longer_queued";
            item.reason = "row was no longer in 'queued' status at apply time — skipped, not forced";
          }
        } catch (err) {
          failed += 1;
          console.error(`Failed to move ${item.queueId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const payload = {
      mode: args.apply ? "apply" : "dry_run",
      collisionGroupsFound: collisionGroups.length,
      totalAffectedRows: plan.length,
      moved,
      skipped,
      failed,
      plan,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Facebook Sidecar Collision Repair");
    console.log(`- Mode: ${payload.mode}`);
    console.log(`- Collision groups found: ${payload.collisionGroupsFound}`);
    console.log(`- Affected rows: ${payload.totalAffectedRows}`);
    if (args.apply) {
      console.log(`- Moved: ${moved}`);
      console.log(`- Skipped: ${skipped}`);
      console.log(`- Failed: ${failed}`);
    }
    console.log("\n| queue_id | content_id | old_vn | new_vn | media_exists | canonical_hh05 | collision_free | action | reason |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const item of plan) {
      console.log(
        `| ${item.queueId} | ${item.contentId} | ${item.oldVn} | ${item.newVn ?? "-"} | ${item.mediaExists} | ${item.canonicalHH05} | ${item.collisionFree} | ${item.action} | ${item.reason} |`,
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
