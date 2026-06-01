"use server";

import { db } from "@/lib/db";
import { niches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { logApiUsage } from "@/actions/ai-usage";
import { runHookEngine } from "@/lib/hook-engine";
import {
  runScriptEngine,
  type LongScriptEngineResult,
  type ShortScriptEngineResult,
} from "@/lib/script-engine";
import { DEFAULT_LONG_PROMPT, DEFAULT_SHORT_PROMPT } from "@/lib/content-prompts";

const DEFAULT_MODEL =
  process.env.CONTENT_GEN_MODEL ??
  process.env.NEXT_PUBLIC_LLM_TEST_MODEL ??
  "openai/gpt-4o-mini";

export async function runScriptEngineAction(input: {
  topic: string;
  nicheId?: number | null;
  mode: "short" | "long";
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
  | {
      success: true;
      mode: "long";
      hookCandidates: string[];
      selectedHook: string;
      script: string;
      outline: LongScriptEngineResult["outline"];
      chapters: LongScriptEngineResult["chapters"];
      validation: LongScriptEngineResult["validation"];
      rewriteCount: number;
    }
  | { success: false; error: string }
> {
  const topic = input.topic?.trim();
  if (!topic) return { success: false, error: "Topic là bắt buộc" };

  const niche = input.nicheId
    ? await db.query.niches.findFirst({ where: eq(niches.id, input.nicheId) })
    : null;
  const [shortTpl, longTpl] = input.nicheId
    ? await Promise.all([
        db.query.promptTemplates.findFirst({
          where: (t, { and, eq }) => and(eq(t.nicheId, input.nicheId!), eq(t.stage, "short_gen"), eq(t.isActive, true)),
        }),
        db.query.promptTemplates.findFirst({
          where: (t, { and, eq }) => and(eq(t.nicheId, input.nicheId!), eq(t.stage, "long_gen"), eq(t.isActive, true)),
        }),
      ])
    : [null, null];

  const nicheName = niche?.name ?? "Phật Pháp";
  const nicheDescription = niche?.description ?? "Nội dung Phật pháp và chữa lành";
  const tone = niche?.tone ?? "Trầm tĩnh, từng trải, gần gũi";
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
      dedupBlock,
      count: 20,
    });

    const scriptResult = await runScriptEngine({
      client,
      model,
      topic,
      nicheName,
      selectedHook: hookResult.selectedHook,
      mode: input.mode,
      shortBasePrompt: shortTpl?.content ?? DEFAULT_SHORT_PROMPT,
      longBasePrompt: longTpl?.content ?? DEFAULT_LONG_PROMPT,
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
        purpose: input.mode === "short" ? "script_engine_short" : "script_engine_long",
        inputTokens: scriptResult.usage.inputTokens,
        outputTokens: scriptResult.usage.outputTokens,
        nicheId: input.nicheId ?? undefined,
      }),
    ]);

    if (scriptResult.mode === "short") {
      return {
        success: true,
        mode: "short",
        hookCandidates: hookResult.hooks,
        selectedHook: hookResult.selectedHook,
        script: scriptResult.result.script,
        validation: scriptResult.result.validation,
        rewriteCount: scriptResult.result.rewriteCount,
      };
    }

    return {
      success: true,
      mode: "long",
      hookCandidates: hookResult.hooks,
      selectedHook: hookResult.selectedHook,
      script: scriptResult.result.script,
      outline: scriptResult.result.outline,
      chapters: scriptResult.result.chapters,
      validation: scriptResult.result.validation,
      rewriteCount: scriptResult.result.rewriteCount,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Script engine failed" };
  }
}
