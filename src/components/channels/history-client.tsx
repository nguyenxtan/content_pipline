"use client";

import { useState, useCallback, useMemo } from "react";
import {
  ExternalLink, Video, Film, RefreshCw, CheckCircle2, XCircle, Image as ImageIcon,
  RotateCcw, Trash2, ChevronLeft, ChevronRight,
} from "lucide-react";
import type { UploadQueueRow } from "@/actions/social-channels";
import { getUploadQueueAction, deleteUploadAction, retryUploadAction } from "@/actions/social-channels";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VN_TIMEZONE = "Asia/Ho_Chi_Minh";
const VN_TIME_SUFFIX = "VN (GMT+7)";

function toDateKey(d: Date): string {
  return new Date(d).toLocaleDateString("sv-SE"); // YYYY-MM-DD
}

function fmtDateLabel(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00");
  const today = toDateKey(new Date());
  const yest  = toDateKey(new Date(Date.now() - 86400000));
  if (dateKey === today) return "Hôm nay";
  if (dateKey === yest)  return "Hôm qua";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtTime(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("vi-VN", {
    timeZone: VN_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) + ` · ${VN_TIME_SUFFIX}`;
}

function itemDateKey(item: UploadQueueRow): string {
  const d = item.uploadedAt ?? item.scheduledAt;
  return toDateKey(d);
}

// ── Row ───────────────────────────────────────────────────────────────────────

function Row({ item, onUpdate }: { item: UploadQueueRow; onUpdate: () => void }) {
  const [busy, setBusy] = useState(false);
  const isShort = item.videoType === "short";
  const isQuote = item.videoType === "quote";
  const isDone  = item.status === "done";
  const isError = item.status === "error";

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); await fn(); setBusy(false); onUpdate();
  };

  return (
    <tr className={`border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors ${isError ? "bg-red-950/10" : ""}`}>
      {/* Type */}
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${
          isQuote
            ? "border-amber-700/50 bg-amber-900/30 text-amber-300"
            : isShort
              ? "border-rose-700/50 bg-rose-900/30 text-rose-300"
              : "border-cyan-700/50 bg-cyan-900/30 text-cyan-300"
        }`}>
          {isQuote ? <ImageIcon className="h-2.5 w-2.5" /> : isShort ? <Video className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
          {isQuote ? "Bài ảnh" : isShort ? "Short" : "Long"}
        </span>
      </td>

      {/* Title */}
      <td className="px-3 py-2 max-w-[260px]">
        <p className="text-xs text-slate-200 truncate" title={item.title}>{item.title}</p>
        {isError && item.errorMessage && (
          <p className="text-[10px] text-red-400 truncate mt-0.5" title={item.errorMessage}>
            {item.errorMessage.slice(0, 70)}
          </p>
        )}
      </td>

      {/* Niche */}
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="text-xs text-slate-500 truncate">{item.nicheName}</span>
      </td>

      {/* Channel */}
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="text-xs text-slate-400 truncate">{item.platform === "facebook" ? "Facebook" : "YouTube"} · {item.channelName}</span>
      </td>

      {/* Time */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1 text-xs">
          {isDone  && <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />}
          {isError && <XCircle      className="h-3 w-3 text-red-400   shrink-0" />}
          <span className={isDone ? "text-slate-400" : isError ? "text-slate-500" : "text-slate-500"}>
            {fmtTime(item.uploadedAt ?? item.scheduledAt)}
          </span>
        </div>
      </td>

      {/* Actions */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          {item.platformVideoUrl ? (
            <a href={item.platformVideoUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:border-red-600/60 hover:text-red-400 hover:bg-red-900/10 transition-colors">
              <ExternalLink className="h-2.5 w-2.5" />
              {item.platform === "facebook" ? "Facebook" : "YouTube"}
            </a>
          ) : (
            <span className="text-[10px] text-slate-700">—</span>
          )}
          {isError && (
            <button onClick={() => act(() => retryUploadAction(item.id))} disabled={busy}
              className="p-1 rounded text-slate-600 hover:text-amber-400 hover:bg-amber-900/20 transition-colors disabled:opacity-40" title="Thử lại">
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          <button onClick={() => act(() => deleteUploadAction(item.id))} disabled={busy}
            className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40" title="Xoá">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "all",   label: "Tất cả"  },
  { key: "done",  label: "Đã đăng" },
  { key: "error", label: "Lỗi"     },
] as const;

interface Props {
  initialItems: UploadQueueRow[];
}

export function HistoryClient({ initialItems }: Props) {
  const [items,   setItems]   = useState<UploadQueueRow[]>(initialItems);
  const [tab,     setTab]     = useState<string>("all");
  const [dateKey, setDateKey] = useState(toDateKey(new Date()));
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await getUploadQueueAction({ limit: 500 });
    setItems(rows.filter(r => r.status === "done" || r.status === "error"));
    setLoading(false);
  }, []);

  // All unique dates that have items, sorted desc
  const allDates = useMemo(() => {
    const s = new Set(items.map(itemDateKey));
    return [...s].sort((a, b) => b.localeCompare(a));
  }, [items]);

  // Items for the selected date
  const dated = useMemo(
    () => items.filter(i => itemDateKey(i) === dateKey),
    [items, dateKey]
  );

  const filtered = tab === "all" ? dated : dated.filter(i => i.status === tab);

  const stats = {
    all:   dated.length,
    done:  dated.filter(i => i.status === "done").length,
    error: dated.filter(i => i.status === "error").length,
  };

  // Navigate dates
  const dateIdx = allDates.indexOf(dateKey);
  const prevDate = allDates[dateIdx + 1] ?? null;
  const nextDate = allDates[dateIdx - 1] ?? null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Thông tin đăng bài</h1>
          <p className="text-sm text-slate-400 mt-1">Lịch sử nội dung đã đăng theo nền tảng và kênh.</p>
        </div>
        <button onClick={reload} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:border-slate-500 transition-colors disabled:opacity-40">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Date nav + tab filter */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date navigator */}
        <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700 rounded-lg p-0.5">
          <button onClick={() => prevDate && setDateKey(prevDate)} disabled={!prevDate}
            className="p-1.5 rounded text-slate-500 hover:text-slate-200 disabled:opacity-30 transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="relative">
            <select value={dateKey} onChange={e => setDateKey(e.target.value)}
              className="appearance-none bg-transparent text-sm font-medium text-slate-200 px-2 py-1 pr-6 cursor-pointer focus:outline-none">
              {allDates.length === 0 && <option value={dateKey}>{fmtDateLabel(dateKey)}</option>}
              {allDates.map(d => (
                <option key={d} value={d}>{fmtDateLabel(d)}</option>
              ))}
            </select>
            <ChevronLeft className="h-3 w-3 text-slate-500 absolute right-1 top-1/2 -translate-y-1/2 rotate-[-90deg] pointer-events-none" />
          </div>
          <button onClick={() => nextDate && setDateKey(nextDate)} disabled={!nextDate}
            className="p-1.5 rounded text-slate-500 hover:text-slate-200 disabled:opacity-30 transition-colors">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 border-b border-slate-800/0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                tab === t.key
                  ? "bg-rose-600/15 text-rose-400 border border-rose-700/40"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
              }`}>
              {t.label}
              {stats[t.key as keyof typeof stats] > 0 && (
                <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-500">
                  {stats[t.key as keyof typeof stats]}
                </span>
              )}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-600 ml-auto">
          {filtered.length} mục
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-700">
          <CheckCircle2 className="h-10 w-10" />
          <p className="text-sm">Không có dữ liệu cho ngày {fmtDateLabel(dateKey)}</p>
          {allDates.length > 0 && allDates[0] !== dateKey && (
            <button onClick={() => setDateKey(allDates[0])}
              className="text-xs text-rose-400 hover:underline">
              Xem ngày gần nhất: {fmtDateLabel(allDates[0])}
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/80 border-b border-slate-700">
                <tr>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Loại</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Tiêu đề</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Lĩnh vực</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Kênh</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Thời gian</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Link</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => <Row key={item.id} item={item} onUpdate={reload} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
