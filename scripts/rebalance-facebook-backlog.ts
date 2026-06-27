import { config as loadEnv } from "dotenv";

import pg from "pg";

loadEnv({ path: ".env.local" });
loadEnv();

const { Pool } = pg;

const EXECUTE = process.argv.includes("--execute");
const PROTECT_NEXT_HOURS = 8;
const CANCELLATION_REASON = "queue_rebalance_facebook_backlog_cleanup";

type CandidateRow = {
  queue_id: string;
  content_id: string;
  scheduled_at: Date;
  created_at: Date;
  topic: string;
  experiment_id: string | null;
  experiment_variant: string | null;
  has_yt_published: boolean;
  has_fb_published: boolean;
  paired_fb_short: boolean;
};

function createPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

async function loadCounts(client: pg.PoolClient) {
  const result = await client.query<{
    pending_all: number;
    youtube_pending: number;
    facebook_pending: number;
    facebook_quote_pending: number;
    facebook_short_pending: number;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('queued','uploading'))::int AS pending_all,
        COUNT(*) FILTER (WHERE platform = 'youtube'  AND status IN ('queued','uploading'))::int AS youtube_pending,
        COUNT(*) FILTER (WHERE platform = 'facebook' AND status IN ('queued','uploading'))::int AS facebook_pending,
        COUNT(*) FILTER (WHERE platform = 'facebook' AND video_type = 'quote' AND status IN ('queued','uploading'))::int AS facebook_quote_pending,
        COUNT(*) FILTER (WHERE platform = 'facebook' AND video_type = 'short' AND status IN ('queued','uploading'))::int AS facebook_short_pending
      FROM upload_queue
    `,
  );
  return result.rows[0];
}

async function loadCandidates(client: pg.PoolClient): Promise<CandidateRow[]> {
  const result = await client.query<CandidateRow>(
    `
      SELECT
        uq.id AS queue_id,
        uq.content_id,
        uq.scheduled_at,
        uq.created_at,
        cg.topic,
        cg.experiment_id,
        cg.experiment_variant,
        EXISTS (
          SELECT 1 FROM published_videos pv
          WHERE pv.content_id = cg.id
            AND pv.platform = 'youtube'
        ) AS has_yt_published,
        EXISTS (
          SELECT 1 FROM published_videos pv
          WHERE pv.content_id = cg.id
            AND pv.platform = 'facebook'
        ) AS has_fb_published,
        EXISTS (
          SELECT 1 FROM upload_queue uq_short
          WHERE uq_short.content_id = cg.id
            AND uq_short.platform = 'facebook'
            AND uq_short.video_type = 'short'
            AND uq_short.status IN ('queued', 'uploading')
        ) AS paired_fb_short
      FROM upload_queue uq
      INNER JOIN content_generations cg ON cg.id = uq.content_id
      WHERE uq.platform = 'facebook'
        AND uq.video_type = 'quote'
        AND uq.status = 'queued'
      ORDER BY uq.scheduled_at ASC, uq.created_at ASC
    `,
  );
  return result.rows;
}

function evaluateCandidate(row: CandidateRow, now = new Date()) {
  const protectedUntil = new Date(now.getTime() + PROTECT_NEXT_HOURS * 60 * 60 * 1000);
  const reasons: string[] = [];
  const safeReasons: string[] = [];

  if (!row.has_yt_published) reasons.push("youtube_not_published");
  if (row.experiment_id || row.experiment_variant) reasons.push("experiment_tagged");
  if (row.scheduled_at <= protectedUntil && !row.has_fb_published) reasons.push("protected_near_term_slot");

  if (row.has_fb_published) {
    safeReasons.push("already_published_on_facebook");
  } else if (row.paired_fb_short && row.scheduled_at > protectedUntil) {
    safeReasons.push("paired_with_facebook_short_far_future");
  }

  const safeToCancel = reasons.length === 0 && safeReasons.length > 0;
  return {
    queueId: row.queue_id,
    contentId: row.content_id,
    topic: row.topic,
    scheduledAt: row.scheduled_at.toISOString(),
    safeToCancel,
    safeReasons,
    skipReasons: safeToCancel ? [] : reasons.length > 0 ? reasons : ["not_redundant_enough"],
  };
}

async function cancelRows(client: pg.PoolClient, queueIds: string[]) {
  if (queueIds.length === 0) return 0;
  const result = await client.query(
    `
      UPDATE upload_queue
      SET
        status = 'cancelled',
        error_message = $2,
        updated_at = NOW()
      WHERE id = ANY($1::text[])
        AND status = 'queued'
    `,
    [queueIds, CANCELLATION_REASON],
  );
  return result.rowCount ?? 0;
}

async function main() {
  const pool = createPool();
  const client = await pool.connect();

  try {
    const before = await loadCounts(client);
    const rows = await loadCandidates(client);
    const evaluations = rows.map((row) => evaluateCandidate(row));
    const selected = evaluations.filter((row) => row.safeToCancel);
    const skipped = evaluations.filter((row) => !row.safeToCancel);

    console.log(`pending before: ${before.pending_all}`);
    console.log(`youtube pending before: ${before.youtube_pending}`);
    console.log(`facebook pending before: ${before.facebook_pending}`);
    console.log(`facebook quote pending before: ${before.facebook_quote_pending}`);
    console.log(`facebook short pending before: ${before.facebook_short_pending}`);
    console.log(`selected rows: ${selected.length}`);

    const skippedReasons = skipped.reduce<Record<string, number>>((acc, row) => {
      for (const reason of row.skipReasons) acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`skipped reasons: ${JSON.stringify(skippedReasons)}`);

    if (!EXECUTE) {
      console.log(JSON.stringify({
        mode: "dry_run",
        selected,
        skipped,
        before,
        afterSimulated: {
          pending_all: before.pending_all - selected.length,
          facebook_pending: before.facebook_pending - selected.length,
          facebook_quote_pending: before.facebook_quote_pending - selected.length,
          youtube_pending: before.youtube_pending,
          facebook_short_pending: before.facebook_short_pending,
        },
      }, null, 2));
      return;
    }

    await client.query("BEGIN");
    const updated = await cancelRows(client, selected.map((row) => row.queueId));
    await client.query("COMMIT");

    const after = await loadCounts(client);
    console.log(JSON.stringify({
      mode: "execute",
      cancelled: updated,
      before,
      after,
      selected,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
