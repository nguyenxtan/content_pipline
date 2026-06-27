"use client";

import { useState, useTransition } from "react";
import {
  AlignJustify,
  ChevronDown,
  ChevronUp,
  Clock,
  Film,
  Loader2,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
} from "lucide-react";
import {
  previewMixedScheduleAction,
  executeMixedScheduleAction,
  type MixerSlot,
  type PreviewMixedScheduleResult,
  type ExecuteMixedScheduleResult,
  type MixMode,
} from "@/actions/schedule-mixer";
import { getChannelWorkspaces } from "@/lib/channel-workspace-registry";

const WORKSPACES = getChannelWorkspaces();

// ── Helpers ───────────────────────────────────────────────────────────────

function getNextHourVn(): string {
  const now = new Date();
  const next = new Date(now.getTime() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(next).replace(" ", "T");
}

type Platform = "youtube" | "facebook";

const FORMAT_BADGE: Record<string, { label: string; cls: string }> = {
  tts_short: { label: "TTS Short", cls: "border-rose-500/40 bg-rose-500/10 text-rose-300" },
  legacy_quote_short: { label: "Quote Short", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
};

const REASON_META: Record<string, { label: string; cls: string }> = {
  already_queued: { label: "already_queued", cls: "border-amber-700/40 bg-amber-950/20 text-amber-300" },
  already_published: { label: "already_published", cls: "border-red-700/40 bg-red-950/20 text-red-300" },
  slot_conflict: { label: "slot_conflict", cls: "border-blue-700/40 bg-blue-950/20 text-blue-300" },
  near_duplicate_topic: { label: "near_duplicate_topic", cls: "border-fuchsia-700/40 bg-fuchsia-950/20 text-fuchsia-300" },
  threshold_exceeded: { label: "threshold_exceeded", cls: "border-red-700/40 bg-red-950/20 text-red-300" },
  facebook_quote_soft_cap_exceeded: { label: "facebook_quote_soft_cap_exceeded", cls: "border-amber-700/40 bg-amber-950/20 text-amber-300" },
  facebook_total_soft_cap_exceeded: { label: "facebook_total_soft_cap_exceeded", cls: "border-amber-700/40 bg-amber-950/20 text-amber-300" },
  facebook_dominates_queue: { label: "facebook_dominates_queue", cls: "border-orange-700/40 bg-orange-950/20 text-orange-300" },
  youtube_protected_headroom_low: { label: "youtube_protected_headroom_low", cls: "border-sky-700/40 bg-sky-950/20 text-sky-300" },
  youtube_schedule_gaps: { label: "youtube_schedule_gaps", cls: "border-sky-700/40 bg-sky-950/20 text-sky-300" },
  tang_sau_topic_mismatch: { label: "tang_sau_topic_mismatch", cls: "border-red-700/40 bg-red-950/20 text-red-300" },
  untagged_quote_excluded: { label: "untagged_quote_excluded", cls: "border-amber-700/40 bg-amber-950/20 text-amber-300" },
  workspace_profile_mismatch: { label: "workspace_profile_mismatch", cls: "border-red-700/40 bg-red-950/20 text-red-300" },
};

// ── Slot row ──────────────────────────────────────────────────────────────

function SlotRow({ slot }: { slot: MixerSlot }) {
  const badge = FORMAT_BADGE[slot.formatType] ?? FORMAT_BADGE.tts_short;
  const warningCodes = slot.warnings ?? [];
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-sm ${slot.willCreate ? "border-slate-800 bg-slate-950/60" : "border-slate-800/50 bg-slate-950/30 opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
          {badge.label}
        </span>
        {!slot.willCreate && (
          <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-500">
            Bỏ qua
          </span>
        )}
        <span className="text-slate-300 font-medium truncate max-w-[180px]">{slot.topic}</span>
        <span className="ml-auto text-slate-500 shrink-0 text-xs">
          {slot.platform} · {slot.channelName}
        </span>
      </div>
      {(slot.reason || warningCodes.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {slot.reason && (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${REASON_META[slot.reason]?.cls ?? "border-slate-700 bg-slate-900 text-slate-400"}`}>
              {REASON_META[slot.reason]?.label ?? slot.reason}
            </span>
          )}
          {warningCodes.map((code) => (
            <span
              key={code}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${REASON_META[code]?.cls ?? "border-slate-700 bg-slate-900 text-slate-400"}`}
            >
              {REASON_META[code]?.label ?? code}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
        <Clock className="h-3 w-3 text-slate-500" />
        {slot.scheduledAtVn}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function ScheduleMixerPanel() {
  const [isPreviewing, startPreview] = useTransition();
  const [isExecuting, startExecute] = useTransition();

  // Controls
  const [workspaceId, setWorkspaceId] = useState("");
  const [mixMode, setMixMode] = useState<MixMode>("alternate");
  const [ttsWeight, setTtsWeight] = useState(1);
  const [quoteWeight, setQuoteWeight] = useState(1);
  const [startAt, setStartAt] = useState(getNextHourVn);
  const [intervalHours, setIntervalHours] = useState(1);
  const [maxSlots, setMaxSlots] = useState(5);
  const [platforms, setPlatforms] = useState<Platform[]>(["youtube", "facebook"]);

  const activeWorkspace = WORKSPACES.find((w) => w.workspaceId === workspaceId) ?? null;

  const applyWorkspaceDefaults = (wsId: string) => {
    const ws = WORKSPACES.find((w) => w.workspaceId === wsId);
    if (!ws) return;
    const plan = ws.schedulePlan;
    setIntervalHours(Math.round(plan.intervalMinutes / 60));
    setPlatforms(plan.platforms as Platform[]);
    const mix = ws.formatMix;
    const totalMix = mix.ttsShortWeight + mix.quoteShortWeight;
    if (totalMix > 0 && (mix.ttsShortWeight === 0 || mix.quoteShortWeight === 0)) {
      // One format dominates — use alternate (or ratio if both non-zero)
      setMixMode("alternate");
    } else if (totalMix > 0) {
      setMixMode("ratio");
      setTtsWeight(mix.ttsShortWeight);
      setQuoteWeight(mix.quoteShortWeight);
    }
  };

  // State
  const [preview, setPreview] = useState<PreviewMixedScheduleResult | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteMixedScheduleResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const isPending = isPreviewing || isExecuting;

  const togglePlatform = (p: Platform) =>
    setPlatforms((cur) =>
      cur.includes(p) ? (cur.length > 1 ? cur.filter((x) => x !== p) : cur) : [...cur, p],
    );

  const buildOpts = () => ({
    startAtIso: new Date(startAt).toISOString(),
    intervalMin: Math.max(30, intervalHours * 60),
    maxSlots: Math.max(1, Math.min(20, maxSlots)),
    platforms,
    mixMode,
    ttsWeight: mixMode === "ratio" ? Math.max(1, ttsWeight) : 1,
    quoteWeight: mixMode === "ratio" ? Math.max(1, quoteWeight) : 1,
    workspaceId: workspaceId || undefined,
  });

  const runPreview = () => {
    setMessage(null);
    setExecuteResult(null);
    startPreview(async () => {
      const result = await previewMixedScheduleAction(buildOpts());
      setPreview(result);
      if (!result.ok && result.message) setMessage(result.message);
    });
  };

  const runExecute = () => {
    if (!preview?.ok || preview.thresholdExceeded) return;
    setMessage(null);
    startExecute(async () => {
      const result = await executeMixedScheduleAction(buildOpts());
      setExecuteResult(result);
      setPreview(result);
      setMessage(
        result.ok
          ? `Đã tạo ${result.createdIds.length} queue rows. Cron sẽ đăng theo lịch.`
          : (result.message ?? "Không thể tạo rows."),
      );
    });
  };

  const hasHardBlock = !!preview?.hardBlockReasons?.length;
  const canExecute =
    preview?.ok &&
    !preview.thresholdExceeded &&
    !hasHardBlock &&
    preview.insertableCount > 0 &&
    !executeResult;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-4 hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-2">
            <Shuffle className="h-4 w-4 text-rose-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-slate-100">Lập lịch trộn</p>
            <p className="text-xs text-slate-400">
              Tạo hàng chờ đăng cho video TTS Short và Quote Short đã có sẵn, theo lịch xen kẽ hoặc theo tỷ lệ.
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      </button>

      {open && (
        <div className="border-t border-slate-800 px-6 pb-6 pt-5 space-y-5">
          {/* Workspace selector */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-300 uppercase tracking-wide">Workspace (tùy chọn)</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setWorkspaceId("")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  !workspaceId
                    ? "bg-slate-700 text-white"
                    : "border border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500"
                }`}
              >
                Thủ công
              </button>
              {WORKSPACES.map((w) => (
                <button
                  key={w.workspaceId}
                  type="button"
                  onClick={() => { setWorkspaceId(w.workspaceId); applyWorkspaceDefaults(w.workspaceId); setPreview(null); setExecuteResult(null); setMessage(null); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    workspaceId === w.workspaceId
                      ? "bg-rose-600 text-white"
                      : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {w.displayName}
                </button>
              ))}
            </div>
            {activeWorkspace && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs space-y-1.5">
                <p className="font-medium text-rose-200">Kênh đích của workspace này:</p>
                {activeWorkspace.platformAccounts.map((acc) => (
                  <div key={`${acc.platform}-${acc.platformChannelId}`} className="flex items-center gap-2 text-slate-300">
                    <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px]">
                      {acc.platform === "youtube" ? "YouTube" : "Facebook"}
                    </span>
                    <span className="font-medium">{acc.displayName}</span>
                    <span className="text-slate-600 font-mono">{acc.platformChannelId}</span>
                  </div>
                ))}
                <p className="text-slate-500 pt-0.5">
                  Chỉ tạo lịch cho kênh trên. Không gửi nhầm sang kênh khác.
                </p>
              </div>
            )}
          </div>

          {/* Mode selector */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-300 uppercase tracking-wide">Chế độ trộn</p>
            <div className="flex gap-2">
              {([
                { v: "alternate", label: "Xen kẽ", icon: AlignJustify, desc: "Quote → TTS → Quote → TTS…" },
                { v: "ratio", label: "Tỷ lệ", icon: Film, desc: "Theo trọng số tùy chỉnh" },
              ] as const).map(({ v, label, icon: Icon, desc }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMixMode(v)}
                  className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors ${
                    mixMode === v
                      ? "border-rose-500/50 bg-rose-500/10"
                      : "border-slate-700 bg-slate-950 hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`h-3.5 w-3.5 ${mixMode === v ? "text-rose-400" : "text-slate-500"}`} />
                    <span className={`text-sm font-medium ${mixMode === v ? "text-rose-200" : "text-slate-300"}`}>
                      {label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Ratio weights */}
          {mixMode === "ratio" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-rose-300">TTS Short (trọng số)</span>
                <input
                  type="number" min={1} max={10} step={1} value={ttsWeight}
                  onChange={(e) => setTtsWeight(Math.max(1, +e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-amber-300">Quote Short (trọng số)</span>
                <input
                  type="number" min={1} max={10} step={1} value={quoteWeight}
                  onChange={(e) => setQuoteWeight(Math.max(1, +e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500"
                />
              </label>
              <p className="col-span-2 text-xs text-slate-500">
                Ví dụ TTS=2, Quote=1 → TTS, TTS, Quote, TTS, TTS, Quote…
              </p>
            </div>
          )}

          {/* Schedule controls */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Bắt đầu lúc</span>
              <input
                type="datetime-local" value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Khoảng cách (giờ)</span>
              <input
                type="number" min={1} max={12} step={1} value={intervalHours}
                onChange={(e) => setIntervalHours(Math.max(1, +e.target.value))}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Số slot tối đa</span>
              <input
                type="number" min={1} max={20} step={1} value={maxSlots}
                onChange={(e) => setMaxSlots(Math.max(1, Math.min(20, +e.target.value)))}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
              />
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Nền tảng</span>
              <div className="flex h-[42px] items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-2">
                {(["youtube", "facebook"] as Platform[]).map((p) => {
                  const wsPlatforms = activeWorkspace?.platformAccounts.map((a) => a.platform) ?? null;
                  const unavailable = wsPlatforms !== null && !wsPlatforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => !unavailable && togglePlatform(p)}
                      disabled={unavailable}
                      title={unavailable ? `Workspace "${activeWorkspace!.displayName}" không có tài khoản ${p}` : undefined}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        unavailable
                          ? "cursor-not-allowed opacity-30 bg-slate-800 text-slate-500"
                          : platforms.includes(p)
                            ? "bg-rose-600 text-white"
                            : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {p === "youtube" ? "YouTube" : "Facebook"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runPreview}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
              Xem trước lịch
            </button>

            {preview && !executeResult && (
              <button
                type="button"
                onClick={runExecute}
                disabled={isPending || !canExecute}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Tạo {preview.insertableCount} queue rows
              </button>
            )}

            {executeResult && (
              <button
                type="button"
                onClick={() => { setPreview(null); setExecuteResult(null); setMessage(null); }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500"
              >
                Lên lịch đợt khác
              </button>
            )}
          </div>

          {/* Workspace destination warning */}
          {preview?.workspaceDestinationWarning && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-xs text-red-300">
              ⚠️ {preview.workspaceDestinationWarning}
            </div>
          )}

          {/* Message */}
          {message && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${
              executeResult?.ok
                ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
                : "border-slate-700 bg-slate-950 text-slate-300"
            }`}>
              {message}
            </div>
          )}

          {/* Preview result */}
          {preview && (
            <div className="space-y-4">
              {/* Stats bar */}
              <div className={`rounded-2xl border p-4 text-sm ${
                preview.thresholdExceeded
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              }`}>
                <div className="flex items-center gap-2 font-medium">
                  {preview.thresholdExceeded
                    ? <ShieldAlert className="h-4 w-4" />
                    : <ShieldCheck className="h-4 w-4" />}
                  {preview.thresholdExceeded ? "Queue sẽ vượt ngưỡng — không thể tạo" : "Queue trong ngưỡng an toàn"}
                </div>
                <p className="mt-2 leading-6">
                  Pending: <span className="font-semibold">{preview.pendingBefore}</span>
                  {" → "}<span className="font-semibold">{preview.pendingAfter}</span>
                  {" / "}{preview.pendingThreshold}
                </p>
                {preview.pendingBreakdown && (
                  <p className="mt-2 text-xs leading-6 text-current/80">
                    YouTube: <span className="font-semibold">{preview.pendingBreakdown.youtubePending}</span>
                    {" · "}Facebook: <span className="font-semibold">{preview.pendingBreakdown.facebookPending}</span>
                    {" · "}Facebook quote: <span className="font-semibold">{preview.pendingBreakdown.facebookQuotePending}</span>
                    {" · "}Headroom sau khi thêm: <span className="font-semibold">{preview.pendingBreakdown.headroomAfter}</span>
                  </p>
                )}
                {!!preview.hardBlockReasons?.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {preview.hardBlockReasons.map((reason) => (
                      <span
                        key={reason}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${REASON_META[reason]?.cls ?? "border-slate-700 bg-slate-900 text-slate-300"}`}
                      >
                        {REASON_META[reason]?.label ?? reason}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {!!preview.balanceWarnings?.length && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Balance warnings</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {preview.balanceWarnings.map((reason) => (
                      <span
                        key={reason}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${REASON_META[reason]?.cls ?? "border-slate-700 bg-slate-900 text-slate-300"}`}
                      >
                        {REASON_META[reason]?.label ?? reason}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Format summary */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
                {[
                  { label: "TTS Short", value: preview.ttsCount, cls: "text-rose-300" },
                  { label: "Quote Short", value: preview.quoteCount, cls: "text-amber-300" },
                  { label: "Sẽ tạo", value: preview.insertableCount, cls: "text-emerald-300" },
                  { label: "Bỏ qua", value: preview.skippedCount, cls: "text-slate-400" },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-slate-500 text-xs">{label}</p>
                    <p className={`mt-1 text-lg font-semibold ${cls}`}>{value}</p>
                  </div>
                ))}
              </div>

              {!!preview.warningCounts && Object.keys(preview.warningCounts).length > 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Skipped / warning reasons</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(preview.warningCounts)
                      .filter(([, count]) => count > 0)
                      .map(([reason, count]) => (
                        <span
                          key={reason}
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${REASON_META[reason]?.cls ?? "border-slate-700 bg-slate-900 text-slate-300"}`}
                        >
                          {(REASON_META[reason]?.label ?? reason)}: {count}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {/* Slot list */}
              {preview.slots.length > 0 && (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {preview.slots.map((slot, i) => (
                    <SlotRow key={`${slot.contentId}-${slot.platform}-${slot.channelId}-${i}`} slot={slot} />
                  ))}
                </div>
              )}

              {preview.slots.length === 0 && preview.ok && (
                <p className="text-sm text-slate-500 italic">
                  Không có nội dung đủ điều kiện cho lịch trộn.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
