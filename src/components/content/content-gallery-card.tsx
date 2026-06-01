"use client";

import { useRef, useState, useEffect } from "react";
import {
  Lock, LockOpen, Eye, Settings2, Trash2,
  Mic, MonitorPlay, Video, Image, Share2, Film,
  Play, Pause, Loader2, AlertCircle,
  MoreHorizontal, TvMinimalPlay as Youtube, ExternalLink, TrendingUp, CalendarPlus, RefreshCcw,
} from "lucide-react";
import type { ContentGenerationRow } from "@/lib/validations/content-generator";
import type { ContentTab } from "./content-gallery";
import { useAppSettings } from "@/contexts/app-settings";

/* ─── Pipeline step definitions ──────────────────────────── */
type PipelineStatus = "done" | "processing" | "pending" | "error" | "skipped";

interface StepConfig {
  label: string;
  icon: React.ReactNode;
  status: PipelineStatus;
  detail?: string;
  actionKey?: "tts" | "images" | "longImages" | "video" | "youtube";
}

function getSteps(g: ContentGenerationRow, activeTab: ContentTab): StepConfig[] {
  if (activeTab === "long") {
    const tts  = g.longTtsStatus ?? "pending";
    const imgs = g.longImagesStatus ?? "pending";
    const vid  = g.longVideoStatus ?? "pending";
    const yt   = g.longYoutubeUploadStatus ?? "pending";
    const afterTts  = tts === "done";
    const afterImgs = imgs === "done";
    const afterVid  = vid === "done";
    return [
      { label: "Script", icon: <Video className="h-3 w-3" />, status: "done" },
      {
        label: "TTS", icon: <Mic className="h-3 w-3" />,
        status: tts as PipelineStatus,
        detail: tts === "error" ? (g.longTtsErrorMessage ?? undefined) : undefined,
        actionKey: "tts",
      },
      {
        label: "Ảnh", icon: <Image className="h-3 w-3" />,
        status: !afterTts ? "skipped" : imgs === "done" ? "done" : imgs === "processing" ? "processing" : imgs === "error" ? "error" : "pending",
        detail: imgs === "error" ? (g.longImagesErrorMessage ?? undefined) : undefined,
        actionKey: "longImages",
      },
      {
        label: "Video", icon: <Film className="h-3 w-3" />,
        status: !afterTts || !afterImgs ? "skipped" : vid === "done" ? "done" : vid === "processing" ? "processing" : vid === "error" ? "error" : "pending",
        detail: vid === "error" ? (g.longVideoErrorMessage ?? undefined) : undefined,
        actionKey: "video",
      },
      {
        label: "YT", icon: <MonitorPlay className="h-3 w-3" />,
        status: !afterVid ? "skipped" : yt === "done" ? "done" : yt === "uploading" ? "processing" : yt === "scheduled" ? "processing" : yt === "error" ? "error" : "pending",
        detail: yt === "error" ? (g.longYoutubeUploadError ?? undefined) : yt === "done" ? (g.longYoutubeVideoUrl ?? undefined) : undefined,
        actionKey: "youtube",
      },
    ];
  }

  // Short pipeline
  const tts  = g.ttsStatus ?? "pending";
  const fb   = g.facebookUploadStatus ?? "pending";
  const imgs = g.imagesStatus ?? "pending";
  const vid  = g.videoStatus ?? "pending";
  const yt   = g.youtubeUploadStatus ?? "pending";
  const afterTts  = tts  === "done";
  const afterImgs = imgs === "done";
  const afterVid  = vid  === "done";
  return [
    { label: "Script", icon: <Video className="h-3 w-3" />, status: "done" },
    {
      label: "TTS", icon: <Mic className="h-3 w-3" />,
      status: tts as PipelineStatus,
      detail: tts === "error" ? (g.ttsErrorMessage ?? undefined) : undefined,
      actionKey: "tts",
    },
    {
      label: "Ảnh", icon: <Image className="h-3 w-3" />,
      status: !afterTts ? "skipped" : imgs === "done" ? "done" : imgs === "processing" ? "processing" : imgs === "error" ? "error" : "pending",
      detail: imgs === "error" ? (g.imagesErrorMessage ?? undefined) : undefined,
      actionKey: "images",
    },
    {
      label: "Video", icon: <Film className="h-3 w-3" />,
      status: !afterTts || !afterImgs ? "skipped" : vid === "done" ? "done" : vid === "processing" ? "processing" : vid === "error" ? "error" : "pending",
      detail: vid === "error" ? (g.videoErrorMessage ?? undefined) : undefined,
      actionKey: "video",
    },
    {
      label: "YT", icon: <MonitorPlay className="h-3 w-3" />,
      status: !afterVid ? "skipped" : yt === "done" ? "done" : yt === "processing" ? "processing" : yt === "error" ? "error" : "pending",
      detail: yt === "error" ? (g.youtubeUploadError ?? undefined) : yt === "done" ? (g.youtubeVideoUrl ?? undefined) : undefined,
      actionKey: "youtube",
    },
    {
      label: "FB", icon: <Share2 className="h-3 w-3" />,
      status: !afterVid ? "skipped" : fb === "done" ? "done" : fb === "uploading" ? "processing" : fb === "error" ? "error" : "pending",
    },
  ];
}

function getReadyStatus(g: ContentGenerationRow, activeTab: ContentTab) {
  if (activeTab === "long") {
    const tts  = g.longTtsStatus ?? "pending";
    const imgs = g.longImagesStatus ?? "pending";
    const vid  = g.longVideoStatus ?? "pending";
    const yt   = g.longYoutubeUploadStatus ?? "pending";
    if (yt === "done")         return { label: "Đăng YT",      dotCls: "bg-blue-400",               borderCls: "border-blue-800/50"    };
    if (yt === "scheduled")    return { label: "Đã lên lịch",  dotCls: "bg-violet-400",             borderCls: "border-violet-800/50"  };
    if (vid === "done")        return { label: "Có video",     dotCls: "bg-cyan-400",               borderCls: "border-cyan-800/50"    };
    if (vid === "processing")  return { label: "Dựng video",   dotCls: "bg-blue-400 animate-pulse", borderCls: "border-blue-800/40"    };
    if (imgs === "done")       return { label: "Có ảnh",       dotCls: "bg-teal-400",               borderCls: "border-teal-800/50"    };
    if (imgs === "processing") return { label: "Tạo ảnh...",   dotCls: "bg-blue-400 animate-pulse", borderCls: "border-blue-800/40"    };
    if (tts === "done")        return { label: "Sẵn sàng",    dotCls: "bg-green-400",              borderCls: "border-green-800/50"   };
    if (tts === "processing")  return { label: "TTS...",        dotCls: "bg-blue-400 animate-pulse", borderCls: "border-blue-800/40"    };
    if (tts === "error" || imgs === "error" || vid === "error" || yt === "error")
                               return { label: "Có lỗi",       dotCls: "bg-red-400",                borderCls: "border-red-800/50"     };
    return                            { label: "Chờ TTS",      dotCls: "bg-amber-400",              borderCls: "border-amber-800/40"   };
  }

  // Short
  const fb   = g.facebookUploadStatus ?? "pending";
  const tts  = g.ttsStatus ?? "pending";
  const imgs = g.imagesStatus ?? "pending";
  const vid  = g.videoStatus ?? "pending";
  const yt   = g.youtubeUploadStatus ?? "pending";
  if (yt === "done" && fb === "done") return { label: "Hoàn thành",  dotCls: "bg-emerald-400",            borderCls: "border-emerald-800/50" };
  if (yt === "done")                  return { label: "Đăng YT",      dotCls: "bg-blue-400",               borderCls: "border-blue-800/50"    };
  if (fb === "done")                  return { label: "Đăng FB",      dotCls: "bg-indigo-400",             borderCls: "border-indigo-800/50"  };
  if (yt === "scheduled" || fb === "scheduled") return { label: "Đã lên lịch", dotCls: "bg-violet-400",   borderCls: "border-violet-800/50"  };
  if (vid === "done")                 return { label: "Có video",     dotCls: "bg-cyan-400",               borderCls: "border-cyan-800/50"    };
  if (vid === "processing")           return { label: "Dựng video",   dotCls: "bg-blue-400 animate-pulse", borderCls: "border-blue-800/40"    };
  if (imgs === "done")                return { label: "Có ảnh",       dotCls: "bg-teal-400",               borderCls: "border-teal-800/50"    };
  if (imgs === "processing")          return { label: "Tạo ảnh...",   dotCls: "bg-blue-400 animate-pulse", borderCls: "border-blue-800/40"    };
  if (tts === "done")                 return { label: "Sẵn sàng",    dotCls: "bg-green-400",              borderCls: "border-green-800/50"   };
  if (tts === "processing")           return { label: "TTS...",        dotCls: "bg-blue-400 animate-pulse", borderCls: "border-blue-800/40"    };
  if (tts === "error" || imgs === "error" || vid === "error" || yt === "error")
                                      return { label: "Có lỗi",       dotCls: "bg-red-400",                borderCls: "border-red-800/50"     };
  return                                     { label: "Chờ TTS",      dotCls: "bg-amber-400",              borderCls: "border-amber-800/40"   };
}

const STATUS_STYLE: Record<PipelineStatus, { dot: string; text: string; ring: string }> = {
  done:       { dot: "bg-green-400",                text: "text-green-400",  ring: "ring-green-500/30"  },
  processing: { dot: "bg-blue-400 animate-pulse",   text: "text-blue-400",   ring: "ring-blue-500/30"   },
  pending:    { dot: "bg-slate-600",                text: "text-slate-500",  ring: ""                   },
  error:      { dot: "bg-red-400",                  text: "text-red-400",    ring: "ring-red-500/30"    },
  skipped:    { dot: "bg-slate-800",                text: "text-slate-700",  ring: ""                   },
};

function wc(text: string) { return text ? text.trim().split(/\s+/).length : 0; }
function relativeTime(date: Date) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}p`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.floor(s % 60)}s`;
}

/* ─── Clickable Pipeline Step ────────────────────────────── */
function PipelineStep({
  step,
  onClick,
  isLoading,
  isRegen,
}: {
  step: StepConfig;
  onClick?: () => void;
  isLoading?: boolean;
  isRegen?: boolean;   // true khi đã done nhưng cho phép gen lại
}) {
  const s = STATUS_STYLE[step.status];
  if (step.status === "skipped") return null;

  const runnable = !!onClick && !isLoading;
  const tooltip = step.detail
    ? step.detail
    : runnable
    ? isRegen
      ? `Gen lại ${step.label} (ảnh cũ sẽ bị xóa)`
      : step.status === "error"
      ? `Retry ${step.label}`
      : `Chạy ${step.label}`
    : step.label;

  return (
    <div
      role={runnable ? "button" : undefined}
      tabIndex={runnable ? 0 : undefined}
      onClick={runnable ? onClick : undefined}
      onKeyDown={runnable ? (e) => e.key === "Enter" && onClick?.() : undefined}
      title={tooltip}
      className={[
        "flex items-center gap-1 rounded px-1.5 py-0.5 border select-none",
        step.status !== "pending"
          ? `ring-1 ${s.ring}`
          : "",
        runnable
          ? "border-slate-600/80 cursor-pointer hover:border-slate-400 hover:bg-slate-700/60 active:scale-95 transition-all"
          : "border-slate-700/60",
        step.status === "error" && runnable
          ? "border-red-800/60 hover:border-red-500"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isLoading ? (
        <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-400 shrink-0" />
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      )}
      <span className={`text-[10px] font-medium ${s.text}`}>{step.label}</span>
      {/* tiny run arrow shown on hover when runnable */}
      {runnable && (
        <span className="text-[8px] text-slate-500 opacity-0 group-hover/step:opacity-100 -mr-0.5">
          ▸
        </span>
      )}
    </div>
  );
}

/* ─── ⋯ Actions Dropdown ─────────────────────────────────── */
interface ActionsMenuProps {
  onView: () => void;
  onEditStatus: () => void;
  onLock: () => Promise<void>;
  onUnlock: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRegenerateHooks?: () => Promise<void>;
  onScheduleShort?: () => void;
  onScheduleQuote?: () => void;
  onScheduleLong?: () => void;
  isLocked: boolean;
  isLockLoading?: boolean;
  canScheduleShort?: boolean;
  canScheduleQuote?: boolean;
  canScheduleLong?: boolean;
  canRegenerateHooks?: boolean;
  isHookLoading?: boolean;
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={[
        "flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors disabled:opacity-40",
        danger
          ? "text-red-400 hover:bg-red-950/40 hover:text-red-300"
          : "text-slate-300 hover:bg-slate-800 hover:text-slate-100",
      ].join(" ")}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
      ) : (
        <span className="h-3.5 w-3.5 shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      )}
      {label}
    </button>
  );
}

function ActionsMenu({
  onView,
  onEditStatus,
  onLock,
  onUnlock,
  onDelete,
  onRegenerateHooks,
  onScheduleShort,
  onScheduleQuote,
  onScheduleLong,
  isLocked,
  isLockLoading,
  canScheduleShort,
  canScheduleQuote,
  canScheduleLong,
  canRegenerateHooks,
  isHookLoading,
}: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={[
          "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
          open
            ? "bg-slate-700 text-slate-200"
            : "text-slate-600 hover:text-slate-300 hover:bg-slate-700/70",
        ].join(" ")}
        title="Thao tác"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-slate-700 bg-slate-900/95 backdrop-blur-sm shadow-xl shadow-black/40 z-50 py-1 overflow-hidden">
          <MenuItem icon={<Eye />} label="Xem nội dung" onClick={() => { onView(); close(); }} />
          <MenuItem icon={<Settings2 />} label="Cập nhật trạng thái" onClick={() => { onEditStatus(); close(); }} />
          {canRegenerateHooks && (
            <MenuItem
              icon={<RefreshCcw />}
              label="Tạo lại hook"
              loading={isHookLoading}
              onClick={() => { void onRegenerateHooks?.(); close(); }}
            />
          )}
          {(canScheduleShort || canScheduleQuote || canScheduleLong) && (
            <>
              <div className="my-1 mx-2 border-t border-slate-800" />
              {canScheduleShort && (
                <MenuItem icon={<CalendarPlus />} label="Lên lịch Short (YT)" onClick={() => { onScheduleShort?.(); close(); }} />
              )}
              {canScheduleQuote && (
                <MenuItem icon={<CalendarPlus />} label="Lên lịch Bài ảnh (FB)" onClick={() => { onScheduleQuote?.(); close(); }} />
              )}
              {canScheduleLong && (
                <MenuItem icon={<CalendarPlus />} label="Lên lịch Long (YT)" onClick={() => { onScheduleLong?.(); close(); }} />
              )}
            </>
          )}
          <div className="my-1 mx-2 border-t border-slate-800" />
          <MenuItem
            icon={isLocked ? <LockOpen /> : <Lock />}
            label={isLocked ? "Mở khóa" : "Khóa nội dung"}
            loading={isLockLoading}
            onClick={() => { void (isLocked ? onUnlock() : onLock()); close(); }}
          />
          {!isLocked && (
            <>
              <div className="my-1 mx-2 border-t border-slate-800" />
              <MenuItem
                icon={<Trash2 />}
                label="Xóa nội dung"
                danger
                onClick={() => { onDelete(); close(); }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Compact Audio Player (Web Audio API) ───────────────── */
function CompactPlayer({ fileId }: { fileId: string }) {
  const url = `/api/tts/stream?file=${fileId}.wav`;

  const [status, setStatus]     = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const ctxRef        = useRef<AudioContext | null>(null);
  const bufferRef     = useRef<AudioBuffer  | null>(null);
  const sourceRef     = useRef<AudioBufferSourceNode | null>(null);
  const startCtxTime  = useRef(0);
  const startOffset   = useRef(0);
  const rafRef        = useRef<number>(0);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        const arr = await res.arrayBuffer();
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const decoded = await ctx.decodeAudioData(arr);
        bufferRef.current = decoded;
        setDuration(decoded.duration);
        setStatus("ready");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setStatus("error");
      }
    })();
    return () => {
      ctrl.abort();
      cancelAnimationFrame(rafRef.current);
      try { sourceRef.current?.stop(); } catch { /* already stopped */ }
      ctxRef.current?.close();
    };
  }, [url]);

  const tick = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const pos = startOffset.current + (ctx.currentTime - startCtxTime.current);
    const clamped = Math.min(pos, duration);
    setProgress(clamped);
    if (pos < duration) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      setPlaying(false);
      setProgress(0);
      startOffset.current = 0;
    }
  };

  const playFrom = (offset: number) => {
    const ctx = ctxRef.current!;
    const buffer = bufferRef.current!;
    try { sourceRef.current?.stop(); } catch { /* ignore */ }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      if (sourceRef.current === src) {
        setPlaying(false);
        setProgress(0);
        startOffset.current = 0;
        cancelAnimationFrame(rafRef.current);
      }
    };
    src.start(0, offset);
    sourceRef.current = src;
    startCtxTime.current = ctx.currentTime;
    startOffset.current = offset;
    setPlaying(true);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  };

  const toggle = () => {
    if (status !== "ready") return;
    const ctx = ctxRef.current!;
    if (playing) {
      const pos = startOffset.current + (ctx.currentTime - startCtxTime.current);
      startOffset.current = Math.min(pos, duration);
      try { sourceRef.current?.stop(); } catch { /* ignore */ }
      sourceRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setPlaying(false);
    } else {
      if (ctx.state === "suspended") ctx.resume();
      playFrom(startOffset.current);
    }
  };

  const seek = (t: number) => {
    startOffset.current = t;
    setProgress(t);
    if (playing) playFrom(t);
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2 mt-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 px-2.5 py-1.5">
      {status === "loading" && (
        <>
          <Loader2 className="h-3.5 w-3.5 text-slate-500 animate-spin shrink-0" />
          <span className="text-[10px] text-slate-600">Đang tải audio…</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
          <span className="text-[10px] text-red-400">Không tải được audio</span>
        </>
      )}
      {status === "ready" && (
        <>
          <button
            onClick={toggle}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-600 hover:bg-rose-500 transition-colors"
          >
            {playing
              ? <Pause className="h-3 w-3 text-white" />
              : <Play  className="h-3 w-3 text-white ml-0.5" />}
          </button>
          <input
            type="range" min={0} max={duration} step={0.1} value={progress}
            onChange={e => seek(parseFloat(e.target.value))}
            className="flex-1 h-0.5 appearance-none bg-slate-700 rounded cursor-pointer accent-rose-500"
          />
          <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
            {fmt(progress)} / {fmt(duration)}
          </span>
        </>
      )}
    </div>
  );
}

/* ─── Main Card ──────────────────────────────────────────── */
interface Props {
  generation: ContentGenerationRow;
  activeTab: ContentTab;
  onView: () => void;
  onEditStatus: () => void;
  onLock: () => Promise<void>;
  onUnlock: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRegenerateHooks?: () => Promise<void>;
  onTTS: () => Promise<void>;
  onImages: () => Promise<void>;
  onLongImages: () => Promise<void>;
  onVideo: () => Promise<void>;
  onYoutubeUpload: () => Promise<void>;
  onExpandToLong: () => Promise<void>;
  onScheduleShort?: () => void;
  onScheduleQuote?: () => void;
  onScheduleLong?: () => void;
  isTTSLoading?: boolean;
  isImagesLoading?: boolean;
  isLongImagesLoading?: boolean;
  isVideoLoading?: boolean;
  isYoutubeLoading?: boolean;
  isLockLoading?: boolean;
  isExpandLoading?: boolean;
  isHookLoading?: boolean;
}

export function ContentGalleryCard({
  generation: g,
  activeTab,
  onView, onEditStatus, onLock, onUnlock, onDelete, onRegenerateHooks,
  onTTS, onImages, onLongImages, onVideo, onYoutubeUpload, onExpandToLong,
  onScheduleShort, onScheduleQuote, onScheduleLong,
  isTTSLoading, isImagesLoading, isLongImagesLoading, isVideoLoading, isYoutubeLoading, isLockLoading, isExpandLoading, isHookLoading,
}: Props) {
  const steps = getSteps(g, activeTab);
  const ready = getReadyStatus(g, activeTab);
  const { fmt } = useAppSettings();

  // Tab-specific pipeline values
  const tts         = activeTab === "long" ? (g.longTtsStatus ?? "pending") : (g.ttsStatus ?? "pending");
  const errMsg      = activeTab === "long" ? g.longTtsErrorMessage : g.ttsErrorMessage;
  const audioPath   = activeTab === "long" ? g.longAudioPath : g.audioPath;
  const audioFileId = activeTab === "long" ? `${g.id}-long` : g.id;
  const ttsDurMs    = activeTab === "long" ? g.longTtsDurationMs : g.ttsDurationMs;

  const canTTS    = tts === "pending" || tts === "error";
  const ttsReady  = tts === "done" && !!audioPath;

  // Images (short tab)
  const imgs        = g.imagesStatus ?? "pending";
  const canImages   = activeTab === "short" && ttsReady && imgs !== "processing";
  const imgsIsDone  = imgs === "done";
  const imgsDurMs   = g.imagesDurationMs;
  const imgsCostUsd = g.imagesCostUsd ? parseFloat(g.imagesCostUsd) : null;

  // Images (long tab)
  const longImgs       = g.longImagesStatus ?? "pending";
  const canLongImages  = activeTab === "long" && ttsReady && longImgs !== "processing";
  const longImgsIsDone = longImgs === "done";
  const longImgsDurMs  = g.longImagesDurationMs;
  const longImgsCostUsd = g.longImagesCostUsd ? parseFloat(g.longImagesCostUsd) : null;

  // Video
  const vid        = activeTab === "long" ? (g.longVideoStatus ?? "pending") : (g.videoStatus ?? "pending");
  const canVideo   = activeTab === "long"
    ? ttsReady && longImgsIsDone && vid !== "processing"
    : ttsReady && imgsIsDone && vid !== "processing";
  const vidIsDone  = vid === "done";

  // YouTube upload (tab-specific)
  const yt         = activeTab === "long" ? (g.longYoutubeUploadStatus ?? "pending") : (g.youtubeUploadStatus ?? "pending");
  const canYT      = vidIsDone && yt !== "processing" && yt !== "done";
  const ytIsDone   = yt === "done";
  const ytVideoUrl = activeTab === "long" ? g.longYoutubeVideoUrl : g.youtubeVideoUrl;

  // Word counts
  const shortWc = wc(g.shortContent);
  const longWc  = wc(g.longContent);
  const longMins = Math.round(longWc / 135);

  // Resolve per-step action handlers
  const stepAction = (step: StepConfig): { onClick?: () => void; isLoading: boolean; isRegen?: boolean } => {
    if (step.actionKey === "tts" && canTTS && !isTTSLoading) {
      return { onClick: onTTS, isLoading: false };
    }
    if (step.actionKey === "tts" && isTTSLoading) {
      return { onClick: undefined, isLoading: true };
    }
    if (step.actionKey === "images" && canImages && !isImagesLoading) {
      return { onClick: onImages, isLoading: false, isRegen: imgsIsDone };
    }
    if (step.actionKey === "images" && isImagesLoading) {
      return { onClick: undefined, isLoading: true };
    }
    if (step.actionKey === "longImages" && canLongImages && !isLongImagesLoading) {
      return { onClick: onLongImages, isLoading: false, isRegen: longImgsIsDone };
    }
    if (step.actionKey === "longImages" && isLongImagesLoading) {
      return { onClick: undefined, isLoading: true };
    }
    if (step.actionKey === "video" && canVideo && !isVideoLoading) {
      return { onClick: onVideo, isLoading: false, isRegen: vidIsDone };
    }
    if (step.actionKey === "video" && isVideoLoading) {
      return { onClick: undefined, isLoading: true };
    }
    if (step.actionKey === "youtube" && canYT && !isYoutubeLoading) {
      return { onClick: onYoutubeUpload, isLoading: false };
    }
    if (step.actionKey === "youtube" && isYoutubeLoading) {
      return { onClick: undefined, isLoading: true };
    }
    return { onClick: undefined, isLoading: false };
  };

  const canScheduleShort = activeTab === "short" && (g.videoStatus ?? "pending") === "done";
  const canScheduleQuote = activeTab === "short" && (g.videoStatus ?? "pending") === "done";
  const canScheduleLong  = activeTab === "long" && (g.longVideoStatus ?? "pending") === "done";
  const canRegenerateHooks = activeTab === "short" && !g.isLocked;

  // Suppress TS warning about errMsg (used in tooltip title)
  void errMsg;

  return (
    <div className={`border-b border-slate-800 transition-colors ${g.isLocked ? "bg-amber-950/10" : "hover:bg-slate-800/30"}`}>
      <div className="flex items-center gap-3 px-4 py-3">

        {/* Ready dot */}
        <div title={ready.label} className="shrink-0">
          <span className={`block w-2 h-2 rounded-full ${ready.dotCls}`} />
        </div>

        {/* Topic + meta + optional player */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200 truncate leading-snug">{g.topic}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-slate-500">{g.nicheName}</span>
            <span className="text-slate-700">·</span>
            {activeTab === "short" ? (
              <span className="text-[11px] text-slate-600">
                <span className="text-slate-400">{shortWc}</span> từ
              </span>
            ) : (
              <span className="text-[11px] text-slate-600">
                <span className="text-slate-400">{Math.round(longWc / 100) * 100}</span> từ
                <span className="text-slate-600 ml-1">~{longMins}p</span>
              </span>
            )}
            {ttsReady && ttsDurMs && (
              <span title="Thời gian gen TTS" className="text-[10px] text-slate-600 border border-slate-700/50 rounded px-1 py-px">
                TTS {fmtMs(ttsDurMs)}
              </span>
            )}
            {activeTab === "short" && imgs === "done" && imgsDurMs && (
              <span
                title={`Ảnh: ${fmtMs(imgsDurMs)}${imgsCostUsd != null ? ` · ${fmt(imgsCostUsd)}` : ""}`}
                className="text-[10px] text-slate-600 border border-violet-900/50 rounded px-1 py-px"
              >
                Ảnh {fmtMs(imgsDurMs)}{imgsCostUsd != null && ` · ${fmt(imgsCostUsd)}`}
              </span>
            )}
            {activeTab === "long" && longImgs === "done" && longImgsDurMs && (
              <span
                title={`Ảnh dài: ${fmtMs(longImgsDurMs)}${longImgsCostUsd != null ? ` · ${fmt(longImgsCostUsd)}` : ""}${g.longThumbnailPath ? " · thumbnail ✓" : ""}`}
                className="text-[10px] text-slate-600 border border-violet-900/50 rounded px-1 py-px"
              >
                Ảnh {fmtMs(longImgsDurMs)}{longImgsCostUsd != null && ` · ${fmt(longImgsCostUsd)}`}
              </span>
            )}
          </div>

          {/* Audio player — long tab only shows it before video is done */}
          {ttsReady && (activeTab === "short" || !vidIsDone) && <CompactPlayer fileId={audioFileId} />}

          {/* Video download link */}
          {vidIsDone && activeTab === "short" && (
            <a
              href={`/api/video/stream/${g.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-300 hover:text-white transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Xem video
            </a>
          )}
          {vidIsDone && activeTab === "long" && (
            <a
              href={`/api/video/stream/${g.id}?type=long`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-300 hover:text-white transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Xem video dài
            </a>
          )}

          {/* Expand to long — shown when short-only and no long content yet */}
          {activeTab === "short" && g.contentMode === "short" && !g.longContent && (
            <button
              onClick={onExpandToLong}
              disabled={isExpandLoading}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-emerald-800/50 bg-emerald-900/20 px-2 py-1 text-[11px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExpandLoading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <TrendingUp className="h-3 w-3" />}
              {isExpandLoading ? "Đang tạo..." : "Tạo video dài"}
            </button>
          )}

          {/* YouTube link when uploaded */}
          {ytIsDone && ytVideoUrl && (
            <a
              href={ytVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-red-800/40 bg-red-900/20 px-2 py-1 text-[11px] text-red-400 hover:text-red-300 transition-colors"
            >
              <Youtube className="h-3 w-3" />
              Xem trên YouTube
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>

        {/* Pipeline steps — clickable */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {steps.map((s) => {
            const { onClick, isLoading, isRegen } = stepAction(s);
            return (
              <div key={s.label} className="group/step">
                <PipelineStep step={s} onClick={onClick} isLoading={isLoading} isRegen={isRegen} />
              </div>
            );
          })}
        </div>

        {/* Ready badge */}
        <div className={`hidden md:flex items-center gap-1.5 rounded-full border px-2 py-0.5 shrink-0 ${ready.borderCls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${ready.dotCls}`} />
          <span className="text-[10px] font-medium text-slate-400">{ready.label}</span>
        </div>

        {/* Time + lock icon */}
        <div className="flex items-center gap-1.5 shrink-0 text-xs text-slate-600">
          {g.isLocked && <Lock className="h-3 w-3 text-amber-500" />}
          {relativeTime(g.createdAt)}
        </div>

        {/* ⋯ actions menu */}
        <ActionsMenu
          onView={onView}
          onEditStatus={onEditStatus}
          onLock={onLock}
          onUnlock={onUnlock}
          onDelete={onDelete}
          onRegenerateHooks={onRegenerateHooks}
          onScheduleShort={onScheduleShort}
          onScheduleQuote={onScheduleQuote}
          onScheduleLong={onScheduleLong}
          isLocked={!!g.isLocked}
          isLockLoading={isLockLoading}
          canScheduleShort={canScheduleShort}
          canScheduleQuote={canScheduleQuote}
          canScheduleLong={canScheduleLong}
          canRegenerateHooks={canRegenerateHooks}
          isHookLoading={isHookLoading}
        />
      </div>
    </div>
  );
}
