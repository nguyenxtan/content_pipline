"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles, Loader2, Check,
  Sun, Heart, Brain, BookOpen, TrendingUp, Wind, Leaf, Home,
  type LucideIcon,
} from "lucide-react";
import { createChannelFromTopicAction } from "@/actions/channels";
import type { TopicPreset, TopicIconName } from "@/lib/topics";

const ICON_MAP: Record<TopicIconName, LucideIcon> = {
  Sun, Heart, Brain, BookOpen, TrendingUp, Wind, Leaf, Home,
};

interface Props {
  presets: readonly TopicPreset[];
}

export function TopicPicker({ presets }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [customTopic, setCustomTopic] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const canCreate = selected !== null || customTopic.trim().length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    setError(null);
    startTransition(async () => {
      const result = await createChannelFromTopicAction(
        selected ?? "custom",
        selected ? undefined : customTopic.trim()
      );
      if ("error" in result) setError(result.error);
      else router.push(`/niches/${result.nicheId}`);
    });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Preset grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {presets.map((p) => {
          const Icon = ICON_MAP[p.icon];
          const isSelected = selected === p.id;
          return (
            <button
              key={p.id}
              onClick={() => { setSelected(p.id); setCustomTopic(""); }}
              disabled={isPending}
              className={`relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                isSelected
                  ? "border-rose-500 bg-rose-950/60 ring-1 ring-rose-500"
                  : "border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-800"
              }`}
            >
              {isSelected && (
                <span className="absolute top-2.5 right-2.5">
                  <Check className="h-3.5 w-3.5 text-rose-400" />
                </span>
              )}
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                isSelected ? "bg-rose-600" : "bg-slate-700"
              }`}>
                <Icon className={`h-5 w-5 ${isSelected ? "text-white" : "text-slate-300"}`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-100 leading-snug">{p.label}</p>
                <p className="mt-0.5 text-xs text-slate-400 leading-relaxed">{p.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t border-slate-700" />
        <span className="text-xs text-slate-500">hoặc nhập chủ đề tùy chỉnh</span>
        <div className="flex-1 border-t border-slate-700" />
      </div>

      {/* Custom input */}
      <input
        type="text"
        value={customTopic}
        onChange={(e) => { setCustomTopic(e.target.value); setSelected(null); }}
        onKeyDown={(e) => e.key === "Enter" && canCreate && handleCreate()}
        disabled={isPending}
        placeholder="Ví dụ: Truyện cổ tích Việt Nam, Khoa học vũ trụ..."
        className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-rose-500 focus:outline-none disabled:opacity-50"
      />

      {error && (
        <p className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-2.5 text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        onClick={handleCreate}
        disabled={isPending || !canCreate}
        className="flex items-center gap-2 rounded-lg bg-rose-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPending
          ? <><Loader2 className="h-4 w-4 animate-spin" />AI đang tạo phân mục...</>
          : <><Sparkles className="h-4 w-4" />Tạo phân mục tự động</>
        }
      </button>

      {isPending && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/30 px-4 py-3 space-y-1">
          <p className="text-sm font-medium text-rose-300 flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            AI đang tạo phân mục và 4 prompt templates...
          </p>
          <p className="text-xs text-slate-500">Tự động lưu và chuyển sang trang phân mục sau khi xong.</p>
        </div>
      )}
    </div>
  );
}
