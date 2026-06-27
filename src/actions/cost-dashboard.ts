"use server";

import { db } from "@/lib/db";
import { generationCostEvents, contentGenerations } from "@/lib/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getCostSettings } from "@/lib/cost/cost-settings";

// ─── Filter type ──────────────────────────────────────────────────────────────

export type CostDashboardFilter = {
  dateFrom?: string | null;
  dateTo?: string | null;
  nicheName?: string | null;
  contentProfileKey?: string | null;
  formatType?: string | null;
  pipelineRoute?: string | null;
  provider?: string | null;
  costType?: string | null;
  contentId?: string | null;
  knownOnly?: boolean;
  includeEstimated?: boolean;
  limit?: number;
  offset?: number;
};

// ─── Return types ─────────────────────────────────────────────────────────────

export type CostSummary = {
  totalCostVnd: number;
  knownCostVnd: number;
  estimatedCostVnd: number;
  unknownCostEventCount: number;
  cachedCostEventCount: number;
  totalVideosWithCost: number;
  averageCostPerVideo: number | null;
  ttsCostVnd: number;
  imageCostVnd: number;
  contentCostVnd: number;
  cacheSavingsVnd: number;
  byCostType: Array<{ costType: string; totalVnd: number; eventCount: number }>;
  byProvider: Array<{ provider: string; totalVnd: number; eventCount: number }>;
  byPipelineRoute: Array<{ route: string; totalVnd: number; eventCount: number }>;
  byNiche: Array<{ niche: string; totalVnd: number; eventCount: number }>;
  byDay: Array<{ day: string; totalVnd: number; eventCount: number }>;
  aimaxVndPerPoint: number;
};

export type VideoCostRow = {
  contentId: string;
  topic: string | null;
  nicheName: string | null;
  contentProfileKey: string | null;
  formatType: string | null;
  pipelineRoute: string | null;
  createdAt: Date | null;
  totalCostVnd: number;
  ttsCostVnd: number;
  imageCostVnd: number;
  contentCostVnd: number;
  unknownCostCount: number;
  estimatedCostVnd: number;
  eventCount: number;
  /** total script/hook/topic events (including unknown); >0 means script ran but cost may be unknown */
  scriptEventCount: number;
  /** total image/image_prompt events (including unknown); >0 means image ran */
  imageEventCount: number;
};

export type CostEventDetail = {
  id: string;
  provider: string;
  costType: string;
  status: string;
  usageUnit: string | null;
  usageAmount: string | null;
  unitCostVnd: string | null;
  costVnd: string | null;
  costSource: string;
  pipelineRoute: string | null;
  sourceTable: string | null;
  sourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWhere(filter: CostDashboardFilter) {
  const conds = [];
  if (filter.dateFrom) conds.push(gte(generationCostEvents.createdAt, new Date(filter.dateFrom)));
  if (filter.dateTo) {
    const end = new Date(filter.dateTo);
    end.setHours(23, 59, 59, 999);
    conds.push(lte(generationCostEvents.createdAt, end));
  }
  if (filter.nicheName)         conds.push(eq(generationCostEvents.nicheName, filter.nicheName));
  if (filter.contentProfileKey) conds.push(eq(generationCostEvents.contentProfileKey, filter.contentProfileKey));
  if (filter.formatType)        conds.push(eq(generationCostEvents.formatType, filter.formatType));
  if (filter.pipelineRoute)     conds.push(eq(generationCostEvents.pipelineRoute, filter.pipelineRoute));
  if (filter.provider)          conds.push(eq(generationCostEvents.provider, filter.provider));
  if (filter.costType)          conds.push(eq(generationCostEvents.costType, filter.costType));
  if (filter.contentId)         conds.push(eq(generationCostEvents.contentId, filter.contentId));
  if (filter.knownOnly)         conds.push(isNotNull(generationCostEvents.costVnd));
  if (filter.includeEstimated === false) {
    conds.push(eq(generationCostEvents.costSource, "configured_rate"));
  }
  return conds.length > 0 ? and(...conds) : undefined;
}

function safeNum(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function getCostDashboardSummaryAction(
  filter: CostDashboardFilter = {},
): Promise<{ ok: true; data: CostSummary } | { ok: false; error: string }> {
  try {
    const settings = await getCostSettings();
    const where = buildWhere(filter);
    const rows = await db.select({
      costType:   generationCostEvents.costType,
      provider:   generationCostEvents.provider,
      costVnd:    generationCostEvents.costVnd,
      costSource: generationCostEvents.costSource,
      status:     generationCostEvents.status,
      contentId:  generationCostEvents.contentId,
      pipelineRoute: generationCostEvents.pipelineRoute,
      nicheName:  generationCostEvents.nicheName,
      createdAt:  generationCostEvents.createdAt,
      usageAmount: generationCostEvents.usageAmount,
    }).from(generationCostEvents).where(where);

    let totalCostVnd = 0;
    let knownCostVnd = 0;
    let estimatedCostVnd = 0;
    let unknownCostEventCount = 0;
    let cachedCostEventCount = 0;
    let cacheSavingsVnd = 0;
    let ttsCostVnd = 0;
    let imageCostVnd = 0;
    let contentCostVnd = 0;

    const contentIds = new Set<string>();
    const typeMap = new Map<string, { totalVnd: number; count: number }>();
    const providerMap = new Map<string, { totalVnd: number; count: number }>();
    const routeMap = new Map<string, { totalVnd: number; count: number }>();
    const nicheMap = new Map<string, { totalVnd: number; count: number }>();
    const dayMap = new Map<string, { totalVnd: number; count: number }>();

    const incMap = (map: Map<string, { totalVnd: number; count: number }>, key: string, vnd: number) => {
      const e = map.get(key) ?? { totalVnd: 0, count: 0 };
      e.totalVnd += vnd;
      e.count++;
      map.set(key, e);
    };

    for (const row of rows) {
      const vnd = safeNum(row.costVnd);
      const isUnknown = row.costVnd == null || row.costSource === "unknown";
      const isEstimated = row.costSource === "estimated";
      const isCached = row.status === "cached";

      if (row.contentId) contentIds.add(row.contentId);

      if (isCached) {
        cachedCostEventCount++;
        // Estimate cache savings: a typical TTS request is ~10 points on average (conservative)
        cacheSavingsVnd += safeNum(row.usageAmount) * settings.aimaxVndPerPoint;
      } else if (isUnknown) {
        unknownCostEventCount++;
      } else if (isEstimated) {
        estimatedCostVnd += vnd;
        totalCostVnd += vnd;
      } else {
        knownCostVnd += vnd;
        totalCostVnd += vnd;
      }

      if (!isUnknown && !isCached) {
        if (row.costType === "tts")                                   ttsCostVnd += vnd;
        else if (row.costType === "image" || row.costType === "image_prompt") imageCostVnd += vnd;
        else if (["script", "hook", "topic", "llm"].includes(row.costType ?? "")) contentCostVnd += vnd;

        incMap(typeMap, row.costType, vnd);
        incMap(providerMap, row.provider, vnd);
        incMap(routeMap, row.pipelineRoute ?? "unknown", vnd);
        incMap(nicheMap, row.nicheName ?? "unknown", vnd);
        const day = row.createdAt.toISOString().slice(0, 10);
        incMap(dayMap, day, vnd);
      }
    }

    const videosWithCost = contentIds.size;
    return {
      ok: true,
      data: {
        totalCostVnd,
        knownCostVnd,
        estimatedCostVnd,
        unknownCostEventCount,
        cachedCostEventCount,
        totalVideosWithCost: videosWithCost,
        averageCostPerVideo: videosWithCost > 0 ? Math.round((totalCostVnd / videosWithCost) * 100) / 100 : null,
        ttsCostVnd,
        imageCostVnd,
        contentCostVnd,
        cacheSavingsVnd,
        byCostType: Array.from(typeMap.entries()).map(([costType, v]) => ({ costType, totalVnd: v.totalVnd, eventCount: v.count })).sort((a, b) => b.totalVnd - a.totalVnd),
        byProvider: Array.from(providerMap.entries()).map(([provider, v]) => ({ provider, totalVnd: v.totalVnd, eventCount: v.count })).sort((a, b) => b.totalVnd - a.totalVnd),
        byPipelineRoute: Array.from(routeMap.entries()).map(([route, v]) => ({ route, totalVnd: v.totalVnd, eventCount: v.count })).sort((a, b) => b.totalVnd - a.totalVnd),
        byNiche: Array.from(nicheMap.entries()).map(([niche, v]) => ({ niche, totalVnd: v.totalVnd, eventCount: v.count })).sort((a, b) => b.totalVnd - a.totalVnd),
        byDay: Array.from(dayMap.entries()).map(([day, v]) => ({ day, totalVnd: v.totalVnd, eventCount: v.count })).sort((a, b) => a.day.localeCompare(b.day)),
        aimaxVndPerPoint: settings.aimaxVndPerPoint,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function listVideoCostBreakdownAction(
  filter: CostDashboardFilter = {},
): Promise<{ ok: true; rows: VideoCostRow[]; total: number } | { ok: false; error: string }> {
  try {
    const where = buildWhere(filter);

    // Aggregate cost events by contentId only — grouping by extra metadata columns
    // would produce multiple rows per video when events carry different metadata values.
    const agg = await db.select({
      contentId:         generationCostEvents.contentId,
      totalCostVnd:      sql<string>`coalesce(sum(case when cost_source != 'unknown' and status != 'cached' then cast(cost_vnd as numeric) else 0 end), 0)`,
      ttsCostVnd:        sql<string>`coalesce(sum(case when cost_type = 'tts' and status != 'cached' then cast(cost_vnd as numeric) else 0 end), 0)`,
      imageCostVnd:      sql<string>`coalesce(sum(case when cost_type in ('image','image_prompt') and status != 'cached' then cast(cost_vnd as numeric) else 0 end), 0)`,
      contentCostVnd:    sql<string>`coalesce(sum(case when cost_type in ('script','hook','topic','llm') and cost_source != 'unknown' then cast(cost_vnd as numeric) else 0 end), 0)`,
      estimatedCostVnd:  sql<string>`coalesce(sum(case when cost_source = 'estimated' then cast(cost_vnd as numeric) else 0 end), 0)`,
      unknownCostCount:  sql<number>`cast(count(*) filter (where cost_vnd is null or cost_source = 'unknown') as int)`,
      eventCount:        sql<number>`cast(count(*) as int)`,
      scriptEventCount:  sql<number>`cast(count(*) filter (where cost_type in ('script','hook','topic','llm')) as int)`,
      imageEventCount:   sql<number>`cast(count(*) filter (where cost_type in ('image','image_prompt')) as int)`,
      minCreatedAt:      sql<Date>`min(created_at)`,
      // Fallback metadata from cost events — used when the content_generations row doesn't exist
      // (e.g. synthetic test data or orphaned cost events).
      eventNicheName:    sql<string | null>`max(niche_name)`,
      eventProfileKey:   sql<string | null>`max(content_profile_key)`,
    })
      .from(generationCostEvents)
      .where(and(where, isNotNull(generationCostEvents.contentId)))
      .groupBy(generationCostEvents.contentId)
      .orderBy(desc(sql`min(created_at)`))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0);

    if (agg.length === 0) return { ok: true, rows: [], total: 0 };

    // Fetch display metadata from content_generations — used as authoritative fallback
    // for niche_name, pipeline_route, etc. when cost events lack these fields (e.g. backfilled rows).
    const ids = agg.map((r) => r.contentId!).filter(Boolean);
    const contents = ids.length > 0
      ? await db.select({
          id:                contentGenerations.id,
          topic:             contentGenerations.topic,
          createdAt:         contentGenerations.createdAt,
          nicheName:         contentGenerations.nicheName,
          contentProfileKey: contentGenerations.contentProfileKey,
          formatType:        contentGenerations.formatType,
          channelKey:        contentGenerations.channelKey,
        })
          .from(contentGenerations)
          .where(inArray(contentGenerations.id, ids))
      : [];
    const contentMap = new Map(contents.map((c) => [c.id, c]));

    // Count total distinct content IDs
    const countResult = await db.select({ total: sql<number>`cast(count(distinct content_id) as int)` })
      .from(generationCostEvents)
      .where(and(where, isNotNull(generationCostEvents.contentId)));
    const total = countResult[0]?.total ?? 0;

    const rows: VideoCostRow[] = agg.map((r) => {
      const cg = contentMap.get(r.contentId!);
      // content_generations is authoritative; fall back to cost-event MAX() for orphaned/synthetic rows.
      const nicheName         = cg?.nicheName         || r.eventNicheName  || null;
      const contentProfileKey = cg?.contentProfileKey || r.eventProfileKey || null;
      const formatType        = cg?.formatType        ?? null;
      // pipelineRoute comes only from cost events (content_generations has no route column)
      return {
        contentId:         r.contentId!,
        topic:             cg?.topic ?? null,
        nicheName,
        contentProfileKey,
        formatType,
        pipelineRoute:     null, // resolved separately below from events
        createdAt:         cg?.createdAt ?? r.minCreatedAt,
        totalCostVnd:      safeNum(r.totalCostVnd),
        ttsCostVnd:        safeNum(r.ttsCostVnd),
        imageCostVnd:      safeNum(r.imageCostVnd),
        contentCostVnd:    safeNum(r.contentCostVnd),
        unknownCostCount:  r.unknownCostCount,
        estimatedCostVnd:  safeNum(r.estimatedCostVnd),
        eventCount:        r.eventCount,
        scriptEventCount:  r.scriptEventCount,
        imageEventCount:   r.imageEventCount,
      };
    });

    // Fetch pipelineRoute from cost events (one query, pick first non-null per contentId).
    // Falls back to formatType → channelKey from content_generations for older rows
    // whose backfilled cost events carry no route metadata.
    if (ids.length > 0) {
      const routeRows = await db.select({
        contentId:    generationCostEvents.contentId,
        pipelineRoute: sql<string | null>`max(pipeline_route)`,
      })
        .from(generationCostEvents)
        .where(and(isNotNull(generationCostEvents.contentId), inArray(generationCostEvents.contentId, ids), isNotNull(generationCostEvents.pipelineRoute)))
        .groupBy(generationCostEvents.contentId);
      const routeMap = new Map(routeRows.map((r) => [r.contentId!, r.pipelineRoute]));
      for (const row of rows) {
        const cg = contentMap.get(row.contentId);
        row.pipelineRoute = routeMap.get(row.contentId) ?? cg?.formatType ?? cg?.channelKey ?? null;
      }
    }

    return { ok: true, rows, total };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getVideoCostDetailAction(
  contentId: string,
): Promise<{ ok: true; events: CostEventDetail[]; topic: string | null; nicheName: string | null } | { ok: false; error: string }> {
  try {
    const [events, content] = await Promise.all([
      db.select({
        id:          generationCostEvents.id,
        provider:    generationCostEvents.provider,
        costType:    generationCostEvents.costType,
        status:      generationCostEvents.status,
        usageUnit:   generationCostEvents.usageUnit,
        usageAmount: generationCostEvents.usageAmount,
        unitCostVnd: generationCostEvents.unitCostVnd,
        costVnd:     generationCostEvents.costVnd,
        costSource:  generationCostEvents.costSource,
        pipelineRoute: generationCostEvents.pipelineRoute,
        sourceTable: generationCostEvents.sourceTable,
        sourceId:    generationCostEvents.sourceId,
        metadata:    generationCostEvents.metadata,
        createdAt:   generationCostEvents.createdAt,
      })
        .from(generationCostEvents)
        .where(eq(generationCostEvents.contentId, contentId))
        .orderBy(desc(generationCostEvents.createdAt)),
      db.select({ topic: contentGenerations.topic, nicheName: contentGenerations.nicheName })
        .from(contentGenerations)
        .where(eq(contentGenerations.id, contentId))
        .limit(1),
    ]);

    return {
      ok: true,
      events: events as CostEventDetail[],
      topic: content[0]?.topic ?? null,
      nicheName: content[0]?.nicheName ?? null,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
