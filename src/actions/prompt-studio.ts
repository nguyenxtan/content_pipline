"use server";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { niches, promptTemplates } from "@/lib/db/schema";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import type {
  PromptStudioSnapshot,
  SuggestPromptOptionsInput,
  SuggestPromptOptionsResult,
} from "@/lib/prompt-studio-types";
import {
  buildQuoteProfilePromptHints,
  getChannelProfile,
  getPromptStudioSnapshot,
  getQuoteOptionGroups,
  getTopicFamiliesForChannel,
} from "@/lib/prompt-studio-registry";

export async function getPromptStudioSnapshotAction(): Promise<PromptStudioSnapshot> {
  const snapshot = getPromptStudioSnapshot();

  const activeDbTemplates = await db
    .select({
      id: promptTemplates.id,
      nicheName: niches.name,
      stage: promptTemplates.stage,
      name: promptTemplates.name,
      model: promptTemplates.model,
      version: promptTemplates.version,
      isActive: promptTemplates.isActive,
    })
    .from(promptTemplates)
    .innerJoin(niches, eq(promptTemplates.nicheId, niches.id))
    .where(eq(promptTemplates.isActive, true))
    .orderBy(asc(niches.name), asc(promptTemplates.stage), asc(promptTemplates.version));

  return {
    ...snapshot,
    activeDbTemplates,
  };
}

function uniqueTake(items: Array<string | undefined>, max = 4) {
  return [...new Set(items.filter(Boolean) as string[])].slice(0, max);
}

function buildFallbackSuggestions(input: SuggestPromptOptionsInput): SuggestPromptOptionsResult {
  const channel = getChannelProfile(input.channelProfileId);
  const topicFamilies = getTopicFamiliesForChannel(input.channelProfileId).slice(0, 5);
  const quoteOptionGroups = getQuoteOptionGroups(input.channelProfileId);

  const quoteStyles = quoteOptionGroups.find((group) => group.id === "quoteStyle")?.options ?? [];
  const visualMoods = quoteOptionGroups.find((group) => group.id === "visualMood")?.options ?? [];

  const topicLower = input.topic?.toLocaleLowerCase("vi-VN") ?? "";
  const hookAngles = channel?.id === "tang_sau_v1"
    ? [
        "Câu hỏi ngắn về bản ngã hoặc lựa chọn",
        "Một nhận định trái ngược với thói quen sống hiện đại",
        "Khoảnh khắc im lặng khiến người nghe tự soi lại mình",
      ]
    : [
        "Nỗi đau quen thuộc nhưng ít ai gọi tên",
        "Lời nhắc nhẹ về buông bỏ hoặc chánh niệm",
        "Một quan sát đời thường dẫn tới bình an hoặc nhân quả",
      ];

  const familyBias = topicLower.includes("cô đơn")
    ? "modern_loneliness"
    : topicLower.includes("sợ") || topicLower.includes("bất an")
      ? "fear_anxiety"
      : input.topicFamilyId;

  return {
    ok: true,
    source: "fallback",
    suggestions: {
      topicFamilies: uniqueTake([
        familyBias ? topicFamilies.find((family) => family.id === familyBias)?.label : undefined,
        ...topicFamilies.map((family) => family.label),
      ]),
      quoteStyles: uniqueTake(quoteStyles.map((option) => option.label)),
      visualMoods: uniqueTake(visualMoods.map((option) => option.label)),
      hookAngles: uniqueTake(hookAngles),
    },
    note: "Preview-only fallback suggestions. Chưa thay đổi prompt production.",
  };
}

export async function suggestPromptOptionsAction(
  input: SuggestPromptOptionsInput,
): Promise<SuggestPromptOptionsResult> {
  const fallback = buildFallbackSuggestions(input);

  if (!process.env.OPENROUTER_API_KEY) {
    return fallback;
  }

  try {
    const client = getOpenRouterClient();
    const hints = buildQuoteProfilePromptHints(input.channelProfileId);
    const response = await client.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.55,
      max_tokens: 320,
      messages: [
        {
          role: "system",
          content:
            "You are a prompt studio assistant for a Vietnamese content factory. " +
            "Return strict JSON only with keys topicFamilies, quoteStyles, visualMoods, hookAngles. " +
            "Each key must be an array of short Vietnamese strings. No markdown.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Suggest prompt options for preview only. Do not change production prompts.",
            channelProfile: hints,
            contentFormatId: input.contentFormatId ?? "legacy_quote_short",
            topicFamilyId: input.topicFamilyId ?? null,
            topic: input.topic ?? null,
            currentFallback: fallback.suggestions,
          }),
        },
      ],
    });

    const raw = response.choices[0]?.message.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as Partial<SuggestPromptOptionsResult["suggestions"]>;

    const result: SuggestPromptOptionsResult = {
      ok: true,
      source: "ai",
      suggestions: {
        topicFamilies: uniqueTake(parsed.topicFamilies ?? fallback.suggestions.topicFamilies),
        quoteStyles: uniqueTake(parsed.quoteStyles ?? fallback.suggestions.quoteStyles),
        visualMoods: uniqueTake(parsed.visualMoods ?? fallback.suggestions.visualMoods),
        hookAngles: uniqueTake(parsed.hookAngles ?? fallback.suggestions.hookAngles),
      },
      note: "Preview-only AI suggestions. Người dùng phải tự chọn nếu muốn áp dụng sau này.",
    };

    return result;
  } catch (error) {
    return {
      ...fallback,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
