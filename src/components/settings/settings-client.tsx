"use client";

import { useState } from "react";
import type { AIModel, ModelProvider } from "@/lib/ai-models";
import { PROVIDER_META } from "@/lib/ai-models";
import type { UsageSummary } from "@/actions/ai-usage";
import { getPurposeLabel } from "@/lib/purpose-labels";

interface Props {
  usage: UsageSummary;
  models: AIModel[];
  providerMeta: typeof PROVIDER_META;
}

type Tab = "models" | "usage";

export function SettingsClient({ usage, models, providerMeta }: Props) {
  const [tab, setTab] = useState<Tab>("usage");

  const providers = (Object.keys(providerMeta) as ModelProvider[]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Cài đặt</h1>
        <p className="text-slate-400 text-sm mt-1">Quản lý model AI và theo dõi chi phí sử dụng</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700">
        {(["usage", "models"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-rose-500 text-rose-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t === "usage" ? "Thống kê sử dụng" : "Danh sách model"}
          </button>
        ))}
      </div>

      {/* Usage Tab */}
      {tab === "usage" && <UsageTab usage={usage} />}

      {/* Models Tab */}
      {tab === "models" && (
        <ModelsTab models={models} providers={providers} providerMeta={providerMeta} />
      )}
    </div>
  );
}

/* ─── Usage Tab ─────────────────────────────────────────── */

function UsageTab({ usage }: { usage: UsageSummary }) {
  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Tổng chi phí (30 ngày)" value={`$${usage.totalCostUsd.toFixed(4)}`} sub="USD" accent />
        <KpiCard label="Tổng lần gọi" value={usage.totalCalls.toLocaleString()} sub="API calls" />
        <KpiCard label="Input tokens" value={fmtTokens(usage.totalInputTokens)} sub="tokens" />
        <KpiCard label="Output tokens" value={fmtTokens(usage.totalOutputTokens)} sub="tokens" />
      </div>

      {/* By model + By purpose side by side */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* By model */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <h3 className="text-sm font-semibold text-slate-200">Theo model</h3>
          </div>
          <div className="divide-y divide-slate-700/50">
            {usage.byModel.length === 0 && (
              <p className="px-4 py-6 text-center text-slate-500 text-sm">Chưa có dữ liệu</p>
            )}
            {usage.byModel.map((m) => {
              const meta = PROVIDER_META[m.provider as ModelProvider];
              return (
                <div key={m.model} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-mono truncate ${meta?.color ?? "text-slate-300"}`}>
                      {m.model.split("/").pop()}
                    </p>
                    <p className="text-xs text-slate-500">{m.calls} calls · {fmtTokens(m.inputTokens + m.outputTokens)} tokens</p>
                  </div>
                  <span className="text-sm font-medium text-slate-200 shrink-0">
                    ${m.costUsd.toFixed(4)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* By purpose */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <h3 className="text-sm font-semibold text-slate-200">Theo mục đích</h3>
          </div>
          <div className="divide-y divide-slate-700/50">
            {usage.byPurpose.length === 0 && (
              <p className="px-4 py-6 text-center text-slate-500 text-sm">Chưa có dữ liệu</p>
            )}
            {usage.byPurpose.map((p) => (
              <div key={p.purpose} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200">{getPurposeLabel(p.purpose)}</p>
                  <p className="text-xs text-slate-500">{p.calls} calls</p>
                </div>
                <span className="text-sm font-medium text-slate-200 shrink-0">
                  ${p.costUsd.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent logs table */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700">
          <h3 className="text-sm font-semibold text-slate-200">50 lần gọi gần nhất</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80">
                {["Thời gian", "Model", "Mục đích", "Input", "Output", "Chi phí"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-slate-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {usage.recentLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">Chưa có log nào</td>
                </tr>
              )}
              {usage.recentLogs.map((log) => {
                const meta = PROVIDER_META[log.provider as ModelProvider];
                return (
                  <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString("vi-VN", {
                        month: "2-digit", day: "2-digit",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </td>
                    <td className={`px-3 py-2 font-mono whitespace-nowrap ${meta?.color ?? "text-slate-300"}`}>
                      {log.model.split("/").pop()}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{getPurposeLabel(log.purpose)}</td>
                    <td className="px-3 py-2 text-slate-400 text-right">{log.inputTokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-400 text-right">{log.outputTokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-200 text-right font-medium">
                      ${log.costUsd.toFixed(5)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Models Tab ─────────────────────────────────────────── */

function ModelsTab({
  models,
  providers,
  providerMeta,
}: {
  models: AIModel[];
  providers: ModelProvider[];
  providerMeta: typeof PROVIDER_META;
}) {
  const [search, setSearch] = useState("");
  const q = search.toLowerCase();

  return (
    <div className="space-y-5">
      {/* Search */}
      <input
        type="text"
        placeholder="Tìm model..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500"
      />

      {providers.map((provider) => {
        const meta = providerMeta[provider];
        const providerModels = models.filter(
          (m) =>
            m.provider === provider &&
            (!q ||
              m.name.toLowerCase().includes(q) ||
              m.id.toLowerCase().includes(q) ||
              (m.description ?? "").toLowerCase().includes(q))
        );
        if (providerModels.length === 0) return null;

        return (
          <div
            key={provider}
            className={`rounded-xl border overflow-hidden ${meta.border} ${meta.bg}`}
          >
            {/* Provider header */}
            <div className="px-4 py-3 border-b border-slate-700/50">
              <h3 className={`text-sm font-semibold ${meta.color}`}>{meta.label}</h3>
            </div>

            {/* Model grid */}
            <div className="divide-y divide-slate-700/30">
              {providerModels.map((m) => (
                <ModelRow key={m.id} model={m} color={meta.color} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModelRow({ model: m, color }: { model: AIModel; color: string }) {
  return (
    <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
      {/* Name + tags */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${color}`}>{m.name}</span>
          {(m.tags ?? []).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-medium uppercase tracking-wide"
            >
              {tag}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-500 font-mono mt-0.5">{m.id}</p>
        {m.description && (
          <p className="text-xs text-slate-400 mt-1">{m.description}</p>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-xs text-slate-400 sm:text-right shrink-0">
        <div>
          <p className="text-slate-500">Context</p>
          <p className="text-slate-200 font-medium">{m.contextK}K</p>
        </div>
        <div>
          <p className="text-slate-500">Input / 1M</p>
          <p className="text-slate-200 font-medium">${m.inputPer1M.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-slate-500">Output / 1M</p>
          <p className="text-slate-200 font-medium">${m.outputPer1M.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-slate-500">Ra mắt</p>
          <p className="text-slate-200 font-medium">{m.releaseDate}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── KPI Card ───────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-rose-400" : "text-slate-100"}`}>
        {value}
      </p>
      <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────── */

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
