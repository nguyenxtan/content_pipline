"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  RefreshCw, X, RotateCcw, Clock, XCircle, Loader2, Ban,
  Video, Film, Zap, CalendarPlus, ChevronDown, CheckCircle2, Image as ImageIcon,
} from "lucide-react";
import type { UploadQueueRow, ReadyVideoRow, AutoScheduleSettings, AutoScheduleVideoSetting } from "@/actions/social-channels";
import type { SocialChannel } from "@/lib/db/schema";
import {
  getUploadQueueAction,
  getReadyVideosAction,
  cancelUploadAction,
  retryUploadAction,
  bulkScheduleAction,
  getAutoScheduleSettingsAction,
  saveAutoScheduleSettingsAction,
} from "@/actions/social-channels";
import { getChannelsAction } from "@/actions/social-channels";

// ── Status config ────────────────────────────────────────────────────────────

const STATUS = {
  queued:    { label: "Chờ đăng",  color: "text-amber-400", icon: Clock    },
  uploading: { label: "Đang đăng", color: "text-blue-400",  icon: Loader2  },
  error:     { label: "Lỗi",       color: "text-red-400",   icon: XCircle  },
  cancelled: { label: "Đã huỷ",    color: "text-slate-500", icon: Ban      },
} as const;

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

function fmtTime(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const diff = Math.round((d.getTime() - now.getTime()) / 60000);
  const abs = `${formatVietnamAbsolute(d)} · ${VN_TIME_SUFFIX}`;
  if (diff < -60 * 24) return abs;
  if (diff < -60)      return `${Math.abs(Math.floor(diff / 60))}h trước · ${abs}`;
  if (diff < 0)        return `${Math.abs(diff)}p trước · ${abs}`;
  if (diff < 60)       return `${diff}p nữa · ${abs}`;
  if (diff < 1440)     return `${Math.floor(diff / 60)}h nữa · ${abs}`;
  return abs;
}

function fmtInterval(intervalMin: number): string {
  const hours = Math.floor(intervalMin / 60);
  const minutes = intervalMin % 60;
  if (hours > 0 && minutes > 0) return `${hours} giờ ${minutes} phút`;
  if (hours > 0) return `${hours} giờ`;
  return `${minutes} phút`;
}

// ── Queue item row ───────────────────────────────────────────────────────────

function QueueItem({ item, onUpdate }: { item: UploadQueueRow; onUpdate: () => void }) {
  const [busy, setBusy] = useState(false);
  const cfg = STATUS[item.status as keyof typeof STATUS] ?? STATUS.queued;
  const Icon = cfg.icon;

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); await fn(); setBusy(false); onUpdate(); };

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-800/50 group">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-200 truncate" title={item.title}>{item.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`flex items-center gap-0.5 text-[10px] ${cfg.color}`}>
            <Icon className={`h-2.5 w-2.5 ${item.status === "uploading" ? "animate-spin" : ""}`} />
            {cfg.label}
          </span>
            <span className="text-[10px] text-slate-600">
              <Clock className="inline h-2.5 w-2.5 mr-0.5 -mt-0.5" />
              {fmtTime(item.scheduledAt)}
            </span>
          {item.status === "error" && item.errorMessage && (
            <span className="text-[10px] text-red-400 truncate max-w-[150px]" title={item.errorMessage}>
              {item.errorMessage.slice(0, 60)}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {item.status === "error" && (
          <button onClick={() => act(() => retryUploadAction(item.id))} disabled={busy} title="Thử lại"
            className="p-1 rounded text-slate-500 hover:text-amber-400 hover:bg-amber-900/20 transition-colors disabled:opacity-40">
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        {item.status === "queued" && (
          <button onClick={() => act(() => cancelUploadAction(item.id))} disabled={busy} title="Huỷ"
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-40">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Video type section within a channel ─────────────────────────────────────

function TypeSection({ type, items, onUpdate }: {
  type: "short" | "long" | "quote";
  items: UploadQueueRow[];
  onUpdate: () => void;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  const isShort = type === "short";
  const isQuote = type === "quote";
  const errorCount = items.filter(i => i.status === "error").length;

  return (
    <div className="space-y-0.5">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 w-full text-left px-2 py-1 rounded hover:bg-slate-800/50 transition-colors">
        {isShort ? <Video className="h-3 w-3 text-rose-400" /> : isQuote ? <ImageIcon className="h-3 w-3 text-amber-400" /> : <Film className="h-3 w-3 text-cyan-400" />}
        <span className={`text-[11px] font-medium ${isShort ? "text-rose-300" : isQuote ? "text-amber-300" : "text-cyan-300"}`}>
          {isShort ? "Short" : isQuote ? "Bài ảnh" : "Long"}
        </span>
        <span className="text-[10px] text-slate-600 ml-1">{items.length}</span>
        {errorCount > 0 && (
          <span className="text-[10px] px-1 rounded bg-red-900/30 border border-red-700/40 text-red-400 ml-1">
            {errorCount} lỗi
          </span>
        )}
        <ChevronDown className={`h-3 w-3 text-slate-600 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="pl-2 space-y-0.5">
          {items.map(item => <QueueItem key={item.id} item={item} onUpdate={onUpdate} />)}
        </div>
      )}
    </div>
  );
}

// ── Channel group ────────────────────────────────────────────────────────────

function ChannelGroup({ channelLabel, short, quote, long, onUpdate }: {
  channelLabel: string;
  short: UploadQueueRow[];
  quote: UploadQueueRow[];
  long: UploadQueueRow[];
  onUpdate: () => void;
}) {
  const total = short.length + quote.length + long.length;
  const [open, setOpen] = useState(true);
  if (total === 0) return null;

  return (
    <div className="rounded-xl border border-slate-700/60 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full px-3 py-2.5 bg-slate-800/60 hover:bg-slate-800 transition-colors">
        <span className="text-sm font-medium text-slate-200">{channelLabel}</span>
        <span className="text-[10px] text-slate-500 ml-1">{total} video</span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-500 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="p-2 space-y-2 bg-slate-900/40">
          <TypeSection type="short" items={short} onUpdate={onUpdate} />
          <TypeSection type="quote" items={quote} onUpdate={onUpdate} />
          <TypeSection type="long"  items={long}  onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}

// ── Auto-schedule row ────────────────────────────────────────────────────────

function AutoDestinationRow({
  label, icon: Icon, color, settings, channels, onChange, onRemove, minInterval = 120,
}: {
  label: string;
  icon: React.ElementType;
  color: string;
  settings: AutoScheduleVideoSetting;
  channels: SocialChannel[];
  onChange: (s: AutoScheduleVideoSetting) => void;
  onRemove?: () => void;
  minInterval?: number;
}) {
  const privOpts = [
    { value: "public",   label: "Công khai"     },
    { value: "unlisted", label: "Không liệt kê" },
    { value: "private",  label: "Riêng tư"      },
  ];
  const safeInterval = Math.max(minInterval, settings.intervalMin || minInterval);
  return (
    <div className="space-y-2 rounded-lg border border-slate-700/50 p-3">
      <div className="flex items-center gap-2">
        <button onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${settings.enabled ? "border-green-700 bg-green-900/30 text-green-400" : "border-slate-600 bg-slate-800 text-slate-500"}`}>
          {settings.enabled ? "ON" : "OFF"}
        </button>
        <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
        <span className={`text-xs font-medium ${color}`}>{label}</span>
        {onRemove && (
          <button onClick={onRemove} className="ml-auto text-slate-500 hover:text-red-400 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {settings.enabled && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 pl-1">
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">Kênh</label>
            <select value={settings.channelId} onChange={e => onChange({ ...settings, channelId: +e.target.value })}
              className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
              <option value={0}>— Chọn kênh —</option>
              {channels.map(ch => <option key={ch.id} value={ch.id}>{ch.platform === "facebook" ? "Facebook" : "YouTube"} · {ch.name}</option>)}
            </select>
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
              <input type="number" min={minInterval} step={60} max={1440} value={safeInterval} onChange={e => onChange({ ...settings, intervalMin: +e.target.value })}
                className="w-20 border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Quyền</label>
              <select value={settings.privacyStatus} onChange={e => onChange({ ...settings, privacyStatus: e.target.value as "public"|"unlisted"|"private" })}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                {privOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="col-span-2 sm:col-span-4 pl-0.5 text-[10px] text-slate-500">
            Khoảng cách hiện tại: <span className="text-slate-300">{fmtInterval(safeInterval)}</span>. Hệ thống sẽ tự dời lịch nếu chưa đủ khoảng cách tối thiểu đã cấu hình.
          </div>
        </div>
      )}
    </div>
  );
}

function AutoDestinationSection({
  title,
  icon: Icon,
  color,
  destinations,
  channels,
  onChange,
  minInterval = 120,
}: {
  title: string;
  icon: React.ElementType;
  color: string;
  destinations: AutoScheduleVideoSetting[];
  channels: SocialChannel[];
  onChange: (next: AutoScheduleVideoSetting[]) => void;
  minInterval?: number;
}) {
  const nextAvailableChannel = channels.find((ch) => !destinations.some((d) => d.channelId === ch.id));

  const addDestination = () => {
    if (!nextAvailableChannel) return;
    onChange([
      ...destinations,
      {
        enabled: nextAvailableChannel.platform === "facebook" ? true : false,
        channelId: nextAvailableChannel.id,
        windowStart: title === "Facebook bài ảnh" ? "08:00" : "06:00",
        windowEnd: title === "Facebook bài ảnh" ? "23:00" : "22:00",
        intervalMin: title === "Facebook bài ảnh" ? 60 : 120,
        privacyStatus: nextAvailableChannel.platform === "facebook" ? "public" : "public",
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
        <span className={`text-xs font-medium ${color}`}>{title}</span>
        <span className="text-[10px] text-slate-500">{destinations.length} đích</span>
        {nextAvailableChannel && (
          <button
            onClick={addDestination}
            className="ml-auto text-[11px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors"
          >
            + Thêm kênh
          </button>
        )}
      </div>
      {destinations.length === 0 ? (
        <p className="text-[11px] text-slate-500">Chưa có đích nào. Thêm kênh để tự động lên lịch song song.</p>
      ) : (
        <div className="space-y-2">
          {destinations.map((destination, index) => {
            const channel = channels.find((ch) => ch.id === destination.channelId);
            return (
              <AutoDestinationRow
                key={`${destination.channelId}-${index}`}
                label={channel ? `${channel.platform === "facebook" ? "Facebook" : "YouTube"} · ${channel.name}` : "Kênh"}
                icon={Icon}
                color={color}
                settings={destination}
                channels={channels}
                minInterval={minInterval}
                onChange={(next) => {
                  const updated = [...destinations];
                  updated[index] = next;
                  onChange(updated);
                }}
                onRemove={destinations.length > 1 ? () => {
                  onChange(destinations.filter((_, i) => i !== index));
                } : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Auto-schedule panel ──────────────────────────────────────────────────────

function AutoSchedulePanel({
  shortChannels,
  longChannels,
  quoteChannels,
}: {
  shortChannels: SocialChannel[];
  longChannels: SocialChannel[];
  quoteChannels: SocialChannel[];
}) {
  const [settings, setSettings] = useState<AutoScheduleSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getAutoScheduleSettingsAction().then(s => {
      setSettings(s);
      if (s.shortDestinations.some((d) => d.enabled) || s.longDestinations.some((d) => d.enabled) || s.quoteDestinations.some((d) => d.enabled)) setOpen(true);
    });
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    await saveAutoScheduleSettingsAction(settings);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const anyOn = !!settings && (
    settings.shortDestinations.some((d) => d.enabled) ||
    settings.longDestinations.some((d) => d.enabled) ||
    settings.quoteDestinations.some((d) => d.enabled)
  );

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/60 transition-colors">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-slate-200">Tự động lên lịch</span>
          {anyOn && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/40 border border-green-700/40 text-green-400">Đang bật</span>}
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-700/50">
          <p className="text-[11px] text-slate-500 pt-3">Khi video render xong, hệ thống tự lên lịch vào slot trống tiếp theo.</p>
          {settings === null ? <p className="text-xs text-slate-600">Đang tải...</p> : (
            <div className="space-y-4 divide-y divide-slate-700/50">
              <AutoDestinationSection
                title="Video Short"
                icon={Video}
                color="text-rose-300"
                destinations={settings.shortDestinations}
                channels={shortChannels}
                minInterval={120}
                onChange={(rows) => setSettings((prev) => prev ? { ...prev, shortDestinations: rows, short: rows[0] ?? prev.short } : prev)}
              />
              <div className="pt-4">
                <AutoDestinationSection
                title="Facebook bài ảnh"
                icon={ImageIcon}
                color="text-amber-300"
                destinations={settings.quoteDestinations}
                channels={quoteChannels}
                minInterval={60}
                onChange={(rows) => setSettings((prev) => prev ? { ...prev, quoteDestinations: rows } : prev)}
              />
              </div>
              <div className="pt-4">
                <AutoDestinationSection
                  title="Video Long"
                  icon={Film}
                  color="text-cyan-300"
                  destinations={settings.longDestinations}
                  channels={longChannels}
                  minInterval={120}
                  onChange={(rows) => setSettings((prev) => prev ? { ...prev, longDestinations: rows, long: rows[0] ?? prev.long } : prev)}
                />
              </div>
            </div>
          )}
          <button onClick={save} disabled={saving || !settings}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors disabled:opacity-40">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {saved ? "Đã lưu!" : "Lưu cài đặt"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Bulk scheduler ───────────────────────────────────────────────────────────

function BulkScheduler({ ready, channels, onScheduled }: {
  ready: ReadyVideoRow[];
  channels: SocialChannel[];
  onScheduled: () => void;
}) {
  const shortCount = ready.filter(r => r.videoType === "short").length;
  const quoteCount = ready.filter(r => r.videoType === "quote").length;
  const longCount  = ready.filter(r => r.videoType === "long").length;

  const [shortCh,  setShortCh]  = useState(0);
  const [shortW,   setShortW]   = useState({ start: "06:00", end: "22:00" });
  const [shortInt, setShortInt] = useState(120);
  const [shortPrv, setShortPrv] = useState<"public"|"unlisted"|"private">("public");
  const [shortBusy, setShortBusy] = useState(false);
  const [shortMsg,  setShortMsg]  = useState("");

  const [quoteCh,   setQuoteCh]   = useState(0);
  const [quoteW,    setQuoteW]    = useState({ start: "06:00", end: "22:00" });
  const [quoteInt,  setQuoteInt]  = useState(120);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteMsg,  setQuoteMsg]  = useState("");

  const [longCh,   setLongCh]   = useState(0);
  const [longW,    setLongW]    = useState({ start: "06:00", end: "22:00" });
  const [longInt,  setLongInt]  = useState(120);
  const [longPrv,  setLongPrv]  = useState<"public"|"unlisted"|"private">("public");
  const [longBusy, setLongBusy] = useState(false);
  const [longMsg,  setLongMsg]  = useState("");

  if (shortCount === 0 && quoteCount === 0 && longCount === 0) return null;

  const privOpts = [
    { value: "public",   label: "Công khai"     },
    { value: "unlisted", label: "Không liệt kê" },
    { value: "private",  label: "Riêng tư"      },
  ];

  async function sched(type: "short" | "quote" | "long") {
    const available = type === "short"
      ? channels.filter((c) => c.platform === "youtube" || c.platform === "facebook")
      : type === "quote"
        ? channels.filter((c) => c.platform === "facebook")
        : channels.filter((c) => c.platform === "youtube");
    const ch = type === "short"
      ? (shortCh || available[0]?.id || 0)
      : type === "quote"
        ? (quoteCh || available[0]?.id || 0)
        : (longCh || available[0]?.id || 0);
    const w  = type === "short" ? shortW : type === "quote" ? quoteW : longW;
    const i  = type === "short" ? shortInt : type === "quote" ? quoteInt : longInt;
    const p  = type === "long" ? longPrv : type === "short" ? shortPrv : "public";
    const setBusy = type === "short" ? setShortBusy : type === "quote" ? setQuoteBusy : setLongBusy;
    const setMsg  = type === "short" ? setShortMsg : type === "quote" ? setQuoteMsg : setLongMsg;
    if (!ch) { setMsg("Chọn kênh trước"); return; }
    setBusy(true); setMsg("");
    const r = await bulkScheduleAction({ videoType: type, channelId: ch, windowStart: w.start, windowEnd: w.end, intervalMin: i, privacyStatus: p });
    setBusy(false);
    setMsg(r.error ? `❌ ${r.error}` : `✅ Đã lên lịch ${r.scheduled} nội dung${r.skipped > 0 ? `, bỏ qua ${r.skipped}` : ""}`);
    onScheduled();
  }

  const renderRow = (type: "short" | "quote" | "long") => {
    const count = type === "short" ? shortCount : type === "quote" ? quoteCount : longCount;
    if (count === 0) return null;
    const isShort = type === "short";
    const isQuote = type === "quote";
    const availableChannels = isShort
      ? channels.filter((c) => c.platform === "youtube" || c.platform === "facebook")
      : isQuote
        ? channels.filter((c) => c.platform === "facebook")
        : channels.filter((c) => c.platform === "youtube");
    const ch = isShort
      ? (shortCh || availableChannels[0]?.id || 0)
      : isQuote
        ? (quoteCh || availableChannels[0]?.id || 0)
        : (longCh || availableChannels[0]?.id || 0);
    const setCh = isShort ? setShortCh : isQuote ? setQuoteCh : setLongCh;
    const w = isShort ? shortW : isQuote ? quoteW : longW;
    const setW = isShort ? setShortW : isQuote ? setQuoteW : setLongW;
    const intv = isShort ? shortInt : isQuote ? quoteInt : longInt;
    const setIntv = isShort ? setShortInt : isQuote ? setQuoteInt : setLongInt;
    const prv = isShort ? shortPrv : longPrv;
    const setPrv = isShort ? setShortPrv : setLongPrv;
    const busy = isShort ? shortBusy : isQuote ? quoteBusy : longBusy;
    const msg = isShort ? shortMsg : isQuote ? quoteMsg : longMsg;
    const selectedChannel = availableChannels.find((c) => c.id === ch);
    const forcePublic = isQuote || (isShort && selectedChannel?.platform === "facebook");
    const minInterval = isQuote ? 60 : 120;

    return (
      <div key={type} className="space-y-2">
        <div className="flex items-center gap-2">
          {isShort ? <Video className="h-3.5 w-3.5 text-rose-400 shrink-0" /> : isQuote ? <ImageIcon className="h-3.5 w-3.5 text-amber-400 shrink-0" /> : <Film className="h-3.5 w-3.5 text-cyan-400 shrink-0" />}
          <span className={`text-xs font-medium ${isShort ? "text-rose-300" : isQuote ? "text-amber-300" : "text-cyan-300"}`}>
            {isShort ? "Short / Reel" : isQuote ? "Bài ảnh Facebook" : "Long"} · {count} chưa lên lịch
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">Kênh</label>
            <select value={ch} onChange={e => setCh(+e.target.value)}
              className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
              {availableChannels.map(c => <option key={c.id} value={c.id}>{c.platform === "facebook" ? "Facebook" : "YouTube"} · {c.name}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-1">
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Từ</label>
              <input type="time" value={w.start} onChange={e => setW(x => ({ ...x, start: e.target.value }))}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
            <span className="text-slate-600 pb-2">–</span>
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Đến</label>
              <input type="time" value={w.end} onChange={e => setW(x => ({ ...x, end: e.target.value }))}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Cách (phút)</label>
              <input type="number" min={minInterval} step={60} max={1440} value={Math.max(minInterval, intv)} onChange={e => setIntv(+e.target.value)}
                className="w-20 border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500" />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-slate-500 mb-1">Quyền</label>
              <select value={forcePublic ? "public" : prv} onChange={e => setPrv(e.target.value as "public"|"unlisted"|"private")}
                disabled={forcePublic}
                className="w-full border border-slate-600 rounded px-2 py-1.5 text-xs bg-slate-900 text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500">
                {privOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-end">
            <button onClick={() => sched(type)} disabled={busy}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded disabled:opacity-40 transition-colors ${isShort ? "bg-rose-600 hover:bg-rose-500 text-white" : isQuote ? "bg-amber-600 hover:bg-amber-500 text-white" : "bg-cyan-700 hover:bg-cyan-600 text-white"}`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
              Lên lịch {count} {isShort ? "Short" : isQuote ? "Bài ảnh" : "Long"}
            </button>
          </div>
        </div>
        {isShort && selectedChannel?.platform === "facebook" && (
          <p className="text-[10px] text-slate-500">Facebook short sẽ được đăng dạng Reel và luôn ở chế độ công khai.</p>
        )}
        {isQuote && (
          <p className="text-[10px] text-slate-500">Bài ảnh dùng ảnh đầu của short và caption ngắn theo chủ đề, phù hợp để chạy song song nhiều Facebook Page.</p>
        )}
        {msg && <p className={`text-xs ${msg.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-400" />
        <p className="text-sm font-semibold text-slate-200">Sẵn sàng đăng</p>
        <div className="flex gap-1.5 ml-auto">
          {shortCount > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full border border-rose-700/50 bg-rose-900/20 text-rose-300">{shortCount} Short</span>}
          {quoteCount > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-700/50 bg-amber-900/20 text-amber-300">{quoteCount} Quote</span>}
          {longCount  > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full border border-cyan-700/50 bg-cyan-900/20 text-cyan-300">{longCount} Long</span>}
        </div>
      </div>
      <div className="space-y-4 divide-y divide-slate-700/50">
        <div>{renderRow("short")}</div>
        {quoteCount > 0 && <div className="pt-4">{renderRow("quote")}</div>}
        {longCount > 0 && <div className="pt-4">{renderRow("long")}</div>}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  initialItems: UploadQueueRow[];
  initialReady: ReadyVideoRow[];
}

export function ScheduleClient({ initialItems, initialReady }: Props) {
  const [items,    setItems]    = useState<UploadQueueRow[]>(initialItems);
  const [ready,    setReady]    = useState<ReadyVideoRow[]>(initialReady);
  const [channels, setChannels] = useState<SocialChannel[]>([]);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    getChannelsAction().then(chs => setChannels(chs.filter(c => c.isActive && !c.needsReconnect)));
  }, []);

  const scheduleChannels = React.useMemo(() => {
    const seen = new Set<string>();
    const deduped: SocialChannel[] = [];
    for (const channel of channels) {
      const key = channel.platformAccountId ? `account:${channel.platformAccountId}` : `channel:${channel.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(channel);
    }
    return deduped;
  }, [channels]);
  const shortScheduleChannels = React.useMemo(
    () => scheduleChannels.filter((c) => c.platform === "youtube" || c.platform === "facebook"),
    [scheduleChannels],
  );
  const quoteScheduleChannels = React.useMemo(
    () => scheduleChannels.filter((c) => c.platform === "facebook"),
    [scheduleChannels],
  );
  const longScheduleChannels = React.useMemo(
    () => scheduleChannels.filter((c) => c.platform === "youtube"),
    [scheduleChannels],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    const [rows, readyRows] = await Promise.all([
      getUploadQueueAction({ limit: 200 }),
      getReadyVideosAction(),
    ]);
    setItems(rows.filter(r => r.status !== "done"));
    setReady(readyRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    const hasActive = items.some(i => i.status === "queued" || i.status === "uploading");
    if (!hasActive) return;
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [items, reload]);

  // Group by channel
  const byChannel = items.reduce((acc, item) => {
    const k = String(item.platformAccountId ?? item.channelId);
    if (!acc[k]) {
      const platformLabel = item.platform === "facebook" ? "Facebook" : "YouTube";
      const displayName = item.platformAccountName ?? item.channelName;
      acc[k] = { label: `${platformLabel} · ${displayName}`, short: [], quote: [], long: [] };
    }
    const bucket = item.videoType === "short" ? "short" : item.videoType === "quote" ? "quote" : "long";
    acc[k][bucket].push(item);
    return acc;
  }, {} as Record<string, { label: string; short: UploadQueueRow[]; quote: UploadQueueRow[]; long: UploadQueueRow[] }>);

  const totalQueued    = items.filter(i => i.status === "queued").length;
  const totalUploading = items.filter(i => i.status === "uploading").length;
  const totalError     = items.filter(i => i.status === "error").length;
  const facebookNeedsReconnect = channels.some((c) => c.platform === "facebook" && c.needsReconnect);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Lịch đăng</h1>
          <p className="text-sm text-slate-400 mt-1">Quản lý hàng chờ đăng video theo kênh và nền tảng.</p>
        </div>
        <button onClick={reload} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg hover:border-slate-500 transition-colors disabled:opacity-40">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Auto-schedule */}
      <AutoSchedulePanel shortChannels={shortScheduleChannels} longChannels={longScheduleChannels} quoteChannels={quoteScheduleChannels} />

      {facebookNeedsReconnect && (
        <div className="rounded-xl border border-red-800/40 bg-red-950/20 px-4 py-3">
          <p className="text-sm font-medium text-red-300">Facebook đang tạm dừng đăng</p>
          <p className="text-xs text-red-400/80 mt-1">
            Token Page đã hết hạn hoặc thiếu quyền. Cron Facebook đang tự hoãn queue để tránh đăng lỗi lặp lại.
            Cập nhật token ở <a href="/settings/channels" className="underline underline-offset-2 hover:text-red-300">Settings / Kênh</a>.
          </p>
        </div>
      )}

      {/* Bulk scheduler for unscheduled videos */}
      <BulkScheduler ready={ready} channels={shortScheduleChannels} onScheduled={reload} />

      {/* Stats */}
      {(totalQueued > 0 || totalUploading > 0 || totalError > 0) && (
        <div className="flex flex-wrap gap-2">
          {totalUploading > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900/30 border border-blue-700/50 text-xs text-blue-300">
              <Loader2 className="h-3 w-3 animate-spin" />{totalUploading} đang upload
            </div>
          )}
          {totalQueued > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900/20 border border-amber-700/40 text-xs text-amber-300">
              <Clock className="h-3 w-3" />{totalQueued} chờ đăng
            </div>
          )}
          {totalError > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/20 border border-red-700/40 text-xs text-red-300">
              <XCircle className="h-3 w-3" />{totalError} lỗi
            </div>
          )}
        </div>
      )}

      {/* Queue by channel */}
      {Object.keys(byChannel).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-600">
          <CalendarPlus className="h-10 w-10" />
          <p className="text-sm">Không có video nào đang chờ đăng</p>
          <p className="text-xs text-slate-700">Video đã đăng xong xem tại <a href="/publishing/analytics" className="text-rose-400 hover:underline">Phân tích</a></p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(byChannel).map(([chId, { label, short, quote, long }]) => (
            <ChannelGroup key={chId} channelLabel={label} short={short} quote={quote} long={long} onUpdate={reload} />
          ))}
        </div>
      )}
    </div>
  );
}
