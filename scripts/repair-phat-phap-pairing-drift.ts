import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

type Args = {
  dryRun: boolean;
  apply: boolean;
  from: string | null;
  to: string | null;
  contentId: string | null;
  json: boolean;
};

type ContentRow = {
  id: string;
  topic: string;
  format_type: string | null;
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

type Action =
  | "align_queued_to_queued"
  | "create_missing_facebook_reel"
  | "create_missing_youtube_short"
  | "skip_done_row_immutable"
  | "skip_terminal_error"
  | "skip_manual_review_late_post"
  | "skip_collision_risk"
  | "skip_missing_media"
  | "already_compliant";

type PlanRow = {
  contentId: string;
  title: string;
  formatType: string;
  ytStatus: string | null;
  fbStatus: string | null;
  ytScheduledAtVn: string | null;
  fbScheduledAtVn: string | null;
  issue: string;
  proposedAction: Action;
  safeToApply: boolean;
  reason: string;
  proposedScheduledAtUtc: string | null;
  missingPlatform: string | null;
  mediaExists: boolean | null;
  destinationExists: boolean | null;
  collisionFree: boolean | null;
};

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function parseArgs(argv: string[]): Args {
  let dryRun = true;
  let apply = false;
  let from: string | null = null;
  let to: string | null = null;
  let contentId: string | null = null;
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
    if (arg === "--content-id") {
      contentId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, apply, from, to, contentId, json };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const whereParts = [
      "cg.channel_key = 'phat_phap'",
      "cg.format_type in ('tts_short', 'legacy_quote_short')",
    ];
    const params: Array<string> = [];
    let paramIndex = 1;
    if (args.contentId) {
      whereParts.push(`cg.id = $${paramIndex}`);
      params.push(args.contentId);
      paramIndex += 1;
    }

    // Scope to content items with at least one active video_type='short' row in the window.
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
        where ${whereParts.join(" and ")}
          and uq.video_type = 'short'
          ${windowClause}
      `,
      params,
    );
    const contentIds = contentIdsResult.rows.map((r) => r.id);

    if (contentIds.length === 0) {
      console.log("No phat_phap short/reel content items found in the given window.");
      return;
    }

    const contentResult = await pool.query<ContentRow>(
      `select id, topic, format_type, video_path, video_status from content_generations where id = any($1)`,
      [contentIds],
    );
    const contentById = new Map(contentResult.rows.map((row) => [row.id, row]));

    const platformResult = await pool.query<PlatformRow>(
      `
        select content_id, platform, status, scheduled_at::text, channel_id
        from upload_queue
        where content_id = any($1) and video_type = 'short'
        order by created_at desc
      `,
      [contentIds],
    );
    const platformsByContent = new Map<string, PlatformRow[]>();
    for (const row of platformResult.rows) {
      const list = platformsByContent.get(row.content_id) ?? [];
      list.push(row);
      platformsByContent.set(row.content_id, list);
    }

    // Existing taken slots per (channelId, platform) for collision checks on creates/aligns.
    const takenResult = await pool.query<{ channel_id: number; platform: string; scheduled_at: string }>(
      `
        select uq.channel_id, uq.platform, uq.scheduled_at::text
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        where sc.channel_key = 'phat_phap' and uq.video_type = 'short'
          and uq.status in ('queued', 'uploading', 'done')
      `,
    );
    const takenByLane = new Map<string, Set<string>>();
    for (const row of takenResult.rows) {
      const key = `${row.channel_id}|${row.platform}`;
      const set = takenByLane.get(key) ?? new Set<string>();
      set.add(new Date(row.scheduled_at).toISOString());
      takenByLane.set(key, set);
    }

    const destinationsResult = await pool.query<{ id: number; platform: string }>(
      `select id, platform from social_channels where channel_key = 'phat_phap' and platform in ('youtube','facebook') and is_active = true`,
    );
    const destinationByPlatform = new Map<string, number>();
    for (const row of destinationsResult.rows) {
      if (!destinationByPlatform.has(row.platform)) destinationByPlatform.set(row.platform, row.id);
    }

    const plan: PlanRow[] = [];

    for (const contentId of contentIds) {
      const content = contentById.get(contentId);
      if (!content) continue;
      const rows = platformsByContent.get(contentId) ?? [];
      const yt = rows.find((r) => r.platform === "youtube") ?? null;
      const fb = rows.find((r) => r.platform === "facebook") ?? null;

      const base = {
        contentId,
        title: content.topic,
        formatType: content.format_type ?? "(unknown)",
        ytStatus: yt?.status ?? null,
        fbStatus: fb?.status ?? null,
        ytScheduledAtVn: formatVn(yt?.scheduled_at ?? null),
        fbScheduledAtVn: formatVn(fb?.scheduled_at ?? null),
      };

      if (!fb) {
        // Missing Facebook Reel entirely.
        const targetIso = yt ? new Date(yt.scheduled_at).toISOString() : null;
        const mediaExists = Boolean(content.video_path) && content.video_status === "done" &&
          (content.video_path ? fs.existsSync(resolveProjectPath(content.video_path)) : false);
        const destinationExists = destinationByPlatform.has("facebook");
        const laneKey = `${destinationByPlatform.get("facebook")}|facebook`;
        const collisionFree = targetIso ? !(takenByLane.get(laneKey)?.has(targetIso) ?? false) : false;

        let action: Action = "skip_manual_review_late_post";
        let safe = false;
        let reason = "no youtube counterpart to anchor target slot";
        if (yt && targetIso) {
          if (!mediaExists) {
            action = "skip_missing_media";
            reason = "video file missing or video_status not done";
          } else if (!destinationExists) {
            action = "skip_manual_review_late_post";
            reason = "no active facebook destination for phat_phap";
          } else if (!collisionFree) {
            action = "skip_collision_risk";
            reason = "target slot already occupied by another facebook row";
          } else if (new Date(targetIso).getTime() < Date.now() && yt.status === "done") {
            action = "skip_manual_review_late_post";
            reason = "youtube already done in the past; creating a facebook reel now would be a late catch-up post — operator decision required";
            safe = false;
          } else {
            action = "create_missing_facebook_reel";
            safe = true;
            reason = "media ready, destination active, target slot free";
          }
        }

        plan.push({
          ...base,
          issue: "missing_facebook_reel",
          proposedAction: action,
          safeToApply: safe,
          reason,
          proposedScheduledAtUtc: safe ? targetIso : null,
          missingPlatform: "facebook",
          mediaExists,
          destinationExists,
          collisionFree,
        });
        continue;
      }

      if (!yt) {
        // Missing YouTube Short entirely (mirror logic; none observed in current data, kept for completeness).
        const targetIso = new Date(fb.scheduled_at).toISOString();
        const mediaExists = Boolean(content.video_path) && content.video_status === "done" &&
          (content.video_path ? fs.existsSync(resolveProjectPath(content.video_path)) : false);
        const destinationExists = destinationByPlatform.has("youtube");
        const laneKey = `${destinationByPlatform.get("youtube")}|youtube`;
        const collisionFree = !(takenByLane.get(laneKey)?.has(targetIso) ?? false);

        let action: Action = "skip_manual_review_late_post";
        let safe = false;
        let reason = "missing youtube short row";
        if (!mediaExists) {
          action = "skip_missing_media";
          reason = "video file missing or video_status not done";
        } else if (!destinationExists) {
          reason = "no active youtube destination for phat_phap";
        } else if (!collisionFree) {
          action = "skip_collision_risk";
          reason = "target slot already occupied by another youtube row";
        } else if (new Date(targetIso).getTime() < Date.now() && fb.status === "done") {
          reason = "facebook already done in the past; creating a youtube short now would be a late catch-up post — operator decision required";
        } else {
          action = "create_missing_youtube_short";
          safe = true;
          reason = "media ready, destination active, target slot free";
        }

        plan.push({
          ...base,
          issue: "missing_youtube_short",
          proposedAction: action,
          safeToApply: safe,
          reason,
          proposedScheduledAtUtc: safe ? targetIso : null,
          missingPlatform: "youtube",
          mediaExists,
          destinationExists,
          collisionFree,
        });
        continue;
      }

      // Both rows exist.
      const ytIso = new Date(yt.scheduled_at).toISOString();
      const fbIso = new Date(fb.scheduled_at).toISOString();

      if (ytIso === fbIso) {
        plan.push({
          ...base,
          issue: "none",
          proposedAction: "already_compliant",
          safeToApply: true,
          reason: "same content_generation_id, same scheduled_at, canonical short/reel lane",
          proposedScheduledAtUtc: null,
          missingPlatform: null,
          mediaExists: null,
          destinationExists: null,
          collisionFree: null,
        });
        continue;
      }

      // Mismatch.
      if (yt.status === "done" && fb.status === "done") {
        // Both sides already published — this is historical fact, not an actionable drift.
        // Nothing can or should be done; do not present it as requiring an operator decision.
        plan.push({
          ...base,
          issue: "scheduled_at_mismatch_done_done_historical",
          proposedAction: "skip_done_row_immutable",
          safeToApply: false,
          reason: "both rows already done at different historical timestamps — immutable, not actionable, informational only",
          proposedScheduledAtUtc: null,
          missingPlatform: null,
          mediaExists: null,
          destinationExists: null,
          collisionFree: null,
        });
        continue;
      }

      if (yt.status === "done" && fb.status !== "done") {
        plan.push({
          ...base,
          issue: "scheduled_at_mismatch_done_queued",
          proposedAction: "skip_manual_review_late_post",
          safeToApply: false,
          reason: "youtube already done (immutable); facebook is a pending late catch-up — operator decision required, not auto-aligned to the past youtube timestamp",
          proposedScheduledAtUtc: null,
          missingPlatform: null,
          mediaExists: null,
          destinationExists: null,
          collisionFree: null,
        });
        continue;
      }

      if (fb.status === "done" && yt.status !== "done") {
        plan.push({
          ...base,
          issue: "scheduled_at_mismatch_done_queued",
          proposedAction: "skip_manual_review_late_post",
          safeToApply: false,
          reason: "facebook already done (immutable); youtube is a pending late catch-up — operator decision required, not auto-aligned to the past facebook timestamp",
          proposedScheduledAtUtc: null,
          missingPlatform: null,
          mediaExists: null,
          destinationExists: null,
          collisionFree: null,
        });
        continue;
      }

      if (yt.status === "queued" && fb.status === "queued") {
        // Anchor on YouTube's time; propose moving Facebook to match.
        const laneKey = `${fb.channel_id}|facebook`;
        const collisionFree = !(takenByLane.get(laneKey)?.has(ytIso) ?? false);
        plan.push({
          ...base,
          issue: "scheduled_at_mismatch_queued_queued",
          proposedAction: collisionFree ? "align_queued_to_queued" : "skip_collision_risk",
          safeToApply: collisionFree,
          reason: collisionFree
            ? "both rows queued; aligning facebook to youtube's scheduled_at (target slot free)"
            : "both rows queued but target slot already occupied by another facebook row",
          proposedScheduledAtUtc: collisionFree ? ytIso : null,
          missingPlatform: null,
          mediaExists: null,
          destinationExists: null,
          collisionFree,
        });
        continue;
      }

      // Any other status combination (error/cancelled/uploading mixed with queued/done) —
      // conservative: always manual review, never auto-act.
      plan.push({
        ...base,
        issue: "scheduled_at_mismatch_unusual_status",
        proposedAction: "skip_manual_review_late_post",
        safeToApply: false,
        reason: `unusual status combination (yt=${yt.status}, fb=${fb.status}) — requires manual review`,
        proposedScheduledAtUtc: null,
        missingPlatform: null,
        mediaExists: null,
        destinationExists: null,
        collisionFree: null,
      });
    }

    let applied = 0;
    let failed = 0;
    if (args.apply) {
      for (const item of plan) {
        if (!item.safeToApply) continue;
        try {
          if (item.proposedAction === "align_queued_to_queued") {
            await pool.query(
              `update upload_queue set scheduled_at = $1::timestamptz, updated_at = now() where content_id = $2 and platform = 'facebook' and video_type = 'short' and status = 'queued'`,
              [item.proposedScheduledAtUtc, item.contentId],
            );
            applied += 1;
          } else if (item.proposedAction === "create_missing_facebook_reel" && item.proposedScheduledAtUtc) {
            const channelId = destinationByPlatform.get("facebook");
            if (!channelId) throw new Error("no active facebook destination");
            await pool.query(
              `insert into upload_queue (content_id, channel_id, platform, video_type, title, scheduled_at, status) values ($1, $2, 'facebook', 'short', $3, $4::timestamptz, 'queued')`,
              [item.contentId, channelId, item.title, item.proposedScheduledAtUtc],
            );
            applied += 1;
          } else if (item.proposedAction === "create_missing_youtube_short" && item.proposedScheduledAtUtc) {
            const channelId = destinationByPlatform.get("youtube");
            if (!channelId) throw new Error("no active youtube destination");
            await pool.query(
              `insert into upload_queue (content_id, channel_id, platform, video_type, title, scheduled_at, status) values ($1, $2, 'youtube', 'short', $3, $4::timestamptz, 'queued')`,
              [item.contentId, channelId, item.title, item.proposedScheduledAtUtc],
            );
            applied += 1;
          }
        } catch (err) {
          failed += 1;
          console.error(`Failed to apply for ${item.contentId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    const payload = {
      mode: args.apply ? "apply" : "dry_run",
      summary: {
        scanned: plan.length,
        alreadyCompliant: plan.filter((p) => p.proposedAction === "already_compliant").length,
        missingFacebookReel: plan.filter((p) => p.issue === "missing_facebook_reel").length,
        missingYoutubeShort: plan.filter((p) => p.issue === "missing_youtube_short").length,
        scheduledAtMismatch: plan.filter((p) => p.issue.startsWith("scheduled_at_mismatch")).length,
        safeToApplyCount: plan.filter((p) => p.safeToApply).length,
        historicalInformationalCount: plan.filter((p) => p.proposedAction === "skip_done_row_immutable").length,
        manualReviewCount: plan.filter(
          (p) => !p.safeToApply && p.proposedAction !== "already_compliant" && p.proposedAction !== "skip_done_row_immutable",
        ).length,
        applied,
        failed,
      },
      plan,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## phat_phap Pairing Drift Repair Plan");
    console.log(`- Mode: ${payload.mode}`);
    console.log(`- Content items scanned: ${payload.summary.scanned}`);
    console.log(`- Already compliant: ${payload.summary.alreadyCompliant}`);
    console.log(`- Missing Facebook Reel: ${payload.summary.missingFacebookReel}`);
    console.log(`- Missing YouTube Short: ${payload.summary.missingYoutubeShort}`);
    console.log(`- Scheduled_at mismatch: ${payload.summary.scheduledAtMismatch}`);
    console.log(`- Safe to apply: ${payload.summary.safeToApplyCount}`);
    console.log(`- Manual review required: ${payload.summary.manualReviewCount}`);
    console.log(`- Historical/informational (done+done, not actionable): ${payload.summary.historicalInformationalCount}`);
    if (args.apply) {
      console.log(`- Applied: ${applied}`);
      console.log(`- Failed: ${failed}`);
    }
    console.log("\n| content_id | format_type | yt_status | fb_status | yt_vn | fb_vn | issue | proposed_action | safe_to_apply | reason |");
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    for (const item of plan) {
      console.log(
        `| ${item.contentId} | ${item.formatType} | ${item.ytStatus ?? "-"} | ${item.fbStatus ?? "-"} | ${item.ytScheduledAtVn ?? "-"} | ${item.fbScheduledAtVn ?? "-"} | ${item.issue} | ${item.proposedAction} | ${item.safeToApply} | ${item.reason} |`,
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
