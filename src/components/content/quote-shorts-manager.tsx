"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  Film,
  Loader2,
  PlayCircle,
  RefreshCw,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { FORMAT_TYPE_LABELS } from "@/lib/content-format-type";
import {
  executeLegacyQuoteScheduleAction,
  previewLegacyQuoteScheduleAction,
  type LegacyQuoteSampleRow,
  type LegacyQuoteSchedulePreview,
} from "@/actions/quote-shorts";

type QuoteShortsManagerProps = {
  samples: LegacyQuoteSampleRow[];
};

type PlatformOption = "youtube" | "facebook";

const PLATFORM_OPTIONS: Array<{ value: PlatformOption; label: string }> = [
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
];

function getNextSafeStartValue() {
  const now = new Date();
  const next = new Date(now.getTime() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(next).replace(" ", "T");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getItemStatus(sample: LegacyQuoteSampleRow): "missing_file" | "published" | "queued" | "ready" {
  if (!sample.outputVideoExists) return "missing_file";
  if (sample.queueStatus.done > 0 || sample.donePlatforms.length > 0) return "published";
  if (sample.queueStatus.queued > 0 || sample.queueStatus.uploading > 0) return "queued";
  return "ready";
}

type ItemStatus = ReturnType<typeof getItemStatus>;

function statusLabel(status: ItemStatus) {
  switch (status) {
    case "published": return "Đã đăng";
    case "queued": return "Đang chờ lịch";
    case "missing_file": return "Thiếu file";
    default: return "Sẵn sàng";
  }
}

function statusClass(status: ItemStatus) {
  switch (status) {
    case "published": return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "queued": return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "missing_file": return "border-red-500/30 bg-red-500/10 text-red-300";
    default: return "border-blue-500/30 bg-blue-500/10 text-blue-200";
  }
}

function truncatePath(p: string) {
  if (!p) return "—";
  const parts = p.split(/[/\\]/);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : p;
}

function TechnicalDetails({ sample }: { sample: LegacyQuoteSampleRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Chi tiết kỹ thuật
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs space-y-1.5 text-slate-400">
          <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">contentId</span><span className="font-mono break-all">{sample.contentId}</span></div>
          <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">visualMode</span><span>{sample.visualMode}</span></div>
          {sample.quoteStyle && (
            <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">quoteStyle</span><span>{sample.quoteStyle}</span></div>
          )}
          {sample.visualTemperature && (
            <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">visualTemp</span><span>{sample.visualTemperature}</span></div>
          )}
          {sample.colorPalette && (
            <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">colorPalette</span><span className="break-words">{sample.colorPalette}</span></div>
          )}
          {sample.visualSearchKeywords && sample.visualSearchKeywords.length > 0 && (
            <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">visualKws</span><span className="break-words">{sample.visualSearchKeywords.slice(0, 4).join(", ")}</span></div>
          )}
          <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">motionStrength</span><span>{sample.motionStrength}</span></div>
          <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">outputVideo</span><span className="break-all">{truncatePath(sample.outputVideoPath)}</span></div>
          <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">musicPath</span><span className="break-all">{truncatePath(sample.musicPath)}</span></div>
          {sample.contactSheet && (
            <div className="flex gap-2 items-center">
              <span className="w-28 shrink-0 text-slate-500">contactSheet</span>
              <a
                href={`/api/quote-shorts/${sample.contentId}/asset?kind=contact`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-slate-300 hover:text-white transition"
              >
                <Film className="h-3 w-3" />
                Xem contact sheet
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">duration</span><span>{sample.duration}s</span></div>
          <div className="flex gap-2"><span className="w-28 shrink-0 text-slate-500">audioStatus</span><span>{sample.audioStatus}</span></div>
        </div>
      )}
    </div>
  );
}

export function QuoteShortsManager({ samples }: QuoteShortsManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [startAt, setStartAt] = useState(getNextSafeStartValue);
  const [intervalHours, setIntervalHours] = useState(1);
  const [maxItems, setMaxItems] = useState(1);
  const [platforms, setPlatforms] = useState<PlatformOption[]>(["youtube", "facebook"]);
  const [preview, setPreview] = useState<LegacyQuoteSchedulePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualIds, setManualIds] = useState<string[]>([]);

  const enrichedItems = useMemo(() => {
    return samples.map((sample) => ({
      ...sample,
      itemStatus: getItemStatus(sample),
    }));
  }, [samples]);

  const eligibleItems = useMemo(
    () => enrichedItems.filter((item) => item.itemStatus === "ready"),
    [enrichedItems],
  );

  const queuedCount = useMemo(
    () => enrichedItems.filter((item) => item.itemStatus === "queued").length,
    [enrichedItems],
  );

  const publishedCount = useMemo(
    () => enrichedItems.filter((item) => item.itemStatus === "published").length,
    [enrichedItems],
  );

  const effectiveMaxItems = Math.max(1, Math.min(maxItems, eligibleItems.length || 1));

  const togglePlatform = (platform: PlatformOption) => {
    setPlatforms((current) => {
      if (current.includes(platform)) {
        if (current.length === 1) return current;
        return current.filter((value) => value !== platform);
      }
      return [...current, platform];
    });
  };

  const toggleManualId = (contentId: string) => {
    setManualIds((current) => (
      current.includes(contentId)
        ? current.filter((id) => id !== contentId)
        : [...current, contentId]
    ));
  };

  const runPreview = () => {
    setMessage(null);
    setPreview(null);
    startTransition(async () => {
      const result = await previewLegacyQuoteScheduleAction({
        startAtIso: new Date(startAt).toISOString(),
        intervalMin: intervalHours * 60,
        maxItems: effectiveMaxItems,
        platforms,
        selectedContentIds: showAdvanced && manualIds.length > 0 ? manualIds : undefined,
      });
      setPreview(result);
      if (!result.ok && result.message) {
        setMessage(result.message);
      }
    });
  };

  const runExecute = () => {
    if (!preview?.ok) return;
    setMessage(null);
    startTransition(async () => {
      const result = await executeLegacyQuoteScheduleAction({
        startAtIso: new Date(startAt).toISOString(),
        intervalMin: intervalHours * 60,
        maxItems: effectiveMaxItems,
        platforms,
        selectedContentIds: showAdvanced && manualIds.length > 0 ? manualIds : undefined,
      });
      setPreview(result);
      setMessage(
        result.ok
          ? `Đã tạo ${result.createdQueueIds.length} queue rows ở trạng thái queued. Cron sẽ xử lý khi tới giờ.`
          : (result.message ?? "Không thể tạo queue rows."),
      );
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-200">
              <Sparkles className="h-3.5 w-3.5" />
              Nội dung sản xuất
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-50">Quote Shorts</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
                Lên lịch và quản lý Quote Shorts theo batch. Chỉ tạo{" "}
                <span className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">queued rows</span>
                — cron là đường duy nhất đăng thật.
              </p>
            </div>
          </div>
          <div className="grid min-w-[280px] grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm">
            <div>
              <p className="text-slate-500">Tổng cộng</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{samples.length}</p>
            </div>
            <div>
              <p className="text-slate-500">Sẵn sàng</p>
              <p className="mt-1 text-lg font-semibold text-blue-300">{eligibleItems.length}</p>
            </div>
            <div>
              <p className="text-slate-500">Đang chờ lịch</p>
              <p className="mt-1 text-lg font-semibold text-amber-300">{queuedCount}</p>
            </div>
            <div>
              <p className="text-slate-500">Đã đăng</p>
              <p className="mt-1 text-lg font-semibold text-emerald-300">{publishedCount}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <div className="space-y-6">
          {/* Scheduling panel */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Tạo lịch Quote batch</h2>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Hệ thống tự lấy các Quote Shorts sẵn sàng, chưa queued và chưa đăng.
                </p>
              </div>
              <div className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300">
                Mặc định: 1 giờ / bài
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Bắt đầu lúc</span>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(event) => setStartAt(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-rose-500"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Khoảng cách (giờ)</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  step={1}
                  value={intervalHours}
                  onChange={(event) => setIntervalHours(Math.max(1, Number.parseInt(event.target.value || "1", 10)))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-rose-500"
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Số lượng tối đa</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, eligibleItems.length)}
                  step={1}
                  value={effectiveMaxItems}
                  onChange={(event) => setMaxItems(Math.max(1, Number.parseInt(event.target.value || "1", 10)))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-rose-500"
                />
              </label>

              <div className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Nền tảng</span>
                <div className="flex h-[46px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-2">
                  {PLATFORM_OPTIONS.map((option) => {
                    const selected = platforms.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => togglePlatform(option.value)}
                        className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm transition ${
                          selected
                            ? "bg-rose-500 text-white"
                            : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runPreview}
                disabled={isPending || platforms.length === 0 || eligibleItems.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Tạo lịch Quote batch
              </button>
              <button
                type="button"
                onClick={() => setShowAdvanced((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500"
              >
                <RefreshCw className="h-4 w-4" />
                Chọn thủ công
              </button>
              <div className="text-sm text-slate-400">
                Mặc định sẽ lấy tối đa{" "}
                <span className="font-medium text-slate-100">{effectiveMaxItems}</span> mục sẵn sàng.
              </div>
            </div>

            {showAdvanced && (
              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <p className="text-sm font-medium text-slate-100">Chọn thủ công (override batch tự động)</p>
                <p className="mt-1 text-sm text-slate-400">
                  Nếu không chọn, hệ thống dùng flow tự động. Chỉ chọn các mục chưa queued / chưa đăng.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {eligibleItems.map((item) => (
                    <label
                      key={item.contentId}
                      className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-3"
                    >
                      <input
                        type="checkbox"
                        checked={manualIds.includes(item.contentId)}
                        onChange={() => toggleManualId(item.contentId)}
                        className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-950 text-rose-500"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-100">{item.topic}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-400">{item.quoteText}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Content list */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Danh sách Quote Shorts</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Trạng thái và nội dung từng mục. Lên lịch qua batch ở trên — không chọn từng mục trực tiếp.
                </p>
              </div>
              <div className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300">
                {eligibleItems.length} sẵn sàng
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {enrichedItems.map((item) => (
                <article
                  key={item.contentId}
                  className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                >
                  {/* Row 1: status + topic + meta */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(item.itemStatus)}`}>
                        {statusLabel(item.itemStatus)}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300">
                        {FORMAT_TYPE_LABELS["legacy_quote_short"]}
                      </span>
                      {/* Format variant badge — human-readable label per visualMode */}
                      {item.visualMode === "kinetic_typography" && (
                        <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-xs text-purple-200">
                          Kinetic
                        </span>
                      )}
                      {(item.visualMode === "quote_reflection_card" || item.quoteStyle === "reflection_card") && (
                        <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-200">
                          Reflection
                        </span>
                      )}
                      {item.visualMode === "note_letter_card" && (
                        <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-1 text-xs text-teal-200">
                          Note Letter
                        </span>
                      )}
                      {item.visualMode === "bilingual_minimal" && (
                        <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs text-indigo-200">
                          Bilingual
                        </span>
                      )}
                      {item.visualMode === "ken_burns_image" && !item.quoteStyle && (
                        <span className="rounded-full border border-slate-600/40 bg-slate-800/40 px-2.5 py-1 text-xs text-slate-400">
                          Quote
                        </span>
                      )}
                      {/* Visual temperature badge */}
                      {item.visualTemperature === "warm-neutral" && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                          warm-neutral
                        </span>
                      )}
                      {item.visualTemperature === "bright-warm" && (
                        <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-200">
                          bright-warm
                        </span>
                      )}
                      {/* Visual mismatch warning — Tầng Sâu items with Buddhist keywords */}
                      {(item.workspaceId === "tang_sau_workspace" || item.channelProfileId === "tang_sau_v1") &&
                        (item.visualSearchKeywords ?? []).some((kw) =>
                          ["buddha", "temple", "monk", "prayer", "lotus", "spiritual", "buddhist", "meditation pose", "chắp tay"].some(
                            (bad) => kw.toLowerCase().includes(bad),
                          ),
                        ) && (
                          <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
                            ⚠ visual mismatch
                          </span>
                        )}
                      {item.tags?.contentType && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                          {item.tags.contentType}
                        </span>
                      )}
                      {item.tags?.contentMood && (
                        <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-200">
                          {item.tags.contentMood}
                        </span>
                      )}
                      {item.tags?.visualMotifs && item.tags.visualMotifs.length > 0 && (
                        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-200">
                          {item.tags.visualMotifs[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href={`/api/quote-shorts/${item.contentId}/asset?kind=video`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500"
                      >
                        <PlayCircle className="h-3.5 w-3.5" />
                        Xem preview
                      </a>
                    </div>
                  </div>

                  {/* Row 2: topic */}
                  <h3 className="mt-3 text-sm font-semibold text-slate-100">{item.topic}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{item.topicFamily}</p>

                  {/* Row 3: quote text */}
                  <blockquote className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm leading-6 text-slate-300 line-clamp-3">
                    &ldquo;{item.mainQuote ?? item.quoteText}&rdquo;
                  </blockquote>
                  {item.reflectionText && (
                    <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm leading-6 text-slate-400 line-clamp-4">
                      {item.reflectionText}
                    </div>
                  )}

                  {/* Row 4: platform status */}
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
                    {item.queuedPlatforms.length > 0 && (
                      <span>
                        <span className="text-amber-400">Đang chờ lịch: </span>
                        {item.queuedPlatforms.join(", ")}
                      </span>
                    )}
                    {item.donePlatforms.length > 0 && (
                      <span>
                        <span className="text-emerald-400">Đã đăng: </span>
                        {item.donePlatforms.join(", ")}
                      </span>
                    )}
                    {item.queuedPlatforms.length === 0 && item.donePlatforms.length === 0 && (
                      <span className="text-slate-600">Chưa lên lịch</span>
                    )}
                    {item.createdAt && (
                      <span className="ml-auto text-slate-600">{formatDateTime(item.createdAt)}</span>
                    )}
                  </div>

                  <TechnicalDetails sample={item} />
                </article>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar: preview */}
        <aside className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-slate-400" />
              <h2 className="text-lg font-semibold text-slate-100">Preview lịch batch</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Preview trước, sau đó xác nhận để tạo queue rows. Không upload ngay.
            </p>

            <div className="mt-5 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Sẵn sàng</span>
                <span className="font-medium text-slate-100">{eligibleItems.length}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Max items</span>
                <span className="font-medium text-slate-100">{effectiveMaxItems}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-400">Nền tảng</span>
                <span className="font-medium text-slate-100">{platforms.join(", ") || "Chưa chọn"}</span>
              </div>
            </div>

            {message && (
              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-200">
                {message}
              </div>
            )}

            {preview ? (
              <div className="mt-5 space-y-4">
                <div className={`rounded-2xl border p-4 text-sm ${
                  preview.thresholdExceeded
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                }`}>
                  <div className="flex items-center gap-2 font-medium">
                    {preview.thresholdExceeded ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    {preview.thresholdExceeded ? "Queue sẽ vượt ngưỡng" : "Queue vẫn trong ngưỡng an toàn"}
                  </div>
                  <p className="mt-2 leading-6">
                    Pending queue:{" "}
                    <span className="font-semibold">{preview.pendingBefore}</span> →{" "}
                    <span className="font-semibold">{preview.pendingAfter}</span> / {preview.pendingThreshold}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-slate-500">Đã chọn</p>
                      <p className="mt-1 font-semibold text-slate-100">{preview.selectedCount}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Queue rows</p>
                      <p className="mt-1 font-semibold text-slate-100">{preview.insertableRows}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Bỏ qua</p>
                      <p className="mt-1 font-semibold text-slate-100">{preview.skippedRows}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Tổng đủ điều kiện</p>
                      <p className="mt-1 font-semibold text-slate-100">{preview.totalEligibleCount}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {preview.rows.map((row) => (
                    <div key={`${row.contentId}-${row.platform}-${row.channelId}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-100">{row.topic}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-400">{row.quoteText}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          row.willCreate
                            ? "bg-emerald-500/15 text-emerald-200"
                            : "bg-slate-800 text-slate-300"
                        }`}>
                          {row.willCreate ? "Sẽ queue" : "Bỏ qua"}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-300">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Nền tảng</span>
                          <span>{row.platform} · {row.channelName}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Lịch (VN)</span>
                          <span>{row.scheduledAtVn}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-500">Trạng thái</span>
                          <span>{row.willCreate ? "queued" : (row.reason ?? "skipped")}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={runExecute}
                  disabled={isPending || !preview.ok || preview.insertableRows === 0 || preview.thresholdExceeded}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  Tạo queued rows
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-5 text-sm leading-6 text-slate-400">
                Chưa có preview. Bấm{" "}
                <span className="font-medium text-slate-200">Tạo lịch Quote batch</span> để xem trước lịch, số rows sẽ tạo và cảnh báo capacity.
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
