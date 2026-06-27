"use server";

import { db } from "@/lib/db";
import { niches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { logApiUsage } from "@/actions/ai-usage";
import { runHookEngine } from "@/lib/hook-engine";
import {
  runScriptEngine,
  type ShortScriptEngineResult,
} from "@/lib/script-engine";
import { DEFAULT_PSYCHOLOGY_SHORT_PROMPT, DEFAULT_SHORT_PROMPT } from "@/lib/content-prompts";
import { getContentProfile } from "@/lib/config/content-profiles";

const DEFAULT_MODEL =
  process.env.CONTENT_GEN_MODEL ??
  process.env.NEXT_PUBLIC_LLM_TEST_MODEL ??
  "openai/gpt-4o-mini";

export async function runScriptEngineAction(input: {
  topic: string;
  nicheId?: number | null;
  model?: string | null;
  dedupTopics?: string[] | null;
}): Promise<
  | {
      success: true;
      mode: "short";
      hookCandidates: string[];
      selectedHook: string;
      script: string;
      validation: ShortScriptEngineResult["validation"];
      rewriteCount: number;
    }
  | { success: false; error: string }
> {
  const topic = input.topic?.trim();
  if (!topic) return { success: false, error: "Topic là bắt buộc" };

  const niche = input.nicheId
    ? await db.query.niches.findFirst({ where: eq(niches.id, input.nicheId) })
    : null;
  const shortTpl = input.nicheId
    ? await db.query.promptTemplates.findFirst({
        where: (t, { and, eq }) => and(eq(t.nicheId, input.nicheId!), eq(t.stage, "short_gen"), eq(t.isActive, true)),
      })
    : null;
  const profile = getContentProfile(niche?.contentProfileKey);

  const nicheName = niche?.name ?? profile.defaultNicheName;
  const nicheDescription = niche?.description ?? profile.defaultNicheDescription;
  const tone = niche?.tone ?? profile.defaultTone;
  const client = getOpenRouterClient();
  const model = input.model ?? DEFAULT_MODEL;
  const dedupBlock = input.dedupTopics?.length
    ? `\n\nCác chủ đề gần đây — tránh lặp góc nhìn hoặc wording quá giống:\n${input.dedupTopics.slice(0, 20).map((value, index) => `${index + 1}. ${value}`).join("\n")}\n`
    : "";

  try {
    const hookResult = await runHookEngine({
      client,
      model,
      topic,
      nicheName,
      nicheDescription,
      tone,
      contentProfileKey: niche?.contentProfileKey ?? profile.key,
      dedupBlock,
      count: 20,
    });

    const scriptResult = await runScriptEngine({
      client,
      model,
      topic,
      nicheName,
      selectedHook: hookResult.selectedHook,
      contentProfileKey: niche?.contentProfileKey ?? profile.key,
      mode: "short",
      shortBasePrompt: shortTpl?.content ?? (profile.key === "psychology" ? DEFAULT_PSYCHOLOGY_SHORT_PROMPT : DEFAULT_SHORT_PROMPT),
    });

    await Promise.all([
      logApiUsage({
        model,
        purpose: "hook_engine_generate",
        inputTokens: hookResult.usage.generateIn,
        outputTokens: hookResult.usage.generateOut,
        nicheId: input.nicheId ?? undefined,
      }),
      logApiUsage({
        model,
        purpose: "hook_engine_score",
        inputTokens: hookResult.usage.scoreIn,
        outputTokens: hookResult.usage.scoreOut,
        nicheId: input.nicheId ?? undefined,
      }),
      logApiUsage({
        model,
        purpose: "script_engine_short",
        inputTokens: scriptResult.usage.inputTokens,
        outputTokens: scriptResult.usage.outputTokens,
        nicheId: input.nicheId ?? undefined,
      }),
    ]);

    return {
      success: true,
      mode: "short",
      hookCandidates: hookResult.hooks,
      selectedHook: hookResult.selectedHook,
      script: scriptResult.result.script,
      validation: scriptResult.result.validation,
      rewriteCount: scriptResult.result.rewriteCount,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Script engine failed" };
  }
}
