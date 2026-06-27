import "dotenv/config";

import pg from "pg";

const { Pool } = pg;

type Args = { dryRun: boolean; apply: boolean; json: boolean };

// Explicit operator decisions (content_id prefixes), approved by the operator review in the
// preceding catch-up decision report. Hardcoded intentionally — this script must only ever
// touch these exact, explicitly-approved items, never a broader class.
const ALLOW_LATE_CATCHUP_PREFIXES = ["059b8c0b", "2c27448d", "505ab550", "8aa4c758", "b21708da", "c8759c83"];
const CANCEL_LATE_CATCHUP_PREFIXES = ["123d27f7", "70e93b6a", "cbbc5bcc", "1031daa1", "202f64cc", "809fa109"];
const MISSING_FB_MEDIA_EXISTS_PREFIXES = ["09be2142", "2545789d", "2d585a93", "387c1575", "559df0c8"];
const MISSING_FB_MEDIA_MISSING_PREFIXES = ["2b5457dc", "4c9d817a", "7f1df99a", "a8cc30f0", "d1bfb845", "dca09e09", "e65bf6b5"];
const TERMINAL_SIDECAR_PREFIXES = ["e80db37c", "1e166958", "b7c8f77c"];

const CANCEL_LATE_CATCHUP_NOTE = "operator_cancelled_late_catchup_gt_72h";
const CANCEL_SIDECAR_NOTE = "operator_cancelled_terminal_sidecar_missing_primary";

function parseArgs(argv: string[]): Args {
  let dryRun = true;
  let apply = false;
  let json = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--apply") {
      apply = true;
      dryRun = false;
    } else if (arg === "--json") json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { dryRun, apply, json };
}

async function resolveContentId(pool: pg.Pool, prefix: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `select id from content_generations where id like $1 || '%' and channel_key = 'phat_phap' limit 2`,
    [prefix],
  );
  if (result.rows.length !== 1) return null; // 0 or ambiguous (>1) — do not guess
  return result.rows[0].id;
}

type RowSummary = {
  category: string;
  contentIdPrefix: string;
  contentId: string | null;
  action: "cancel" | "verify_no_mutation";
  matchedRows: Array<{ queueId: string; platform: string; videoType: string; status: string; errorMessage: string | null }>;
  safeToApply: boolean;
  reason: string;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const summaries: RowSummary[] = [];

    // ── Cancel pending late catch-up rows ──────────────────────────────────
    for (const prefix of CANCEL_LATE_CATCHUP_PREFIXES) {
      const contentId = await resolveContentId(pool, prefix);
      if (!contentId) {
        summaries.push({
          category: "cancel_late_catchup",
          contentIdPrefix: prefix,
          contentId: null,
          action: "cancel",
          matchedRows: [],
          safeToApply: false,
          reason: "content_id prefix did not resolve to exactly one row",
        });
        continue;
      }
      const rowsResult = await pool.query<{
        id: string; platform: string; video_type: string; status: string; error_message: string | null;
      }>(
        `select id, platform, video_type, status, error_message from upload_queue where content_id = $1 and video_type = 'short' and status = 'queued'`,
        [contentId],
      );
      const matched = rowsResult.rows.map((r) => ({
        queueId: r.id, platform: r.platform, videoType: r.video_type, status: r.status, errorMessage: r.error_message,
      }));
      const safe = matched.length === 1;
      summaries.push({
        category: "cancel_late_catchup",
        contentIdPrefix: prefix,
        contentId,
        action: "cancel",
        matchedRows: matched,
        safeToApply: safe,
        reason: safe
          ? "exactly one queued short/reel row found — safe to cancel"
          : `expected exactly 1 queued row, found ${matched.length} — skipping (ambiguous or already resolved)`,
      });
    }

    // ── Terminal sidecar errors ─────────────────────────────────────────────
    for (const prefix of TERMINAL_SIDECAR_PREFIXES) {
      const contentId = await resolveContentId(pool, prefix);
      if (!contentId) {
        summaries.push({
          category: "terminal_sidecar_error",
          contentIdPrefix: prefix,
          contentId: null,
          action: "cancel",
          matchedRows: [],
          safeToApply: false,
          reason: "content_id prefix did not resolve to exactly one row",
        });
        continue;
      }
      const rowsResult = await pool.query<{
        id: string; platform: string; video_type: string; status: string; error_message: string | null;
      }>(
        `select id, platform, video_type, status, error_message from upload_queue where content_id = $1 and platform = 'facebook' and video_type = 'quote' and status = 'error'`,
        [contentId],
      );
      const matched = rowsResult.rows
        .filter((r) => (r.error_message ?? "").includes("quote_sidecar_missing_primary_short"))
        .map((r) => ({ queueId: r.id, platform: r.platform, videoType: r.video_type, status: r.status, errorMessage: r.error_message }));
      const safe = matched.length >= 1;
      summaries.push({
        category: "terminal_sidecar_error",
        contentIdPrefix: prefix,
        contentId,
        action: "cancel",
        matchedRows: matched,
        safeToApply: safe,
        reason: safe
          ? `${matched.length} terminal quote_sidecar_missing_primary_short error row(s) found — safe to cancel`
          : "no matching active error row with quote_sidecar_missing_primary_short found — skipping",
      });
    }

    // ── Allow-late-catchup: verify only, never mutate ───────────────────────
    for (const prefix of ALLOW_LATE_CATCHUP_PREFIXES) {
      const contentId = await resolveContentId(pool, prefix);
      const rowsResult = contentId
        ? await pool.query<{ id: string; platform: string; video_type: string; status: string; error_message: string | null }>(
            `select id, platform, video_type, status, error_message from upload_queue where content_id = $1 and video_type = 'short'`,
            [contentId],
          )
        : { rows: [] };
      summaries.push({
        category: "allow_late_catchup_verify_only",
        contentIdPrefix: prefix,
        contentId,
        action: "verify_no_mutation",
        matchedRows: rowsResult.rows.map((r) => ({
          queueId: r.id, platform: r.platform, videoType: r.video_type, status: r.status, errorMessage: r.error_message,
        })),
        safeToApply: false,
        reason: "operator approved letting cron publish normally — no mutation performed by this script",
      });
    }

    // ── Missing Facebook Reel (media exists): verify only ───────────────────
    for (const prefix of MISSING_FB_MEDIA_EXISTS_PREFIXES) {
      const contentId = await resolveContentId(pool, prefix);
      const rowsResult = contentId
        ? await pool.query<{ id: string; platform: string; video_type: string; status: string }>(
            `select id, platform, video_type, status from upload_queue where content_id = $1 and video_type = 'short'`,
            [contentId],
          )
        : { rows: [] };
      const hasFacebookRow = rowsResult.rows.some((r) => r.platform === "facebook");
      summaries.push({
        category: "missing_facebook_reel_media_exists_verify_only",
        contentIdPrefix: prefix,
        contentId,
        action: "verify_no_mutation",
        matchedRows: rowsResult.rows.map((r) => ({ queueId: r.id, platform: r.platform, videoType: r.video_type, status: r.status, errorMessage: null })),
        safeToApply: false,
        reason: hasFacebookRow
          ? "unexpected: a facebook row now exists — re-check before relying on this as unresolved"
          : "accepted as unresolved/manual-later — no row created by this script",
      });
    }

    // ── Missing Facebook Reel (media missing): verify only ──────────────────
    for (const prefix of MISSING_FB_MEDIA_MISSING_PREFIXES) {
      const contentId = await resolveContentId(pool, prefix);
      const rowsResult = contentId
        ? await pool.query<{ id: string; platform: string; video_type: string; status: string }>(
            `select id, platform, video_type, status from upload_queue where content_id = $1 and video_type = 'short'`,
            [contentId],
          )
        : { rows: [] };
      const hasFacebookRow = rowsResult.rows.some((r) => r.platform === "facebook");
      summaries.push({
        category: "missing_facebook_reel_media_missing_verify_only",
        contentIdPrefix: prefix,
        contentId,
        action: "verify_no_mutation",
        matchedRows: rowsResult.rows.map((r) => ({ queueId: r.id, platform: r.platform, videoType: r.video_type, status: r.status, errorMessage: null })),
        safeToApply: false,
        reason: hasFacebookRow
          ? "unexpected: a facebook row now exists — re-check before relying on this as accepted-missing"
          : "accepted as permanently missing — no regeneration, no row created by this script",
      });
    }

    let cancelled = 0;
    let failed = 0;
    if (args.apply) {
      for (const summary of summaries) {
        if (summary.action !== "cancel" || !summary.safeToApply || !summary.contentId) continue;
        const note = summary.category === "cancel_late_catchup" ? CANCEL_LATE_CATCHUP_NOTE : CANCEL_SIDECAR_NOTE;
        for (const row of summary.matchedRows) {
          try {
            const expectedStatus = summary.category === "cancel_late_catchup" ? "queued" : "error";
            const result = await pool.query(
              `update upload_queue set status = 'cancelled', error_message = $1, updated_at = now() where id = $2 and status = $3`,
              [note, row.queueId, expectedStatus],
            );
            if (result.rowCount && result.rowCount > 0) cancelled += 1;
            else failed += 1;
          } catch (err) {
            failed += 1;
            console.error(`Failed to cancel ${row.queueId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    const payload = {
      mode: args.apply ? "apply" : "dry_run",
      summary: {
        cancelLateCatchupMatched: summaries.filter((s) => s.category === "cancel_late_catchup" && s.safeToApply).length,
        cancelLateCatchupSkipped: summaries.filter((s) => s.category === "cancel_late_catchup" && !s.safeToApply).length,
        terminalSidecarMatched: summaries.filter((s) => s.category === "terminal_sidecar_error" && s.safeToApply).length,
        terminalSidecarSkipped: summaries.filter((s) => s.category === "terminal_sidecar_error" && !s.safeToApply).length,
        allowLateVerified: summaries.filter((s) => s.category === "allow_late_catchup_verify_only").length,
        missingFbMediaExistsVerified: summaries.filter((s) => s.category === "missing_facebook_reel_media_exists_verify_only").length,
        missingFbMediaMissingVerified: summaries.filter((s) => s.category === "missing_facebook_reel_media_missing_verify_only").length,
        cancelled,
        failed,
      },
      summaries,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Catch-up Decision Apply");
    console.log(`- Mode: ${payload.mode}`);
    console.log(`- Cancel late-catchup matched/skipped: ${payload.summary.cancelLateCatchupMatched}/${payload.summary.cancelLateCatchupSkipped}`);
    console.log(`- Terminal sidecar matched/skipped: ${payload.summary.terminalSidecarMatched}/${payload.summary.terminalSidecarSkipped}`);
    console.log(`- Allow-late verified (no mutation): ${payload.summary.allowLateVerified}`);
    console.log(`- Missing-FB media-exists verified (no mutation): ${payload.summary.missingFbMediaExistsVerified}`);
    console.log(`- Missing-FB media-missing verified (no mutation): ${payload.summary.missingFbMediaMissingVerified}`);
    if (args.apply) {
      console.log(`- Cancelled: ${cancelled}`);
      console.log(`- Failed: ${failed}`);
    }
    console.log("\n| category | content_id_prefix | content_id | matched_rows | safe_to_apply | reason |");
    console.log("|---|---|---|---|---|---|");
    for (const s of summaries) {
      const rowsLabel = s.matchedRows.map((r) => `${r.platform}/${r.videoType}/${r.status}`).join("; ") || "-";
      console.log(`| ${s.category} | ${s.contentIdPrefix} | ${s.contentId ?? "-"} | ${rowsLabel} | ${s.safeToApply} | ${s.reason} |`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
