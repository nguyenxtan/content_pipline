"use server";

import { db } from "@/lib/db";
import { ttsJobs } from "@/lib/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

export type AiMaxUsageFilter = {
  dateFrom?: string | null;  // ISO date string
  dateTo?: string | null;
  pipelineRoute?: string | null;
  status?: string | null;
  voiceId?: string | null;
  voiceFamily?: string | null;
  contentId?: string | null;
  cacheHit?: boolean | null;
  usageSource?: string | null;
  limit?: number;
  offset?: number;
};

export type AiMaxUsageRow = {
  id: string;
  externalJobId: string;
  pipelineRoute: string | null;
  contentId: string | null;
  voiceId: string | null;
  voiceLabel: string | null;
  voiceFamily: string | null;
  status: string;
  cacheHit: boolean | null;
  usageSource: string | null;
  creditUsed: string | null;
  estimatedCredits: string | null;
  textCharCount: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  speed: string | null;
  pitch: string | null;
  cacheIdentity: string | null;
  textHash: string | null;
  nicheName: string | null;
  formatType: string | null;
  contentProfileKey: string | null;
};

export type AiMaxUsageSummary = {
  totalRequests: number;
  networkRequests: number;
  cacheHits: number;
  failedRequests: number;
  totalChars: number;
  totalCredits: number | null;
  totalEstimatedCredits: number | null;
  totalDurationMs: number;
  avgDurationMs: number | null;
  byPipelineRoute: Array<{ route: string; count: number; chars: number; credits: number | null }>;
  byVoiceFamily: Array<{ family: string; count: number; chars: number }>;
  byStatus: Array<{ status: string; count: number }>;
  byDay: Array<{ day: string; count: number; chars: number; credits: number | null }>;
};

function buildWhereConditions(filter: AiMaxUsageFilter) {
  const conditions = [eq(ttsJobs.provider, "aimax")];
  if (filter.dateFrom) {
    conditions.push(gte(ttsJobs.createdAt, new Date(filter.dateFrom)));
  }
  if (filter.dateTo) {
    const end = new Date(filter.dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(ttsJobs.createdAt, end));
  }
  if (filter.pipelineRoute) conditions.push(eq(ttsJobs.pipelineRoute, filter.pipelineRoute));
  if (filter.status) conditions.push(eq(ttsJobs.status, filter.status));
  if (filter.voiceId) conditions.push(eq(ttsJobs.voiceId, filter.voiceId));
  if (filter.voiceFamily) conditions.push(eq(ttsJobs.voiceFamily, filter.voiceFamily));
  if (filter.contentId) conditions.push(eq(ttsJobs.contentId, filter.contentId));
  if (filter.cacheHit != null) conditions.push(eq(ttsJobs.cacheHit, filter.cacheHit));
  if (filter.usageSource) conditions.push(eq(ttsJobs.usageSource, filter.usageSource));
  return and(...conditions);
}

function safeNumber(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isMissingTableError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes("tts_jobs") && (msg.includes("does not exist") || msg.includes("undefined_table"));
}

export async function getAiMaxUsageSummaryAction(
  filter: AiMaxUsageFilter = {},
): Promise<{ ok: true; data: AiMaxUsageSummary } | { ok: false; error: string }> {
  try {
    const where = buildWhereConditions(filter);

    const rows = await db.select({
      status: ttsJobs.status,
      cacheHit: ttsJobs.cacheHit,
      creditUsed: ttsJobs.creditUsed,
      estimatedCredits: ttsJobs.estimatedCredits,
      textCharCount: ttsJobs.textCharCount,
      durationMs: ttsJobs.durationMs,
      pipelineRoute: ttsJobs.pipelineRoute,
      voiceFamily: ttsJobs.voiceFamily,
      createdAt: ttsJobs.createdAt,
    }).from(ttsJobs).where(where);

    let totalRequests = 0;
    let networkRequests = 0;
    let cacheHits = 0;
    let failedRequests = 0;
    let totalChars = 0;
    let totalCredits = 0;
    let totalEstimatedCredits = 0;
    let totalDurationMs = 0;
    let hasCredits = false;
    let hasEstimated = false;

    const routeMap = new Map<string, { count: number; chars: number; credits: number }>();
    const familyMap = new Map<string, { count: number; chars: number }>();
    const statusMap = new Map<string, number>();
    const dayMap = new Map<string, { count: number; chars: number; credits: number }>();

    for (const row of rows) {
      totalRequests++;
      if (row.cacheHit) cacheHits++;
      else networkRequests++;
      if (row.status === "failed" || row.status === "cancelled") failedRequests++;

      const chars = row.textCharCount ?? 0;
      totalChars += chars;

      const credits = safeNumber(row.creditUsed);
      if (credits != null) { totalCredits += credits; hasCredits = true; }

      const est = safeNumber(row.estimatedCredits);
      if (est != null) { totalEstimatedCredits += est; hasEstimated = true; }

      totalDurationMs += row.durationMs ?? 0;

      // by route
      const route = row.pipelineRoute ?? "unknown";
      const r = routeMap.get(route) ?? { count: 0, chars: 0, credits: 0 };
      r.count++;
      r.chars += chars;
      r.credits += credits ?? 0;
      routeMap.set(route, r);

      // by voice family
      const family = row.voiceFamily ?? "unknown";
      const f = familyMap.get(family) ?? { count: 0, chars: 0 };
      f.count++;
      f.chars += chars;
      familyMap.set(family, f);

      // by status
      statusMap.set(row.status, (statusMap.get(row.status) ?? 0) + 1);

      // by day
      const day = row.createdAt.toISOString().slice(0, 10);
      const d = dayMap.get(day) ?? { count: 0, chars: 0, credits: 0 };
      d.count++;
      d.chars += chars;
      d.credits += credits ?? 0;
      dayMap.set(day, d);
    }

    return {
      ok: true,
      data: {
        totalRequests,
        networkRequests,
        cacheHits,
        failedRequests,
        totalChars,
        totalCredits: hasCredits ? totalCredits : null,
        totalEstimatedCredits: hasEstimated ? totalEstimatedCredits : null,
        totalDurationMs,
        avgDurationMs: totalRequests > 0 ? Math.round(totalDurationMs / totalRequests) : null,
        byPipelineRoute: Array.from(routeMap.entries())
          .map(([route, v]) => ({ route, count: v.count, chars: v.chars, credits: hasCredits ? v.credits : null }))
          .sort((a, b) => b.count - a.count),
        byVoiceFamily: Array.from(familyMap.entries())
          .map(([family, v]) => ({ family, count: v.count, chars: v.chars }))
          .sort((a, b) => b.count - a.count),
        byStatus: Array.from(statusMap.entries())
          .map(([status, count]) => ({ status, count }))
          .sort((a, b) => b.count - a.count),
        byDay: Array.from(dayMap.entries())
          .map(([day, v]) => ({ day, count: v.count, chars: v.chars, credits: hasCredits ? v.credits : null }))
          .sort((a, b) => a.day.localeCompare(b.day)),
      },
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { ok: false, error: "TTS usage tracking table is not ready. Please apply the TTS provider migration (drizzle/0039_tts_provider_tables.sql)." };
    }
    return { ok: false, error: String(err) };
  }
}

export async function listAiMaxUsageRequestsAction(
  filter: AiMaxUsageFilter = {},
): Promise<{ ok: true; rows: AiMaxUsageRow[]; total: number } | { ok: false; error: string }> {
  try {
    const where = buildWhereConditions(filter);
    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = filter.offset ?? 0;

    const [rows, countResult] = await Promise.all([
      db.select({
        id: ttsJobs.id,
        externalJobId: ttsJobs.externalJobId,
        pipelineRoute: ttsJobs.pipelineRoute,
        contentId: ttsJobs.contentId,
        voiceId: ttsJobs.voiceId,
        voiceLabel: ttsJobs.voiceLabel,
        voiceFamily: ttsJobs.voiceFamily,
        status: ttsJobs.status,
        cacheHit: ttsJobs.cacheHit,
        usageSource: ttsJobs.usageSource,
        creditUsed: ttsJobs.creditUsed,
        estimatedCredits: ttsJobs.estimatedCredits,
        textCharCount: ttsJobs.textCharCount,
        durationMs: ttsJobs.durationMs,
        errorMessage: ttsJobs.errorMessage,
        startedAt: ttsJobs.startedAt,
        completedAt: ttsJobs.completedAt,
        createdAt: ttsJobs.createdAt,
        speed: ttsJobs.speed,
        pitch: ttsJobs.pitch,
        cacheIdentity: ttsJobs.cacheIdentity,
        textHash: ttsJobs.textHash,
        nicheName: ttsJobs.nicheName,
        formatType: ttsJobs.formatType,
        contentProfileKey: ttsJobs.contentProfileKey,
      })
        .from(ttsJobs)
        .where(where)
        .orderBy(desc(ttsJobs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(ttsJobs)
        .where(where),
    ]);

    return {
      ok: true,
      rows: rows as AiMaxUsageRow[],
      total: countResult[0]?.count ?? 0,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { ok: false, error: "TTS usage tracking table is not ready. Please apply the TTS provider migration." };
    }
    return { ok: false, error: String(err) };
  }
}

export async function getAiMaxUsageRequestDetailAction(
  id: string,
): Promise<{ ok: true; row: AiMaxUsageRow & { audioUrl: string | null; srtUrl: string | null; rawJson: unknown } } | { ok: false; error: string }> {
  try {
    const row = await db.select({
      id: ttsJobs.id,
      externalJobId: ttsJobs.externalJobId,
      pipelineRoute: ttsJobs.pipelineRoute,
      contentId: ttsJobs.contentId,
      voiceId: ttsJobs.voiceId,
      voiceLabel: ttsJobs.voiceLabel,
      voiceFamily: ttsJobs.voiceFamily,
      status: ttsJobs.status,
      cacheHit: ttsJobs.cacheHit,
      usageSource: ttsJobs.usageSource,
      creditUsed: ttsJobs.creditUsed,
      estimatedCredits: ttsJobs.estimatedCredits,
      textCharCount: ttsJobs.textCharCount,
      durationMs: ttsJobs.durationMs,
      errorMessage: ttsJobs.errorMessage,
      startedAt: ttsJobs.startedAt,
      completedAt: ttsJobs.completedAt,
      createdAt: ttsJobs.createdAt,
      speed: ttsJobs.speed,
      pitch: ttsJobs.pitch,
      cacheIdentity: ttsJobs.cacheIdentity,
      textHash: ttsJobs.textHash,
      nicheName: ttsJobs.nicheName,
      formatType: ttsJobs.formatType,
      contentProfileKey: ttsJobs.contentProfileKey,
      audioUrl: ttsJobs.audioUrl,
      srtUrl: ttsJobs.srtUrl,
      rawJson: ttsJobs.rawJson,
    })
      .from(ttsJobs)
      .where(eq(ttsJobs.id, id))
      .limit(1);

    if (!row[0]) return { ok: false, error: "Record not found" };

    // Strip any sensitive fields from rawJson before returning
    let safeRawJson: unknown = null;
    try {
      const raw = row[0].rawJson as Record<string, unknown> | null;
      if (raw && typeof raw === "object") {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { api_key, apiKey, key, token, secret, ...safe } = raw as Record<string, unknown>;
        safeRawJson = safe;
      }
    } catch { /* ignore */ }

    return { ok: true, row: { ...(row[0] as AiMaxUsageRow), audioUrl: row[0].audioUrl, srtUrl: row[0].srtUrl, rawJson: safeRawJson } };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
