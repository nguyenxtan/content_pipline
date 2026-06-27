import "dotenv/config";

import pg from "pg";

const { Pool } = pg;

type Args = { contentIds: string[]; from: string | null; to: string | null; json: boolean };

function parseArgs(argv: string[]): Args {
  let contentIds: string[] = [];
  let from: string | null = null;
  let to: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--content-ids") {
      contentIds = (argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--from") {
      from = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--to") {
      to = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (contentIds.length === 0) throw new Error("--content-ids is required");
  return { contentIds, from, to, json };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const resolved = await pool.query<{ id: string }>(
      `select id from content_generations where ${args.contentIds.map((_, i) => `id like $${i + 1} || '%'`).join(" or ")}`,
      args.contentIds,
    );
    const ids = resolved.rows.map((r) => r.id);

    const contentResult = await pool.query(
      `
        select id, topic, format_type, topic_family, hook_pattern, channel_key, video_status,
               created_at::text, experiment_id, experiment_variant, prompt_versions
        from content_generations where id = any($1)
      `,
      [ids],
    );

    const queueResult = await pool.query(
      `
        select uq.id as queue_id, uq.content_id, uq.platform, uq.video_type, uq.channel_id, sc.platform_channel_id,
               uq.status, uq.scheduled_at::text, uq.error_message, uq.created_at::text, uq.updated_at::text
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        where uq.content_id = any($1)
        order by uq.created_at
      `,
      [ids],
    );

    const publishedResult = await pool.query(
      `select content_id, platform, platform_video_id, published_at::text, created_at::text from published_videos where content_id = any($1)`,
      [ids],
    );

    // Find any other rows sharing the exact same (platform, video_type, scheduled_at) as
    // any of our traced rows, to confirm the collision footprint precisely.
    const sameSlotRows: unknown[] = [];
    for (const row of queueResult.rows as Array<{ platform: string; video_type: string; scheduled_at: string; content_id: string }>) {
      const r = await pool.query(
        `
          select uq.id, uq.content_id, uq.platform, uq.video_type, uq.status, uq.scheduled_at::text, uq.created_at::text
          from upload_queue uq
          join social_channels sc on sc.id = uq.channel_id
          where sc.channel_key = 'phat_phap' and uq.platform = $1 and uq.video_type = $2
            and uq.scheduled_at = $3::timestamptz
            and uq.content_id != $4
        `,
        [row.platform, row.video_type, row.scheduled_at, row.content_id],
      );
      if (r.rows.length > 0) sameSlotRows.push({ basedOn: row.content_id, platform: row.platform, videoType: row.video_type, scheduledAt: row.scheduled_at, others: r.rows });
    }

    // Rows updated within the same minute as any traced row, across the whole channel —
    // a proxy for "single batch job" detection.
    const minuteWindows = (queueResult.rows as Array<{ updated_at: string }>).map((r) => r.updated_at.slice(0, 16));
    const uniqueMinutes = [...new Set(minuteWindows)];
    const sameMinuteRows = uniqueMinutes.length
      ? await pool.query(
          `
            select uq.id, uq.content_id, uq.platform, uq.video_type, uq.status, uq.updated_at::text
            from upload_queue uq
            join social_channels sc on sc.id = uq.channel_id
            where sc.channel_key = 'phat_phap'
              and to_char(uq.updated_at, 'YYYY-MM-DD"T"HH24:MI') = any($1)
            order by uq.updated_at
          `,
          [uniqueMinutes],
        )
      : { rows: [] };

    const createdAtMinutes = (contentResult.rows as Array<{ created_at: string }>).map((r) => r.created_at.slice(0, 16));
    const sameCreatedMinute = new Set(createdAtMinutes).size === 1 && createdAtMinutes.length > 1;

    const topicFamilies = new Set((contentResult.rows as Array<{ topic_family: string | null }>).map((r) => r.topic_family));
    const experimentIds = new Set((contentResult.rows as Array<{ experiment_id: string | null }>).map((r) => r.experiment_id));

    const payload = {
      meta: { contentIds: ids, from: args.from, to: args.to },
      contentGenerations: contentResult.rows,
      uploadQueueRows: queueResult.rows,
      publishedVideos: publishedResult.rows,
      sameSlotOccupancy: sameSlotRows,
      sameMinuteActivityAcrossChannel: sameMinuteRows.rows,
      sharedSignals: {
        sameCreatedAtMinute: sameCreatedMinute,
        sameTopicFamily: topicFamilies.size === 1,
        sameExperimentId: experimentIds.size === 1 && ![...experimentIds].includes(null as unknown as string),
        topicFamilies: [...topicFamilies],
        experimentIds: [...experimentIds],
      },
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Queue Collision Origin Trace (read-only)");
    console.log(`- Resolved content ids: ${ids.join(", ")}`);
    console.log("\n### content_generations");
    for (const row of contentResult.rows as Array<Record<string, unknown>>) {
      console.log(`- ${row.id} | topic=${row.topic} | family=${row.topic_family} | hook=${row.hook_pattern} | experiment=${row.experiment_id}/${row.experiment_variant} | created_at=${row.created_at}`);
    }
    console.log("\n### upload_queue rows (all statuses)");
    console.log("| queue_id | content_id | platform | video_type | channel_id | status | scheduled_at | created_at | updated_at | error_message |");
    console.log("|---|---|---|---|---:|---|---|---|---|---|");
    for (const row of queueResult.rows as Array<Record<string, unknown>>) {
      console.log(`| ${row.queue_id} | ${row.content_id} | ${row.platform} | ${row.video_type} | ${row.channel_id} | ${row.status} | ${row.scheduled_at} | ${row.created_at} | ${row.updated_at} | ${row.error_message ?? "-"} |`);
    }
    console.log("\n### published_videos");
    for (const row of publishedResult.rows as Array<Record<string, unknown>>) {
      console.log(`- ${JSON.stringify(row)}`);
    }
    console.log("\n### Same-slot occupancy (other content_ids sharing platform+video_type+scheduled_at)");
    for (const entry of sameSlotRows as Array<Record<string, unknown>>) {
      console.log(`- based on ${entry.basedOn} (${entry.platform}/${entry.videoType} @ ${entry.scheduledAt}): ${JSON.stringify(entry.others)}`);
    }
    console.log("\n### Same-minute channel activity (proxy for batch job)");
    for (const row of sameMinuteRows.rows as Array<Record<string, unknown>>) {
      console.log(`- ${row.id} | ${row.content_id} | ${row.platform}/${row.video_type} | ${row.status} | ${row.updated_at}`);
    }
    console.log("\n### Shared signals");
    console.log(JSON.stringify(payload.sharedSignals, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
