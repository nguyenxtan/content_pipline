import "dotenv/config";

import { Client } from "pg";

type QueueRow = {
  id: string;
  content_id: string;
  channel_id: number;
  platform: string;
  video_type: string;
  status: string;
  scheduled_at: string;
  uploaded_at: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  error_message: string | null;
  destination_channel_key: string | null;
};

type ResyncPlan = {
  rowId: string;
  newScheduledAt: string;
};

const APPROVED_RESYNC: ResyncPlan[] = [
  { rowId: "6772619b-8800-421d-9abc-5340d701f50c", newScheduledAt: "2026-06-20T06:05:00.000Z" },
  { rowId: "ec1a6c02-dcdf-47e0-93ac-aff4140ec495", newScheduledAt: "2026-06-20T07:05:00.000Z" },
  { rowId: "99d5bbe7-7e46-487d-902b-c9db1f41a607", newScheduledAt: "2026-06-21T09:05:00.000Z" },
  { rowId: "56b5ec24-2733-4ffa-9164-d0ffb53434ff", newScheduledAt: "2026-06-20T08:05:00.000Z" },
  { rowId: "ac3577c7-f27c-4785-a7b7-5066ffec7b43", newScheduledAt: "2026-06-20T09:05:00.000Z" },
  { rowId: "eac6f82e-8ea5-4993-b235-1ce689747dc5", newScheduledAt: "2026-06-20T13:05:00.000Z" },
  { rowId: "64f3ce7b-6425-42c7-b873-32716d2e1c75", newScheduledAt: "2026-06-21T07:05:00.000Z" },
];

const APPROVED_CANCEL = [
  "3dfcc8dd-14a6-4661-833a-2d7adcb9dcc4",
  "9a52425d-f02a-4d6e-b0ec-1e254cb0004a",
  "af83b24a-4340-4f4b-9409-7dfe182cb416",
  "2fd74266-43d6-4f91-97fd-9c98244d0370",
  "6af79165-814e-43aa-866c-c47ce60417da",
  "c015b967-fc78-4fcc-889c-78b56d5cc22a",
];

const CANCELLATION_REASON = "quote_sidecar_missing_primary_short_repair";
const ACTIVE_STATUSES = ["queued", "uploading", "done"];

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function fmtRow(row: QueueRow): string {
  return [
    `id=${row.id}`,
    `content=${row.content_id}`,
    `platform=${row.platform}`,
    `video_type=${row.video_type}`,
    `status=${row.status}`,
    `scheduled_at=${new Date(row.scheduled_at).toISOString()}`,
    `channel_key=${row.destination_channel_key ?? "null"}`,
    `title=${JSON.stringify(row.title)}`,
    row.error_message ? `error=${JSON.stringify(row.error_message)}` : null,
  ].filter(Boolean).join("  ");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function loadQueueRows(client: Client, ids: string[]): Promise<Map<string, QueueRow>> {
  const result = await client.query<QueueRow>(
    `
      select
        uq.id,
        uq.content_id::text,
        uq.channel_id,
        uq.platform,
        uq.video_type,
        uq.status,
        uq.scheduled_at::text,
        uq.uploaded_at::text,
        uq.created_at::text,
        uq.updated_at::text,
        uq.title,
        uq.error_message,
        sc.channel_key as destination_channel_key
      from upload_queue uq
      join social_channels sc on sc.id = uq.channel_id
      where uq.id = any($1::text[])
    `,
    [ids],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function findAlignedPrimary(client: Client, contentId: string, quoteScheduledAt: string): Promise<QueueRow | null> {
  const primaryIso = new Date(new Date(quoteScheduledAt).getTime() - 5 * 60_000).toISOString();
  const result = await client.query<QueueRow>(
    `
      select
        uq.id,
        uq.content_id::text,
        uq.channel_id,
        uq.platform,
        uq.video_type,
        uq.status,
        uq.scheduled_at::text,
        uq.uploaded_at::text,
        uq.created_at::text,
        uq.updated_at::text,
        uq.title,
        uq.error_message,
        sc.channel_key as destination_channel_key
      from upload_queue uq
      join social_channels sc on sc.id = uq.channel_id
      where uq.content_id = $1
        and uq.video_type = 'short'
        and uq.scheduled_at = $2::timestamptz
        and uq.status = any($3::text[])
      order by uq.created_at asc
      limit 1
    `,
    [contentId, primaryIso, ACTIVE_STATUSES],
  );
  return result.rows[0] ?? null;
}

async function findOpenFuturePrimaries(client: Client, contentId: string): Promise<QueueRow[]> {
  const result = await client.query<QueueRow>(
    `
      select
        uq.id,
        uq.content_id::text,
        uq.channel_id,
        uq.platform,
        uq.video_type,
        uq.status,
        uq.scheduled_at::text,
        uq.uploaded_at::text,
        uq.created_at::text,
        uq.updated_at::text,
        uq.title,
        uq.error_message,
        sc.channel_key as destination_channel_key
      from upload_queue uq
      join social_channels sc on sc.id = uq.channel_id
      where uq.content_id = $1
        and uq.video_type = 'short'
        and uq.status = any($2::text[])
        and uq.scheduled_at >= now()
      order by uq.scheduled_at asc, uq.created_at asc
    `,
    [contentId, ["queued", "uploading"]],
  );
  return result.rows;
}

async function findQuoteCollision(client: Client, rowId: string, scheduledAt: string): Promise<QueueRow | null> {
  const result = await client.query<QueueRow>(
    `
      select
        uq.id,
        uq.content_id::text,
        uq.channel_id,
        uq.platform,
        uq.video_type,
        uq.status,
        uq.scheduled_at::text,
        uq.uploaded_at::text,
        uq.created_at::text,
        uq.updated_at::text,
        uq.title,
        uq.error_message,
        sc.channel_key as destination_channel_key
      from upload_queue uq
      join social_channels sc on sc.id = uq.channel_id
      where uq.id <> $1
        and sc.channel_key = 'phat_phap'
        and uq.platform = 'facebook'
        and uq.video_type = 'quote'
        and uq.status = any($2::text[])
        and uq.scheduled_at = $3::timestamptz
      limit 1
    `,
    [rowId, ACTIVE_STATUSES, scheduledAt],
  );
  return result.rows[0] ?? null;
}

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL is not set");
  const execute = hasFlag("--execute");
  const cancelOrphansMode = hasFlag("--cancel-orphans");
  const resyncCleanMode = hasFlag("--resync-clean");
  assert(
    Number(cancelOrphansMode) + Number(resyncCleanMode) === 1,
    "Choose exactly one mode: --cancel-orphans or --resync-clean",
  );

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const now = new Date();
    const allIds = cancelOrphansMode
      ? [...APPROVED_CANCEL]
      : [...APPROVED_RESYNC.map((row) => row.rowId)];
    const rowsById = await loadQueueRows(client, allIds);
    assert(rowsById.size === allIds.length, `Expected ${allIds.length} target rows, found ${rowsById.size}`);

    const resyncPlans: Array<{
      row: QueueRow;
      primary: QueueRow;
      newScheduledAt: string;
      collision: QueueRow | null;
    }> = [];
    const cancelPlans: Array<{
      row: QueueRow;
      activePrimaries: QueueRow[];
    }> = [];
    const skippedCancels: Array<{
      row: QueueRow;
      reason: string;
    }> = [];
    const skippedResyncs: Array<{
      row: QueueRow;
      newScheduledAt: string;
      reason: string;
      primary?: QueueRow;
      blocker?: QueueRow;
    }> = [];
    const approvedResyncTargetById = new Map(APPROVED_RESYNC.map((plan) => [plan.rowId, plan.newScheduledAt]));
    const approvedResyncTargets = new Set(APPROVED_RESYNC.map((plan) => plan.newScheduledAt));
    assert(
      approvedResyncTargets.size === APPROVED_RESYNC.length,
      "Approved resync targets must be unique",
    );

    if (resyncCleanMode) {
      for (const plan of APPROVED_RESYNC) {
        const row = rowsById.get(plan.rowId);
        assert(row, `Missing approved resync row ${plan.rowId}`);
        assert(row.status === "queued", `Resync row ${row.id} must be queued`);
        assert(row.platform === "facebook", `Resync row ${row.id} must be facebook`);
        assert(row.video_type === "quote", `Resync row ${row.id} must be quote`);
        assert(row.destination_channel_key === "phat_phap", `Resync row ${row.id} must target phat_phap`);

        const newScheduledAt = new Date(plan.newScheduledAt);
        assert(Number.isFinite(newScheduledAt.getTime()), `Invalid target time for ${row.id}`);
        assert(newScheduledAt.getUTCMinutes() === 5, `Resync row ${row.id} target minute must be 05`);
        if (newScheduledAt.getTime() <= now.getTime()) {
          skippedResyncs.push({
            row,
            newScheduledAt: newScheduledAt.toISOString(),
            reason: "target_in_past",
          });
          continue;
        }

        const primary = await findAlignedPrimary(client, row.content_id, plan.newScheduledAt);
        assert(primary, `Resync row ${row.id} has no aligned primary at target-5m`);
        assert(primary.content_id === row.content_id, `Resync row ${row.id} primary content mismatch`);
        assert(primary.video_type === "short", `Resync row ${row.id} primary must be short`);
        assert(primary.platform === "youtube" || primary.platform === "facebook", `Resync row ${row.id} primary platform invalid`);

        const collision = await findQuoteCollision(client, row.id, plan.newScheduledAt);
        const allowedCollision = !collision ||
          APPROVED_CANCEL.includes(collision.id) ||
          (
            approvedResyncTargetById.has(collision.id) &&
            approvedResyncTargetById.get(collision.id) !== plan.newScheduledAt
          );

        if (!allowedCollision && collision) {
          skippedResyncs.push({
            row,
            newScheduledAt: newScheduledAt.toISOString(),
            reason: "target_slot_blocked",
            primary,
            blocker: collision,
          });
          continue;
        }

        resyncPlans.push({
          row,
          primary,
          newScheduledAt: newScheduledAt.toISOString(),
          collision: collision ?? null,
        });
      }
    }

    if (cancelOrphansMode) {
      for (const rowId of APPROVED_CANCEL) {
        const row = rowsById.get(rowId);
        assert(row, `Missing approved cancel row ${rowId}`);
        if (row.status !== "queued") {
          skippedCancels.push({
            row,
            reason: `status=${row.status}`,
          });
          continue;
        }
        assert(row.platform === "facebook", `Cancel row ${row.id} must be facebook`);
        assert(row.video_type === "quote", `Cancel row ${row.id} must be quote`);
        assert(row.destination_channel_key === "phat_phap", `Cancel row ${row.id} must target phat_phap`);
        assert(row.uploaded_at == null, `Cancel row ${row.id} must not be published`);

        const activePrimaries = await findOpenFuturePrimaries(client, row.content_id);
        assert(activePrimaries.length === 0, `Cancel row ${row.id} still has ${activePrimaries.length} active primary row(s)`);

        cancelPlans.push({ row, activePrimaries });
      }
    }

    console.log(`repair-phat-phap-quote-pairs ${cancelOrphansMode ? "--cancel-orphans" : "--resync-clean"} ${execute ? "(execute)" : "(dry-run)"}`);
    console.log(`  resync_plans=${resyncPlans.length}`);
    console.log(`  cancel_plans=${cancelPlans.length}`);
    console.log(`  skipped_resyncs=${skippedResyncs.length}`);
    console.log(`  skipped_cancels=${skippedCancels.length}`);
    console.log(`  create=0 delete=0 publish=0 retry=0`);

    if (resyncCleanMode) {
      console.log("");
      console.log("Resync Plans");
      for (const plan of resyncPlans) {
        console.log(`  quote:   ${fmtRow(plan.row)}`);
        console.log(`  primary: ${fmtRow(plan.primary)}`);
        console.log(`  target_scheduled_at=${plan.newScheduledAt}`);
      }
      console.log("");
      console.log("Skipped Resyncs");
      if (skippedResyncs.length === 0) {
        console.log("  none");
      } else {
        for (const plan of skippedResyncs) {
          console.log(`  quote:   ${fmtRow(plan.row)}`);
          console.log(`  target_scheduled_at=${plan.newScheduledAt}`);
          console.log(`  skip_reason=${plan.reason}`);
          if (plan.primary) {
            console.log(`  primary: ${fmtRow(plan.primary)}`);
          }
          if (plan.blocker) {
            console.log(`  blocker: ${fmtRow(plan.blocker)}`);
          }
        }
      }
    }

    if (cancelOrphansMode) {
      console.log("");
      console.log("Cancel Plans");
      for (const plan of cancelPlans) {
        console.log(`  quote: ${fmtRow(plan.row)}`);
        console.log(`  cancel_reason=${CANCELLATION_REASON}`);
      }
      console.log("");
      console.log("Skipped Cancels");
      if (skippedCancels.length === 0) {
        console.log("  none");
      } else {
        for (const plan of skippedCancels) {
          console.log(`  quote: ${fmtRow(plan.row)}`);
          console.log(`  skip_reason=${plan.reason}`);
        }
      }
    }

    if (!execute) {
      console.log("");
      console.log("Dry run complete. Re-run with --execute to apply.");
      return;
    }

    await client.query("begin");
    try {
      if (cancelOrphansMode) {
        for (const plan of cancelPlans) {
          await client.query(
            `
              update upload_queue
                 set status = 'cancelled',
                     error_message = $2,
                     updated_at = now()
               where id = $1
            `,
            [plan.row.id, CANCELLATION_REASON],
          );
        }
      }

      if (resyncCleanMode) {
        for (const plan of resyncPlans) {
          await client.query(
            `
              update upload_queue
                 set scheduled_at = $2::timestamptz,
                     updated_at = now()
               where id = $1
            `,
            [plan.row.id, plan.newScheduledAt],
          );
        }
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    const postRows = await loadQueueRows(client, allIds);
    console.log("");
    console.log("Post State");
    if (resyncCleanMode) {
      for (const plan of resyncPlans) {
        const row = postRows.get(plan.row.id);
        assert(row, `Missing post-state resync row ${plan.row.id}`);
        console.log(`  resynced: ${fmtRow(row)}`);
      }
    }
    if (cancelOrphansMode) {
      for (const plan of cancelPlans) {
        const row = postRows.get(plan.row.id);
        assert(row, `Missing post-state cancel row ${plan.row.id}`);
        console.log(`  cancelled: ${fmtRow(row)}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
