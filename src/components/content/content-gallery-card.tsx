"use client";

import type { ContentGenerationRow } from "@/lib/validations/content-generator";

const TTS_CONFIG: Record<string, { icon: string; label: string; cls: string }> = {
  pending:    { icon: "⏰", label: "Pending",    cls: "bg-yellow-900/40 text-yellow-300" },
  processing: { icon: "⚙️", label: "Processing", cls: "bg-blue-900/40 text-blue-300" },
  done:       { icon: "✅", label: "Done",        cls: "bg-green-900/40 text-green-300" },
  error:      { icon: "❌", label: "Error",       cls: "bg-red-900/40 text-red-300" },
};

const YT_CONFIG: Record<string, { icon: string; label: string; cls: string }> = {
  pending:    { icon: "⏰", label: "Pending",    cls: "bg-yellow-900/40 text-yellow-300" },
  scheduled:  { icon: "📅", label: "Scheduled",  cls: "bg-purple-900/40 text-purple-300" },
  uploading:  { icon: "⬆️", label: "Uploading",  cls: "bg-blue-900/40 text-blue-300" },
  done:       { icon: "✅", label: "Done",        cls: "bg-green-900/40 text-green-300" },
  error:      { icon: "❌", label: "Error",       cls: "bg-red-900/40 text-red-300" },
};

function relativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s trước`;
  if (diff < 3600) return `${Math.floor(diff / 60)}p trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
  return `${Math.floor(diff / 86400)}d trước`;
}

interface Props {
  generation: ContentGenerationRow;
  onView: () => void;
  onEditStatus: () => void;
  onLock: () => Promise<void>;
  onUnlock: () => Promise<void>;
  isLockLoading?: boolean;
}

export function ContentGalleryCard({
  generation,
  onView,
  onEditStatus,
  onLock,
  onUnlock,
  isLockLoading,
}: Props) {
  const tts = TTS_CONFIG[generation.ttsStatus ?? "pending"] ?? TTS_CONFIG.pending;
  const yt = YT_CONFIG[generation.youtubeUploadStatus ?? "pending"] ?? YT_CONFIG.pending;

  const handleLockToggle = generation.isLocked ? onUnlock : onLock;

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-800 p-4 transition-shadow hover:shadow-lg hover:shadow-black/30">
      {/* Topic + Niche */}
      <div>
        <p className="text-base font-bold text-slate-100 line-clamp-2 leading-snug">
          📌 {generation.topic}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          🏷️ {generation.nicheName}
        </p>
      </div>

      {/* Status badges */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${tts.cls}`}>
            {tts.icon} TTS: {tts.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${yt.cls}`}>
            {yt.icon} YT: {yt.label}
          </span>
          {generation.youtubeScheduledAt && generation.youtubeUploadStatus === "scheduled" && (
            <span className="text-xs text-slate-500">
              {new Date(generation.youtubeScheduledAt).toLocaleDateString("vi-VN")}
            </span>
          )}
        </div>
      </div>

      {/* Lock + timestamp */}
      <div className="flex items-center justify-between text-xs">
        <span className={generation.isLocked ? "text-amber-400" : "text-slate-500"}>
          {generation.isLocked ? "🔒 Locked" : "🔓 Unlocked"}
        </span>
        <span className="text-slate-500">{relativeTime(generation.createdAt)}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 border-t border-slate-700 pt-3">
        <button
          onClick={onView}
          title="Xem nội dung"
          className="flex-1 rounded-md border border-slate-600 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
        >
          👁️ View
        </button>
        <button
          onClick={onEditStatus}
          title="Sửa trạng thái"
          className="flex-1 rounded-md border border-slate-600 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
        >
          ⚙️ Status
        </button>
        <button
          onClick={handleLockToggle}
          disabled={isLockLoading}
          title={generation.isLocked ? "Mở khóa" : "Khóa"}
          className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
            generation.isLocked
              ? "border-amber-600 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50"
              : "border-slate-600 text-slate-300 hover:bg-slate-700"
          }`}
        >
          {isLockLoading ? "…" : generation.isLocked ? "🔓" : "🔒"}
        </button>
      </div>
    </div>
  );
}
