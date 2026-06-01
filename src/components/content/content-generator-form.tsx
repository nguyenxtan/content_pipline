"use client";

import { useState } from "react";
import { Zap, Loader2, ChevronDown, ChevronRight, CalendarClock } from "lucide-react";
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
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">
          Lĩnh vực <span className="text-red-400">*</span>
        </label>
        <select
          value={nicheId}
          onChange={(e) => setNicheId(Number(e.target.value))}
          className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500"
          disabled={isLoading}
          required
        >
          <option value={0} disabled>-- Chọn lĩnh vực --</option>
          {active.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
        {active.length === 0 && (
          <p className="mt-1 text-xs text-red-400">
            Chưa có lĩnh vực nào.{" "}
            <a href="/niches/new" className="underline">Tạo lĩnh vực trước.</a>
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">
          Chủ đề / Từ khóa <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Tạo thói quen tốt mỗi sáng, Thiền tập hằng ngày..."
          maxLength={200}
          className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
          disabled={isLoading}
          required
        />
        <p className="mt-1 text-xs text-slate-500">{topic.length}/200 ký tự</p>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex items-center gap-2 px-6 py-2.5 bg-rose-600 text-white rounded-lg font-medium text-sm hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading
          ? <><Loader2 className="h-4 w-4 animate-spin" />Đang tạo...</>
          : <><Zap className="h-4 w-4" />Generate</>
        }
      </button>

      <div className="border-t border-slate-700 pt-4">
        <button
          type="button"
          onClick={() => setShowScheduler((v) => !v)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          {showScheduler ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <CalendarClock className="h-4 w-4" />
          Cài đặt lịch tự động
        </button>
        {showScheduler && (
          <div className="mt-3 bg-slate-800 border border-slate-700 rounded-lg p-4 text-sm text-slate-400">
            Tính năng scheduler sẽ được kích hoạt ở Phase 2.5 (Cron Worker). Cấu hình job tại bảng{" "}
            <span className="font-medium text-slate-300">Scheduled Jobs</span> bên dưới.
          </div>
        )}
      </div>
    </form>
  );
}
