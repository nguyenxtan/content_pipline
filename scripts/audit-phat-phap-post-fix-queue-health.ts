import "dotenv/config";

import pg from "pg";

const { Pool } = pg;
const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
const SCOPE_FORMATS = new Set(["tts_short", "legacy_quote_short"]);
const REQUIRED_PLATFORM_ROWS = ["youtube/short", "facebook/short"] as const;
const ACTIVE_STATUSES = new Set(["queued", "uploading", "pending"]);

type ScopeFormat = "tts_short" | "legacy_quote_short";
type Platform = "youtube" | "facebook";

type Args = {
  since: Date;
  to: Date | null;
  failOnViolation: boolean;
  json: boolean;
};

type QueueRow = {
  content_id: string;
  title: string;
  format_type: ScopeFormat;
  content_created_at: string;
  queue_id: string;
  queue_created_at: string;
  scheduled_at: string;
  platform: Platform;
  video_type: string;
  status: string;
};

type ContentItemReport = {
  contentId: string;
  title: string;
  formatType: ScopeFormat;
  createdAtUtc: string;
  createdAtVn: string | null;
  scheduledAtUtc: string | null;
  scheduledAtVn: string | null;
  queueGroupingKey: string | null;
  actualPlatformRows: string[];
  requiredPlatformRows: string[];
  sameContentGenerationId: true;
  sameScheduledAt: boolean;
  missingYoutube: boolean;
  missingFacebook: boolean;
  wrongLane: boolean;
  outsideVnWindow: boolean;
  cadenceViolation: boolean;
};

function parseArgs(argv: string[]): Args {
  let since: Date | null = null;
  let to: Date | null = null;
  let failOnViolation = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--since") {
      since = new Date(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--to") {
      to = new Date(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--fail-on-violation") {
      failOnViolation = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!since || Number.isNaN(since.getTime())) {
    throw new Error("--since <ISO datetime> is required");
  }
  if (to && Number.isNaN(to.getTime())) {
    throw new Error("Invalid --to datetime");
  }
  if (to && since.getTime() >= to.getTime()) {
    throw new Error("--since must be earlier than --to");
  }

  return { since, to, failOnViolation, json };
}

function formatVn(value: string | Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getVnHourMinute(value: string | Date | null): { hour: number; minute: number } | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VIETNAM_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return { hour, minute };
}

function isInsideVnPublishingWindow(value: string | Date | null): boolean {
  const hm = getVnHourMinute(value);
  if (!hm) return false;
  return hm.hour >= 6 && hm.hour <= 22;
}

function isActiveFutureWrongLane(row: QueueRow, since: Date, to: Date | null): boolean {
  if (row.platform !== "facebook" || row.video_type !== "quote") return false;
  if (!ACTIVE_STATUSES.has(row.status)) return false;
  const scheduledMs = new Date(row.scheduled_at).getTime();
  if (scheduledMs < since.getTime()) return false;
  if (to && scheduledMs >= to.getTime()) return false;
  return true;
}

function normalizeInstant(value: string | Date | null): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function printHumanReport(payload: {
  boundary: { sinceUtc: string; sinceVn: string | null; toUtc: string | null; toVn: string | null };
  summary: Record<string, number>;
  violations: {
    missingYoutube: ContentItemReport[];
    missingFacebook: ContentItemReport[];
    misaligned: ContentItemReport[];
    wrongLane: ContentItemReport[];
    outsideVnWindow: ContentItemReport[];
    cadenceViolations: ContentItemReport[];
  };
}) {
  console.log("## Post-fix Queue Health");
  console.log(`Boundary since: ${payload.boundary.sinceUtc} (${payload.boundary.sinceVn ?? "-"})`);
  if (payload.boundary.toUtc) {
    console.log(`Boundary to: ${payload.boundary.toUtc} (${payload.boundary.toVn ?? "-"})`);
  }
  console.log(`Items scanned: ${payload.summary.itemsScanned}`);
  console.log(`Compliant: ${payload.summary.compliant}`);
  console.log(`Missing YouTube: ${payload.summary.missingYoutube}`);
  console.log(`Missing Facebook: ${payload.summary.missingFacebook}`);
  console.log(`Misaligned: ${payload.summary.misaligned}`);
  console.log(`Wrong lane: ${payload.summary.wrongLane}`);
  console.log(`Outside VN window: ${payload.summary.outsideVnWindow}`);
  console.log(`Cadence violations: ${payload.summary.cadenceViolations}`);
  console.log(`Legacy dirty rows ignored: ${payload.summary.legacyDirtyRowsIgnored}`);

  const sections: Array<[string, ContentItemReport[]]> = [
    ["Missing YouTube", payload.violations.missingYoutube],
    ["Missing Facebook", payload.violations.missingFacebook],
    ["Misaligned", payload.violations.misaligned],
    ["Wrong lane", payload.violations.wrongLane],
    ["Outside VN window", payload.violations.outsideVnWindow],
    ["Cadence violations", payload.violations.cadenceViolations],
  ];

  for (const [label, items] of sections) {
    if (items.length === 0) continue;
    console.log(`\n### ${label}`);
    for (const item of items) {
      console.log([
        `- ${item.formatType}`,
        item.contentId,
        item.scheduledAtUtc ?? "no-slot",
        item.scheduledAtVn ?? "no-vn-slot",
        item.queueGroupingKey ?? "no-group-key",
        item.actualPlatformRows.join(", "),
      ].join(" | "));
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const rowsResult = await pool.query<QueueRow>(`
      with boundary_content as (
        select distinct c.id
        from content_generations c
        left join upload_queue q on q.content_id = c.id
        where c.channel_key = 'phat_phap'
          and c.format_type in ('tts_short', 'legacy_quote_short')
          and (
            c.created_at >= $1::timestamptz
            or (
              (
                q.created_at >= $1::timestamptz
                or q.scheduled_at >= $1::timestamptz
              )
              and (
                $2::timestamptz is null
                or q.created_at < $2::timestamptz
                or q.scheduled_at < $2::timestamptz
              )
            )
          )
      )
      select
        c.id as content_id,
        coalesce(nullif(c.topic, ''), c.id) as title,
        c.format_type,
        c.created_at as content_created_at,
        q.id as queue_id,
        q.created_at as queue_created_at,
        q.scheduled_at,
        q.platform,
        q.video_type,
        q.status
      from boundary_content bc
      join content_generations c on c.id = bc.id
      left join upload_queue q on q.content_id = c.id
        and (
          q.created_at >= $1::timestamptz
          or q.scheduled_at >= $1::timestamptz
        )
        and (
          $2::timestamptz is null
          or q.created_at < $2::timestamptz
          or q.scheduled_at < $2::timestamptz
        )
      order by c.created_at asc, c.id asc, q.scheduled_at asc nulls last, q.platform asc nulls last
    `, [
      args.since.toISOString(),
      args.to ? args.to.toISOString() : null,
    ]);

    const ignoredResult = await pool.query<{ ignored_count: string }>(`
      select count(distinct c.id)::text as ignored_count
      from content_generations c
      left join upload_queue q on q.content_id = c.id
      where c.channel_key = 'phat_phap'
        and c.format_type in ('tts_short', 'legacy_quote_short')
        and c.created_at < $1::timestamptz
        and (
          q.id is null
          or q.scheduled_at < $1::timestamptz
        )
    `, [args.since.toISOString()]);

    const grouped = new Map<string, {
      contentId: string;
      title: string;
      formatType: ScopeFormat;
      createdAtUtc: string;
      rows: QueueRow[];
    }>();

    for (const row of rowsResult.rows) {
      if (!SCOPE_FORMATS.has(row.format_type)) continue;
      const existing = grouped.get(row.content_id) ?? {
        contentId: row.content_id,
        title: row.title,
        formatType: row.format_type,
        createdAtUtc: row.content_created_at,
        rows: [],
      };
      if (row.queue_id) {
        existing.rows.push(row);
      }
      grouped.set(row.content_id, existing);
    }

    const reports: ContentItemReport[] = [];
    for (const item of grouped.values()) {
      const requiredRows = item.rows.filter((row) =>
        row.video_type === "short" &&
        (row.platform === "youtube" || row.platform === "facebook"),
      );
      const youtubeRows = requiredRows.filter((row) => row.platform === "youtube");
      const facebookRows = requiredRows.filter((row) => row.platform === "facebook");
      const scheduledSet = new Set(
        requiredRows
          .map((row) => normalizeInstant(row.scheduled_at))
          .filter((value): value is string => value !== null),
      );
      const canonicalScheduledAt = requiredRows
        .map((row) => normalizeInstant(row.scheduled_at))
        .filter((value): value is string => value !== null)
        .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;
      const wrongLane = item.formatType === "legacy_quote_short"
        ? item.rows.some((row) => isActiveFutureWrongLane(row, args.since, args.to))
        : false;

      reports.push({
        contentId: item.contentId,
        title: item.title,
        formatType: item.formatType,
        createdAtUtc: item.createdAtUtc,
        createdAtVn: formatVn(item.createdAtUtc),
        scheduledAtUtc: canonicalScheduledAt,
        scheduledAtVn: formatVn(canonicalScheduledAt),
        queueGroupingKey: canonicalScheduledAt ? `${item.contentId}|${canonicalScheduledAt}|short` : null,
        actualPlatformRows: item.rows.map((row) => `${row.platform}/${row.video_type}/${row.status}@${row.scheduled_at}`),
        requiredPlatformRows: [...REQUIRED_PLATFORM_ROWS],
        sameContentGenerationId: true,
        sameScheduledAt: scheduledSet.size <= 1,
        missingYoutube: youtubeRows.length === 0,
        missingFacebook: facebookRows.length === 0,
        wrongLane,
        outsideVnWindow: canonicalScheduledAt ? !isInsideVnPublishingWindow(canonicalScheduledAt) : false,
        cadenceViolation: false,
      });
    }

    const cadenceCandidates = reports
      .filter((item) => item.scheduledAtUtc)
      .sort((left, right) => new Date(left.scheduledAtUtc ?? 0).getTime() - new Date(right.scheduledAtUtc ?? 0).getTime());
    for (let index = 1; index < cadenceCandidates.length; index += 1) {
      const previous = cadenceCandidates[index - 1];
      const current = cadenceCandidates[index];
      if (previous.formatType === current.formatType) {
        current.cadenceViolation = true;
      }
    }

    const violations = {
      missingYoutube: reports.filter((item) => item.missingYoutube),
      missingFacebook: reports.filter((item) => item.missingFacebook),
      misaligned: reports.filter((item) => !item.sameScheduledAt),
      wrongLane: reports.filter((item) => item.wrongLane),
      outsideVnWindow: reports.filter((item) => item.outsideVnWindow),
      cadenceViolations: reports.filter((item) => item.cadenceViolation),
    };

    const summary = {
      itemsScanned: reports.length,
      compliant: reports.filter((item) =>
        !item.missingYoutube &&
        !item.missingFacebook &&
        item.sameScheduledAt &&
        !item.wrongLane &&
        !item.outsideVnWindow &&
        !item.cadenceViolation,
      ).length,
      missingYoutube: violations.missingYoutube.length,
      missingFacebook: violations.missingFacebook.length,
      misaligned: violations.misaligned.length,
      wrongLane: violations.wrongLane.length,
      outsideVnWindow: violations.outsideVnWindow.length,
      cadenceViolations: violations.cadenceViolations.length,
      legacyDirtyRowsIgnored: Number(ignoredResult.rows[0]?.ignored_count ?? 0),
    };

    const payload = {
      boundary: {
        sinceUtc: args.since.toISOString(),
        sinceVn: formatVn(args.since),
        toUtc: args.to?.toISOString() ?? null,
        toVn: formatVn(args.to),
      },
      summary,
      items: reports,
      violations,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printHumanReport(payload);
    }

    const hasViolations =
      summary.missingYoutube > 0 ||
      summary.missingFacebook > 0 ||
      summary.misaligned > 0 ||
      summary.wrongLane > 0 ||
      summary.outsideVnWindow > 0 ||
      summary.cadenceViolations > 0;
    if (args.failOnViolation && hasViolations) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
