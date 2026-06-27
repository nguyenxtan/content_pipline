"use client";

import { useState, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  TvMinimalPlay as Youtube,
  Tv2 as Facebook,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { SocialChannel, YoutubeOauthClient } from "@/lib/db/schema";
import {
  connectFacebookPageManualAction,
  deleteChannelAction,
  getChannelsAction,
  inspectFacebookTokenAction,
  rotateFacebookPageTokenAction,
  toggleChannelAction,
  verifyFacebookEnvAction,
} from "@/actions/social-channels";
import type { FacebookTokenInfo } from "@/lib/social/facebook-api";
import type { ChannelQuotaStat } from "@/actions/youtube-clients";
import { QuotaDashboard } from "@/components/channels/quota-dashboard";

// ─── status helpers ──────────────────────────────────────────────────────────

type ChannelStatus = "connected" | "needs_reconnect" | "disabled";

function getChannelStatus(ch: SocialChannel): ChannelStatus {
  if (!ch.isActive) return "disabled";
  if (ch.needsReconnect) return "needs_reconnect";
  return "connected";
}

function StatusBadge({
  status,
  variant = "default",
}: {
  status: ChannelStatus | "backup" | "queue_active";
  variant?: "default" | "compact";
}) {
  const cls = variant === "compact" ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5";
  if (status === "connected")
    return (
      <span className={`inline-flex items-center gap-1 ${cls} rounded-full bg-green-900/40 text-green-300 font-medium`}>
        <CheckCircle className="h-3 w-3" /> Đã kết nối
      </span>
    );
  if (status === "needs_reconnect")
    return (
      <span className={`inline-flex items-center gap-1 ${cls} rounded-full bg-red-900/40 text-red-300 font-medium`}>
        <AlertCircle className="h-3 w-3" /> Cần kết nối lại
      </span>
    );
  if (status === "disabled")
    return (
      <span className={`inline-flex items-center gap-1 ${cls} rounded-full bg-slate-700 text-slate-400 font-medium`}>
        Tạm dừng
      </span>
    );
  if (status === "backup")
    return (
      <span className={`inline-flex items-center gap-1 ${cls} rounded-full bg-slate-800 text-slate-500`}>
        Backup
      </span>
    );
  if (status === "queue_active")
    return (
      <span className={`inline-flex items-center gap-1 ${cls} rounded-full bg-emerald-900/40 text-emerald-300 font-medium`}>
        Kênh đang dùng bởi queue
      </span>
    );
  return null;
}

function humanPlatformError(platform: string): string {
  if (platform === "youtube") return "Token YouTube hết hạn — cần kết nối lại";
  return "Token Facebook cần cập nhật";
}

function formatTokenExpiry(val: Date | string | null | undefined): string {
  if (!val) return "";
  const utc = new Date(val instanceof Date ? val : val);
  const vn = new Date(utc.getTime() + 7 * 3_600_000);
  return vn.toISOString().slice(0, 16).replace("T", " ") + " VN";
}

// ─── BrandChannelCard (primary compact card) ────────────────────────────────

function BrandChannelCard({
  channel,
  reconnectHref,
  reconnectLabel,
  onToggle,
  onDelete,
  isCanonical,
  extra,
}: {
  channel: SocialChannel;
  reconnectHref?: string;
  reconnectLabel?: string;
  onToggle: () => void;
  onDelete: () => void;
  isCanonical?: boolean;
  /** Additional content rendered below the card (e.g., advanced collapse) */
  extra?: React.ReactNode;
}) {
  const [deleting, setDeleting] = useState(false);
  const status = getChannelStatus(channel);
  const Icon = channel.platform === "youtube" ? Youtube : Facebook;
  const iconColor = channel.platform === "youtube" ? "text-red-400" : "text-blue-400";

  const handleDelete = async () => {
    if (!confirm(`Ngắt kết nối kênh "${channel.name}"?`)) return;
    setDeleting(true);
    await deleteChannelAction(channel.id);
    onDelete();
  };

  return (
    <div>
      <div
        className={`rounded-xl border p-4 flex items-center gap-4 ${
          status === "needs_reconnect"
            ? "border-red-800/40 bg-red-950/10"
            : "border-slate-700/60 bg-slate-900/40"
        }`}
      >
        {/* Avatar */}
        {channel.thumbnailUrl ? (
          <img
            src={channel.thumbnailUrl}
            alt=""
            className="w-10 h-10 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-100 truncate">{channel.name}</span>
            <StatusBadge status={status} />
            {isCanonical && <StatusBadge status="queue_active" />}
          </div>
          {status === "needs_reconnect" && (
            <p className="text-xs text-red-400/80 mt-0.5">
              {humanPlatformError(channel.platform)}
            </p>
          )}
          {status === "connected" &&
            channel.platform === "youtube" &&
            channel.scope &&
            !channel.scope.includes("yt-analytics.readonly") && (
              <p className="text-xs text-amber-400/80 mt-0.5">
                Thiếu quyền Analytics — kết nối lại để cấp quyền đầy đủ.
              </p>
            )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {status === "needs_reconnect" && reconnectHref && (
            <a
              href={reconnectHref}
              data-testid="primary-reconnect-btn"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              {reconnectLabel ?? "Kết nối lại"}
            </a>
          )}
          {channel.platformChannelId && channel.platform === "youtube" && (
            <a
              href={`https://studio.youtube.com/channel/${channel.platformChannelId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-300 transition-colors"
              title="Mở YouTube Studio"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <button
            onClick={onToggle}
            title={channel.isActive ? "Tạm dừng kênh" : "Kích hoạt kênh"}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            {channel.isActive ? (
              <ToggleRight className="h-5 w-5 text-green-500" />
            ) : (
              <ToggleLeft className="h-5 w-5" />
            )}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Xoá kênh"
            className="text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {extra}
    </div>
  );
}

// ─── YouTubeOAuthAdvanced ─────────────────────────────────────────────────────
// Generic collapsed OAuth-client management section shared by both YouTube brands.
// Shows one row per registered GCP OAuth project + the Default Env row.

function YouTubeOAuthAdvanced({
  channelKey,
  channelLabel,
  youtubeChannels,
  initialOauthClients,
  canonicalScId,
  hasGoogleCreds,
  firstConnectChannelId,
  setFirstConnectChannelId,
}: {
  /** 'phat_phap' | 'tang_sau' — passed verbatim into OAuth URL */
  channelKey: string;
  /** Human label for placeholder text, e.g. "Giới Định Tuệ" or "Tầng Sâu" */
  channelLabel: string;
  /** All social_channel rows for this brand + platform='youtube' */
  youtubeChannels: SocialChannel[];
  initialOauthClients: YoutubeOauthClient[];
  canonicalScId: number | null;
  hasGoogleCreds: boolean;
  /** Controlled state for manual first-connect channel-ID input */
  firstConnectChannelId: string;
  setFirstConnectChannelId: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const derivedPlatformChId =
    youtubeChannels[0]?.platformChannelId ?? firstConnectChannelId.trim();

  /** Build OAuth reconnect URL for a named GCP project client. */
  function clientHref(platformChId: string, clientId: number): string {
    if (!platformChId || !hasGoogleCreds) return "#";
    return `/api/auth/youtube?channelKey=${channelKey}&targetPlatformChannelId=${encodeURIComponent(platformChId)}&clientConfigId=${clientId}`;
  }

  /** Build OAuth reconnect URL for Default Env OAuth (no clientConfigId). */
  function envHref(platformChId: string): string {
    if (!platformChId || !hasGoogleCreds) return "#";
    return `/api/auth/youtube?channelKey=${channelKey}&targetPlatformChannelId=${encodeURIComponent(platformChId)}`;
  }

  return (
    <div className="mt-1 pl-1">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors py-1.5"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Cài đặt nâng cao OAuth
      </button>

      {open && (
        <div className="mt-1 rounded-xl border border-slate-700/60 bg-slate-900/50 p-4 space-y-3">
          <p className="text-[11px] text-slate-500">
            Mỗi GCP Project tạo một hàng riêng trong{" "}
            <code className="font-mono text-slate-400">social_channels</code>.
            Kết nối đúng Project để cập nhật đúng hàng mà upload queue đang dùng.
          </p>

          {/* First-connect manual Channel ID input */}
          {youtubeChannels.length === 0 && (
            <div className="space-y-1">
              <p className="text-xs text-amber-300">
                Chưa có destination. Nhập Channel ID để kết nối lần đầu:
              </p>
              <input
                value={firstConnectChannelId}
                onChange={(e) => setFirstConnectChannelId(e.target.value)}
                placeholder={`UC... YouTube Channel ID của ${channelLabel}`}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          )}

          <div className="space-y-2">
            {/* One row per registered GCP OAuth client */}
            {initialOauthClients.map((client) => {
              const chRow = youtubeChannels.find(
                (c) => c.oauthClientConfigId === client.id
              );
              const platformChId = chRow?.platformChannelId ?? derivedPlatformChId;
              const href = clientHref(platformChId, client.id);
              const isReady = !!(platformChId && hasGoogleCreds);
              const isCanonical = !!(chRow && chRow.id === canonicalScId);
              const needsFix = !!chRow?.needsReconnect;
              // Button label: canonical = reconnect, backup = "Kết nối backup", no row = "Kết nối"
              const btnLabel = isCanonical
                ? "Kết nối lại"
                : chRow
                ? "Kết nối backup"
                : "Kết nối";

              return (
                <div
                  key={client.id}
                  className={`rounded-lg border p-3 flex items-start gap-3 ${
                    needsFix
                      ? "border-red-800/50 bg-red-950/20"
                      : "border-slate-700/50 bg-slate-900/40"
                  }`}
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-200">
                        {client.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded font-mono">
                        clientConfigId={client.id}
                      </span>
                      {chRow ? (
                        needsFix ? (
                          <span className="flex items-center gap-1 text-[10px] text-red-400">
                            <AlertCircle className="h-3 w-3" />
                            sc#{chRow.id} · Token hết hạn
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] text-green-400">
                            <CheckCircle className="h-3 w-3" />
                            sc#{chRow.id} · Đã kết nối
                          </span>
                        )
                      ) : (
                        <span className="text-[10px] text-slate-600 italic">
                          Chưa có hàng DB
                        </span>
                      )}
                      {isCanonical && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900/40 text-emerald-400 rounded font-mono">
                          queue đang dùng
                        </span>
                      )}
                      {chRow && !isCanonical && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded">
                          Backup / không có queue
                        </span>
                      )}
                    </div>
                    {chRow && (
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-0.5">
                        <span className="text-[10px] text-slate-500 font-mono">
                          expires: {formatTokenExpiry(chRow.tokenExpiresAt) || "—"}
                        </span>
                        {chRow.lastError && (
                          <span
                            className="text-[10px] text-red-400/70 font-mono max-w-xs truncate"
                            title={chRow.lastError}
                          >
                            {chRow.lastError.slice(0, 60)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <a
                    href={href}
                    onClick={(e) => {
                      if (!isReady) e.preventDefault();
                    }}
                    className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                      isReady
                        ? needsFix
                          ? "bg-red-600 hover:bg-red-500 text-white"
                          : isCanonical
                          ? "bg-amber-700 hover:bg-amber-600 text-white"
                          : "bg-slate-700 hover:bg-slate-600 text-slate-200"
                        : "bg-slate-800 text-slate-600 cursor-not-allowed"
                    }`}
                    title={
                      !platformChId
                        ? "Nhập Channel ID trước"
                        : !hasGoogleCreds
                        ? "Cần cấu hình Google credentials"
                        : `Kết nối qua ${client.name}`
                    }
                  >
                    <RefreshCw className="h-3 w-3" />
                    {btnLabel}
                  </a>
                </div>
              );
            })}

            {/* Default Env OAuth row (oauthClientConfigId = null) */}
            {(() => {
              const chRow = youtubeChannels.find(
                (c) => c.oauthClientConfigId === null
              );
              const platformChId = chRow?.platformChannelId ?? derivedPlatformChId;
              const href = envHref(platformChId);
              const isReady = !!(platformChId && hasGoogleCreds);
              const isCanonical = !!(chRow && chRow.id === canonicalScId);
              const needsFix = !!chRow?.needsReconnect;
              return (
                <div className="rounded-lg border border-slate-700/40 bg-slate-900/30 p-3 flex items-start gap-3 opacity-80">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-slate-400">
                        Default Env OAuth
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded font-mono">
                        YOUTUBE_CLIENT_ID
                      </span>
                      {chRow ? (
                        needsFix ? (
                          <span className="flex items-center gap-1 text-[10px] text-red-400">
                            <AlertCircle className="h-3 w-3" />
                            sc#{chRow.id} · Token hết hạn
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] text-green-400">
                            <CheckCircle className="h-3 w-3" />
                            sc#{chRow.id} · Đã kết nối
                          </span>
                        )
                      ) : (
                        <span className="text-[10px] text-slate-600 italic">
                          Chưa có hàng DB
                        </span>
                      )}
                      {isCanonical && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900/40 text-emerald-400 rounded font-mono">
                          queue đang dùng
                        </span>
                      )}
                      {chRow && !isCanonical && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded">
                          Backup / không có queue
                        </span>
                      )}
                    </div>
                    {chRow && (
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 pt-0.5">
                        <span className="text-[10px] text-slate-500 font-mono">
                          expires: {formatTokenExpiry(chRow.tokenExpiresAt) || "—"}
                        </span>
                        {chRow.lastError && (
                          <span
                            className="text-[10px] text-red-400/70 font-mono max-w-xs truncate"
                            title={chRow.lastError}
                          >
                            {chRow.lastError.slice(0, 60)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <a
                    href={href}
                    onClick={(e) => {
                      if (!isReady) e.preventDefault();
                    }}
                    className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                      isReady
                        ? needsFix
                          ? "bg-red-600 hover:bg-red-500 text-white"
                          : "bg-slate-700 hover:bg-slate-600 text-slate-200"
                        : "bg-slate-800 text-slate-600 cursor-not-allowed"
                    }`}
                    title={
                      !platformChId
                        ? "Nhập Channel ID trước"
                        : "Kết nối qua Default Env OAuth (YOUTUBE_CLIENT_ID)"
                    }
                  >
                    <RefreshCw className="h-3 w-3" />
                    OAuth mặc định
                  </a>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FacebookAdvanced ─────────────────────────────────────────────────────────
// Rotate-token + inspect panel, collapsed by default.

function FacebookAdvanced({
  hasFacebookEnvConfig,
  isPending,
  fbUserToken,
  setFbUserToken,
  onRotate,
  tokenInfo,
  tokenLoading,
  onInspect,
  manualFbPageId,
  setManualFbPageId,
  manualFbPageToken,
  setManualFbPageToken,
  manualFbStatus,
  onTangSauFbConnect,
  tangSauFbConnected,
}: {
  hasFacebookEnvConfig: boolean;
  isPending: boolean;
  fbUserToken: string;
  setFbUserToken: (v: string) => void;
  onRotate: () => void;
  tokenInfo: FacebookTokenInfo | null;
  tokenLoading: boolean;
  onInspect: () => void;
  manualFbPageId: string;
  setManualFbPageId: (v: string) => void;
  manualFbPageToken: string;
  setManualFbPageToken: (v: string) => void;
  manualFbStatus: { type: "success"; name: string; pageId: string; message: string } | { type: "error"; message: string } | null;
  onTangSauFbConnect: () => void;
  tangSauFbConnected: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 pl-1">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors py-1.5"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Cài đặt nâng cao Facebook
      </button>

      {open && (
        <div className="mt-1 rounded-xl border border-slate-700/60 bg-slate-900/50 p-4 space-y-4">
          {/* Rotate token */}
          {hasFacebookEnvConfig && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-slate-200">Rotate Facebook token</p>
                <p className="text-xs text-slate-500 mt-1">
                  Dán user access token mới. App sẽ tự đổi sang token dài hơn, lấy đúng Page
                  access token và lưu vào DB để cron dùng ngay.
                </p>
              </div>
              <textarea
                value={fbUserToken}
                onChange={(e) => setFbUserToken(e.target.value)}
                rows={3}
                placeholder="Dán user access token từ Graph API Explorer hoặc flow login của app"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={onRotate}
                  disabled={isPending || !fbUserToken.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
                  {isPending ? "Đang rotate…" : "Rotate token"}
                </button>
                <span className="text-[11px] text-slate-500">
                  Dùng khi Facebook báo hết hạn hoặc thiếu quyền.
                </span>
              </div>
            </div>
          )}

          {/* Inspect token */}
          {hasFacebookEnvConfig && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-200">Kiểm tra token hiện tại</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Xem hạn token Facebook Page đang dùng trong DB.
                  </p>
                </div>
                <button
                  onClick={onInspect}
                  disabled={tokenLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 rounded-lg transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${tokenLoading ? "animate-spin" : ""}`} />
                  {tokenLoading ? "Đang kiểm tra…" : "Kiểm tra token"}
                </button>
              </div>

              {tokenInfo && (
                <div className="space-y-2 pt-1 border-t border-slate-800">
                  {tokenInfo.error ? (
                    <div className="flex items-center gap-2 text-xs text-red-400">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {tokenInfo.error}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 flex-wrap">
                        {tokenInfo.isValid ? (
                          <span className="flex items-center gap-1 text-xs text-green-400 font-medium">
                            <CheckCircle className="h-3.5 w-3.5" /> Token hợp lệ
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
                            <AlertCircle className="h-3.5 w-3.5" /> Token không hợp lệ
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          Loại:{" "}
                          <span className="text-slate-300">{tokenInfo.tokenType}</span>
                        </span>
                        {tokenInfo.appId && (
                          <span className="text-xs text-slate-500">
                            App:{" "}
                            <span className="text-slate-300 font-mono">{tokenInfo.appId}</span>
                          </span>
                        )}
                      </div>
                      {tokenInfo.expiresAt === null ? (
                        <div className="flex items-center gap-1.5 text-xs text-green-400">
                          <CheckCircle className="h-3 w-3" />
                          Page token — không hết hạn
                        </div>
                      ) : (
                        <div
                          className={`flex items-center gap-1.5 text-xs ${
                            (tokenInfo.daysLeft ?? 0) < 7
                              ? "text-red-400"
                              : (tokenInfo.daysLeft ?? 0) < 14
                              ? "text-amber-400"
                              : "text-slate-300"
                          }`}
                        >
                          <Info className="h-3 w-3 shrink-0" />
                          Hết hạn:{" "}
                          {new Date(tokenInfo.expiresAt).toLocaleDateString("vi-VN")}
                          {tokenInfo.daysLeft !== null && (
                            <span className="ml-1">
                              (
                              {tokenInfo.daysLeft > 0
                                ? `còn ${tokenInfo.daysLeft} ngày`
                                : "đã hết hạn"}
                              )
                            </span>
                          )}
                          {(tokenInfo.daysLeft ?? 0) < 7 && (
                            <span className="ml-2 font-medium text-red-400">⚠ Cần rotate ngay!</span>
                          )}
                        </div>
                      )}
                      {tokenInfo.scopes.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {tokenInfo.scopes.map((s) => (
                            <span
                              key={s}
                              className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tang Sau Facebook manual connect */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div>
              <p className="text-sm font-medium text-slate-200">Kết nối Facebook Page cho Tầng Sâu</p>
              <p className="text-xs text-slate-500 mt-1">
                Lưu riêng Page ID và Page access token của Tầng Sâu.
                Flow này không dùng{" "}
                <code className="font-mono text-slate-400">FACEBOOK_PAGE_ACCESS_TOKEN</code> của Phật
                Pháp.
              </p>
            </div>
            <input
              value={manualFbPageId}
              onChange={(e) => setManualFbPageId(e.target.value)}
              placeholder="Facebook Page ID của Tầng Sâu"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <textarea
              value={manualFbPageToken}
              onChange={(e) => setManualFbPageToken(e.target.value)}
              rows={3}
              placeholder="Page access token của Tầng Sâu"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={onTangSauFbConnect}
                disabled={isPending || !manualFbPageId.trim() || !manualFbPageToken.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
                {isPending ? "Đang lưu…" : "Lưu Facebook Tầng Sâu"}
              </button>
              <span className="text-[11px] text-slate-500">Chỉ cho manual upload.</span>
            </div>
            {manualFbStatus?.type === "success" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-900/30 border border-green-700/40 text-green-300 text-xs">
                <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                {manualFbStatus.name} ({manualFbStatus.pageId}) · {manualFbStatus.message}
              </div>
            )}
            {manualFbStatus?.type === "error" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/40 text-red-300 text-xs">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {manualFbStatus.message}
              </div>
            )}
            {!tangSauFbConnected && (
              <p className="text-xs text-amber-300/70">
                Tầng Sâu chưa có Facebook Page destination nào được kết nối.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BrandSection wrapper ─────────────────────────────────────────────────────

function BrandSection({
  label,
  badgeClass,
  children,
}: {
  label: string;
  badgeClass: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${badgeClass}`}>
          {label}
        </span>
        <div className="flex-1 h-px bg-slate-800" />
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  initialChannels: SocialChannel[];
  initialOauthClients: YoutubeOauthClient[];
  initialQuotaStats: ChannelQuotaStat[];
  hasGoogleCreds: boolean;
  hasFacebookEnvConfig: boolean;
  /** social_channels.id of the canonical Phật Pháp YouTube row (highest upload_queue usage). */
  canonicalPhatPhapScId: number | null;
  /** social_channels.id of the canonical Tầng Sâu YouTube row (highest upload_queue usage). */
  canonicalTangSauScId: number | null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ChannelManagerClient({
  initialChannels,
  initialOauthClients,
  initialQuotaStats,
  hasGoogleCreds,
  hasFacebookEnvConfig,
  canonicalPhatPhapScId,
  canonicalTangSauScId,
}: Props) {
  const router = useRouter();
  const [channels, setChannels] = useState<SocialChannel[]>(initialChannels);
  const [fbStatus, setFbStatus] = useState<
    | { type: "success"; name: string; pageId: string; message: string }
    | { type: "error"; message: string; pageId: string | null; needsReconnect: boolean }
    | null
  >(null);
  const [fbUserToken, setFbUserToken] = useState("");
  // First-connect channel-ID inputs (used when no rows exist yet for a brand)
  const [phatPhapFirstConnectChId, setPhatPhapFirstConnectChId] = useState("");
  const [tangSauFirstConnectChId, setTangSauFirstConnectChId] = useState("");
  const [manualFbPageId, setManualFbPageId] = useState("");
  const [manualFbPageToken, setManualFbPageToken] = useState("");
  const [manualFbStatus, setManualFbStatus] = useState<
    | { type: "success"; name: string; pageId: string; message: string }
    | { type: "error"; message: string }
    | null
  >(null);
  const [tokenInfo, setTokenInfo] = useState<FacebookTokenInfo | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const params = useSearchParams();
  const connected = params.get("connected");
  const connectedChannelKey = params.get("channelKey");
  const urlError = params.get("error");

  // Derived channel sets
  const phatPhapYouTube = channels.filter(
    (c) => c.platform === "youtube" && c.channelKey === "phat_phap"
  );
  const phatPhapFacebook = channels.filter(
    (c) => c.platform === "facebook" && c.channelKey === "phat_phap"
  );
  const tangSauYoutubeChannels = channels.filter(
    (c) => c.platform === "youtube" && c.channelKey === "tang_sau"
  );
  const tangSauFacebook = channels.filter(
    (c) => c.platform === "facebook" && c.channelKey === "tang_sau"
  );

  // ── Canonical row resolution ──
  // Canonical = row with most upload_queue usage (from server query).
  // Fallback to first row if no queue rows exist yet (first-connect scenario).

  const canonicalPhatPhapRow = canonicalPhatPhapScId
    ? phatPhapYouTube.find((c) => c.id === canonicalPhatPhapScId) ?? null
    : null;
  const primaryPhatPhapRow = canonicalPhatPhapRow ?? phatPhapYouTube[0] ?? null;

  const canonicalTangSauRow = canonicalTangSauScId
    ? tangSauYoutubeChannels.find((c) => c.id === canonicalTangSauScId) ?? null
    : null;
  const primaryTangSauRow = canonicalTangSauRow ?? tangSauYoutubeChannels[0] ?? null;

  /** Build the primary reconnect href for a YouTube channel row. */
  function buildYouTubePrimaryHref(channelKey: string, row: SocialChannel): string {
    const platformChId = row.platformChannelId;
    if (!platformChId || !hasGoogleCreds) return "#";
    const clientConfigId = row.oauthClientConfigId;
    const base = `/api/auth/youtube?channelKey=${channelKey}&targetPlatformChannelId=${encodeURIComponent(platformChId)}`;
    return clientConfigId !== null && clientConfigId !== undefined
      ? `${base}&clientConfigId=${clientConfigId}`
      : base;
  }

  const phatPhapPrimaryHref = primaryPhatPhapRow
    ? buildYouTubePrimaryHref("phat_phap", primaryPhatPhapRow)
    : "#";

  const tangSauPrimaryHref = primaryTangSauRow
    ? buildYouTubePrimaryHref("tang_sau", primaryTangSauRow)
    : "#";

  const reloadChannels = async () => {
    const next = await getChannelsAction();
    setChannels(next);
  };

  const handleDelete = (id: number) =>
    setChannels((prev) => prev.filter((c) => c.id !== id));

  const handleToggle = async (ch: SocialChannel) => {
    await toggleChannelAction(ch.id, !ch.isActive);
    setChannels((prev) =>
      prev.map((c) => (c.id === ch.id ? { ...c, isActive: !ch.isActive } : c))
    );
  };

  const handleFbVerify = () => {
    setFbStatus(null);
    startTransition(async () => {
      const result = await verifyFacebookEnvAction();
      if (!result.ok) {
        setFbStatus({
          type: "error",
          message: result.error,
          pageId: result.pageId,
          needsReconnect: result.needsReconnect,
        });
      } else {
        setFbStatus({
          type: "success",
          name: result.name,
          pageId: result.pageId,
          message: result.message,
        });
        await reloadChannels();
        router.refresh();
      }
    });
  };

  const handleInspectToken = async () => {
    setTokenLoading(true);
    setTokenInfo(null);
    try {
      const info = await inspectFacebookTokenAction();
      setTokenInfo(info);
    } finally {
      setTokenLoading(false);
    }
  };

  const handleFbRotate = () => {
    if (!fbUserToken.trim()) {
      setFbStatus({
        type: "error",
        message: "Dán user access token trước khi rotate",
        pageId: null,
        needsReconnect: false,
      });
      return;
    }
    setFbStatus(null);
    startTransition(async () => {
      const result = await rotateFacebookPageTokenAction(fbUserToken);
      if (!result.ok) {
        setFbStatus({
          type: "error",
          message: result.error,
          pageId: null,
          needsReconnect: false,
        });
        return;
      }
      setFbStatus({
        type: "success",
        name: result.name,
        pageId: result.pageId,
        message: result.message,
      });
      setFbUserToken("");
      await reloadChannels();
      router.refresh();
    });
  };

  const handleTangSauFacebookConnect = () => {
    if (!manualFbPageId.trim() || !manualFbPageToken.trim()) {
      setManualFbStatus({
        type: "error",
        message: "Nhập Facebook Page ID và Page access token của Tầng Sâu trước khi lưu.",
      });
      return;
    }
    setManualFbStatus(null);
    startTransition(async () => {
      const result = await connectFacebookPageManualAction({
        channelKey: "tang_sau",
        pageId: manualFbPageId,
        pageAccessToken: manualFbPageToken,
      });
      if (!result.ok) {
        setManualFbStatus({ type: "error", message: result.error });
        return;
      }
      setManualFbStatus({
        type: "success",
        name: result.name,
        pageId: result.pageId,
        message: result.message,
      });
      setManualFbPageId("");
      setManualFbPageToken("");
      await reloadChannels();
      router.refresh();
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Quản lý kênh</h1>
        <p className="text-sm text-slate-400 mt-1">
          Kết nối tài khoản YouTube và Facebook để lên lịch đăng video.
        </p>
      </div>

      {/* URL flash messages */}
      {connected === "youtube" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-green-300 text-sm">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Đã kết nối kênh YouTube thành công
          {connectedChannelKey === "tang_sau" ? " cho Tầng Sâu." : "!"}
        </div>
      )}
      {urlError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-900/30 border border-red-800/40 text-red-300 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {decodeURIComponent(urlError)}
        </div>
      )}
      {fbStatus?.type === "success" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-green-300 text-sm">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Đã kết nối:{" "}
          <span className="font-semibold">{fbStatus.name}</span>
          <span className="text-green-500/60 font-mono text-xs">({fbStatus.pageId})</span>
          <span className="text-green-400/80 text-xs">· {fbStatus.message}</span>
        </div>
      )}
      {fbStatus?.type === "error" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-900/30 border border-red-800/40 text-red-300 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div>
            <div>{fbStatus.message}</div>
            {fbStatus.needsReconnect && (
              <div className="text-xs text-red-400/80 mt-0.5">
                Cron Facebook đã tự tạm hoãn để tránh đăng lỗi lặp lại.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Phật Pháp ── */}
      <BrandSection label="Phật Pháp" badgeClass="bg-emerald-900/40 text-emerald-300">
        {/* YouTube — single canonical primary card + advanced collapse */}
        {primaryPhatPhapRow ? (
          <BrandChannelCard
            channel={primaryPhatPhapRow}
            reconnectHref={phatPhapPrimaryHref !== "#" ? phatPhapPrimaryHref : undefined}
            reconnectLabel="Kết nối lại kênh đang dùng"
            isCanonical={primaryPhatPhapRow.id === canonicalPhatPhapScId}
            onToggle={() => handleToggle(primaryPhatPhapRow)}
            onDelete={() => handleDelete(primaryPhatPhapRow.id)}
            extra={
              <YouTubeOAuthAdvanced
                channelKey="phat_phap"
                channelLabel="Giới Định Tuệ"
                youtubeChannels={phatPhapYouTube}
                initialOauthClients={initialOauthClients}
                canonicalScId={canonicalPhatPhapScId}
                hasGoogleCreds={hasGoogleCreds}
                firstConnectChannelId={phatPhapFirstConnectChId}
                setFirstConnectChannelId={setPhatPhapFirstConnectChId}
              />
            }
          />
        ) : (
          // First-connect: no rows yet
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-2">
            <p className="text-sm text-slate-400">
              Giới Định Tuệ chưa có YouTube destination nào.
            </p>
            {!hasGoogleCreds && (
              <p className="text-xs text-amber-400/70">
                Cần cấu hình{" "}
                <code className="font-mono">GOOGLE_CLIENT_ID</code> /{" "}
                <code className="font-mono">GOOGLE_CLIENT_SECRET</code>.
              </p>
            )}
            <YouTubeOAuthAdvanced
              channelKey="phat_phap"
              channelLabel="Giới Định Tuệ"
              youtubeChannels={phatPhapYouTube}
              initialOauthClients={initialOauthClients}
              canonicalScId={canonicalPhatPhapScId}
              hasGoogleCreds={hasGoogleCreds}
              firstConnectChannelId={phatPhapFirstConnectChId}
              setFirstConnectChannelId={setPhatPhapFirstConnectChId}
            />
          </div>
        )}

        {/* Facebook */}
        {phatPhapFacebook.length === 0 ? (
          <div className="text-sm text-slate-600 py-3 text-center border border-dashed border-slate-700 rounded-xl">
            {hasFacebookEnvConfig
              ? "Facebook Phật Pháp — nhấn Sync / Kiểm tra để load"
              : "Chưa có Facebook Page Phật Pháp"}
          </div>
        ) : (
          phatPhapFacebook.map((ch) => (
            <BrandChannelCard
              key={ch.id}
              channel={ch}
              onToggle={() => handleToggle(ch)}
              onDelete={() => handleDelete(ch.id)}
            />
          ))
        )}

        {/* Facebook: sync / verify button */}
        {hasFacebookEnvConfig && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleFbVerify}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 rounded-lg transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
              {isPending ? "Đang kiểm tra…" : "Sync / Kiểm tra kết nối Facebook"}
            </button>
          </div>
        )}
      </BrandSection>

      {/* ── Tầng Sâu ── */}
      <BrandSection label="Tầng Sâu" badgeClass="bg-amber-900/40 text-amber-300">
        {/* YouTube */}
        {primaryTangSauRow ? (
          <BrandChannelCard
            channel={primaryTangSauRow}
            reconnectHref={tangSauPrimaryHref !== "#" ? tangSauPrimaryHref : undefined}
            reconnectLabel="Kết nối lại kênh đang dùng"
            isCanonical={primaryTangSauRow.id === canonicalTangSauScId}
            onToggle={() => handleToggle(primaryTangSauRow)}
            onDelete={() => handleDelete(primaryTangSauRow.id)}
            extra={
              <YouTubeOAuthAdvanced
                channelKey="tang_sau"
                channelLabel="Tầng Sâu"
                youtubeChannels={tangSauYoutubeChannels}
                initialOauthClients={initialOauthClients}
                canonicalScId={canonicalTangSauScId}
                hasGoogleCreds={hasGoogleCreds}
                firstConnectChannelId={tangSauFirstConnectChId}
                setFirstConnectChannelId={setTangSauFirstConnectChId}
              />
            }
          />
        ) : (
          // First-connect: no rows yet
          <div className="rounded-xl border border-amber-800/40 bg-amber-950/10 p-4 space-y-2">
            <p className="text-sm text-amber-300">
              Tầng Sâu chưa có YouTube destination nào.
            </p>
            {!hasGoogleCreds && (
              <p className="text-xs text-amber-400/70">
                Cần cấu hình{" "}
                <code className="font-mono">GOOGLE_CLIENT_ID</code> /{" "}
                <code className="font-mono">GOOGLE_CLIENT_SECRET</code>.
              </p>
            )}
            <YouTubeOAuthAdvanced
              channelKey="tang_sau"
              channelLabel="Tầng Sâu"
              youtubeChannels={tangSauYoutubeChannels}
              initialOauthClients={initialOauthClients}
              canonicalScId={canonicalTangSauScId}
              hasGoogleCreds={hasGoogleCreds}
              firstConnectChannelId={tangSauFirstConnectChId}
              setFirstConnectChannelId={setTangSauFirstConnectChId}
            />
          </div>
        )}

        {/* Facebook */}
        {tangSauFacebook.length > 0 ? (
          tangSauFacebook.map((ch) => (
            <BrandChannelCard
              key={ch.id}
              channel={ch}
              onToggle={() => handleToggle(ch)}
              onDelete={() => handleDelete(ch.id)}
            />
          ))
        ) : (
          <div className="text-sm text-slate-600 py-3 text-center border border-dashed border-slate-700 rounded-xl">
            Tầng Sâu chưa có Facebook Page destination
          </div>
        )}

        {/* Facebook advanced (manual connect + token mgmt) */}
        <FacebookAdvanced
          hasFacebookEnvConfig={hasFacebookEnvConfig}
          isPending={isPending}
          fbUserToken={fbUserToken}
          setFbUserToken={setFbUserToken}
          onRotate={handleFbRotate}
          tokenInfo={tokenInfo}
          tokenLoading={tokenLoading}
          onInspect={handleInspectToken}
          manualFbPageId={manualFbPageId}
          setManualFbPageId={setManualFbPageId}
          manualFbPageToken={manualFbPageToken}
          setManualFbPageToken={setManualFbPageToken}
          manualFbStatus={manualFbStatus}
          onTangSauFbConnect={handleTangSauFacebookConnect}
          tangSauFbConnected={tangSauFacebook.length > 0}
        />
      </BrandSection>

      {/* ── Admin: Add channel + credentials warnings ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-400">Kết nối kênh mới</h2>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        {hasGoogleCreds ? (
          <div className="flex items-center gap-2">
            <a
              href="/api/auth/youtube"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
            >
              + Kết nối kênh YouTube
            </a>
          </div>
        ) : (
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-800/40 text-amber-300 text-xs">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">
                Thêm vào <code className="font-mono">.env.local</code> để kết nối YouTube:
              </p>
              <code className="block font-mono text-amber-200/80 whitespace-pre">{`GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/youtube/callback`}</code>
            </div>
          </div>
        )}

        {!hasFacebookEnvConfig && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-800/40 text-amber-300 text-xs">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">
                Thêm vào <code className="font-mono">.env.local</code> để kết nối Facebook Page:
              </p>
              <code className="block font-mono text-amber-200/80 whitespace-pre">{`FACEBOOK_PAGE_ID=<numeric ID hoặc username>
FACEBOOK_PAGE_ACCESS_TOKEN=<page access token>
FACEBOOK_GRAPH_VERSION=v25.0`}</code>
              <p className="mt-1 text-amber-400/70">
                Lấy token tại Meta Developer → Graph API Explorer → chọn Page → Generate Token.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── YouTube Quota ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Youtube className="h-5 w-5 text-red-400" />
          <h2 className="text-base font-semibold text-slate-200">YouTube Quota</h2>
        </div>
        <QuotaDashboard initialStats={initialQuotaStats} initialClients={initialOauthClients} />
      </section>
    </div>
  );
}
