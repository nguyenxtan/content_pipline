"use client";

import { useEffect, useState } from "react";
import { getRecentGenerationsAction } from "@/actions/content";
import type { RecentGenerationItem } from "@/lib/validations/content";

const STAGE_LABELS: Record<string, string> = {
  ideation: "Ý tưởng",
  script: "Kịch bản",
  short: "Short",
  long: "Long",
};

const STATUS_DOT: Record<string, string> = {
  done: "bg-green-500",
  error: "bg-red-500",
  processing: "bg-yellow-400",
  pending: "bg-gray-400",
};

function relativeTime(date: Date) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

interface Props {
  refreshKey?: number;
}

export function RecentGenerationsPanel({ refreshKey = 0 }: Props) {
  const [items, setItems] = useState<RecentGenerationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getRecentGenerationsAction(15)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold">Tạo gần đây</h3>
      </div>
      <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
        {loading && (
          <div className="py-6 text-center">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        )}
        {!loading && items.length === 0 && (
          <p className="py-6 text-xs text-gray-400 text-center">Chưa có lịch sử</p>
        )}
        {items.map((item) => (
          <div key={item.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  {item.niche.icon && (
                    <span className="text-sm">{item.niche.icon}</span>
                  )}
                  <span className="text-xs font-medium truncate">{item.niche.name}</span>
                </div>
                <p className="text-xs text-gray-500">
                  {STAGE_LABELS[item.stage] ?? item.stage}
                </p>
                {item.output && (
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{item.output}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className={`w-2 h-2 rounded-full ${STATUS_DOT[item.status] ?? "bg-gray-400"}`} />
                <span className="text-xs text-gray-400">{relativeTime(item.createdAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
