import "dotenv/config";

import path from "node:path";
import pg from "pg";
import { generateShortCover } from "@/lib/short-cover-engine";
import { createPromptVersionEntry, mergePromptVersions } from "@/lib/prompt-version-registry";
import { generateShortCoverAsset } from "@/lib/image/short-cover-asset-generator";

const { Pool } = pg;

type Args = {
  dryRun: boolean;
  apply: boolean;
  from: string | null;
  to: string | null;
  limit: number | null;
  contentId: string | null;
  metadataOnly: boolean;
  generateAssets: boolean;
  force: boolean;
  json: boolean;
  onlyMissingCover: boolean;
  formatType: "tts_short" | "legacy_quote_short" | null;
};

type Row = {
  id: string;
  topic: string;
  channel_key: string;
  format_type: string | null;
  topic_family: string | null;
  script: string | null;
  short_content: string | null;
  short_selected_hook: string | null;
  hook_pattern: string | null;
  hook_type: string | null;
  prompt_versions: unknown;
  image_paths: string[] | null;
  short_cover_text: string | null;
  short_cover_asset_path: string | null;
  short_cover_generated_at: string | null;
  video_status: string | null;
  created_at: string;
};

type PreviewRow = {
  contentId: string;
  title: string;
  formatType: string;
  topicFamily: string;
  hookPattern: string | null;
  selectedHook: string | null;
  sourceExcerpt: string | null;
  proposedCoverText: string;
  reason: string;
  candidateSource: string | null;
  fallbackUsed: string | null;
  rejectionReason: string | null;
  sourceFields: string[];
  metadataCandidate: boolean;
  assetCandidate: boolean;
  skippedReason: string | null;
  qualityFlags: string[];
};

function parseArgs(argv: string[]): Args {
  let dryRun = true;
  let apply = false;
  let from: string | null = null;
  let to: string | null = null;
  let limit: number | null = null;
  let contentId: string | null = null;
  let metadataOnly = true;
  let generateAssets = false;
  let force = false;
  let json = false;
  let onlyMissingCover = false;
  let formatType: "tts_short" | "legacy_quote_short" | null = null;

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
    if (arg === "--metadata-only") {
      metadataOnly = true;
      continue;
    }
    if (arg === "--generate-assets") {
      generateAssets = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--only-missing-cover") {
      onlyMissingCover = true;
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    dryRun,
    apply,
    from,
    to,
    limit,
    contentId,
    metadataOnly,
    generateAssets,
    force,
    json,
    onlyMissingCover,
    formatType,
  };
}

function shorten(value: string | null | undefined, max = 72): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "-";
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function firstSentence(value: string | null | undefined, max = 140): string | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  const first = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  return shorten(first, max);
}

function qualityFlagsForCover(row: Row, proposed: string): string[] {
  const flags: string[] = [];
  const normalized = normalize(proposed);
  const words = normalized.split(/\s+/).filter(Boolean);
  const lower = normalized.toLocaleLowerCase("vi-VN");
  const titleLower = normalize(row.topic).toLocaleLowerCase("vi-VN");
  const sourceLower = normalize(row.short_selected_hook || row.short_content || row.script).toLocaleLowerCase("vi-VN");

  if (words.length > 7) flags.push("too_long");
  if (words.length < 2) flags.push("incomplete_phrase");
  if (/^(điều gì|sự thật|cuộc sống|nỗi đau|bài học)$/i.test(normalized)) flags.push("too_generic");
  if (/(có những|người ta thường|nhiều khi|đôi khi lại|nhận ra)/i.test(lower) && words.length >= 4) {
    flags.push("awkward_vietnamese");
  }
  if (/(bí mật|không ai biết|gây sốc|chấn động|bạn sẽ hối hận)/i.test(lower)) flags.push("too_clickbait");
  const titleWordHits = words.filter((word) => titleLower.includes(word.toLocaleLowerCase("vi-VN"))).length;
  const sourceWordHits = words.filter((word) => sourceLower.includes(word.toLocaleLowerCase("vi-VN"))).length;
  if (titleWordHits === 0 && sourceWordHits <= 1) flags.push("misleading_vs_source");
  if (/(trả thù|trừng phạt|hủy diệt|báo thù)/i.test(lower)) flags.push("not_calm_buddhist_tone");
  return flags;
}

function getSourceFields(row: Row): string[] {
  return [
    "topic",
    row.short_selected_hook ? "shortSelectedHook" : null,
    row.short_content ? "shortContent" : null,
    row.script ? "script" : null,
    row.hook_pattern ? "hookPattern" : null,
    row.hook_type ? "hookType" : null,
    row.topic_family ? "topicFamily" : null,
    row.prompt_versions ? "promptVersions" : null,
  ].filter((value): value is string => Boolean(value));
}

function buildPromptVersions(row: Row, preview: PreviewRow, assetPath: string | null) {
  return mergePromptVersions(row.prompt_versions, {
    cover: createPromptVersionEntry("cover", {
      mode: "short",
      details: {
        status: assetPath ? "generated" : "metadata_backfilled",
        metadataSource: "backfill_v2",
        generatedAt: new Date().toISOString(),
        sourceFields: preview.sourceFields,
        coverText: preview.proposedCoverText,
        coverReason: preview.reason,
        candidateSource: preview.candidateSource,
        fallbackUsed: preview.fallbackUsed,
        sourceCue: preview.sourceExcerpt,
        topicFamily: row.topic_family,
        formatType: row.format_type,
        assetPath,
      },
    }),
  });
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
    if (args.onlyMissingCover) {
      whereParts.push(`(short_cover_text is null or btrim(short_cover_text) = '')`);
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
          script,
          short_content,
          short_selected_hook,
          hook_pattern,
          hook_type,
          prompt_versions,
          image_paths,
          short_cover_text,
          short_cover_asset_path,
          short_cover_generated_at::text,
          video_status,
          created_at::text
        from content_generations
        where ${whereParts.join(" and ")}
        order by created_at desc
        ${limitSql}
      `,
      params,
    );

    const previewRows: PreviewRow[] = [];
    let metadataCandidates = 0;
    let assetCandidates = 0;
    let skipped = 0;

    for (const row of result.rows) {
      const existingCover = row.short_cover_text?.trim() ?? "";
      if (existingCover && !args.force) {
        previewRows.push({
          contentId: row.id,
          title: row.topic,
          formatType: row.format_type ?? "(unknown)",
          topicFamily: row.topic_family ?? "(unclassified)",
          hookPattern: row.hook_pattern ?? row.hook_type ?? null,
          selectedHook: row.short_selected_hook ?? null,
          sourceExcerpt: firstSentence(row.short_content || row.script),
          proposedCoverText: existingCover,
          reason: "existing_cover_text_preserved",
          candidateSource: null,
          fallbackUsed: null,
          rejectionReason: null,
          sourceFields: getSourceFields(row),
          metadataCandidate: false,
          assetCandidate: false,
          skippedReason: "existing_cover_text_present",
          qualityFlags: [],
        });
        skipped += 1;
        continue;
      }

      const cover = generateShortCover({
        topic: row.topic,
        selectedHook: row.short_selected_hook,
        script: row.short_content || row.script,
        formatType: row.format_type,
        topicFamily: row.topic_family,
      });
      const sourceFields = getSourceFields(row);
      const metadataCandidate = Boolean(cover.coverText.trim());
      const assetCandidate = metadataCandidate && args.generateAssets && !row.short_cover_asset_path;
      if (metadataCandidate) metadataCandidates += 1;
      if (assetCandidate) assetCandidates += 1;

      previewRows.push({
        contentId: row.id,
        title: row.topic,
        formatType: row.format_type ?? "(unknown)",
        topicFamily: row.topic_family ?? "(unclassified)",
        hookPattern: row.hook_pattern ?? row.hook_type ?? null,
        selectedHook: row.short_selected_hook ?? null,
        sourceExcerpt: firstSentence(row.short_content || row.script),
        proposedCoverText: cover.coverText,
        reason: cover.coverReason,
        candidateSource: cover.candidateSource,
        fallbackUsed: cover.fallbackUsed,
        rejectionReason: cover.rejectionReason,
        sourceFields,
        metadataCandidate,
        assetCandidate,
        skippedReason: metadataCandidate ? null : "could_not_derive_cover_text",
        qualityFlags: metadataCandidate
          ? uniqueStrings([...cover.qualityFlags, ...qualityFlagsForCover(row, cover.coverText)])
          : ["insufficient_source"],
      });
    }

    if (args.apply) {
      for (const preview of previewRows) {
        if (!preview.metadataCandidate || preview.skippedReason) continue;
        const row = result.rows.find((item) => item.id === preview.contentId);
        if (!row) continue;

        let assetPath: string | null = row.short_cover_asset_path ?? null;
        let generatedAt = row.short_cover_generated_at ?? null;

        if (args.generateAssets && !assetPath) {
          const coverAsset = await generateShortCoverAsset({
            contentId: row.id,
            topic: row.topic,
            hookOrScriptExcerpt: row.short_selected_hook || row.short_content || row.script,
            sourceImagePath: row.image_paths?.[0] ?? null,
            coverText: preview.proposedCoverText,
            layoutPreset: "short_cover_hook",
          });
          assetPath = path.relative(process.cwd(), coverAsset.outputPath);
          generatedAt = new Date().toISOString();
        }

        await pool.query(
          `
            update content_generations
            set
              short_cover_text = $1,
              short_cover_asset_path = coalesce($2, short_cover_asset_path),
              short_cover_generated_at = case
                when $3::timestamptz is not null then $3::timestamptz
                else short_cover_generated_at
              end,
              prompt_versions = $4::jsonb
            where id = $5
          `,
          [
            preview.proposedCoverText,
            assetPath,
            generatedAt,
            JSON.stringify(buildPromptVersions(row, preview, assetPath)),
            row.id,
          ],
        );
      }
    }

    const payload = {
      mode: args.apply ? "apply" : "dry_run",
      metadataOnly: args.metadataOnly,
      generateAssets: args.generateAssets,
      force: args.force,
      summary: {
        scanned: result.rows.length,
        candidatesFound: previewRows.filter((row) => row.metadataCandidate).length,
        ttsShortCandidates: previewRows.filter((row) => row.metadataCandidate && row.formatType === "tts_short").length,
        legacyQuoteShortCandidates: previewRows.filter((row) => row.metadataCandidate && row.formatType === "legacy_quote_short").length,
        metadataOnlyCandidates: metadataCandidates,
        assetGenerationCandidates: assetCandidates,
        skipped,
        skippedExistingCoverText: previewRows.filter((row) => row.skippedReason === "existing_cover_text_present").length,
        skippedInsufficientSource: previewRows.filter((row) => row.skippedReason === "could_not_derive_cover_text").length,
      },
      examples: previewRows.slice(0, 80),
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log("## Backfill Preview");
    console.log(`- Candidates found: ${payload.summary.candidatesFound}`);
    console.log(`- tts_short candidates: ${payload.summary.ttsShortCandidates}`);
    console.log(`- legacy_quote_short candidates: ${payload.summary.legacyQuoteShortCandidates}`);
    console.log(`- Metadata-only candidates: ${payload.summary.metadataOnlyCandidates}`);
    console.log(`- Asset-generation candidates: ${payload.summary.assetGenerationCandidates}`);
    console.log(`- Skipped: ${payload.summary.skipped}`);
    console.log(`- Skipped existing coverText: ${payload.summary.skippedExistingCoverText}`);
    console.log(`- Skipped insufficient source: ${payload.summary.skippedInsufficientSource}`);
    console.log("| content_id | title | format_type | topic_family | hook_pattern | proposed_coverText | quality_flag | candidate_source | fallback_used | rejection_reason | source_cue |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const row of payload.examples) {
      console.log(
        `| ${row.contentId} | ${shorten(row.title)} | ${row.formatType} | ${row.topicFamily} | ${shorten(row.hookPattern, 32)} | ${shorten(row.proposedCoverText)} | ${shorten(row.qualityFlags.join(", ") || "ok", 48)} | ${shorten(row.candidateSource, 20)} | ${shorten(row.fallbackUsed, 24)} | ${shorten(row.rejectionReason, 40)} | ${shorten(row.sourceExcerpt, 56)} |`,
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
