"use client";

import type { PromptVersionInfo } from "@/lib/validations/content";

interface Props {
  versions: PromptVersionInfo[];
  selected: number | null;
  onSelect: (id: number, template: PromptVersionInfo) => void;
}

export function StepPromptSelect({ versions, selected, onSelect }: Props) {
  if (versions.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-1">Chọn phiên bản prompt</h2>
        <p className="text-sm text-gray-400 py-8 text-center">
          Chưa có prompt template nào cho stage này.
          Tạo template tại{" "}
          <a href="/niches" className="text-blue-500 underline">Niches &gt; Prompts</a>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Chọn phiên bản prompt</h2>
      <p className="text-sm text-gray-500 mb-4">
        {versions.length} phiên bản — chọn template bạn muốn sử dụng
      </p>
      <div className="space-y-3">
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => onSelect(v.id, v)}
            className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
              selected === v.id
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium truncate">{v.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">v{v.version}</span>
                  {v.isActive && (
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                      active
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  Model: {v.model} · Temp: {v.temperature} · Max: {v.maxTokens} tokens
                </p>
                {v.variables.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    Variables: {v.variables.join(", ")}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-500">{v.testRunCount} runs</p>
                {v.avgCost > 0 && (
                  <p className="text-xs text-amber-600">${v.avgCost.toFixed(4)} avg</p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
