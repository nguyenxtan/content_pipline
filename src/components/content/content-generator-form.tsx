"use client";

import { useState } from "react";
import type { Niche } from "@/lib/db/schema";

interface Props {
  niches: Niche[];
  initialNicheId?: number;
  onSubmit: (nicheId: number, topic: string) => Promise<void>;
  isLoading: boolean;
}

export function ContentGeneratorForm({ niches, initialNicheId, onSubmit, isLoading }: Props) {
  const active = niches.filter((n) => n.isActive);
  const [nicheId, setNicheId] = useState<number>(initialNicheId ?? (active[0]?.id ?? 0));
  const [topic, setTopic] = useState("");
  const [showScheduler, setShowScheduler] = useState(false);

  const canSubmit = nicheId > 0 && topic.trim().length >= 3 && !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit(nicheId, topic.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      {/* Niche select */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Ngách nội dung <span className="text-red-500">*</span>
        </label>
        <select
          value={nicheId}
          onChange={(e) => setNicheId(Number(e.target.value))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          disabled={isLoading}
          required
        >
          <option value={0} disabled>-- Chọn ngách --</option>
          {active.map((n) => (
            <option key={n.id} value={n.id}>
              {n.icon ? `${n.icon} ` : ""}{n.name}
            </option>
          ))}
        </select>
        {active.length === 0 && (
          <p className="mt-1 text-xs text-red-500">
            Chưa có ngách nào.{" "}
            <a href="/niches/new" className="underline">Tạo ngách trước.</a>
          </p>
        )}
      </div>

      {/* Topic input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Chủ đề / Từ khóa <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Tạo thói quen tốt mỗi sáng, Thiền tập hằng ngày..."
          maxLength={200}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
          required
        />
        <p className="mt-1 text-xs text-gray-400">{topic.length}/200 ký tự</p>
      </div>

      {/* Generate button */}
      <button
        type="submit"
        disabled={!canSubmit}
        className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Đang tạo...
          </>
        ) : (
          "🚀 Generate"
        )}
      </button>

      {/* Scheduler toggle */}
      <div className="border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={() => setShowScheduler((v) => !v)}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
        >
          <span>{showScheduler ? "▼" : "▶"}</span>
          🔄 Cài đặt lịch tự động
        </button>
        {showScheduler && (
          <div className="mt-3 bg-gray-50 rounded-lg p-4 text-sm text-gray-500">
            Tính năng scheduler sẽ được kích hoạt ở Phase 2.5 (Cron Worker).
            Cấu hình job tại bảng{" "}
            <span className="font-medium text-gray-700">Scheduled Jobs</span> bên dưới.
          </div>
        )}
      </div>
    </form>
  );
}
