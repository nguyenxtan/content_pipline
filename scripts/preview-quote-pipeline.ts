import "dotenv/config";

import pg from "pg";
import { previewQuoteGeneration } from "@/lib/pipeline/quote-short-pipeline";
import {
  resolveFacebookQuoteArtifact,
  readStoredQuoteArtifactMetadata,
} from "@/lib/quotes/quote-pipeline";
import { resolveQuoteVisualStyle } from "@/lib/quotes/quote-style";

const { Pool } = pg;

type ContentRow = {
  id: string;
  topic: string;
  short_content: string | null;
  niche_name: string;
  content_profile_key: string | null;
  channel_key: string | null;
  format_type: string | null;
  prompt_versions: Record<string, unknown> | null;
};

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function loadSourceContent(contentId: string | null, channelKey: string): Promise<ContentRow | null> {
  if (!process.env.DATABASE_URL) return null;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    if (contentId) {
      const result = await client.query<ContentRow>(`
        select id, topic, short_content, niche_name, content_profile_key, channel_key, format_type, prompt_versions
        from content_generations
        where id = $1
        limit 1
      `, [contentId]);
      return result.rows[0] ?? null;
    }

    const result = await client.query<ContentRow>(`
      select id, topic, short_content, niche_name, content_profile_key, channel_key, format_type, prompt_versions
      from content_generations
      where channel_key = $1
        and video_status = 'done'
      order by created_at desc
      limit 1
    `, [channelKey]);
    return result.rows[0] ?? null;
  } finally {
    client.release();
    await pool.end();
  }
}

async function previewPhatPhap(sourceContentId: string | null) {
  const source = await loadSourceContent(sourceContentId, "phat_phap");
  if (!source) throw new Error("No phat_phap source content found");

  const resolved = await resolveFacebookQuoteArtifact({
    topic: source.topic,
    shortContent: source.short_content,
    contentProfileKey: source.content_profile_key,
    channelKey: source.channel_key,
    nicheName: source.niche_name,
    sourceContentId: source.id,
    sourceFormatType: source.format_type,
  });

  console.log(JSON.stringify({
    channelKey: "phat_phap",
    sourceContentId: source.id,
    topic: source.topic,
    quoteText: resolved.quoteText,
    quoteSourceType: resolved.metadata.quoteSourceType,
    validationStatus: resolved.metadata.validationStatus,
    validationReasons: resolved.metadata.validationReasons,
    quoteStyle: resolved.metadata.quoteStyle,
    kinetic: resolved.metadata.kinetic,
    llmUsage: resolved.usage,
  }, null, 2));
}

async function previewTangSau(sourceContentId: string | null) {
  const source = await loadSourceContent(sourceContentId, "tang_sau");
  if (source?.format_type === "legacy_quote_short") {
    const stored = readStoredQuoteArtifactMetadata(source.prompt_versions);
    console.log(JSON.stringify({
      channelKey: "tang_sau",
      mode: "existing_legacy_quote_short",
      sourceContentId: source.id,
      topic: source.topic,
      quoteText: source.short_content,
      storedQuoteArtifact: stored,
      quoteStyle: resolveQuoteVisualStyle({
        channelKey: "tang_sau",
        contentProfileKey: source.content_profile_key,
        nicheName: source.niche_name,
      }),
      facebookQuotePhoto: "not_supported_without_real_channel",
    }, null, 2));
    return;
  }

  const preview = await previewQuoteGeneration({
    count: 1,
    workspaceId: "tang_sau_workspace",
    channelProfileId: "tang_sau_v1",
    durationSec: 14,
  });
  const first = preview[0];
  if (!first) throw new Error("No tang_sau preview item generated");

  console.log(JSON.stringify({
    channelKey: "tang_sau",
    mode: "dry_run_preview",
    topic: first.topic,
    quoteText: first.quoteText,
    quoteStyle: first.quoteStyle,
    kinetic: resolveQuoteVisualStyle({
      channelKey: "tang_sau",
      contentProfileKey: "philosophy",
      nicheName: first.topic,
    }).kinetic,
    facebookQuotePhoto: "not_supported_without_real_channel",
  }, null, 2));
}

async function main() {
  const channelKey = argValue("--channel-key");
  const sourceContentId = argValue("--source-content-id");
  if (channelKey !== "phat_phap" && channelKey !== "tang_sau") {
    throw new Error("Usage: --channel-key phat_phap|tang_sau [--source-content-id <id>]");
  }

  if (channelKey === "phat_phap") {
    await previewPhatPhap(sourceContentId);
    return;
  }

  await previewTangSau(sourceContentId);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
