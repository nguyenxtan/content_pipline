/**
 * Tầng Sâu performance audit — persistent baseline for Traffic Recovery phase.
 *
 * Outputs:
 *   reports/tang-sau/YYYY-MM-DD.json  — canonical data record, diff-friendly
 *   reports/tang-sau/YYYY-MM-DD.md   — human-readable narrative
 *
 * Safety: read-only. No DB mutations. No uploads. No queue changes.
 *
 * Run with:
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/audit-tang-sau-performance.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { google } from "googleapis";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

// ── Constants ──────────────────────────────────────────────────────────────────

const TANG_SAU_CHANNEL_ID = 10;
const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
const SCHEMA_VERSION = 1;
const REPORTS_DIR = path.join(process.cwd(), "reports", "tang-sau");

// ── Format family mapping ──────────────────────────────────────────────────────
//
// Maps experimentVariant keys → format_family bucket.
// To add a new variant: insert one line here — no other changes needed.
//
// Families:
//   short_quote  — single static image + quote overlay (no voiceover split)
//   split_quote  — chunked / kinetic text or bilingual split-screen quote
//   reflection   — letter/note card or long-form reflection card
//   story        — narrative multi-part video
//   other        — unclassified

const FORMAT_FAMILY_MAP: Record<string, string> = {
  LEGACY_QUOTE_NO_VOICE_V2:          "short_quote",
  LEGACY_QUOTE_KINETIC_TEXT_V1:      "split_quote",
  LEGACY_QUOTE_BILINGUAL_MINIMAL_V1: "split_quote",
  LEGACY_QUOTE_NOTE_LETTER_V1:       "reflection",
  LEGACY_QUOTE_REFLECTION_V1:        "reflection",
  // Future variants — add here:
  // STORY_AUDIO_V1: "story",
};

const FORMAT_LABEL_MAP: Record<string, string> = {
  LEGACY_QUOTE_NO_VOICE_V2:          "short_quote (fallback)",
  LEGACY_QUOTE_KINETIC_TEXT_V1:      "kinetic_text",
  LEGACY_QUOTE_BILINGUAL_MINIMAL_V1: "bilingual_minimal",
  LEGACY_QUOTE_NOTE_LETTER_V1:       "note_letter_card",
  LEGACY_QUOTE_REFLECTION_V1:        "quote_reflection",
};

function resolveFormatFamily(variant: string | undefined): string {
  if (!variant) return "other";
  return FORMAT_FAMILY_MAP[variant] ?? "other";
}

function resolveFormatLabel(variant: string | undefined): string {
  if (!variant) return "—";
  return FORMAT_LABEL_MAP[variant] ?? variant;
}

// ── Types ──────────────────────────────────────────────────────────────────────

type VideoRecord = {
  video_id: string;
  content_id: string;
  title: string | null;
  topic: string | null;
  experiment_variant: string | null;
  format_label: string;
  format_family: string;
  published_at: string | null;
  age_hours: number | null;
  // raw counts
  views: number | null;
  likes: number | null;
  comments: number | null;
  // derived rates
  like_rate: number | null;         // likes / views
  views_per_hour: number | null;
  likes_per_hour: number | null;
  comments_per_hour: number | null;
  // retention (may be unavailable)
  retention_available: boolean;
  average_view_percentage: number | null;
  average_view_duration_sec: number | null;
};

type FamilySummary = {
  video_count: number;
  total_views: number | null;
  avg_views: number | null;
  median_views: number | null;
  avg_views_per_hour: number | null;
  avg_like_rate: number | null;
  avg_retention: number | null;
};

type LeaderboardEntry = {
  video_id: string;
  format_label: string;
  value: number;
};

type QueuedItem = {
  content_id: string;
  experiment_variant: string | null;
  format_label: string;
  format_family: string;
  scheduled_at_vn: string;
  topic: string | null;
};

type Observations = {
  data_observations: string[];
  hypotheses: string[];
  insufficient_data: string[];
};

type Report = {
  schema_version: number;
  generated_at: string;
  report_date: string;
  channel: { id: number; name: string; platform: string };
  analytics: { retention_available: boolean; scope_warning: string | null };
  videos: VideoRecord[];
  format_families: Record<string, FamilySummary>;
  leaderboards: {
    top_views: LeaderboardEntry[];
    top_views_per_hour: LeaderboardEntry[];
    top_retention: LeaderboardEntry[];
    top_like_rate: LeaderboardEntry[];
  };
  queued_batch: QueuedItem[];
  observations: Observations;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtVn(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN", {
    timeZone: VIETNAM_TZ,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

function durFmt(sec: number | null): string {
  if (sec === null) return "—";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function pctFmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(1) + "%";
}

function bar(n: number, max: number, width = 18): string {
  const f = max > 0 ? Math.round((n / max) * width) : 0;
  return "█".repeat(f) + "░".repeat(width - f);
}

function topN(videos: VideoRecord[], field: keyof VideoRecord, n = 5): LeaderboardEntry[] {
  return videos
    .filter((v) => v[field] !== null && typeof v[field] === "number")
    .sort((a, b) => (b[field] as number) - (a[field] as number))
    .slice(0, n)
    .map((v) => ({ video_id: v.video_id, format_label: v.format_label, value: v[field] as number }));
}

// ── Observations generator ─────────────────────────────────────────────────────

function buildObservations(
  videos: VideoRecord[],
  families: Record<string, FamilySummary>,
  retentionAvailable: boolean,
): Observations {
  const obs: string[] = [];
  const hyp: string[] = [];
  const insuf: string[] = [];

  const published = videos.filter((v) => v.views !== null);

  if (published.length === 0) {
    insuf.push("No published videos with view data available yet.");
    return { data_observations: obs, hypotheses: hyp, insufficient_data: insuf };
  }

  // Family distribution
  const familyNames = Object.keys(families);
  if (familyNames.length === 1) {
    obs.push(`All ${published.length} published video(s) belong to format family "${familyNames[0]}". No cross-family comparison is possible yet.`);
  } else {
    obs.push(`${familyNames.length} format families represented across ${published.length} published video(s): ${familyNames.join(", ")}.`);
  }

  // Top performer by raw views
  const byViews = [...published].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  if (byViews[0]) {
    obs.push(`Highest views: ${byViews[0].video_id} (${byViews[0].format_label}) — ${byViews[0].views?.toLocaleString()} views.`);
  }

  // Top performer by views/h
  const withVph = published.filter((v) => v.views_per_hour !== null);
  if (withVph.length > 0) {
    const best = [...withVph].sort((a, b) => (b.views_per_hour ?? 0) - (a.views_per_hour ?? 0))[0]!;
    obs.push(`Highest velocity: ${best.video_id} (${best.format_label}) — ${best.views_per_hour?.toFixed(1)} views/hour.`);
  }

  // Age spread
  const ages = published.map((v) => v.age_hours).filter((a): a is number => a !== null);
  if (ages.length > 0) {
    const minAge = Math.min(...ages).toFixed(1);
    const maxAge = Math.max(...ages).toFixed(1);
    if (Number(maxAge) - Number(minAge) > 2) {
      hyp.push(`Videos range from ${minAge}h to ${maxAge}h old. Raw view counts may reflect age differences rather than format quality — use views_per_hour for comparison.`);
    }
  }

  // Like rate
  const likeRates = published.map((v) => v.like_rate).filter((r): r is number => r !== null);
  if (likeRates.length > 0) {
    const avgLR = (likeRates.reduce((a, b) => a + b, 0) / likeRates.length * 100).toFixed(2);
    obs.push(`Average like/view ratio across all published videos: ${avgLR}%.`);
  }

  // Retention
  if (!retentionAvailable) {
    insuf.push("YouTube Analytics scope (yt-analytics.readonly) is missing. Retention % and average view duration are unavailable for all videos. Re-authorize the channel with analytics scope to unlock these metrics.");
  } else {
    const withRet = published.filter((v) => v.average_view_percentage !== null);
    if (withRet.length === 0) {
      insuf.push("Analytics API connected but no retention data returned. Videos may be too new for YouTube to have computed retention stats.");
    } else {
      obs.push(`Retention data available for ${withRet.length}/${published.length} video(s).`);
    }
  }

  // Format comparison readiness
  if (familyNames.length === 1) {
    insuf.push("Format comparison (kinetic_text vs bilingual_minimal vs note_letter_card vs quote_reflection) is not possible yet — Batch 3 format-mix items are still queued.");
  }

  // Comment engagement
  const withComments = published.filter((v) => v.comments !== null && v.comments > 0);
  if (withComments.length === 0 && published.length > 0) {
    obs.push("No comments recorded on any published video yet.");
  }

  return { data_observations: obs, hypotheses: hyp, insufficient_data: insuf };
}

// ── Markdown report builder ────────────────────────────────────────────────────

function buildMarkdown(r: Report): string {
  const lines: string[] = [];
  const push = (...ss: string[]) => lines.push(...ss);

  push(
    `# Tầng Sâu Performance Report — ${r.report_date}`,
    ``,
    `**Generated:** ${r.generated_at}`,
    `**Channel:** ${r.channel.name} (${r.channel.platform}, channel_id=${r.channel.id})`,
    `**Analytics scope:** ${r.analytics.retention_available ? "available" : "unavailable"}`,
    ``,
  );

  if (r.analytics.scope_warning) {
    push(`> ⚠ **Analytics Warning:** ${r.analytics.scope_warning}`, ``);
  }

  // ── Published videos table ──────────────────────────────────────────────────
  push(`## Published Videos`, ``);

  if (r.videos.length === 0) {
    push("_No published videos found._", ``);
  } else {
    push(
      `| Video ID | Format | Family | Age (h) | Views | V/h | Likes | L/V% | Ret% | AvgDur |`,
      `|----------|--------|--------|--------:|------:|----:|------:|-----:|-----:|-------:|`,
    );
    for (const v of r.videos) {
      push(
        `| [${v.video_id}](https://youtube.com/watch?v=${v.video_id}) ` +
        `| ${v.format_label} ` +
        `| ${v.format_family} ` +
        `| ${v.age_hours?.toFixed(1) ?? "—"} ` +
        `| ${v.views?.toLocaleString() ?? "—"} ` +
        `| ${v.views_per_hour?.toFixed(1) ?? "—"} ` +
        `| ${v.likes?.toLocaleString() ?? "—"} ` +
        `| ${v.like_rate !== null ? (v.like_rate * 100).toFixed(2) + "%" : "—"} ` +
        `| ${pctFmt(v.average_view_percentage)} ` +
        `| ${durFmt(v.average_view_duration_sec)} |`,
      );
    }
    push(``);

    // Per-video detail blocks
    push(`### Details`, ``);
    const maxViews = Math.max(...r.videos.map((v) => v.views ?? 0), 1);
    for (const v of r.videos) {
      push(
        `**${v.video_id}** — ${v.format_label} (\`${v.format_family}\`)`,
        `- Published: ${fmtVn(v.published_at)} VN  |  Age: ${v.age_hours?.toFixed(1) ?? "—"} h`,
        `- Topic: ${v.topic?.slice(0, 80) ?? "—"}`,
        `- Views:    ${(v.views ?? 0).toLocaleString()}  ${bar(v.views ?? 0, maxViews)} (${v.views_per_hour?.toFixed(1) ?? "—"} /h)`,
        `- Likes:    ${v.likes ?? "—"}  ratio=${v.like_rate !== null ? (v.like_rate * 100).toFixed(2) + "%" : "—"}  (${v.likes_per_hour?.toFixed(2) ?? "—"} /h)`,
        `- Comments: ${v.comments ?? "—"}`,
        `- Retention: ${pctFmt(v.average_view_percentage)}  |  Avg duration: ${durFmt(v.average_view_duration_sec)}`,
        ``,
      );
    }
  }

  // ── Leaderboards ────────────────────────────────────────────────────────────
  push(`## Leaderboards`, ``);

  const boards: Array<[string, LeaderboardEntry[], string]> = [
    ["Top Views",       r.leaderboards.top_views,           "views"],
    ["Top Views/Hour",  r.leaderboards.top_views_per_hour,  "v/h"],
    ["Top Retention",   r.leaderboards.top_retention,       "%"],
    ["Top Like Rate",   r.leaderboards.top_like_rate,       "%"],
  ];

  for (const [title, entries, unit] of boards) {
    push(`### ${title}`, ``);
    if (entries.length === 0) {
      push("_No data available._", ``);
    } else {
      push("| Rank | Video ID | Format | Value |", "|------|----------|--------|------:|");
      entries.forEach((e, i) => {
        const valFmt = unit === "%" ? (e.value * 100).toFixed(2) + "%" : e.value.toFixed(unit === "v/h" ? 1 : 0);
        push(`| ${i + 1} | [${e.video_id}](https://youtube.com/watch?v=${e.video_id}) | ${e.format_label} | ${valFmt} |`);
      });
      push(``);
    }
  }

  // ── Format family summary ───────────────────────────────────────────────────
  push(`## Format Family Summary`, ``);
  const familyEntries = Object.entries(r.format_families);
  if (familyEntries.length === 0) {
    push("_No data._", ``);
  } else {
    push(
      `| Family | Count | Total Views | Avg Views | Median Views | Avg V/h | Avg L/V% | Avg Ret% |`,
      `|--------|------:|------------:|----------:|-------------:|--------:|---------:|---------:|`,
    );
    for (const [family, s] of familyEntries) {
      push(
        `| ${family} ` +
        `| ${s.video_count} ` +
        `| ${s.total_views?.toLocaleString() ?? "—"} ` +
        `| ${s.avg_views?.toFixed(0) ?? "—"} ` +
        `| ${s.median_views?.toFixed(0) ?? "—"} ` +
        `| ${s.avg_views_per_hour?.toFixed(1) ?? "—"} ` +
        `| ${s.avg_like_rate !== null ? (s.avg_like_rate * 100).toFixed(2) + "%" : "—"} ` +
        `| ${pctFmt(s.avg_retention)} |`,
      );
    }
    push(``);
  }

  // ── Queued batch ────────────────────────────────────────────────────────────
  push(`## Queued — Not Yet Published`, ``);
  if (r.queued_batch.length === 0) {
    push("_No queued items found. All Batch 3 items may already be published — re-run the audit._", ``);
  } else {
    push(`| Content ID | Format | Family | Scheduled (VN) |`, `|------------|--------|--------|---------------|`);
    for (const q of r.queued_batch) {
      push(`| ${q.content_id} | ${q.format_label} | ${q.format_family} | ${q.scheduled_at_vn} |`);
    }
    push(``, `_${r.queued_batch.length} item(s) queued. Performance data available 24–48 h after each publishes._`, ``);
  }

  // ── Initial observations ────────────────────────────────────────────────────
  push(`## Initial Observations`, ``);

  push(`### Data Observations`, ``);
  if (r.observations.data_observations.length === 0) {
    push("_Insufficient data for observations._");
  } else {
    for (const o of r.observations.data_observations) push(`- ${o}`);
  }
  push(``);

  push(`### Hypotheses`, ``);
  if (r.observations.hypotheses.length === 0) {
    push("_No hypotheses generated._");
  } else {
    for (const h of r.observations.hypotheses) push(`- ${h}`);
  }
  push(``);

  push(`### Insufficient Data`, ``);
  if (r.observations.insufficient_data.length === 0) {
    push("_All required data is available._");
  } else {
    for (const i of r.observations.insufficient_data) push(`- ${i}`);
  }
  push(``);

  // ── Footer ──────────────────────────────────────────────────────────────────
  push(
    `---`,
    ``,
    `_DB mutations: 0 | Uploads: 0 | Queue changes: 0_`,
    `_Schema version: ${r.schema_version}_`,
    `_Compatible with: Hook Tracking, Topic Family Analytics, Cover Asset Analytics (fields extensible via JSON merge)_`,
  );

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const nowIso = new Date().toISOString();
  const reportDate = nowIso.slice(0, 10);

  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  Tầng Sâu Performance Audit — Traffic Recovery Baseline");
  console.log(`  Report date: ${reportDate}`);
  console.log("  Safety: read-only | no mutations | no uploads | no queue changes");
  console.log("══════════════════════════════════════════════════════════════════\n");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // ── 1. Channel OAuth tokens ────────────────────────────────────────────────
    const { rows: channelRows } = await pool.query<{
      id: number;
      name: string;
      platform_channel_id: string | null;
      access_token: string | null;
      refresh_token: string | null;
      token_expires_at: string | null;
      needs_reconnect: boolean;
      oauth_client_id: string | null;
      oauth_client_secret: string | null;
    }>(
      `SELECT
         sc.id, sc.name, sc.platform_channel_id,
         sc.access_token, sc.refresh_token, sc.token_expires_at, sc.needs_reconnect,
         oc.client_id   AS oauth_client_id,
         oc.client_secret AS oauth_client_secret
       FROM social_channels sc
       LEFT JOIN youtube_oauth_clients oc ON sc.oauth_client_config_id = oc.id
       WHERE sc.id = $1`,
      [TANG_SAU_CHANNEL_ID],
    );

    const ch = channelRows[0];
    if (!ch) { console.error(`  ✗ channel_id=${TANG_SAU_CHANNEL_ID} not found`); process.exit(1); }

    console.log(`  Channel:  ${ch.name} (${ch.platform_channel_id ?? "—"})`);
    console.log(`  Token:    ${ch.access_token ? "present" : "MISSING"}  needs_reconnect=${ch.needs_reconnect}`);
    if (!ch.access_token) { console.error("  ✗ No access token. Re-authorize the channel."); process.exit(1); }

    // ── 2. OAuth2 client ───────────────────────────────────────────────────────
    const clientId     = ch.oauth_client_id     ?? process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = ch.oauth_client_secret ?? process.env.YOUTUBE_CLIENT_SECRET;
    const redirectUri  = process.env.YOUTUBE_REDIRECT_URI ?? "http://localhost:3000/api/auth/youtube/callback";

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2.setCredentials({
      access_token:  ch.access_token,
      refresh_token: ch.refresh_token ?? undefined,
      expiry_date:   ch.token_expires_at ? new Date(ch.token_expires_at).getTime() : undefined,
    });

    const expiresAt = ch.token_expires_at ? new Date(ch.token_expires_at).getTime() : null;
    if (expiresAt && (expiresAt - Date.now()) < 5 * 60 * 1000 && ch.refresh_token) {
      console.log("  Refreshing OAuth token…");
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
    }

    const yt = google.youtube({ version: "v3", auth: oauth2 });
    const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth: oauth2 });

    // ── 3. DB queries ──────────────────────────────────────────────────────────
    const { rows: publishedRows } = await pool.query<{
      content_id: string;
      platform_video_id: string;
      uploaded_at: string | null;
      topic: string;
      experiment_variant: string | null;
    }>(
      `SELECT uq.content_id, uq.platform_video_id, uq.uploaded_at,
              cg.topic, cg.experiment_variant
       FROM upload_queue uq
       JOIN content_generations cg ON uq.content_id = cg.id
       WHERE uq.channel_id = $1 AND uq.platform_video_id IS NOT NULL AND uq.status = 'done'
       ORDER BY uq.uploaded_at ASC NULLS LAST`,
      [TANG_SAU_CHANNEL_ID],
    );

    const { rows: queuedRows } = await pool.query<{
      content_id: string;
      scheduled_at: string;
      topic: string;
      experiment_variant: string | null;
    }>(
      `SELECT uq.content_id, uq.scheduled_at, cg.topic, cg.experiment_variant
       FROM upload_queue uq
       JOIN content_generations cg ON uq.content_id = cg.id
       WHERE uq.channel_id = $1 AND uq.status = 'queued'
         AND uq.scheduled_at >= NOW()
       ORDER BY uq.scheduled_at ASC`,
      [TANG_SAU_CHANNEL_ID],
    );

    const videoIds = publishedRows.map((r) => r.platform_video_id);
    console.log(`\n  Published: ${videoIds.length} video(s)  |  Queued: ${queuedRows.length} item(s)`);

    // ── 4. YouTube Data API — live stats ───────────────────────────────────────
    type RawYT = {
      title: string | null; publishedAt: string | null; durationIso: string | null;
      views: number | null; likes: number | null; comments: number | null;
    };
    const ytStats = new Map<string, RawYT>();

    if (videoIds.length > 0) {
      console.log("  Fetching YouTube Data API stats…");
      const res = await yt.videos.list({
        id: videoIds, part: ["snippet", "statistics", "contentDetails"], maxResults: videoIds.length,
      });
      for (const item of res.data.items ?? []) {
        ytStats.set(item.id!, {
          title:       item.snippet?.title ?? null,
          publishedAt: item.snippet?.publishedAt ?? null,
          durationIso: item.contentDetails?.duration ?? null,
          views:    item.statistics?.viewCount    ? Number(item.statistics.viewCount)    : null,
          likes:    item.statistics?.likeCount    ? Number(item.statistics.likeCount)    : null,
          comments: item.statistics?.commentCount ? Number(item.statistics.commentCount) : null,
        });
      }
      console.log(`  YouTube API: ${ytStats.size}/${videoIds.length} video(s) returned`);
    }

    // ── 5. YouTube Analytics API — retention ───────────────────────────────────
    type RawAnalytics = { avgDurationSec: number | null; retentionPct: number | null };
    const analyticsMap = new Map<string, RawAnalytics>();
    let retentionAvailable = false;
    let scopeWarning: string | null = null;

    if (videoIds.length > 0) {
      try {
        const today = reportDate;
        const earliest = publishedRows
          .map((r) => (r.uploaded_at ? new Date(r.uploaded_at).toISOString() : null))
          .filter((d): d is string => d !== null)
          .sort()[0] ?? "2026-06-01T00:00:00Z";
        const startDate = earliest.slice(0, 10);

        console.log("  Fetching YouTube Analytics (retention)…");
        const res = await ytAnalytics.reports.query({
          ids: "channel==MINE",
          startDate,
          endDate: today,
          dimensions: "video",
          metrics: "averageViewDuration,averageViewPercentage",
          filters: `video==${videoIds.join(",")}`,
        });

        const headers = res.data.columnHeaders ?? [];
        const rows    = res.data.rows ?? [];
        const col = (n: string) => headers.findIndex((h) => h.name === n);
        const vidIdx = col("video"), durIdx = col("averageViewDuration"), retIdx = col("averageViewPercentage");

        for (const row of rows) {
          if (!Array.isArray(row) || vidIdx === -1) continue;
          analyticsMap.set(String(row[vidIdx]), {
            avgDurationSec: durIdx !== -1 && typeof row[durIdx] === "number" ? Math.round(row[durIdx] as number) : null,
            retentionPct:   retIdx !== -1 && typeof row[retIdx] === "number" ? row[retIdx] as number : null,
          });
        }
        retentionAvailable = true;
        console.log(`  Analytics: ${analyticsMap.size} row(s) returned`);
      } catch (err) {
        const msg = String(err).toLowerCase();
        if (msg.includes("insufficientpermissions") || msg.includes("403")) {
          scopeWarning = "yt-analytics.readonly scope missing. Re-authorize the channel to enable retention metrics.";
          console.log(`  Analytics: ⚠ scope missing — ${scopeWarning}`);
        } else {
          scopeWarning = `Analytics API error: ${err instanceof Error ? err.message : String(err)}`;
          console.log(`  Analytics: ⚠ ${scopeWarning}`);
        }
      }
    }

    // ── 6. Build VideoRecord list ──────────────────────────────────────────────
    const now = Date.now();

    const videos: VideoRecord[] = publishedRows.map((row) => {
      const yt_     = ytStats.get(row.platform_video_id);
      const an      = analyticsMap.get(row.platform_video_id);
      const variant = row.experiment_variant ?? undefined;

      const publishedAt = yt_?.publishedAt ?? row.uploaded_at ?? null;
      const ageMs       = publishedAt ? now - new Date(publishedAt).getTime() : null;
      const ageHours    = ageMs !== null ? round2(ageMs / 3_600_000) : null;

      const views    = yt_?.views    ?? null;
      const likes    = yt_?.likes    ?? null;
      const comments = yt_?.comments ?? null;

      const likeRate         = views && likes   && views > 0 ? round2(likes / views)           : null;
      const viewsPerHour     = ageHours && views   && ageHours > 0 ? round2(views / ageHours)    : null;
      const likesPerHour     = ageHours && likes   && ageHours > 0 ? round2(likes / ageHours)    : null;
      const commentsPerHour  = ageHours && comments && ageHours > 0 ? round2(comments / ageHours) : null;

      return {
        video_id:           row.platform_video_id,
        content_id:         row.content_id,
        title:              yt_?.title ?? null,
        topic:              row.topic ?? null,
        experiment_variant: variant ?? null,
        format_label:       resolveFormatLabel(variant),
        format_family:      resolveFormatFamily(variant),
        published_at:       publishedAt,
        age_hours:          ageHours,
        views, likes, comments,
        like_rate:          likeRate,
        views_per_hour:     viewsPerHour,
        likes_per_hour:     likesPerHour,
        comments_per_hour:  commentsPerHour,
        retention_available: retentionAvailable,
        average_view_percentage:   an?.retentionPct   ?? null,
        average_view_duration_sec: an?.avgDurationSec ?? null,
      };
    });

    // ── 7. Per-family aggregates ───────────────────────────────────────────────
    const familyGroups: Record<string, VideoRecord[]> = {};
    for (const v of videos) {
      (familyGroups[v.format_family] ??= []).push(v);
    }

    const format_families: Record<string, FamilySummary> = {};
    for (const [family, vids] of Object.entries(familyGroups)) {
      const viewArr  = vids.map((v) => v.views).filter((n): n is number => n !== null);
      const vphArr   = vids.map((v) => v.views_per_hour).filter((n): n is number => n !== null);
      const lrArr    = vids.map((v) => v.like_rate).filter((n): n is number => n !== null);
      const retArr   = vids.map((v) => v.average_view_percentage).filter((n): n is number => n !== null);
      format_families[family] = {
        video_count:         vids.length,
        total_views:         viewArr.length > 0 ? viewArr.reduce((a, b) => a + b, 0) : null,
        avg_views:           round2(avg(viewArr)),
        median_views:        round2(median(viewArr)),
        avg_views_per_hour:  round2(avg(vphArr)),
        avg_like_rate:       round2(avg(lrArr)),
        avg_retention:       round2(avg(retArr)),
      };
    }

    // ── 8. Leaderboards ────────────────────────────────────────────────────────
    const leaderboards = {
      top_views:          topN(videos, "views"),
      top_views_per_hour: topN(videos, "views_per_hour"),
      top_retention:      topN(videos, "average_view_percentage"),
      top_like_rate:      topN(videos, "like_rate"),
    };

    // ── 9. Queued batch ────────────────────────────────────────────────────────
    const queued_batch: QueuedItem[] = queuedRows.map((row) => {
      const variant = row.experiment_variant ?? undefined;
      return {
        content_id:         row.content_id,
        experiment_variant: variant ?? null,
        format_label:       resolveFormatLabel(variant),
        format_family:      resolveFormatFamily(variant),
        scheduled_at_vn:    fmtVn(row.scheduled_at),
        topic:              row.topic ?? null,
      };
    });

    // ── 10. Observations ───────────────────────────────────────────────────────
    const observations = buildObservations(videos, format_families, retentionAvailable);

    // ── 11. Assemble report ────────────────────────────────────────────────────
    const report: Report = {
      schema_version: SCHEMA_VERSION,
      generated_at:   nowIso,
      report_date:    reportDate,
      channel:        { id: TANG_SAU_CHANNEL_ID, name: ch.name, platform: "youtube" },
      analytics:      { retention_available: retentionAvailable, scope_warning: scopeWarning },
      videos,
      format_families,
      leaderboards,
      queued_batch,
      observations,
    };

    // ── 12. Console output ────────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════════════════════════════");
    console.log("  PUBLISHED VIDEOS");
    console.log("══════════════════════════════════════════════════════════════════\n");

    if (videos.length === 0) {
      console.log("  No published videos found.");
    } else {
      const maxViews = Math.max(...videos.map((v) => v.views ?? 0), 1);
      for (const v of videos) {
        const lrStr = v.like_rate !== null ? (v.like_rate * 100).toFixed(2) + "%" : "—";
        console.log(`  ▶ ${v.video_id}  (${v.format_label} / ${v.format_family})`);
        console.log(`    title:     ${v.title?.slice(0, 70) ?? "—"}`);
        console.log(`    published: ${fmtVn(v.published_at)} VN  |  age: ${v.age_hours?.toFixed(1) ?? "—"} h`);
        console.log(`    views:     ${(v.views ?? 0).toLocaleString()}  ${bar(v.views ?? 0, maxViews)}  (${v.views_per_hour?.toFixed(1) ?? "—"} /h)`);
        console.log(`    likes:     ${v.likes ?? "—"}  ratio=${lrStr}  (${v.likes_per_hour?.toFixed(2) ?? "—"} /h)`);
        console.log(`    comments:  ${v.comments ?? "—"}`);
        console.log(`    retention: ${pctFmt(v.average_view_percentage)}  |  avg duration: ${durFmt(v.average_view_duration_sec)}`);
        console.log("");
      }

      console.log("── Summary table ─────────────────────────────────────────────────────");
      console.log(`  ${"ID".padEnd(14)} ${"Format".padEnd(24)} ${"Family".padEnd(12)} ${"Age(h)".padStart(7)} ${"Views".padStart(7)} ${"V/h".padStart(6)} ${"L/V%".padStart(6)} ${"Ret%".padStart(6)}`);
      console.log("  " + "─".repeat(90));
      for (const v of videos) {
        const lrStr = v.like_rate !== null ? (v.like_rate * 100).toFixed(2) : "—";
        console.log(
          `  ${v.video_id.padEnd(14)} ${v.format_label.padEnd(24)} ${v.format_family.padEnd(12)}` +
          ` ${String(v.age_hours?.toFixed(1) ?? "—").padStart(7)} ${String(v.views ?? "—").padStart(7)}` +
          ` ${String(v.views_per_hour?.toFixed(1) ?? "—").padStart(6)} ${lrStr.padStart(6)} ${String(pctFmt(v.average_view_percentage)).padStart(6)}`,
        );
      }
    }

    console.log("\n── Format family summary ─────────────────────────────────────────────");
    for (const [fam, s] of Object.entries(format_families)) {
      const lrStr = s.avg_like_rate !== null ? (s.avg_like_rate * 100).toFixed(2) + "%" : "—";
      console.log(`  ${fam.padEnd(14)}  count=${s.video_count}  avg_views=${s.avg_views ?? "—"}  median=${s.median_views ?? "—"}  avg_v/h=${s.avg_views_per_hour ?? "—"}  avg_l/v=${lrStr}  avg_ret=${pctFmt(s.avg_retention)}`);
    }

    if (queued_batch.length > 0) {
      console.log("\n── Queued batch ──────────────────────────────────────────────────────");
      for (const q of queued_batch) {
        console.log(`  ${q.content_id.padEnd(28)}  ${q.format_label.padEnd(24)}  ${q.scheduled_at_vn}`);
      }
    }

    console.log("\n── Initial observations ──────────────────────────────────────────────");
    for (const o of observations.data_observations)  console.log(`  [obs]   ${o}`);
    for (const h of observations.hypotheses)          console.log(`  [hyp]   ${h}`);
    for (const i of observations.insufficient_data)   console.log(`  [insuf] ${i}`);

    // ── 13. Write reports ──────────────────────────────────────────────────────
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    const jsonPath = path.join(REPORTS_DIR, `${reportDate}.json`);
    const mdPath   = path.join(REPORTS_DIR, `${reportDate}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
    fs.writeFileSync(mdPath,   buildMarkdown(report) + "\n");

    console.log(`\n══════════════════════════════════════════════════════════════════`);
    console.log(`  Reports written:`);
    console.log(`    ${jsonPath}`);
    console.log(`    ${mdPath}`);
    console.log(`  DB mutations: 0 | Uploads: 0 | Queue changes: 0`);
    console.log(`══════════════════════════════════════════════════════════════════`);

  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
