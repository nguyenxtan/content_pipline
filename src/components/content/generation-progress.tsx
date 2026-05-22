"use client";

import { useEffect, useState } from "react";

interface Props {
  isVisible: boolean;
}

const STAGES = [
  { key: "script", label: "Đang tạo kịch bản..." },
  { key: "short", label: "Đang tạo short content..." },
  { key: "long", label: "Đang tạo long content..." },
];

export function GenerationProgress({ isVisible }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isVisible) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">Đang tạo nội dung</h2>
        <span className="text-xs text-gray-400">{elapsed}s</span>
      </div>
      <div className="space-y-3">
        {STAGES.map((stage) => (
          <div key={stage.key} className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-sm text-gray-600">{stage.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-gray-400">
        Ước tính: 30-60 giây — đang gọi LLM song song
      </p>
    </div>
  );
}
