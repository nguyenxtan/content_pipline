import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { findNextAvailablePublishSlot } from "@/lib/publishing/slot-occupancy";

const { Pool } = pg;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const CATCHUP_GAP_THRESHOLD_HOURS = 72;

type Args = {
  from: string | null;
  to: string | null;
  json: boolean;
  includeDoneDone: boolean;
  includeSidecarErrors: boolean;
};

type ContentRow = {
  id: string;
  topic: string;
  format_type: string | null;
  topic_family: string | null;
  video_path: string | null;
  video_status: string | null;
};

type PlatformRow = {
  content_id: string;
  platform: string;
  status: string;
  scheduled_at: string;
  channel_id: number;
};

type PublishedRow = { content_id: string; platform: string; published_at: string | null };

function parseArgs(argv: string[]): Args {
  let from: string | null = null;
  let to: string | null = null;
  let json = false;
  let includeDoneDone = false;
  let includeSidecarErrors = false;

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
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--include-done-done") {
      includeDoneDone = true;
      continue;
    }
    if (arg === "--include-sidecar-errors") {
      includeSidecarErrors = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { from, to, json, includeDoneDone, includeSidecarErrors };
}

function formatVn(iso: string | null): string | null {
  if (!iso) return null;
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

function gapHours(aIso: string, bIso: string): number {
  return Math.round(Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / (60 * 60 * 1000) * 10) / 10;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const params: Array<string> = [];
    let paramIndex = 1;
    const windowParts: string[] = [];
    if (args.from) {
      windowParts.push(`uq.scheduled_at >= $${paramIndex}::timestamptz`);
      params.push(args.from);
      paramIndex += 1;
    }
    if (args.to) {
      windowParts.push(`uq.scheduled_at < $${paramIndex}::timestamptz`);
      params.push(args.to);
      paramIndex += 1;
    }
    const windowClause = windowParts.length ? `and ${windowParts.join(" and ")}` : "";

    const contentIdsResult = await pool.query<{ id: string }>(
      `
        select distinct cg.id
        from content_generations cg
        join upload_queue uq on uq.content_id = cg.id
        where cg.channel_key = 'phat_phap'
          and cg.format_type in ('tts_short', 'legacy_quote_short')
          and uq.video_type = 'short'
          ${windowClause}
      `,
      params,
    );
    const contentIds = contentIdsResult.rows.map((r) => r.id);

    const contentResult = contentIds.length
      ? await pool.query<ContentRow>(
          `select id, topic, format_type, topic_family, video_path, video_status from content_generations where id = any($1)`,
          [contentIds],
        )
      : { rows: [] as ContentRow[] };
    const contentById = new Map(contentResult.rows.map((row) => [row.id, row]));

    const platformResult = contentIds.length
      ? await pool.query<PlatformRow>(
          `select content_id, platform, status, scheduled_at::text, channel_id from upload_queue where content_id = any($1) and video_type = 'short' order by created_at desc`,
          [contentIds],
        )
      : { rows: [] as PlatformRow[] };
    const platformsByContent = new Map<string, PlatformRow[]>();
    for (const row of platformResult.rows) {
      const list = platformsByContent.get(row.content_id) ?? [];
      list.push(row);
      platformsByContent.set(row.content_id, list);
    }

    const publishedResult = contentIds.length
      ? await pool.query<PublishedRow>(
          `select content_id, platform, published_at::text from published_videos where content_id = any($1)`,
          [contentIds],
        )
      : { rows: [] as PublishedRow[] };
    const publishedByContentPlatform = new Map<string, string | null>();
    for (const row of publishedResult.rows) {
      publishedByContentPlatform.set(`${row.content_id}|${row.platform}`, row.published_at);
    }

    const takenFacebookResult = await pool.query<{ scheduled_at: string; channel_id: number }>(
      `
        select uq.scheduled_at::text, uq.channel_id
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        where sc.channel_key = 'phat_phap' and uq.platform = 'facebook' and uq.video_type = 'short'
          and uq.status in ('queued', 'uploading', 'done')
      `,
    );
    const takenFacebookTimes = new Set(takenFacebookResult.rows.map((r) => new Date(r.scheduled_at).toISOString()));
    const facebookChannelId = takenFacebookResult.rows[0]?.channel_id ?? null;

    type CaseRow = Record<string, unknown> & { caseType: string };
    const cases: CaseRow[] = [];

    for (const contentId of contentIds) {
      const content = contentById.get(contentId);
      if (!content) continue;
      const rows = platformsByContent.get(contentId) ?? [];
      const yt = rows.find((r) => r.platform === "youtube") ?? null;
      const fb = rows.find((r) => r.platform === "facebook") ?? null;
      const ytPublishedAt = publishedByContentPlatform.get(`${contentId}|youtube`) ?? null;
      const fbPublishedAt = publishedByContentPlatform.get(`${contentId}|facebook`) ?? null;

      const base = {
        contentId,
        title: content.topic,
        formatType: content.format_type ?? "(unknown)",
        topicFamily: content.topic_family ?? "(unclassified)",
        ytStatus: yt?.status ?? null,
        fbStatus: fb?.status ?? null,
        ytScheduledAtVn: formatVn(yt?.scheduled_at ?? null),
        fbScheduledAtVn: formatVn(fb?.scheduled_at ?? null),
        ytPublishedAtVn: formatVn(ytPublishedAt),
        fbPublishedAtVn: formatVn(fbPublishedAt),
      };

      if (yt && fb) {
        const ytIso = new Date(yt.scheduled_at).toISOString();
        const fbIso = new Date(fb.scheduled_at).toISOString();
        if (ytIso === fbIso) continue; // already compliant, not a decision case

        if (yt.status === "done" && fb.status === "done") {
          if (!args.includeDoneDone) continue;
          const ytTime = ytPublishedAt ?? yt.scheduled_at;
          const fbTime = fbPublishedAt ?? fb.scheduled_at;
          cases.push({
            caseType: "done_done_historical",
            ...base,
            gapHours: gapHours(ytTime, fbTime),
            recommendation: "ignore_historical",
            operatorChoices: ["ignore_historical"],
          });
          continue;
        }

        if (yt.status === "done" && fb.status === "queued") {
          const ytTime = ytPublishedAt ?? yt.scheduled_at;
          const fbTime = fb.scheduled_at;
          const gap = gapHours(ytTime, fbTime);
          cases.push({
            caseType: "youtube_done_facebook_queued",
            ...base,
            gapHours: gap,
            recommendation: gap <= CATCHUP_GAP_THRESHOLD_HOURS ? "allow_late_catchup" : "manual_review_cancel_or_reschedule",
            operatorChoices: ["allow_late_catchup", "cancel_pending_row", "choose_new_alternate_slot"],
          });
          continue;
        }

        if (fb.status === "done" && yt.status === "queued") {
          const fbTime = fbPublishedAt ?? fb.scheduled_at;
          const ytTime = yt.scheduled_at;
          const gap = gapHours(fbTime, ytTime);
          cases.push({
            caseType: "facebook_done_youtube_queued",
            ...base,
            gapHours: gap,
            recommendation: gap <= CATCHUP_GAP_THRESHOLD_HOURS ? "allow_late_catchup" : "manual_review_cancel_or_reschedule",
            operatorChoices: ["allow_late_catchup", "cancel_pending_row", "choose_new_alternate_slot"],
          });
          continue;
        }
        // Other queued/queued or error mismatches without a done side are out of this
        // report's decision scope (handled by the pairing-drift repair planner).
        continue;
      }

      if (yt && !fb) {
        const mediaExists = Boolean(content.video_path) && content.video_status === "done" &&
          (content.video_path ? fs.existsSync(resolveProjectPath(content.video_path)) : false);
        const naturalSlotIso = new Date(yt.scheduled_at).toISOString();
        const naturalCollision = takenFacebookTimes.has(naturalSlotIso);

        let alternateSlotVn: string | null = null;
        if (mediaExists && naturalCollision && facebookChannelId != null) {
          const alt = findNextAvailablePublishSlot({
            windowStart: "06:00",
            windowEnd: "22:00",
            intervalMin: 60,
            taken: [...takenFacebookTimes].map((t) => new Date(t).getTime()),
            notBefore: new Date(yt.scheduled_at),
            slotOffsetMinutes: 0,
          });
          alternateSlotVn = alt ? formatVn(alt.toISOString()) : null;
        }

        cases.push({
          caseType: mediaExists ? "missing_facebook_reel_media_exists" : "missing_facebook_reel_media_missing",
          ...base,
          mediaExists,
          naturalSlotVn: formatVn(yt.scheduled_at),
          naturalSlotCollision: naturalCollision,
          suggestedAlternateSlotVn: alternateSlotVn,
          recommendation: mediaExists ? "manual_pick_new_slot" : "accept_missing_or_regenerate",
          operatorChoices: mediaExists
            ? ["choose_new_alternate_slot", "permanently_accept_missing"]
            : ["permanently_accept_missing", "regenerate_then_recreate_row"],
        });
        continue;
      }

      if (fb && !yt) {
        const mediaExists = Boolean(content.video_path) && content.video_status === "done" &&
          (content.video_path ? fs.existsSync(resolveProjectPath(content.video_path)) : false);
        cases.push({
          caseType: mediaExists ? "missing_youtube_short_media_exists" : "missing_youtube_short_media_missing",
          ...base,
          mediaExists,
          naturalSlotVn: formatVn(fb.scheduled_at),
          naturalSlotCollision: null,
          suggestedAlternateSlotVn: null,
          recommendation: mediaExists ? "manual_pick_new_slot" : "accept_missing_or_regenerate",
          operatorChoices: mediaExists
            ? ["choose_new_alternate_slot", "permanently_accept_missing"]
            : ["permanently_accept_missing", "regenerate_then_recreate_row"],
        });
      }
    }

    if (args.includeSidecarErrors) {
      const sidecarResult = await pool.query<{ content_id: string; error_message: string | null; topic: string | null }>(
        `
          select uq.content_id, uq.error_message, cg.topic
          from upload_queue uq
          join social_channels sc on sc.id = uq.channel_id
          left join content_generations cg on cg.id = uq.content_id
          where sc.channel_key = 'phat_phap' and uq.platform = 'facebook' and uq.video_type = 'quote'
            and uq.status = 'error'
        `,
      );
      for (const row of sidecarResult.rows) {
        cases.push({
          caseType: "terminal_sidecar_error",
          contentId: row.content_id,
          title: row.topic ?? "(unknown)",
          errorMessage: row.error_message,
          retryable: false,
          recommendation: "cancel_or_ignore_sidecar_error",
          operatorChoices: ["cancel_pending_row", "ignore_historical"],
        });
      }
    }

    const summary = {
      casesScanned: cases.length,
      youtubeDoneFacebookQueued: cases.filter((c) => c.caseType === "youtube_done_facebook_queued").length,
      facebookDoneYoutubeQueued: cases.filter((c) => c.caseType === "facebook_done_youtube_queued").length,
      missingFacebookReelMediaExists: cases.filter((c) => c.caseType === "missing_facebook_reel_media_exists").length,
      missingFacebookReelMediaMissing: cases.filter((c) => c.caseType === "missing_facebook_reel_media_missing").length,
      doneDoneHistorical: cases.filter((c) => c.caseType === "done_done_historical").length,
      terminalSidecarErrors: cases.filter((c) => c.caseType === "terminal_sidecar_error").length,
    };

    const payload = { meta: { from: args.from, to: args.to }, summary, cases };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Catch-up Decision Report (read-only, no DB writes)");
    console.log(`- Date range: ${args.from ?? "(none)"} to ${args.to ?? "(none)"}`);
    console.log(`- Cases scanned: ${summary.casesScanned}`);
    console.log(`- YouTube done + Facebook queued: ${summary.youtubeDoneFacebookQueued}`);
    console.log(`- Facebook done + YouTube queued: ${summary.facebookDoneYoutubeQueued}`);
    console.log(`- Missing Facebook Reel, media exists: ${summary.missingFacebookReelMediaExists}`);
    console.log(`- Missing Facebook Reel, media missing: ${summary.missingFacebookReelMediaMissing}`);
    console.log(`- Done/done historical mismatch: ${summary.doneDoneHistorical}`);
    console.log(`- Terminal sidecar errors: ${summary.terminalSidecarErrors}`);

    console.log("\n### Late Catch-up Decisions");
    console.log("| content_id | title | yt_status | fb_status | yt_time_vn | fb_time_vn | gap_hours | recommendation | operator_choices |");
    console.log("|---|---|---|---|---|---|---:|---|---|");
    for (const c of cases.filter((c) => c.caseType === "youtube_done_facebook_queued" || c.caseType === "facebook_done_youtube_queued")) {
      console.log(
        `| ${c.contentId} | ${c.title} | ${c.ytStatus} | ${c.fbStatus} | ${c.ytScheduledAtVn ?? c.ytPublishedAtVn ?? "-"} | ${c.fbScheduledAtVn ?? c.fbPublishedAtVn ?? "-"} | ${c.gapHours} | ${c.recommendation} | ${(c.operatorChoices as string[]).join(", ")} |`,
      );
    }

    console.log("\n### Missing Facebook Reel Decisions");
    console.log("| content_id | title | media_exists | natural_slot_vn | natural_slot_collision | suggested_alternate_slot_vn | recommendation |");
    console.log("|---|---|---|---|---|---|---|");
    for (const c of cases.filter((c) => c.caseType.startsWith("missing_facebook_reel") || c.caseType.startsWith("missing_youtube_short"))) {
      console.log(
        `| ${c.contentId} | ${c.title} | ${c.mediaExists} | ${c.naturalSlotVn} | ${c.naturalSlotCollision} | ${c.suggestedAlternateSlotVn ?? "-"} | ${c.recommendation} |`,
      );
    }

    console.log("\n### Historical / Ignore");
    console.log("| content_id | issue | reason | recommendation |");
    console.log("|---|---|---|---|");
    for (const c of cases.filter((c) => c.caseType === "done_done_historical")) {
      console.log(`| ${c.contentId} | done_done_mismatch | both platforms already published, ${c.gapHours}h apart | ${c.recommendation} |`);
    }

    console.log("\n### Terminal Sidecar Errors");
    console.log("| content_id | error | retryable | recommendation |");
    console.log("|---|---|---|---|");
    for (const c of cases.filter((c) => c.caseType === "terminal_sidecar_error")) {
      console.log(`| ${c.contentId} | ${c.errorMessage} | ${c.retryable} | ${c.recommendation} |`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
