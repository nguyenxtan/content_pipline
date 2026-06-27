"use client";

import { useEffect, useState, useTransition } from "react";
import {
  BarChart2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Filter,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  Mic2,
  RefreshCw,
  Sparkles,
  Tag,
  Zap,
} from "lucide-react";
import Link from "next/link";
import {
  getCostDashboardSummaryAction,
  getVideoCostDetailAction,
  listVideoCostBreakdownAction,
  type CostDashboardFilter,
  type CostEventDetail,
  type CostSummary,
  type VideoCostRow,
} from "@/actions/cost-dashboard";
import { fmtVnd } from "@/lib/cost/cost-constants";

type SummaryResult = { ok: true; data: CostSummary } | { ok: false; error: string };
type ListResult = { ok: true; rows: VideoCostRow[]; total: number } | { ok: false; error: string };

type Props = {
  initialSummary: SummaryResult;
  initialList: ListResult;
};

// ─── Stat card ────────────────────────────────────────────────────────────────

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
  accent?: "rose" | "emerald" | "amber" | "blue" | "slate";
}) {
  const cls = {
    rose: "text-rose-400 bg-rose-500/10",
    emerald: "text-emerald-400 bg-emerald-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    blue: "text-blue-400 bg-blue-500/10",
    slate: "text-slate-400 bg-slate-700/40",
  }[accent ?? "slate"];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-4">
      <div className="flex items-center gap-3">
        <div className={`rounded-lg p-2 ${cls}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-500">{label}</p>
          <p className="text-xl font-bold text-slate-100">{value}</p>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Cost source badge ────────────────────────────────────────────────────────

function CostSourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    configured_rate: "text-emerald-400",
    api: "text-emerald-400",
    cache: "text-blue-400",
    estimated: "text-amber-400",
    unknown: "text-slate-500",
    manual: "text-purple-400",
  };
  return <span className={`text-[10px] font-medium ${map[source] ?? "text-slate-400"}`}>{source}</span>;
}

// ─── Cost type icon ───────────────────────────────────────────────────────────

function CostTypeIcon({ type }: { type: string }) {
  if (type === "tts") return <Mic2 className="h-3.5 w-3.5 text-rose-400" />;
  if (type === "image" || type === "image_prompt") return <ImageIcon className="h-3.5 w-3.5 text-blue-400" />;
  if (["script", "hook", "topic", "llm"].includes(type)) return <Sparkles className="h-3.5 w-3.5 text-amber-400" />;
  return <Zap className="h-3.5 w-3.5 text-slate-400" />;
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function DetailDrawer({ contentId, topic, onClose }: { contentId: string; topic: string | null; onClose: () => void }) {
  const [events, setEvents] = useState<CostEventDetail[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVideoCostDetailAction(contentId).then((r) => { if (!cancelled && r.ok) setEvents(r.events); });
    return () => { cancelled = true; };
  }, [contentId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Cost Detail</h3>
          {topic && <p className="text-xs text-slate-500 truncate max-w-[220px]">{topic}</p>}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">✕</button>
      </div>

      {!events ? (
        <div className="flex items-center gap-2 py-6 justify-center text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : events.length === 0 ? (
        <p className="text-xs text-slate-600 py-4">No cost events for this content.</p>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => (
            <div key={ev.id} className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <CostTypeIcon type={ev.costType} />
                  <span className="text-xs font-medium text-slate-300">{ev.costType}</span>
                  <span className="text-xs text-slate-500">· {ev.provider}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CostSourceBadge source={ev.costSource} />
                  <span className={`text-xs font-semibold ${ev.costVnd != null ? "text-slate-200" : "text-slate-600"}`}>
                    {ev.costVnd != null ? fmtVnd(Number(ev.costVnd)) : "unknown"}
                  </span>
                </div>
              </div>
              {ev.usageAmount && (
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {ev.usageAmount} {ev.usageUnit}
                  {ev.unitCostVnd ? ` × ${ev.unitCostVnd} ₫` : ""}
                </p>
              )}
              {ev.metadata && (
                <button
                  onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                  className="mt-1 flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400"
                >
                  {expanded === ev.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  metadata
                </button>
              )}
              {expanded === ev.id && (
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-950 p-2 text-[9px] text-slate-400">
                  {JSON.stringify(ev.metadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main client ──────────────────────────────────────────────────────────────

export function CostDashboardClient({ initialSummary, initialList }: Props) {
  const [summary, setSummary] = useState<SummaryResult>(initialSummary);
  const [list, setList] = useState<ListResult>(initialList);
  const [filter, setFilter] = useState<CostDashboardFilter>({ limit: 50, offset: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [nicheName, setNicheName] = useState("");
  const [pipelineRoute, setPipelineRoute] = useState("");
  const [provider, setProvider] = useState("");
  const [costType, setCostType] = useState("");

  function applyFilter() {
    const f: CostDashboardFilter = {
      limit: 50, offset: 0,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      nicheName: nicheName || null,
      pipelineRoute: pipelineRoute || null,
      provider: provider || null,
      costType: costType || null,
    };
    setFilter(f);
    setSelectedId(null);
    startTransition(async () => {
      const [s, l] = await Promise.all([
        getCostDashboardSummaryAction(f),
        listVideoCostBreakdownAction(f),
      ]);
      setSummary(s);
      setList(l);
    });
  }

  function loadPage(offset: number) {
    const f = { ...filter, offset };
    setFilter(f);
    startTransition(async () => {
      setList(await listVideoCostBreakdownAction(f));
    });
  }

  const s = summary.ok ? summary.data : null;
  const rows = list.ok ? list.rows : [];
  const total = list.ok ? list.total : 0;
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const pageCount = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <CircleDollarSign className="h-6 w-6 text-rose-400" />
            Chi phí sản xuất
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            TTS · Image · Script — tổng chi phí theo video
          </p>
        </div>
        <div className="flex items-center gap-2">
          {s && (
            <span className="text-xs text-slate-500">
              {s.aimaxVndPerPoint} ₫/point
            </span>
          )}
          <button
            onClick={applyFilter}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:border-slate-600 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
          <Link
            href="/settings/tts/aimax/usage"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200"
          >
            AiMax Usage →
          </Link>
        </div>
      </div>

      {/* Error state */}
      {!summary.ok && (
        <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
          {summary.error}
        </div>
      )}

      {/* Summary cards */}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard icon={CircleDollarSign} label="Tổng chi phí (biết)" value={fmtVnd(s.knownCostVnd)} accent="rose" />
          <StatCard icon={Tag} label="Trung bình / video" value={s.averageCostPerVideo != null ? fmtVnd(s.averageCostPerVideo) : "—"} accent="amber" />
          <StatCard icon={Mic2} label="Chi phí TTS" value={fmtVnd(s.ttsCostVnd)} sub="AiMax" accent="rose" />
          <StatCard icon={ImageIcon} label="Chi phí ảnh" value={fmtVnd(s.imageCostVnd)} sub="Fal.ai" accent="blue" />
          <StatCard icon={Sparkles} label="Chi phí script/LLM" value={fmtVnd(s.contentCostVnd)} sub="OpenRouter" accent="amber" />
          <StatCard icon={Zap} label="Cache savings" value={fmtVnd(s.cacheSavingsVnd)} sub={`${s.cachedCostEventCount} hits`} accent="emerald" />
          <StatCard icon={HelpCircle} label="Unknown events" value={s.unknownCostEventCount} accent="slate" />
          <StatCard icon={BarChart2} label="Videos tracked" value={s.totalVideosWithCost} accent="slate" />
        </div>
      )}

      {/* Breakdowns */}
      {s && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "By Provider", data: s.byProvider.map((r) => ({ label: r.provider, vnd: r.totalVnd, count: r.eventCount })) },
            { title: "By Cost Type", data: s.byCostType.map((r) => ({ label: r.costType, vnd: r.totalVnd, count: r.eventCount })) },
            { title: "By Niche", data: s.byNiche.slice(0, 6).map((r) => ({ label: r.niche, vnd: r.totalVnd, count: r.eventCount })) },
            { title: "By Route", data: s.byPipelineRoute.slice(0, 6).map((r) => ({ label: r.route, vnd: r.totalVnd, count: r.eventCount })) },
          ].map(({ title, data }) => (
            <div key={title} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
              <div className="space-y-1">
                {data.length === 0 && <p className="text-xs text-slate-600">No data</p>}
                {data.map((d) => (
                  <div key={d.label} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-slate-300">{d.label}</span>
                    <span className="shrink-0 text-slate-400">{fmtVnd(d.vnd)} · {d.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Filter className="h-3 w-3" /> Lọc
        </p>
        <div className="flex flex-wrap gap-2">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300" />
          <input value={nicheName} onChange={(e) => setNicheName(e.target.value)} placeholder="Niche"
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600" />
          <input value={pipelineRoute} onChange={(e) => setPipelineRoute(e.target.value)} placeholder="Route"
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600" />
          <select value={provider} onChange={(e) => setProvider(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300">
            <option value="">All providers</option>
            <option value="aimax">aimax</option>
            <option value="fal">fal</option>
            <option value="openrouter">openrouter</option>
          </select>
          <select value={costType} onChange={(e) => setCostType(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300">
            <option value="">All types</option>
            <option value="tts">tts</option>
            <option value="image">image</option>
            <option value="image_prompt">image_prompt</option>
            <option value="script">script</option>
            <option value="hook">hook</option>
          </select>
          <button onClick={applyFilter} disabled={isPending}
            className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 disabled:opacity-50">
            Áp dụng
          </button>
        </div>
      </div>

      {/* Per-video table + detail */}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {!list.ok ? (
            <div className="rounded-xl border border-rose-800/40 bg-rose-950/20 px-4 py-3 text-sm text-rose-300">{list.error}</div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-slate-500">{total} videos với cost events</p>
                {pageCount > 1 && (
                  <div className="flex items-center gap-1">
                    <button disabled={currentPage === 0 || isPending} onClick={() => loadPage(Math.max(0, offset - limit))}
                      className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30">← Prev</button>
                    <span className="text-xs text-slate-500">{currentPage + 1}/{pageCount}</span>
                    <button disabled={currentPage >= pageCount - 1 || isPending} onClick={() => loadPage(offset + limit)}
                      className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30">Next →</button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/80">
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Ngày</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Nội dung</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Niche</th>
                      <th className="px-3 py-2.5 text-left font-medium text-slate-500">Route</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-500">Tổng</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-500">TTS</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-500">Ảnh</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-500">Script</th>
                      <th className="px-3 py-2.5 text-right font-medium text-slate-500">?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-600">Không có dữ liệu</td></tr>
                    )}
                    {rows.map((row) => (
                      <tr
                        key={row.contentId}
                        onClick={() => { setSelectedId(selectedId === row.contentId ? null : row.contentId); setSelectedTopic(row.topic); }}
                        className={`cursor-pointer border-b border-slate-800/50 transition-colors hover:bg-slate-900/60 ${selectedId === row.contentId ? "bg-rose-500/5" : ""}`}
                      >
                        <td className="px-3 py-2 text-slate-500">{row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 10) : "—"}</td>
                        <td className="px-3 py-2 text-slate-300 max-w-[200px] truncate">{row.topic ?? <span className="text-slate-600">{row.contentId.slice(0, 8)}…</span>}</td>
                        <td className="px-3 py-2 text-slate-400">{row.nicheName ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-400">{row.pipelineRoute ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-200">{fmtVnd(row.totalCostVnd)}</td>
                        <td className="px-3 py-2 text-right text-rose-400">{row.ttsCostVnd > 0 ? fmtVnd(row.ttsCostVnd) : <span className="text-slate-700">—</span>}</td>
                        <td className="px-3 py-2 text-right text-blue-400">
                          {row.imageCostVnd > 0
                            ? fmtVnd(row.imageCostVnd)
                            : row.imageEventCount > 0
                              ? <span className="text-slate-500 text-[10px]">unknown</span>
                              : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-amber-400">
                          {row.contentCostVnd > 0
                            ? fmtVnd(row.contentCostVnd)
                            : row.scriptEventCount > 0
                              ? <span className="text-slate-500 text-[10px]">unknown</span>
                              : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">{row.unknownCostCount > 0 ? row.unknownCostCount : <span className="text-slate-700">0</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {selectedId && (
          <div className="w-80 shrink-0 rounded-xl border border-slate-800 bg-slate-950/60 p-4 overflow-y-auto max-h-[600px]">
            <DetailDrawer contentId={selectedId} topic={selectedTopic} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
