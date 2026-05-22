"use client";

import { useState, useEffect } from "react";
import type { Niche } from "@/lib/db/schema";

export interface GalleryFilters {
  topic: string;
  nicheIds: number[];
  ttsStatus: string;
  youtubeUploadStatus: string;
  isLocked: boolean | undefined;
}

interface Props {
  niches: Niche[];
  filters: GalleryFilters;
  total: number;
  onFilterChange: (f: GalleryFilters) => void;
}

export function ContentGalleryFilters({ niches, filters, total, onFilterChange }: Props) {
  const [topicInput, setTopicInput] = useState(filters.topic);

  // Debounce topic search
  useEffect(() => {
    const t = setTimeout(() => {
      if (topicInput !== filters.topic) {
        onFilterChange({ ...filters, topic: topicInput });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [topicInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleNiche = (id: number) => {
    const current = filters.nicheIds;
    const next = current.includes(id) ? current.filter((n) => n !== id) : [...current, id];
    onFilterChange({ ...filters, nicheIds: next });
  };

  const reset = () => {
    setTopicInput("");
    onFilterChange({ topic: "", nicheIds: [], ttsStatus: "", youtubeUploadStatus: "", isLocked: undefined });
  };

  const hasActive = filters.topic || filters.nicheIds.length || filters.ttsStatus || filters.youtubeUploadStatus || filters.isLocked !== undefined;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{total} results</span>
        {hasActive && (
          <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600">
            Xóa filter
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Topic search */}
        <input
          type="text"
          value={topicInput}
          onChange={(e) => setTopicInput(e.target.value)}
          placeholder="Tìm theo topic..."
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* TTS Status */}
        <select
          value={filters.ttsStatus}
          onChange={(e) => onFilterChange({ ...filters, ttsStatus: e.target.value })}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">TTS: Tất cả</option>
          <option value="pending">⏰ Pending</option>
          <option value="processing">⚙️ Processing</option>
          <option value="done">✅ Done</option>
          <option value="error">❌ Error</option>
        </select>

        {/* YouTube Status */}
        <select
          value={filters.youtubeUploadStatus}
          onChange={(e) => onFilterChange({ ...filters, youtubeUploadStatus: e.target.value })}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">YouTube: Tất cả</option>
          <option value="pending">⏰ Pending</option>
          <option value="scheduled">📅 Scheduled</option>
          <option value="uploading">⬆️ Uploading</option>
          <option value="done">✅ Done</option>
          <option value="error">❌ Error</option>
        </select>

        {/* Lock toggle */}
        <button
          onClick={() => onFilterChange({ ...filters, isLocked: filters.isLocked === true ? undefined : true })}
          className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
            filters.isLocked === true
              ? "border-amber-400 bg-amber-50 text-amber-700"
              : "border-gray-300 text-gray-600 hover:border-gray-400"
          }`}
        >
          🔒 Locked only
        </button>

        {/* Quick filter */}
        <button
          onClick={() => onFilterChange({ ...filters, ttsStatus: "pending", youtubeUploadStatus: "" })}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:border-gray-400"
        >
          ⏰ Pending Actions
        </button>
      </div>

      {/* Niche chips */}
      {niches.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {niches.filter((n) => n.isActive).map((n) => (
            <button
              key={n.id}
              onClick={() => toggleNiche(n.id)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                filters.nicheIds.includes(n.id)
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {n.icon ? `${n.icon} ` : ""}{n.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
