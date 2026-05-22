"use client";

import { useState, useEffect } from "react";
import type { Niche } from "@/lib/db/schema";

export interface GalleryToolbarFilters {
  topic: string;
  nicheIds: number[];
  ttsStatus: string;
  youtubeUploadStatus: string;
  isLocked: boolean | undefined;
  sortBy: "newest" | "oldest" | "alphabetical" | "locked";
}

interface Props {
  niches: Niche[];
  filters: GalleryToolbarFilters;
  total: number;
  showing: number;
  isLoading: boolean;
  onFilterChange: (f: GalleryToolbarFilters) => void;
}

export function ContentGalleryToolbar({
  niches,
  filters,
  total,
  showing,
  isLoading,
  onFilterChange,
}: Props) {
  const [topicInput, setTopicInput] = useState(filters.topic);

  useEffect(() => {
    const t = setTimeout(() => {
      if (topicInput !== filters.topic) {
        onFilterChange({ ...filters, topic: topicInput });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [topicInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleNiche = (id: number) => {
    const next = filters.nicheIds.includes(id)
      ? filters.nicheIds.filter((n) => n !== id)
      : [...filters.nicheIds, id];
    onFilterChange({ ...filters, nicheIds: next });
  };

  const reset = () => {
    setTopicInput("");
    onFilterChange({ topic: "", nicheIds: [], ttsStatus: "", youtubeUploadStatus: "", isLocked: undefined, sortBy: "newest" });
  };

  const hasActiveFilter =
    filters.topic || filters.nicheIds.length || filters.ttsStatus || filters.youtubeUploadStatus || filters.isLocked !== undefined;

  return (
    <div className="sticky top-0 z-10 space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
      {/* Row 1: search + status filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Topic search */}
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="Tìm topic..."
            className="w-48 rounded-lg border border-slate-600 bg-slate-800 py-1.5 pl-7 pr-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* TTS Status */}
        <select
          value={filters.ttsStatus}
          onChange={(e) => onFilterChange({ ...filters, ttsStatus: e.target.value })}
          className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">TTS: All</option>
          <option value="pending">⏰ Pending</option>
          <option value="processing">⚙️ Processing</option>
          <option value="done">✅ Done</option>
          <option value="error">❌ Error</option>
        </select>

        {/* YouTube Status */}
        <select
          value={filters.youtubeUploadStatus}
          onChange={(e) => onFilterChange({ ...filters, youtubeUploadStatus: e.target.value })}
          className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">YouTube: All</option>
          <option value="pending">⏰ Pending</option>
          <option value="scheduled">📅 Scheduled</option>
          <option value="uploading">⬆️ Uploading</option>
          <option value="done">✅ Done</option>
          <option value="error">❌ Error</option>
        </select>

        {/* Lock toggle */}
        <button
          onClick={() => onFilterChange({ ...filters, isLocked: filters.isLocked === true ? undefined : true })}
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
            filters.isLocked === true
              ? "border-amber-500 bg-amber-900/30 text-amber-300"
              : "border-slate-600 text-slate-400 hover:border-slate-500"
          }`}
        >
          🔒 Locked only
        </button>

        {/* Quick filter */}
        <button
          onClick={() => onFilterChange({ ...filters, ttsStatus: "pending", youtubeUploadStatus: "" })}
          className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-400 hover:border-slate-500 transition-colors"
        >
          ⏰ Pending TTS
        </button>

        {hasActiveFilter && (
          <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            ✕ Reset
          </button>
        )}
      </div>

      {/* Row 2: sort + count */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Niche chips */}
        <div className="flex flex-wrap gap-1.5">
          {niches.filter((n) => n.isActive).map((n) => (
            <button
              key={n.id}
              onClick={() => toggleNiche(n.id)}
              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                filters.nicheIds.includes(n.id)
                  ? "border-blue-500 bg-blue-900/30 text-blue-300"
                  : "border-slate-600 text-slate-500 hover:border-slate-500"
              }`}
            >
              {n.icon ? `${n.icon} ` : ""}{n.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Sort */}
          <select
            value={filters.sortBy}
            onChange={(e) => onFilterChange({ ...filters, sortBy: e.target.value as GalleryToolbarFilters["sortBy"] })}
            className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="newest">↓ Newest</option>
            <option value="oldest">↑ Oldest</option>
            <option value="alphabetical">A→Z Topic</option>
            <option value="locked">🔒 Locked first</option>
          </select>

          {/* Result count */}
          <span className="text-xs text-slate-500">
            {isLoading ? "Loading..." : `${showing} / ${total}`}
          </span>
        </div>
      </div>
    </div>
  );
}
