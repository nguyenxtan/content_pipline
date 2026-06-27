import { db } from "@/lib/db";
import { generationCostEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export type CostEventParams = {
  contentId?: string | null;
  provider: string;
  costType: string;
  pipelineRoute?: string | null;
  contentProfileKey?: string | null;
  nicheName?: string | null;
  formatType?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
  status?: string;
  usageUnit?: string | null;
  usageAmount?: number | null;
  unitCostVnd?: number | null;
  costVnd?: number | null;
  costSource?: string;
  metadata?: Record<string, unknown> | null;
};

function toNumStr(v: number | null | undefined): string | null {
  return v != null && Number.isFinite(v) ? String(v) : null;
}

/**
 * Upserts a cost event. If source_table + source_id are provided and a row
 * already exists for that source, it updates instead of inserting.
 * Fire-and-forget: call with `void writeCostEvent(...)` — never blocks pipeline.
 */
export async function writeCostEvent(params: CostEventParams): Promise<void> {
  const now = new Date();
  const values = {
    contentId: params.contentId ?? null,
    provider: params.provider,
    costType: params.costType,
    pipelineRoute: params.pipelineRoute ?? null,
    contentProfileKey: params.contentProfileKey ?? null,
    nicheName: params.nicheName ?? null,
    formatType: params.formatType ?? null,
    sourceTable: params.sourceTable ?? null,
    sourceId: params.sourceId ?? null,
    status: params.status ?? "done",
    usageUnit: params.usageUnit ?? null,
    usageAmount: toNumStr(params.usageAmount),
    unitCostVnd: toNumStr(params.unitCostVnd),
    costVnd: toNumStr(params.costVnd),
    costSource: params.costSource ?? "unknown",
    metadata: params.metadata ?? null,
    updatedAt: now,
  };

  try {
    if (params.sourceTable && params.sourceId) {
      // onConflictDoUpdate can't target partial indexes, so use select-then-upsert.
      // The partial unique index uniq_cost_events_source covers the WHERE NOT NULL case.
      const existing = await db
        .select({ id: generationCostEvents.id })
        .from(generationCostEvents)
        .where(
          and(
            eq(generationCostEvents.sourceTable, params.sourceTable),
            eq(generationCostEvents.sourceId, params.sourceId),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(generationCostEvents)
          .set({ ...values, updatedAt: now })
          .where(eq(generationCostEvents.id, existing[0].id));
      } else {
        await db.insert(generationCostEvents).values({ ...values, createdAt: now });
      }
    } else {
      await db.insert(generationCostEvents).values({ ...values, createdAt: now });
    }
  } catch (err) {
    console.warn("[writeCostEvent] Failed (non-blocking):", String(err).split("\n")[0]);
  }
}

/**
 * Deletes cost events by source. Used for cleanup in tests.
 */
export async function deleteCostEventsBySource(sourceTable: string, sourceId: string): Promise<void> {
  await db.delete(generationCostEvents).where(
    and(
      eq(generationCostEvents.sourceTable, sourceTable),
      eq(generationCostEvents.sourceId, sourceId),
    )
  );
}

/**
 * Deletes cost events by contentId. Used for cleanup in tests.
 */
export async function deleteCostEventsByContentId(contentId: string): Promise<void> {
  await db.delete(generationCostEvents).where(
    eq(generationCostEvents.contentId, contentId)
  );
}
