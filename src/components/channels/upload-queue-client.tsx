"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  TvMinimalPlay as Youtube, RefreshCw, ExternalLink, RotateCcw, X, Trash2,
  Clock, CheckCircle2, XCircle, Loader2, Upload, Ban, ChevronDown, Film, Video,
  CalendarPlus, Zap,
} from "lucide-react";
import type { UploadQueueRow, ReadyVideoRow, AutoScheduleSettings } from "@/actions/social-channels";
import type { SocialChannel } from "@/lib/db/schema";
import {
  getUploadQueueAction,
  getReadyVideosAction,
  cancelUploadAction,
  retryUploadAction,
  deleteUploadAction,
  bulkScheduleAction,
  getAutoScheduleSettingsAction,
  saveAutoScheduleSettingsAction,
} from "@/actions/social-channels";
import { getChannelsAction } from "@/actions/social-channels";

const STATUS_CONFIG = {
  queued:    { label: "Chờ đăng",   color: "text-amber-400",  bg: "bg-amber-900/30 border-amber-700/50",  icon: Clock        },
  uploading: { label: "Đang đăng",  color: "text-blue-400",   bg: "bg-blue-900/30 border-blue-700/50",   icon: Loader2      },
  done:      { label: "Đã đăng",    color: "text-green-400",  bg: "bg-green-900/30 border-green-700/50", icon: CheckCircle2 },
  error:     { label: "Lỗi",        color: "text-red-400",    bg: "bg-red-900/30 border-red-700/50",     icon: XCircle      },
  cancelled: { label: "Đã huỷ",     color: "text-slate-500",  bg: "bg-slate-800/50 border-slate-700",    icon: Ban          },
} as const;

const TABS = [
  { key: "all",       label: "Tất cả" },
  { key: "queued",    label: "Chờ đăng" },
  { key: "uploading", label: "Đang đăng" },
  { key: "done",      label: "Đã đăng" },
  { key: "error",     label: "Lỗi" },
  { key: "cancelled", label: "Đã huỷ" },
] as const;

const VN_TIMEZONE = "Asia/Ho_Chi_Minh";
const VN_TIME_SUFFIX = "VN (GMT+7)";

function formatVietnamAbsolute(date: Date, withYear = false): string {
  return new Date(date).toLocaleString("vi-VN", {
    timeZone: VN_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    ...(withYear ? { year: "numeric" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatScheduledAt(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const abs = `${formatVietnamAbsolute(d)} · ${VN_TIME_SUFFIX}`;
  if (diffMin < -60 * 24) return abs;
  if (diffMin < -60)      return `${Math.abs(Math.floor(diffMin / 60))}h trước · ${abs}`;
  if (diffMin < 0)        return `${Math.abs(diffMin)}p trước · ${abs}`;
  if (diffMin < 60)       return `${diffMin}p nữa · ${abs}`;
  if (diffMin < 60 * 24)  return `${Math.floor(diffMin / 60)}h nữa · ${abs}`;
  return abs;
}

function QueueRow({ item, onUpdate }: { item: UploadQueueRow; onUpdate: () => void }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[item.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.queued;
  const Icon = cfg.icon;
  const isShort = item.videoType === "short";

  const doAction = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
    onUpdate();
  };

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${cfg.bg}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          {isShort ? <Video className="h-4 w-4 text-rose-400" /> : <Film className="h-4 w-4 text-cyan-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${isShort ? "border-rose-700/50 bg-rose-900/30 text-rose-300" : "border-cyan-700/50 bg-cyan-900/30 text-cyan-300"}`}>
              {isShort ? "Short" : "Long"}
            </span>
            <span className="text-sm font-medium text-slate-100 truncate" title={item.title}>{item.title}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{item.nicheName} · 📺 {item.channelName}</p>
          <div className="flex items-center gap-3 mt-1">
            <span className={`flex items-center gap-1 text-xs ${cfg.color}`}>
              <Icon className={`h-3 w-3 ${item.status === "uploading" ? "animate-spin" : ""}`} />
              {cfg.label}
            </span>
            <span className="text-xs text-slate-500">
              <Clock className="inline h-3 w-3 mr-0.5 -mt-0.5" />
              {formatScheduledAt(item.scheduledAt)}
            </span>
            {item.uploadedAt && (
              <span className="text-xs text-slate-600">
                đăng lúc {formatVietnamAbsolute(new Date(item.uploadedAt))} · {VN_TIME_SUFFIX}
              </span>
            )}
          </div>
          {item.status === "error" && item.errorMessage && (
            <p className="text-[11px] text-red-400 mt-1 font-mono truncate" title={item.errorMessage}>
              {item.errorMessage.slice(0, 100)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.platformVideoUrl && (
            <a href={item.platformVideoUrl} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded text-slate-400 hover:text-green-400 hover:bg-green-900/20 transition-colors" title="Xem trên YouTube">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {item.status === "error" && (
            <button onClick={() => doAction(() => retryUploadAction(item.id))} disabled={busy}
              className="p-1.5 rounded text-slate-400 hover:text-amber-400 hover:bg-amber-900/20 transition-colors disabled:opacity-40" title="Thử lại">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {item.status === "queued" && (
            <button onClick={() => doAction(() => cancelUploadAction(item.id))} disabled={busy}
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-40" title="Huỷ lịch">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {(item.status === "done" || item.status === "cancelled") && (
            <button onClick={() => doAction(() => deleteUploadAction(item.id))} disabled={busy}
              className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40" title="Xoá">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded text-slate-600 hover:text-slate-300 transition-colors">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="ml-7 space-y-1.5 pt-1 border-t border-slate-700/50">
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.tags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">#{t}</span>)}
            </div>
          )}
          {item.description && (
            <p className="text-[11px] text-slate-600 line-clamp-3 whitespace-pre-line">{item.description.slice(0, 300)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Auto Schedule Panel ─────────────────────────────────────────────────────

function AutoScheduleRow({
  label, icon: Icon, color, settings, channels, onChange,
}: {
  label: string;
  icon: React.ElementType;
  color: string;
  settings: AutoScheduleSettings["short"];
  channels: SocialChannel[];
  onChange: (s: AutoScheduleSettings["short"]) => void;
}) {
  const privacyOptions = [
    { value: "public",   label: "Công khai" },
    { value: "unlisted", label: "Không liệt kê" },
    { value: "private",  label: "Riêng tư" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
            settings.enabled
              ? "border-green-700 bg-green-900/30 text-green-400"
              : "border-slate-600 bg-slate-800 text-slate-500"
          }`}>
          {settings.enabled ? "ON" : "OFF"}
        </button>
        <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
        <span className={`text-xs font-medium ${color}`}>{label}</span>
      </div>

      {settings.enabled && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 pl-1">
          <div className="sm:col-span-1">
            <label className="block text-[10px] text-slate-500 mb-1">Kênh</label>
            {channels.length === 0 ? (
              <p className="text-xs text-amber-400">Chưa có kênh</p>
            ) : (
              <select value={settings.channelId} onChange={e => onChange({ ...settings, channelId: Number(e.target.value) })}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                <option value={0}>— Chọn kênh —</option>
                {channels.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-end gap-1">
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Từ</label>
              <input type="time" value={settings.windowStart} onChange={e => onChange({ ...settings, windowStart: e.target.value })}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
            <span className="text-slate-600 pb-2">–</span>
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Đến</label>
              <input type="time" value={settings.windowEnd} onChange={e => onChange({ ...settings, windowEnd: e.target.value })}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Cách (phút)</label>
              <input type="number" min={5} max={1440} value={settings.intervalMin} onChange={e => onChange({ ...settings, intervalMin: Number(e.target.value) })}
                className="w-20 border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Quyền</label>
              <select value={settings.privacyStatus} onChange={e => onChange({ ...settings, privacyStatus: e.target.value as "public"|"unlisted"|"private" })}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                {privacyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AutoSchedulePanel({ channels }: { channels: SocialChannel[] }) {
  const [settings, setSettings] = useState<AutoScheduleSettings | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [open,     setOpen]     = useState(false);

  useEffect(() => {
    getAutoScheduleSettingsAction().then(s => { setSettings(s); if (s.short.enabled || s.long.enabled) setOpen(true); });
  }, []);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    await saveAutoScheduleSettingsAction(settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const anyEnabled = settings?.short.enabled || settings?.long.enabled;

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/60 transition-colors">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-slate-200">Tự động lên lịch</span>
          {anyEnabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/40 border border-green-700/40 text-green-400">Đang bật</span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-700/50">
          <p className="text-[11px] text-slate-500 pt-3">
            Khi video render xong, hệ thống tự động lên lịch vào slot trống tiếp theo.
          </p>

          {settings === null ? (
            <p className="text-xs text-slate-600">Đang tải...</p>
          ) : (
            <div className="space-y-4 divide-y divide-slate-700/50">
              <AutoScheduleRow
                label="Video Short" icon={Video} color="text-rose-300"
                settings={settings.short} channels={channels}
                onChange={s => setSettings(prev => prev ? { ...prev, short: s } : prev)}
              />
              <div className="pt-4">
                <AutoScheduleRow
                  label="Video Long" icon={Film} color="text-cyan-300"
                  settings={settings.long} channels={channels}
                  onChange={s => setSettings(prev => prev ? { ...prev, long: s } : prev)}
                />
              </div>
            </div>
          )}

          <button onClick={handleSave} disabled={saving || !settings}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {saved ? "Đã lưu!" : "Lưu cài đặt"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Bulk Scheduler ──────────────────────────────────────────────────────────

function BulkScheduler({
  ready,
  channels,
  onScheduled,
}: {
  ready: ReadyVideoRow[];
  channels: SocialChannel[];
  onScheduled: () => void;
}) {
  const shortCount = ready.filter(r => r.videoType === "short").length;
  const longCount  = ready.filter(r => r.videoType === "long").length;

  const [shortChannelId, setShortChannelId] = useState<number>(0);
  const [shortWindow,    setShortWindow]    = useState({ start: "06:00", end: "22:00" });
  const [shortInterval,  setShortInterval]  = useState(60);
  const [shortPrivacy,   setShortPrivacy]   = useState<"public"|"unlisted"|"private">("public");
  const [shortLoading,   setShortLoading]   = useState(false);
  const [shortResult,    setShortResult]    = useState("");

  const [longChannelId,  setLongChannelId]  = useState<number>(0);
  const [longWindow,     setLongWindow]     = useState({ start: "06:00", end: "22:00" });
  const [longInterval,   setLongInterval]   = useState(120);
  const [longPrivacy,    setLongPrivacy]    = useState<"public"|"unlisted"|"private">("public");
  const [longLoading,    setLongLoading]    = useState(false);
  const [longResult,     setLongResult]     = useState("");

  if (shortCount === 0 && longCount === 0) return null;

  async function handleBulk(type: "short" | "long") {
    const channelId = type === "short"
      ? (shortChannelId || channels[0]?.id || 0)
      : (longChannelId || channels[0]?.id || 0);
    const window    = type === "short" ? shortWindow : longWindow;
    const interval  = type === "short" ? shortInterval : longInterval;
    const privacy   = type === "short" ? shortPrivacy : longPrivacy;
    const setLoading = type === "short" ? setShortLoading : setLongLoading;
    const setResult  = type === "short" ? setShortResult  : setLongResult;

    if (!channelId) { setResult("Chọn kênh trước"); return; }
    setLoading(true);
    setResult("");
    const res = await bulkScheduleAction({ videoType: type, channelId, windowStart: window.start, windowEnd: window.end, intervalMin: interval, privacyStatus: privacy });
    setLoading(false);
    if (res.error) { setResult(`❌ ${res.error}`); return; }
    setResult(`✅ Đã lên lịch ${res.scheduled} video${res.skipped > 0 ? `, bỏ qua ${res.skipped}` : ""}`);
    onScheduled();
  }

  const privacyOptions = [
    { value: "public",   label: "Công khai" },
    { value: "unlisted", label: "Không liệt kê" },
    { value: "private",  label: "Riêng tư" },
  ];

  const renderRow = (type: "short" | "long") => {
    const count      = type === "short" ? shortCount : longCount;
    if (count === 0) return null;
    const channelId  = type === "short" ? shortChannelId  : longChannelId;
    const setChannel = type === "short" ? setShortChannelId : setLongChannelId;
    const window     = type === "short" ? shortWindow     : longWindow;
    const setWindow  = type === "short" ? setShortWindow  : setLongWindow;
    const interval   = type === "short" ? shortInterval   : longInterval;
    const setInterval = type === "short" ? setShortInterval : setLongInterval;
    const privacy    = type === "short" ? shortPrivacy    : longPrivacy;
    const setPrivacy = type === "short" ? setShortPrivacy : setLongPrivacy;
    const loading    = type === "short" ? shortLoading    : longLoading;
    const result     = type === "short" ? shortResult     : longResult;
    const isShort    = type === "short";

    return (
      <div key={type} className="space-y-2">
        <div className="flex items-center gap-2">
          {isShort
            ? <Video className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            : <Film  className="h-3.5 w-3.5 text-cyan-400 shrink-0" />}
          <span className={`text-xs font-medium ${isShort ? "text-rose-300" : "text-cyan-300"}`}>
            {isShort ? "Short" : "Long"} · {count} video chưa lên lịch
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {/* Channel */}
          <div className="sm:col-span-1">
            <label className="block text-[10px] text-slate-500 mb-1">Kênh</label>
            {channels.length === 0 ? (
              <p className="text-xs text-amber-400">Chưa có kênh</p>
            ) : (
              <select value={channelId} onChange={e => setChannel(Number(e.target.value))}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                {channels.map(ch => (
                  <option key={ch.id} value={ch.id}>{ch.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Window */}
          <div className="flex items-end gap-1">
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Từ</label>
              <input type="time" value={window.start} onChange={e => setWindow(w => ({ ...w, start: e.target.value }))}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
            <span className="text-slate-600 pb-2">–</span>
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Đến</label>
              <input type="time" value={window.end} onChange={e => setWindow(w => ({ ...w, end: e.target.value }))}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
          </div>

          {/* Interval + Privacy */}
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Cách (phút)</label>
              <input type="number" min={5} max={1440} value={interval} onChange={e => setInterval(Number(e.target.value))}
                className="w-20 border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Quyền</label>
              <select value={privacy} onChange={e => setPrivacy(e.target.value as typeof privacy)}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                {privacyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Action */}
          <div className="flex items-end">
            <button onClick={() => handleBulk(type)} disabled={loading || channels.length === 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40 ${
                isShort
                  ? "bg-rose-600 hover:bg-rose-500 text-white"
                  : "bg-cyan-700 hover:bg-cyan-600 text-white"
              }`}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
              Lên lịch {count} {isShort ? "Short" : "Long"}
            </button>
          </div>
        </div>

        {result && (
          <p className={`text-xs ${result.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>{result}</p>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-400" />
        <p className="text-sm font-semibold text-slate-200">Sẵn sàng đăng</p>
        <div className="flex items-center gap-1.5 ml-auto">
          {shortCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-rose-700/50 bg-rose-900/20 text-rose-300">
              {shortCount} Short
            </span>
          )}
          {longCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-cyan-700/50 bg-cyan-900/20 text-cyan-300">
              {longCount} Long
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 divide-y divide-slate-700/50">
        <div>{renderRow("short")}</div>
        {longCount > 0 && shortCount > 0 && null /* divider from CSS */}
        <div className={longCount > 0 && shortCount > 0 ? "pt-4" : ""}>{renderRow("long")}</div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface Props {
  initialItems: UploadQueueRow[];
  initialReady: ReadyVideoRow[];
}

export function UploadQueueClient({ initialItems, initialReady }: Props) {
  const [items,    setItems]    = useState<UploadQueueRow[]>(initialItems);
  const [ready,    setReady]    = useState<ReadyVideoRow[]>(initialReady);
  const [channels, setChannels] = useState<SocialChannel[]>([]);
  const [tab,      setTab]      = useState<string>("all");
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    getChannelsAction("youtube").then(chs => setChannels(chs.filter(c => c.isActive && !c.needsReconnect)));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    const [rows, readyRows] = await Promise.all([
      getUploadQueueAction({ limit: 200 }),
      getReadyVideosAction(),
    ]);
    setItems(rows);
    setReady(readyRows);
    setLoading(false);
  }, []);

  // Auto-refresh every 30s when active items exist
  useEffect(() => {
    const hasActive = items.some(i => i.status === "queued" || i.status === "uploading");
    if (!hasActive) return;
    const timer = setInterval(reload, 30_000);
    return () => clearInterval(timer);
  }, [items, reload]);

  const stats = {
    all:       items.length,
    queued:    items.filter(i => i.status === "queued").length,
    uploading: items.filter(i => i.status === "uploading").length,
    done:      items.filter(i => i.status === "done").length,
    error:     items.filter(i => i.status === "error").length,
    cancelled: items.filter(i => i.status === "cancelled").length,
  };

  const filtered = tab === "all" ? items : items.filter(i => i.status === tab);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Upload className="h-6 w-6 text-rose-400" />
            Đăng bài
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Lên lịch đăng video lên YouTube. Cron job xử lý tự động khi đến giờ.
          </p>
        </div>
        <button onClick={reload} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:border-slate-500 transition-colors disabled:opacity-40">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Auto-schedule settings */}
      <AutoSchedulePanel channels={channels} />

      {/* Bulk scheduler */}
      <BulkScheduler ready={ready} channels={channels} onScheduled={reload} />

      {/* Stat chips */}
      {(stats.uploading > 0 || stats.queued > 0 || stats.error > 0 || stats.done > 0) && (
        <div className="flex flex-wrap gap-2">
          {stats.uploading > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900/30 border border-blue-700/50 text-xs text-blue-300">
              <Loader2 className="h-3 w-3 animate-spin" />{stats.uploading} đang upload
            </div>
          )}
          {stats.queued > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900/20 border border-amber-700/40 text-xs text-amber-300">
              <Clock className="h-3 w-3" />{stats.queued} chờ đăng
            </div>
          )}
          {stats.error > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/20 border border-red-700/40 text-xs text-red-300">
              <XCircle className="h-3 w-3" />{stats.error} lỗi
            </div>
          )}
          {stats.done > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-900/20 border border-green-700/40 text-xs text-green-300">
              <CheckCircle2 className="h-3 w-3" />{stats.done} đã đăng
            </div>
          )}
        </div>
      )}

      {/* Tabs + queue */}
      <div className="space-y-3">
        <div className="flex gap-1 border-b border-slate-800 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.key ? "border-rose-500 text-rose-400" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}>
              {t.label}
              {stats[t.key] > 0 && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">
                  {stats[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-600">
            <Youtube className="h-10 w-10" />
            <p className="text-sm">Không có mục nào{tab !== "all" ? ` trong tab "${TABS.find(t => t.key === tab)?.label}"` : ""}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(item => <QueueRow key={item.id} item={item} onUpdate={reload} />)}
          </div>
        )}
      </div>
    </div>
  );
}
