import { db } from "@/lib/db";
import { promptTestRuns } from "@/lib/db/schema";
import { eq, and, gte, desc, sum, count } from "drizzle-orm";

export interface UsageSummary {
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}

export interface RunRecord {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
}

export async function getUsageByNicheStage(
  nicheId: number,
  stage: string,
  limit = 20
): Promise<{ runs: RunRecord[]; summary: UsageSummary }> {
  const rows = await db
    .select()
    .from(promptTestRuns)
    .where(
      and(
        eq(promptTestRuns.nicheId, nicheId),
        eq(promptTestRuns.stage, stage)
      )
    )
    .orderBy(desc(promptTestRuns.createdAt))
    .limit(limit);

  const runs: RunRecord[] = rows.map((r) => ({
    id: r.id,
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalCost: Number(r.totalCost),
    status: r.status,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt,
  }));

  const aggResult = await db
    .select({
      totalRuns: count(promptTestRuns.id),
      totalInputTokens: sum(promptTestRuns.inputTokens),
      totalOutputTokens: sum(promptTestRuns.outputTokens),
      totalCost: sum(promptTestRuns.totalCost),
    })
    .from(promptTestRuns)
    .where(
      and(
        eq(promptTestRuns.nicheId, nicheId),
        eq(promptTestRuns.stage, stage)
      )
    );

  const agg = aggResult[0];
  return {
    runs,
    summary: {
      totalRuns: Number(agg?.totalRuns ?? 0),
      totalInputTokens: Number(agg?.totalInputTokens ?? 0),
      totalOutputTokens: Number(agg?.totalOutputTokens ?? 0),
      totalCost: Number(agg?.totalCost ?? 0),
    },
  };
}

export async function getMonthlyUsageCost(): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const result = await db
    .select({ total: sum(promptTestRuns.totalCost) })
    .from(promptTestRuns)
    .where(gte(promptTestRuns.createdAt, startOfMonth));

  return Number(result[0]?.total ?? 0);
}
