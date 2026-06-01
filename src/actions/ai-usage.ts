"use server";

import { db } from "@/lib/db";
import { apiUsageLogs } from "@/lib/db/schema";
import { desc, sql, gte, and } from "drizzle-orm";
import { calcCost, getModelInfo, type ModelProvider } from "@/lib/ai-models";

export interface LogUsageParams {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  nicheId?: number;
  contentGenerationId?: string;
  metadata?: Record<string, unknown>;
}

/** Ghi 1 lần gọi API vào log — gọi sau mỗi LLM response */
export async function logApiUsage(params: LogUsageParams): Promise<void> {
  const modelInfo = getModelInfo(params.model);
  const provider: ModelProvider = modelInfo?.provider ?? "openai";
  const costUsd = params.costUsd ?? calcCost(params.model, params.inputTokens, params.outputTokens);

  try {
    await db.insert(apiUsageLogs).values({
      model: params.model,
      provider,
      purpose: params.purpose,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd: costUsd.toFixed(8),
      nicheId: params.nicheId ?? null,
      contentGenerationId: params.contentGenerationId ?? null,
      metadata: params.metadata ?? {},
    });
  } catch {
    // logging không nên làm gián đoạn luồng chính
    console.error("[logApiUsage] Failed to write usage log");
  }
}

export interface UsageSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  byModel: {
    model: string;
    provider: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
  byPurpose: {
    purpose: string;
    calls: number;
    costUsd: number;
  }[];
  recentLogs: {
    id: number;
    createdAt: Date;
    model: string;
    provider: string;
    purpose: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
}

export async function getUsageSummaryAction(days = 30): Promise<UsageSummary> {
  const since = new Date(Date.now() - days * 86400_000);

  const [totals, byModel, byPurpose, recentLogs] = await Promise.all([
    // Totals
    db
      .select({
        totalCostUsd: sql<string>`COALESCE(SUM(cost_usd), 0)`,
        totalInput:   sql<string>`COALESCE(SUM(input_tokens), 0)`,
        totalOutput:  sql<string>`COALESCE(SUM(output_tokens), 0)`,
        totalCalls:   sql<string>`COUNT(*)`,
      })
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, since)),

    // By model
    db
      .select({
        model:        apiUsageLogs.model,
        provider:     apiUsageLogs.provider,
        calls:        sql<string>`COUNT(*)`,
        inputTokens:  sql<string>`COALESCE(SUM(input_tokens), 0)`,
        outputTokens: sql<string>`COALESCE(SUM(output_tokens), 0)`,
        costUsd:      sql<string>`COALESCE(SUM(cost_usd), 0)`,
      })
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, since))
      .groupBy(apiUsageLogs.model, apiUsageLogs.provider)
      .orderBy(sql`SUM(cost_usd) DESC`),

    // By purpose
    db
      .select({
        purpose: apiUsageLogs.purpose,
        calls:   sql<string>`COUNT(*)`,
        costUsd: sql<string>`COALESCE(SUM(cost_usd), 0)`,
      })
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, since))
      .groupBy(apiUsageLogs.purpose)
      .orderBy(sql`SUM(cost_usd) DESC`),

    // Recent 50 logs
    db
      .select({
        id:           apiUsageLogs.id,
        createdAt:    apiUsageLogs.createdAt,
        model:        apiUsageLogs.model,
        provider:     apiUsageLogs.provider,
        purpose:      apiUsageLogs.purpose,
        inputTokens:  apiUsageLogs.inputTokens,
        outputTokens: apiUsageLogs.outputTokens,
        costUsd:      apiUsageLogs.costUsd,
      })
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, since))
      .orderBy(desc(apiUsageLogs.createdAt))
      .limit(50),
  ]);

  return {
    totalCostUsd:    Number(totals[0]?.totalCostUsd ?? 0),
    totalInputTokens: Number(totals[0]?.totalInput ?? 0),
    totalOutputTokens: Number(totals[0]?.totalOutput ?? 0),
    totalCalls:      Number(totals[0]?.totalCalls ?? 0),
    byModel: byModel.map((r) => ({
      model:        r.model,
      provider:     r.provider,
      calls:        Number(r.calls),
      inputTokens:  Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costUsd:      Number(r.costUsd),
    })),
    byPurpose: byPurpose.map((r) => ({
      purpose: r.purpose,
      calls:   Number(r.calls),
      costUsd: Number(r.costUsd),
    })),
    recentLogs: recentLogs.map((r) => ({
      id:           r.id,
      createdAt:    r.createdAt,
      model:        r.model,
      provider:     r.provider,
      purpose:      r.purpose,
      inputTokens:  r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd:      Number(r.costUsd),
    })),
  };
}

