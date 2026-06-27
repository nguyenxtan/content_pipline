/**
 * Topic Family Analytics V1
 *
 * Read-only analytics engine. No DB writes. No publishing pipeline changes.
 *
 * Produces:
 *   - Family performance rankings (avg/median views, retention, trend)
 *   - Auto-classification of unclassified content
 *   - Saturation detection
 *   - scale / maintain / reduce / stop recommendations
 *   - Top 20 longform topic candidates
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { classifyTopic, FAMILY_TAXONOMY, getFamilyLabel, getFamilyEnglishLabel, type ClassificationResult } from "./topic-family-classifier";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawVideoRow {
  contentId: string;
  topic: string;
  topicFamily: string | null;
  publishedAt: Date;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationSeconds: number | null;
  avgViewDurationSec: number | null;
  retentionPct: number | null;
  platformVideoId: string;
  channelId: number | null;
  isLegacy: boolean;  // true when content_id IS NULL (pre-CG pipeline)
}

export interface TopicPerf {
  topic: string;
  contentId: string;
  viewCount: number;
  likeCount: number;
  retentionPct: number | null;
  avgViewDurationSec: number | null;
  publishedAt: Date;
  likeViewRatio: number;
  longformScore: number;
}

export type Trend = "rising" | "stable" | "declining" | "saturated";
export type Recommendation = "scale" | "maintain" | "reduce" | "stop";

export interface FamilyAnalytics {
  family: string;
  label: string;
  englishLabel: string;
  // CG-linked videos only (new pipeline — basis for recommendations)
  cgVideos: number;
  cgAvgViews: number;
  cgMedianViews: number;
  cgP90Views: number;
  cgMaxViews: number;
  cgAvgLikes: number;
  cgLikeViewRatio: number;
  cgAvgRetentionPct: number | null;
  cgAvgViewDurationSec: number | null;
  cgTrend: Trend;
  cgTrendDeltaPct: number;
  cgSaturationScore: number;
  // Combined (CG + legacy) — informational only
  totalVideos: number;
  totalAvgViews: number;
  legacyVideos: number;
  // Decisions based on CG-linked performance
  recommendation: Recommendation;
  longformSuitability: number;
  topTopics: TopicPerf[];
  weakTopics: TopicPerf[];
  autoClassifiedCount: number;
  videosWithRetention: number;
}

export interface UnclassifiedVideo {
  contentId: string;
  topic: string;
  viewCount: number;
  likeCount: number;
  retentionPct: number | null;
  classification: ClassificationResult | null;
}

export interface LongformCandidate {
  rank: number;
  topic: string;
  contentId: string;
  family: string;
  familyLabel: string;
  viewCount: number;
  likeCount: number;
  retentionPct: number | null;
  avgViewDurationSec: number | null;
  longformScore: number;
  scoreBreakdown: {
    viewsSignal: number;
    retentionSignal: number;
    likeSignal: number;
    familySignal: number;
    longformSuitability: number;
  };
  suggestedAngle: string;
  alreadyHasLongform: boolean;
  isLegacy: boolean;
}

export interface EmergingFamily {
  proposedFamily: string;
  label: string;
  videoCount: number;
  avgViews: number;
  representativeTopics: string[];
  rationale: string;
}

export interface AnalyticsReport {
  generatedAt: string;
  totalPublished: number;
  totalViews: number;
  overallAvgViews: number;
  channelCount: number;
  families: FamilyAnalytics[];
  unclassified: UnclassifiedVideo[];
  emergingFamilies: EmergingFamily[];
  top20LongformCandidates: LongformCandidate[];
  plannerRecommendations: PlannerRecommendation[];
}

export interface PlannerRecommendation {
  action: "add_family" | "scale" | "cap" | "stop" | "classify_retroactive";
  family: string;
  reason: string;
  priority: "critical" | "high" | "medium" | "low";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Compute trend: compare first-half avg vs second-half avg for time-sorted videos */
function computeTrend(videos: RawVideoRow[], familySize: number, overallAvg: number): { trend: Trend; deltaPct: number; saturationScore: number } {
  const sorted = [...videos].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
  const half = Math.floor(sorted.length / 2);
  if (sorted.length < 4) {
    return { trend: "stable", deltaPct: 0, saturationScore: 20 };
  }
  const earlyAvg = avg(sorted.slice(0, half).map(v => v.viewCount));
  const recentAvg = avg(sorted.slice(half).map(v => v.viewCount));
  const deltaPct = earlyAvg > 0 ? ((recentAvg - earlyAvg) / earlyAvg) * 100 : 0;

  // Saturation: high volume + declining performance vs channel overall
  const relativePerf = overallAvg > 0 ? recentAvg / overallAvg : 1;
  let saturation = 0;
  if (familySize >= 50) saturation += 40;
  else if (familySize >= 20) saturation += 20;
  else if (familySize >= 10) saturation += 10;
  if (deltaPct < -20) saturation += 30;
  else if (deltaPct < -10) saturation += 15;
  if (relativePerf < 0.4) saturation += 20;
  else if (relativePerf < 0.7) saturation += 10;
  saturation = Math.min(100, saturation);

  let trend: Trend;
  if (saturation >= 60) trend = "saturated";
  else if (deltaPct > 15) trend = "rising";
  else if (deltaPct < -15) trend = "declining";
  else trend = "stable";

  return { trend, deltaPct, saturationScore: saturation };
}

function computeLongformScore(
  video: RawVideoRow,
  allViews: number[],
  overallAvgViews: number,
  familySuitability: number,
): { score: number; breakdown: LongformCandidate["scoreBreakdown"] } {
  const p90 = percentile(allViews, 90);
  const viewsSignal = p90 > 0 ? Math.min(video.viewCount / p90, 1.0) : 0;
  const retentionSignal = video.retentionPct ? Math.min(video.retentionPct / 80, 1.0) : 0.3;
  const likeViewRatio = video.viewCount > 0 ? video.likeCount / video.viewCount : 0;
  const likeSignal = Math.min(likeViewRatio / 0.25, 1.0);
  const familySignal = familySuitability;
  const viewsAboveAvg = overallAvgViews > 0 ? Math.min(video.viewCount / overallAvgViews, 1.5) / 1.5 : 0;
  const combinedViews = (viewsSignal * 0.6 + viewsAboveAvg * 0.4);

  const score = (
    combinedViews        * 0.35 +
    retentionSignal      * 0.25 +
    likeSignal           * 0.15 +
    familySignal         * 0.15 +
    familySuitability    * 0.10
  );

  return {
    score,
    breakdown: {
      viewsSignal: Math.round(combinedViews * 100) / 100,
      retentionSignal: Math.round(retentionSignal * 100) / 100,
      likeSignal: Math.round(likeSignal * 100) / 100,
      familySignal: Math.round(familySignal * 100) / 100,
      longformSuitability: familySuitability,
    },
  };
}

function buildSuggestedAngle(topic: string, family: string): string {
  const angles: Record<string, string> = {
    lo_lang_va_so_hai: `Expand into a 30–45 min arc on the psychology of anxiety: why the mind creates fear, Buddhist acceptance of uncertainty, nighttime worry patterns, and a guided closing reflection.`,
    co_don_ban_sac: `Build a 35–50 min narrative arc: the performance of identity in modern Vietnam, what it costs to live for others' approval, and a Buddhist teaching on self-nature vs social mask.`,
    buong_bo_chua_lanh: `Structure as a healing arc: the weight of what we carry, why forgiveness is not weakness, the Buddhist reframe of release, and a closing meditation on letting go without bitterness.`,
    nhan_qua_nguoi_xau_bao_ung: `Frame as moral psychology: why karma operates through internal cause-and-effect, not divine punishment. Anchor with a real story arc. Avoid retribution-fantasy framing.`,
    tri_tue_song_im_lang_nhan_nhin: `Develop as a wisdom teaching: the power of strategic silence, why restraint is strength, Buddhist non-reaction principles, and a closing on how quiet people change rooms.`,
    binh_yen_an_lac: `Narrate the journey to inner peace: why external control fails, how to return to the present, simple Buddhist practices for calm, and a slow contemplative closing.`,
    vo_thuong: `Explore impermanence through concrete loss stories: how Buddhism teaches us to hold things lightly, the beauty in transience, and a closing on what remains.`,
    tuoi_trung_nien: `Frame as a turning-point meditation: the fear of aging vs the gift of experience, what middle age teaches us that youth cannot, and a Buddhist acceptance of time's passage.`,
    phuoc_bao_nghiep_duyen: `Anchor in lived experience: a concrete story of merit/consequence, not abstract doctrine. Must have a human protagonist and emotional arc to sustain 30+ min.`,
    tinh_yeu_ton_thuong: `Not recommended for longform — emotional arc is too narrow for 30+ min retention in this channel's audience demographic.`,
    gia_dinh_hieu_dao: `Not recommended for longform — consistently lowest performance metrics across all families.`,
  };
  return angles[family] ?? `Expand "${topic}" into a 30–45 min reflective arc with Buddhist framing, personal story anchors, and a meditative closing.`;
}

function deriveRecommendation(
  family: string,
  trend: Trend,
  saturationScore: number,
  avgViews: number,
  overallAvg: number,
): Recommendation {
  const def = FAMILY_TAXONOMY[family];
  if (!def) return "maintain";

  // Hard stop for proven low performers
  if (def.scalability === "stop") return "stop";

  // Saturated family with below-average performance → reduce
  if (trend === "saturated" && avgViews < overallAvg * 0.7) return "reduce";

  // Rising family → scale
  if (trend === "rising" && avgViews > overallAvg * 0.8) return "scale";

  // Explicitly defined scalability if family has good relative perf
  if (def.scalability === "scale" && avgViews > overallAvg * 0.5) return "scale";
  if (def.scalability === "reduce") return "reduce";

  return "maintain";
}

// ─── Main Analytics Function ──────────────────────────────────────────────────

export async function runTopicFamilyAnalytics(): Promise<AnalyticsReport> {
  // 1. Load ALL published YouTube videos (LEFT JOIN to include legacy videos without content_id)
  //    For legacy videos, use pv.title as the topic text.
  //    Exclude very-short clips (<15s) from retention metrics — they inflate % artificially.
  const rows = await db.execute(sql`
    SELECT
      COALESCE(cg.id, pv.id)                AS content_id,
      COALESCE(cg.topic, pv.title)           AS topic,
      cg.topic_family,
      pv.published_at,
      COALESCE(pv.latest_view_count, 0)::int AS view_count,
      COALESCE(pv.latest_like_count, 0)::int AS like_count,
      COALESCE(pv.latest_comment_count,0)::int AS comment_count,
      pv.duration_seconds,
      pv.credential_channel_id              AS channel_id,
      pv.platform_video_id,
      (pv.content_id IS NULL)               AS is_legacy,
      CASE WHEN COALESCE(pv.duration_seconds, 0) >= 15
        THEN ROUND(AVG(vms.avg_view_duration_sec))
        ELSE NULL
      END                                    AS avg_view_duration_sec,
      CASE WHEN COALESCE(pv.duration_seconds, 0) >= 15
        THEN ROUND(AVG(vms.retention_pct::numeric), 1)
        ELSE NULL
      END                                    AS retention_pct
    FROM published_videos pv
    LEFT JOIN content_generations cg ON cg.id = pv.content_id
    LEFT JOIN video_metric_snapshots vms
      ON vms.published_video_id = pv.id
      AND vms.avg_view_duration_sec IS NOT NULL
    WHERE pv.platform = 'youtube'
    GROUP BY
      cg.id, cg.topic, cg.topic_family,
      pv.id, pv.title, pv.published_at,
      pv.latest_view_count, pv.latest_like_count,
      pv.latest_comment_count, pv.duration_seconds,
      pv.credential_channel_id, pv.platform_video_id, pv.content_id
    ORDER BY pv.published_at ASC
  `);

  const videos: RawVideoRow[] = (rows.rows as any[]).map(r => ({
    contentId: r.content_id,
    topic: r.topic ?? "",
    topicFamily: r.topic_family ?? null,
    publishedAt: new Date(r.published_at),
    viewCount: Number(r.view_count) || 0,
    likeCount: Number(r.like_count) || 0,
    commentCount: Number(r.comment_count) || 0,
    durationSeconds: r.duration_seconds ? Number(r.duration_seconds) : null,
    avgViewDurationSec: r.avg_view_duration_sec ? Number(r.avg_view_duration_sec) : null,
    retentionPct: r.retention_pct ? Number(r.retention_pct) : null,
    platformVideoId: r.platform_video_id,
    channelId: r.channel_id ? Number(r.channel_id) : null,
    isLegacy: Boolean(r.is_legacy),
  }));

  const totalPublished = videos.length;
  const totalViews = videos.reduce((s, v) => s + v.viewCount, 0);
  const overallAvgViews = totalPublished > 0 ? totalViews / totalPublished : 0;
  // CG-linked avg (used for recommendation thresholds — not inflated by legacy content)
  const cgLinkedVideos = videos.filter(v => !v.isLegacy);
  const overallCgAvgViews = cgLinkedVideos.length > 0
    ? cgLinkedVideos.reduce((s, v) => s + v.viewCount, 0) / cgLinkedVideos.length
    : overallAvgViews;
  const allViews = videos.map(v => v.viewCount);
  const channels = new Set(videos.map(v => v.channelId).filter(Boolean));

  // Check which content IDs already have longform scripts/audio
  const longformRows = await db.execute(sql`
    SELECT id FROM content_generations
    WHERE long_audio_path IS NOT NULL OR long_video_path IS NOT NULL
  `);
  const longformIds = new Set((longformRows.rows as any[]).map(r => r.id));

  // 2. Auto-classify unclassified videos
  // unclassifiedVideos tracks CG-linked only (for recommendations)
  // Legacy videos are auto-classified for family grouping but not reported as "unclassified"
  const unclassifiedVideos: UnclassifiedVideo[] = [];
  const autoClassMap = new Map<string, string>(); // contentId → classified family

  for (const v of videos) {
    if (!v.topicFamily && v.topic) {
      const cls = classifyTopic(v.topic);
      if (cls) autoClassMap.set(v.contentId, cls.family);

      // Only report CG-linked videos in the unclassified list (legacy handled separately)
      if (!v.isLegacy) {
        unclassifiedVideos.push({
          contentId: v.contentId,
          topic: v.topic,
          viewCount: v.viewCount,
          likeCount: v.likeCount,
          retentionPct: v.retentionPct,
          classification: cls,
        });
      }
    }
  }

  // Effective family assignment (DB family takes precedence; fallback to auto-classified)
  function effectiveFamily(v: RawVideoRow): string | null {
    return v.topicFamily ?? autoClassMap.get(v.contentId) ?? null;
  }

  // 3. Group videos by family
  const familyMap = new Map<string, RawVideoRow[]>();

  for (const v of videos) {
    const fam = effectiveFamily(v);
    if (!fam) continue;
    if (!familyMap.has(fam)) familyMap.set(fam, []);
    familyMap.get(fam)!.push(v);
  }

  // 4. Compute per-family analytics — split CG-linked vs legacy
  const families: FamilyAnalytics[] = [];

  for (const [family, famVideos] of familyMap.entries()) {
    const cgVids = famVideos.filter(v => !v.isLegacy);
    const legacyVids = famVideos.filter(v => v.isLegacy);

    // CG-linked stats (basis for all recommendations)
    const cgViews = cgVids.map(v => v.viewCount);
    const cgLikes = cgVids.map(v => v.likeCount);
    const cgRetVideos = cgVids.filter(v => v.retentionPct !== null);
    const cgAvgRet = cgRetVideos.length > 0 ? avg(cgRetVideos.map(v => v.retentionPct!)) : null;
    const cgAvgDur = cgRetVideos.length > 0 ? avg(cgRetVideos.map(v => v.avgViewDurationSec!).filter(x => x !== null)) : null;
    const cgAvgViews = avg(cgViews);
    const cgAvgLikes = avg(cgLikes);

    // Trend based only on CG-linked videos
    const { trend, deltaPct, saturationScore } = computeTrend(cgVids.length >= 4 ? cgVids : famVideos, cgVids.length || famVideos.length, overallCgAvgViews);
    const recommendation = deriveRecommendation(family, trend, saturationScore, cgAvgViews || avg(famVideos.map(v => v.viewCount)), overallCgAvgViews);

    const def = FAMILY_TAXONOMY[family];
    const longformSuitability = def?.longformSuitability ?? 0.5;

    // Rank topics by longform score (CG-linked preferred, include legacy as informational)
    const cgSortedByScore = cgVids
      .map(v => {
        const { score } = computeLongformScore(v, allViews, overallAvgViews, longformSuitability);
        return {
          topic: v.topic,
          contentId: v.contentId,
          viewCount: v.viewCount,
          likeCount: v.likeCount,
          retentionPct: v.retentionPct,
          avgViewDurationSec: v.avgViewDurationSec,
          publishedAt: v.publishedAt,
          likeViewRatio: v.viewCount > 0 ? v.likeCount / v.viewCount : 0,
          longformScore: score,
        } satisfies TopicPerf;
      })
      .sort((a, b) => b.longformScore - a.longformScore);

    const autoClassifiedInFamily = [...autoClassMap.entries()]
      .filter(([, fam]) => fam === family).length;

    const allViews2 = famVideos.map(v => v.viewCount);

    families.push({
      family,
      label: getFamilyLabel(family),
      englishLabel: getFamilyEnglishLabel(family),
      cgVideos: cgVids.length,
      cgAvgViews: Math.round(cgAvgViews),
      cgMedianViews: Math.round(median(cgViews)),
      cgP90Views: Math.round(percentile(cgViews, 90)),
      cgMaxViews: cgViews.length > 0 ? Math.max(...cgViews) : 0,
      cgAvgLikes: Math.round(cgAvgLikes),
      cgLikeViewRatio: cgAvgViews > 0 ? Math.round((cgAvgLikes / cgAvgViews) * 1000) / 1000 : 0,
      cgAvgRetentionPct: cgAvgRet !== null ? Math.round(cgAvgRet * 10) / 10 : null,
      cgAvgViewDurationSec: cgAvgDur !== null ? Math.round(cgAvgDur) : null,
      cgTrend: trend,
      cgTrendDeltaPct: Math.round(deltaPct * 10) / 10,
      cgSaturationScore: saturationScore,
      totalVideos: famVideos.length,
      totalAvgViews: Math.round(avg(allViews2)),
      legacyVideos: legacyVids.length,
      recommendation,
      longformSuitability,
      topTopics: cgSortedByScore.slice(0, 5),
      weakTopics: cgSortedByScore.slice(-3).reverse(),
      autoClassifiedCount: autoClassifiedInFamily,
      videosWithRetention: cgRetVideos.length,
    });
  }

  // Sort families by CG avg views descending
  families.sort((a, b) => b.cgAvgViews - a.cgAvgViews);

  // 5. Top 20 longform candidates (de-duped by topic)
  const allCandidates: Array<{ video: RawVideoRow; family: string; score: number; breakdown: LongformCandidate["scoreBreakdown"] }> = [];
  const seenTopics = new Set<string>();

  for (const v of videos) {
    const fam = effectiveFamily(v);
    if (!fam) continue;
    const def = FAMILY_TAXONOMY[fam];
    const suitability = def?.longformSuitability ?? 0.5;
    if (suitability < 0.35) continue;  // exclude stop families
    if (!v.topic) continue;

    const normalTopic = v.topic.toLowerCase().trim();
    if (seenTopics.has(normalTopic)) continue;
    seenTopics.add(normalTopic);

    const { score, breakdown } = computeLongformScore(v, allViews, overallAvgViews, suitability);
    // Legacy videos (content_id=null) have lower longform suitability: they're from a different pipeline
    const adjustedScore = v.isLegacy ? score * 0.7 : score;
    allCandidates.push({ video: v, family: fam, score: adjustedScore, breakdown });
  }

  allCandidates.sort((a, b) => b.score - a.score);

  const top20: LongformCandidate[] = allCandidates.slice(0, 20).map((c, idx) => ({
    rank: idx + 1,
    topic: c.video.topic,
    contentId: c.video.contentId,
    family: c.family,
    familyLabel: getFamilyLabel(c.family),
    viewCount: c.video.viewCount,
    likeCount: c.video.likeCount,
    retentionPct: c.video.retentionPct,
    avgViewDurationSec: c.video.avgViewDurationSec,
    longformScore: Math.round(c.score * 1000) / 1000,
    scoreBreakdown: c.breakdown,
    suggestedAngle: buildSuggestedAngle(c.video.topic, c.family),
    alreadyHasLongform: longformIds.has(c.video.contentId),
    isLegacy: c.video.isLegacy,
  }));

  // 6. Emerging families (clusters in unclassified auto-classified into new families)
  const emergingCounts = new Map<string, { videos: UnclassifiedVideo[]; totalViews: number }>();
  for (const uv of unclassifiedVideos) {
    if (!uv.classification) continue;
    const fam = uv.classification.family;
    // Only count families not yet in DB as topicFamily for any classified video
    const inDb = videos.some(v => v.topicFamily === fam);
    if (inDb) continue;  // Already an official family
    if (!emergingCounts.has(fam)) emergingCounts.set(fam, { videos: [], totalViews: 0 });
    emergingCounts.get(fam)!.videos.push(uv);
    emergingCounts.get(fam)!.totalViews += uv.viewCount;
  }

  const emergingFamilies: EmergingFamily[] = [];
  for (const [fam, data] of emergingCounts.entries()) {
    if (data.videos.length < 2) continue;
    const def = FAMILY_TAXONOMY[fam];
    emergingFamilies.push({
      proposedFamily: fam,
      label: def?.label ?? fam,
      videoCount: data.videos.length,
      avgViews: Math.round(data.totalViews / data.videos.length),
      representativeTopics: data.videos
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 5)
        .map(v => v.topic),
      rationale: `${data.videos.length} unclassified videos auto-classified here, avg ${Math.round(data.totalViews / data.videos.length)} views — above channel mean.`,
    });
  }
  emergingFamilies.sort((a, b) => b.avgViews - a.avgViews);

  // 7. Planner recommendations
  const plannerRecs: PlannerRecommendation[] = [];

  // New families that should be created
  for (const ef of emergingFamilies) {
    if (ef.avgViews > overallCgAvgViews * 0.6 && ef.videoCount >= 2) {
      plannerRecs.push({
        action: "add_family",
        family: ef.proposedFamily,
        reason: `${ef.videoCount} unclassified CG videos avg ${ef.avgViews}v (CG avg: ${Math.round(overallCgAvgViews)}). Add to taxonomy and classify retroactively.`,
        priority: ef.avgViews > overallCgAvgViews ? "high" : "medium",
      });
    }
  }

  for (const f of families) {
    if (f.recommendation === "scale" && f.cgAvgViews > overallCgAvgViews * 0.8) {
      plannerRecs.push({
        action: "scale",
        family: f.family,
        reason: `CG avg ${f.cgAvgViews}v (${Math.round((f.cgAvgViews/overallCgAvgViews)*100)}% of CG channel avg ${Math.round(overallCgAvgViews)}), trend: ${f.cgTrend}. Prioritize in longform queue.`,
        priority: f.cgAvgViews > overallCgAvgViews * 1.5 ? "critical" : "high",
      });
    }
    if (f.recommendation === "stop" && f.cgVideos > 0) {
      plannerRecs.push({
        action: "stop",
        family: f.family,
        reason: `CG avg ${f.cgAvgViews}v (${Math.round((f.cgAvgViews/overallCgAvgViews)*100)}% of CG avg). New pipeline underperforms here — stop generating longform.`,
        priority: "medium",
      });
    }
    if (f.cgSaturationScore >= 50 && f.recommendation === "reduce") {
      plannerRecs.push({
        action: "cap",
        family: f.family,
        reason: `Saturation ${f.cgSaturationScore}/100. ${f.cgVideos} CG videos, trend ${f.cgTrend} (${f.cgTrendDeltaPct > 0 ? '+' : ''}${f.cgTrendDeltaPct}%). Cap at 1 longform/month.`,
        priority: "medium",
      });
    }
  }

  // Retroactive classification recommendation for unclassified high-performers
  const highPerfUnclassified = unclassifiedVideos.filter(v => !v.classification && v.viewCount > overallCgAvgViews * 1.2);
  const highPerfClassified = unclassifiedVideos.filter(v => v.classification && v.viewCount > overallCgAvgViews * 1.0);
  if (highPerfClassified.length > 0) {
    plannerRecs.push({
      action: "classify_retroactive",
      family: "co_don_ban_sac",
      reason: `${highPerfClassified.length} unclassified CG videos with avg ${Math.round(avg(highPerfClassified.map(v=>v.viewCount)))}v auto-classified — update DB topic_family to formalize these assignments.`,
      priority: "high",
    });
  }
  if (highPerfUnclassified.length > 0) {
    plannerRecs.push({
      action: "classify_retroactive",
      family: "(review manually)",
      reason: `${highPerfUnclassified.length} high-view CG videos could not be auto-classified (avg ${Math.round(avg(highPerfUnclassified.map(v=>v.viewCount)))}v). Needs manual review.`,
      priority: "medium",
    });
  }

  // Sort planner recs by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  plannerRecs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    generatedAt: new Date().toISOString(),
    totalPublished,
    totalViews,
    overallAvgViews: Math.round(overallAvgViews),
    channelCount: channels.size,
    families,
    unclassified: unclassifiedVideos.sort((a, b) => b.viewCount - a.viewCount),
    emergingFamilies,
    top20LongformCandidates: top20,
    plannerRecommendations: plannerRecs,
  };
}
