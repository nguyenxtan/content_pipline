"use client";

import { useState } from "react";

interface Props {
  page: number;
  perPage: number;
  total: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}

export function ContentGalleryPagination({
  page,
  perPage,
  total,
  hasNextPage,
  hasPrevPage,
  onPageChange,
  onPerPageChange,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const [pageInput, setPageInput] = useState(String(page));

  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(pageInput, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      onPageChange(n);
    } else {
      setPageInput(String(page));
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      {/* Left: count info */}
      <span className="text-slate-400 text-xs">
        {total === 0 ? "0 results" : `${from}–${to} of ${total.toLocaleString()} items`}
      </span>

      {/* Center: prev / page input / next */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { onPageChange(page - 1); setPageInput(String(page - 1)); }}
          disabled={!hasPrevPage}
          className="px-3 py-1.5 rounded-lg border border-slate-600 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>

        <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            className="w-14 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-center text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-slate-500">/ {totalPages}</span>
        </form>

        <button
          onClick={() => { onPageChange(page + 1); setPageInput(String(page + 1)); }}
          disabled={!hasNextPage}
          className="px-3 py-1.5 rounded-lg border border-slate-600 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>

      {/* Right: per-page selector */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <span>Per page:</span>
        {[20, 50, 100].map((n) => (
          <button
            key={n}
            onClick={() => { onPerPageChange(n); setPageInput("1"); }}
            className={`px-2 py-1 rounded border transition-colors ${
              perPage === n
                ? "border-blue-500 bg-blue-900/30 text-blue-300"
                : "border-slate-600 text-slate-400 hover:bg-slate-700"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
