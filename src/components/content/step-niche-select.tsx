"use client";

import type { Niche } from "@/lib/db/schema";

interface Props {
  niches: Niche[];
  selected: number | null;
  onSelect: (id: number) => void;
}

export function StepNicheSelect({ niches, selected, onSelect }: Props) {
  const active = niches.filter((n) => n.isActive);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Chọn ngách nội dung</h2>
      <p className="text-sm text-gray-500 mb-4">Chọn chủ đề bạn muốn tạo nội dung</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {active.map((n) => (
          <button
            key={n.id}
            onClick={() => onSelect(n.id)}
            className={`text-left p-4 rounded-lg border-2 transition-colors ${
              selected === n.id
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {n.icon && <span className="text-xl">{n.icon}</span>}
              <span className="font-medium">{n.name}</span>
            </div>
            {n.description && (
              <p className="text-xs text-gray-500 line-clamp-2">{n.description}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              {(n.stages as string[]).length} stages
            </p>
          </button>
        ))}
        {active.length === 0 && (
          <p className="col-span-2 text-sm text-gray-400 py-8 text-center">
            Chưa có ngách nào. Tạo ngách tại{" "}
            <a href="/niches" className="text-blue-500 underline">Niches</a>.
          </p>
        )}
      </div>
    </div>
  );
}
