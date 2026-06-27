"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { UploadQueueRow } from "@/actions/social-channels";
import {
  formatRelativeTime,
  formatVietnamDateKey,
  formatVietnamDateLabel,
  formatVietnamTime,
  getChannelLabel,
  getDisplayTitle,
  getFormatMeta,
  getStatusMeta,
  isUpcomingStatus,
} from "@/components/channels/publishing-shared";

interface Props {
  initialItems: UploadQueueRow[];
}

type StatusFilter = "upcoming" | "done" | "error" | "all";
type PlatformFilter = "all" | "youtube" | "facebook";
type FormatFilter = "all" | "tts_short" | "legacy_quote_short" | "long_video" | "facebook_quote_photo";
type QuickView = "today" | "next7" | "upcoming" | "done";

function getCurrentVietnamDateKey(): string {
  return formatVietnamDateKey(new Date());
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDateKey(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
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

export function PublishingCalendarView({ initialItems: items }: Props) {
  const searchParams = useSearchParams();
  const todayKey = getCurrentVietnamDateKey();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("upcoming");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>(searchParams.get("workspace") ?? "all");
  const [quickView, setQuickView] = useState<QuickView>("next7");
  const [anchorDateKey, setAnchorDateKey] = useState<string>(todayKey);

  const channelOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) {
      const value = `${item.platform}|${item.channelId}`;
      if (!seen.has(value)) seen.set(value, getChannelLabel(item));
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));
  }, [items]);

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

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (item.status === "cancelled" && statusFilter !== "all") return false;
      if (statusFilter === "upcoming" && !isUpcomingStatus(item.status)) return false;
      if (statusFilter === "done" && item.status !== "done") return false;
      if (statusFilter === "error" && item.status !== "error") return false;
      if (platformFilter !== "all" && item.platform !== platformFilter) return false;
      if (formatFilter !== "all" && item.formatType !== formatFilter) return false;
      if (channelFilter !== "all" && `${item.platform}|${item.channelId}` !== channelFilter) return false;
      if (workspaceFilter !== "all" && item.workspaceId !== workspaceFilter) return false;
      return true;
    });
  }, [items, statusFilter, platformFilter, formatFilter, channelFilter, workspaceFilter]);

  const grouped = useMemo(() => {
    return filteredItems.reduce<Record<string, UploadQueueRow[]>>((acc, item) => {
      const key = formatVietnamDateKey(item.scheduledAt);
      acc[key] ??= [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [filteredItems]);

  const availableDateKeys = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  const upcomingDateKeys = useMemo(
    () => availableDateKeys.filter((key) => key >= todayKey),
    [availableDateKeys, todayKey],
  );
  const pastDateKeys = useMemo(
    () => availableDateKeys.filter((key) => key < todayKey).sort((a, b) => b.localeCompare(a)),
    [availableDateKeys, todayKey],
  );

  const effectiveAnchor = useMemo(() => {
    if (quickView === "done") {
      return pastDateKeys[0] ?? availableDateKeys[availableDateKeys.length - 1] ?? todayKey;
    }
    if (quickView === "upcoming" || quickView === "next7") {
      return upcomingDateKeys[0] ?? todayKey;
    }
    return anchorDateKey;
  }, [quickView, pastDateKeys, availableDateKeys, todayKey, upcomingDateKeys, anchorDateKey]);

  const visibleDateKeys = useMemo(() => {
    if (quickView === "today") {
      return availableDateKeys.filter((key) => key === todayKey);
    }
    if (quickView === "upcoming") {
      return upcomingDateKeys;
    }
    if (quickView === "done") {
      const start = shiftDateKey(effectiveAnchor, -6);
      return pastDateKeys.filter((key) => key >= start && key <= effectiveAnchor);
    }
    const end = shiftDateKey(effectiveAnchor, 6);
    return availableDateKeys.filter((key) => key >= effectiveAnchor && key <= end);
  }, [quickView, availableDateKeys, upcomingDateKeys, pastDateKeys, effectiveAnchor, todayKey]);

  const orderedVisibleKeys = useMemo(() => {
    if (quickView === "done") {
      return visibleDateKeys.slice().sort((a, b) => b.localeCompare(a));
    }
    const upcoming = visibleDateKeys.filter((key) => key >= todayKey).sort();
    const past = visibleDateKeys.filter((key) => key < todayKey).sort((a, b) => b.localeCompare(a));
    return [...upcoming, ...past];
  }, [visibleDateKeys, quickView, todayKey]);

  const visibleItemsCount = orderedVisibleKeys.reduce((sum, key) => sum + (grouped[key]?.length ?? 0), 0);
  const nextScheduledItem = filteredItems
    .filter((item) => isUpcomingStatus(item.status))
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];

  const dateRangeLabel = useMemo(() => {
    if (orderedVisibleKeys.length === 0) return "Không có lịch trong cửa sổ hiện tại";
    if (orderedVisibleKeys.length === 1) return formatVietnamDateLabel(parseDateKey(orderedVisibleKeys[0]));
    const first = formatVietnamDateLabel(parseDateKey(orderedVisibleKeys[0]));
    const last = formatVietnamDateLabel(parseDateKey(orderedVisibleKeys[orderedVisibleKeys.length - 1]));
    return `${first} → ${last}`;
  }, [orderedVisibleKeys]);

  const canPrev = quickView === "next7" || quickView === "done";
  const canNext = quickView === "next7" || quickView === "done";

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-100">Lịch theo ngày</h1>
        <p className="text-sm text-slate-400">
          Cùng một hàng chờ, nhưng gom lại theo ngày và giờ Việt Nam để nhìn nhịp đăng gần nhất trước, thay vì cuộn qua toàn bộ lịch.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Visible items</p>
          <p className="mt-2 text-2xl font-semibold text-slate-100">{visibleItemsCount}</p>
          <p className="mt-1 text-xs text-slate-500">{dateRangeLabel}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Next scheduled</p>
          {nextScheduledItem ? (
            <>
              <p className="mt-2 truncate text-sm font-semibold text-slate-100">{getDisplayTitle(nextScheduledItem)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {formatVietnamDateLabel(nextScheduledItem.scheduledAt)} · {formatVietnamTime(nextScheduledItem.scheduledAt)} · {formatRelativeTime(nextScheduledItem.scheduledAt)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Không có lịch sắp tới</p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Quick window</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <FilterChip active={quickView === "today"} onClick={() => { setQuickView("today"); setStatusFilter("upcoming"); setAnchorDateKey(todayKey); }}>Hôm nay</FilterChip>
            <FilterChip active={quickView === "next7"} onClick={() => { setQuickView("next7"); setStatusFilter("upcoming"); setAnchorDateKey(upcomingDateKeys[0] ?? todayKey); }}>7 ngày tới</FilterChip>
            <FilterChip active={quickView === "upcoming"} onClick={() => { setQuickView("upcoming"); setStatusFilter("upcoming"); }}>Tất cả lịch sắp tới</FilterChip>
            <FilterChip active={quickView === "done"} onClick={() => { setQuickView("done"); setStatusFilter("done"); setAnchorDateKey(pastDateKeys[0] ?? todayKey); }}>Lịch đã đăng</FilterChip>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Trạng thái</p>
            <div className="flex flex-wrap gap-2">
              <FilterChip active={statusFilter === "upcoming"} onClick={() => setStatusFilter("upcoming")}>Upcoming / Queued</FilterChip>
              <FilterChip active={statusFilter === "done"} onClick={() => setStatusFilter("done")}>Done</FilterChip>
              <FilterChip active={statusFilter === "error"} onClick={() => setStatusFilter("error")}>Error</FilterChip>
              <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</FilterChip>
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
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Định dạng</p>
            <div className="flex flex-wrap gap-2">
              <FilterChip active={formatFilter === "all"} onClick={() => setFormatFilter("all")}>All</FilterChip>
              <FilterChip active={formatFilter === "tts_short"} onClick={() => setFormatFilter("tts_short")}>TTS Short</FilterChip>
              <FilterChip active={formatFilter === "legacy_quote_short"} onClick={() => setFormatFilter("legacy_quote_short")}>Quote Short</FilterChip>
              <FilterChip active={formatFilter === "long_video"} onClick={() => setFormatFilter("long_video")}>Long</FilterChip>
              <FilterChip active={formatFilter === "facebook_quote_photo"} onClick={() => setFormatFilter("facebook_quote_photo")}>Facebook quote/photo</FilterChip>
            </div>
          </div>

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
            <label htmlFor="calendar-channel-filter" className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Kênh / page
            </label>
            <select
              id="calendar-channel-filter"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
            >
              <option value="all">All</option>
              {channelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-3">
          <div className="inline-flex items-center gap-2 text-sm text-slate-300">
            <CalendarDays className="h-4 w-4 text-slate-500" />
            {dateRangeLabel}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => setAnchorDateKey((current) => shiftDateKey(current, -7))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous 7 days
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickView("next7");
                setStatusFilter("upcoming");
                setAnchorDateKey(upcomingDateKeys[0] ?? todayKey);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-700/40 bg-rose-950/20 px-3 py-1.5 text-xs text-rose-300 transition-colors hover:border-rose-600/60"
            >
              Today / Upcoming
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setAnchorDateKey((current) => shiftDateKey(current, 7))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-500 disabled:opacity-40"
            >
              Next 7 days
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {orderedVisibleKeys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-12 text-center space-y-3">
          <p className="text-sm font-medium text-slate-400">Không có lịch nào khớp bộ lọc và cửa sổ hiện tại</p>
          <div className="text-xs text-slate-600 space-y-1">
            <p>Tổng mục (tất cả bộ lọc): <span className="text-slate-400">{items.length}</span></p>
            <p>Đang chờ đăng: <span className="text-slate-400">{items.filter(i => i.status === "queued" || i.status === "uploading").length}</span></p>
            <p>Cửa sổ: <span className="text-slate-400">{dateRangeLabel}</span> · trạng thái=<span className="text-slate-400">{statusFilter}</span></p>
          </div>
          {(statusFilter !== "upcoming" || platformFilter !== "all" || formatFilter !== "all" || channelFilter !== "all" || workspaceFilter !== "all") && (
            <button
              type="button"
              onClick={() => { setStatusFilter("upcoming"); setPlatformFilter("all"); setFormatFilter("all"); setChannelFilter("all"); setWorkspaceFilter("all"); setQuickView("next7"); setAnchorDateKey(todayKey); }}
              className="text-xs text-rose-400 hover:text-rose-300 underline"
            >
              Đặt lại bộ lọc
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {orderedVisibleKeys.map((key) => {
            const rows = grouped[key].slice().sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
            const isUpcomingDate = key >= todayKey;
            return (
              <section key={key} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-100">
                      {formatVietnamDateLabel(parseDateKey(key))}
                    </h2>
                    {isUpcomingDate && (
                      <span className="rounded-full border border-rose-700/50 bg-rose-950/20 px-2 py-0.5 text-[11px] text-rose-300">
                        Sắp tới
                      </span>
                    )}
                  </div>
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
                    {rows.length} mục
                  </span>
                </div>

                <div className="space-y-2">
                  {rows.map((item) => {
                    const status = getStatusMeta(item.status);
                    const format = getFormatMeta(item.formatType);
                    return (
                      <div key={item.id} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 lg:grid-cols-[92px_minmax(0,1fr)_180px] lg:items-center">
                        <div className="text-lg font-semibold text-slate-100">{formatVietnamTime(item.scheduledAt)}</div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-100">{getDisplayTitle(item)}</p>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                            <span className={`rounded-full border px-2 py-0.5 ${format.badge}`}>{format.label}</span>
                            <span>{getChannelLabel(item)}</span>
                            {item.workspaceName && (
                              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                                {item.workspaceName}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                            <Clock className="h-3 w-3" />
                            {formatRelativeTime(item.scheduledAt)}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${status.badge}`}>
                            {status.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
