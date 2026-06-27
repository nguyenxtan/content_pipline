"use client";

import { useEffect, useState, useTransition } from "react";
import {
  BarChart2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { fmtVnd, DEFAULT_AIMAX_VND_PER_POINT } from "@/lib/cost/cost-constants";
import {
  getAiMaxUsageSummaryAction,
  getAiMaxUsageRequestDetailAction,
  listAiMaxUsageRequestsAction,
  type AiMaxUsageFilter,
  type AiMaxUsageRow,
  type AiMaxUsageSummary,
} from "@/actions/aimax-usage";

type SummaryResult = { ok: true; data: AiMaxUsageSummary } | { ok: false; error: string };
type ListResult = { ok: true; rows: AiMaxUsageRow[]; total: number } | { ok: false; error: string };

type Props = {
  initialSummary: SummaryResult;
  initialList: ListResult;
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: "rose" | "emerald" | "amber" | "slate";
}) {
  const colors = {
    rose: "text-rose-400 bg-rose-500/10",
    emerald: "text-emerald-400 bg-emerald-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    slate: "text-slate-400 bg-slate-700/40",
  };
  const cls = colors[accent ?? "slate"];
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-4">
      <div className="flex items-center gap-3">
        <div className={`rounded-lg p-2 ${cls}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-xl font-bold text-slate-100">{value}</p>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function fmtCredits(v: number | null) {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtChars(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    cached: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    failed: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    cancelled: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    processing: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    pending: "bg-slate-700/40 text-slate-400 border-slate-700",
  };
  const cls = map[status] ?? "bg-slate-700/40 text-slate-400 border-slate-700";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return <span className="text-slate-600">—</span>;
  const map: Record<string, string> = {
    api: "text-emerald-400",
    cache: "text-blue-400",
    estimated: "text-amber-400",
    unknown: "text-slate-500",
  };
  return <span className={map[source] ?? "text-slate-400"}>{source}</span>;
}

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getAiMaxUsageRequestDetailAction>> | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAiMaxUsageRequestDetailAction(id).then((r) => { if (!cancelled) setData(r); });
    return () => { cancelled = true; };
  }, [id]);

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (!data.ok) {
    return <p className="text-rose-400 text-sm py-4">{data.error}</p>;
  }

  const row = data.row;
  const fields: [string, string | number | boolean | null | undefined][] = [
    ["ID", row.id],
    ["External Job ID", row.externalJobId],
    ["Pipeline Route", row.pipelineRoute],
    ["Content ID", row.contentId],
    ["Voice ID", row.voiceId],
    ["Voice Label", row.voiceLabel],
    ["Voice Family", row.voiceFamily],
    ["Status", row.status],
    ["Cache Hit", row.cacheHit != null ? String(row.cacheHit) : null],
    ["Usage Source", row.usageSource],
    ["Credit Used", row.creditUsed],
    ["Estimated Credits", row.estimatedCredits],
    ["Char Count", row.textCharCount],
    ["Duration (ms)", row.durationMs],
    ["Speed", row.speed],
    ["Pitch", row.pitch],
    ["Text Hash", row.textHash],
    ["Cache Identity", row.cacheIdentity ? row.cacheIdentity.slice(0, 32) + "…" : null],
    ["Error", row.errorMessage],
    ["Started At", row.startedAt?.toISOString() ?? null],
    ["Completed At", row.completedAt?.toISOString() ?? null],
    ["Created At", row.createdAt.toISOString()],
    ["Niche", row.nicheName],
    ["Format Type", row.formatType],
    ["Content Profile Key", row.contentProfileKey],
    ["Audio URL", row.audioUrl],
    ["SRT URL", row.srtUrl],
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200">Request Detail</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">✕ Close</button>
      </div>
      <div className="space-y-1">
        {fields.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-xs">
            <span className="w-40 shrink-0 text-slate-500">{k}</span>
            <span className="text-slate-300 break-all">{v != null && v !== "" ? String(v) : <span className="text-slate-600">—</span>}</span>
          </div>
        ))}
      </div>
      {!!row.rawJson && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Raw API response
          </button>
          {expanded && (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-900 p-3 text-[10px] text-slate-400">
              {JSON.stringify(row.rawJson, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function AiMaxUsageClient({ initialSummary, initialList }: Props) {
  const [summary, setSummary] = useState<SummaryResult>(initialSummary);
  const [list, setList] = useState<ListResult>(initialList);
  const [filter, setFilter] = useState<AiMaxUsageFilter>({ limit: 50, offset: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pipelineRoute, setPipelineRoute] = useState("");
  const [status, setStatus] = useState("");
  const [voiceFamily, setVoiceFamily] = useState("");
  const [cacheHitFilter, setCacheHitFilter] = useState<"" | "true" | "false">("");
  const [usageSource, setUsageSource] = useState("");

  function applyFilter() {
    const f: AiMaxUsageFilter = {
      limit: 50,
      offset: 0,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      pipelineRoute: pipelineRoute || null,
      status: status || null,
      voiceFamily: voiceFamily || null,
      cacheHit: cacheHitFilter === "" ? null : cacheHitFilter === "true",
      usageSource: usageSource || null,
    };
    setFilter(f);
    setSelectedId(null);
    startTransition(async () => {
      const [s, l] = await Promise.all([
        getAiMaxUsageSummaryAction(f),
        listAiMaxUsageRequestsAction(f),
      ]);
      setSummary(s);
      setList(l);
    });
  }

  function loadPage(offset: number) {
    const f = { ...filter, offset };
    setFilter(f);
    startTransition(async () => {
      const l = await listAiMaxUsageRequestsAction(f);
      setList(l);
    });
  }

  const rows = list.ok ? list.rows : [];
  const total = list.ok ? list.total : 0;
  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 50;
  const pageCount = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-rose-400" />
            AiMax TTS Usage
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Per-request credits, cache hits, and pipeline breakdown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/costs"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200"
          >
            Chi phí / video →
          </Link>
          <button
            onClick={applyFilter}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary.ok ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard icon={Database} label="Total Requests" value={summary.data.totalRequests} accent="slate" />
          <StatCard icon={Zap} label="Network Calls" value={summary.data.networkRequests} sub="non-cached" accent="rose" />
          <StatCard icon={CheckCircle2} label="Cache Hits" value={summary.data.cacheHits} accent="emerald" />
          <StatCard icon={XCircle} label="Failed" value={summary.data.failedRequests} accent="amber" />
          <StatCard
            icon={FileText}
            label="Total Chars"
            value={fmtChars(summary.data.totalChars)}
            accent="slate"
          />
          <StatCard
            icon={Zap}
            label={summary.data.totalCredits != null ? "Credits Used" : "Est. Credits"}
            value={fmtCredits(summary.data.totalCredits ?? summary.data.totalEstimatedCredits)}
            sub={summary.data.totalCredits != null ? "from API" : summary.data.totalEstimatedCredits != null ? "estimated" : undefined}
            accent="rose"
          />
          <StatCard
            icon={Zap}
            label="Chi phí VND"
            value={fmtVnd((summary.data.totalCredits ?? summary.data.totalEstimatedCredits ?? 0) * DEFAULT_AIMAX_VND_PER_POINT)}
            sub={`${DEFAULT_AIMAX_VND_PER_POINT} ₫/point`}
            accent="amber"
          />
          <StatCard
            icon={Clock}
            label="Total Duration"
            value={fmtDuration(summary.data.totalDurationMs)}
            accent="slate"
          />
          <StatCard
            icon={Clock}
            label="Avg Duration"
            value={summary.data.avgDurationMs != null ? fmtDuration(summary.data.avgDurationMs) : "—"}
            accent="slate"
          />
        </div>
      ) : (
        <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
          {summary.error}
        </div>
      )}

      {/* Breakdowns */}
      {summary.ok && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">By Pipeline Route</p>
            <div className="space-y-1">
              {summary.data.byPipelineRoute.slice(0, 8).map((r) => (
                <div key={r.route} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-slate-300">{r.route}</span>
                  <span className="shrink-0 text-slate-400">{r.count} · {fmtChars(r.chars)}c</span>
                </div>
              ))}
              {summary.data.byPipelineRoute.length === 0 && <p className="text-xs text-slate-600">No data</p>}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">By Voice Family</p>
            <div className="space-y-1">
              {summary.data.byVoiceFamily.slice(0, 8).map((r) => (
                <div key={r.family} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-slate-300">{r.family}</span>
                  <span className="shrink-0 text-slate-400">{r.count} · {fmtChars(r.chars)}c</span>
                </div>
              ))}
              {summary.data.byVoiceFamily.length === 0 && <p className="text-xs text-slate-600">No data</p>}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">By Status</p>
            <div className="space-y-1">
              {summary.data.byStatus.map((r) => (
                <div key={r.status} className="flex items-center justify-between gap-2 text-xs">
                  <StatusBadge status={r.status} />
                  <span className="text-slate-400">{r.count}</span>
                </div>
              ))}
              {summary.data.byStatus.length === 0 && <p className="text-xs text-slate-600">No data</p>}
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Filter className="h-3 w-3" /> Filters
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600"
          />
          <input
            value={pipelineRoute}
            onChange={(e) => setPipelineRoute(e.target.value)}
            placeholder="Pipeline route"
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300"
          >
            <option value="">All statuses</option>
            <option value="completed">completed</option>
            <option value="cached">cached</option>
            <option value="failed">failed</option>
            <option value="processing">processing</option>
            <option value="pending">pending</option>
            <option value="cancelled">cancelled</option>
          </select>
          <input
            value={voiceFamily}
            onChange={(e) => setVoiceFamily(e.target.value)}
            placeholder="Voice family"
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600"
          />
          <select
            value={cacheHitFilter}
            onChange={(e) => setCacheHitFilter(e.target.value as "" | "true" | "false")}
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300"
          >
            <option value="">All (cache)</option>
            <option value="true">Cache hits only</option>
            <option value="false">Network only</option>
          </select>
          <select
            value={usageSource}
            onChange={(e) => setUsageSource(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300"
          >
            <option value="">All sources</option>
            <option value="api">api</option>
            <option value="cache">cache</option>
            <option value="estimated">estimated</option>
            <option value="unknown">unknown</option>
          </select>
          <button
            onClick={applyFilter}
            disabled={isPending}
            className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Table + detail */}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {!list.ok ? (
            <div className="rounded-xl border border-rose-800/40 bg-rose-950/20 px-4 py-3 text-sm text-rose-300">
              {list.error}
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-slate-500">{total} records</p>
                {pageCount > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      disabled={currentPage === 0 || isPending}
                      onClick={() => loadPage(Math.max(0, offset - limit))}
                      className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30"
                    >
                      ← Prev
                    </button>
                    <span className="text-xs text-slate-500">{currentPage + 1} / {pageCount}</span>
                    <button
                      disabled={currentPage >= pageCount - 1 || isPending}
                      onClick={() => loadPage(offset + limit)}
                      className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/80">
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Route</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Voice</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Status</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-500">Chars</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-500">Credits</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-500">VND</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Source</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Duration</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-slate-600">No records</td>
                      </tr>
                    )}
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}
                        className={`cursor-pointer border-b border-slate-800/50 transition-colors hover:bg-slate-900/60 ${selectedId === row.id ? "bg-rose-500/5" : ""}`}
                      >
                        <td className="px-3 py-2 text-slate-300">{row.pipelineRoute ?? <span className="text-slate-600">—</span>}</td>
                        <td className="px-3 py-2 text-slate-300">
                          <span title={row.voiceId ?? undefined}>{row.voiceLabel ?? row.voiceId ?? <span className="text-slate-600">—</span>}</span>
                        </td>
                        <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                        <td className="px-3 py-2 text-right text-slate-400">{row.textCharCount != null ? row.textCharCount.toLocaleString() : "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-400">
                          {row.creditUsed != null ? row.creditUsed : row.estimatedCredits != null ? <span className="text-amber-500/70">{row.estimatedCredits}~</span> : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-amber-400/80">
                          {(row.creditUsed != null || row.estimatedCredits != null)
                            ? fmtVnd(Number(row.creditUsed ?? row.estimatedCredits) * DEFAULT_AIMAX_VND_PER_POINT)
                            : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="px-3 py-2"><SourceBadge source={row.usageSource} /></td>
                        <td className="px-3 py-2 text-slate-400">{row.durationMs != null ? fmtDuration(row.durationMs) : "—"}</td>
                        <td className="px-3 py-2 text-slate-500">{row.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {selectedId && (
          <div className="w-80 shrink-0 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <DetailPanel id={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
