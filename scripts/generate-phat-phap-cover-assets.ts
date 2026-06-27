import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  generateShortCoverAsset,
  resolveShortCoverSourceImage,
} from "@/lib/image/short-cover-asset-generator";
import { createPromptVersionEntry, mergePromptVersions } from "@/lib/prompt-version-registry";

const { Pool } = pg;

const RENDERER = "sharp_svg_overlay_v1";
const LAYOUT_PRESET = "short_cover_hook";
const ASSET_GENERATION_SOURCE = "standalone_asset_backfill_v1";

type Args = {
  dryRun: boolean;
  apply: boolean;
  from: string | null;
  to: string | null;
  limit: number | null;
  contentId: string | null;
  formatType: "tts_short" | "legacy_quote_short" | null;
  json: boolean;
  reuseExistingFile: boolean;
};

type Row = {
  id: string;
  topic: string;
  channel_key: string;
  format_type: string | null;
  topic_family: string | null;
  short_selected_hook: string | null;
  short_content: string | null;
  script: string | null;
  image_paths: string[] | null;
  short_cover_text: string | null;
  short_cover_asset_path: string | null;
  prompt_versions: unknown;
};

type PlanRow = {
  contentId: string;
  title: string;
  formatType: string;
  topicFamily: string;
  coverText: string;
  outputPath: string;
  renderer: string;
  sourceImageMode: string | null;
  sourceImagePath: string | null;
  eligible: boolean;
  skippedReason: string | null;
};

function parseArgs(argv: string[]): Args {
  let dryRun = true;
  let apply = false;
  let from: string | null = null;
  let to: string | null = null;
  let limit: number | null = null;
  let contentId: string | null = null;
  let formatType: "tts_short" | "legacy_quote_short" | null = null;
  let json = false;
  let reuseExistingFile = false;

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
    if (arg === "--limit") {
      const parsed = Number(argv[index + 1] ?? "");
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--limit must be positive");
      limit = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (arg === "--content-id") {
      contentId = argv[index + 1] ?? null;
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
    if (arg === "--reuse-existing-file") {
      reuseExistingFile = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, apply, from, to, limit, contentId, formatType, json, reuseExistingFile };
}

function shorten(value: string | null | undefined, max = 60): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "-";
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
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
      "channel_key = 'phat_phap'",
      "format_type in ('tts_short', 'legacy_quote_short')",
      "short_cover_text is not null",
      "btrim(short_cover_text) <> ''",
      "short_cover_asset_path is null",
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
    if (args.contentId) {
      whereParts.push(`id = $${paramIndex}`);
      params.push(args.contentId);
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
          channel_key,
          format_type,
          topic_family,
          short_selected_hook,
          short_content,
          script,
          image_paths,
          short_cover_text,
          short_cover_asset_path,
          prompt_versions
        from content_generations
        where ${whereParts.join(" and ")}
        order by created_at desc
        ${limitSql}
      `,
      params,
    );

    const plans: PlanRow[] = [];
    let eligible = 0;
    let skippedMissingCoverText = 0;
    let skippedExistingAsset = 0;
    let skippedUnsafe = 0;

    for (const row of result.rows) {
      const coverText = row.short_cover_text?.trim() ?? "";
      const outputPath = `media/covers/${row.id}-short-cover.jpg`;
      const absOutputPath = resolveProjectPath(outputPath);

      if (!coverText) {
        skippedMissingCoverText += 1;
        plans.push({
          contentId: row.id,
          title: row.topic,
          formatType: row.format_type ?? "(unknown)",
          topicFamily: row.topic_family ?? "(unclassified)",
          coverText: "-",
          outputPath,
          renderer: RENDERER,
          sourceImageMode: null,
          sourceImagePath: null,
          eligible: false,
          skippedReason: "missing_cover_text",
        });
        continue;
      }

      if (row.short_cover_asset_path) {
        skippedExistingAsset += 1;
        plans.push({
          contentId: row.id,
          title: row.topic,
          formatType: row.format_type ?? "(unknown)",
          topicFamily: row.topic_family ?? "(unclassified)",
          coverText,
          outputPath,
          renderer: RENDERER,
          sourceImageMode: null,
          sourceImagePath: null,
          eligible: false,
          skippedReason: "db_asset_path_already_present",
        });
        continue;
      }

      const fileAlreadyOnDisk = fs.existsSync(absOutputPath);
      if (fileAlreadyOnDisk && !args.reuseExistingFile) {
        skippedExistingAsset += 1;
        plans.push({
          contentId: row.id,
          title: row.topic,
          formatType: row.format_type ?? "(unknown)",
          topicFamily: row.topic_family ?? "(unclassified)",
          coverText,
          outputPath,
          renderer: RENDERER,
          sourceImageMode: null,
          sourceImagePath: null,
          eligible: false,
          skippedReason: "output_file_exists_on_disk_without_db_path_use_--reuse-existing-file",
        });
        continue;
      }

      const source = resolveShortCoverSourceImage({
        contentId: row.id,
        sourceImagePath: row.image_paths?.[0] ?? null,
      });
      if (!source.ok) {
        skippedUnsafe += 1;
        plans.push({
          contentId: row.id,
          title: row.topic,
          formatType: row.format_type ?? "(unknown)",
          topicFamily: row.topic_family ?? "(unclassified)",
          coverText,
          outputPath,
          renderer: RENDERER,
          sourceImageMode: null,
          sourceImagePath: null,
          eligible: false,
          skippedReason: "missing_source_image_for_short_cover",
        });
        continue;
      }

      eligible += 1;
      plans.push({
        contentId: row.id,
        title: row.topic,
        formatType: row.format_type ?? "(unknown)",
        topicFamily: row.topic_family ?? "(unclassified)",
        coverText,
        outputPath,
        renderer: RENDERER,
        sourceImageMode: source.sourceImageMode,
        sourceImagePath: source.sourceImagePath,
        eligible: true,
        skippedReason: fileAlreadyOnDisk ? "reused_existing_file_on_disk" : null,
      });
    }

    let applied = 0;
    let failed = 0;
    const applyErrors: Array<{ contentId: string; error: string }> = [];

    if (args.apply) {
      for (const plan of plans) {
        if (!plan.eligible) continue;
        const row = result.rows.find((item) => item.id === plan.contentId);
        if (!row) continue;

        const freshCheck = await pool.query<{ short_cover_asset_path: string | null }>(
          "select short_cover_asset_path from content_generations where id = $1",
          [row.id],
        );
        if (freshCheck.rows[0]?.short_cover_asset_path) {
          // Row changed since preview; fail closed and never overwrite.
          continue;
        }

        try {
          const absOutputPath = resolveProjectPath(plan.outputPath);
          let assetPath = plan.outputPath;

          if (plan.skippedReason === "reused_existing_file_on_disk" && fs.existsSync(absOutputPath)) {
            // --reuse-existing-file: point DB at the file already on disk, no regeneration.
          } else {
            const coverAsset = await generateShortCoverAsset({
              contentId: row.id,
              topic: row.topic,
              hookOrScriptExcerpt: row.short_selected_hook || row.short_content || row.script,
              sourceImagePath: row.image_paths?.[0] ?? null,
              coverText: plan.coverText,
              layoutPreset: LAYOUT_PRESET,
            });
            assetPath = path.relative(process.cwd(), coverAsset.outputPath);
          }

          const generatedAt = new Date().toISOString();
          const promptVersions = mergePromptVersions(row.prompt_versions, {
            cover: createPromptVersionEntry("cover", {
              mode: "short",
              details: {
                ...((row.prompt_versions as Record<string, unknown> | null)?.cover &&
                typeof row.prompt_versions === "object"
                  ? ((row.prompt_versions as Record<string, { details?: unknown }>).cover?.details ?? {})
                  : {}),
                assetGeneration: {
                  source: ASSET_GENERATION_SOURCE,
                  generatedAt,
                  assetPath,
                  renderer: RENDERER,
                  layoutPreset: LAYOUT_PRESET,
                },
              },
            }),
          });

          await pool.query(
            `
              update content_generations
              set
                short_cover_asset_path = $1,
                short_cover_generated_at = $2::timestamptz,
                prompt_versions = $3::jsonb
              where id = $4
            `,
            [assetPath, generatedAt, JSON.stringify(promptVersions), row.id],
          );
          applied += 1;
        } catch (err) {
          failed += 1;
          applyErrors.push({
            contentId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const payload = {
      mode: args.apply ? "apply" : "dry_run",
      generatorLocal: true,
      externalApiCalled: false,
      videoTouched: false,
      queueTouched: false,
      summary: {
        scanned: result.rows.length,
        eligible,
        skippedMissingCoverText,
        skippedExistingAsset,
        skippedUnsafe,
        applied,
        failed,
      },
      applyErrors,
      examples: plans.slice(0, 30),
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Cover Asset Generation Preview");
    console.log(`- Mode: ${payload.mode}`);
    console.log(`- Candidates scanned: ${payload.summary.scanned}`);
    console.log(`- Eligible: ${payload.summary.eligible}`);
    console.log(`- Skipped missing coverText: ${payload.summary.skippedMissingCoverText}`);
    console.log(`- Skipped existing asset: ${payload.summary.skippedExistingAsset}`);
    console.log(`- Skipped unsafe: ${payload.summary.skippedUnsafe}`);
    if (args.apply) {
      console.log(`- Applied: ${payload.summary.applied}`);
      console.log(`- Failed: ${payload.summary.failed}`);
    }
    console.log(`- Generator local/deterministic: yes (sharp + SVG overlay, no external API)`);
    console.log(`- Video touched: no`);
    console.log(`- Queue touched: no`);
    console.log("| content_id | title | format_type | topic_family | coverText | output_path | renderer | eligible | skipped_reason |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const plan of payload.examples) {
      console.log(
        `| ${plan.contentId} | ${shorten(plan.title, 40)} | ${plan.formatType} | ${plan.topicFamily} | ${shorten(plan.coverText, 32)} | ${plan.outputPath} | ${plan.renderer} | ${plan.eligible} | ${plan.skippedReason ?? "-"} |`,
      );
    }
    if (applyErrors.length > 0) {
      console.log("\n### Apply Errors");
      for (const error of applyErrors) {
        console.log(`- ${error.contentId}: ${error.error}`);
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
