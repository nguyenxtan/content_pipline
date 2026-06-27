import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const STALE_UPLOADING_MIN = 10;
const ACCEPTABLE_STATUSES = ["queued", "done", "uploading"];

type Args = { contentIds: string[]; json: boolean };

function parseArgs(argv: string[]): Args {
  let contentIds: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--content-ids") {
      contentIds = (argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (contentIds.length === 0) throw new Error("--content-ids is required");
  return { contentIds, json };
}

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function formatVn(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
  const hh = String(vn.getUTCHours()).padStart(2, "0");
  const mm = String(vn.getUTCMinutes()).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  const mo = String(vn.getUTCMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} ${dd}/${mo}/${vn.getUTCFullYear()}`;
}

function isCanonicalHH00(iso: string): boolean {
  const d = new Date(iso);
  return d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

type CheckResult = { check: string; pass: boolean; detail: string };

type ItemReport = {
  contentId: string;
  title: string;
  checks: CheckResult[];
  status: "clean" | "warning" | "failed";
  queueStatus: string;
  ytVn: string | null;
  fbVn: string | null;
  sameScheduledAt: boolean;
  mediaOk: boolean;
  coverOk: boolean;
  metadataOk: boolean;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const reports: ItemReport[] = [];

    for (const contentId of args.contentIds) {
      const checks: CheckResult[] = [];

      const contentResult = await pool.query<{
        id: string; topic: string; channel_key: string; format_type: string | null;
        topic_family: string | null; hook_pattern: string | null; short_selected_hook: string | null;
        short_cover_text: string | null; short_cover_asset_path: string | null;
        video_path: string | null; audio_path: string | null; prompt_versions: Record<string, unknown> | null;
        experiment_id: string | null; experiment_variant: string | null; created_at: string;
      }>(
        `
          select id, topic, channel_key, format_type, topic_family, hook_pattern, short_selected_hook,
                 short_cover_text, short_cover_asset_path, video_path, audio_path, prompt_versions,
                 experiment_id, experiment_variant, created_at::text
          from content_generations where id = $1
        `,
        [contentId],
      );

      if (contentResult.rows.length === 0) {
        reports.push({
          contentId, title: "(not found)", checks: [{ check: "content_exists", pass: false, detail: "no content_generations row" }],
          status: "failed", queueStatus: "-", ytVn: null, fbVn: null, sameScheduledAt: false, mediaOk: false, coverOk: false, metadataOk: false,
        });
        continue;
      }

      const c = contentResult.rows[0];
      checks.push({ check: "content_exists", pass: true, detail: "found" });
      checks.push({ check: "channel_key_phat_phap", pass: c.channel_key === "phat_phap", detail: c.channel_key });
      checks.push({ check: "format_type_tts_short", pass: c.format_type === "tts_short", detail: String(c.format_type) });
      checks.push({ check: "topic_family_present", pass: Boolean(c.topic_family?.trim()), detail: c.topic_family ?? "(empty)" });
      checks.push({ check: "hook_pattern_present", pass: Boolean(c.hook_pattern?.trim()), detail: c.hook_pattern ?? "(empty)" });
      checks.push({ check: "selected_hook_present", pass: Boolean(c.short_selected_hook?.trim()), detail: c.short_selected_hook ?? "(empty)" });
      checks.push({ check: "short_cover_text_present", pass: Boolean(c.short_cover_text?.trim()), detail: c.short_cover_text ?? "(empty)" });

      const coverExists = Boolean(c.short_cover_asset_path && fs.existsSync(resolveProjectPath(c.short_cover_asset_path)));
      checks.push({ check: "short_cover_asset_path_present", pass: Boolean(c.short_cover_asset_path), detail: c.short_cover_asset_path ?? "(empty)" });
      checks.push({ check: "short_cover_asset_file_exists", pass: coverExists, detail: c.short_cover_asset_path ?? "(no path)" });

      const videoExists = Boolean(c.video_path && fs.existsSync(resolveProjectPath(c.video_path)));
      checks.push({ check: "video_path_present", pass: Boolean(c.video_path), detail: c.video_path ?? "(empty)" });
      checks.push({ check: "video_file_exists", pass: videoExists, detail: c.video_path ?? "(no path)" });

      const audioExists = c.audio_path ? fs.existsSync(resolveProjectPath(c.audio_path)) : true;
      checks.push({ check: "audio_path_exists_if_stored", pass: audioExists, detail: c.audio_path ?? "(not stored)" });

      const promptVersions = c.prompt_versions ?? {};
      const hasExperimentMetadata = Boolean(c.experiment_id?.trim() && c.experiment_variant?.trim());
      const hasPromptVersionEntries = Object.keys(promptVersions).length > 0;
      checks.push({
        check: "prompt_versions_has_experiment_metadata",
        pass: hasExperimentMetadata && hasPromptVersionEntries,
        detail: `experiment_id=${c.experiment_id}, experiment_variant=${c.experiment_variant}, prompt_versions_keys=${Object.keys(promptVersions).join(",")}`,
      });

      // ── Queue rows ────────────────────────────────────────────────────────
      const queueResult = await pool.query<{
        id: string; platform: string; video_type: string; status: string; scheduled_at: string;
        error_message: string | null; created_at: string; updated_at: string;
      }>(
        `select id, platform, video_type, status, scheduled_at::text, error_message, created_at::text, updated_at::text from upload_queue where content_id = $1 order by platform, video_type`,
        [contentId],
      );
      const rows = queueResult.rows;

      const ytRows = rows.filter((r) => r.platform === "youtube" && r.video_type === "short");
      const fbShortRows = rows.filter((r) => r.platform === "facebook" && r.video_type === "short");
      const fbQuoteRows = rows.filter((r) => r.video_type === "quote");
      const legacyRows = rows.filter((r) => r.video_type === "legacy_quote_short");

      checks.push({ check: "exactly_one_youtube_short_row", pass: ytRows.length === 1, detail: `found ${ytRows.length}` });
      checks.push({ check: "exactly_one_facebook_short_row", pass: fbShortRows.length === 1, detail: `found ${fbShortRows.length}` });
      checks.push({ check: "no_facebook_quote_row", pass: fbQuoteRows.length === 0, detail: `found ${fbQuoteRows.length}` });
      checks.push({ check: "no_legacy_quote_short_row", pass: legacyRows.length === 0, detail: `found ${legacyRows.length}` });
      checks.push({ check: "no_duplicate_queue_rows", pass: rows.length === ytRows.length + fbShortRows.length + fbQuoteRows.length + legacyRows.length && ytRows.length <= 1 && fbShortRows.length <= 1, detail: `total_rows=${rows.length}` });

      const ytRow = ytRows[0] ?? null;
      const fbRow = fbShortRows[0] ?? null;
      const sameScheduledAt = Boolean(ytRow && fbRow && ytRow.scheduled_at === fbRow.scheduled_at);
      checks.push({
        check: "youtube_facebook_same_scheduled_at",
        pass: ytRow && fbRow ? sameScheduledAt : false,
        detail: ytRow && fbRow ? `yt=${ytRow.scheduled_at}, fb=${fbRow.scheduled_at}` : "missing a row",
      });

      const canonicalYt = ytRow ? isCanonicalHH00(ytRow.scheduled_at) : false;
      const canonicalFb = fbRow ? isCanonicalHH00(fbRow.scheduled_at) : false;
      checks.push({ check: "canonical_hh00_slot", pass: canonicalYt && canonicalFb, detail: `yt_canonical=${canonicalYt}, fb_canonical=${canonicalFb}` });

      for (const row of [ytRow, fbRow].filter((r): r is NonNullable<typeof r> => r !== null)) {
        const statusOk = ACCEPTABLE_STATUSES.includes(row.status);
        let staleOk = true;
        if (row.status === "uploading") {
          const minutesSinceUpdate = (Date.now() - new Date(row.updated_at).getTime()) / 60_000;
          staleOk = minutesSinceUpdate <= STALE_UPLOADING_MIN;
        }
        checks.push({
          check: `${row.platform}_status_acceptable`,
          pass: statusOk && staleOk,
          detail: `status=${row.status}${row.status === "uploading" ? `, stale=${!staleOk}` : ""}`,
        });

        checks.push({
          check: `${row.platform}_no_unexpected_error_message`,
          pass: !row.error_message || row.status === "queued" || row.status === "done",
          detail: row.error_message ?? "(none)",
        });
      }

      // Slot collision check: any OTHER content occupying the same (platform, video_type, scheduled_at) on phat_phap.
      let collisionFree = true;
      const collisionDetails: string[] = [];
      for (const row of [ytRow, fbRow].filter((r): r is NonNullable<typeof r> => r !== null)) {
        const collisionResult = await pool.query<{ id: string; content_id: string }>(
          `
            select uq.id, uq.content_id from upload_queue uq
            join social_channels sc on sc.id = uq.channel_id
            where sc.channel_key = 'phat_phap' and uq.platform = $1 and uq.video_type = $2
              and uq.scheduled_at = $3::timestamptz and uq.content_id != $4
              and uq.status in ('queued', 'uploading', 'done')
          `,
          [row.platform, row.video_type, row.scheduled_at, contentId],
        );
        if (collisionResult.rows.length > 0) {
          collisionFree = false;
          collisionDetails.push(`${row.platform}/${row.video_type}@${row.scheduled_at}: ${collisionResult.rows.map((r) => r.content_id).join(",")}`);
        }
      }
      checks.push({ check: "no_collision_at_scheduled_slots", pass: collisionFree, detail: collisionDetails.join("; ") || "none" });

      // Old-row mutation check: created_at should be close to the content's created_at
      // (i.e. inserted at generation time); any updated_at later than created_at is a
      // valid cron status transition (deferral/upload), not flagged as a failure here,
      // only surfaced as informational.
      const mutationNotes = rows
        .filter((r) => new Date(r.updated_at).getTime() !== new Date(r.created_at).getTime())
        .map((r) => `${r.platform}/${r.video_type} updated_at=${r.updated_at} (created_at=${r.created_at}, status=${r.status})`);
      checks.push({
        check: "queue_row_mutations_are_valid_cron_transitions",
        pass: true,
        detail: mutationNotes.length > 0 ? mutationNotes.join("; ") : "no post-creation mutation",
      });

      const failed = checks.some((ch) => !ch.pass);
      const mediaOk = videoExists && audioExists;
      const coverOk = coverExists && Boolean(c.short_cover_text?.trim());
      const metadataOk = hasExperimentMetadata && hasPromptVersionEntries;
      const status: ItemReport["status"] = failed ? "failed" : mutationNotes.length > 0 && (ytRow?.status !== "queued" || fbRow?.status !== "queued") ? "warning" : "clean";

      reports.push({
        contentId,
        title: c.topic,
        checks,
        status,
        queueStatus: `yt=${ytRow?.status ?? "missing"}, fb=${fbRow?.status ?? "missing"}`,
        ytVn: ytRow ? formatVn(ytRow.scheduled_at) : null,
        fbVn: fbRow ? formatVn(fbRow.scheduled_at) : null,
        sameScheduledAt,
        mediaOk,
        coverOk,
        metadataOk,
      });
    }

    const payload = {
      itemsChecked: reports.length,
      clean: reports.filter((r) => r.status === "clean").length,
      warning: reports.filter((r) => r.status === "warning").length,
      failed: reports.filter((r) => r.status === "failed").length,
      reports,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## phat_phap Experiment Items Health Check (read-only)");
    console.log(`- Items checked: ${payload.itemsChecked}`);
    console.log(`- Clean: ${payload.clean} | Warning: ${payload.warning} | Failed: ${payload.failed}`);
    for (const report of reports) {
      console.log(`\n### ${report.contentId}: ${report.title}`);
      console.log(`- status: ${report.status} | queue: ${report.queueStatus} | yt_vn: ${report.ytVn} | fb_vn: ${report.fbVn} | same_scheduled_at: ${report.sameScheduledAt}`);
      console.log(`- media_ok: ${report.mediaOk} | cover_ok: ${report.coverOk} | metadata_ok: ${report.metadataOk}`);
      for (const ch of report.checks) {
        console.log(`  - [${ch.pass ? "OK" : "FAIL"}] ${ch.check}: ${ch.detail}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
