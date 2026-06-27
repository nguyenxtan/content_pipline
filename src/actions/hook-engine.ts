"use server";

import { db } from "@/lib/db";
import { niches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { logApiUsage } from "@/actions/ai-usage";
import { runHookEngine, type HookEngineResult } from "@/lib/hook-engine";
import { getContentProfile } from "@/lib/config/content-profiles";

const DEFAULT_MODEL =
  process.env.CONTENT_GEN_MODEL ??
  process.env.NEXT_PUBLIC_LLM_TEST_MODEL ??
  "openai/gpt-4o-mini";

export async function runHookEngineAction(input: {
  topic: string;
  nicheId?: number | null;
  model?: string | null;
  dedupTopics?: string[] | null;
}): Promise<HookEngineResult | { error: string }> {
  const topic = input.topic?.trim();
  if (!topic) return { error: "Topic là bắt buộc" };

  const niche = input.nicheId
    ? await db.query.niches.findFirst({ where: eq(niches.id, input.nicheId) })
    : null;
  const profile = getContentProfile(niche?.contentProfileKey);

  const client = getOpenRouterClient();
  const dedupBlock = input.dedupTopics?.length
    ? `\n\nCác chủ đề gần đây — tránh lặp góc nhìn hoặc wording quá giống:\n${input.dedupTopics.slice(0, 20).map((value, index) => `${index + 1}. ${value}`).join("\n")}\n`
    : "";

  try {
    const result = await runHookEngine({
      client,
      model: input.model ?? DEFAULT_MODEL,
      topic,
      nicheName: niche?.name ?? profile.defaultNicheName,
      nicheDescription: niche?.description ?? profile.defaultNicheDescription,
      tone: niche?.tone ?? profile.defaultTone,
      contentProfileKey: niche?.contentProfileKey ?? profile.key,
      dedupBlock,
      count: 20,
    });

    await Promise.all([
      logApiUsage({
        model: input.model ?? DEFAULT_MODEL,
        purpose: "hook_engine_generate",
        inputTokens: result.usage.generateIn,
        outputTokens: result.usage.generateOut,
        nicheId: input.nicheId ?? undefined,
      }),
      logApiUsage({
        model: input.model ?? DEFAULT_MODEL,
        purpose: "hook_engine_score",
        inputTokens: result.usage.scoreIn,
        outputTokens: result.usage.scoreOut,
        nicheId: input.nicheId ?? undefined,
      }),
    ]);

    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Hook engine failed" };
  }
}
