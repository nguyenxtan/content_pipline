"use client";

import { useState, useEffect } from "react";
import { Search, X, ArrowDownUp, Hash } from "lucide-react";
import type { Niche } from "@/lib/db/schema";

export interface GalleryToolbarFilters {
  topic: string;
  idSearch: string;
  nicheIds: number[];
  ttsStatus: string;
  youtubeUploadStatus: string;
  isLocked: boolean | undefined;
  sortBy: "newest" | "oldest" | "alphabetical" | "locked";
}

type QuickTab = "all" | "waiting_tts" | "tts_done" | "published" | "error";

interface Props {
  niches: Niche[];
  filters: GalleryToolbarFilters;
  total: number;
  showing: number;
  isLoading: boolean;
  onFilterChange: (f: GalleryToolbarFilters) => void;
}

const QUICK_TABS: { key: QuickTab; label: string; dot: string }[] = [
  { key: "all",         label: "Tất cả",       dot: "bg-slate-500" },
  { key: "waiting_tts", label: "Chờ TTS",       dot: "bg-amber-400" },
  { key: "tts_done",    label: "Sẵn sàng",      dot: "bg-green-400" },
  { key: "published",   label: "Đã đăng",       dot: "bg-blue-400" },
  { key: "error",       label: "Lỗi",           dot: "bg-red-400" },
];

function tabToFilter(tab: QuickTab): Pick<GalleryToolbarFilters, "ttsStatus" | "youtubeUploadStatus"> {
  switch (tab) {
    case "waiting_tts": return { ttsStatus: "pending",  youtubeUploadStatus: "" };
    case "tts_done":    return { ttsStatus: "done",     youtubeUploadStatus: "" };
    case "published":   return { ttsStatus: "",         youtubeUploadStatus: "done" };
    case "error":       return { ttsStatus: "error",    youtubeUploadStatus: "" };
    default:            return { ttsStatus: "",         youtubeUploadStatus: "" };
  }
}

function filterToTab(f: GalleryToolbarFilters): QuickTab {
  if (f.idSearch) return "all";
  if (f.ttsStatus === "pending" && !f.youtubeUploadStatus) return "waiting_tts";
  if (f.ttsStatus === "done"    && !f.youtubeUploadStatus) return "tts_done";
  if (f.youtubeUploadStatus === "done")                    return "published";
  if (f.ttsStatus === "error")                             return "error";
  return "all";
}

/** Returns true when input looks like a UUID or UUID prefix (all hex + dashes, 7+ chars). */
function looksLikeId(s: string): boolean {
  return s.length >= 7 && /^[0-9a-f-]+$/i.test(s);
}

export function ContentGalleryToolbar({ niches, filters, total, showing, isLoading, onFilterChange }: Props) {
  const currentSearch = filters.idSearch || filters.topic;
  const [searchInput, setSearchInput] = useState(currentSearch);
  const activeTab = filterToTab(filters);
  const isId = looksLikeId(searchInput);

  useEffect(() => {
    const t = setTimeout(() => {
      const newSearch = searchInput.trim();
      const newIsId = looksLikeId(newSearch);
      const prevSearch = filters.idSearch || filters.topic;
      if (newSearch === prevSearch) return;
      if (newIsId) {
        onFilterChange({ ...filters, idSearch: newSearch, topic: "", ttsStatus: "", youtubeUploadStatus: "" });
      } else {
        onFilterChange({ ...filters, idSearch: "", topic: newSearch });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTab = (tab: QuickTab) => {
    setSearchInput("");
    onFilterChange({ ...filters, ...tabToFilter(tab), idSearch: "", topic: "" });
  };

  const toggleNiche = (id: number) => {
    const next = filters.nicheIds.includes(id)
      ? filters.nicheIds.filter((n) => n !== id)
      : [...filters.nicheIds, id];
    onFilterChange({ ...filters, nicheIds: next });
  };

  const reset = () => {
    setSearchInput("");
    onFilterChange({ topic: "", idSearch: "", nicheIds: [], ttsStatus: "", youtubeUploadStatus: "", isLocked: undefined, sortBy: "newest" });
  };

  const hasExtra = filters.nicheIds.length > 0 || filters.isLocked !== undefined;

  return (
    <div className="space-y-3">
      {/* Quick tabs */}
      <div className="flex items-center gap-1 border-b border-slate-700 pb-0">
        {QUICK_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key && !filters.idSearch
                ? "border-rose-500 text-rose-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
            {t.label}
          </button>
        ))}
        {filters.idSearch && (
          <span className="flex items-center gap-1 px-3 py-2 text-xs font-medium border-b-2 border-rose-500 text-rose-400 -mb-px">
            <Hash className="h-3 w-3" />
            ID Search
          </span>
        )}
        <span className="ml-auto text-xs text-slate-600 pr-1">
          {isLoading ? "..." : `${showing} / ${total}`}
        </span>
      </div>

      {/* Search + sort row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          {isId && searchInput ? (
            <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-rose-500" />
          ) : (
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          )}
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm chủ đề hoặc ID..."
            className={`w-56 rounded-lg border bg-slate-800 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 transition-colors ${
              isId && searchInput
                ? "border-rose-700 focus:ring-rose-500"
                : "border-slate-700 focus:ring-rose-500"
            }`}
          />
          {isId && searchInput && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-rose-500 select-none">
              ID
            </span>
          )}
        </div>

        {/* ID search hint */}
        {filters.idSearch && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1">
            <span className="text-slate-600">Tất cả trạng thái ·</span>
            <span className="font-mono text-slate-400">{filters.idSearch}</span>
          </span>
        )}

        {/* Niche chips */}
        <div className="flex flex-wrap gap-1.5">
          {niches.filter((n) => n.isActive).map((n) => (
            <button
              key={n.id}
              onClick={() => toggleNiche(n.id)}
              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                filters.nicheIds.includes(n.id)
                  ? "border-rose-500 bg-rose-950/30 text-rose-300"
                  : "border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300"
              }`}
            >
              {n.name}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ArrowDownUp className="h-3 w-3 text-slate-500" />
          <select
            value={filters.sortBy}
            onChange={(e) => onFilterChange({ ...filters, sortBy: e.target.value as GalleryToolbarFilters["sortBy"] })}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:outline-none"
          >
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
            <option value="alphabetical">A-Z</option>
          </select>
          {(hasExtra || searchInput) && (
            <button onClick={reset} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
              <X className="h-3 w-3" />Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
