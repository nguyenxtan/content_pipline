"use client";

import type { GenerationResult } from "@/lib/validations/content";

interface Props {
  result: GenerationResult;
  onNew: () => void;
}

export function ResultPanel({ result, onNew }: Props) {
  const isPending = result.status === "pending" || result.status === "processing";

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Kết quả</h2>
        <button
          onClick={onNew}
          className="text-sm text-blue-600 hover:underline"
        >
          + Tạo mới
        </button>
      </div>

      {isPending && (
        <div className="flex items-center gap-3 py-8 justify-center">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Đang tạo nội dung...</span>
        </div>
      )}

      {result.status === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-700 mb-1">Lỗi</p>
          <p className="text-sm text-red-600">{result.errorMessage ?? "Lỗi không xác định"}</p>
        </div>
      )}

      {result.status === "done" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
            {result.outputTokens != null && (
              <span>Tokens: <strong>{result.outputTokens}</strong></span>
            )}
            {result.totalCost != null && (
              <span>Cost: <strong className="text-amber-600">${result.totalCost.toFixed(5)}</strong></span>
            )}
            {result.generationTime != null && (
              <span>Time: <strong>{(result.generationTime / 1000).toFixed(1)}s</strong></span>
            )}
          </div>

          <div className="relative">
            <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm whitespace-pre-wrap overflow-auto max-h-[500px] font-mono">
              {result.output}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(result.output ?? "")}
              className="absolute top-2 right-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
