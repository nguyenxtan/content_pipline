"use server";

import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentGenerations, niches } from "@/lib/db/schema";
import { DEFAULT_CHANNEL_KEY } from "@/lib/config/channel-configs";
import { inferStrategicTopicFamily } from "@/lib/config/topic-family-registry";
import { pickBuddhistSprintTopicFamily, sprintAllocationSummary, PHAT_PHAP_SPRINT } from "@/lib/config/sprint-config";
import {
  getWorkspaceById,
  getWorkspaceByProfileId,
} from "@/lib/channel-workspace-registry";
import {
  previewQuoteGeneration,
  runQuoteShortBatch,
  QS_EXPERIMENT_ID,
} from "@/lib/pipeline/quote-short-pipeline";
import { buildQuoteArtifactMetadata } from "@/lib/quotes/quote-pipeline";
import { createPromptVersionEntry } from "@/lib/prompt-version-registry";
import type {
  QuoteGenBatchOptions,
  QuoteGenResult,
} from "@/lib/pipeline/quote-short-pipeline";

export type GenerateQuoteShortsResult = {
  ok: boolean;
  results: QuoteGenResult[];
  successCount: number;
  failCount: number;
  generatedCount: number;
  error?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

async function getActiveNiche() {
  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.channelKey, DEFAULT_CHANNEL_KEY), eq(niches.isActive, true)),
    columns: { id: true, name: true, contentProfileKey: true, channelKey: true },
  });
  if (!niche) {
    throw new Error(`Không tìm thấy niche active cho channel ${DEFAULT_CHANNEL_KEY}`);
  }
  return niche;
}

async function getGenerationNiche(options: QuoteGenBatchOptions) {
  const workspace =
    (options.workspaceId ? getWorkspaceById(options.workspaceId) : null) ??
    (options.channelProfileId ? getWorkspaceByProfileId(options.channelProfileId) : null);

  if (!workspace) {
    return getActiveNiche();
  }

  const niche = await db.query.niches.findFirst({
    where: and(eq(niches.channelKey, workspace.channelKey), eq(niches.isActive, true)),
    columns: { id: true, name: true, contentProfileKey: true, channelKey: true },
  });
  if (!niche) {
    throw new Error(`Không tìm thấy niche active cho workspace ${workspace.workspaceId}`);
  }
  return niche;
}

// ── Actions ───────────────────────────────────────────────────────────────

/**
 * Automatic production generation for Quote Shorts.
 * Generates quote text, image, music-backed video, sidecar metadata, and DB rows.
 * Does NOT schedule or upload.
 */
export async function generateQuoteShortsAction(
  options: QuoteGenBatchOptions,
): Promise<GenerateQuoteShortsResult> {
  try {
    const count = Math.max(1, Math.min(10, options.count));

    // Sprint family: when no explicit family is requested and channel is phat_phap, apply 70/20/10 allocation.
    const channelKey = options.workspaceId === "buddhist_healing_workspace" ||
      options.channelProfileId === "buddhist_healing_v1"
      ? "phat_phap"
      : options.workspaceId === "tang_sau_workspace" || options.channelProfileId === "tang_sau_v1"
        ? "tang_sau"
        : DEFAULT_CHANNEL_KEY;
    const sprintFamily = !options.topicFamily
      ? pickBuddhistSprintTopicFamily(channelKey)
      : null;
    if (sprintFamily) {
      console.log(
        `[quote-gen] ${sprintAllocationSummary(PHAT_PHAP_SPRINT)} → selected="${sprintFamily}"`,
      );
    }
    const resolvedTopicFamily = options.topicFamily ?? sprintFamily ?? undefined;

    const preparedItems = await previewQuoteGeneration({
      count,
      workspaceId: options.workspaceId,
      topicFamily: resolvedTopicFamily,
      durationSec: options.durationSec,
      channelProfileId: options.channelProfileId,
      quoteFormat: options.quoteFormat,
    });

    if (preparedItems.length === 0) {
      return {
        ok: false,
        results: [],
        successCount: 0,
        failCount: 0,
        generatedCount: 0,
        error: "Không thể chuẩn bị Quote Short nào để tạo.",
      };
    }

    const niche = await getGenerationNiche(options);

    for (const item of preparedItems) {
      console.log(
        `[quote-gen] topic="${item.topic}" family="${item.topicFamily ?? resolvedTopicFamily ?? "auto"}"` +
        ` format="${item.visualMode ?? "default"}" channel="${niche.channelKey}"`,
      );
    }

    const batchResults = await runQuoteShortBatch(preparedItems, {
      durationSec: options.durationSec,
    });

    const successfulEntries = batchResults
      .map((result, index) => ({ result, item: preparedItems[index] }))
      .filter((entry) => entry.result.ok && entry.result.videoPath);

    if (successfulEntries.length > 0) {
      await db.insert(contentGenerations).values(
        successfulEntries.map(({ result: r, item }) => {
          // Relativize bg.jpg path per ADR-019 (relative to process.cwd()).
          // sourceImagePath is the absolute path to the clean background image (not the rendered card).
          const relBgPath = r.sourceImagePath
            ? path.relative(process.cwd(), r.sourceImagePath)
            : "";
          if (relBgPath) {
            console.log(
              `[legacyQuoteShort] image_paths_saved content_id=${r.contentId} path=${relBgPath}`,
            );
          }
          return {
            id: r.contentId,
            topic: r.topic,
            nicheId: niche.id,
            nicheName: niche.name,
            contentProfileKey: niche.contentProfileKey ?? "buddhism",
            channelKey: niche.channelKey ?? DEFAULT_CHANNEL_KEY,
            script: r.reflectionText ? `${r.quoteText}\n\n${r.reflectionText}` : r.quoteText,
            shortContent: r.reflectionText ? `${r.quoteText}\n\n${r.reflectionText}` : r.quoteText,
            shortSelectedHook: r.quoteText,
            longContent: r.reflectionText ? `${r.quoteText}\n\n${r.reflectionText}` : r.quoteText,
            experimentId: QS_EXPERIMENT_ID,
            experimentVariant: r.experimentVariant ?? "LEGACY_QUOTE_NO_VOICE_V2",
            thumbnailText: r.quoteText,
            status: "completed",
            ttsStatus: "done",
            imagesStatus: "done",
            videoStatus: "done",
            videoPath: path.relative(process.cwd(), r.videoPath),
            contentMode: "short",
            formatType: "legacy_quote_short",
            promptVersions: {
              quote: createPromptVersionEntry("quote", {
                stage: "quote",
                mode: "independent_youtube_quote_short",
                model: item?.quoteModel ?? null,
                details: buildQuoteArtifactMetadata({
                  quoteText: r.quoteText,
                  quoteSourceType: item?.quoteSourceType ?? "independent_llm",
                  model: item?.quoteModel ?? null,
                  contentProfileKey: niche.contentProfileKey ?? "buddhism",
                  channelKey: niche.channelKey ?? DEFAULT_CHANNEL_KEY,
                  nicheName: niche.name,
                  sourceContentId: r.contentId,
                  sourceFormatType: "legacy_quote_short",
                  validationReasons: item?.quoteSourceType === "fallback" ? ["generator_fallback"] : [],
                }),
              }),
            },
            topicFamily: niche.channelKey === "phat_phap"
              ? (resolvedTopicFamily ?? inferStrategicTopicFamily(r.topic))
              : null,
            // Persist clean background image path so the FB quote uploader can source it.
            // Must be bg.jpg (not card.jpg) — card.jpg has baked-in text and would double-render.
            imagePaths: relBgPath ? [relBgPath] : [],
          };
        }),
      );
    }

    return {
      ok: true,
      results: batchResults,
      successCount: successfulEntries.length,
      failCount: batchResults.filter((r) => !r.ok).length,
      generatedCount: preparedItems.length,
    };
  } catch (err) {
    return {
      ok: false,
      results: [],
      successCount: 0,
      failCount: Math.max(1, Math.min(10, options.count)),
      generatedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
