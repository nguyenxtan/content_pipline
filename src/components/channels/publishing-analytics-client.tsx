"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Clock3,
  Database,
  ExternalLink,
  Eye,
  MessageSquare,
  RefreshCw,
  Send,
  ThumbsUp,
} from "lucide-react";
import {
  buildPublishingAnalyticsReportAction,
  getAnalyticsReportConfigAction,
  getPublishingAnalyticsAction,
  saveAnalyticsReportConfigAction,
  syncFacebookAnalyticsAction,
  syncYouTubeAnalyticsAction,
  type AnalyticsReportConfig,
  type AnalyticsReportPeriod,
  type PublishingAnalyticsPayload,
} from "@/actions/publishing-analytics";

type PlatformKey = PublishingAnalyticsPayload["selectedPlatform"];

const PLATFORM_OPTIONS: Array<{ key: PlatformKey; label: string }> = [
  { key: "youtube", label: "YouTube" },
  { key: "facebook", label: "Facebook" },
  { key: "tiktok", label: "TikTok" },
];

const REPORT_PERIOD_OPTIONS: Array<{ key: AnalyticsReportPeriod; label: string }> = [
  { key: "7d", label: "7 ngày" },
  { key: "14d", label: "14 ngày" },
  { key: "30d", label: "30 ngày" },
  { key: "monthly", label: "Tháng trước" },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function formatDateTime(value: Date | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatAgo(value: Date | null): string {
  if (!value) return "chưa sync";
  const diffMin = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (diffMin < 60) return `${diffMin}p trước`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 48) return `${diffHour}h trước`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay} ngày trước`;
}

function SummaryCard({
  label,
  value,
  meta,
  icon: Icon,
}: {
  label: string;
  value: string;
  meta: string;
  icon: typeof Eye;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
          <p className="text-2xl font-semibold text-slate-100">{value}</p>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-950/80 p-2 text-slate-400">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{meta}</p>
    </div>
  );
}

export function PublishingAnalyticsClient({
  initialData,
}: {
  initialData: PublishingAnalyticsPayload;
}) {
  const [data, setData] = useState(initialData);
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey>(
    initialData.selectedPlatform
  );
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    initialData.selectedPlatformAccountId
  );
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [reportConfig, setReportConfig] = useState<AnalyticsReportConfig | null>(null);
  const [reportPreview, setReportPreview] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportSaved, setReportSaved] = useState(false);

  const selectedPlatformSummary = useMemo(
    () => data.platforms.find((platform) => platform.platform === selectedPlatform),
    [data.platforms, selectedPlatform]
  );

  const reload = useCallback(
    async (platform: PlatformKey, platformAccountId: number | null) => {
      setLoading(true);
      try {
        const next = await getPublishingAnalyticsAction({
          platform,
          platformAccountId,
          limit: 120,
        });
        setData(next);
        setSelectedPlatform(platform);
        setSelectedAccountId(platformAccountId);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    getAnalyticsReportConfigAction().then((config) => {
      if (!cancelled) setReportConfig(config);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePlatformChange = async (platform: PlatformKey) => {
    setSyncMessage(null);
    await reload(platform, null);
  };

  const handleChannelChange = async (value: string) => {
    const nextId = value ? Number(value) : null;
    setSyncMessage(null);
    await reload(selectedPlatform, nextId);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = selectedPlatform === "youtube"
        ? await syncYouTubeAnalyticsAction({
            platformAccountId: selectedAccountId,
            limitVideos: selectedAccountId ? 40 : 20,
          })
        : selectedPlatform === "facebook"
          ? await syncFacebookAnalyticsAction({
              platformAccountId: selectedAccountId,
              limitVideos: selectedAccountId ? 40 : 20,
            })
          : null;

      if (!result) {
        setSyncMessage("Nền tảng này chưa có bộ sync.");
        return;
      }

      await reload(selectedPlatform, selectedAccountId);
      setSyncMessage(
        `Đã sync ${result.videosUpdated}/${result.videosRequested} video, lỗi ${result.errors.length}.`
      );
    } finally {
      setSyncing(false);
    }
  };

  const runReport = async (sendToTelegram: boolean) => {
    setReportBusy(true);
    try {
      const result = await buildPublishingAnalyticsReportAction({
        platform: selectedPlatform,
        platformAccountId: selectedAccountId,
        period: reportConfig?.period ?? "7d",
        sendToTelegram,
      });
      setReportPreview(result.text.replace(/<[^>]+>/g, ""));
      setSyncMessage(sendToTelegram ? "Đã gửi báo cáo Telegram." : "Đã tạo bản phân tích hiện tại.");
    } finally {
      setReportBusy(false);
    }
  };

  const saveReportConfig = async () => {
    if (!reportConfig) return;
    setReportBusy(true);
    try {
      await saveAnalyticsReportConfigAction({
        ...reportConfig,
        platform: selectedPlatform,
        platformAccountId: selectedAccountId,
      });
      setReportSaved(true);
      setTimeout(() => setReportSaved(false), 2000);
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-100">Phân tích nền tảng</h1>
          <p className="max-w-3xl text-sm text-slate-400">
            Dữ liệu được gom theo kênh thật trên từng nền tảng. OAuth client chỉ là credential phụ,
            không được dùng làm đơn vị phân tích.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => reload(selectedPlatform, selectedAccountId)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Reload
          </button>
          <button
            onClick={handleSync}
            disabled={syncing || selectedPlatform === "tiktok"}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-700/60 bg-rose-600/10 px-3 py-2 text-sm text-rose-300 transition-colors hover:border-rose-500 hover:text-rose-200 disabled:opacity-50"
          >
            <Database className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {selectedPlatform === "facebook" ? "Sync Facebook" : "Sync"}
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {PLATFORM_OPTIONS.map((option) => {
          const summary = data.platforms.find((platform) => platform.platform === option.key);
          const active = selectedPlatform === option.key;
          return (
            <button
              key={option.key}
              onClick={() => handlePlatformChange(option.key)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-rose-700/60 bg-rose-600/10 text-rose-300"
                  : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              <div className="text-sm font-medium">{option.label}</div>
              <div className="mt-1 text-xs text-inherit/80">
                {summary?.totalChannels ?? 0} kênh · {summary?.totalVideos ?? 0} video
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="Video"
          value={formatNumber(data.totals.totalVideos)}
          meta={`${data.totals.staleVideos} video đang stale`}
          icon={BarChart3}
        />
        <SummaryCard
          label="Lượt xem"
          value={formatNumber(data.totals.totalViews)}
          meta={`Kênh: ${selectedPlatformSummary?.totalChannels ?? 0}`}
          icon={Eye}
        />
        <SummaryCard
          label="Lượt thích"
          value={formatNumber(data.totals.totalLikes)}
          meta={`Credential: ${selectedPlatformSummary?.connectedCredentials ?? 0}`}
          icon={ThumbsUp}
        />
        <SummaryCard
          label="Bình luận"
          value={formatNumber(data.totals.totalComments)}
          meta={selectedAccountId ? "Đang lọc theo 1 kênh" : "Toàn nền tảng"}
          icon={MessageSquare}
        />
        <SummaryCard
          label="Lần sync cuối"
          value={formatAgo(data.totals.lastSyncedAt)}
          meta={formatDateTime(data.totals.lastSyncedAt)}
          icon={Clock3}
        />
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="text-sm text-slate-400">
          {selectedPlatform === "youtube"
            ? "YouTube đang dùng Data API để lấy metadata + thống kê video. Chạy theo lô nhỏ để giữ quota."
            : selectedPlatform === "facebook"
              ? "Facebook hiện sync được metadata Reel + views cơ bản. Insight sâu như watch time chưa có vì token hiện tại thiếu read_insights."
              : "Nền tảng này đã sẵn slot trong mô hình dữ liệu, nhưng chưa có bộ sync API."}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500">Kênh</label>
          <select
            value={selectedAccountId ?? ""}
            onChange={(event) => handleChannelChange(event.target.value)}
            className="min-w-[260px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-rose-600"
          >
            <option value="">Tất cả kênh</option>
            {data.channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.displayName} ({channel.connectedCredentials} credential)
              </option>
            ))}
          </select>
        </div>
      </div>

      {syncMessage ? (
        <div className="mt-4 rounded-lg border border-emerald-700/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-300">
          {syncMessage}
        </div>
      ) : null}

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-100">Báo cáo phân tích</p>
            <p className="text-xs text-slate-500">
              Chạy tay ngay hoặc để cron tự gửi Telegram theo kỳ đã chọn.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => runReport(false)}
              disabled={reportBusy}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
            >
              <BarChart3 className="h-4 w-4" />
              Phân tích ngay
            </button>
            <button
              onClick={() => runReport(true)}
              disabled={reportBusy}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-700/60 bg-rose-600/10 px-3 py-2 text-sm text-rose-300 hover:border-rose-500 hover:text-rose-200 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Gửi Telegram
            </button>
          </div>
        </div>

        {reportConfig ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Kỳ phân tích</label>
              <select
                value={reportConfig.period}
                onChange={(event) =>
                  setReportConfig((prev) =>
                    prev ? { ...prev, period: event.target.value as AnalyticsReportPeriod } : prev
                  )
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              >
                {REPORT_PERIOD_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Tự động gửi</label>
              <button
                onClick={() =>
                  setReportConfig((prev) => (prev ? { ...prev, enabled: !prev.enabled } : prev))
                }
                className={`w-full rounded-lg border px-3 py-2 text-sm transition-colors ${
                  reportConfig.enabled
                    ? "border-green-700 bg-green-900/30 text-green-300"
                    : "border-slate-700 bg-slate-950 text-slate-400"
                }`}
              >
                {reportConfig.enabled ? "Đang bật" : "Đang tắt"}
              </button>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Giờ gửi</label>
              <input
                type="number"
                min={0}
                max={23}
                value={reportConfig.sendHour}
                onChange={(event) =>
                  setReportConfig((prev) =>
                    prev ? { ...prev, sendHour: Number(event.target.value) } : prev
                  )
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Phút gửi</label>
              <input
                type="number"
                min={0}
                max={59}
                value={reportConfig.sendMinute}
                onChange={(event) =>
                  setReportConfig((prev) =>
                    prev ? { ...prev, sendMinute: Number(event.target.value) } : prev
                  )
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={saveReportConfig}
                disabled={reportBusy}
                className="w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
              >
                {reportSaved ? "Đã lưu" : "Lưu lịch báo cáo"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/80 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Preview</p>
          <pre className="whitespace-pre-wrap text-xs leading-6 text-slate-300">
            {reportPreview || "Chưa có bản phân tích nào được tạo trong phiên này."}
          </pre>
        </div>
      </div>

      {selectedPlatform !== "youtube" ? (
        <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/50 px-6 py-12 text-center">
          <p className="text-lg font-medium text-slate-200">{selectedPlatformSummary?.label}</p>
          <p className="mt-2 text-sm text-slate-500">
            Schema và grouping theo kênh thật đã sẵn. Chỗ còn thiếu là lớp fetch metric từ API của nền tảng này.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-3 xl:grid-cols-3">
            {data.channels.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-sm text-slate-500 xl:col-span-3">
                Chưa có kênh nào được map vào analytics.
              </div>
            ) : (
              data.channels.map((channel) => (
                <div
                  key={channel.id}
                  className={`rounded-lg border p-4 ${
                    selectedAccountId === channel.id
                      ? "border-rose-700/60 bg-rose-600/5"
                      : "border-slate-800 bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">{channel.displayName}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {channel.handle || "không có handle"} · {channel.connectedCredentials} credential
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div>{formatNumber(channel.totalVideos)} video</div>
                      <div>{formatNumber(channel.totalViews)} views</div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <div>
                      <span className="text-slate-500">Likes</span>
                      <div className="mt-1 text-slate-200">{formatNumber(channel.totalLikes)}</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Comments</span>
                      <div className="mt-1 text-slate-200">{formatNumber(channel.totalComments)}</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Sync</span>
                      <div className="mt-1 text-slate-200">{formatAgo(channel.lastSyncedAt)}</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Đăng gần nhất</span>
                      <div className="mt-1 text-slate-200">{formatDateTime(channel.latestPublishedAt)}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-8 overflow-hidden rounded-xl border border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/70 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-100">Video đã đăng</p>
                <p className="text-xs text-slate-500">
                  Mỗi dòng gắn với một video thật trên nền tảng và một kênh thật.
                </p>
              </div>
              <div className="text-xs text-slate-500">{data.videos.length} dòng hiển thị</div>
            </div>

            {data.videos.length === 0 ? (
              <div className="px-4 py-10 text-sm text-slate-500">Chưa có video nào cho bộ lọc hiện tại.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead className="bg-slate-950/60">
                    <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3">Video</th>
                      <th className="px-4 py-3">Kênh</th>
                      <th className="px-4 py-3">Loại</th>
                      <th className="px-4 py-3">Đăng lúc</th>
                      <th className="px-4 py-3">Thời lượng</th>
                      <th className="px-4 py-3">Views</th>
                      <th className="px-4 py-3">Likes</th>
                      <th className="px-4 py-3">Comments</th>
                      <th className="px-4 py-3">Sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.videos.map((video) => (
                      <tr key={video.id} className="border-b border-slate-900/80 align-top">
                        <td className="px-4 py-3">
                          <div className="max-w-[360px] space-y-1">
                            <div className="flex items-start gap-2">
                              <p className="line-clamp-2 text-sm font-medium text-slate-100">{video.title}</p>
                              {video.platformVideoUrl ? (
                                <a
                                  href={video.platformVideoUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-0.5 text-slate-500 transition-colors hover:text-rose-400"
                                  title="Mở video"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                            </div>
                            <p className="text-xs text-slate-500">
                              {video.topic || "không có topic"} · {video.nicheName || "không có lĩnh vực"}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-200">{video.channelName}</div>
                          <div className="mt-1 text-xs text-slate-500">{video.channelHandle || "không có handle"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300">
                            {video.videoType}
                          </span>
                          <div className="mt-2 text-xs text-slate-500">{video.privacyStatus || "—"}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-300">{formatDateTime(video.publishedAt)}</td>
                        <td className="px-4 py-3 text-sm text-slate-300">{formatDuration(video.durationSeconds)}</td>
                        <td className="px-4 py-3 text-sm text-slate-100">{formatNumber(video.viewCount)}</td>
                        <td className="px-4 py-3 text-sm text-slate-100">{formatNumber(video.likeCount)}</td>
                        <td className="px-4 py-3 text-sm text-slate-100">{formatNumber(video.commentCount)}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-slate-200">{formatAgo(video.lastFetchedAt)}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatDateTime(video.lastFetchedAt)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
