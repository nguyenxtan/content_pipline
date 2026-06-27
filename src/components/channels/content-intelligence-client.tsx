"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Info,
  Mic,
  TrendingUp,
  ShieldAlert,
} from "lucide-react";
import type {
  AgeBadge as AgeBadgeType,
  BuddhistEraRow,
  ChannelProfile,
  ContentIntelligencePayload,
  CrossPlatformLineageRow,
  DataSufficiency,
  FormatPerformanceRow,
  HookPatternRow,
  LineageRow,
  PlatformFilter,
  QualityFlagRow,
  RecommendationItem,
  TopicFamilyRow,
  VisualStyleRow,
  VoiceAudioRow,
} from "@/actions/content-intelligence";
import { getContentIntelligenceAction } from "@/actions/content-intelligence";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

// ─── Sufficiency Badge ────────────────────────────────────────────────────────

function SufficiencyBadge({ level }: { level: DataSufficiency }) {
  const config: Record<DataSufficiency, { label: string; className: string }> = {
    too_early: { label: "Quá sớm", className: "border-slate-700 bg-slate-900 text-slate-400" },
    directional: { label: "Định hướng", className: "border-yellow-700/60 bg-yellow-950/20 text-yellow-300" },
    human_review: { label: "Đủ để đánh giá", className: "border-blue-700/60 bg-blue-950/20 text-blue-300" },
    auto_learning: { label: "Đủ cho auto-learning", className: "border-emerald-700/60 bg-emerald-950/20 text-emerald-300" },
  };
  const { label, className } = config[level];
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {label}
    </span>
  );
}

// ─── Age Badge ────────────────────────────────────────────────────────────────

function AgeBadge({ badge }: { badge: AgeBadgeType }) {
  const config: Record<AgeBadgeType, { label: string; className: string }> = {
    too_early: { label: "< 24h", className: "border-slate-700 bg-slate-900 text-slate-500" },
    early_signal: { label: "24–48h", className: "border-yellow-700/60 bg-yellow-950/20 text-yellow-400" },
    first_decision: { label: "2–7 ngày", className: "border-blue-700/60 bg-blue-950/20 text-blue-300" },
    stable: { label: "7–30 ngày", className: "border-emerald-700/60 bg-emerald-950/20 text-emerald-300" },
    evergreen: { label: "> 30 ngày", className: "border-violet-700/60 bg-violet-950/20 text-violet-300" },
  };
  const { label, className } = config[badge];
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {label}
    </span>
  );
}

// ─── Era / Hotfix Group Badge ─────────────────────────────────────────────────

function EraBadge({ group }: { group: string }) {
  const config: Record<string, string> = {
    "Pre Style Pack": "border-slate-700 bg-slate-900 text-slate-400",
    "Post Style Pack": "border-blue-700/60 bg-blue-950/20 text-blue-300",
    "Post Kinfolk Fix": "border-emerald-700/60 bg-emerald-950/20 text-emerald-300",
    "Legacy Era": "border-slate-700 bg-slate-900 text-slate-400",
    "Quote Era": "border-violet-700/60 bg-violet-950/20 text-violet-300",
    "Cover Era": "border-orange-700/60 bg-orange-950/20 text-orange-300",
    "Hook V1": "border-amber-700/60 bg-amber-950/20 text-amber-300",
    "Hook V2": "border-rose-700/60 bg-rose-950/20 text-rose-300",
    "Facebook": "border-blue-700/60 bg-blue-950/20 text-blue-300",
  };
  const className = config[group] ?? "border-slate-700 bg-slate-900 text-slate-400";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {group}
    </span>
  );
}

// ─── CTA Badge ────────────────────────────────────────────────────────────────

function CTABadge({ contaminated }: { contaminated: boolean }) {
  if (!contaminated) {
    return (
      <span className="inline-flex rounded-full border border-emerald-700/60 bg-emerald-950/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
        Clean
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-red-700/60 bg-red-950/20 px-2 py-0.5 text-[11px] font-medium text-red-300">
      CTA inflate
    </span>
  );
}

// ─── Pacing Badge ─────────────────────────────────────────────────────────────

function PacingBadge({ category }: { category: VoiceAudioRow["pacingCategory"] }) {
  const config: Record<VoiceAudioRow["pacingCategory"], { label: string; className: string }> = {
    too_slow: { label: "Chậm", className: "border-blue-700/60 bg-blue-950/20 text-blue-300" },
    normal: { label: "Bình thường", className: "border-emerald-700/60 bg-emerald-950/20 text-emerald-300" },
    fast: { label: "Nhanh", className: "border-amber-700/60 bg-amber-950/20 text-amber-300" },
    unknown: { label: "—", className: "border-slate-700 bg-slate-900 text-slate-500" },
  };
  const { label, className } = config[category];
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {label}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

// ─── Recommendation Card ──────────────────────────────────────────────────────

function RecommendationCard({ item }: { item: RecommendationItem }) {
  const config = {
    info: { border: "border-blue-800/50", bg: "bg-blue-950/10", text: "text-blue-300", icon: Info },
    warning: { border: "border-amber-800/50", bg: "bg-amber-950/10", text: "text-amber-300", icon: AlertTriangle },
    positive: { border: "border-emerald-800/50", bg: "bg-emerald-950/10", text: "text-emerald-300", icon: CheckCircle2 },
  };
  const { border, bg, text, icon: Icon } = config[item.level];
  return (
    <div className={`flex items-start gap-3 rounded-lg border ${border} ${bg} px-4 py-3`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${text}`} />
      <p className={`text-sm ${text}`}>{item.message}</p>
    </div>
  );
}

// ─── Channel Selector ─────────────────────────────────────────────────────────

const CHANNEL_OPTIONS: Array<{ profile: ChannelProfile; label: string; sub: string }> = [
  { profile: "phat_phap", label: "Giới Định Tuệ", sub: "Buddhist · YouTube + Facebook" },
  { profile: "tang_sau", label: "Tầng Sâu", sub: "Philosophy · YouTube" },
];

function ChannelSelector({
  current,
  isPending,
  onChange,
}: {
  current: ChannelProfile;
  isPending: boolean;
  onChange: (profile: ChannelProfile) => void;
}) {
  return (
    <div className="flex gap-2">
      {CHANNEL_OPTIONS.map((opt) => (
        <button
          key={opt.profile}
          disabled={isPending}
          onClick={() => onChange(opt.profile)}
          className={`rounded-lg border px-4 py-2 text-left transition-all disabled:opacity-50 ${
            current === opt.profile
              ? "border-rose-600/70 bg-rose-950/30 text-rose-200"
              : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
          }`}
        >
          <p className="text-sm font-medium">{opt.label}</p>
          <p className="text-[11px] text-slate-500">{opt.sub}</p>
        </button>
      ))}
      {isPending && (
        <div className="flex items-center px-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-rose-400" />
        </div>
      )}
    </div>
  );
}

// ─── Platform Filter Selector (phat_phap only) ────────────────────────────────

type PlatformOption = {
  value: PlatformFilter;
  label: string;
  sub: string;
  disabled?: boolean;
};

const PHAT_PHAP_PLATFORM_OPTIONS: PlatformOption[] = [
  { value: "all", label: "All Platforms", sub: "YouTube + Facebook" },
  { value: "youtube", label: "YouTube", sub: "Giới Định Tuệ" },
  { value: "facebook", label: "Facebook", sub: "Trí Tuệ An Nhiên" },
  { value: "tiktok", label: "TikTok", sub: "Chưa cấu hình", disabled: true },
];

function PlatformFilterSelector({
  current,
  isPending,
  onChange,
}: {
  current: PlatformFilter;
  isPending: boolean;
  onChange: (filter: PlatformFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PHAT_PHAP_PLATFORM_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          disabled={isPending || opt.disabled}
          onClick={() => !opt.disabled && onChange(opt.value)}
          className={`rounded-md border px-3 py-1.5 text-left transition-all disabled:opacity-40 ${
            current === opt.value && !opt.disabled
              ? "border-blue-600/70 bg-blue-950/30 text-blue-200"
              : opt.disabled
              ? "border-slate-800 bg-slate-950/40 text-slate-600 cursor-not-allowed"
              : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
          }`}
        >
          <p className="text-xs font-medium">{opt.label}</p>
          <p className="text-[10px] text-slate-500">{opt.sub}</p>
        </button>
      ))}
    </div>
  );
}

// ─── Buddhist Era Tab ─────────────────────────────────────────────────────────

function BuddhistEraTab({ rows }: { rows: BuddhistEraRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-sm text-slate-500">Chưa có dữ liệu era.</p>;
  }

  const hasPhaseAData = rows.some(
    (r) => r.avgShareCount !== null || r.avgEstimatedMinutesWatched !== null || r.totalSubscribersGained !== null,
  );

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs text-slate-500">
        Metrics YouTube-only. Like% HOOK_V1 bị inflate vì baked subscriber CTA. 24h/48h/7d/30d = avg views per time window.
        {hasPhaseAData && " · Shares / Mins / Subs từ YouTube Analytics API (Phase A)."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1600px] text-sm">
          <thead className="bg-slate-950/60">
            <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Era</th>
              <th className="px-4 py-3">Gen</th>
              <th className="px-4 py-3">YT</th>
              <th className="px-4 py-3">FB</th>
              <th className="px-4 py-3">Avg Views</th>
              <th className="px-4 py-3">Median</th>
              <th className="px-4 py-3">24h</th>
              <th className="px-4 py-3">48h</th>
              <th className="px-4 py-3">7d</th>
              <th className="px-4 py-3">30d</th>
              <th className="px-4 py-3">Like%</th>
              <th className="px-4 py-3">CTA</th>
              <th className="px-4 py-3">Retention</th>
              <th className="px-4 py-3 text-sky-600">Avg Shares</th>
              <th className="px-4 py-3 text-sky-600">Share/View</th>
              <th className="px-4 py-3 text-sky-600">Avg Mins Watched</th>
              <th className="px-4 py-3 text-sky-600">Subs Gained</th>
              <th className="px-4 py-3">Sufficiency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.era} className="border-b border-slate-900/80 align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-100">{row.eraLabel}</p>
                  <p className="text-[11px] text-slate-500">{row.era}</p>
                </td>
                <td className="px-4 py-3 text-slate-200">{row.generatedCount}</td>
                <td className="px-4 py-3 text-slate-200">{row.publishedYoutube}</td>
                <td className="px-4 py-3 text-slate-400">{row.publishedFacebook || "—"}</td>
                <td className="px-4 py-3 font-medium text-slate-100">
                  {row.publishedYoutube === 0 ? <span className="text-slate-500">—</span> : formatNumber(row.avgViewsYoutube)}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {row.medianViewsYoutube !== null ? formatNumber(row.medianViewsYoutube) : "—"}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {row.views24hAvg !== null ? formatNumber(Math.round(row.views24hAvg)) : "—"}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {row.views48hAvg !== null ? formatNumber(Math.round(row.views48hAvg)) : "—"}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {row.views7dAvg !== null ? formatNumber(Math.round(row.views7dAvg)) : "—"}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {row.views30dAvg !== null ? formatNumber(Math.round(row.views30dAvg)) : "—"}
                </td>
                <td className="px-4 py-3">
                  {row.likeViewRatioYoutube !== null ? (
                    <span className={row.ctaContaminated ? "text-amber-400" : "text-slate-300"}>
                      {row.likeViewRatioYoutube.toFixed(2)}%
                      {row.ctaContaminated && <span className="ml-1 text-[10px] text-amber-500">*</span>}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3">
                  <CTABadge contaminated={row.ctaContaminated} />
                </td>
                <td className="px-4 py-3">
                  {row.avgRetentionPct !== null ? (
                    <span className="text-slate-300">{row.avgRetentionPct.toFixed(1)}%</span>
                  ) : (
                    <span className="text-[11px] text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sky-400">
                  {row.avgShareCount !== null ? formatNumber(row.avgShareCount) : (
                    <span className="text-[11px] text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.shareViewRate !== null ? (
                    <span className={row.shareViewRate >= 0.5 ? "text-emerald-400" : "text-slate-400"}>
                      {row.shareViewRate.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sky-400">
                  {row.avgEstimatedMinutesWatched !== null ? `${formatNumber(row.avgEstimatedMinutesWatched)} min` : (
                    <span className="text-[11px] text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.totalSubscribersGained !== null ? (
                    <span className="text-emerald-400">+{formatNumber(row.totalSubscribersGained)}</span>
                  ) : (
                    <span className="text-[11px] text-slate-600">—</span>
                  )}
                  {row.totalSubscribersLost !== null && row.totalSubscribersLost > 0 && (
                    <span className="ml-1 text-rose-400/70 text-[11px]">
                      −{formatNumber(row.totalSubscribersLost)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <SufficiencyBadge level={row.sufficiency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-amber-600/80">
        * Like% với dấu * bị inflate bởi baked subscriber CTA. Điều chỉnh ~−1.2pp để so sánh công bằng với HOOK_V2.
      </p>
      {!hasPhaseAData && (
        <p className="text-[11px] text-slate-600">
          Shares / Mins / Subs sẽ xuất hiện sau lần Analytics sync tiếp theo (Phase A metrics — chạy cùng cron 6–24h).
        </p>
      )}
    </div>
  );
}

// ─── Quality Flags Tab ────────────────────────────────────────────────────────

function QualityFlagsTab({ rows }: { rows: QualityFlagRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-sm text-slate-500">Chưa có quality flags.</p>;
  }

  const flagConfig: Record<string, { border: string; bg: string; iconColor: string }> = {
    cta_contamination: { border: "border-red-800/50", bg: "bg-red-950/10", iconColor: "text-red-400" },
    hook_v2_insufficient_data: { border: "border-yellow-800/50", bg: "bg-yellow-950/10", iconColor: "text-yellow-400" },
    cover_intro_underperform: { border: "border-orange-800/50", bg: "bg-orange-950/10", iconColor: "text-orange-400" },
    visual_metadata_unavailable: { border: "border-slate-700/50", bg: "bg-slate-950/20", iconColor: "text-slate-500" },
    null_era_legacy_dominant: { border: "border-slate-700/50", bg: "bg-slate-950/20", iconColor: "text-slate-500" },
  };

  return (
    <div className="space-y-3 p-4">
      {rows.map((row) => {
        const cfg = flagConfig[row.flag] ?? flagConfig.visual_metadata_unavailable;
        return (
          <div
            key={row.flag}
            className={`rounded-lg border ${cfg.border} ${cfg.bg} p-4`}
          >
            <div className="flex items-start gap-3">
              <ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.iconColor}`} />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-100">{row.displayName}</p>
                  {row.count > 0 && (
                    <span className="inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                      {row.count} items
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">{row.description}</p>
                {row.examples.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {row.examples.map((ex, i) => (
                      <div key={i} className="flex gap-2 rounded bg-slate-950/40 px-3 py-1.5 text-[11px]">
                        <span className="shrink-0 font-mono text-slate-500">{ex.contentId}…</span>
                        <span className="text-slate-400 italic">{ex.preview}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Format Tab ───────────────────────────────────────────────────────────────

function FormatTab({ rows, profile }: { rows: FormatPerformanceRow[]; profile: ChannelProfile }) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-sm text-slate-500">Chưa có dữ liệu format.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="bg-slate-950/60">
          <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Format</th>
            <th className="px-4 py-3">Generated</th>
            <th className="px-4 py-3">Published</th>
            <th className="px-4 py-3">Total Views</th>
            <th className="px-4 py-3">Avg Views</th>
            {profile === "tang_sau" && (
              <>
                <th className="px-4 py-3">Views 24h</th>
                <th className="px-4 py-3">Views 48h</th>
              </>
            )}
            <th className="px-4 py-3">Likes</th>
            <th className="px-4 py-3">Like/View %</th>
            <th className="px-4 py-3">Retention</th>
            <th className="px-4 py-3">Sufficiency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.variant} className="border-b border-slate-900/80 align-top">
              <td className="px-4 py-3">
                <div className="space-y-1">
                  <p className="font-medium text-slate-100">{row.displayName}</p>
                  <p className="text-[11px] text-slate-500">{row.variant}</p>
                  <EraBadge group={row.hotfixGroup} />
                </div>
              </td>
              <td className="px-4 py-3 text-slate-200">{row.totalCount}</td>
              <td className="px-4 py-3 text-slate-200">{row.publishedCount}</td>
              <td className="px-4 py-3 text-slate-100">
                {row.publishedCount === 0 ? <span className="text-slate-500">Chưa đủ dữ liệu</span> : formatNumber(row.totalViews)}
              </td>
              <td className="px-4 py-3 text-slate-100">
                {row.publishedCount === 0 ? "—" : formatNumber(row.avgViews)}
              </td>
              {profile === "tang_sau" && (
                <>
                  <td className="px-4 py-3 text-slate-300">{row.views24h !== null ? formatNumber(row.views24h) : "—"}</td>
                  <td className="px-4 py-3 text-slate-300">{row.views48h !== null ? formatNumber(row.views48h) : "—"}</td>
                </>
              )}
              <td className="px-4 py-3 text-slate-200">{formatNumber(row.totalLikes)}</td>
              <td className="px-4 py-3 text-slate-300">
                {row.likeViewRatio !== null ? `${row.likeViewRatio.toFixed(2)}%` : "—"}
              </td>
              <td className="px-4 py-3">
                {row.avgRetentionPct !== null ? (
                  <span className="text-slate-300">{row.avgRetentionPct.toFixed(1)}%</span>
                ) : (
                  <span className="inline-flex rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-500">
                    {profile === "phat_phap" ? "—" : "Cần Analytics API"}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <SufficiencyBadge level={row.sufficiency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Topic Family Tab ─────────────────────────────────────────────────────────

function TopicFamilyTab({ rows }: { rows: TopicFamilyRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-sm text-slate-500">Chưa có dữ liệu topic family.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] text-sm">
        <thead className="bg-slate-950/60">
          <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Topic Family</th>
            <th className="px-4 py-3">Count</th>
            <th className="px-4 py-3">Published (YT)</th>
            <th className="px-4 py-3">Total Views</th>
            <th className="px-4 py-3">Avg Views</th>
            <th className="px-4 py-3">Top Topics</th>
            <th className="px-4 py-3">Sufficiency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.family} className="border-b border-slate-900/80 align-top">
              <td className="px-4 py-3">
                <p className="font-medium text-slate-100">{row.displayName}</p>
                <p className="text-[11px] text-slate-500">{row.family}</p>
              </td>
              <td className="px-4 py-3 text-slate-200">{row.totalCount}</td>
              <td className="px-4 py-3 text-slate-200">{row.publishedCount}</td>
              <td className="px-4 py-3 text-slate-100">{formatNumber(row.totalViews)}</td>
              <td className="px-4 py-3 text-slate-100">{row.publishedCount > 0 ? formatNumber(row.avgViews) : "—"}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {row.topTopics.map((t) => (
                    <span key={t} className="inline-flex rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[11px] text-slate-300" title={t}>
                      {truncate(t, 28)}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3">
                <SufficiencyBadge level={row.sufficiency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Hook Pattern Tab ─────────────────────────────────────────────────────────

function HookPatternTab({ rows }: { rows: HookPatternRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-sm text-slate-500">Chưa có dữ liệu hook pattern.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-950/60">
          <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Pattern</th>
            <th className="px-4 py-3">Ví dụ</th>
            <th className="px-4 py-3">Count</th>
            <th className="px-4 py-3">Published</th>
            <th className="px-4 py-3">Total Views</th>
            <th className="px-4 py-3">Avg Views</th>
            <th className="px-4 py-3">Sufficiency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.pattern} className="border-b border-slate-900/80 align-top">
              <td className="px-4 py-3">
                <p className="font-medium text-slate-100">{row.displayName}</p>
                <p className="text-[11px] text-slate-500">{row.pattern}</p>
              </td>
              <td className="px-4 py-3">
                <p className="max-w-[280px] text-xs italic text-slate-400">{truncate(row.example, 80)}</p>
              </td>
              <td className="px-4 py-3 text-slate-200">{row.totalCount}</td>
              <td className="px-4 py-3 text-slate-200">{row.publishedCount}</td>
              <td className="px-4 py-3 text-slate-100">{formatNumber(row.totalViews)}</td>
              <td className="px-4 py-3 text-slate-100">{row.publishedCount > 0 ? formatNumber(row.avgViews) : "—"}</td>
              <td className="px-4 py-3">
                <SufficiencyBadge level={row.sufficiency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Lineage Tab ──────────────────────────────────────────────────────────────

function LineageTab({ rows }: { rows: LineageRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-sm text-slate-500">Chưa có dữ liệu lineage.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead className="bg-slate-950/60">
          <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Topic</th>
            <th className="px-4 py-3">Era / Format</th>
            <th className="px-4 py-3">Topic Family</th>
            <th className="px-4 py-3">Hook</th>
            <th className="px-4 py-3">Ngày tạo</th>
            <th className="px-4 py-3">Views</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.contentId} className="border-b border-slate-900/80 align-top">
              <td className="px-4 py-3">
                <p className="max-w-[240px] text-sm text-slate-100">{truncate(row.topic, 40)}</p>
              </td>
              <td className="px-4 py-3">
                <EraBadge group={row.hotfixGroup} />
              </td>
              <td className="px-4 py-3 text-xs text-slate-300">{row.topicFamily}</td>
              <td className="px-4 py-3">
                <span className="inline-flex rounded-md border border-slate-800 bg-slate-950/60 px-2 py-0.5 text-[11px] text-slate-400">
                  {row.hookPattern}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-slate-400">{formatDate(row.createdAt)}</td>
              <td className="px-4 py-3">
                {row.published ? (
                  <span className="text-slate-100">{row.views !== null ? formatNumber(row.views) : "0"}</span>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Cross-Platform Lineage Tab ───────────────────────────────────────────────

function CrossPlatformLineageTab({ rows }: { rows: CrossPlatformLineageRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-sm text-slate-500">Chưa có dữ liệu cross-platform lineage.</p>;
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs text-slate-500">
        Mỗi content item: YouTube · Giới Định Tuệ (account 1) + Facebook · Trí Tuệ An Nhiên (account 3) + TikTok (chưa cấu hình).
        Facebook views phần lớn null do chưa có Analytics API.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="bg-slate-950/60">
            <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Topic</th>
              <th className="px-4 py-3">Era</th>
              <th className="px-4 py-3">Ngày tạo</th>
              <th className="px-4 py-3 text-red-400/70">YouTube</th>
              <th className="px-4 py-3 text-red-400/70">YT Views</th>
              <th className="px-4 py-3 text-red-400/70">YT Age</th>
              <th className="px-4 py-3 text-red-400/70">YT 24h / 7d</th>
              <th className="px-4 py-3 text-blue-400/70">Facebook</th>
              <th className="px-4 py-3 text-blue-400/70">FB Views</th>
              <th className="px-4 py-3 text-slate-600">TikTok</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.contentId} className="border-b border-slate-900/80 align-top">
                <td className="px-4 py-3">
                  <p className="max-w-[200px] text-sm text-slate-100">{truncate(row.topic, 36)}</p>
                  <p className="text-[11px] text-slate-500">{row.topicFamily}</p>
                </td>
                <td className="px-4 py-3">
                  <EraBadge group={row.era} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{formatDate(row.createdAt)}</td>

                {/* YouTube */}
                <td className="px-4 py-3">
                  {row.youtube.published ? (
                    <span className="inline-flex rounded-full border border-red-700/50 bg-red-950/20 px-2 py-0.5 text-[11px] font-medium text-red-300">
                      Đã đăng
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.youtube.published && row.youtube.views !== null ? (
                    <span className="font-medium text-slate-100">{formatNumber(row.youtube.views)}</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.youtube.ageBadge ? (
                    <AgeBadge badge={row.youtube.ageBadge} />
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {row.youtube.timeWindow ? (
                    <div className="space-y-0.5">
                      <p>
                        <span className="text-slate-500">24h:</span>{" "}
                        {row.youtube.timeWindow.views24h !== null ? formatNumber(row.youtube.timeWindow.views24h) : "—"}
                      </p>
                      <p>
                        <span className="text-slate-500">7d:</span>{" "}
                        {row.youtube.timeWindow.views7d !== null ? formatNumber(row.youtube.timeWindow.views7d) : "—"}
                      </p>
                    </div>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>

                {/* Facebook */}
                <td className="px-4 py-3">
                  {row.facebook.published ? (
                    <span className="inline-flex rounded-full border border-blue-700/50 bg-blue-950/20 px-2 py-0.5 text-[11px] font-medium text-blue-300">
                      Đã đăng
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.facebook.published ? (
                    row.facebook.views !== null ? (
                      <span className="text-slate-100">{formatNumber(row.facebook.views)}</span>
                    ) : (
                      <span className="text-[11px] text-slate-600">
                        {row.facebook.note ?? "null"}
                      </span>
                    )
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>

                {/* TikTok */}
                <td className="px-4 py-3">
                  <span className="text-[11px] text-slate-700">Chưa cấu hình</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Voice / Audio Tab ────────────────────────────────────────────────────────

function VoiceAudioTab({ rows }: { rows: VoiceAudioRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-sm text-slate-500">Chưa có dữ liệu TTS / audio.</p>;
  }

  const withDuration = rows.filter((r) => r.ttsDurationMs !== null);
  const avgWpm = withDuration.length > 0
    ? withDuration.reduce((s, r) => s + (r.wordsPerMinute ?? 0), 0) / withDuration.length
    : null;
  const tooSlow = rows.filter((r) => r.pacingCategory === "too_slow").length;
  const fast = rows.filter((r) => r.pacingCategory === "fast").length;
  const normal = rows.filter((r) => r.pacingCategory === "normal").length;

  return (
    <div className="space-y-4 p-4">
      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">TTS Coverage</p>
          <p className="mt-1 text-xl font-semibold text-slate-100">{withDuration.length} / {rows.length}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Avg WPM</p>
          <p className="mt-1 text-xl font-semibold text-slate-100">{avgWpm !== null ? Math.round(avgWpm) : "—"}</p>
          <p className="text-[11px] text-slate-500">130–230 = bình thường</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Pacing Normal</p>
          <p className="mt-1 text-xl font-semibold text-emerald-400">{normal}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Outliers</p>
          <p className="mt-1 text-xl font-semibold text-amber-400">
            {tooSlow + fast}
            <span className="ml-2 text-[11px] font-normal text-slate-500">({tooSlow} chậm · {fast} nhanh)</span>
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        WPM = word count / (tts_duration_ms / 60000). Script length: too_short &lt;80 / short 80–130 / normal 130–250 / long 250–300 / too_long &gt;300 từ.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-slate-950/60">
            <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Topic</th>
              <th className="px-4 py-3">Era</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Words</th>
              <th className="px-4 py-3">WPM</th>
              <th className="px-4 py-3">Pacing</th>
              <th className="px-4 py-3">Script Length</th>
              <th className="px-4 py-3">Quality Flags</th>
              <th className="px-4 py-3">Views</th>
              <th className="px-4 py-3">Age</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.contentId} className="border-b border-slate-900/80 align-top">
                <td className="px-4 py-3">
                  <p className="max-w-[220px] text-sm text-slate-100">{truncate(row.topic, 38)}</p>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[11px] text-slate-400">{row.era}</span>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {row.ttsDurationSec !== null ? `${row.ttsDurationSec.toFixed(1)}s` : "—"}
                </td>
                <td className="px-4 py-3 text-slate-300">{row.wordCount}</td>
                <td className="px-4 py-3">
                  {row.wordsPerMinute !== null ? (
                    <span className={
                      row.pacingCategory === "normal" ? "text-emerald-400" :
                      row.pacingCategory === "too_slow" ? "text-blue-400" :
                      "text-amber-400"
                    }>
                      {Math.round(row.wordsPerMinute)}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3">
                  <PacingBadge category={row.pacingCategory} />
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] ${
                    row.scriptLengthCategory === "normal" ? "text-slate-300" :
                    row.scriptLengthCategory === "too_short" || row.scriptLengthCategory === "too_long" ? "text-amber-400" :
                    "text-slate-400"
                  }`}>
                    {row.scriptLengthCategory}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {row.qualityFlags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {row.qualityFlags.map((f) => (
                        <span key={f} className="inline-flex rounded-md border border-amber-700/50 bg-amber-950/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                          {f}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.views !== null ? (
                    <span className="text-slate-100">{formatNumber(row.views)}</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.ageBadge ? <AgeBadge badge={row.ageBadge} /> : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab Definitions ──────────────────────────────────────────────────────────

type PhatPhapTab = "era" | "format" | "topic" | "hook" | "cross_platform" | "voice_audio" | "quality";
type TangSauTab = "format" | "topic" | "hook" | "lineage";
type AnyTab = PhatPhapTab | TangSauTab;

const PHAT_PHAP_TABS: Array<{ key: PhatPhapTab; label: string }> = [
  { key: "era", label: "Era Performance" },
  { key: "format", label: "Format" },
  { key: "topic", label: "Topic Family" },
  { key: "hook", label: "Hook Pattern" },
  { key: "cross_platform", label: "Cross-Platform" },
  { key: "voice_audio", label: "Voice / Audio" },
  { key: "quality", label: "Quality Flags" },
];

const TANG_SAU_TABS: Array<{ key: TangSauTab; label: string }> = [
  { key: "format", label: "Format" },
  { key: "topic", label: "Topic Family" },
  { key: "hook", label: "Hook Pattern" },
  { key: "lineage", label: "Learning Lineage" },
];

// ─── Main Client Component ────────────────────────────────────────────────────

export function ContentIntelligenceClient({
  initialData,
}: {
  initialData: ContentIntelligencePayload;
}) {
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<AnyTab>(
    initialData.profile === "phat_phap" ? "era" : "format"
  );
  const [isPending, startTransition] = useTransition();

  const profile = data.profile;
  const platformFilter = data.platformFilter;

  function handleProfileChange(newProfile: ChannelProfile) {
    if (newProfile === profile) return;
    const nextTab: AnyTab = newProfile === "phat_phap" ? "era" : "format";
    setActiveTab(nextTab);
    startTransition(async () => {
      const newData = await getContentIntelligenceAction(newProfile, "all");
      setData(newData);
    });
  }

  function handlePlatformChange(newFilter: PlatformFilter) {
    if (newFilter === platformFilter) return;
    startTransition(async () => {
      const newData = await getContentIntelligenceAction(profile, newFilter);
      setData(newData);
    });
  }

  const tabs = profile === "phat_phap" ? PHAT_PHAP_TABS : TANG_SAU_TABS;

  const channelLabel = profile === "phat_phap"
    ? "Giới Định Tuệ · Trí Tuệ An Nhiên"
    : "Tầng Sâu";

  const topicProfile = data.topicProfile;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-md border border-slate-700 bg-slate-900/80 p-2 text-slate-400">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-100">
              Content Intelligence · {channelLabel}
            </h1>
            <p className="text-xs text-slate-500">
              Phân tích read-only · Không tác động generation hay upload
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <span className="inline-flex rounded-full border border-rose-700/40 bg-rose-950/20 px-3 py-1 text-xs font-medium text-rose-300">
            Read-Only · Learning V1
          </span>
          <ChannelSelector
            current={profile}
            isPending={isPending}
            onChange={handleProfileChange}
          />
        </div>
      </div>

      {/* Platform filter — phat_phap only */}
      {profile === "phat_phap" && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Platform</p>
            {topicProfile.platforms.youtube && (
              <span className="text-[11px] text-slate-600">
                YouTube · {topicProfile.platforms.youtube.displayName}
              </span>
            )}
            {topicProfile.platforms.facebook && (
              <span className="text-[11px] text-slate-600">
                · Facebook · {topicProfile.platforms.facebook.displayName}
              </span>
            )}
            {!topicProfile.platforms.tiktok && (
              <span className="text-[11px] text-slate-700">· TikTok: chưa cấu hình</span>
            )}
          </div>
          <PlatformFilterSelector
            current={platformFilter}
            isPending={isPending}
            onChange={handlePlatformChange}
          />
        </div>
      )}

      {/* Summary cards */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Generated"
          value={formatNumber(data.summary.totalGenerated)}
          sub={`${profile === "phat_phap" ? "phat_phap channel" : "tang_sau channel"}`}
        />
        <StatCard
          label="Published (YouTube)"
          value={formatNumber(data.summary.totalPublished)}
          sub={data.summary.firstPublishedAt ? `Từ ${formatDate(data.summary.firstPublishedAt)}` : "Chưa có video nào"}
        />
        {profile === "phat_phap" && (
          <StatCard
            label="Published (Facebook)"
            value={formatNumber(data.summary.facebookPublished)}
            sub="Trí Tuệ An Nhiên"
          />
        )}
        <StatCard
          label="Total Views (YouTube)"
          value={formatNumber(data.summary.totalViews)}
          sub={data.summary.hasRetentionData ? "Có dữ liệu retention" : "Chưa có retention data"}
        />
        {profile !== "phat_phap" && (
          <StatCard
            label="Data Window"
            value={data.summary.dataWindowDays > 0 ? `${data.summary.dataWindowDays} ngày` : "—"}
            sub={data.summary.latestPublishedAt ? `Gần nhất: ${formatDate(data.summary.latestPublishedAt)}` : "Chưa có dữ liệu"}
          />
        )}
      </div>

      {/* Tabs */}
      <div className="mt-8 overflow-hidden rounded-xl border border-slate-800">
        <div className="flex flex-wrap gap-0 border-b border-slate-800 bg-slate-950/50">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "border-b-2 border-rose-500 text-rose-300"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
              {tab.key === "quality" && data.qualityFlags.some((f) => f.flag === "cta_contamination") && (
                <span className="ml-1.5 inline-flex h-2 w-2 rounded-full bg-red-500" />
              )}
              {tab.key === "voice_audio" && data.voiceAudioRows.length > 0 && (
                <span className="ml-1.5 inline-flex items-center">
                  <Mic className="h-3 w-3 text-slate-500" />
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="bg-slate-900/40">
          {profile === "phat_phap" && activeTab === "era" && (
            <BuddhistEraTab rows={data.buddhistEraPerformance} />
          )}
          {activeTab === "format" && (
            <FormatTab rows={data.formatPerformance} profile={profile} />
          )}
          {activeTab === "topic" && (
            <TopicFamilyTab rows={data.topicFamilyPerformance} />
          )}
          {activeTab === "hook" && (
            <HookPatternTab rows={data.hookPatternPerformance} />
          )}
          {profile === "phat_phap" && activeTab === "cross_platform" && (
            <CrossPlatformLineageTab rows={data.crossPlatformLineage} />
          )}
          {profile === "phat_phap" && activeTab === "voice_audio" && (
            <VoiceAudioTab rows={data.voiceAudioRows} />
          )}
          {profile === "phat_phap" && activeTab === "quality" && (
            <QualityFlagsTab rows={data.qualityFlags} />
          )}
          {profile === "tang_sau" && activeTab === "lineage" && (
            <LineageTab rows={data.lineage} />
          )}
        </div>
      </div>

      {/* Visual Style summary — Tầng Sâu only */}
      {profile === "tang_sau" && data.visualStylePerformance.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-slate-400" />
            <p className="text-sm font-medium text-slate-100">Visual Style Summary</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.visualStylePerformance.map((row: VisualStyleRow) => (
              <div key={row.visualMode} className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{row.displayName}</p>
                    <p className="text-[11px] text-slate-500">{row.visualMode}</p>
                  </div>
                  <SufficiencyBadge level={row.sufficiency} />
                </div>
                <div className="mt-2 flex gap-4 text-xs text-slate-400">
                  <span><span className="text-slate-500">Gen</span> <span className="text-slate-200">{row.totalCount}</span></span>
                  <span><span className="text-slate-500">Pub</span> <span className="text-slate-200">{row.publishedCount}</span></span>
                  <span><span className="text-slate-500">Views</span> <span className="text-slate-200">{formatNumber(row.totalViews)}</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buddhist visual color note */}
      {profile === "phat_phap" && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-slate-400" />
            <p className="text-sm font-medium text-slate-100">Visual Color Analysis</p>
          </div>
          <p className="text-sm text-slate-400">
            Colorful / bright · Muted / dark · Buddha statue · Lotus / water · Temple / incense · Human-life scene · Generic AI poster
          </p>
          <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-950/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-slate-500" />
              <p className="text-xs text-slate-500">
                Không đủ visual metadata để phân loại tự động. Các trường{" "}
                <code className="rounded bg-slate-800 px-1 text-slate-400">image_paths</code> và{" "}
                <code className="rounded bg-slate-800 px-1 text-slate-400">prompt_versions</code>{" "}
                đều rỗng trong DB. Khi metadata có sẵn, section này sẽ hiển thị breakdown colorful vs muted.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {data.recommendations.length > 0 && (
        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Nhận xét & Khuyến nghị
          </p>
          <div className="space-y-2">
            {data.recommendations.map((item, idx) => (
              <RecommendationCard key={idx} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
