"use server";

import { db } from "@/lib/db";
import {
  contentGenerations,
  publishedVideos,
  videoMetricSnapshots,
} from "@/lib/db/schema";
import { eq, desc, and, isNotNull, inArray } from "drizzle-orm";
import {
  type StrategicTopicFamilyId,
  STRATEGIC_FAMILY_DISPLAY,
  inferStrategicTopicFamily,
  normalizeTopicFamily,
} from "@/lib/config/topic-family-registry";

// ─── Core Profile Types ───────────────────────────────────────────────────────

export type ChannelProfile = "tang_sau" | "phat_phap";
export type PlatformFilter = "all" | "youtube" | "facebook" | "tiktok";

export type TopicDestinationProfile = {
  topicKey: string;
  topicLabel: string;
  channelKeys: string[];
  contentProfileKeys: string[];
  platforms: {
    youtube: { accountId: number; displayName: string; handle: string } | null;
    facebook: { accountId: number; displayName: string } | null;
    tiktok: { accountId: number; displayName: string } | null;
  };
};

const TOPIC_DESTINATION_PROFILES: Record<ChannelProfile, TopicDestinationProfile> = {
  phat_phap: {
    topicKey: "phat_phap",
    topicLabel: "Phật pháp",
    channelKeys: ["phat_phap"],
    contentProfileKeys: ["buddhism"],
    platforms: {
      youtube: { accountId: 1, displayName: "Giới Định Tuệ", handle: "@tuegioi_pp" },
      facebook: { accountId: 3, displayName: "Trí Tuệ An Nhiên" },
      tiktok: null,
    },
  },
  tang_sau: {
    topicKey: "tang_sau",
    topicLabel: "Tầng Sâu",
    channelKeys: ["tang_sau"],
    contentProfileKeys: ["philosophy"],
    platforms: {
      youtube: { accountId: 4, displayName: "Tầng Sâu", handle: "@tang_sau" },
      facebook: null,
      tiktok: null,
    },
  },
};

// ─── Analytics Types ──────────────────────────────────────────────────────────

export type DataSufficiency =
  | "too_early"
  | "directional"
  | "human_review"
  | "auto_learning";

export type AgeBadge =
  | "too_early"
  | "early_signal"
  | "first_decision"
  | "stable"
  | "evergreen";

export type TimeWindowMetrics = {
  views24h: number | null;
  views48h: number | null;
  views7d: number | null;
  views30d: number | null;
  ageBadge: AgeBadge;
};

export type FormatPerformanceRow = {
  variant: string;
  displayName: string;
  totalCount: number;
  publishedCount: number;
  totalViews: number;
  avgViews: number;
  totalLikes: number;
  totalComments: number;
  likeViewRatio: number | null;
  views24h: number | null;
  views48h: number | null;
  views7d: number | null;
  views30d: number | null;
  avgRetentionPct: number | null;
  avgViewDurationSec: number | null;
  firstPublishedAt: Date | null;
  latestPublishedAt: Date | null;
  hotfixGroup: string;
  sufficiency: DataSufficiency;
};

export type TopicFamilyRow = {
  family: string;
  displayName: string;
  totalCount: number;
  publishedCount: number;
  totalViews: number;
  avgViews: number;
  topTopics: string[];
  sufficiency: DataSufficiency;
};

export type HookPatternRow = {
  pattern: string;
  displayName: string;
  example: string;
  totalCount: number;
  publishedCount: number;
  totalViews: number;
  avgViews: number;
  sufficiency: DataSufficiency;
};

export type VisualStyleRow = {
  visualMode: string;
  displayName: string;
  totalCount: number;
  publishedCount: number;
  totalViews: number;
  avgViews: number;
  sufficiency: DataSufficiency;
};

export type LineageRow = {
  contentId: string;
  topic: string;
  createdAt: Date;
  variant: string;
  topicFamily: string;
  hookPattern: string;
  visualMode: string;
  hotfixGroup: string;
  published: boolean;
  views: number | null;
};

export type RecommendationItem = {
  level: "info" | "warning" | "positive";
  message: string;
};

export type BuddhistEraRow = {
  era: string;
  eraLabel: string;
  generatedCount: number;
  publishedYoutube: number;
  publishedFacebook: number;
  totalViewsYoutube: number;
  avgViewsYoutube: number;
  medianViewsYoutube: number | null;
  totalLikesYoutube: number;
  avgLikesYoutube: number;
  likeViewRatioYoutube: number | null;
  ctaContaminated: boolean;
  avgRetentionPct: number | null;
  views24hAvg: number | null;
  views48hAvg: number | null;
  views7dAvg: number | null;
  views30dAvg: number | null;
  sufficiency: DataSufficiency;
  // Phase A analytics
  avgShareCount: number | null;
  shareViewRate: number | null;
  avgEstimatedMinutesWatched: number | null;
  totalSubscribersGained: number | null;
  totalSubscribersLost: number | null;
};

export type QualityFlagRow = {
  flag: string;
  displayName: string;
  description: string;
  count: number;
  examples: Array<{ contentId: string; preview: string }>;
};

export type VoiceAudioRow = {
  contentId: string;
  topic: string;
  era: string;
  audioPath: string | null;
  ttsDurationMs: number | null;
  ttsDurationSec: number | null;
  wordCount: number;
  wordsPerMinute: number | null;
  pacingCategory: "too_slow" | "normal" | "fast" | "unknown";
  scriptLengthCategory: "too_short" | "short" | "normal" | "long" | "too_long";
  qualityFlags: string[];
  views: number | null;
  ageBadge: AgeBadge | null;
};

export type CrossPlatformLineageRow = {
  contentId: string;
  topic: string;
  era: string;
  topicFamily: string;
  createdAt: Date;
  youtube: {
    published: boolean;
    publishedAt: Date | null;
    views: number | null;
    likes: number | null;
    retention: number | null;
    ageBadge: AgeBadge | null;
    timeWindow: TimeWindowMetrics | null;
  };
  facebook: {
    published: boolean;
    publishedAt: Date | null;
    views: number | null;
    likes: number | null;
    note: string | null;
  };
  tiktok: {
    configured: false;
  };
};

export type ContentIntelligencePayload = {
  profile: ChannelProfile;
  platformFilter: PlatformFilter;
  topicProfile: TopicDestinationProfile;
  formatPerformance: FormatPerformanceRow[];
  topicFamilyPerformance: TopicFamilyRow[];
  hookPatternPerformance: HookPatternRow[];
  visualStylePerformance: VisualStyleRow[];
  lineage: LineageRow[];
  recommendations: RecommendationItem[];
  summary: {
    totalGenerated: number;
    totalPublished: number;
    totalViews: number;
    firstPublishedAt: Date | null;
    latestPublishedAt: Date | null;
    dataWindowDays: number;
    hasRetentionData: boolean;
    facebookPublished: number;
  };
  buddhistEraPerformance: BuddhistEraRow[];
  qualityFlags: QualityFlagRow[];
  voiceAudioRows: VoiceAudioRow[];
  crossPlatformLineage: CrossPlatformLineageRow[];
};

// ─── Tang Sau Constants ───────────────────────────────────────────────────────

const TANG_SAU_CHANNEL_KEY = "tang_sau";
const TANG_SAU_PLATFORM_ACCOUNT_ID = 4;
const HOTFIX_TEXT_STYLE_PACK = new Date("2026-06-05T15:00:00Z");
const HOTFIX_KINFOLK_FIX = new Date("2026-06-07T08:00:00Z");

const TANG_SAU_VARIANT_DISPLAY_NAMES: Record<string, string> = {
  LEGACY_QUOTE_NO_VOICE_V2: "Short Quote (Classic)",
  LEGACY_QUOTE_KINETIC_TEXT_V1: "Kinetic Text",
  LEGACY_QUOTE_BILINGUAL_MINIMAL_V1: "Bilingual Minimal",
  LEGACY_QUOTE_REFLECTION_V1: "Reflection Card",
  LEGACY_QUOTE_NOTE_LETTER_V1: "Note Letter",
};

const TANG_SAU_VARIANT_VISUAL_MODE: Record<string, string> = {
  LEGACY_QUOTE_NO_VOICE_V2: "ken_burns_image",
  LEGACY_QUOTE_KINETIC_TEXT_V1: "kinetic_typography",
  LEGACY_QUOTE_BILINGUAL_MINIMAL_V1: "bilingual_minimal",
  LEGACY_QUOTE_REFLECTION_V1: "quote_reflection_card",
  LEGACY_QUOTE_NOTE_LETTER_V1: "note_letter_card",
};

const TANG_SAU_VISUAL_MODE_DISPLAY_NAMES: Record<string, string> = {
  ken_burns_image: "Ken Burns (Classic)",
  kinetic_typography: "Kinetic Typography",
  bilingual_minimal: "Bilingual Minimal",
  quote_reflection_card: "Reflection Card",
  note_letter_card: "Note Letter Card",
};

// ─── Tang Sau Topic Family ────────────────────────────────────────────────────

type TangSauTopicFamilyKey =
  | "modern_exhaustion" | "authenticity" | "loneliness_connection"
  | "philosophy_thought" | "identity_validation" | "time_regret"
  | "relationships" | "freedom_independence" | "general";

const TANG_SAU_TOPIC_FAMILY_DISPLAY_NAMES: Record<TangSauTopicFamilyKey, string> = {
  modern_exhaustion: "Kiệt sức hiện đại",
  authenticity: "Chính xác / Bản thân",
  loneliness_connection: "Cô đơn & Kết nối",
  philosophy_thought: "Triết lý & Tư duy",
  identity_validation: "Danh tính & Công nhận",
  time_regret: "Thời gian & Hối tiếc",
  relationships: "Các mối quan hệ",
  freedom_independence: "Tự do & Độc lập",
  general: "Chủ đề chung",
};

const TANG_SAU_TOPIC_KEYWORDS: Array<{ family: TangSauTopicFamilyKey; keywords: string[] }> = [
  { family: "modern_exhaustion", keywords: ["mệt", "chậm", "quá nhiều", "lựa chọn", "khoảng lặng", "không còn", "bận", "mỏi"] },
  { family: "authenticity", keywords: ["thật", "giả", "đóng vai", "chính mình", "bản thân", "vai người", "tự do"] },
  { family: "loneliness_connection", keywords: ["cô đơn", "một mình", "không ai hiểu", "đám đông", "người nói", "kết nối"] },
  { family: "philosophy_thought", keywords: ["triết", "tư duy", "nhìn rõ", "sách", "hiểu", "nhận ra"] },
  { family: "identity_validation", keywords: ["công nhận", "được thấy", "chứng minh", "xứng đáng"] },
  { family: "time_regret", keywords: ["tiếc", "ngày cũ", "ký ức", "đã qua", "nhớ"] },
  { family: "relationships", keywords: ["người kia", "bạn bè", "họ", "người cũ", "ta và"] },
  { family: "freedom_independence", keywords: ["tự do", "buông", "thoát", "không cần", "thôi cần", "giải phóng"] },
];

function inferTangSauTopicFamily(topic: string): TangSauTopicFamilyKey {
  const lower = topic.toLowerCase();
  for (const { family, keywords } of TANG_SAU_TOPIC_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return family;
  }
  return "general";
}

type TangSauHookPatternKey =
  | "có_những_người" | "có_những_ngày" | "có_những" | "càng_lớn"
  | "không_phải_mà_là" | "khi_thôi" | "contrast_irony" | "statement";

const TANG_SAU_HOOK_PATTERN_DISPLAY_NAMES: Record<TangSauHookPatternKey, string> = {
  có_những_người: "Có những người...",
  có_những_ngày: "Có những ngày/đêm...",
  có_những: "Có những...",
  càng_lớn: "Càng lớn / Càng...",
  không_phải_mà_là: "Không phải... mà là...",
  khi_thôi: "Khi thôi...",
  contrast_irony: "Tương phản / Nghịch lý",
  statement: "Câu khẳng định",
};

function inferTangSauHookPattern(shortContent: string): TangSauHookPatternKey {
  const lower = shortContent.trim().toLowerCase();
  if (lower.startsWith("có những người")) return "có_những_người";
  if (lower.startsWith("có những ngày") || lower.startsWith("có những đêm")) return "có_những_ngày";
  if (lower.startsWith("có những")) return "có_những";
  if (lower.startsWith("khi thôi")) return "khi_thôi";
  if (lower.includes("càng lớn") || /càng\s+\w+/.test(lower)) return "càng_lớn";
  if (lower.includes("không phải") && (lower.includes("mà là") || lower.includes("mà lại"))) return "không_phải_mà_là";
  if (lower.includes("không làm") && lower.includes("chỉ")) return "contrast_irony";
  return "statement";
}

// ─── Buddhist (phat_phap) Constants ──────────────────────────────────────────

const PHAT_PHAP_CHANNEL_KEY = "phat_phap";

const BUDDHIST_ERA_LABELS: Record<string, string> = {
  NULL_ERA: "TTS Short (Legacy)",
  LEGACY_QUOTE_NO_VOICE_V2: "Quote No Voice",
  COVER_INTRO_ON: "Cover Intro Short",
  HOOK_V1: "TTS Hook V1 (w/ CTA)",
  HOOK_V2: "TTS Hook V2 (Colorful)",
};

const BUDDHIST_FORMAT_DISPLAY_NAMES: Record<string, string> = {
  tts_short_legacy: "TTS Short (Legacy)",
  quote_no_voice: "Quote No Voice (YouTube)",
  cover_intro: "Cover Intro Short",
  tts_hook_v1: "TTS Hook V1 (w/ CTA)",
  tts_hook_v2: "TTS Hook V2 (Colorful)",
  facebook_reel: "Facebook Reel",
  facebook_quote: "Facebook Quote Post",
};

const BUDDHIST_FORMAT_ERA_LABEL: Record<string, string> = {
  tts_short_legacy: "Legacy Era",
  quote_no_voice: "Quote Era",
  cover_intro: "Cover Era",
  tts_hook_v1: "Hook V1",
  tts_hook_v2: "Hook V2",
  facebook_reel: "Facebook",
  facebook_quote: "Facebook",
};

function inferBuddhistFormat(era: string | null, platform: string): string {
  if (platform === "facebook") {
    return era === "LEGACY_QUOTE_NO_VOICE_V2" ? "facebook_quote" : "facebook_reel";
  }
  switch (era) {
    case "LEGACY_QUOTE_NO_VOICE_V2": return "quote_no_voice";
    case "COVER_INTRO_ON": return "cover_intro";
    case "HOOK_V1": return "tts_hook_v1";
    case "HOOK_V2": return "tts_hook_v2";
    default: return "tts_short_legacy";
  }
}

// ─── Buddhist Topic Family (normalized to strategic registry) ─────────────────

// Thin wrapper kept for call-site compatibility.
// Delegates to the central strategic registry — never returns "general".
function inferBuddhistTopicFamily(topic: string): StrategicTopicFamilyId {
  return inferStrategicTopicFamily(topic);
}

// ─── Buddhist Hook Pattern ────────────────────────────────────────────────────

type BuddhistHookKey =
  | "khong_phai_ma_la" | "nhieu_nguoi_song" | "co_nhung_luc"
  | "cam_giac_bat_luc" | "nguoi_ta_thuong" | "nhieu_khi"
  | "chap_nhan" | "statement";

const BUDDHIST_HOOK_DISPLAY: Record<BuddhistHookKey, string> = {
  khong_phai_ma_la: "Không phải A, mà là B",
  nhieu_nguoi_song: "Nhiều người sống / cả đời...",
  co_nhung_luc: "Có những lúc / buổi...",
  cam_giac_bat_luc: "Cảm giác [bất lực]... ập đến",
  nguoi_ta_thuong: "Người ta thường...",
  nhieu_khi: "Nhiều khi, ta...",
  chap_nhan: "Chấp nhận không phải là...",
  statement: "Câu tường thuật / mở đầu thẳng",
};

function inferBuddhistHookPattern(shortContent: string): BuddhistHookKey {
  const lower = shortContent.trim().toLowerCase();
  if (lower.includes("không phải") && (lower.includes("mà là") || lower.includes("mà lại"))) return "khong_phai_ma_la";
  if (lower.startsWith("nhiều người")) return "nhieu_nguoi_song";
  if (lower.startsWith("có những lúc") || lower.startsWith("có lúc") || lower.startsWith("có những buổi")) return "co_nhung_luc";
  if (lower.startsWith("cảm giác") && lower.includes("ập đến")) return "cam_giac_bat_luc";
  if (lower.startsWith("người ta thường") || lower.startsWith("người ta hay")) return "nguoi_ta_thuong";
  if (lower.startsWith("nhiều khi")) return "nhieu_khi";
  if (lower.includes("chấp nhận") && lower.includes("không phải")) return "chap_nhan";
  return "statement";
}

// ─── Shared Helpers ───────────────────────────────────────────────────────────

function getSufficiency(publishedCount: number): DataSufficiency {
  if (publishedCount < 3) return "too_early";
  if (publishedCount < 10) return "directional";
  if (publishedCount < 25) return "human_review";
  return "auto_learning";
}

function classifyTangSauHotfixGroup(createdAt: Date): string {
  if (createdAt >= HOTFIX_KINFOLK_FIX) return "Post Kinfolk Fix";
  if (createdAt >= HOTFIX_TEXT_STYLE_PACK) return "Post Style Pack";
  return "Pre Style Pack";
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function hasCTA(shortContent: string | null): boolean {
  if (!shortContent) return false;
  const lower = shortContent.toLowerCase();
  return lower.includes("nhấn thích") || lower.includes("theo dõi kênh") || lower.includes("đăng ký");
}

function computeAgeBadge(publishedAt: Date | null, now: Date): AgeBadge {
  if (!publishedAt) return "too_early";
  const ageHours = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
  if (ageHours < 24) return "too_early";
  if (ageHours < 48) return "early_signal";
  if (ageHours < 168) return "first_decision";
  if (ageHours < 720) return "stable";
  return "evergreen";
}

type SnapshotEntry = {
  fetchedAt: Date;
  viewCount: number | null;
  avgViewDurationSec: number | null;
  retentionPct: string | null;
  shareCount: number | null;
  estimatedMinutesWatched: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
};

function computeTimeWindowViews(
  pubVideoId: string,
  publishedAt: Date | null,
  snapshotsByVideoId: Map<string, SnapshotEntry[]>,
): TimeWindowMetrics & { ageBadge: AgeBadge } {
  const now = new Date();
  const ageBadge = computeAgeBadge(publishedAt, now);
  if (!publishedAt) return { views24h: null, views48h: null, views7d: null, views30d: null, ageBadge };
  const snaps = snapshotsByVideoId.get(pubVideoId) ?? [];
  if (snaps.length === 0) return { views24h: null, views48h: null, views7d: null, views30d: null, ageBadge };

  const pubMs = publishedAt.getTime();
  const ms24 = 24 * 3600_000, ms48 = 48 * 3600_000, ms7d = 7 * 86400_000, ms30d = 30 * 86400_000;

  let v24: number | null = null, v48: number | null = null, v7d: number | null = null, v30d: number | null = null;
  let d24 = Infinity, d48 = Infinity, d7d = Infinity, d30d = Infinity;

  for (const snap of snaps) {
    const diff = snap.fetchedAt.getTime() - pubMs;
    if (diff < 0) continue;
    if (diff <= ms24 && diff < d24) { d24 = diff; v24 = snap.viewCount ?? null; }
    if (diff <= ms48 && diff < d48) { d48 = diff; v48 = snap.viewCount ?? null; }
    if (diff <= ms7d && diff < d7d) { d7d = diff; v7d = snap.viewCount ?? null; }
    if (diff <= ms30d && diff < d30d) { d30d = diff; v30d = snap.viewCount ?? null; }
  }

  return { views24h: v24, views48h: v48, views7d: v7d, views30d: v30d, ageBadge };
}

function computeVoiceAudioMetrics(content: {
  shortContent: string;
  ttsDurationMs: number | null;
  audioPath: string | null;
}): Pick<VoiceAudioRow, "wordCount" | "wordsPerMinute" | "pacingCategory" | "scriptLengthCategory" | "qualityFlags"> {
  const wordCount = content.shortContent.trim().split(/\s+/).filter(Boolean).length;
  const durationSec = content.ttsDurationMs && content.ttsDurationMs > 0 ? content.ttsDurationMs / 1000 : null;
  const wpm = durationSec && durationSec > 5 ? Math.round(wordCount / (durationSec / 60)) : null;

  const pacingCategory =
    wpm === null ? "unknown"
    : wpm < 130 ? "too_slow"
    : wpm <= 230 ? "normal"
    : "fast";

  const scriptLengthCategory =
    wordCount < 80 ? "too_short"
    : wordCount < 130 ? "short"
    : wordCount <= 250 ? "normal"
    : wordCount <= 300 ? "long"
    : "too_long";

  const qualityFlags: string[] = [];
  if (pacingCategory === "fast") qualityFlags.push("voice_too_fast");
  if (pacingCategory === "too_slow") qualityFlags.push("voice_too_slow");
  if (scriptLengthCategory === "too_long") qualityFlags.push("script_too_long");
  if (scriptLengthCategory === "too_short") qualityFlags.push("script_too_short");
  if (hasCTA(content.shortContent)) qualityFlags.push("cta_contaminated");

  return { wordCount, wordsPerMinute: wpm, pacingCategory, scriptLengthCategory, qualityFlags };
}

// ─── Main Action ─────────────────────────────────────────────────────────────

export async function getContentIntelligenceAction(
  profile: ChannelProfile = "phat_phap",
  platformFilter: PlatformFilter = "all",
): Promise<ContentIntelligencePayload> {
  try {
    if (profile === "phat_phap") return await computePhatPhapPayload(platformFilter);
    return await computeTangSauPayload(platformFilter);
  } catch (error) {
    console.error("[content-intelligence] Error:", error);
    return buildEmptyPayload(profile, platformFilter);
  }
}

// ─── Tang Sau Payload ─────────────────────────────────────────────────────────

async function computeTangSauPayload(platformFilter: PlatformFilter): Promise<ContentIntelligencePayload> {
  const contents = await db
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      channelKey: contentGenerations.channelKey,
      experimentVariant: contentGenerations.experimentVariant,
      shortContent: contentGenerations.shortContent,
      createdAt: contentGenerations.createdAt,
    })
    .from(contentGenerations)
    .where(eq(contentGenerations.channelKey, TANG_SAU_CHANNEL_KEY))
    .orderBy(desc(contentGenerations.createdAt));

  if (contents.length === 0) return buildEmptyPayload("tang_sau", platformFilter);

  const published = await db
    .select({
      id: publishedVideos.id,
      contentId: publishedVideos.contentId,
      publishedAt: publishedVideos.publishedAt,
      latestViewCount: publishedVideos.latestViewCount,
      latestLikeCount: publishedVideos.latestLikeCount,
      latestCommentCount: publishedVideos.latestCommentCount,
    })
    .from(publishedVideos)
    .where(eq(publishedVideos.platformAccountId, TANG_SAU_PLATFORM_ACCOUNT_ID));

  const publishedIds = published.map((p) => p.id);
  let snapshots: SnapshotEntry[] & { publishedVideoId: string }[] = [];

  if (publishedIds.length > 0) {
    const allSnaps = await db
      .select({
        publishedVideoId: videoMetricSnapshots.publishedVideoId,
        fetchedAt: videoMetricSnapshots.fetchedAt,
        viewCount: videoMetricSnapshots.viewCount,
        avgViewDurationSec: videoMetricSnapshots.avgViewDurationSec,
        retentionPct: videoMetricSnapshots.retentionPct,
        shareCount: videoMetricSnapshots.shareCount,
        estimatedMinutesWatched: videoMetricSnapshots.estimatedMinutesWatched,
        subscribersGained: videoMetricSnapshots.subscribersGained,
        subscribersLost: videoMetricSnapshots.subscribersLost,
      })
      .from(videoMetricSnapshots)
      .where(and(isNotNull(videoMetricSnapshots.publishedVideoId)));
    const idSet = new Set(publishedIds);
    snapshots = (allSnaps.filter((s) => idSet.has(s.publishedVideoId)) as typeof snapshots);
  }

  const publishedByContentId = new Map<
    string,
    { id: string; publishedAt: Date | null; views: number; likes: number; comments: number }
  >();
  for (const p of published) {
    if (p.contentId) {
      publishedByContentId.set(p.contentId, {
        id: p.id, publishedAt: p.publishedAt,
        views: p.latestViewCount ?? 0, likes: p.latestLikeCount ?? 0, comments: p.latestCommentCount ?? 0,
      });
    }
  }

  const snapshotsByVideoId = new Map<string, SnapshotEntry[]>();
  for (const s of snapshots) {
    const arr = snapshotsByVideoId.get(s.publishedVideoId) ?? [];
    arr.push(s);
    snapshotsByVideoId.set(s.publishedVideoId, arr);
  }

  const hasRetentionData = snapshots.some((s) => s.retentionPct !== null && s.retentionPct !== "");

  type VariantAgg = {
    totalCount: number; publishedCount: number; totalViews: number; totalLikes: number; totalComments: number;
    firstPublishedAt: Date | null; latestPublishedAt: Date | null; firstCreatedAt: Date | null;
    timeWindowData: Array<{ views24h: number | null; views48h: number | null; views7d: number | null; views30d: number | null }>;
    retentionPcts: number[]; avgViewDurationSecs: number[];
  };
  const variantMap = new Map<string, VariantAgg>();

  for (const content of contents) {
    const variant = content.experimentVariant ?? "unknown";
    let agg = variantMap.get(variant);
    if (!agg) {
      agg = { totalCount: 0, publishedCount: 0, totalViews: 0, totalLikes: 0, totalComments: 0,
        firstPublishedAt: null, latestPublishedAt: null, firstCreatedAt: null,
        timeWindowData: [], retentionPcts: [], avgViewDurationSecs: [] };
      variantMap.set(variant, agg);
    }
    agg.totalCount++;
    if (!agg.firstCreatedAt || content.createdAt < agg.firstCreatedAt) agg.firstCreatedAt = content.createdAt;
    const pub = publishedByContentId.get(content.id);
    if (pub) {
      agg.publishedCount++; agg.totalViews += pub.views; agg.totalLikes += pub.likes; agg.totalComments += pub.comments;
      if (pub.publishedAt) {
        if (!agg.firstPublishedAt || pub.publishedAt < agg.firstPublishedAt) agg.firstPublishedAt = pub.publishedAt;
        if (!agg.latestPublishedAt || pub.publishedAt > agg.latestPublishedAt) agg.latestPublishedAt = pub.publishedAt;
      }
      const tw = computeTimeWindowViews(pub.id, pub.publishedAt, snapshotsByVideoId);
      agg.timeWindowData.push(tw);
      const snaps = snapshotsByVideoId.get(pub.id);
      if (snaps) {
        for (const snap of snaps) {
          if (snap.retentionPct !== null && snap.retentionPct !== "") {
            const pct = parseFloat(snap.retentionPct);
            if (!isNaN(pct)) agg.retentionPcts.push(pct);
          }
          if (snap.avgViewDurationSec !== null) agg.avgViewDurationSecs.push(snap.avgViewDurationSec);
        }
      }
    }
  }

  const formatPerformance: FormatPerformanceRow[] = [];
  for (const [variant, agg] of variantMap) {
    const avgViews = agg.publishedCount > 0 ? Math.round(agg.totalViews / agg.publishedCount) : 0;
    const likeViewRatio = agg.totalViews > 0 ? (agg.totalLikes / agg.totalViews) * 100 : null;
    const avgRetentionPct = agg.retentionPcts.length > 0 ? agg.retentionPcts.reduce((s, v) => s + v, 0) / agg.retentionPcts.length : null;
    const avgViewDurationSec = agg.avgViewDurationSecs.length > 0 ? Math.round(agg.avgViewDurationSecs.reduce((s, v) => s + v, 0) / agg.avgViewDurationSecs.length) : null;
    const hotfixGroup = agg.firstCreatedAt ? classifyTangSauHotfixGroup(agg.firstCreatedAt) : "Pre Style Pack";

    const valid24 = agg.timeWindowData.filter((d) => d.views24h !== null);
    const valid48 = agg.timeWindowData.filter((d) => d.views48h !== null);
    const valid7d = agg.timeWindowData.filter((d) => d.views7d !== null);
    const valid30d = agg.timeWindowData.filter((d) => d.views30d !== null);
    const avg = (arr: typeof valid24, key: keyof (typeof arr)[0]) =>
      arr.length >= 2 ? Math.round(arr.reduce((s, d) => s + ((d[key] as number) ?? 0), 0) / arr.length) : null;

    formatPerformance.push({
      variant, displayName: TANG_SAU_VARIANT_DISPLAY_NAMES[variant] ?? variant,
      totalCount: agg.totalCount, publishedCount: agg.publishedCount, totalViews: agg.totalViews, avgViews,
      totalLikes: agg.totalLikes, totalComments: agg.totalComments, likeViewRatio,
      views24h: avg(valid24, "views24h"), views48h: avg(valid48, "views48h"),
      views7d: avg(valid7d, "views7d"), views30d: avg(valid30d, "views30d"),
      avgRetentionPct, avgViewDurationSec,
      firstPublishedAt: agg.firstPublishedAt, latestPublishedAt: agg.latestPublishedAt,
      hotfixGroup, sufficiency: getSufficiency(agg.publishedCount),
    });
  }
  formatPerformance.sort((a, b) => b.totalViews - a.totalViews);

  type TopicFamilyAgg = { totalCount: number; publishedCount: number; totalViews: number; topics: string[] };
  const topicFamilyMap = new Map<TangSauTopicFamilyKey, TopicFamilyAgg>();
  for (const content of contents) {
    const family = inferTangSauTopicFamily(content.topic);
    let agg = topicFamilyMap.get(family);
    if (!agg) { agg = { totalCount: 0, publishedCount: 0, totalViews: 0, topics: [] }; topicFamilyMap.set(family, agg); }
    agg.totalCount++; agg.topics.push(content.topic);
    const pub = publishedByContentId.get(content.id);
    if (pub) { agg.publishedCount++; agg.totalViews += pub.views; }
  }
  const topicFamilyPerformance: TopicFamilyRow[] = [];
  for (const [family, agg] of topicFamilyMap) {
    const avgViews = agg.publishedCount > 0 ? Math.round(agg.totalViews / agg.publishedCount) : 0;
    topicFamilyPerformance.push({
      family, displayName: TANG_SAU_TOPIC_FAMILY_DISPLAY_NAMES[family], totalCount: agg.totalCount,
      publishedCount: agg.publishedCount, totalViews: agg.totalViews, avgViews,
      topTopics: [...new Set(agg.topics)].slice(0, 3), sufficiency: getSufficiency(agg.publishedCount),
    });
  }
  topicFamilyPerformance.sort((a, b) => b.totalViews - a.totalViews);

  type HookPatternAgg = { totalCount: number; publishedCount: number; totalViews: number; exampleContent: string };
  const hookPatternMap = new Map<TangSauHookPatternKey, HookPatternAgg>();
  for (const content of contents) {
    const pattern = inferTangSauHookPattern(content.shortContent ?? "");
    let agg = hookPatternMap.get(pattern);
    if (!agg) { agg = { totalCount: 0, publishedCount: 0, totalViews: 0, exampleContent: content.shortContent ?? "" }; hookPatternMap.set(pattern, agg); }
    agg.totalCount++;
    const pub = publishedByContentId.get(content.id);
    if (pub) { agg.publishedCount++; agg.totalViews += pub.views; }
  }
  const hookPatternPerformance: HookPatternRow[] = [];
  for (const [pattern, agg] of hookPatternMap) {
    const avgViews = agg.publishedCount > 0 ? Math.round(agg.totalViews / agg.publishedCount) : 0;
    hookPatternPerformance.push({
      pattern, displayName: TANG_SAU_HOOK_PATTERN_DISPLAY_NAMES[pattern],
      example: agg.exampleContent.slice(0, 80) + (agg.exampleContent.length > 80 ? "..." : ""),
      totalCount: agg.totalCount, publishedCount: agg.publishedCount, totalViews: agg.totalViews, avgViews,
      sufficiency: getSufficiency(agg.publishedCount),
    });
  }
  hookPatternPerformance.sort((a, b) => b.totalViews - a.totalViews);

  type VisualStyleAgg = { totalCount: number; publishedCount: number; totalViews: number };
  const visualStyleMap = new Map<string, VisualStyleAgg>();
  for (const content of contents) {
    const variant = content.experimentVariant ?? "unknown";
    const visualMode = TANG_SAU_VARIANT_VISUAL_MODE[variant] ?? "unknown";
    let agg = visualStyleMap.get(visualMode);
    if (!agg) { agg = { totalCount: 0, publishedCount: 0, totalViews: 0 }; visualStyleMap.set(visualMode, agg); }
    agg.totalCount++;
    const pub = publishedByContentId.get(content.id);
    if (pub) { agg.publishedCount++; agg.totalViews += pub.views; }
  }
  const visualStylePerformance: VisualStyleRow[] = [];
  for (const [visualMode, agg] of visualStyleMap) {
    const avgViews = agg.publishedCount > 0 ? Math.round(agg.totalViews / agg.publishedCount) : 0;
    visualStylePerformance.push({
      visualMode, displayName: TANG_SAU_VISUAL_MODE_DISPLAY_NAMES[visualMode] ?? visualMode,
      totalCount: agg.totalCount, publishedCount: agg.publishedCount, totalViews: agg.totalViews,
      avgViews, sufficiency: getSufficiency(agg.publishedCount),
    });
  }
  visualStylePerformance.sort((a, b) => b.totalViews - a.totalViews);

  const lineage: LineageRow[] = contents.slice(0, 50).map((content) => {
    const variant = content.experimentVariant ?? "unknown";
    const pub = publishedByContentId.get(content.id);
    return {
      contentId: content.id, topic: content.topic, createdAt: content.createdAt, variant,
      topicFamily: inferTangSauTopicFamily(content.topic), hookPattern: inferTangSauHookPattern(content.shortContent ?? ""),
      visualMode: TANG_SAU_VARIANT_VISUAL_MODE[variant] ?? "unknown",
      hotfixGroup: classifyTangSauHotfixGroup(content.createdAt), published: !!pub, views: pub ? pub.views : null,
    };
  });

  const allPublishedDates = published.map((p) => p.publishedAt).filter((d): d is Date => d !== null);
  const firstPublishedAt = allPublishedDates.length > 0 ? new Date(Math.min(...allPublishedDates.map((d) => d.getTime()))) : null;
  const latestPublishedAt = allPublishedDates.length > 0 ? new Date(Math.max(...allPublishedDates.map((d) => d.getTime()))) : null;
  const totalViews = published.reduce((sum, p) => sum + (p.latestViewCount ?? 0), 0);
  const dataWindowDays = firstPublishedAt && latestPublishedAt
    ? Math.ceil((latestPublishedAt.getTime() - firstPublishedAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;

  const recommendations: RecommendationItem[] = [];
  const noVoiceRow = formatPerformance.find((r) => r.variant === "LEGACY_QUOTE_NO_VOICE_V2");
  const kineticRow = formatPerformance.find((r) => r.variant === "LEGACY_QUOTE_KINETIC_TEXT_V1");
  const noteLetterRow = formatPerformance.find((r) => r.variant === "LEGACY_QUOTE_NOTE_LETTER_V1");
  if (noVoiceRow && kineticRow && noVoiceRow.avgViews > kineticRow.avgViews * 2) {
    recommendations.push({ level: "positive", message: "Short Quote (Classic) đang dẫn đầu về views, nhưng sample mới quá nhỏ để so sánh công bằng" });
  }
  if (kineticRow && kineticRow.publishedCount < 5) {
    recommendations.push({ level: "warning", message: "Kinetic Text chưa đủ dữ liệu (< 5 video đã đăng)" });
  }
  if (!hasRetentionData) {
    recommendations.push({ level: "info", message: "Chưa có dữ liệu retention — cần kết nối YouTube Analytics API" });
  }
  if (noteLetterRow && noteLetterRow.publishedCount === 0) {
    recommendations.push({ level: "warning", message: "Note Letter Card chưa được đăng lên YouTube" });
  }
  recommendations.push({ level: "info", message: "Đây là chế độ chỉ đọc — không có thay đổi tự động nào" });

  return {
    profile: "tang_sau", platformFilter, topicProfile: TOPIC_DESTINATION_PROFILES.tang_sau,
    formatPerformance, topicFamilyPerformance, hookPatternPerformance, visualStylePerformance,
    lineage, recommendations,
    summary: { totalGenerated: contents.length, totalPublished: published.length, totalViews, firstPublishedAt, latestPublishedAt, dataWindowDays, hasRetentionData, facebookPublished: 0 },
    buddhistEraPerformance: [], qualityFlags: [], voiceAudioRows: [], crossPlatformLineage: [],
  };
}

// ─── Buddhist (phat_phap) Payload ─────────────────────────────────────────────

async function computePhatPhapPayload(platformFilter: PlatformFilter): Promise<ContentIntelligencePayload> {
  const contents = await db
    .select({
      id: contentGenerations.id,
      topic: contentGenerations.topic,
      channelKey: contentGenerations.channelKey,
      experimentVariant: contentGenerations.experimentVariant,
      shortContent: contentGenerations.shortContent,
      audioPath: contentGenerations.audioPath,
      ttsDurationMs: contentGenerations.ttsDurationMs,
      createdAt: contentGenerations.createdAt,
      topicFamily: contentGenerations.topicFamily,
    })
    .from(contentGenerations)
    .where(eq(contentGenerations.channelKey, PHAT_PHAP_CHANNEL_KEY))
    .orderBy(desc(contentGenerations.createdAt));

  if (contents.length === 0) return buildEmptyPayload("phat_phap", platformFilter);

  const contentIds = contents.map((c) => c.id);

  const published = await db
    .select({
      id: publishedVideos.id,
      contentId: publishedVideos.contentId,
      platform: publishedVideos.platform,
      publishedAt: publishedVideos.publishedAt,
      latestViewCount: publishedVideos.latestViewCount,
      latestLikeCount: publishedVideos.latestLikeCount,
      latestCommentCount: publishedVideos.latestCommentCount,
    })
    .from(publishedVideos)
    .where(inArray(publishedVideos.contentId, contentIds));

  const publishedIds = published.map((p) => p.id);
  let snapshots: (SnapshotEntry & { publishedVideoId: string })[] = [];

  if (publishedIds.length > 0) {
    const allSnaps = await db
      .select({
        publishedVideoId: videoMetricSnapshots.publishedVideoId,
        fetchedAt: videoMetricSnapshots.fetchedAt,
        viewCount: videoMetricSnapshots.viewCount,
        avgViewDurationSec: videoMetricSnapshots.avgViewDurationSec,
        retentionPct: videoMetricSnapshots.retentionPct,
        shareCount: videoMetricSnapshots.shareCount,
        estimatedMinutesWatched: videoMetricSnapshots.estimatedMinutesWatched,
        subscribersGained: videoMetricSnapshots.subscribersGained,
        subscribersLost: videoMetricSnapshots.subscribersLost,
      })
      .from(videoMetricSnapshots)
      .where(and(isNotNull(videoMetricSnapshots.publishedVideoId)));
    const idSet = new Set(publishedIds);
    snapshots = allSnaps.filter((s) => idSet.has(s.publishedVideoId)) as typeof snapshots;
  }

  // ─── Build lookup maps ─────────────────────────────────────────────────────

  const publishedYouTubeByContentId = new Map<
    string,
    { id: string; publishedAt: Date | null; views: number; likes: number; comments: number }
  >();
  const publishedFacebookByContentId = new Map<
    string,
    { id: string; publishedAt: Date | null; views: number | null; likes: number | null }
  >();

  for (const p of published) {
    if (!p.contentId) continue;
    if (p.platform === "youtube") {
      const ex = publishedYouTubeByContentId.get(p.contentId);
      if (!ex || (p.publishedAt && ex.publishedAt && p.publishedAt > ex.publishedAt)) {
        publishedYouTubeByContentId.set(p.contentId, {
          id: p.id, publishedAt: p.publishedAt,
          views: p.latestViewCount ?? 0, likes: p.latestLikeCount ?? 0, comments: p.latestCommentCount ?? 0,
        });
      }
    } else if (p.platform === "facebook") {
      const ex = publishedFacebookByContentId.get(p.contentId);
      if (!ex || (p.publishedAt && ex.publishedAt && p.publishedAt > ex.publishedAt)) {
        publishedFacebookByContentId.set(p.contentId, {
          id: p.id, publishedAt: p.publishedAt,
          views: p.latestViewCount ?? null, likes: p.latestLikeCount ?? null,
        });
      }
    }
  }

  const snapshotsByVideoId = new Map<string, SnapshotEntry[]>();
  for (const s of snapshots) {
    const arr = snapshotsByVideoId.get(s.publishedVideoId) ?? [];
    arr.push(s);
    snapshotsByVideoId.set(s.publishedVideoId, arr);
  }

  const hasRetentionData = snapshots.some((s) => s.retentionPct !== null && s.retentionPct !== "");
  const contentEraMap = new Map<string, string>();
  for (const c of contents) contentEraMap.set(c.id, c.experimentVariant ?? "NULL_ERA");

  // ─── Era Performance ───────────────────────────────────────────────────────

  const ERA_KEYS = ["NULL_ERA", "LEGACY_QUOTE_NO_VOICE_V2", "COVER_INTRO_ON", "HOOK_V1", "HOOK_V2"];
  type EraAgg = {
    generatedCount: number;
    youtubeViews: number[]; youtubeLikes: number[]; youtubePublishedIds: string[];
    facebookCount: number; ctaContaminated: boolean; retentionPcts: number[];
    timeWindowViews24: number[]; timeWindowViews48: number[]; timeWindowViews7d: number[]; timeWindowViews30d: number[];
    shareCounts: number[]; estimatedMinutesWatched: number[];
    subscribersGained: number; subscribersLost: number;
  };

  const eraAggMap = new Map<string, EraAgg>();
  for (const key of ERA_KEYS) {
    eraAggMap.set(key, {
      generatedCount: 0, youtubeViews: [], youtubeLikes: [], youtubePublishedIds: [],
      facebookCount: 0, ctaContaminated: false, retentionPcts: [],
      timeWindowViews24: [], timeWindowViews48: [], timeWindowViews7d: [], timeWindowViews30d: [],
      shareCounts: [], estimatedMinutesWatched: [], subscribersGained: 0, subscribersLost: 0,
    });
  }

  for (const content of contents) {
    const era = content.experimentVariant ?? "NULL_ERA";
    if (!eraAggMap.has(era)) {
      eraAggMap.set(era, {
        generatedCount: 0, youtubeViews: [], youtubeLikes: [], youtubePublishedIds: [],
        facebookCount: 0, ctaContaminated: false, retentionPcts: [],
        timeWindowViews24: [], timeWindowViews48: [], timeWindowViews7d: [], timeWindowViews30d: [],
        shareCounts: [], estimatedMinutesWatched: [], subscribersGained: 0, subscribersLost: 0,
      });
    }
    const agg = eraAggMap.get(era)!;
    agg.generatedCount++;
    if (hasCTA(content.shortContent)) agg.ctaContaminated = true;
  }

  for (const p of published) {
    if (!p.contentId) continue;
    const era = contentEraMap.get(p.contentId) ?? "NULL_ERA";
    const agg = eraAggMap.get(era);
    if (!agg) continue;
    if (p.platform === "youtube") {
      agg.youtubeViews.push(p.latestViewCount ?? 0);
      agg.youtubeLikes.push(p.latestLikeCount ?? 0);
      agg.youtubePublishedIds.push(p.id);
      const tw = computeTimeWindowViews(p.id, p.publishedAt, snapshotsByVideoId);
      if (tw.views24h !== null) agg.timeWindowViews24.push(tw.views24h);
      if (tw.views48h !== null) agg.timeWindowViews48.push(tw.views48h);
      if (tw.views7d !== null) agg.timeWindowViews7d.push(tw.views7d);
      if (tw.views30d !== null) agg.timeWindowViews30d.push(tw.views30d);
      const snaps = snapshotsByVideoId.get(p.id);
      if (snaps) {
        for (const snap of snaps) {
          if (snap.retentionPct !== null && snap.retentionPct !== "") {
            const pct = parseFloat(snap.retentionPct);
            if (!isNaN(pct)) agg.retentionPcts.push(pct);
          }
          if (snap.shareCount !== null && snap.shareCount >= 0) agg.shareCounts.push(snap.shareCount);
          if (snap.estimatedMinutesWatched !== null && snap.estimatedMinutesWatched > 0) agg.estimatedMinutesWatched.push(snap.estimatedMinutesWatched);
          if (snap.subscribersGained !== null) agg.subscribersGained += snap.subscribersGained;
          if (snap.subscribersLost !== null) agg.subscribersLost += snap.subscribersLost;
        }
      }
    } else if (p.platform === "facebook") {
      agg.facebookCount++;
    }
  }

  const avgOrNull = (arr: number[]) => arr.length >= 2 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;

  const buddhistEraPerformance: BuddhistEraRow[] = [];
  for (const [era, agg] of eraAggMap) {
    if (agg.generatedCount === 0) continue;
    const totalViewsYoutube = agg.youtubeViews.reduce((s, v) => s + v, 0);
    const avgViewsYoutube = agg.youtubeViews.length > 0 ? Math.round(totalViewsYoutube / agg.youtubeViews.length) : 0;
    const totalLikesYoutube = agg.youtubeLikes.reduce((s, v) => s + v, 0);
    const avgLikesYoutube = agg.youtubeLikes.length > 0 ? Math.round(totalLikesYoutube / agg.youtubeLikes.length) : 0;
    const likeViewRatioYoutube = totalViewsYoutube > 0 ? (totalLikesYoutube / totalViewsYoutube) * 100 : null;
    const avgRetentionPct = agg.retentionPcts.length > 0 ? agg.retentionPcts.reduce((s, v) => s + v, 0) / agg.retentionPcts.length : null;
    const avgShareCount = agg.shareCounts.length > 0
      ? Math.round(agg.shareCounts.reduce((s, v) => s + v, 0) / agg.shareCounts.length)
      : null;
    const avgEstimatedMinutesWatched = agg.estimatedMinutesWatched.length > 0
      ? Math.round(agg.estimatedMinutesWatched.reduce((s, v) => s + v, 0) / agg.estimatedMinutesWatched.length)
      : null;
    const shareViewRate = avgShareCount !== null && totalViewsYoutube > 0
      ? Number(((avgShareCount / (totalViewsYoutube / agg.youtubeViews.length)) * 100).toFixed(3))
      : null;

    buddhistEraPerformance.push({
      era, eraLabel: BUDDHIST_ERA_LABELS[era] ?? era,
      generatedCount: agg.generatedCount,
      publishedYoutube: agg.youtubeViews.length,
      publishedFacebook: agg.facebookCount,
      totalViewsYoutube, avgViewsYoutube, medianViewsYoutube: computeMedian(agg.youtubeViews),
      totalLikesYoutube, avgLikesYoutube, likeViewRatioYoutube,
      ctaContaminated: agg.ctaContaminated, avgRetentionPct,
      views24hAvg: avgOrNull(agg.timeWindowViews24),
      views48hAvg: avgOrNull(agg.timeWindowViews48),
      views7dAvg: avgOrNull(agg.timeWindowViews7d),
      views30dAvg: avgOrNull(agg.timeWindowViews30d),
      sufficiency: getSufficiency(agg.youtubeViews.length),
      avgShareCount,
      shareViewRate,
      avgEstimatedMinutesWatched,
      totalSubscribersGained: agg.subscribersGained > 0 ? agg.subscribersGained : null,
      totalSubscribersLost: agg.subscribersLost > 0 ? agg.subscribersLost : null,
    });
  }
  buddhistEraPerformance.sort((a, b) => ERA_KEYS.indexOf(b.era) - ERA_KEYS.indexOf(a.era));

  // ─── Format Performance ────────────────────────────────────────────────────

  type FormatAgg = {
    totalCount: number; publishedCount: number; totalViews: number; totalLikes: number; totalComments: number;
    firstPublishedAt: Date | null; latestPublishedAt: Date | null;
  };
  const formatMap = new Map<string, FormatAgg>();

  for (const content of contents) {
    const fmt = inferBuddhistFormat(content.experimentVariant ?? null, "youtube");
    let agg = formatMap.get(fmt);
    if (!agg) { agg = { totalCount: 0, publishedCount: 0, totalViews: 0, totalLikes: 0, totalComments: 0, firstPublishedAt: null, latestPublishedAt: null }; formatMap.set(fmt, agg); }
    agg.totalCount++;
  }

  for (const p of published) {
    if (!p.contentId) continue;
    const era = contentEraMap.get(p.contentId) ?? null;
    const fmt = inferBuddhistFormat(era, p.platform);
    let agg = formatMap.get(fmt);
    if (!agg) { agg = { totalCount: 0, publishedCount: 0, totalViews: 0, totalLikes: 0, totalComments: 0, firstPublishedAt: null, latestPublishedAt: null }; formatMap.set(fmt, agg); }
    if (p.platform === "facebook") agg.totalCount++;
    agg.publishedCount++;
    agg.totalViews += p.latestViewCount ?? 0;
    agg.totalLikes += p.latestLikeCount ?? 0;
    agg.totalComments += p.latestCommentCount ?? 0;
    if (p.publishedAt) {
      if (!agg.firstPublishedAt || p.publishedAt < agg.firstPublishedAt) agg.firstPublishedAt = p.publishedAt;
      if (!agg.latestPublishedAt || p.publishedAt > agg.latestPublishedAt) agg.latestPublishedAt = p.publishedAt;
    }
  }

  const formatPerformance: FormatPerformanceRow[] = [];
  for (const [fmt, agg] of formatMap) {
    const avgViews = agg.publishedCount > 0 ? Math.round(agg.totalViews / agg.publishedCount) : 0;
    const likeViewRatio = agg.totalViews > 0 ? (agg.totalLikes / agg.totalViews) * 100 : null;
    formatPerformance.push({
      variant: fmt, displayName: BUDDHIST_FORMAT_DISPLAY_NAMES[fmt] ?? fmt,
      totalCount: agg.totalCount, publishedCount: agg.publishedCount, totalViews: agg.totalViews, avgViews,
      totalLikes: agg.totalLikes, totalComments: agg.totalComments, likeViewRatio,
      views24h: null, views48h: null, views7d: null, views30d: null,
      avgRetentionPct: null, avgViewDurationSec: null,
      firstPublishedAt: agg.firstPublishedAt, latestPublishedAt: agg.latestPublishedAt,
      hotfixGroup: BUDDHIST_FORMAT_ERA_LABEL[fmt] ?? "Unknown",
      sufficiency: getSufficiency(agg.publishedCount),
    });
  }
  formatPerformance.sort((a, b) => b.totalViews - a.totalViews);

  // ─── Buddhist Topic Family ─────────────────────────────────────────────────

  type TopicAgg = { totalCount: number; publishedCount: number; totalViews: number; topics: string[] };
  const topicFamilyMap = new Map<StrategicTopicFamilyId, TopicAgg>();
  for (const content of contents) {
    const family = content.topicFamily
      ? normalizeTopicFamily(content.topicFamily)
      : inferBuddhistTopicFamily(content.topic);
    let agg = topicFamilyMap.get(family);
    if (!agg) { agg = { totalCount: 0, publishedCount: 0, totalViews: 0, topics: [] }; topicFamilyMap.set(family, agg); }
    agg.totalCount++; agg.topics.push(content.topic);
    const pub = publishedYouTubeByContentId.get(content.id);
    if (pub) { agg.publishedCount++; agg.totalViews += pub.views; }
  }
  const topicFamilyPerformance: TopicFamilyRow[] = [];
  for (const [family, agg] of topicFamilyMap) {
    const avgViews = agg.publishedCount > 0 ? Math.round(agg.totalViews / agg.publishedCount) : 0;
    topicFamilyPerformance.push({
      family, displayName: STRATEGIC_FAMILY_DISPLAY[family] ?? family, totalCount: agg.totalCount,
      publishedCount: agg.publishedCount, totalViews: agg.totalViews, avgViews,
      topTopics: [...new Set(agg.topics)].slice(0, 3), sufficiency: getSufficiency(agg.publishedCount),
    });
  }
  topicFamilyPerformance.sort((a, b) => b.totalViews - a.totalViews);

  // ─── Buddhist Hook Pattern ─────────────────────────────────────────────────

  type HookAgg = { totalCount: number; publishedCount: number; totalViews: number; exampleContent: string };
  const hookPatternMap = new Map<BuddhistHookKey, HookAgg>();
  for (const content of contents) {
    const pattern = inferBuddhistHookPattern(content.shortContent ?? "");
    let agg = hookPatternMap.get(pattern);
    if (!agg) { agg = { totalCount: 0, publishedCount: 0, totalViews: 0, exampleContent: content.shortContent ?? "" }; hookPatternMap.set(pattern, agg); }
    agg.totalCount++;
    const pub = publishedYouTubeByContentId.get(content.id);
    if (pub) { agg.publishedCount++; agg.totalViews += pub.views; }
  }
  const hookPatternPerformance: HookPatternRow[] = [];
  for (const [pattern, agg] of hookPatternMap) {
    const avgViews = agg.publishedCount > 0 ? Math.round(agg.totalViews / agg.publishedCount) : 0;
    const ex = agg.exampleContent;
    hookPatternPerformance.push({
      pattern, displayName: BUDDHIST_HOOK_DISPLAY[pattern],
      example: ex.slice(0, 80) + (ex.length > 80 ? "..." : ""),
      totalCount: agg.totalCount, publishedCount: agg.publishedCount, totalViews: agg.totalViews, avgViews,
      sufficiency: getSufficiency(agg.publishedCount),
    });
  }
  hookPatternPerformance.sort((a, b) => b.totalViews - a.totalViews);

  // ─── Visual Style (no metadata) ───────────────────────────────────────────

  const visualStylePerformance: VisualStyleRow[] = [{
    visualMode: "no_metadata", displayName: "Visual metadata không có sẵn",
    totalCount: contents.length, publishedCount: published.length,
    totalViews: 0, avgViews: 0, sufficiency: "too_early",
  }];

  // ─── Quality Flags ────────────────────────────────────────────────────────

  const ctaItems = contents.filter((c) => hasCTA(c.shortContent));
  const hook2Items = contents.filter((c) => c.experimentVariant === "HOOK_V2");
  const nullEraItems = contents.filter((c) => !c.experimentVariant);
  const coverIntroItems = contents.filter((c) => c.experimentVariant === "COVER_INTRO_ON");
  const facebookNoMetrics = published.filter((p) => p.platform === "facebook" && p.latestViewCount === null);

  const qualityFlags: QualityFlagRow[] = [];

  if (ctaItems.length > 0) {
    qualityFlags.push({
      flag: "cta_contamination",
      displayName: "CTA Contamination (critical)",
      description: "Các item này có baked subscriber CTA trong short_content. Like% bị inflate, không dùng làm benchmark so với HOOK_V2. Auto-schedule đã bị block bởi guard 2026-06-08.",
      count: ctaItems.length,
      examples: ctaItems.slice(0, 3).map((c) => ({ contentId: c.id.substring(0, 8), preview: (c.shortContent ?? "").substring(0, 70) + "…" })),
    });
  }

  if (hook2Items.length > 0) {
    const hook2Published = hook2Items.filter((c) => publishedYouTubeByContentId.has(c.id));
    qualityFlags.push({
      flag: "hook_v2_insufficient_data",
      displayName: "HOOK_V2 — Dữ liệu chưa đủ",
      description: `HOOK_V2 (colorful era) có ${hook2Published.length}/${hook2Items.length} items đã publish YouTube. Cần ≥48h và ≥20 video để so sánh.`,
      count: hook2Items.length - hook2Published.length,
      examples: hook2Items.slice(0, 2).map((c) => ({ contentId: c.id.substring(0, 8), preview: (c.shortContent ?? "").substring(0, 70) + "…" })),
    });
  }

  if (facebookNoMetrics.length > 0) {
    qualityFlags.push({
      flag: "facebook_metrics_unavailable",
      displayName: "Facebook — Metrics không có sẵn",
      description: `${facebookNoMetrics.length} Facebook published rows có null view/like counts. Dùng YouTube làm nguồn học chính cho đến khi Facebook metrics ổn định.`,
      count: facebookNoMetrics.length,
      examples: [],
    });
  }

  if (nullEraItems.length > 0) {
    qualityFlags.push({
      flag: "null_era_legacy_dominant",
      displayName: "Legacy Era (NULL) chiếm đa số",
      description: `${nullEraItems.length} items thuộc NULL_ERA (legacy TTS). Avg 119 views, median 62.5 — phân tán cao. Không nên dùng làm benchmark chính.`,
      count: nullEraItems.length,
      examples: [],
    });
  }

  if (coverIntroItems.length > 0) {
    qualityFlags.push({
      flag: "cover_intro_underperform",
      displayName: "COVER_INTRO_ON — Underperform",
      description: `${coverIntroItems.length} items dùng cover intro. Average 110 views, retention 31.2% — thấp hơn cả NULL_ERA về retention. Không ưu tiên.`,
      count: coverIntroItems.length,
      examples: [],
    });
  }

  qualityFlags.push({
    flag: "visual_metadata_unavailable",
    displayName: "Visual metadata không có sẵn",
    description: "image_paths và prompt_versions đều rỗng trong DB. Không thể phân loại colorful/muted tự động.",
    count: 0,
    examples: [],
  });

  // ─── Voice/Audio Intelligence ──────────────────────────────────────────────

  const now = new Date();
  const voiceAudioRows: VoiceAudioRow[] = contents
    .filter((c) => c.ttsDurationMs !== null || c.audioPath !== null)
    .slice(0, 80)
    .map((c) => {
      const metrics = computeVoiceAudioMetrics({
        shortContent: c.shortContent ?? "",
        ttsDurationMs: c.ttsDurationMs ?? null,
        audioPath: c.audioPath ?? null,
      });
      const pub = publishedYouTubeByContentId.get(c.id);
      return {
        contentId: c.id,
        topic: c.topic,
        era: c.experimentVariant ?? "NULL_ERA",
        audioPath: c.audioPath ?? null,
        ttsDurationMs: c.ttsDurationMs ?? null,
        ttsDurationSec: c.ttsDurationMs ? Math.round(c.ttsDurationMs / 1000) : null,
        ...metrics,
        views: pub ? pub.views : null,
        ageBadge: pub ? computeAgeBadge(pub.publishedAt, now) : null,
      };
    });

  // ─── Cross-Platform Lineage ────────────────────────────────────────────────

  const crossPlatformLineage: CrossPlatformLineageRow[] = contents.slice(0, 60).map((c) => {
    const era = c.experimentVariant ?? "NULL_ERA";
    const ytPub = publishedYouTubeByContentId.get(c.id);
    const fbPub = publishedFacebookByContentId.get(c.id);

    let ytTimeWindow: TimeWindowMetrics | null = null;
    let ytRetention: number | null = null;
    let ytAgeBadge: AgeBadge | null = null;

    if (ytPub) {
      ytTimeWindow = computeTimeWindowViews(ytPub.id, ytPub.publishedAt, snapshotsByVideoId);
      ytAgeBadge = computeAgeBadge(ytPub.publishedAt, now);
      const snaps = snapshotsByVideoId.get(ytPub.id);
      if (snaps) {
        const retPcts = snaps.map((s) => s.retentionPct ? parseFloat(s.retentionPct) : null).filter((v): v is number => v !== null && !isNaN(v));
        ytRetention = retPcts.length > 0 ? retPcts.reduce((a, b) => a + b, 0) / retPcts.length : null;
      }
    }

    const fbMetricsNote = fbPub ? (fbPub.views === null ? "metrics unavailable" : null) : null;

    return {
      contentId: c.id,
      topic: c.topic,
      era,
      topicFamily: c.topicFamily ? normalizeTopicFamily(c.topicFamily) : inferBuddhistTopicFamily(c.topic),
      createdAt: c.createdAt,
      youtube: {
        published: !!ytPub,
        publishedAt: ytPub?.publishedAt ?? null,
        views: ytPub?.views ?? null,
        likes: ytPub?.likes ?? null,
        retention: ytRetention,
        ageBadge: ytAgeBadge,
        timeWindow: ytTimeWindow,
      },
      facebook: {
        published: !!fbPub,
        publishedAt: fbPub?.publishedAt ?? null,
        views: fbPub?.views ?? null,
        likes: fbPub?.likes ?? null,
        note: fbMetricsNote,
      },
      tiktok: { configured: false },
    };
  });

  // ─── Basic Lineage (for Lineage tab compatibility) ─────────────────────────

  const lineage: LineageRow[] = contents.slice(0, 50).map((content) => {
    const era = content.experimentVariant ?? "NULL_ERA";
    const pub = publishedYouTubeByContentId.get(content.id);
    return {
      contentId: content.id, topic: content.topic, createdAt: content.createdAt, variant: era,
      topicFamily: content.topicFamily ? normalizeTopicFamily(content.topicFamily) : inferBuddhistTopicFamily(content.topic),
      hookPattern: inferBuddhistHookPattern(content.shortContent ?? ""),
      visualMode: BUDDHIST_ERA_LABELS[era] ?? era,
      hotfixGroup: BUDDHIST_ERA_LABELS[era] ?? era,
      published: !!pub, views: pub ? pub.views : null,
    };
  });

  // ─── Summary ──────────────────────────────────────────────────────────────

  const ytPublished = published.filter((p) => p.platform === "youtube");
  const fbPublished = published.filter((p) => p.platform === "facebook");
  const allYtDates = ytPublished.map((p) => p.publishedAt).filter((d): d is Date => d !== null);
  const firstPublishedAt = allYtDates.length > 0 ? new Date(Math.min(...allYtDates.map((d) => d.getTime()))) : null;
  const latestPublishedAt = allYtDates.length > 0 ? new Date(Math.max(...allYtDates.map((d) => d.getTime()))) : null;
  const totalViews = ytPublished.reduce((sum, p) => sum + (p.latestViewCount ?? 0), 0);
  const dataWindowDays = firstPublishedAt && latestPublishedAt
    ? Math.ceil((latestPublishedAt.getTime() - firstPublishedAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;

  // ─── Recommendations ──────────────────────────────────────────────────────

  const recommendations: RecommendationItem[] = [];
  const hook1Era = buddhistEraPerformance.find((r) => r.era === "HOOK_V1");
  const hook2Era = buddhistEraPerformance.find((r) => r.era === "HOOK_V2");
  const quoteEra = buddhistEraPerformance.find((r) => r.era === "LEGACY_QUOTE_NO_VOICE_V2");
  const coverEra = buddhistEraPerformance.find((r) => r.era === "COVER_INTRO_ON");

  if (hook1Era?.ctaContaminated) {
    recommendations.push({ level: "warning", message: `HOOK_V1 có views cao (avg ${hook1Era.avgViewsYoutube}, median ${hook1Era.medianViewsYoutube ?? "—"}) nhưng like% bị CTA inflate (~+1.2pp). Không dùng like% HOOK_V1 làm benchmark so với HOOK_V2. Dùng views và retention.` });
  }
  if (quoteEra && (quoteEra.avgRetentionPct ?? 0) > 60) {
    recommendations.push({ level: "positive", message: `LEGACY_QUOTE_NO_VOICE_V2 có retention trung bình ${quoteEra.avgRetentionPct?.toFixed(1)}% — xuất sắc. Duy trì song song với HOOK_V2.` });
  }
  if (coverEra && coverEra.avgViewsYoutube < 150) {
    recommendations.push({ level: "warning", message: `COVER_INTRO_ON underperformed (avg ${coverEra.avgViewsYoutube} views, retention thấp). Không ưu tiên trong production mix.` });
  }
  if (hook2Era && hook2Era.publishedYoutube < 10) {
    recommendations.push({ level: "info", message: `HOOK_V2 (colorful) mới có ${hook2Era.publishedYoutube} YouTube videos. Cần ít nhất 20 videos ≥48h để đánh giá impact visuals.` });
  }
  // Phase A share / subscriber signals (read-only observations)
  const hookV2Shares = hook2Era?.avgShareCount ?? null;
  const hookV1Shares = hook1Era?.avgShareCount ?? null;
  if (hookV2Shares !== null && hookV2Shares > 0) {
    const shareRate = hook2Era?.shareViewRate ?? null;
    recommendations.push({ level: "positive", message: `HOOK_V2 avg shares: ${hookV2Shares}${shareRate !== null ? ` (share/view ${shareRate.toFixed(2)}%)` : ""}. High shares relative to views = share-worthy content.` });
  } else if (hookV1Shares !== null && hookV1Shares > 0) {
    recommendations.push({ level: "info", message: `HOOK_V1 avg shares: ${hookV1Shares}. Verify this isn't CTA-contaminated share count before scaling.` });
  }
  const hook2Subs = hook2Era?.totalSubscribersGained ?? null;
  if (hook2Subs !== null && hook2Subs > 0) {
    recommendations.push({ level: "positive", message: `HOOK_V2 gained ${hook2Subs} subscribers total. Topic family may be strong for channel growth.` });
  }
  const highViews = buddhistEraPerformance.find((r) => r.avgViewsYoutube > 200);
  if (highViews && highViews.avgShareCount === null) {
    recommendations.push({ level: "info", message: `${highViews.eraLabel} has high views but no share data yet — wait for next Analytics sync (runs every 6–24h).` });
  }
  recommendations.push({ level: "info", message: "Facebook metrics phần lớn null. Dùng YouTube làm nguồn học chính cho Phật pháp." });
  recommendations.push({ level: "info", message: "Visual colorful vs muted: chưa thể kết luận. image_paths rỗng trong DB." });
  recommendations.push({ level: "info", message: "Voice pacing cần thêm retention data trước khi thay đổi TTS settings." });
  recommendations.push({ level: "info", message: "Đây là chế độ chỉ đọc — không có thay đổi tự động nào." });

  return {
    profile: "phat_phap", platformFilter, topicProfile: TOPIC_DESTINATION_PROFILES.phat_phap,
    formatPerformance, topicFamilyPerformance, hookPatternPerformance, visualStylePerformance,
    lineage, recommendations,
    summary: { totalGenerated: contents.length, totalPublished: ytPublished.length, totalViews, firstPublishedAt, latestPublishedAt, dataWindowDays, hasRetentionData, facebookPublished: fbPublished.length },
    buddhistEraPerformance, qualityFlags, voiceAudioRows, crossPlatformLineage,
  };
}

// ─── Empty Payload ────────────────────────────────────────────────────────────

function buildEmptyPayload(profile: ChannelProfile = "phat_phap", platformFilter: PlatformFilter = "all"): ContentIntelligencePayload {
  return {
    profile, platformFilter, topicProfile: TOPIC_DESTINATION_PROFILES[profile],
    formatPerformance: [], topicFamilyPerformance: [], hookPatternPerformance: [],
    visualStylePerformance: [], lineage: [],
    recommendations: [{ level: "info", message: "Đây là chế độ chỉ đọc — không có thay đổi tự động nào" }],
    summary: { totalGenerated: 0, totalPublished: 0, totalViews: 0, firstPublishedAt: null, latestPublishedAt: null, dataWindowDays: 0, hasRetentionData: false, facebookPublished: 0 },
    buddhistEraPerformance: [], qualityFlags: [], voiceAudioRows: [], crossPlatformLineage: [],
  };
}
