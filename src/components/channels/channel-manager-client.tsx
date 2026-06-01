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
} from "lucide-react";
import type { SocialChannel, YoutubeOauthClient } from "@/lib/db/schema";
import { deleteChannelAction, inspectFacebookTokenAction, rotateFacebookPageTokenAction, toggleChannelAction, verifyFacebookEnvAction } from "@/actions/social-channels";
import type { FacebookTokenInfo } from "@/lib/social/facebook-api";
import type { ChannelQuotaStat } from "@/actions/youtube-clients";
import { QuotaDashboard } from "@/components/channels/quota-dashboard";

const PLATFORM_CONFIG = {
  youtube: {
    label: "YouTube",
    icon: Youtube,
    color: "text-red-400",
    bg: "bg-red-900/20 border-red-800/40",
    badge: "bg-red-900/40 text-red-300",
  },
  facebook: {
    label: "Facebook",
    icon: Facebook,
    color: "text-blue-400",
    bg: "bg-blue-900/20 border-blue-800/40",
    badge: "bg-blue-900/40 text-blue-300",
  },
} as const;

function ChannelCard({
  channel,
  onDelete,
  onToggle,
}: {
  channel: SocialChannel;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const cfg = PLATFORM_CONFIG[channel.platform as keyof typeof PLATFORM_CONFIG];
  const Icon = cfg?.icon ?? Youtube;
  const isExpired = !!channel.needsReconnect;

  const handleDelete = async () => {
    if (!confirm(`Ngắt kết nối kênh "${channel.name}"?`)) return;
    setDeleting(true);
    await deleteChannelAction(channel.id);
    onDelete();
  };

  return (
    <div className={`rounded-xl border p-4 flex items-start gap-4 ${cfg?.bg ?? "bg-slate-800/40 border-slate-700"}`}>
      <div className="shrink-0">
        {channel.thumbnailUrl ? (
          <img src={channel.thumbnailUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center">
            <Icon className={`h-6 w-6 ${cfg?.color ?? "text-slate-400"}`} />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cfg?.badge ?? ""}`}>
            {cfg?.label ?? channel.platform}
          </span>
          <span className="text-sm font-semibold text-slate-100 truncate">{channel.name}</span>
          {channel.platformHandle && (
            <span className="text-xs text-slate-500">{channel.platformHandle}</span>
          )}
          {!channel.isActive && (
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">Tạm dừng</span>
          )}
        </div>

        {channel.platformChannelId && (
          <p className="text-xs text-slate-600 mt-0.5 font-mono">{channel.platformChannelId}</p>
        )}

        {isExpired ? (
          <div className="flex flex-col gap-1 mt-1.5">
            <div className="flex items-center gap-1 text-xs text-red-400 font-medium">
              <AlertCircle className="h-3 w-3 shrink-0" />
              Token không hợp lệ — cập nhật FACEBOOK_PAGE_ACCESS_TOKEN
            </div>
            {channel.lastError && (
              <p className="text-[10px] text-slate-500 font-mono truncate" title={channel.lastError}>
                {channel.lastError.slice(0, 80)}
              </p>
            )}
          </div>
        ) : channel.accessToken ? (
          <div className="flex items-center gap-1 mt-1.5 text-xs text-green-500">
            <CheckCircle className="h-3 w-3" />
            Đã kết nối
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 shrink-0">
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
          {channel.isActive
            ? <ToggleRight className="h-5 w-5 text-green-500" />
            : <ToggleLeft className="h-5 w-5" />}
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
  );
}

interface Props {
  initialChannels: SocialChannel[];
  initialOauthClients: YoutubeOauthClient[];
  initialQuotaStats: ChannelQuotaStat[];
  hasGoogleCreds: boolean;
  hasFacebookEnvConfig: boolean;
}

export function ChannelManagerClient({
  initialChannels,
  initialOauthClients,
  initialQuotaStats,
  hasGoogleCreds,
  hasFacebookEnvConfig,
}: Props) {
  const router = useRouter();
  const [channels, setChannels] = useState<SocialChannel[]>(initialChannels);
  const [fbStatus, setFbStatus] = useState<
    | { type: "success"; name: string; pageId: string; message: string }
    | { type: "error"; message: string; pageId: string | null; needsReconnect: boolean }
    | null
  >(null);
  const [fbUserToken, setFbUserToken] = useState("");
  const [tokenInfo, setTokenInfo] = useState<FacebookTokenInfo | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const params = useSearchParams();
  const connected = params.get("connected");
  const urlError = params.get("error");

  const youtubeChannels = channels.filter(c => c.platform === "youtube");
  const facebookChannels = channels.filter(c => c.platform === "facebook");

  const handleDelete = (id: number) => setChannels(prev => prev.filter(c => c.id !== id));
  const handleToggle = async (ch: SocialChannel) => {
    await toggleChannelAction(ch.id, !ch.isActive);
    setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, isActive: !ch.isActive } : c));
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
        setFbStatus({ type: "success", name: result.name, pageId: result.pageId, message: result.message });
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
      setFbStatus({ type: "error", message: "Dán user access token trước khi rotate", pageId: null, needsReconnect: false });
      return;
    }
    setFbStatus(null);
    startTransition(async () => {
      const result = await rotateFacebookPageTokenAction(fbUserToken);
      if (!result.ok) {
        setFbStatus({ type: "error", message: result.error, pageId: null, needsReconnect: false });
        return;
      }
      setFbStatus({
        type: "success",
        name: result.name,
        pageId: result.pageId,
        message: result.message,
      });
      setFbUserToken("");
      router.refresh();
    });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Quản lý kênh</h1>
        <p className="text-sm text-slate-400 mt-1">Kết nối tài khoản YouTube và Facebook để lên lịch đăng video.</p>
      </div>

      {connected === "youtube" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-green-300 text-sm">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Đã kết nối kênh YouTube thành công!
        </div>
      )}
      {urlError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-900/30 border border-red-800/40 text-red-300 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {decodeURIComponent(urlError)}
        </div>
      )}

      {/* ── YouTube ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-400" />
            <h2 className="text-base font-semibold text-slate-200">YouTube</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">
              {youtubeChannels.length} kênh
            </span>
          </div>
          {hasGoogleCreds ? (
            <a
              href="/api/auth/youtube"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
            >
              + Kết nối kênh
            </a>
          ) : (
            <span className="text-xs text-amber-400">Cần cấu hình GOOGLE_CLIENT_ID</span>
          )}
        </div>

        {!hasGoogleCreds && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-800/40 text-amber-300 text-xs">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">Cần thêm vào .env.local:</p>
              <code className="block font-mono text-amber-200/80 whitespace-pre">
                {`GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=...\nGOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/youtube/callback`}
              </code>
              <p className="mt-1 text-amber-400/70">
                Tạo credentials tại Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID.
              </p>
            </div>
          </div>
        )}

        {youtubeChannels.length === 0 ? (
          <p className="text-sm text-slate-600 py-4 text-center border border-dashed border-slate-700 rounded-xl">
            Chưa có kênh YouTube nào được kết nối
          </p>
        ) : (
          <div className="space-y-2">
            {youtubeChannels.map(ch => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                onDelete={() => handleDelete(ch.id)}
                onToggle={() => handleToggle(ch)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Facebook ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Facebook className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold text-slate-200">Facebook</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">
              {facebookChannels.length} trang
            </span>
          </div>
          {hasFacebookEnvConfig && (
            <button
              onClick={handleFbVerify}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
              {isPending ? "Đang kiểm tra…" : "Sync / Kiểm tra kết nối"}
            </button>
          )}
        </div>

        {!hasFacebookEnvConfig && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-800/40 text-amber-300 text-xs">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">Thêm vào .env.local để kết nối Facebook Page:</p>
              <code className="block font-mono text-amber-200/80 whitespace-pre">
                {`FACEBOOK_PAGE_ID=<numeric ID hoặc username>\nFACEBOOK_PAGE_ACCESS_TOKEN=<page access token>\nFACEBOOK_GRAPH_VERSION=v25.0`}
              </code>
              <p className="mt-1 text-amber-400/70">
                Lấy token tại Meta Developer → Graph API Explorer → chọn Page → Generate Token.
              </p>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-slate-200">Rotate Facebook token</p>
            <p className="text-xs text-slate-500 mt-1">
              Dán user access token mới. App sẽ tự đổi sang token dài hơn, lấy đúng Page access token và lưu vào DB để cron dùng ngay.
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
              onClick={handleFbRotate}
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

        {/* Token inspection panel */}
        {hasFacebookEnvConfig && (
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-200">Kiểm tra token hiện tại</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Xem hạn token Facebook Page đang dùng trong DB.
                </p>
              </div>
              <button
                onClick={handleInspectToken}
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
                      <span className="text-xs text-slate-500">Loại: <span className="text-slate-300">{tokenInfo.tokenType}</span></span>
                      {tokenInfo.appId && (
                        <span className="text-xs text-slate-500">App: <span className="text-slate-300 font-mono">{tokenInfo.appId}</span></span>
                      )}
                    </div>

                    {tokenInfo.expiresAt === null ? (
                      <div className="flex items-center gap-1.5 text-xs text-green-400">
                        <CheckCircle className="h-3 w-3" />
                        Page token — không hết hạn
                      </div>
                    ) : (
                      <div className={`flex items-center gap-1.5 text-xs ${
                        (tokenInfo.daysLeft ?? 0) < 7 ? "text-red-400" : (tokenInfo.daysLeft ?? 0) < 14 ? "text-amber-400" : "text-slate-300"
                      }`}>
                        <Info className="h-3 w-3 shrink-0" />
                        Hết hạn: {new Date(tokenInfo.expiresAt).toLocaleDateString("vi-VN")}
                        {tokenInfo.daysLeft !== null && (
                          <span className="ml-1">
                            ({tokenInfo.daysLeft > 0 ? `còn ${tokenInfo.daysLeft} ngày` : "đã hết hạn"})
                          </span>
                        )}
                        {(tokenInfo.daysLeft ?? 0) < 7 && (
                          <span className="ml-2 font-medium text-red-400">⚠ Cần rotate ngay!</span>
                        )}
                      </div>
                    )}

                    {tokenInfo.scopes.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {tokenInfo.scopes.map(s => (
                          <span key={s} className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">{s}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {fbStatus?.type === "success" && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-green-300 text-sm">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Đã kết nối: <span className="font-semibold">{fbStatus.name}</span>
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

        {facebookChannels.length === 0 && !fbStatus ? (
          <p className="text-sm text-slate-600 py-4 text-center border border-dashed border-slate-700 rounded-xl">
            {hasFacebookEnvConfig
              ? 'Nhấn "Sync / Kiểm tra kết nối" để load Facebook Page từ env'
              : "Chưa có Facebook Page nào được kết nối"}
          </p>
        ) : (
          <div className="space-y-2">
            {facebookChannels.map(ch => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                onDelete={() => handleDelete(ch.id)}
                onToggle={() => handleToggle(ch)}
              />
            ))}
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
