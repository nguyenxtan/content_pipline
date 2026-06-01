"use client";

import { useEffect, useState } from "react";
import { getPromptTestRuns } from "@/actions/prompts";
import type { UsageSummary, RunRecord } from "@/lib/llm/openrouter-usage";
import { RefreshCw } from "lucide-react";

interface UsagePanelProps {
  nicheId: number;
  stage: string;
  refreshKey: number;
}

export function UsagePanel({ nicheId, stage, refreshKey }: UsagePanelProps) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getPromptTestRuns(nicheId, stage)
      .then(({ runs, summary }) => {
        setRuns(runs);
        setSummary(summary);
      })
      .finally(() => setLoading(false));
  }, [nicheId, stage, refreshKey]);

  if (loading && runs.length === 0) {
    return (
      <div className="rounded-md border border-slate-700 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Đang tải...
        </div>
      </div>
    );
  }

  if (!summary || summary.totalRuns === 0) {
    return (
      <div className="rounded-md border border-slate-700 p-4 space-y-1">
        <h3 className="text-sm font-semibold text-slate-100">
          Usage History
        </h3>
        <p className="text-xs text-slate-400">
          Chưa có test run nào.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-700 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">
          Usage History
        </h3>
        {loading && (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" />
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Runs" value={summary.totalRuns.toString()} />
        <StatCard
          label="Total cost"
          value={`$${summary.totalCost.toFixed(4)}`}
          highlight
        />
        <StatCard
          label="Avg cost"
          value={
            summary.totalRuns > 0
              ? `$${(summary.totalCost / summary.totalRuns).toFixed(4)}`
              : "—"
          }
        />
        <StatCard
          label="Tokens"
          value={`${((summary.totalInputTokens + summary.totalOutputTokens) / 1000).toFixed(1)}k`}
        />
      </div>

      {/* Cost sparkline (last 14 runs) */}
      <CostSparkline runs={runs} />

      {/* Recent runs table */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-400">
          Recent runs
        </p>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {runs.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-800 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`shrink-0 h-1.5 w-1.5 rounded-full ${
                    r.status === "success" ? "bg-emerald-400" : "bg-red-400"
                  }`}
                />
                <span className="text-xs font-mono text-slate-400 truncate max-w-[90px]">
                  {r.model.split("/").pop()}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-amber-400 font-mono">
                  ${r.totalCost.toFixed(4)}
                </span>
                <span className="text-xs text-slate-400">
                  {r.inputTokens + r.outputTokens}tok
                </span>
                <span className="text-xs text-slate-400">
                  {formatTime(r.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p
        className={`text-sm font-semibold ${highlight ? "text-amber-400" : "text-slate-100"}`}
      >
        {value}
      </p>
    </div>
  );
}

function CostSparkline({ runs }: { runs: RunRecord[] }) {
  const recent = [...runs].reverse().slice(-14);
  if (recent.length < 2) return null;

  const maxCost = Math.max(...recent.map((r) => r.totalCost), 0.0001);

  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-400">
        Cost trend (last {recent.length} runs)
      </p>
      <div className="flex items-end gap-0.5 h-10">
        {recent.map((r) => (
          <div
            key={r.id}
            style={{ height: `${Math.max((r.totalCost / maxCost) * 100, 4)}%` }}
            title={`$${r.totalCost.toFixed(6)} · ${r.model.split("/").pop()}`}
            className={`flex-1 rounded-t transition-all ${
              r.status === "success"
                ? "bg-emerald-500/60 hover:bg-emerald-500/90"
                : "bg-red-500/60 hover:bg-red-500/90"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return d.toLocaleDateString("vi-VN", { month: "short", day: "numeric" });
}
