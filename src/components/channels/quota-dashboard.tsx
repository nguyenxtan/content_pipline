"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Clock, Zap, Plus, Trash2, TvMinimalPlay as Youtube, ExternalLink } from "lucide-react";
import type { ChannelQuotaStat } from "@/actions/youtube-clients";
import type { YoutubeOauthClient } from "@/lib/db/schema";
import {
  getYoutubeQuotaStatsAction,
  createYoutubeOauthClientAction,
  deleteYoutubeOauthClientAction,
} from "@/actions/youtube-clients";

// ─── Quota bar ─────────────────────────────────────────────────────────────

function QuotaBar({ pct, isExceeded }: { pct: number; isExceeded: boolean }) {
  const color = isExceeded
    ? "bg-red-500"
    : pct >= 80
      ? "bg-amber-500"
      : pct >= 50
        ? "bg-yellow-400"
        : "bg-green-500";
  return (
    <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ─── Single channel card ────────────────────────────────────────────────────

function QuotaCard({ stat }: { stat: ChannelQuotaStat }) {
  const statusIcon = stat.isExceeded
    ? <XCircle className="h-4 w-4 text-red-400 shrink-0" />
    : stat.needsReconnect
      ? <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
      : !stat.hasToken
        ? <AlertTriangle className="h-4 w-4 text-slate-500 shrink-0" />
        : <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />;

  const statusText = stat.isExceeded
    ? "Hết quota"
    : stat.needsReconnect
      ? "Mất kết nối"
      : !stat.hasToken
        ? "Chưa kết nối"
        : "Hoạt động";

  const resetTime = stat.nextReset.toLocaleTimeString("vi-VN", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      stat.isExceeded
        ? "border-red-800/50 bg-red-950/20"
        : stat.needsReconnect || !stat.hasToken
          ? "border-amber-800/40 bg-amber-950/10"
          : "border-slate-700 bg-slate-800/40"
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {statusIcon}
            <span className="text-sm font-semibold text-slate-100 truncate">{stat.channelName}</span>
            {stat.platformHandle && (
              <span className="text-xs text-slate-500">{stat.platformHandle}</span>
            )}
          </div>
          {stat.clientName && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              Client: <span className="font-medium text-slate-400">{stat.clientName}</span>
              {stat.oauthClientShort && <span className="ml-1 font-mono text-slate-600">({stat.oauthClientShort}…)</span>}
            </p>
          )}
          {!stat.clientName && (
            <p className="text-[11px] text-slate-600 mt-0.5">Client: .env (YOUTUBE_CLIENT_ID)</p>
          )}
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
          stat.isExceeded
            ? "bg-red-900/50 text-red-300"
            : stat.needsReconnect || !stat.hasToken
              ? "bg-amber-900/40 text-amber-400"
              : "bg-green-900/30 text-green-400"
        }`}>
          {statusText}
        </span>
      </div>

      {/* Quota bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">
            <Zap className="inline h-3 w-3 mr-0.5 text-amber-400" />
            {stat.unitsUsed.toLocaleString()} / 10,000 units
          </span>
          <span className="text-slate-500">{stat.uploadsToday} video hôm nay</span>
        </div>
        <QuotaBar pct={stat.usagePct} isExceeded={stat.isExceeded} />
        <div className="flex justify-between text-[11px] text-slate-600">
          <span>{stat.usagePct}% đã dùng</span>
          <span>Còn ~{Math.floor(stat.unitsRemaining / 1650)} video</span>
        </div>
      </div>

      {/* Reset time */}
      <div className="flex items-center gap-1 text-[11px] text-slate-600">
        <Clock className="h-3 w-3" />
        <span>Reset lúc {resetTime} (giờ VN)</span>
        {stat.isExceeded && stat.quotaExceededUntil && (
          <span className="ml-1 text-red-400">· Hết quota đến {new Date(stat.quotaExceededUntil).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })}</span>
        )}
      </div>

      {/* Connect button if no token */}
      {!stat.hasToken && stat.clientId && (
        <a
          href={`/api/auth/youtube?clientConfigId=${stat.clientId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors w-fit"
        >
          <Youtube className="h-3 w-3" />
          Kết nối kênh
        </a>
      )}
      {stat.needsReconnect && stat.clientId && (
        <a
          href={`/api/auth/youtube?clientConfigId=${stat.clientId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors w-fit"
        >
          <Youtube className="h-3 w-3" />
          Kết nối lại
        </a>
      )}
    </div>
  );
}

// ─── Add client form ────────────────────────────────────────────────────────

function AddClientForm({ onAdded }: { onAdded: () => void }) {
  const [name,   setName]   = useState("");
  const [cid,    setCid]    = useState("");
  const [secret, setSecret] = useState("");
  const [error,  setError]  = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setError("");
    setSaving(true);
    const res = await createYoutubeOauthClientAction({ name, clientId: cid, clientSecret: secret });
    setSaving(false);
    if ("error" in res) { setError(res.error); return; }
    setName(""); setCid(""); setSecret("");
    onAdded();
  };

  return (
    <div className="rounded-xl border border-dashed border-slate-600 p-4 space-y-3 bg-slate-800/30">
      <p className="text-xs font-semibold text-slate-400">Thêm OAuth Client mới</p>
      <div className="space-y-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Tên (VD: GCP Project 2)"
          className="w-full border border-slate-600 rounded-lg px-3 py-2 text-xs bg-slate-900 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-rose-500" />
        <input value={cid} onChange={e => setCid(e.target.value)} placeholder="Client ID"
          className="w-full border border-slate-600 rounded-lg px-3 py-2 text-xs bg-slate-900 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-rose-500 font-mono" />
        <input value={secret} onChange={e => setSecret(e.target.value)} placeholder="Client Secret" type="password"
          className="w-full border border-slate-600 rounded-lg px-3 py-2 text-xs bg-slate-900 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-rose-500 font-mono" />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button onClick={handleSave} disabled={saving || !name || !cid || !secret}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg disabled:opacity-50 transition-colors">
        <Plus className="h-3.5 w-3.5" />
        {saving ? "Đang lưu..." : "Lưu client"}
      </button>
    </div>
  );
}

// ─── Main dashboard ─────────────────────────────────────────────────────────

interface Props {
  initialStats:   ChannelQuotaStat[];
  initialClients: YoutubeOauthClient[];
}

export function QuotaDashboard({ initialStats, initialClients }: Props) {
  const [stats,       setStats]       = useState<ChannelQuotaStat[]>(initialStats);
  const [clients,     setClients]     = useState<YoutubeOauthClient[]>(initialClients);
  const [showAdd,     setShowAdd]     = useState(false);
  const [isPending,   startTransition] = useTransition();

  const refresh = () => {
    startTransition(async () => {
      const fresh = await getYoutubeQuotaStatsAction();
      setStats(fresh);
    });
  };

  const handleDeleteClient = async (id: number) => {
    if (!confirm("Xóa OAuth client này? Các kênh liên kết sẽ bị ngắt liên kết client.")) return;
    await deleteYoutubeOauthClientAction(id);
    setClients(prev => prev.filter(c => c.id !== id));
    refresh();
  };

  const totalUploads  = stats.reduce((s, c) => s + c.uploadsToday, 0);
  const totalUnits    = stats.reduce((s, c) => s + c.unitsUsed, 0);
  const totalCapacity = stats.length * 10_000;
  const availableChannels = stats.filter(c => !c.isExceeded && !c.needsReconnect && c.hasToken).length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Video hôm nay", value: totalUploads, sub: `/${stats.length * 6} tối đa` },
          { label: "Units dùng",    value: totalUnits.toLocaleString(), sub: `/${(totalCapacity / 1000).toFixed(0)}K tổng` },
          { label: "Kênh sẵn sàng", value: availableChannels, sub: `/${stats.length} kênh` },
        ].map(item => (
          <div key={item.label} className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-center">
            <p className="text-lg font-bold text-slate-100">{item.value}</p>
            <p className="text-[10px] text-slate-500">{item.label}</p>
            <p className="text-[10px] text-slate-600">{item.sub}</p>
          </div>
        ))}
      </div>

      {/* Per-channel quota cards */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Quota theo kênh</p>
        <button onClick={refresh} disabled={isPending}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40">
          <RefreshCw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {stats.length === 0 ? (
        <p className="text-xs text-slate-600 py-4 text-center">Chưa có kênh YouTube nào</p>
      ) : (
        <div className="space-y-2">
          {stats.map(s => <QuotaCard key={s.channelId} stat={s} />)}
        </div>
      )}

      {/* OAuth clients management */}
      <div className="pt-2 border-t border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">OAuth Clients ({clients.length})</p>
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 transition-colors">
            <Plus className="h-3.5 w-3.5" />
            Thêm client
          </button>
        </div>

        {showAdd && (
          <div className="mb-3">
            <AddClientForm onAdded={() => { setShowAdd(false); refresh(); }} />
          </div>
        )}

        <div className="space-y-2">
          {clients.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-700/60 bg-slate-800/30">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-300">{c.name}</p>
                <p className="text-[10px] font-mono text-slate-600 truncate">{c.clientId.slice(0, 40)}…</p>
              </div>
              <a href={`/api/auth/youtube?clientConfigId=${c.id}`}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-600 text-red-400 hover:border-red-600/60 transition-colors whitespace-nowrap">
                <Youtube className="h-3 w-3" />
                Kết nối kênh
              </a>
              <button onClick={() => handleDeleteClient(c.id)}
                className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {clients.length === 0 && (
            <p className="text-xs text-slate-600 py-2 text-center">Chưa có OAuth client nào được lưu</p>
          )}
        </div>

        <div className="mt-3 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/40 text-[11px] text-slate-500 space-y-1">
          <p className="font-medium text-slate-400">Cách dùng:</p>
          <p>1. Thêm 3 OAuth clients (3 GCP projects)</p>
          <p>2. Nhấn &quot;Kết nối kênh&quot; trên mỗi client → xác thực OAuth</p>
          <p>3. Cron job tự động chuyển sang client còn quota khi một client hết</p>
          <p>4. Tổng dung lượng: <span className="text-amber-400 font-medium">~{clients.length * 6} video/ngày</span></p>
        </div>
      </div>
    </div>
  );
}
