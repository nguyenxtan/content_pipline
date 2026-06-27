import "dotenv/config";

import pg from "pg";

const { Pool } = pg;

type Args = {
  from: string;
  to: string;
};

function parseArgs(): Args {
  const from = process.argv.find((arg) => arg.startsWith("--from="))?.split("=")[1];
  const to = process.argv.find((arg) => arg.startsWith("--to="))?.split("=")[1];

  if (!from || !to) {
    throw new Error("Usage: scripts/audit-phat-phap-video-content-flow.ts --from=<iso> --to=<iso>");
  }

  return { from, to };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const { from, to } = parseArgs();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const [contentRows, queueRows, socialRows] = await Promise.all([
      pool.query<{
        format_type: string | null;
        row_count: string;
        with_quote_prompt: string;
      }>(`
        select
          cg.format_type,
          count(*)::text as row_count,
          count(*) filter (
            where coalesce(jsonb_typeof(cg.prompt_versions::jsonb -> 'quote'), 'null') <> 'null'
          )::text as with_quote_prompt
        from content_generations cg
        where cg.channel_key = 'phat_phap'
          and cg.created_at >= $1::timestamptz
          and cg.created_at <  $2::timestamptz
        group by cg.format_type
        order by cg.format_type nulls last
      `, [from, to]),
      pool.query<{
        format_type: string | null;
        platform: string;
        video_type: string;
        status: string;
        row_count: string;
      }>(`
        select
          cg.format_type,
          uq.platform,
          uq.video_type,
          uq.status,
          count(*)::text as row_count
        from upload_queue uq
        join content_generations cg on cg.id = uq.content_id
        where cg.channel_key = 'phat_phap'
          and uq.created_at >= $1::timestamptz
          and uq.created_at <  $2::timestamptz
        group by cg.format_type, uq.platform, uq.video_type, uq.status
        order by cg.format_type nulls last, uq.platform, uq.video_type, uq.status
      `, [from, to]),
      pool.query<{
        id: number;
        name: string;
        platform: string;
        channel_key: string | null;
        is_active: boolean | null;
        needs_reconnect: boolean | null;
      }>(`
        select
          sc.id,
          sc.name,
          sc.platform,
          sc.channel_key,
          sc.is_active,
          sc.needs_reconnect
        from social_channels sc
        where sc.name = 'Trí Tuệ An Nhiên'
           or (sc.channel_key = 'phat_phap' and sc.platform = 'facebook')
        order by sc.id
      `),
    ]);

    console.log(JSON.stringify({
      window: { from, to },
      contentGenerations: contentRows.rows.map((row) => ({
        formatType: row.format_type,
        rowCount: Number(row.row_count),
        withPromptVersionsQuote: Number(row.with_quote_prompt),
      })),
      uploadQueue: queueRows.rows.map((row) => ({
        formatType: row.format_type,
        platform: row.platform,
        videoType: row.video_type,
        status: row.status,
        rowCount: Number(row.row_count),
      })),
      socialChannels: socialRows.rows,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
