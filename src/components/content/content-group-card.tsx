"use client";

import { useState } from "react";
import type { ContentGenerationRow } from "@/lib/validations/content-generator";

const TTS_BADGE: Record<string, string> = {
  pending: "⏰",
  processing: "⚙️",
  done: "✅",
  error: "❌",
};

const YT_BADGE: Record<string, string> = {
  pending: "⏰",
  scheduled: "📅",
  uploading: "⬆️",
  done: "✅",
  error: "❌",
};

function relativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s trước`;
  if (diff < 3600) return `${Math.floor(diff / 60)}p trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
  return `${Math.floor(diff / 86400)}d trước`;
}

interface Props {
  topic: string;
  items: ContentGenerationRow[];
  onView: (item: ContentGenerationRow) => void;
  onEditStatus: (item: ContentGenerationRow) => void;
  onLock: (id: string) => Promise<void>;
  onUnlock: (id: string) => Promise<void>;
  onCopyScript: (script: string) => void;
}

export function ContentGroupCard({ topic, items, onView, onEditStatus, onLock, onUnlock, onCopyScript }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleLockToggle = async (item: ContentGenerationRow) => {
    setLoadingId(item.id);
    if (item.isLocked) await onUnlock(item.id);
    else await onLock(item.id);
    setLoadingId(null);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Topic header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">📌</span>
          <span className="text-sm font-semibold text-gray-800">{topic}</span>
          <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded-full">
            {items.length}
          </span>
        </div>
        <span className="text-gray-400 text-xs">{collapsed ? "▶" : "▼"}</span>
      </button>

      {/* Variations */}
      {!collapsed && (
        <div className="divide-y divide-gray-100">
          {items.map((item) => (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                {/* Left: info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{item.nicheName}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {/* TTS badge */}
                    <span className="text-xs text-gray-500">
                      TTS: {TTS_BADGE[item.ttsStatus ?? "pending"]} {item.ttsStatus ?? "pending"}
                    </span>
                    <span className="text-gray-300">|</span>
                    {/* YT badge */}
                    <span className="text-xs text-gray-500">
                      YT: {YT_BADGE[item.youtubeUploadStatus ?? "pending"]} {item.youtubeUploadStatus ?? "pending"}
                      {item.youtubeScheduledAt && item.youtubeUploadStatus === "scheduled" && (
                        <span className="ml-1 text-blue-500">
                          ({new Date(item.youtubeScheduledAt).toLocaleString("vi-VN")})
                        </span>
                      )}
                    </span>
                    <span className="text-gray-300">|</span>
                    {/* Lock */}
                    <span className={`text-xs ${item.isLocked ? "text-amber-600" : "text-gray-400"}`}>
                      {item.isLocked ? "🔒 Locked" : "🔓 Unlocked"}
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="text-xs text-gray-400">{relativeTime(item.createdAt)}</span>
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  <button
                    onClick={() => onView(item)}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                    title="Xem nội dung"
                  >
                    👁️
                  </button>
                  <button
                    onClick={() => onEditStatus(item)}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                    title="Sửa trạng thái"
                  >
                    ⚙️
                  </button>
                  <button
                    onClick={() => handleLockToggle(item)}
                    disabled={loadingId === item.id}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      item.isLocked
                        ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        : "border-gray-300 hover:bg-gray-50"
                    } disabled:opacity-50`}
                    title={item.isLocked ? "Mở khóa" : "Khóa"}
                  >
                    {loadingId === item.id ? "..." : item.isLocked ? "🔓" : "🔒"}
                  </button>
                  <button
                    onClick={() => onCopyScript(item.script)}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                    title="Copy script"
                  >
                    📋
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
