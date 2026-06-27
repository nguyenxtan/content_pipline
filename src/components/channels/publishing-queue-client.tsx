"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Layers3, RefreshCw } from "lucide-react";
import {
  getUploadQueueAction,
  syncPhatPhapQueuePairsAction,
  type UploadQueueRow,
} from "@/actions/social-channels";
import {
  formatRelativeTime,
  formatVietnamAbsolute,
  getChannelLabel,
  getDisplayTitle,
  getFormatMeta,
  getPlatformLabel,
  getStatusMeta,
  isUpcomingStatus,
} from "@/components/channels/publishing-shared";
import type { ContentFormatType } from "@/lib/content-format-type";
import type { PhatPhapQueueSyncResult } from "@/lib/publishing/phat-phap-queue-sync";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type FormatFilter = "all" | "tts_short" | "legacy_quote_short" | "long_video" | "facebook_quote_photo";
type PlatformFilter = "all" | "youtube" | "facebook";
type StatusFilter = "upcoming" | "queued" | "uploading" | "done" | "error" | "cancelled" | "all";

type QueueTask = UploadQueueRow;

type ParentHealthBadge = {
  label: string;
  tone: "good" | "warn" | "danger";
};

type QueueGroup = {
  id: string;
  contentId: string;
  scheduledAt: Date;
  formatType: ContentFormatType;
  title: string;
  workspaceId: string | null;
  workspaceName: string | null;
  channelLabel: string;
  tasks: QueueTask[];
  isPhatPhapVideoItem: boolean;
  expectedPlatforms: string[];
  healthBadges: ParentHealthBadge[];
};

interface Props {
  initialItems: UploadQueueRow[];
}

function getDefaultSyncWindow() {
  const from = new Date(Date.now() - 8 * 60 * 60_000);
  const to = new Date(Date.now() + 72 * 60 * 60_000);
  return { from, to };
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-rose-700/50 bg-rose-950/20 text-rose-300"
          : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function getFormatDisplayLabel(formatType: ContentFormatType): string {
  switch (formatType) {
    case "tts_short":
      return "TTS video";
    case "legacy_quote_short":
      return "Quote video";
    case "facebook_quote_photo":
      return "Facebook photo post";
    case "long_video":
      return "Long video";
    default:
      return "Video";
  }
}

function getTaskLabel(task: QueueTask): string {
  if (task.platform === "youtube" && task.videoType === "short") return "YouTube Short";
  if (task.platform === "facebook" && task.videoType === "short") return "Facebook Reel";
  if (task.platform === "facebook" && task.videoType === "quote") return "Facebook photo post";
  if (task.platform === "youtube" && task.videoType === "long") return "YouTube Long";
  return `${getPlatformLabel(task.platform)} · ${task.videoType}`;
}

function getYouTubeRoutingHint(task: QueueTask): string | null {
  if (task.platform !== "youtube") return null;
  const channelIdHint = task.platformChannelId
    ? task.platformChannelId.slice(0, 10)
    : null;
  const credentialHint = task.oauthClientName
    ? task.oauthClientName
    : task.oauthClientConfigId == null
      ? "env/default credential"
      : `OAuth client #${task.oauthClientConfigId}`;
  const parts = [
    task.channelName,
    channelIdHint ? `channel ${channelIdHint}...` : null,
    credentialHint,
  ].filter(Boolean);
  return parts.join(" · ");
}

function getHealthBadgeClass(tone: ParentHealthBadge["tone"]): string {
  switch (tone) {
    case "good":
      return "border-emerald-700/50 bg-emerald-950/20 text-emerald-300";
    case "warn":
      return "border-amber-700/50 bg-amber-950/20 text-amber-300";
    case "danger":
      return "border-red-700/50 bg-red-950/20 text-red-300";
    default:
      return "border-slate-700 bg-slate-900 text-slate-300";
  }
}

function getTaskSortValue(task: QueueTask): number {
  if (task.platform === "youtube" && task.videoType === "short") return 0;
  if (task.platform === "facebook" && task.videoType === "short") return 1;
  if (task.platform === "facebook" && task.videoType === "quote") return 2;
  return 3;
}

function buildSemanticGroups(items: UploadQueueRow[]): QueueGroup[] {
  const videoRowsByContent = new Map<string, UploadQueueRow[]>();
  const quoteLaneRowsByContent = new Map<string, UploadQueueRow[]>();

  for (const item of items) {
    const isVideoItem =
      item.videoType === "short" &&
      (item.formatType === "tts_short" || item.formatType === "legacy_quote_short");
    if (isVideoItem) {
      const rows = videoRowsByContent.get(item.contentId) ?? [];
      rows.push(item);
      videoRowsByContent.set(item.contentId, rows);
    }
    if (item.platform === "facebook" && item.videoType === "quote") {
      const rows = quoteLaneRowsByContent.get(item.contentId) ?? [];
      rows.push(item);
      quoteLaneRowsByContent.set(item.contentId, rows);
    }
  }

  const groups = new Map<string, QueueGroup>();

  for (const item of items) {
    const laneKey = item.videoType === "quote" ? "quote" : item.videoType === "long" ? "long" : "short";
    const groupKey = `${item.contentId}|${item.scheduledAt.toISOString()}|${laneKey}`;
    const group = groups.get(groupKey);
    if (group) {
      group.tasks.push(item);
      continue;
    }

    const contentVideoRows = videoRowsByContent.get(item.contentId) ?? [];
    const shortSlotKeys = new Set(contentVideoRows.map((row) => row.scheduledAt.toISOString()));
    const hasYoutubeShort = contentVideoRows.some((row) => row.platform === "youtube" && row.videoType === "short");
    const hasFacebookShort = contentVideoRows.some((row) => row.platform === "facebook" && row.videoType === "short");
    const wrongQuoteLaneRows = quoteLaneRowsByContent.get(item.contentId) ?? [];
    const isPhatPhapVideoItem =
      (item.contentChannelKey ?? item.channelKey) === "phat_phap" &&
      item.videoType === "short" &&
      (item.formatType === "tts_short" || item.formatType === "legacy_quote_short");

    const healthBadges: ParentHealthBadge[] = [];
    if (isPhatPhapVideoItem) {
      if (shortSlotKeys.size > 1) {
        healthBadges.push({ label: "Misaligned scheduled_at", tone: "danger" });
      }
      if (!hasYoutubeShort) {
        healthBadges.push({ label: "Missing YouTube Short", tone: "danger" });
      }
      if (!hasFacebookShort) {
        healthBadges.push({ label: "Missing Facebook Reel", tone: "danger" });
      }
      if (wrongQuoteLaneRows.length > 0 && item.formatType === "legacy_quote_short") {
        healthBadges.push({ label: "Wrong lane: facebook/quote", tone: "warn" });
      }
      if (healthBadges.length === 0) {
        healthBadges.push({ label: "Complete pair", tone: "good" });
      }
    }

    groups.set(groupKey, {
      id: groupKey,
      contentId: item.contentId,
      scheduledAt: item.scheduledAt,
      formatType: item.formatType,
      title: getDisplayTitle(item),
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName,
      channelLabel: getChannelLabel(item),
      tasks: [item],
      isPhatPhapVideoItem,
      expectedPlatforms: isPhatPhapVideoItem ? ["YouTube Short", "Facebook Reel"] : [],
      healthBadges,
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      tasks: group.tasks.slice().sort((left, right) => {
        const sortDelta = getTaskSortValue(left) - getTaskSortValue(right);
        if (sortDelta !== 0) return sortDelta;
        return left.createdAt.getTime() - right.createdAt.getTime();
      }),
    }))
    .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
}

export function PublishingQueueClient({ initialItems }: Props) {
  const searchParams = useSearchParams();
  const [items, setItems] = useState(initialItems);
  const [loading, setLoading] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncApplying, setSyncApplying] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncPreview, setSyncPreview] = useState<PhatPhapQueueSyncResult | null>(null);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("upcoming");
  const initialWorkspace = searchParams.get("workspace") ?? "all";
  const [workspaceFilter, setWorkspaceFilter] = useState(initialWorkspace);

  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await getUploadQueueAction({ limit: 300 });
    setItems(rows);
    setLoading(false);
  }, []);

  const openSyncPreview = useCallback(async () => {
    setSyncDialogOpen(true);
    setSyncLoading(true);
    setSyncApplying(false);
    setSyncError(null);
    try {
      const window = getDefaultSyncWindow();
      const preview = await syncPhatPhapQueuePairsAction({
        from: window.from,
        to: window.to,
        apply: false,
      });
      setSyncPreview(preview);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncLoading(false);
    }
  }, []);

  const applySync = useCallback(async () => {
    setSyncApplying(true);
    setSyncError(null);
    try {
      const window = getDefaultSyncWindow();
      const result = await syncPhatPhapQueuePairsAction({
        from: window.from,
        to: window.to,
        apply: true,
      });
      setSyncPreview(result);
      await reload();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncApplying(false);
    }
  }, [reload]);

  useEffect(() => {
    const timer = setInterval(reload, 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  const workspaceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) {
      if (!item.workspaceId || !item.workspaceName) continue;
      if (!seen.has(item.workspaceId)) seen.set(item.workspaceId, item.workspaceName);
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));
  }, [items]);

  const semanticGroups = useMemo(() => buildSemanticGroups(items), [items]);

  // Slot collisions: same (platform, videoType, scheduledAt) occupied by >1 active row.
  const collisionKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of items) {
      if (task.status !== "queued" && task.status !== "uploading" && task.status !== "done") continue;
      const key = `${task.platform}|${task.videoType}|${task.scheduledAt.toISOString()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [items]);

  const filteredGroups = useMemo(() => {
    return semanticGroups.filter((group) => {
      if (formatFilter !== "all" && group.formatType !== formatFilter) return false;
      if (platformFilter !== "all" && !group.tasks.some((task) => task.platform === platformFilter)) return false;
      if (workspaceFilter !== "all" && group.workspaceId !== workspaceFilter) return false;
      if (statusFilter === "upcoming") return group.tasks.some((task) => isUpcomingStatus(task.status));
      if (statusFilter !== "all" && !group.tasks.some((task) => task.status === statusFilter)) return false;
      return true;
    });
  }, [semanticGroups, formatFilter, platformFilter, workspaceFilter, statusFilter]);

  const nextUpcomingGroupId = useMemo(() => {
    return filteredGroups.find((group) => group.tasks.some((task) => isUpcomingStatus(task.status)))?.id ?? null;
  }, [filteredGroups]);

  const queuedTaskCount = items.filter((item) => item.status === "queued" || item.status === "pending").length;
  const uploadingTaskCount = items.filter((item) => item.status === "uploading").length;
  const activeContentItemCount = semanticGroups.filter((group) =>
    group.tasks.some((task) => isUpcomingStatus(task.status)),
  ).length;
  const needsAttentionCount = semanticGroups.filter((group) =>
    group.healthBadges.some((badge) => badge.tone !== "good") ||
    group.tasks.some((task) => task.status === "error"),
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">Hàng chờ</h1>
          <p className="text-sm text-slate-400">
            Mỗi thẻ dưới đây là một content item theo giờ VN. Một item có thể có nhiều delivery task cùng giờ, ví dụ YouTube Short và Facebook Reel cho cùng một video.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Làm mới dữ liệu
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-cyan-800/30 bg-cyan-950/10 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-cyan-100">
            Phật Pháp queue sync chỉ áp dụng cho future short/reel rows. Facebook photo-post lane vẫn đứng riêng và không bị đụng vào.
          </p>
          <p className="text-xs text-cyan-300/80">
            Preview trước, chỉ apply các create/align an toàn. Row done/published, collision mơ hồ, hoặc wrong lane sẽ fail-closed sang manual review.
          </p>
        </div>
        <button
          type="button"
          onClick={openSyncPreview}
          disabled={syncLoading || syncApplying}
          className="inline-flex items-center justify-center rounded-xl border border-cyan-700/40 bg-cyan-900/20 px-3 py-2 text-sm font-medium text-cyan-200 transition-colors hover:border-cyan-600/60 hover:bg-cyan-900/30 disabled:opacity-40"
        >
          Sync phat_phap Queue
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-amber-800/30 bg-amber-950/10 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-amber-100">
          Queue page đang hiển thị theo content item trước, delivery task sau. Facebook photo post là lane riêng, không phải Quote video.
        </p>
        <Link
          href="/publishing/mixer"
          className="inline-flex items-center justify-center rounded-xl border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-sm font-medium text-amber-200 transition-colors hover:border-amber-600/60 hover:bg-amber-900/30"
        >
          Lập lịch trộn
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Active content items", value: activeContentItemCount },
          { label: "Queued tasks", value: queuedTaskCount },
          { label: "Uploading tasks", value: uploadingTaskCount },
          { label: "Needs attention", value: needsAttentionCount },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-100">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Workspace</p>
          <div className="flex flex-wrap gap-2">
            <FilterChip active={workspaceFilter === "all"} onClick={() => setWorkspaceFilter("all")}>All</FilterChip>
            {workspaceOptions.map((option) => (
              <FilterChip
                key={option.value}
                active={workspaceFilter === option.value}
                onClick={() => setWorkspaceFilter(option.value)}
              >
                {option.label}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Content type</p>
          <div className="flex flex-wrap gap-2">
            <FilterChip active={formatFilter === "all"} onClick={() => setFormatFilter("all")}>All</FilterChip>
            <FilterChip active={formatFilter === "tts_short"} onClick={() => setFormatFilter("tts_short")}>TTS video</FilterChip>
            <FilterChip active={formatFilter === "legacy_quote_short"} onClick={() => setFormatFilter("legacy_quote_short")}>Quote video</FilterChip>
            <FilterChip active={formatFilter === "long_video"} onClick={() => setFormatFilter("long_video")}>Long video</FilterChip>
            <FilterChip active={formatFilter === "facebook_quote_photo"} onClick={() => setFormatFilter("facebook_quote_photo")}>Facebook photo post</FilterChip>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Nền tảng</p>
          <div className="flex flex-wrap gap-2">
            <FilterChip active={platformFilter === "all"} onClick={() => setPlatformFilter("all")}>All</FilterChip>
            <FilterChip active={platformFilter === "youtube"} onClick={() => setPlatformFilter("youtube")}>YouTube</FilterChip>
            <FilterChip active={platformFilter === "facebook"} onClick={() => setPlatformFilter("facebook")}>Facebook</FilterChip>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Trạng thái</p>
          <div className="flex flex-wrap gap-2">
            <FilterChip active={statusFilter === "upcoming"} onClick={() => setStatusFilter("upcoming")}>Upcoming</FilterChip>
            <FilterChip active={statusFilter === "queued"} onClick={() => setStatusFilter("queued")}>Queued</FilterChip>
            <FilterChip active={statusFilter === "uploading"} onClick={() => setStatusFilter("uploading")}>Uploading</FilterChip>
            <FilterChip active={statusFilter === "done"} onClick={() => setStatusFilter("done")}>Done</FilterChip>
            <FilterChip active={statusFilter === "error"} onClick={() => setStatusFilter("error")}>Error</FilterChip>
            <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</FilterChip>
          </div>
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-14 text-slate-600">
          <Layers3 className="h-10 w-10" />
          <p className="text-sm font-medium text-slate-400">Không có content item nào khớp bộ lọc hiện tại</p>
          <div className="space-y-1 text-center text-xs text-slate-600">
            <p>Tổng content items: <span className="text-slate-400">{semanticGroups.length}</span></p>
            <p>Tổng delivery tasks: <span className="text-slate-400">{items.length}</span></p>
            <p>Bộ lọc hiện tại đang ẩn hết dữ liệu.</p>
          </div>
          {(statusFilter !== "upcoming" || platformFilter !== "all" || formatFilter !== "all" || workspaceFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter("upcoming");
                setPlatformFilter("all");
                setFormatFilter("all");
                setWorkspaceFilter("all");
              }}
              className="text-xs text-rose-400 hover:text-rose-300 underline"
            >
              Đặt lại bộ lọc
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((group) => {
            const format = getFormatMeta(group.formatType);
            const isNext = group.id === nextUpcomingGroupId;
            const hasErrorTask = group.tasks.some((task) => task.status === "error");

            return (
              <div key={group.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {isNext && (
                        <span className="rounded-full border border-rose-700/50 bg-rose-950/20 px-2 py-0.5 text-[11px] font-medium text-rose-300">
                          Kế tiếp
                        </span>
                      )}
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${format.badge}`}>
                        {getFormatDisplayLabel(group.formatType)}
                      </span>
                      {group.healthBadges.map((badge) => (
                        <span
                          key={badge.label}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${getHealthBadgeClass(badge.tone)}`}
                        >
                          {badge.tone === "good" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          {badge.label}
                        </span>
                      ))}
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400">
                        {group.tasks.length} delivery task{group.tasks.length > 1 ? "s" : ""}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <p className="text-base font-semibold text-slate-100">{group.title}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-500" />
                          {formatVietnamAbsolute(group.scheduledAt)} VN
                        </span>
                        <span>{formatRelativeTime(group.scheduledAt)}</span>
                        <span>{group.channelLabel}</span>
                        {group.workspaceName && (
                          <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                            {group.workspaceName}
                          </span>
                        )}
                      </div>
                      {group.isPhatPhapVideoItem && (
                        <p className="text-xs text-slate-500">
                          Required delivery pair: {group.expectedPlatforms.join(" + ")}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-slate-500 lg:text-right">
                    <p>contentId: <span className="text-slate-300">{group.contentId}</span></p>
                    {hasErrorTask && (
                      <p className="mt-2 text-red-300/90">Có task lỗi trong content item này. Xem chi tiết ở danh sách delivery bên dưới.</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Delivery tasks</p>
                  {group.tasks.map((task) => {
                    const status = getStatusMeta(task.status);
                    const StatusIcon = status.icon;
                    const youtubeRoutingHint = getYouTubeRoutingHint(task);
                    return (
                      <div
                        key={task.id}
                        className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-100">{getTaskLabel(task)}</span>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${status.badge}`}>
                              <StatusIcon className={`h-3 w-3 ${task.status === "uploading" ? "animate-spin" : ""}`} />
                              {status.label}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                            <span>{getChannelLabel(task)}</span>
                            <span>{task.videoType}</span>
                            <span>{formatVietnamAbsolute(task.scheduledAt)} VN</span>
                          </div>
                          {youtubeRoutingHint && (
                            <p className="text-xs text-slate-500">
                              Target: {youtubeRoutingHint}
                            </p>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 lg:text-right">
                          <p>queueId: <span className="text-slate-300">{task.id}</span></p>
                          {task.errorMessage && (
                            <p className={`mt-1 max-w-md ${task.status === "error" ? "text-red-300/90" : "text-amber-300/90"}`}>
                              {task.status === "error" ? task.errorMessage : `Deferred/retry reason: ${task.errorMessage}`}
                            </p>
                          )}
                          {collisionKeys.has(`${task.platform}|${task.videoType}|${task.scheduledAt.toISOString()}`) && (
                            <p className="mt-1 text-amber-400">⚠ Slot collision — another active row shares this exact scheduled time</p>
                          )}
                          {(() => {
                            const minute = task.scheduledAt.getUTCMinutes();
                            const expectedMinute = task.videoType === "quote" ? 5 : 0;
                            const hasSubMinutePrecision =
                              task.scheduledAt.getUTCSeconds() !== 0 || task.scheduledAt.getUTCMilliseconds() !== 0;
                            if (minute === expectedMinute && !hasSubMinutePrecision) return null;
                            return (
                              <p className="mt-1 text-amber-400">
                                ⚠ Non-canonical schedule time (expected :{String(expectedMinute).padStart(2, "0")}:00 for {task.videoType})
                              </p>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={syncDialogOpen} onOpenChange={setSyncDialogOpen}>
        <AlertDialogContent className="max-w-4xl bg-slate-900 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-100">Sync phat_phap Queue</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Preview trước, chỉ apply safe future queued/pending short/reel rows. `facebook/quote` lane không nằm trong flow này.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {syncLoading ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
              Đang tải preview sync plan...
            </div>
          ) : syncError ? (
            <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-4 text-sm text-red-200">
              {syncError}
            </div>
          ) : syncPreview ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Safe creates", value: syncPreview.summary.safeCreates },
                  { label: "Safe aligns", value: syncPreview.summary.safeAligns },
                  { label: "Manual review", value: syncPreview.summary.manualReview },
                  { label: "Unsafe skipped", value: syncPreview.summary.unsafeSkipped },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{stat.label}</p>
                    <p className="mt-2 text-xl font-semibold text-slate-100">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
                <p>Window: {syncPreview.window.fromVn} → {syncPreview.window.toVn}</p>
                <p>Affected slots: {syncPreview.affectedSlotsVn.join(", ") || "Không có safe slot nào để apply"}</p>
                {syncPreview.mode === "apply" && (
                  <p className="mt-2 text-cyan-200">
                    Applied {syncPreview.applyResult.applied} action(s), created {syncPreview.applyResult.created}, aligned {syncPreview.applyResult.aligned}, state_changed {syncPreview.applyResult.stateChanged}.
                  </p>
                )}
              </div>

              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-2">
                {syncPreview.items.map((item) => (
                  <div key={item.contentId} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{item.title}</p>
                        <p className="text-xs text-slate-400">
                          {item.formatType} · {item.contentId}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-200">
                          {item.diagnosis}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 ${item.safeToApply ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-300" : "border-amber-700/50 bg-amber-950/20 text-amber-300"}`}>
                          {item.proposedAction}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-400 lg:grid-cols-2">
                      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                        <p className="font-medium text-slate-200">Current YouTube</p>
                        <p>{item.currentYoutubeRow ? `${item.currentYoutubeRow.status} · ${item.currentYoutubeRow.scheduledAtVn}` : "Missing"}</p>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                        <p className="font-medium text-slate-200">Current Facebook</p>
                        <p>{item.currentFacebookRow ? `${item.currentFacebookRow.status} · ${item.currentFacebookRow.scheduledAtVn}` : "Missing"}</p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-400">
                      <p>Before: {item.currentScheduledAtVn ?? "—"}</p>
                      <p>After: {item.targetScheduledAtVn ?? "—"}</p>
                      <p className="text-slate-300">{item.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
              Chưa có preview.
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-100">Đóng</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void applySync();
              }}
              disabled={syncLoading || syncApplying || !syncPreview || (syncPreview.summary.safeCreates + syncPreview.summary.safeAligns === 0)}
              className="bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-40"
            >
              {syncApplying ? "Đang apply..." : "Apply Safe Sync"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
