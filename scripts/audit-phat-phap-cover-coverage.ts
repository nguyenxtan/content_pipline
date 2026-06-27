import "dotenv/config";

import pg from "pg";

const { Pool } = pg;

const SHORT_FORMATS = new Set(["tts_short", "legacy_quote_short"]);

type Args = {
  from: string | null;
  to: string | null;
  limit: number | null;
  json: boolean;
  formatType: "tts_short" | "legacy_quote_short" | null;
};

type Row = {
  id: string;
  topic: string;
  format_type: string | null;
  status: string;
  video_status: string | null;
  topic_family: string | null;
  short_selected_hook: string | null;
  hook_pattern: string | null;
  hook_type: string | null;
  prompt_versions: unknown;
  short_cover_text: string | null;
  short_cover_asset_path: string | null;
  short_cover_generated_at: string | null;
  youtube_video_url: string | null;
  facebook_video_url: string | null;
  created_at: string;
};

function parseArgs(argv: string[]): Args {
  let from: string | null = null;
  let to: string | null = null;
  let limit: number | null = null;
  let json = false;
  let formatType: "tts_short" | "legacy_quote_short" | null = null;

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
    if (arg === "--limit") {
      const parsed = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--limit must be positive");
      limit = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (arg === "--format-type") {
      const value = argv[index + 1] ?? "";
      if (value !== "tts_short" && value !== "legacy_quote_short") {
        throw new Error("--format-type must be tts_short or legacy_quote_short");
      }
      formatType = value;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { from, to, limit, json, formatType };
}

function shorten(value: string | null | undefined, max = 72): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "-";
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getCoverPromptDetails(promptVersions: unknown): Record<string, unknown> | null {
  const root = getObject(promptVersions);
  const cover = getObject(root?.cover);
  return getObject(cover?.details);
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function renderTable(rows: string[][]): string {
  return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const whereParts = [
      "channel_key = 'phat_phap'",
      "format_type in ('tts_short', 'legacy_quote_short')",
    ];
    const params: Array<string | number> = [];
    let paramIndex = 1;

    if (args.from) {
      whereParts.push(`created_at >= $${paramIndex}::timestamptz`);
      params.push(args.from);
      paramIndex += 1;
    }
    if (args.to) {
      whereParts.push(`created_at < $${paramIndex}::timestamptz`);
      params.push(args.to);
      paramIndex += 1;
    }
    if (args.formatType) {
      whereParts.push(`format_type = $${paramIndex}`);
      params.push(args.formatType);
      paramIndex += 1;
    }

    let limitSql = "";
    if (args.limit != null) {
      limitSql = ` limit $${paramIndex}`;
      params.push(args.limit);
    }

    const result = await pool.query<Row>(
      `
        select
          id,
          topic,
          format_type,
          status,
          video_status,
          topic_family,
          short_selected_hook,
          hook_pattern,
          hook_type,
          prompt_versions,
          short_cover_text,
          short_cover_asset_path,
          short_cover_generated_at::text,
          youtube_video_url,
          facebook_video_url,
          created_at::text
        from content_generations
        where ${whereParts.join(" and ")}
        order by created_at desc
        ${limitSql}
      `,
      params,
    );

    const rows = result.rows.filter((row) => SHORT_FORMATS.has(row.format_type ?? ""));

    const byFormat = new Map<string, number>();
    const byFamily = new Map<string, number>();
    const byHook = new Map<string, number>();
    const byPublished = new Map<string, number>();
    const examplesMissingCoverage: Array<{
      contentId: string;
      title: string;
      formatType: string;
      topicFamily: string;
      reason: string;
      hook: string;
    }> = [];

    let withCoverText = 0;
    let withHookTracking = 0;
    let withCoverAsset = 0;
    let coverTextMissingAsset = 0;
    let missingCoverText = 0;
    let missingBoth = 0;
    let metadataBackfillSafe = 0;
    let assetGenerationSupported = 0;

    for (const row of rows) {
      const hasCoverText = Boolean(row.short_cover_text?.trim());
      const hasHookTracking = Boolean(row.short_selected_hook?.trim() || row.hook_pattern || row.hook_type);
      const hasCoverAsset = Boolean(row.short_cover_asset_path);
      const coverDetails = getCoverPromptDetails(row.prompt_versions);
      const publishedState =
        row.youtube_video_url && row.facebook_video_url
          ? "published_pair"
          : row.youtube_video_url || row.facebook_video_url
            ? "partial_publish"
            : "unpublished";

      increment(byFormat, row.format_type ?? "(unknown)");
      increment(byFamily, row.topic_family ?? "(unclassified)");
      increment(byHook, row.hook_pattern ?? row.hook_type ?? "untracked");
      increment(byPublished, publishedState);

      if (hasCoverText) withCoverText += 1;
      if (hasHookTracking) withHookTracking += 1;
      if (hasCoverAsset) withCoverAsset += 1;
      if (hasCoverText && !hasCoverAsset) coverTextMissingAsset += 1;
      if (!hasCoverText) missingCoverText += 1;
      if (!hasCoverText && !hasCoverAsset) missingBoth += 1;

      const safeForMetadata = !hasCoverText && Boolean(row.topic?.trim());
      if (safeForMetadata) metadataBackfillSafe += 1;

      const assetSupported =
        hasCoverAsset ||
        coverDetails?.assetPath != null ||
        row.video_status === "done";
      if (assetSupported) assetGenerationSupported += 1;

      if (!hasCoverText || !hasCoverAsset) {
        const reasons: string[] = [];
        if (!hasCoverText) reasons.push("missing_cover_text");
        if (!hasCoverAsset) reasons.push("missing_cover_asset");
        if (!hasHookTracking) reasons.push("hook_tracking_missing");
        if (examplesMissingCoverage.length < 10) {
          examplesMissingCoverage.push({
            contentId: row.id,
            title: row.topic,
            formatType: row.format_type ?? "(unknown)",
            topicFamily: row.topic_family ?? "(unclassified)",
            reason: reasons.join(", "),
            hook: shorten(row.short_selected_hook ?? row.hook_pattern ?? row.hook_type),
          });
        }
      }
    }

    const payload = {
      window: {
        from: args.from,
        to: args.to,
        limit: args.limit,
        formatType: args.formatType,
      },
      summary: {
        totalShortContentRows: rows.length,
        withCoverText,
        withHookTracking,
        withCoverAsset,
        coverTextButMissingAsset: coverTextMissingAsset,
        missingCoverText,
        missingBothCoverTextAndAsset: missingBoth,
        safeToBackfillMetadataOnly: metadataBackfillSafe > 0,
        assetGenerationSupported: assetGenerationSupported > 0,
      },
      breakdowns: {
        byFormatType: Object.fromEntries(byFormat.entries()),
        byTopicFamily: Object.fromEntries(byFamily.entries()),
        byHookPattern: Object.fromEntries(byHook.entries()),
        byPublishedState: Object.fromEntries(byPublished.entries()),
      },
      examplesMissingCoverage,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Cover Coverage Audit");
    console.log(`- Total rows: ${rows.length}`);
    console.log(`- With coverText: ${withCoverText}`);
    console.log(`- With hook tracking: ${withHookTracking}`);
    console.log(`- With cover asset: ${withCoverAsset}`);
    console.log(`- Missing coverText: ${missingCoverText}`);
    console.log(`- Missing both coverText and asset: ${missingBoth}`);
    console.log(`- Safe to backfill metadata only: ${metadataBackfillSafe > 0 ? "yes" : "no"}`);
    console.log(`- Asset generation supported: ${assetGenerationSupported > 0 ? "yes" : "no"}`);

    console.log("\n### Breakdown by Format");
    console.log(renderTable([
      ["format_type", "count"],
      ["---", "---:"],
      ...Array.from(byFormat.entries()).map(([key, count]) => [key, String(count)]),
    ]));

    console.log("\n### Breakdown by Topic Family");
    console.log(renderTable([
      ["topic_family", "count"],
      ["---", "---:"],
      ...Array.from(byFamily.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12)
        .map(([key, count]) => [key, String(count)]),
    ]));

    console.log("\n### Breakdown by Hook Pattern");
    console.log(renderTable([
      ["hook_pattern", "count"],
      ["---", "---:"],
      ...Array.from(byHook.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12)
        .map(([key, count]) => [key, String(count)]),
    ]));

    console.log("\n### Top Examples Missing Coverage");
    console.log(renderTable([
      ["content_id", "title", "format_type", "topic_family", "hook", "reason"],
      ["---", "---", "---", "---", "---", "---"],
      ...examplesMissingCoverage.map((row) => [
        row.contentId,
        shorten(row.title),
        row.formatType,
        row.topicFamily,
        row.hook,
        row.reason,
      ]),
    ]));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
