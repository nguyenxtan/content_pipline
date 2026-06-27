"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock3,
  Link2,
  ListOrdered,
  Loader2,
  PlayCircle,
  RadioTower,
  Sparkles,
  ShieldCheck,
  Tag,
  ThumbsUp,
} from "lucide-react";
import { suggestWorkspaceTopicsAction } from "@/actions/channel-workspace";
import type { ContentFormatType } from "@/lib/content-format-type";
import type { ChannelWorkspace, ResolvedTopicFamily } from "@/lib/channel-workspace-registry";
import { AUDIENCE_PROFILES } from "@/lib/prompt-studio-registry";
import {
  formatVietnamAbsolute,
  getFormatMeta,
  getPlatformLabel,
  getStatusMeta,
  isUpcomingStatus,
} from "@/components/channels/publishing-shared";

const FORMAT_LABELS: Record<string, string> = {
  tts_short: "TTS Short",
  legacy_quote_short: "Quote Short",
  long_video: "Long Video",
  facebook_quote_photo: "FB Photo",
};

const PRIORITY_CLS: Record<string, string> = {
  high: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  low: "border-slate-600 bg-slate-800 text-slate-400",
};

type WorkspaceTopicSuggestion = {
  topic: string;
  familyId: string;
  familyLabel: string;
  rationale: string;
};

type WorkspaceOperationalItem = {
  queueId: string;
  workspaceId: string;
  workspaceName: string;
  scheduledAt: Date;
  platform: string;
  channelName: string;
  status: string;
  videoType: string;
  formatType: string;
  title: string;
  topic: string;
};

type WorkspaceOperationalSummary = {
  workspaceId: string;
  workspaceName: string;
  promptProfileId: string;
  readyContentCount: number;
  queuedCount: number;
  doneTodayCount: number;
  errorCount: number;
  nextScheduledPost: WorkspaceOperationalItem | null;
  scheduleItems: WorkspaceOperationalItem[];
};

type TangSauQueuedReviewItem = {
  queueId: string;
  contentId: string;
  scheduledAt: Date;
  scheduledAtVn: string;
  topic: string;
  quoteText: string;
  mainQuote: string;
  reflectionText: string | null;
  status: string;
  youtubeChannel: string;
  profileVerified: boolean;
  duplicateMotifWarnings: string[];
  buddhistWordingWarnings: string[];
  sidecarWorkspaceId: string | null;
  sidecarChannelProfileId: string | null;
  sidecarTopicFamily: string | null;
  channelKey: string | null;
  contentProfileKey: string | null;
  formatType: string | null;
};

function TopicSuggestions({ workspaceId }: { workspaceId: string }) {
  const [isPending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<WorkspaceTopicSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const run = () => {
    setError(null);
    setShown(true);
    startTransition(async () => {
      const result = await suggestWorkspaceTopicsAction(workspaceId, 6);
      if (!result.ok) {
        setError(result.error ?? "Không thể gợi ý chủ đề.");
      } else {
        setSuggestions(result.suggestions);
      }
    });
  };

  if (!shown) {
    return (
      <button
        type="button"
        onClick={run}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500"
      >
        <Sparkles className="h-3 w-3 text-rose-400" />
        Gợi ý chủ đề AI (preview)
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-rose-400" />
        <span className="text-xs font-medium text-slate-300">Gợi ý chủ đề AI</span>
        <span className="text-xs text-slate-600">(preview-only, không tự lưu)</span>
        <button
          type="button"
          onClick={run}
          disabled={isPending}
          className="ml-auto inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Làm mới"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {isPending && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          Đang gợi ý…
        </div>
      )}

      {!isPending && suggestions.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {suggestions.map((suggestion, index) => (
            <div key={`${suggestion.familyId}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
              <p className="text-xs font-medium text-slate-200">{suggestion.topic}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{suggestion.familyLabel}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceCard({
  workspace,
  families,
  summary,
}: {
  workspace: ChannelWorkspace;
  families: ResolvedTopicFamily[];
  summary?: WorkspaceOperationalSummary;
}) {
  const [expanded, setExpanded] = useState(false);

  const enabledFormats = Object.entries(workspace.defaultFormats)
    .filter(([, value]) => value)
    .map(([key]) => key);

  const mix = workspace.formatMix;
  const totalMixWeight = mix.ttsShortWeight + mix.quoteShortWeight + mix.longWeight;
  const todaySchedule = (summary?.scheduleItems ?? [])
    .filter((item) => isUpcomingStatus(item.status) || item.status === "done")
    .slice(0, 10);
  const nextPost = summary?.nextScheduledPost ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                workspace.status === "active"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-600 bg-slate-800 text-slate-400"
              }`}
            >
              <Activity className="h-3 w-3" />
              {workspace.status === "active" ? "Active" : "Paused"}
            </span>
            <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs text-rose-300">
              {workspace.promptProfileId}
            </span>
            {workspace.platformAccounts.map((account) => (
              <span
                key={`${account.platform}-${account.platformChannelId}`}
                className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-xs text-slate-300"
              >
                {account.platform === "youtube" ? (
                  <PlayCircle className="h-3 w-3 text-red-400" />
                ) : (
                  <ThumbsUp className="h-3 w-3 text-blue-400" />
                )}
                {account.displayName}
              </span>
            ))}
          </div>
          <h2 className="text-base font-semibold text-slate-100">{workspace.displayName}</h2>
          <p className="text-xs leading-5 text-slate-400">{workspace.description}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="shrink-0 pt-1 text-slate-500 transition-colors hover:text-slate-300"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-800 border-t border-slate-800 text-xs">
        <div className="px-4 py-3">
          <p className="text-slate-500">Formats</p>
          <p className="mt-1 font-medium text-slate-200">
            {enabledFormats.map((format) => FORMAT_LABELS[format] ?? format).join(", ") || "—"}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-slate-500">Mix</p>
          <p className="mt-1 font-medium text-slate-200">
            {totalMixWeight > 0 ? `TTS ${mix.ttsShortWeight} · Quote ${mix.quoteShortWeight}` : "—"}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-slate-500">Lịch đăng</p>
          <p className="mt-1 font-medium text-slate-200">
            {workspace.schedulePlan.postingWindows[0]?.start}–{workspace.schedulePlan.postingWindows[0]?.end}
            {" · "}
            {workspace.schedulePlan.intervalMinutes / 60}h
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-slate-800 bg-slate-800 sm:grid-cols-5">
        {[
          { label: "Ready content", value: summary?.readyContentCount ?? 0 },
          { label: "Queued", value: summary?.queuedCount ?? 0 },
          { label: "Done hôm nay", value: summary?.doneTodayCount ?? 0 },
          { label: "Error", value: summary?.errorCount ?? 0 },
          {
            label: "Kế tiếp",
            value: nextPost ? formatVietnamAbsolute(nextPost.scheduledAt, false) : "—",
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-slate-900/60 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">{stat.label}</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </div>

      {(() => {
        const audience = AUDIENCE_PROFILES.find((p) => p.channelProfileId === workspace.promptProfileId);
        if (!audience) return null;
        return (
          <div className="border-t border-slate-800 px-5 py-4">
            <div className="mb-2 flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5 text-amber-400" />
              <p className="text-xs font-medium uppercase tracking-wide text-slate-300">Audience Profile</p>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                {audience.id}
              </span>
              {audience.ageRange && (
                <span className="text-[10px] text-slate-500">{audience.ageRange} tuổi</span>
              )}
            </div>
            <p className="text-xs text-slate-400">{audience.audienceDescription}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">Nỗi đau chính</p>
                <div className="flex flex-wrap gap-1">
                  {audience.audiencePainPoints.slice(0, 3).map((pt) => (
                    <span key={pt} className="rounded-full border border-rose-500/20 bg-rose-500/5 px-2 py-0.5 text-[10px] text-rose-300">
                      {pt}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">Visual ưu tiên</p>
                <div className="flex flex-wrap gap-1">
                  {audience.visualPreference.slice(0, 3).map((v) => (
                    <span key={v} className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[10px] text-emerald-300">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {!!todaySchedule.length && (
        <div className="border-t border-slate-800 px-5 py-4">
          <div className="mb-2 flex items-center gap-2">
            <Clock3 className="h-3.5 w-3.5 text-slate-400" />
            <p className="text-xs font-medium uppercase tracking-wide text-slate-300">Lịch gần nhất</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {todaySchedule.map((item) => {
              const status = getStatusMeta(item.status);
              return (
                <span
                  key={item.queueId}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${status.badge}`}
                >
                  {formatVietnamAbsolute(item.scheduledAt, false)}
                  <span className="text-slate-300">·</span>
                  {item.channelName}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {expanded && (
        <div className="space-y-4 border-t border-slate-800 px-5 pb-5 pt-4">
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <Tag className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-xs font-medium uppercase tracking-wide text-slate-300">Topic Families</p>
            </div>
            <div className="space-y-1.5">
              {families.map((family) => (
                <div
                  key={family.familyId}
                  className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5"
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${PRIORITY_CLS[family.priority]}`}
                  >
                    {family.priority}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-100">{family.label}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{family.description}</p>
                    {family.exampleTopics.length > 0 && (
                      <p className="mt-1 text-[11px] italic text-slate-600">
                        eg. {family.exampleTopics.slice(0, 2).join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-xs font-medium uppercase tracking-wide text-slate-300">Kế hoạch đăng</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {[
                { label: "Timezone", value: workspace.schedulePlan.timezone },
                { label: "Interval", value: `${workspace.schedulePlan.intervalMinutes} phút` },
                { label: "Max/ngày", value: `${workspace.schedulePlan.maxDailyPosts} bài` },
                { label: "Platforms", value: workspace.schedulePlan.platforms.join(", ") },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                  <p className="text-slate-500">{label}</p>
                  <p className="mt-1 font-medium text-slate-200">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {!!summary?.nextScheduledPost && (
            <div>
              <div className="mb-2.5 flex items-center gap-2">
                <RadioTower className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-xs font-medium uppercase tracking-wide text-slate-300">Operational state</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-rose-700/50 bg-rose-950/20 px-2 py-0.5 text-[11px] text-rose-300">
                    Kế tiếp
                  </span>
                  <span className="text-xs text-slate-400">
                    {formatVietnamAbsolute(summary.nextScheduledPost.scheduledAt)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {getPlatformLabel(summary.nextScheduledPost.platform)} · {summary.nextScheduledPost.channelName}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-100">
                  {summary.nextScheduledPost.topic || summary.nextScheduledPost.title}
                </p>
              </div>
            </div>
          )}

          <TopicSuggestions workspaceId={workspace.workspaceId} />
        </div>
      )}
    </div>
  );
}

function WorkspaceScheduleSection({
  workspaces,
  scheduleItems,
}: {
  workspaces: ChannelWorkspace[];
  scheduleItems: WorkspaceOperationalItem[];
}) {
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");

  const filtered = scheduleItems.filter((item) =>
    workspaceFilter === "all" ? true : item.workspaceId === workspaceFilter,
  );

  const visibleItems = filtered
    .filter((item) => isUpcomingStatus(item.status) || item.status === "done")
    .slice(0, 24);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-rose-400" />
            <h2 className="text-base font-semibold text-slate-100">Workspace schedule</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Lịch đăng gần nhất của từng workspace. Mặc định hiển thị bài sắp tới trước để nhìn nhanh bài nào lên trước, ở đâu và trạng thái hiện tại.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={workspaceFilter === "all" ? "/publishing/queue" : `/publishing/queue?workspace=${workspaceFilter}`}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          >
            <ListOrdered className="h-3.5 w-3.5" />
            Xem trong Hàng chờ
          </Link>
          <Link
            href={workspaceFilter === "all" ? "/publishing/calendar" : `/publishing/calendar?workspace=${workspaceFilter}`}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Xem lịch theo ngày
          </Link>
          <Link
            href="/publishing/mixer"
            className="inline-flex items-center gap-2 rounded-xl border border-rose-700/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300 transition-colors hover:border-rose-600/60"
          >
            <Link2 className="h-3.5 w-3.5" />
            Lập lịch trộn
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setWorkspaceFilter("all")}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            workspaceFilter === "all"
              ? "border-rose-700/50 bg-rose-950/20 text-rose-300"
              : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200"
          }`}
        >
          All
        </button>
        {workspaces.map((workspace) => (
          <button
            key={workspace.workspaceId}
            type="button"
            onClick={() => setWorkspaceFilter(workspace.workspaceId)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              workspaceFilter === workspace.workspaceId
                ? "border-rose-700/50 bg-rose-950/20 text-rose-300"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200"
            }`}
          >
            {workspace.displayName}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {visibleItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/30 px-4 py-8 text-center text-sm text-slate-500">
            Chưa có lịch nào khớp bộ lọc workspace hiện tại.
          </div>
        ) : (
          visibleItems.map((item, index) => {
            const format = getFormatMeta(item.formatType as ContentFormatType);
            const status = getStatusMeta(item.status);
            const isNext = index === 0 && isUpcomingStatus(item.status);
            return (
              <div key={item.queueId} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isNext && (
                        <span className="rounded-full border border-rose-700/50 bg-rose-950/20 px-2 py-0.5 text-[11px] text-rose-300">
                          Kế tiếp
                        </span>
                      )}
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                        {item.workspaceName}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${format.badge}`}>
                        {format.label}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.badge}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-100">{item.topic || item.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatVietnamAbsolute(item.scheduledAt)} · {getPlatformLabel(item.platform)} · {item.channelName}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">Queue #{item.queueId.slice(0, 8)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function TangSauQueuedReviewSection({
  items,
}: {
  items: TangSauQueuedReviewItem[];
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-rose-400" />
            <h2 className="text-base font-semibold text-slate-100">Tầng Sâu queued review</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Review read-only tất cả Quote Short đang chờ đăng cho YouTube · Tầng Sâu. Màn này giúp mình nhìn nhanh profile có đúng không, có warning motif lặp hay wording kiểu Buddhist không trước khi cron publish.
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
          {items.length} queued item{items.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/30 px-4 py-8 text-center text-sm text-slate-500">
            Chưa có queued Quote Short nào cho Tầng Sâu.
          </div>
        ) : (
          items.map((item, index) => {
            const status = getStatusMeta(item.status);
            const hasWarnings =
              item.duplicateMotifWarnings.length > 0 || item.buddhistWordingWarnings.length > 0 || !item.profileVerified;
            return (
              <article key={item.queueId} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {index === 0 && (
                        <span className="rounded-full border border-rose-700/50 bg-rose-950/20 px-2 py-0.5 text-[11px] text-rose-300">
                          Kế tiếp
                        </span>
                      )}
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.badge}`}>
                        {status.label}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                        {item.youtubeChannel}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          item.profileVerified
                            ? "border-emerald-600/40 bg-emerald-950/20 text-emerald-300"
                            : "border-amber-600/40 bg-amber-950/20 text-amber-300"
                        }`}
                      >
                        profileVerified: {item.profileVerified ? "true" : "false"}
                      </span>
                      {hasWarnings && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/40 bg-amber-950/20 px-2 py-0.5 text-[11px] text-amber-300">
                          <AlertTriangle className="h-3 w-3" />
                          Cần review
                        </span>
                      )}
                    </div>

                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-slate-500">Lịch VN · {item.scheduledAtVn}</p>
                      <p className="text-sm font-semibold text-slate-100">{item.topic}</p>
                      <p className="text-sm leading-6 text-slate-300">{item.mainQuote}</p>
                      {item.reflectionText && (
                        <p className="text-sm leading-6 text-slate-500">{item.reflectionText}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-2 text-xs lg:min-w-[260px]">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5 text-slate-400">
                      <p>
                        <span className="text-slate-500">contentId:</span> {item.contentId}
                      </p>
                      <p className="mt-1">
                        <span className="text-slate-500">queueId:</span> {item.queueId}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5 text-slate-400">
                      <p>
                        <span className="text-slate-500">workspace:</span> {item.sidecarWorkspaceId ?? "missing"}
                      </p>
                      <p className="mt-1">
                        <span className="text-slate-500">profile:</span> {item.sidecarChannelProfileId ?? "missing"}
                      </p>
                      <p className="mt-1">
                        <span className="text-slate-500">topicFamily:</span> {item.sidecarTopicFamily ?? "missing"}
                      </p>
                      <p className="mt-1">
                        <span className="text-slate-500">channelKey:</span> {item.channelKey ?? "missing"}
                      </p>
                      <p className="mt-1">
                        <span className="text-slate-500">contentProfileKey:</span> {item.contentProfileKey ?? "missing"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {item.duplicateMotifWarnings.length > 0 ? (
                    item.duplicateMotifWarnings.map((warning) => (
                      <span
                        key={`${item.queueId}-${warning}`}
                        className="rounded-full border border-amber-600/40 bg-amber-950/20 px-2 py-0.5 text-[11px] text-amber-300"
                      >
                        duplicate motif: {warning}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400">
                      duplicate motif: none
                    </span>
                  )}

                  {item.buddhistWordingWarnings.length > 0 ? (
                    item.buddhistWordingWarnings.map((warning) => (
                      <span
                        key={`${item.queueId}-${warning}`}
                        className="rounded-full border border-amber-600/40 bg-amber-950/20 px-2 py-0.5 text-[11px] text-amber-300"
                      >
                        Buddhist wording: {warning}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400">
                      Buddhist wording: none
                    </span>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

export function WorkspaceList({
  workspaces,
  familiesByWorkspace,
  summaries,
  scheduleItems,
  tangSauQueuedReview,
}: {
  workspaces: ChannelWorkspace[];
  familiesByWorkspace: Record<string, ResolvedTopicFamily[]>;
  summaries: WorkspaceOperationalSummary[];
  scheduleItems: WorkspaceOperationalItem[];
  tangSauQueuedReview: TangSauQueuedReviewItem[];
}) {
  if (workspaces.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 py-16 text-center text-slate-500">
        Chưa có workspace nào được cấu hình.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {workspaces.map((workspace) => (
          <WorkspaceCard
            key={workspace.workspaceId}
            workspace={workspace}
            families={familiesByWorkspace[workspace.workspaceId] ?? []}
            summary={summaries.find((summary) => summary.workspaceId === workspace.workspaceId)}
          />
        ))}
      </div>
      <TangSauQueuedReviewSection items={tangSauQueuedReview} />
      <WorkspaceScheduleSection workspaces={workspaces} scheduleItems={scheduleItems} />
    </div>
  );
}
