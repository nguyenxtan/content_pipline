import "dotenv/config";

import pg from "pg";
import { getAutoRefillConfig, runAutoRefillWatcher } from "@/lib/auto-refill-watcher";

const { Pool } = pg;

const VIETNAM_TZ = "Asia/Ho_Chi_Minh";
const SCOPE_FORMATS = new Set(["tts_short", "legacy_quote_short"]);
const ACTIVE_STATUSES = new Set(["queued", "uploading", "pending"]);

type ScopeFormat = "tts_short" | "legacy_quote_short";
type Platform = "youtube" | "facebook";

type Args = {
  from: Date;
  to: Date;
  now: Date;
  json: boolean;
};

type QueueRow = {
  content_id: string;
  title: string;
  format_type: ScopeFormat;
  content_created_at: string;
  queue_id: string | null;
  queue_created_at: string | null;
  scheduled_at: string | null;
  platform: Platform | null;
  video_type: string | null;
  status: string | null;
  channel_id: number | null;
  social_channel_key: string | null;
  error_message: string | null;
};

type ItemReport = {
  contentId: string;
  title: string;
  formatType: ScopeFormat;
  createdAtUtc: string;
  createdAtVn: string | null;
  scheduledAtUtc: string | null;
  scheduledAtVn: string | null;
  queueGroupingKey: string | null;
  shortRows: string[];
  activeShortRows: string[];
  hasYoutubeShort: boolean;
  hasFacebookShort: boolean;
  sameScheduledAt: boolean;
  wrongLane: boolean;
  activeFuture: boolean;
  overdueActive: boolean;
  donePair: boolean;
  diagnosis: string[];
};

type SlotReport = {
  scheduledAtUtc: string;
  scheduledAtVn: string;
  occupied: boolean;
  distinctContentIds: string[];
  formats: ScopeFormat[];
  rows: string[];
  diagnosis: string;
};

function parseArgs(argv: string[]): Args {
  let from: Date | null = null;
  let to: Date | null = null;
  let now: Date | null = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") {
      from = new Date(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--to") {
      to = new Date(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--now") {
      now = new Date(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!from || Number.isNaN(from.getTime())) {
    throw new Error("--from <ISO datetime> is required");
  }
  if (!to || Number.isNaN(to.getTime())) {
    throw new Error("--to <ISO datetime> is required");
  }
  if (from.getTime() >= to.getTime()) {
    throw new Error("--from must be earlier than --to");
  }

  const resolvedNow = now ?? new Date();
  if (Number.isNaN(resolvedNow.getTime())) {
    throw new Error("Invalid --now datetime");
  }

  return { from, to, now: resolvedNow, json };
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

function getVnParts(value: string | Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(value));

  const find = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  return {
    year: find("year"),
    month: find("month"),
    day: find("day"),
    hour: find("hour"),
    minute: find("minute"),
  };
}

function fromVnLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, 0, 0));
}

function toHourlyVnSlots(from: Date, to: Date): Date[] {
  const startParts = getVnParts(from);
  let cursor = fromVnLocal(
    startParts.year,
    startParts.month,
    startParts.day,
    startParts.minute === 0 ? startParts.hour : startParts.hour + 1,
    0,
  );

  if (cursor.getTime() < from.getTime()) {
    cursor = new Date(cursor.getTime() + 60 * 60_000);
  }

  const slots: Date[] = [];
  while (cursor.getTime() < to.getTime()) {
    const vn = getVnParts(cursor);
    if (vn.hour >= 6 && vn.hour <= 22) {
      slots.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + 60 * 60_000);
  }
  return slots;
}

function normalizeInstant(value: string | Date | null): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function isActiveShortRow(row: QueueRow): boolean {
  return Boolean(
    row.platform &&
    row.video_type === "short" &&
    ACTIVE_STATUSES.has(row.status ?? "") &&
    row.scheduled_at,
  );
}

function isWrongLaneRow(row: QueueRow): boolean {
  return Boolean(
    row.platform === "facebook" &&
    row.video_type === "quote" &&
    ACTIVE_STATUSES.has(row.status ?? "") &&
    row.scheduled_at,
  );
}

function describeRow(row: QueueRow): string {
  return [
    row.platform ?? "no-platform",
    row.video_type ?? "no-type",
    row.status ?? "no-status",
    row.scheduled_at ?? "no-slot",
    row.social_channel_key ?? "no-channel",
  ].join("/");
}

function printHuman(payload: {
  window: {
    fromUtc: string;
    fromVn: string | null;
    toUtc: string;
    toVn: string | null;
    nowUtc: string;
    nowVn: string | null;
  };
  autoRefill: Record<string, unknown>;
  summary: Record<string, unknown>;
  nextSafeSmokeTest: Record<string, unknown>;
  slotReports: SlotReport[];
}) {
  console.log("## Queue Drain Plan");
  console.log(`Window from: ${payload.window.fromUtc} (${payload.window.fromVn ?? "-"})`);
  console.log(`Window to: ${payload.window.toUtc} (${payload.window.toVn ?? "-"})`);
  console.log(`Now: ${payload.window.nowUtc} (${payload.window.nowVn ?? "-"})`);
  console.log(`Auto-refill skipped: ${String(payload.autoRefill.skipped)}`);
  console.log(`Auto-refill reason: ${String(payload.autoRefill.reason ?? "-")}`);
  console.log(`Pending before: ${String(payload.autoRefill.pendingBefore ?? "-")}`);
  console.log(`Low watermark: ${String(payload.autoRefill.lowWaterMark ?? "-")}`);
  console.log(`Insert budget: ${String(payload.autoRefill.insertBudget ?? "-")}`);
  console.log(`Planned next format: ${String(payload.autoRefill.plannedNextFormat ?? "-")}`);
  console.log(`Planned next slot UTC: ${String(payload.autoRefill.plannedNextSlotUtc ?? "-")}`);
  console.log(`Planned next slot VN: ${String(payload.autoRefill.plannedNextSlotVn ?? "-")}`);
  console.log(`Items in window: ${String(payload.summary.itemsInWindow)}`);
  console.log(`Active future items: ${String(payload.summary.activeFutureItems)}`);
  console.log(`Complete future pairs: ${String(payload.summary.completeFuturePairs)}`);
  console.log(`Partial future pairs: ${String(payload.summary.partialFuturePairs)}`);
  console.log(`Wrong-lane items: ${String(payload.summary.wrongLaneItems)}`);
  console.log(`Overdue active items: ${String(payload.summary.overdueActiveItems)}`);

  console.log("\n## Slot Occupancy");
  for (const slot of payload.slotReports) {
    console.log(
      [
        `- ${slot.scheduledAtVn}`,
        slot.scheduledAtUtc,
        slot.occupied ? "occupied" : "clean",
        slot.diagnosis,
        slot.rows.join(", ") || "no-active-rows",
      ].join(" | "),
    );
  }

  console.log("\n## Next Safe Smoke Test");
  console.log(`Safe now: ${String(payload.nextSafeSmokeTest.safeNow)}`);
  console.log(`Reason: ${String(payload.nextSafeSmokeTest.reason)}`);
  console.log(`Candidate slot UTC: ${String(payload.nextSafeSmokeTest.slotUtc ?? "-")}`);
  console.log(`Candidate slot VN: ${String(payload.nextSafeSmokeTest.slotVn ?? "-")}`);
  console.log(`Expected format: ${String(payload.nextSafeSmokeTest.expectedFormat ?? "-")}`);
  console.log(`Queue grouping key: ${String(payload.nextSafeSmokeTest.queueGroupingKey ?? "-")}`);
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
            (c.created_at >= $1::timestamptz and c.created_at < $2::timestamptz)
            or (q.created_at >= $1::timestamptz and q.created_at < $2::timestamptz)
            or (q.scheduled_at >= $1::timestamptz and q.scheduled_at < $2::timestamptz)
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
        q.status,
        q.channel_id,
        sc.channel_key as social_channel_key,
        q.error_message
      from boundary_content bc
      join content_generations c on c.id = bc.id
      left join upload_queue q on q.content_id = c.id
      left join social_channels sc on sc.id = q.channel_id
      order by c.created_at asc, c.id asc, q.scheduled_at asc nulls last, q.platform asc nulls last
    `, [
      args.from.toISOString(),
      args.to.toISOString(),
    ]);

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

    const itemReports: ItemReport[] = [];
    for (const item of grouped.values()) {
      const shortRows = item.rows.filter((row) => row.video_type === "short");
      const activeShortRows = shortRows.filter((row) => isActiveShortRow(row));
      const activeFutureRows = activeShortRows.filter(
        (row) => new Date(row.scheduled_at ?? 0).getTime() >= args.now.getTime(),
      );
      const doneShortRows = shortRows.filter((row) => row.status === "done");
      const youtubeShortRows = activeShortRows.filter((row) => row.platform === "youtube");
      const facebookShortRows = activeShortRows.filter((row) => row.platform === "facebook");
      const scheduledSet = new Set(
        activeShortRows
          .map((row) => normalizeInstant(row.scheduled_at))
          .filter((value): value is string => value !== null),
      );
      const canonicalScheduledAt = activeShortRows
        .map((row) => normalizeInstant(row.scheduled_at))
        .filter((value): value is string => value !== null)
        .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0]
        ?? doneShortRows
          .map((row) => normalizeInstant(row.scheduled_at))
          .filter((value): value is string => value !== null)
          .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0]
        ?? null;
      const wrongLane = item.formatType === "legacy_quote_short" && item.rows.some((row) => isWrongLaneRow(row));
      const overdueActive = activeShortRows.some(
        (row) => new Date(row.scheduled_at ?? 0).getTime() < args.now.getTime(),
      );
      const diagnosis: string[] = [];
      if (youtubeShortRows.length === 0) diagnosis.push("missing_youtube_short");
      if (facebookShortRows.length === 0) diagnosis.push("missing_facebook_reel");
      if (scheduledSet.size > 1) diagnosis.push("misaligned_scheduled_at");
      if (wrongLane) diagnosis.push("wrong_lane_facebook_quote");
      if (overdueActive) diagnosis.push("overdue_active");
      if (activeFutureRows.length > 0 && youtubeShortRows.length > 0 && facebookShortRows.length > 0 && scheduledSet.size <= 1) {
        diagnosis.push("complete_future_pair");
      }
      if (activeFutureRows.length === 0 && doneShortRows.length >= 2) {
        diagnosis.push("done_pair_only");
      }

      itemReports.push({
        contentId: item.contentId,
        title: item.title,
        formatType: item.formatType,
        createdAtUtc: item.createdAtUtc,
        createdAtVn: formatVn(item.createdAtUtc),
        scheduledAtUtc: canonicalScheduledAt,
        scheduledAtVn: formatVn(canonicalScheduledAt),
        queueGroupingKey: canonicalScheduledAt ? `${item.contentId}|${canonicalScheduledAt}|short` : null,
        shortRows: shortRows.map((row) => describeRow(row)),
        activeShortRows: activeShortRows.map((row) => describeRow(row)),
        hasYoutubeShort: youtubeShortRows.length > 0,
        hasFacebookShort: facebookShortRows.length > 0,
        sameScheduledAt: scheduledSet.size <= 1,
        wrongLane,
        activeFuture: activeFutureRows.length > 0,
        overdueActive,
        donePair: doneShortRows.filter((row) => row.platform === "youtube").length > 0 &&
          doneShortRows.filter((row) => row.platform === "facebook").length > 0,
        diagnosis,
      });
    }

    const activeRows = rowsResult.rows.filter((row) =>
      isActiveShortRow(row) &&
      row.scheduled_at &&
      new Date(row.scheduled_at).getTime() >= args.from.getTime() &&
      new Date(row.scheduled_at).getTime() < args.to.getTime(),
    );

    const slotReports = toHourlyVnSlots(args.from, args.to).map((slot) => {
      const scheduledAtUtc = slot.toISOString();
      const slotRows = activeRows.filter((row) => normalizeInstant(row.scheduled_at) === scheduledAtUtc);
      const distinctContentIds = [...new Set(slotRows.map((row) => row.content_id))];
      const formats = [...new Set(slotRows.map((row) => row.format_type))] as ScopeFormat[];
      let diagnosis = "clean";
      if (slotRows.length > 0) {
        if (distinctContentIds.length > 1) {
          diagnosis = "content_collision";
        } else {
          const hasYoutube = slotRows.some((row) => row.platform === "youtube");
          const hasFacebook = slotRows.some((row) => row.platform === "facebook");
          diagnosis = hasYoutube && hasFacebook ? "paired_campaign" : hasYoutube ? "missing_facebook_reel" : "missing_youtube_short";
        }
      }
      return {
        scheduledAtUtc,
        scheduledAtVn: formatVn(slot) ?? scheduledAtUtc,
        occupied: slotRows.length > 0,
        distinctContentIds,
        formats,
        rows: slotRows.map((row) => `${row.content_id}/${row.format_type}/${row.platform}/${row.status}`),
        diagnosis,
      } satisfies SlotReport;
    });

    const autoRefill = await runAutoRefillWatcher({
      dryRun: true,
      source: "script",
    });
    const config = getAutoRefillConfig();
    const plannedYoutubeRow = autoRefill.planRows.find((row) => row.destinationId === "youtube_gioi_dinh_tue") ?? null;
    const earliestCleanSlot = slotReports.find((slot) => !slot.occupied && new Date(slot.scheduledAtUtc).getTime() >= args.now.getTime()) ?? null;

    let smokeReason = "no_future_clean_slot_in_window";
    let safeNow = false;
    let smokeSlotUtc: string | null = earliestCleanSlot?.scheduledAtUtc ?? null;
    let smokeSlotVn: string | null = earliestCleanSlot?.scheduledAtVn ?? null;
    const smokeExpectedFormat: string | null = plannedYoutubeRow?.formatType ?? null;
    let smokeGroupingKey: string | null = earliestCleanSlot && plannedYoutubeRow?.formatType
      ? `new-content|${earliestCleanSlot.scheduledAtUtc}|short`
      : null;

    if (!earliestCleanSlot) {
      smokeReason = "no_future_clean_slot_in_window";
    } else if (autoRefill.reason === "pending_above_low_watermark") {
      smokeReason = "blocked_by_global_low_watermark";
    } else if (!plannedYoutubeRow) {
      smokeReason = "auto_refill_has_no_gdt_plan_row";
    } else if (plannedYoutubeRow.formatType !== "legacy_quote_short") {
      smokeReason = "next_expected_content_is_not_quote_video";
    } else if (plannedYoutubeRow.scheduledAtUtc !== earliestCleanSlot.scheduledAtUtc) {
      smokeReason = "clean_slot_exists_but_auto_refill_targets_different_slot";
      smokeSlotUtc = plannedYoutubeRow.scheduledAtUtc;
      smokeSlotVn = plannedYoutubeRow.scheduledAtVn;
      smokeGroupingKey = `new-content|${plannedYoutubeRow.scheduledAtUtc}|short`;
    } else {
      smokeReason = "safe_quote_video_smoke_slot";
      safeNow = true;
    }

    const summary = {
      itemsInWindow: itemReports.length,
      activeFutureItems: itemReports.filter((item) => item.activeFuture).length,
      completeFuturePairs: itemReports.filter((item) => item.diagnosis.includes("complete_future_pair")).length,
      partialFuturePairs: itemReports.filter((item) =>
        item.activeFuture && !item.diagnosis.includes("complete_future_pair"),
      ).length,
      wrongLaneItems: itemReports.filter((item) => item.wrongLane).length,
      overdueActiveItems: itemReports.filter((item) => item.overdueActive).length,
      cleanFutureSlots: slotReports.filter((slot) =>
        !slot.occupied && new Date(slot.scheduledAtUtc).getTime() >= args.now.getTime(),
      ).length,
    };

    const payload = {
      window: {
        fromUtc: args.from.toISOString(),
        fromVn: formatVn(args.from),
        toUtc: args.to.toISOString(),
        toVn: formatVn(args.to),
        nowUtc: args.now.toISOString(),
        nowVn: formatVn(args.now),
      },
      autoRefill: {
        skipped: autoRefill.skipped,
        reason: autoRefill.reason ?? null,
        pendingBefore: autoRefill.pendingBefore,
        lowWaterMark: config.lowWaterMark,
        insertBudget: autoRefill.insertBudget,
        canAutoGenerateQuoteNow:
          autoRefill.reason !== "pending_above_low_watermark" &&
          plannedYoutubeRow?.formatType === "legacy_quote_short" &&
          plannedYoutubeRow?.action === "generate_and_queue",
        plannedNextFormat: plannedYoutubeRow?.formatType ?? null,
        plannedNextSlotUtc: plannedYoutubeRow?.scheduledAtUtc ?? null,
        plannedNextSlotVn: plannedYoutubeRow?.scheduledAtVn ?? null,
      },
      summary,
      itemReports,
      slotReports,
      nextSafeSmokeTest: {
        safeNow,
        reason: smokeReason,
        slotUtc: smokeSlotUtc,
        slotVn: smokeSlotVn,
        expectedFormat: smokeExpectedFormat,
        queueGroupingKey: smokeGroupingKey,
      },
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    printHuman(payload);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
