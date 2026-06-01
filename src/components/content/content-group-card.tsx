"use client";

import { useState } from "react";
import { Pin, Eye, Settings2, Lock, LockOpen, Clipboard, ChevronRight, ChevronDown } from "lucide-react";
import type { ContentGenerationRow } from "@/lib/validations/content-generator";

const TTS_LABEL: Record<string, string> = {
  pending: "Pending", processing: "Processing", done: "Done", error: "Error",
};
const YT_LABEL: Record<string, string> = {
  pending: "Pending", scheduled: "Scheduled", uploading: "Uploading", done: "Done", error: "Error",
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
    <div className="border border-slate-700 rounded-xl overflow-hidden bg-slate-900">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800 hover:bg-slate-750 text-left"
      >
        <div className="flex items-center gap-2">
          <Pin className="h-4 w-4 text-rose-400 shrink-0" />
          <span className="text-sm font-semibold text-slate-100">{topic}</span>
          <span className="text-xs text-slate-400 bg-slate-700 px-1.5 py-0.5 rounded-full">
            {items.length}
          </span>
        </div>
        {collapsed
          ? <ChevronRight className="h-4 w-4 text-slate-400" />
          : <ChevronDown className="h-4 w-4 text-slate-400" />
        }
      </button>

      {!collapsed && (
        <div className="divide-y divide-slate-800">
          {items.map((item) => (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200">{item.nicheName}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-xs text-slate-500">
                      TTS: {TTS_LABEL[item.ttsStatus ?? "pending"]}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="text-xs text-slate-500">
                      YT: {YT_LABEL[item.youtubeUploadStatus ?? "pending"]}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className={`flex items-center gap-1 text-xs ${item.isLocked ? "text-amber-400" : "text-slate-500"}`}>
                      {item.isLocked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                      {item.isLocked ? "Locked" : "Unlocked"}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="text-xs text-slate-500">{relativeTime(item.createdAt)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onView(item)}
                    className="rounded border border-slate-600 p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
                    title="Xem nội dung"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onEditStatus(item)}
                    className="rounded border border-slate-600 p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
                    title="Sửa trạng thái"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleLockToggle(item)}
                    disabled={loadingId === item.id}
                    className={`rounded border p-1.5 transition-colors disabled:opacity-50 ${
                      item.isLocked
                        ? "border-amber-600 bg-amber-900/30 text-amber-400 hover:bg-amber-900/50"
                        : "border-slate-600 text-slate-400 hover:bg-slate-700"
                    }`}
                    title={item.isLocked ? "Mở khóa" : "Khóa"}
                  >
                    {loadingId === item.id
                      ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      : item.isLocked
                        ? <LockOpen className="h-3.5 w-3.5" />
                        : <Lock className="h-3.5 w-3.5" />
                    }
                  </button>
                  <button
                    onClick={() => onCopyScript(item.script)}
                    className="rounded border border-slate-600 p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
                    title="Copy script"
                  >
                    <Clipboard className="h-3.5 w-3.5" />
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
