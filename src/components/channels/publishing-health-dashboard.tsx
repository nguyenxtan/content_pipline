import {
  Activity,
  AlertTriangle,
  BarChart3,
  Captions,
  CheckCircle2,
  Database,
  FlaskConical,
  HardDrive,
  Layers3,
  UploadCloud,
} from "lucide-react";
import type {
  HealthDistributionRow,
  PlatformBreakdownRow,
  PublishingHealthPayload,
} from "@/actions/publishing-health";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value)} ${units[index]}`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function HealthCard({
  label,
  value,
  meta,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string;
  meta: string;
  tone?: "default" | "good" | "warn" | "danger";
  icon: typeof Activity;
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
      : tone === "warn"
        ? "border-amber-500/20 bg-amber-500/5 text-amber-300"
        : tone === "danger"
          ? "border-red-500/20 bg-red-500/5 text-red-300"
          : "border-slate-800 bg-slate-900/70 text-slate-300";

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p>
        </div>
        <div className={`rounded-md border p-2 ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{meta}</p>
    </section>
  );
}

function PlatformBreakdown({ rows }: { rows: PlatformBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Không có dữ liệu.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={`${row.platform}-${row.videoType}`} className="flex items-center justify-between gap-3 text-sm">
          <span className="rounded-md bg-slate-950 px-2 py-1 text-slate-300">
            {row.platform} / {row.videoType}
          </span>
          <span className="font-medium text-slate-100">{formatNumber(row.count)}</span>
        </div>
      ))}
    </div>
  );
}

function DistributionTable({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: HealthDistributionRow[];
  emptyLabel: string;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/70">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-sm">
            <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Phiên bản</th>
                <th className="px-4 py-3 text-right font-medium">Số lượng</th>
                <th className="px-4 py-3 text-right font-medium">Tỷ lệ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-slate-800">
                  <td className="max-w-[320px] px-4 py-3 text-slate-200">
                    <span className="break-words rounded-md bg-slate-950 px-2 py-1">{row.key}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-100">{formatNumber(row.count)}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{formatPercent(row.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PublishingHealthDashboard({ data }: { data: PublishingHealthPayload }) {
  const analyticsTone = data.analytics.coveragePct >= 80 ? "good" : data.analytics.coveragePct >= 50 ? "warn" : "danger";
  const retentionTone =
    data.analytics.retentionCoveragePct >= 80 ? "good" : data.analytics.retentionCoveragePct >= 50 ? "warn" : "danger";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-slate-500">Publishing</p>
          <h1 className="text-2xl font-semibold text-slate-100">Factory Health</h1>
          <p className="mt-1 text-sm text-slate-500">
            Dashboard chỉ đọc, dùng để nhìn nhanh sức khoẻ hàng đợi, upload, analytics và cleanup.
          </p>
        </div>
        <div className="text-sm text-slate-500">
          <p>Cập nhật: {formatDateTime(data.generatedAt)}</p>
          <p>Ngày VN từ: {formatDateTime(data.vietnamDayStart)}</p>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HealthCard
          icon={UploadCloud}
          label="Queued videos"
          value={formatNumber(data.queue.queuedVideos)}
          meta={`${formatNumber(data.queue.uploadingVideos)} video đang uploading.`}
          tone={data.queue.queuedVideos > 0 ? "warn" : "good"}
        />
        <HealthCard
          icon={CheckCircle2}
          label="Uploaded today"
          value={formatNumber(data.today.uploaded)}
          meta="Tính theo ngày Việt Nam."
          tone={data.today.uploaded > 0 ? "good" : "default"}
        />
        <HealthCard
          icon={AlertTriangle}
          label="Failed today"
          value={formatNumber(data.today.failed)}
          meta="Dựa trên upload_queue.status = error trong ngày."
          tone={data.today.failed > 0 ? "danger" : "good"}
        />
        <HealthCard
          icon={Captions}
          label="Subtitle health avg"
          value={data.subtitleHealth.averageScore === null ? "—" : `${formatNumber(data.subtitleHealth.averageScore)}/100`}
          meta={data.subtitleHealth.note}
          tone={data.subtitleHealth.status === "available" ? "good" : "warn"}
        />
        <HealthCard
          icon={HardDrive}
          label="Cleanup eligible"
          value={formatNumber(data.cleanup.eligibleCount)}
          meta={`Ước tính ${formatBytes(data.cleanup.eligibleSizeBytes)} trong ${formatNumber(data.cleanup.scanned)} item được scan.`}
          tone={data.cleanup.eligibleCount > 0 ? "warn" : "good"}
        />
        <HealthCard
          icon={Database}
          label="Analytics coverage"
          value={formatPercent(data.analytics.coveragePct)}
          meta={`${formatNumber(data.analytics.videosWithAnalytics)} / ${formatNumber(data.analytics.totalPublishedVideos)} published videos có snapshot hoặc latestFetchedAt.`}
          tone={analyticsTone}
        />
        <HealthCard
          icon={BarChart3}
          label="Retention coverage"
          value={formatPercent(data.analytics.retentionCoveragePct)}
          meta={`${formatNumber(data.analytics.videosWithRetention)} / ${formatNumber(data.analytics.youtubePublishedVideos)} video YouTube có retention_pct.`}
          tone={retentionTone}
        />
        <HealthCard
          icon={Layers3}
          label="Content tracked"
          value={formatNumber(data.promptVersions.totalContentItems)}
          meta={`${formatNumber(data.promptVersions.distribution.length)} nhóm prompt version, ${formatNumber(data.experiments.distribution.length)} nhóm experiment.`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-100">Queue breakdown</h2>
          </div>
          <PlatformBreakdown rows={data.queue.byPlatform} />
        </section>
        <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-100">Uploaded today</h2>
          </div>
          <PlatformBreakdown rows={data.today.uploadedByPlatform} />
        </section>
        <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-100">Failed today</h2>
          </div>
          <PlatformBreakdown rows={data.today.failedByPlatform} />
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DistributionTable
          title="Prompt versions distribution"
          rows={data.promptVersions.distribution}
          emptyLabel="Chưa có prompt version nào được lưu."
        />
        <DistributionTable
          title="Experiment variants distribution"
          rows={data.experiments.distribution}
          emptyLabel="Chưa có experiment variant nào được lưu."
        />
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-100">Read-only guarantees</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Trang này chỉ đọc DB và chạy cleanup ở dry-run để ước tính dung lượng. Không đổi generation, upload,
          analytics sync, lịch cron, hoặc trạng thái queue.
        </p>
      </section>
    </div>
  );
}
