import "dotenv/config";

import pg from "pg";

const { Pool } = pg;

type Args = {
  from: string | null;
  to: string | null;
  channelKey: string;
  limit: number;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  let from: string | null = null;
  let to: string | null = null;
  let channelKey = "phat_phap";
  let limit = 20;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
    if (arg === "--channel-key") {
      channelKey = argv[index + 1] ?? "phat_phap";
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const parsed = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--limit must be positive");
      limit = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { from, to, channelKey, limit, json };
}

type QueueRow = {
  id: string;
  content_id: string;
  channel_id: number;
  platform: string;
  video_type: string;
  status: string;
  scheduled_at: string;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  format_type: string | null;
  topic: string | null;
};

function classifyError(message: string | null): string {
  if (!message) return "none";
  const m = message.toLowerCase();
  if (m.includes("quote_sidecar_missing_primary_short")) return "missing_media_unrecoverable";
  if (m.includes("fetch failed") || m.includes("chưa sẵn sàng")) return "platform_api_problem";
  if (m.includes("token") || m.includes("invalid_grant") || m.includes("reconnect")) return "token_auth_problem";
  if (m.includes("dời lịch") || m.includes("khoảng cách")) return "queue_spacing_deferral";
  if (m.includes("slot_collision") || m.includes("collision")) return "queue_data_problem";
  if (m.includes("quota") || m.includes("rate limit")) return "platform_api_problem";
  if (m.includes("permission")) return "destination_routing_problem";
  if (m.includes("caption") || m.includes("title")) return "queue_data_problem";
  if (m.includes("media") || m.includes("file") || m.includes("path")) return "missing_media_unrecoverable";
  return "unknown";
}

function isRetryable(errorClass: string): boolean {
  return errorClass === "platform_api_problem" || errorClass === "queue_spacing_deferral";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const whereParts = ["sc.channel_key = $1"];
    const params: Array<string | number> = [args.channelKey];
    let paramIndex = 2;
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

    const rowsResult = await pool.query<QueueRow>(
      `
        select
          uq.id, uq.content_id, uq.channel_id, uq.platform, uq.video_type, uq.status,
          uq.scheduled_at::text, uq.created_at::text, uq.updated_at::text, uq.error_message,
          cg.format_type, cg.topic
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        left join content_generations cg on cg.id = uq.content_id
        where ${whereParts.join(" and ")}
        order by uq.scheduled_at asc
      `,
      params,
    );
    const rows = rowsResult.rows;

    const statusCounts = new Map<string, number>();
    for (const row of rows) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);

    const now = new Date();
    const overdueQueued = rows.filter((r) => r.status === "queued" && new Date(r.scheduled_at) < now);
    const staleUploading = rows.filter(
      (r) => r.status === "uploading" && now.getTime() - new Date(r.updated_at).getTime() > 10 * 60 * 1000,
    );

    const errorClassCounts = new Map<string, { count: number; retryable: boolean; example: QueueRow }>();
    for (const row of rows) {
      if (!row.error_message) continue;
      const errorClass = classifyError(row.error_message);
      const existing = errorClassCounts.get(errorClass);
      if (existing) existing.count += 1;
      else errorClassCounts.set(errorClass, { count: 1, retryable: isRetryable(errorClass), example: row });
    }

    // Slot collisions: same (platform, channel_id, video_type, scheduled_at) with >1 distinct content_id,
    // restricted to statuses that actually occupy a slot.
    const occupyingStatuses = new Set(["queued", "uploading", "done"]);
    const slotMap = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!occupyingStatuses.has(row.status)) continue;
      const key = `${row.platform}|${row.channel_id}|${row.video_type}|${row.scheduled_at}`;
      const set = slotMap.get(key) ?? new Set<string>();
      set.add(row.content_id);
      slotMap.set(key, set);
    }
    const slotCollisions = [...slotMap.entries()]
      .filter(([, contentIds]) => contentIds.size > 1)
      .map(([key, contentIds]) => ({ key, contentIds: [...contentIds] }));

    // Schedule misalignment: short/reel rows not on :00, FB quote rows not on :05.
    const misaligned = rows.filter((row) => {
      const minute = new Date(row.scheduled_at).getUTCMinutes();
      const second = new Date(row.scheduled_at).getUTCSeconds();
      const ms = new Date(row.scheduled_at).getUTCMilliseconds();
      if (second !== 0 || ms !== 0) return true;
      if (row.video_type === "short" && minute !== 0) return true;
      if (row.video_type === "quote" && minute !== 5) return true;
      return false;
    });

    // Content pairing: for tts_short/legacy_quote_short video_type='short' rows, expect one
    // youtube + one facebook row sharing the same content_id and scheduled_at.
    const shortRows = rows.filter((r) => r.video_type === "short");
    const byContent = new Map<string, QueueRow[]>();
    for (const row of shortRows) {
      const list = byContent.get(row.content_id) ?? [];
      list.push(row);
      byContent.set(row.content_id, list);
    }
    const pairViolations: Array<{ contentId: string; issue: string; detail: string }> = [];
    for (const [contentId, group] of byContent.entries()) {
      const yt = group.filter((r) => r.platform === "youtube");
      const fb = group.filter((r) => r.platform === "facebook");
      if (yt.length === 0) pairViolations.push({ contentId, issue: "missing_youtube_pair", detail: "no youtube/short row" });
      if (fb.length === 0) pairViolations.push({ contentId, issue: "missing_facebook_pair", detail: "no facebook/short row" });
      if (yt.length > 1) pairViolations.push({ contentId, issue: "duplicate_platform_rows", detail: `${yt.length} youtube rows` });
      if (fb.length > 1) pairViolations.push({ contentId, issue: "duplicate_platform_rows", detail: `${fb.length} facebook rows` });
      if (yt.length === 1 && fb.length === 1 && yt[0].scheduled_at !== fb[0].scheduled_at) {
        pairViolations.push({
          contentId,
          issue: "misaligned_scheduled_at",
          detail: `yt=${yt[0].scheduled_at} fb=${fb[0].scheduled_at}`,
        });
      }
    }

    // Wrong-lane: facebook video_type='quote' rows whose content_id's format_type is not
    // facebook_quote_photo (i.e. a legacy_quote_short video got miscategorized into the photo lane).
    const wrongLaneRows = rows.filter(
      (r) => r.platform === "facebook" && r.video_type === "quote" && r.format_type === "legacy_quote_short",
    );

    const publisherCandidates = rows.filter((r) => r.status === "queued").slice(0, args.limit);

    const payload = {
      meta: { from: args.from, to: args.to, channelKey: args.channelKey, limit: args.limit },
      statusCounts: Object.fromEntries(statusCounts.entries()),
      totalRows: rows.length,
      overdueQueuedCount: overdueQueued.length,
      staleUploadingCount: staleUploading.length,
      errorClasses: [...errorClassCounts.entries()].map(([errorClass, info]) => ({
        errorClass,
        count: info.count,
        retryable: info.retryable,
        exampleContentId: info.example.content_id,
        examplePlatform: info.example.platform,
        exampleError: info.example.error_message,
      })),
      slotCollisions,
      misalignedCount: misaligned.length,
      misalignedExamples: misaligned.slice(0, 10).map((r) => ({
        id: r.id,
        contentId: r.content_id,
        platform: r.platform,
        videoType: r.video_type,
        scheduledAt: r.scheduled_at,
      })),
      pairViolations,
      wrongLaneRows: wrongLaneRows.map((r) => ({ id: r.id, contentId: r.content_id, scheduledAt: r.scheduled_at })),
      publisherCandidates: publisherCandidates.map((r, index) => ({
        order: index + 1,
        queueId: r.id,
        contentId: r.content_id,
        platform: r.platform,
        videoType: r.video_type,
        status: r.status,
        scheduledAt: r.scheduled_at,
        errorMessage: r.error_message,
        riskFlag:
          slotCollisions.some((c) => c.key.includes(r.platform) && c.contentIds.includes(r.content_id))
            ? "slot_collision"
            : new Date(r.scheduled_at) < now
              ? "overdue"
              : "-",
      })),
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Current Publish Queue Health Audit (read-only)");
    console.log(`- Channel: ${args.channelKey}`);
    console.log(`- Total rows scanned: ${payload.totalRows}`);
    console.log(`- Status counts: ${JSON.stringify(payload.statusCounts)}`);
    console.log(`- Overdue queued: ${payload.overdueQueuedCount}`);
    console.log(`- Stale uploading (>10min): ${payload.staleUploadingCount}`);
    console.log(`- Schedule misalignment: ${payload.misalignedCount}`);
    console.log(`- Slot collisions: ${payload.slotCollisions.length}`);
    console.log(`- Pair violations: ${payload.pairViolations.length}`);
    console.log(`- Wrong-lane rows: ${payload.wrongLaneRows.length}`);

    console.log("\n### Error Classes");
    console.log("| error_class | count | retryable | example_content_id | platform | error |");
    console.log("|---|---:|---|---|---|---|");
    for (const e of payload.errorClasses) {
      console.log(`| ${e.errorClass} | ${e.count} | ${e.retryable} | ${e.exampleContentId} | ${e.examplePlatform} | ${e.exampleError} |`);
    }

    console.log("\n### Slot Collisions");
    console.log("| slot_key | distinct_content_ids |");
    console.log("|---|---:|");
    for (const c of payload.slotCollisions) {
      console.log(`| ${c.key} | ${c.contentIds.length} (${c.contentIds.join(", ")}) |`);
    }

    console.log("\n### Pair Violations");
    console.log("| content_id | issue | detail |");
    console.log("|---|---|---|");
    for (const v of payload.pairViolations) {
      console.log(`| ${v.contentId} | ${v.issue} | ${v.detail} |`);
    }

    console.log("\n### Publisher Next Candidates");
    console.log("| order | queue_id | content_id | platform | video_type | status | scheduled_at | risk_flag |");
    console.log("|---:|---|---|---|---|---|---|---|");
    for (const c of payload.publisherCandidates) {
      console.log(`| ${c.order} | ${c.queueId} | ${c.contentId} | ${c.platform} | ${c.videoType} | ${c.status} | ${c.scheduledAt} | ${c.riskFlag} |`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
