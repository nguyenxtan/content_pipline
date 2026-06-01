"use server";

import { db } from "@/lib/db";
import { promptTemplates, promptTestRuns } from "@/lib/db/schema";
import { eq, and, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { calculateCost } from "@/lib/llm/pricing";
import { getUsageByNicheStage } from "@/lib/llm/openrouter-usage";
import type {
  SavePromptState,
  TestPromptResult,
} from "@/lib/validations/prompts";

export async function savePromptTemplateAction(data: {
  nicheId: number;
  stage: string;
  name: string;
  content: string;
  model: string;
  temperature: number;
  maxTokens: number;
}): Promise<SavePromptState> {
  if (!data.name.trim() || data.name.length < 2)
    return { error: "Tên phải có ít nhất 2 ký tự" };
  if (!data.content.trim()) return { error: "Nội dung không được để trống" };

  const uniqueVars = [
    ...new Set(
      [...data.content.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)].map(
        (m) => m[1]
      )
    ),
  ];

  const result = await db
    .select({ maxVer: max(promptTemplates.version) })
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.nicheId, data.nicheId),
        eq(promptTemplates.stage, data.stage)
      )
    );

  const nextVersion = (result[0]?.maxVer ?? 0) + 1;

  await db
    .update(promptTemplates)
    .set({ isActive: false })
    .where(
      and(
        eq(promptTemplates.nicheId, data.nicheId),
        eq(promptTemplates.stage, data.stage),
        eq(promptTemplates.isActive, true)
      )
    );

  const [created] = await db
    .insert(promptTemplates)
    .values({
      nicheId: data.nicheId,
      stage: data.stage,
      name: data.name,
      content: data.content,
      variables: uniqueVars,
      model: data.model,
      temperature: data.temperature.toString(),
      maxTokens: data.maxTokens,
      version: nextVersion,
      isActive: true,
    })
    .returning({ id: promptTemplates.id, version: promptTemplates.version });

  revalidatePath(`/niches/${data.nicheId}`);
  revalidatePath(`/niches/${data.nicheId}/prompts/${data.stage}`);

  return { success: true, templateId: created.id, version: created.version };
}

export async function testPromptRunAction(data: {
  content: string;
  variables: Record<string, string>;
  model: string;
  temperature: number;
  maxTokens: number;
  nicheId: number;
  stage: string;
  promptTemplateId?: number;
}): Promise<TestPromptResult> {
  const start = Date.now();

  let prompt = data.content;
  for (const [key, value] of Object.entries(data.variables)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }

  const client = getOpenRouterClient();
  const isO1 =
    data.model.includes("o1") ||
    data.model.includes("o3") ||
    data.model.includes("o4");

  try {
    const response = await client.chat.completions.create({
      model: data.model,
      messages: [{ role: "user", content: prompt }],
      ...(isO1
        ? { max_completion_tokens: data.maxTokens }
        : { temperature: data.temperature, max_tokens: data.maxTokens }),
    });

    const durationMs = Date.now() - start;
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const costUsd = calculateCost(data.model, inputTokens, outputTokens);
    const output = response.choices[0]?.message?.content ?? "";

    await db.insert(promptTestRuns).values({
      nicheId: data.nicheId,
      stage: data.stage,
      promptTemplateId: data.promptTemplateId ?? null,
      model: data.model,
      inputTokens,
      outputTokens,
      totalCost: costUsd.toString(),
      output,
      inputVariables: data.variables,
      status: "success",
    });

    return {
      success: true,
      output,
      inputTokens,
      outputTokens,
      costUsd,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const errMsg = error instanceof Error ? error.message : "Unknown error";

    await db.insert(promptTestRuns).values({
      nicheId: data.nicheId,
      stage: data.stage,
      promptTemplateId: data.promptTemplateId ?? null,
      model: data.model,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: "0",
      output: null,
      inputVariables: data.variables,
      status: "failed",
      errorMessage: errMsg,
    });

    return { success: false, error: errMsg, durationMs };
  }
}

export async function getPromptTestRuns(nicheId: number, stage: string) {
  return getUsageByNicheStage(nicheId, stage, 20);
}

export async function getActivePromptTemplate(nicheId: number, stage: string) {
  return db.query.promptTemplates.findFirst({
    where: (t, { and, eq }) =>
      and(eq(t.nicheId, nicheId), eq(t.stage, stage), eq(t.isActive, true)),
  });
}

export async function getPromptVersions(nicheId: number, stage: string) {
  return db.query.promptTemplates.findMany({
    where: (t, { and, eq }) =>
      and(eq(t.nicheId, nicheId), eq(t.stage, stage)),
    orderBy: (t, { desc }) => [desc(t.version)],
  });
}
