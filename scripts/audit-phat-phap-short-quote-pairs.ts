import "dotenv/config";

import { Client } from "pg";

type QueueRow = {
  id: string;
  content_id: string;
  platform: "youtube" | "facebook";
  video_type: "short" | "quote" | "long";
  status: string;
  scheduled_at: string;
  uploaded_at: string | null;
  created_at: string;
  updated_at: string;
  title: string | null;
  error_message: string | null;
  destination_channel_key: string | null;
  content_channel_key: string | null;
};

type PairAnomaly =
  | {
      kind: "quote_without_primary";
      contentId: string;
      quoteRow: QueueRow;
      relatedShortRows: QueueRow[];
    }
  | {
      kind: "primary_without_quote";
      contentId: string;
      shortRow: QueueRow;
    }
  | {
      kind: "pair_drift";
      contentId: string;
      shortRow: QueueRow;
      quoteRow: QueueRow;
      driftMinutes: number;
    };

const ACTIVE_PAIR_STATUSES = new Set(["queued", "uploading", "done"]);
const FIVE_MINUTES_MS = 5 * 60_000;

function parseArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function printRow(prefix: string, row: QueueRow): void {
  console.log(
    `${prefix}${row.scheduled_at}  ${row.platform}/${row.video_type}  status=${row.status}` +
    `  id=${row.id}  content=${row.content_id}  title=${JSON.stringify(row.title ?? "")}` +
    `${row.error_message ? `  error=${JSON.stringify(row.error_message)}` : ""}`,
  );
}

async function main() {
  const from = parseArg("--from");
  const to = parseArg("--to");
  const repairDryRun = hasFlag("--repair-dry-run");

  if (!from || !to) {
    throw new Error("Usage: ... audit-phat-phap-short-quote-pairs.ts --from <iso> --to <iso> [--repair-dry-run]");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query<QueueRow>(
      `
        select
          uq.id,
          uq.content_id::text,
          uq.platform,
          uq.video_type,
          uq.status,
          uq.scheduled_at::text,
          uq.uploaded_at::text,
          uq.created_at::text,
          uq.updated_at::text,
          uq.title,
          uq.error_message,
          sc.channel_key as destination_channel_key,
          cg.channel_key as content_channel_key
        from upload_queue uq
        join social_channels sc on sc.id = uq.channel_id
        join content_generations cg on cg.id = uq.content_id
        where uq.scheduled_at >= $1::timestamptz
          and uq.scheduled_at < $2::timestamptz
          and (sc.channel_key = 'phat_phap' or cg.channel_key = 'phat_phap')
        order by uq.scheduled_at asc, uq.created_at asc, uq.id asc
      `,
      [from, to],
    );

    const rows = result.rows;
    console.log(`audit-phat-phap-short-quote-pairs`);
    console.log(`  window: ${from} -> ${to}`);
    console.log(`  phat_phap rows: ${rows.length}`);
    console.log("");

    console.log("Timeline");
    for (const row of rows) {
      printRow("  ", row);
    }

    const rowsByContent = new Map<string, QueueRow[]>();
    for (const row of rows) {
      const list = rowsByContent.get(row.content_id) ?? [];
      list.push(row);
      rowsByContent.set(row.content_id, list);
    }

    const anomalies: PairAnomaly[] = [];
    for (const [contentId, contentRows] of rowsByContent) {
      const activeRows = contentRows.filter((row) => ACTIVE_PAIR_STATUSES.has(row.status));
      const shortRows = activeRows.filter((row) => row.video_type === "short");
      const quoteRows = activeRows.filter((row) => row.platform === "facebook" && row.video_type === "quote");

      for (const quoteRow of quoteRows) {
        const quoteTime = new Date(quoteRow.scheduled_at).getTime();
        const alignedPrimaryRows = shortRows.filter((row) =>
          new Date(row.scheduled_at).getTime() === quoteTime - FIVE_MINUTES_MS,
        );
        if (alignedPrimaryRows.length === 0) {
          anomalies.push({
            kind: "quote_without_primary",
            contentId,
            quoteRow,
            relatedShortRows: shortRows,
          });
        } else {
          for (const shortRow of alignedPrimaryRows) {
            const driftMinutes = Math.round(
              (quoteTime - new Date(shortRow.scheduled_at).getTime()) / 60_000,
            );
            if (driftMinutes !== 5) {
              anomalies.push({
                kind: "pair_drift",
                contentId,
                shortRow,
                quoteRow,
                driftMinutes,
              });
            }
          }
        }
      }

      for (const shortRow of shortRows) {
        const shortTime = new Date(shortRow.scheduled_at).getTime();
        const alignedQuote = quoteRows.find((row) =>
          new Date(row.scheduled_at).getTime() === shortTime + FIVE_MINUTES_MS,
        );
        if (!alignedQuote) {
          anomalies.push({
            kind: "primary_without_quote",
            contentId,
            shortRow,
          });
        }
      }

      for (const shortRow of shortRows) {
        for (const quoteRow of quoteRows) {
          const driftMinutes = Math.round(
            (new Date(quoteRow.scheduled_at).getTime() - new Date(shortRow.scheduled_at).getTime()) / 60_000,
          );
          if (driftMinutes !== 5) {
            anomalies.push({
              kind: "pair_drift",
              contentId,
              shortRow,
              quoteRow,
              driftMinutes,
            });
          }
        }
      }
    }

    const deduped = new Map<string, PairAnomaly>();
    for (const anomaly of anomalies) {
      const key = anomaly.kind === "quote_without_primary"
        ? `${anomaly.kind}:${anomaly.quoteRow.id}`
        : anomaly.kind === "primary_without_quote"
          ? `${anomaly.kind}:${anomaly.shortRow.id}`
          : `${anomaly.kind}:${anomaly.shortRow.id}:${anomaly.quoteRow.id}`;
      if (!deduped.has(key)) deduped.set(key, anomaly);
    }

    console.log("");
    console.log("Anomalies");
    if (deduped.size === 0) {
      console.log("  none");
    } else {
      for (const anomaly of deduped.values()) {
        if (anomaly.kind === "quote_without_primary") {
          console.log(`  quote_without_primary content=${anomaly.contentId}`);
          printRow("    quote: ", anomaly.quoteRow);
          if (anomaly.relatedShortRows.length === 0) {
            console.log("    related_shorts: none");
          } else {
            for (const related of anomaly.relatedShortRows) {
              printRow("    related_short: ", related);
            }
          }
        } else if (anomaly.kind === "primary_without_quote") {
          console.log(`  primary_without_quote content=${anomaly.contentId}`);
          printRow("    short: ", anomaly.shortRow);
        } else {
          console.log(`  pair_drift content=${anomaly.contentId} drift=${anomaly.driftMinutes}m`);
          printRow("    short: ", anomaly.shortRow);
          printRow("    quote: ", anomaly.quoteRow);
        }
      }
    }

    if (repairDryRun) {
      console.log("");
      console.log("Repair Dry Run");
      const quoteOnly = [...deduped.values()].filter(
        (anomaly): anomaly is Extract<PairAnomaly, { kind: "quote_without_primary" }> =>
          anomaly.kind === "quote_without_primary",
      );
      if (quoteOnly.length === 0) {
        console.log("  no repair candidates");
      } else {
        for (const anomaly of quoteOnly) {
          const candidatePrimary = anomaly.relatedShortRows
            .filter((row) => row.status === "queued")
            .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
          if (!candidatePrimary) {
            console.log(
              `  content=${anomaly.contentId} quote_row=${anomaly.quoteRow.id} -> manual_review_no_active_primary`,
            );
            continue;
          }

          const nextQuoteAt = new Date(new Date(candidatePrimary.scheduled_at).getTime() + FIVE_MINUTES_MS).toISOString();
          console.log(
            `  UPDATE upload_queue SET scheduled_at='${nextQuoteAt}' WHERE id='${anomaly.quoteRow.id}';` +
            ` -- align quote to primary ${candidatePrimary.id}`,
          );
        }
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
