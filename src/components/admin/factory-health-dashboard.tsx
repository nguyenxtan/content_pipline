"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FlaskConical,
  HardDrive,
  RotateCw,
  Server,
  Upload,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  FactoryHealthPayload,
  FactoryHealthSummaryConfig,
} from "@/actions/factory-health";
import { saveFactoryHealthSummaryConfigAction } from "@/actions/factory-health";

// ── Formatting helpers ────────────────────────────────────────────────────────

const GB = 1_073_741_824;
const MB = 1_048_576;

function fmtBytes(bytes: number): string {
  if (bytes === Number.MAX_SAFE_INTEGER) return "N/A";
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`;
  return `${bytes} B`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtRelative(seconds: number): string {
  if (seconds < 60) return `${seconds}s trước`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m trước`;
  return `${Math.floor(seconds / 3600)}h trước`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

type Tone = "default" | "good" | "warn" | "danger";

function toneClasses(tone: Tone) {
  switch (tone) {
    case "good":
      return {
        card: "border-emerald-500/20 bg-emerald-500/5",
        icon: "border-emerald-500/20 bg-emerald-500/5 text-emerald-300",
        value: "text-emerald-300",
      };
    case "warn":
      return {
        card: "border-amber-500/20 bg-amber-500/5",
        icon: "border-amber-500/20 bg-amber-500/5 text-amber-300",
        value: "text-amber-300",
      };
    case "danger":
      return {
        card: "border-red-500/20 bg-red-500/5",
        icon: "border-red-500/20 bg-red-500/5 text-red-300",
        value: "text-red-300",
      };
    default:
      return {
        card: "border-slate-800 bg-slate-900/70",
        icon: "border-slate-700 bg-slate-800 text-slate-400",
        value: "text-slate-100",
      };
  }
}

function MetricCard({
  label,
  value,
  meta,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string;
  meta: string;
  tone?: Tone;
  icon: typeof Activity;
}) {
  const c = toneClasses(tone);
  return (
    <section className={`rounded-lg border p-4 ${c.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className={`mt-2 text-2xl font-semibold ${c.value}`}>{value}</p>
        </div>
        <div className={`rounded-md border p-2 ${c.icon}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{meta}</p>
    </section>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/70">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function FlagRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-800/60 py-2 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span
        className={`rounded-md bg-slate-950 px-2 py-0.5 font-mono text-xs ${good === false ? "text-amber-300" : good === true ? "text-emerald-300" : "text-slate-300"}`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Telegram config panel ─────────────────────────────────────────────────────

function TelegramConfigPanel({
  initial,
}: {
  initial: FactoryHealthSummaryConfig;
}) {
  const [config, setConfig] = useState<FactoryHealthSummaryConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await saveFactoryHealthSummaryConfigAction(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300">Tóm tắt Telegram hàng ngày</span>
        <button
          onClick={() => setConfig((p) => ({ ...p, enabled: !p.enabled }))}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            config.enabled ? "bg-rose-600" : "bg-slate-700"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              config.enabled ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {config.enabled && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">Giờ gửi (VN):</span>
          <input
            type="number"
            min={0}
            max={23}
            value={config.sendHour}
            onChange={(e) =>
              setConfig((p) => ({
                ...p,
                sendHour: Math.min(23, Math.max(0, Number(e.target.value))),
              }))
            }
            className="w-16 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-center text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500"
          />
          <span className="text-slate-500">:</span>
          <input
            type="number"
            min={0}
            max={59}
            value={config.sendMinute}
            onChange={(e) =>
              setConfig((p) => ({
                ...p,
                sendMinute: Math.min(59, Math.max(0, Number(e.target.value))),
              }))
            }
            className="w-16 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-center text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500"
          />
        </div>
      )}

      {config.lastSentMarker && (
        <p className="text-xs text-slate-500">
          Đã gửi lần cuối: <span className="text-slate-400">{config.lastSentMarker}</span>
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
      >
        {saving ? "Đang lưu..." : saved ? "Đã lưu ✓" : "Lưu cài đặt"}
      </button>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function FactoryHealthDashboard({ data }: { data: FactoryHealthPayload }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date(data.generatedAt));

  useEffect(() => {
    const id = setInterval(() => {
      startTransition(() => {
        router.refresh();
        setLastRefresh(new Date());
      });
    }, 60_000);
    return () => clearInterval(id);
  }, [router]);

  const { capacity: c, violations, flags, cronErrors } = data;
  const t = c.thresholds;

  // Tones
  const queueTone: Tone =
    c.pendingUploadCount > t.maxPendingUploadQueue
      ? "danger"
      : c.pendingUploadCount > t.maxPendingUploadQueue * 0.7
        ? "warn"
        : "good";

  const renderedTone: Tone =
    c.unpublishedRenderedCount > t.maxUnpublishedRendered
      ? "danger"
      : c.unpublishedRenderedCount > t.maxUnpublishedRendered * 0.7
        ? "warn"
        : "good";

  const mediaTone: Tone =
    c.mediaTotalBytes > t.maxMediaSizeGb * GB
      ? "danger"
      : c.mediaTotalBytes > t.maxMediaSizeGb * GB * 0.7
        ? "warn"
        : "good";

  const diskTone: Tone =
    c.freeDiskBytes < t.minFreeDiskGb * GB
      ? "danger"
      : c.freeDiskBytes < t.minFreeDiskGb * GB * 1.3
        ? "warn"
        : "good";

  const dailyTone: Tone =
    c.todayGeneratedCount >= t.maxDailyNewContent
      ? "danger"
      : c.todayGeneratedCount >= t.maxDailyNewContent * 0.8
        ? "warn"
        : "default";

  const cronStale = (data.cronStaleSec ?? 0) > 5 * 60;
  const autoRefillStatus = (() => {
    if (!data.autoRefill.config.enabled) {
      return {
        title: "Auto Refill: Disabled",
        subtitle: "Watcher đang tắt. Cron sẽ không tự lấp queue.",
        tone: "warn" as Tone,
        badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      };
    }
    if (data.autoRefill.currentPending > data.autoRefill.config.lowWaterMark) {
      return {
        title: "Auto Refill: Armed · Waiting for queue drain",
        subtitle: "Watcher đã sẵn sàng, nhưng sẽ chờ queue giảm xuống dưới low-water mark trước khi refill.",
        tone: "warn" as Tone,
        badgeClass: "border-sky-500/30 bg-sky-500/10 text-sky-300",
      };
    }
    return {
      title: "Auto Refill: Armed · Ready to refill",
      subtitle: "Watcher có thể refill an toàn ở lượt cron kế tiếp nếu vẫn còn gap hợp lệ.",
      tone: "good" as Tone,
      badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    };
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Admin</p>
          <h1 className="text-2xl font-semibold text-slate-100">Factory Health</h1>
          <p className="mt-1 text-sm text-slate-500">
            Dashboard chỉ đọc. Làm mới tự động mỗi 60 giây.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <RotateCw className="h-3 w-3" />
          <span>Làm mới: {fmtDateTime(lastRefresh.toISOString())}</span>
        </div>
      </header>

      {/* Status banner */}
      <div
        className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
          data.isHealthy
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-red-500/30 bg-red-500/10"
        }`}
      >
        {data.isHealthy ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
        ) : (
          <XCircle className="h-5 w-5 shrink-0 text-red-400" />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={`font-semibold ${
              data.isHealthy ? "text-emerald-300" : "text-red-300"
            }`}
          >
            {data.isHealthy ? "ALLOWED — Pipeline đang chạy bình thường" : "PAUSED — Pipeline đang tạm dừng"}
          </p>
          {violations.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {violations.map((v) => (
                <li key={v.reason} className="text-sm text-red-300/80">
                  • {v.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recommended action */}
      {data.recommendedAction && (
        <div className="flex items-start gap-2 rounded-md border border-slate-700 bg-slate-800/40 px-4 py-3">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <p className="text-sm text-slate-300">
            <span className="font-medium text-slate-100">Gợi ý: </span>
            {data.recommendedAction}
          </p>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          icon={Upload}
          label="Upload queue"
          value={`${c.pendingUploadCount} / ${t.maxPendingUploadQueue}`}
          meta={`${c.uploadingCount} đang upload · ${c.failedUploadCount} lỗi`}
          tone={queueTone}
        />
        <MetricCard
          icon={Server}
          label="Rendered trên disk"
          value={`${c.unpublishedRenderedCount} / ${t.maxUnpublishedRendered}`}
          meta={`${c.pendingContentCount} đang chờ render`}
          tone={renderedTone}
        />
        <MetricCard
          icon={Activity}
          label="Tạo hôm nay"
          value={`${c.todayGeneratedCount} / ${t.maxDailyNewContent}`}
          meta="Giới hạn đặt lại lúc nửa đêm UTC"
          tone={dailyTone}
        />
        <MetricCard
          icon={Database}
          label="Tổng media"
          value={fmtBytes(c.mediaTotalBytes)}
          meta={`Ngưỡng ${t.maxMediaSizeGb} GB · ~${fmtBytes(c.estimatedCleanupBytes)} có thể xóa`}
          tone={mediaTone}
        />
        <MetricCard
          icon={HardDrive}
          label="Disk trống"
          value={fmtBytes(c.freeDiskBytes)}
          meta={`Tối thiểu ${t.minFreeDiskGb} GB yêu cầu`}
          tone={diskTone}
        />
        {c.nextScheduledPublishAt && (
          <MetricCard
            icon={Clock}
            label="Upload kế tiếp"
            value={fmtDateTime(c.nextScheduledPublishAt.toISOString())}
            meta="Thời gian upload đã lên lịch gần nhất"
            tone="default"
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Feature flags */}
        <SectionCard title="Feature Flags">
          <div className="divide-y divide-slate-800/60">
            <FlagRow
              label="SHORT_COVER_INTRO_ENABLED"
              value={flags.shortCoverIntroEnabled ? "on" : "off"}
              good={undefined}
            />
            {flags.shortCoverIntroEnabled && (
              <>
                <FlagRow
                  label="SHORT_COVER_DURATION_SEC"
                  value={`${flags.shortCoverDurationSec}s`}
                />
                <FlagRow
                  label="SHORT_COVER_FADE_OUT_SEC"
                  value={`${flags.shortCoverFadeOutSec}s`}
                />
              </>
            )}
            <FlagRow
              label="CONTENT_EXPERIMENT_ID"
              value={flags.contentExperimentId}
            />
            <FlagRow
              label="CONTENT_EXPERIMENT_VARIANT"
              value={flags.contentExperimentVariant}
            />
            <FlagRow
              label="CONTENT_GEN_MODEL"
              value={flags.contentGenModel}
            />
            <FlagRow
              label="LONGFORM_MODEL"
              value={flags.longformModel}
            />
          </div>
        </SectionCard>

        {/* Cron health */}
        <SectionCard title="Cron Health">
          <div className="space-y-3">
            {data.lastCronRunAt ? (
              <div
                className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                  cronStale
                    ? "border-amber-500/20 bg-amber-500/5"
                    : "border-emerald-500/20 bg-emerald-500/5"
                }`}
              >
                {cronStale ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                )}
                <div className="text-sm">
                  <p className={cronStale ? "text-amber-300" : "text-emerald-300"}>
                    {data.cronStaleSec !== null ? fmtRelative(data.cronStaleSec) : "—"}
                    {cronStale && " — có thể bị treo"}
                  </p>
                  <p className="text-slate-500">
                    {fmtDateTime(data.lastCronRunAt)}
                    {data.lastCronDurationMs != null &&
                      ` · ${data.lastCronDurationMs}ms`}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Chưa có log cron nào.</p>
            )}

            {cronErrors.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-medium uppercase text-red-400">
                  {cronErrors.length} lỗi trong 3h qua
                </p>
                <ul className="space-y-1.5">
                  {cronErrors.slice(0, 5).map((e, i) => (
                    <li key={i} className="rounded-md bg-slate-950 px-3 py-2">
                      <p className="text-xs text-slate-500">{fmtDateTime(e.ranAt)}</p>
                      <p className="mt-0.5 text-sm text-red-300">{e.summary}</p>
                    </li>
                  ))}
                  {cronErrors.length > 5 && (
                    <li className="text-xs text-slate-500">
                      ... và {cronErrors.length - 5} lỗi khác
                    </li>
                  )}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Không có lỗi cron trong 3h qua
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Telegram summary config */}
      <SectionCard title="Tóm tắt Telegram hàng ngày">
        <div className="flex items-start gap-2 mb-4">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <p className="text-sm text-slate-500">
            Nếu bật, cron sẽ gửi Telegram tóm tắt trạng thái nhà máy một lần mỗi ngày vào giờ đã chọn (giờ Việt Nam).
            Yêu cầu TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID đã được cấu hình.
          </p>
        </div>
        <TelegramConfigPanel initial={data.telegramSummaryConfig} />
      </SectionCard>

      <SectionCard title="Auto Refill Watcher">
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${autoRefillStatus.badgeClass}`}
                >
                  {autoRefillStatus.title}
                </div>
                <p className="mt-3 text-sm text-slate-300">{autoRefillStatus.subtitle}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm lg:min-w-[320px]">
                <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2">
                  <p className="text-xs text-slate-500">Pending queue</p>
                  <p className="mt-1 font-medium text-slate-100">
                    {data.autoRefill.currentPending} / {data.autoRefill.config.maxPendingUploadQueue}
                  </p>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2">
                  <p className="text-xs text-slate-500">Low-water</p>
                  <p className="mt-1 font-medium text-slate-100">{data.autoRefill.config.lowWaterMark}</p>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2">
                  <p className="text-xs text-slate-500">Target pending</p>
                  <p className="mt-1 font-medium text-slate-100">{data.autoRefill.config.targetPending}</p>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2">
                  <p className="text-xs text-slate-500">Per-run caps</p>
                  <p className="mt-1 font-medium text-slate-100">
                    {data.autoRefill.config.maxGeneratePerRun} gen / {data.autoRefill.config.maxQueueInsertsPerRun} queue
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={Zap}
              label="Auto Refill"
              value={data.autoRefill.config.enabled ? "Armed" : "Disabled"}
              meta={`Low-water ${data.autoRefill.config.lowWaterMark} · Target ${data.autoRefill.config.targetPending}`}
              tone={autoRefillStatus.tone}
            />
            <MetricCard
              icon={Upload}
              label="Queue hiện tại"
              value={`${data.autoRefill.currentPending} / ${data.autoRefill.config.maxPendingUploadQueue}`}
              meta={`Headroom còn ${data.autoRefill.currentHeadroom} slot`}
              tone={data.autoRefill.currentPending >= data.autoRefill.config.lowWaterMark ? "warn" : "good"}
            />
            <MetricCard
              icon={Clock}
              label="Lần chạy gần nhất"
              value={data.autoRefill.lastRun ? fmtDateTime(data.autoRefill.lastRun.ranAt) : "Chưa có"}
              meta={
                data.autoRefill.lastRun
                  ? `${data.autoRefill.lastRun.skipped ? "Skipped" : "Ran"} · ${data.autoRefill.lastRun.pendingBefore} → ${data.autoRefill.lastRun.pendingAfter}`
                  : "Chưa có state được lưu"
              }
            />
            <MetricCard
              icon={Activity}
              label="Lần chạy gần nhất"
              value={
                data.autoRefill.lastRun
                  ? `${data.autoRefill.lastRun.generatedCount} gen / ${data.autoRefill.lastRun.insertedCount} queue`
                  : "0 / 0"
              }
              meta={data.autoRefill.lastRun?.reason ?? "Không có lỗi watcher gần nhất"}
              tone={data.autoRefill.lastRun?.skipped ? "default" : "good"}
            />
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-950/60 px-4 py-3">
            <p className="text-sm text-slate-300">
              <span className="font-medium text-slate-100">Khuyến nghị: </span>
              {data.autoRefill.nextRefillRecommendation}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {data.autoRefill.destinations.map((destination) => (
              <section
                key={destination.destinationId}
                className="rounded-lg border border-slate-800 bg-slate-950/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">{destination.label}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {destination.postingWindow} · mỗi {destination.intervalMinutes} phút
                    </p>
                  </div>
                  <span className="rounded-md bg-slate-900 px-2 py-1 text-xs text-slate-300">
                    {destination.platform}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-slate-500">Queued</p>
                    <p className="font-medium text-slate-100">{destination.queuedCount}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Ready pool</p>
                    <p className="font-medium text-slate-100">{destination.readyCandidates}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Gap slots</p>
                    <p className="font-medium text-slate-100">{destination.gapCount}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Next slot</p>
                    <p className="font-medium text-slate-100">{destination.nextScheduledAtVn ?? "—"}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-1 text-xs text-slate-400">
                  <p>Done 24h: {destination.doneLast24h}</p>
                  <p>Error: {destination.errorCount}</p>
                  <p>First gap: {destination.firstGapVn ?? "Không có"}</p>
                  <p>Formats: {destination.usedFormats.length > 0 ? destination.usedFormats.join(", ") : "—"}</p>
                </div>

                {destination.warnings.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {destination.warnings.map((warning) => (
                      <span
                        key={warning}
                        className="rounded-md border border-amber-700/40 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-300"
                      >
                        {warning}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Media breakdown */}
      <SectionCard title="Chi tiết media">
        <div className="space-y-2 text-sm">
          {[
            { label: "media/videos", bytes: c.mediaVideoBytes },
            { label: "media/audio", bytes: c.mediaAudioBytes },
            { label: "media/images", bytes: c.mediaImagesBytes },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="rounded bg-slate-950 px-2 py-0.5 font-mono text-xs text-slate-400">
                {row.label}
              </span>
              <span className="text-slate-300">{fmtBytes(row.bytes)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-slate-800 pt-2">
            <span className="text-xs text-slate-500">Tổng cộng (bao gồm cache/music)</span>
            <span className="font-semibold text-slate-200">{fmtBytes(c.mediaTotalBytes)}</span>
          </div>
        </div>
      </SectionCard>

      <p className="text-center text-xs text-slate-600">
        Dữ liệu được tạo lúc {fmtDateTime(data.generatedAt)}. Trang này chỉ đọc.
      </p>
    </div>
  );
}
