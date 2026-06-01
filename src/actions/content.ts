"use server";

import { db } from "@/lib/db";
import { generatedContents, promptTemplates, niches, promptTestRuns } from "@/lib/db/schema";
import { eq, and, desc, count, avg } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { calculateCost } from "@/lib/llm/pricing";
import { generateContentSchema, type GenerateContentInput, type GenerationResult, type PromptVersionInfo, type RecentGenerationItem } from "@/lib/validations/content";

export async function getPromptVersionsForStageAction(
  nicheId: number,
  stage: string
): Promise<PromptVersionInfo[]> {
  const templates = await db.query.promptTemplates.findMany({
    where: (t, { and: andFn, eq: eqFn }) =>
      andFn(eqFn(t.nicheId, nicheId), eqFn(t.stage, stage)),
    orderBy: (t, { desc: descFn }) => [descFn(t.version)],
  });

  return Promise.all(
    templates.map(async (t) => {
      const stats = await db
        .select({
          cnt: count(promptTestRuns.id),
          avgCost: avg(promptTestRuns.totalCost),
        })
        .from(promptTestRuns)
        .where(eq(promptTestRuns.promptTemplateId, t.id));

      return {
        id: t.id,
        name: t.name,
        content: t.content,
        variables: t.variables as string[],
        model: t.model,
        temperature: String(t.temperature),
        maxTokens: t.maxTokens,
        version: t.version,
        isActive: t.isActive,
        createdAt: t.createdAt,
        testRunCount: Number(stats[0]?.cnt ?? 0),
        avgCost: Number(stats[0]?.avgCost ?? 0),
      };
    })
  );
}

export async function generateContentAction(
  input: GenerateContentInput
): Promise<GenerationResult> {
  const parsed = generateContentSchema.safeParse(input);
  if (!parsed.success) {
    return { id: "", status: "error", errorMessage: "Invalid input" };
  }

  const template = await db.query.promptTemplates.findFirst({
    where: (t, { eq: eqFn }) => eqFn(t.id, parsed.data.promptTemplateId),
  });
  if (!template) {
    return { id: "", status: "error", errorMessage: "Prompt template not found" };
  }

  let prompt = template.content;
  for (const [key, value] of Object.entries(parsed.data.inputVariables)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }

  const model =
    parsed.data.model ??
    template.model ??
    process.env.NEXT_PUBLIC_LLM_TEST_MODEL ??
    "openai/gpt-4o-mini";

  const [record] = await db
    .insert(generatedContents)
    .values({
      nicheId: parsed.data.nicheId,
      stage: parsed.data.stage,
      promptTemplateId: parsed.data.promptTemplateId,
      promptVersion: template.version,
      inputVariables: parsed.data.inputVariables,
      status: "pending",
    })
    .returning({ id: generatedContents.id });

  const n8nUrl = process.env.N8N_WEBHOOK_URL;

  if (n8nUrl) {
    await db
      .update(generatedContents)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(generatedContents.id, record.id));

    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_CALLBACK_URL ?? "http://localhost:3000"}/api/webhooks/n8n-callback`;

    // fire-and-forget — n8n processes async, calls back via webhook
    fetch(n8nUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_WEBHOOK_AUTH_TOKEN
          ? { Authorization: `Bearer ${process.env.N8N_WEBHOOK_AUTH_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        generatedContentId: record.id,
        promptRendered: prompt,
        model,
        maxTokens: template.maxTokens,
        callbackUrl,
      }),
    }).catch(async (err) => {
      await db
        .update(generatedContents)
        .set({
          status: "error",
          errorMessage: `n8n call failed: ${err.message}`,
          updatedAt: new Date(),
        })
        .where(eq(generatedContents.id, record.id));
    });

    return { id: record.id, status: "processing" };
  }

  // Direct OpenRouter path (no n8n configured)
  const start = Date.now();
  try {
    await db
      .update(generatedContents)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(generatedContents.id, record.id));

    const client = getOpenRouterClient();
    const isO1 =
      model.includes("o1") || model.includes("o3") || model.includes("o4");

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      ...(isO1
        ? { max_completion_tokens: template.maxTokens }
        : {
            temperature: Number(template.temperature),
            max_tokens: template.maxTokens,
          }),
    });

    const durationMs = Date.now() - start;
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const costUsd = calculateCost(model, inputTokens, outputTokens);
    const output = response.choices[0]?.message?.content ?? "";

    await db
      .update(generatedContents)
      .set({
        status: "done",
        output,
        outputTokens,
        totalCost: costUsd.toString(),
        generationTime: durationMs,
        updatedAt: new Date(),
      })
      .where(eq(generatedContents.id, record.id));

    return {
      id: record.id,
      status: "done",
      output,
      outputTokens,
      totalCost: costUsd,
      generationTime: durationMs,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(generatedContents)
      .set({ status: "error", errorMessage: errMsg, updatedAt: new Date() })
      .where(eq(generatedContents.id, record.id));

    return {
      id: record.id,
      status: "error",
      errorMessage: errMsg,
      generationTime: Date.now() - start,
    };
  }
}

export async function getGeneratedContentAction(
  id: string
): Promise<GenerationResult | null> {
  const row = await db.query.generatedContents.findFirst({
    where: (c, { eq: eqFn }) => eqFn(c.id, id),
  });
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as GenerationResult["status"],
    output: row.output,
    outputTokens: row.outputTokens,
    totalCost: row.totalCost ? Number(row.totalCost) : null,
    generationTime: row.generationTime,
    errorMessage: row.errorMessage,
  };
}

export async function getRecentGenerationsAction(
  limit = 10
): Promise<RecentGenerationItem[]> {
  const rows = await db
    .select({
      id: generatedContents.id,
      nicheId: generatedContents.nicheId,
      stage: generatedContents.stage,
      status: generatedContents.status,
      output: generatedContents.output,
      createdAt: generatedContents.createdAt,
      nicheName: niches.name,
      nicheIcon: niches.icon,
    })
    .from(generatedContents)
    .leftJoin(niches, eq(generatedContents.nicheId, niches.id))
    .orderBy(desc(generatedContents.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    nicheId: r.nicheId,
    stage: r.stage,
    status: r.status,
    output: r.output,
    createdAt: r.createdAt,
    niche: { name: r.nicheName ?? "", icon: r.nicheIcon ?? null },
  }));
}
