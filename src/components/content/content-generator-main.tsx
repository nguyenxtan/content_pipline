"use client";

import { useState, useEffect } from "react";
import {
  Zap, Loader2, Copy, Check, Maximize2, X,
  FileVideo, FileText, Timer, BarChart2, DollarSign, RefreshCw,
  SlidersHorizontal, Sparkles, ChevronUp, History, ChevronDown,
} from "lucide-react";
import type { Niche } from "@/lib/db/schema";
import type { GeneratedContentResult } from "@/lib/validations/content-generator";
import { generateContentAction, suggestTopicsAction, getRecentTopicsAction } from "@/actions/content-generator";
import { PromptEditModal } from "./prompt-edit-modal";
import { ModelDropdown } from "@/components/ui/model-dropdown";

// ─── Copy button ───────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="flex items-center gap-1.5 rounded-md border border-slate-600 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Full-screen modal ──────────────────────────────────────────────────────
function FullModal({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="flex w-full max-w-4xl flex-col rounded-xl border border-slate-700 bg-slate-900 max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <h3 className="font-semibold text-slate-100">{title}</h3>
          <div className="flex items-center gap-2">
            <CopyBtn text={content} />
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <pre className="flex-1 overflow-auto p-5 text-sm text-slate-200 whitespace-pre-wrap font-mono leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
}

// ─── Content card ──────────────────────────────────────────────────────────
function ContentCard({
  title, icon: Icon, content, wordCount, accent,
}: {
  title: string; icon: typeof FileVideo; content: string; wordCount: number; accent: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const estimatedMins = Math.round(wordCount / 135);
  const preview = content.replace(/#+\s*/g, "").replace(/\*+/g, "").replace(/\n+/g, " ").trim().slice(0, 300);

  return (
    <>
      {expanded && <FullModal title={title} content={content} onClose={() => setExpanded(false)} />}
      <div className="flex flex-col rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
        <div className={`h-1 ${accent}`} />
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-semibold text-slate-200">{title}</span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
              {wordCount.toLocaleString()} từ · ~{estimatedMins}p
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CopyBtn text={content} />
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center justify-center rounded-md border border-slate-600 p-1.5 text-slate-400 hover:bg-slate-700 transition-colors"
              title="Xem toàn màn hình"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 p-4">
          <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-wrap font-mono">
            {preview}
            {content.length > 300 && (
              <button onClick={() => setExpanded(true)} className="text-rose-400 hover:text-rose-300 ml-1">
                ...xem thêm
              </button>
            )}
          </p>
        </div>
      </div>
    </>
  );
}

// ─── Topic panel (chỉ phần nội dung, render bên ngoài label row) ──────────
function TopicPanel({
  nicheId,
  model,
  onModelChange,
  onSelect,
  onClose,
}: {
  nicheId: number;
  model: string;
  onModelChange: (m: string) => void;
  onSelect: (t: string) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [topics, setTopics]   = useState<string[]>([]);
  const [error, setError]     = useState("");

  async function fetchTopics(m = model) {
    setLoading(true);
    setError("");
    setTopics([]);
    const res = await suggestTopicsAction(nicheId, m);
    setLoading(false);
    if ("error" in res) setError(res.error);
    else setTopics(res.topics);
  }

  // Load on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchTopics(); }, []);

  function handleModelChange(m: string) {
    onModelChange(m);
    fetchTopics(m);
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
        <Sparkles className="h-3.5 w-3.5 text-rose-400 shrink-0" />
        <span className="text-xs font-semibold text-slate-300 shrink-0">Gợi ý từ AI</span>
        <div className="flex-1 min-w-0">
          <ModelDropdown value={model} onChange={handleModelChange} size="sm" />
        </div>
        <button
          type="button"
          onClick={() => fetchTopics()}
          disabled={loading}
          title="Làm mới"
          className="shrink-0 flex items-center gap-1 rounded-md border border-slate-600 px-2.5 py-1.5 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Làm mới
        </button>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Topics */}
      <div className="p-3">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6">
            <Loader2 className="h-4 w-4 animate-spin text-rose-400" />
            <span className="text-xs text-slate-500">AI đang gợi ý chủ đề...</span>
          </div>
        )}
        {error && <p className="px-1 py-3 text-xs text-red-400">{error}</p>}
        {!loading && !error && topics.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {topics.map((t, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { onSelect(t); onClose(); }}
                className="group flex items-start gap-2.5 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-left hover:border-rose-500/50 hover:bg-rose-950/20 transition-all"
              >
                <span className="mt-0.5 shrink-0 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[10px] font-bold text-slate-400 group-hover:bg-rose-900/60 group-hover:text-rose-400 transition-colors">
                  {i + 1}
                </span>
                <span className="text-xs text-slate-300 leading-relaxed group-hover:text-slate-100 transition-colors">
                  {t}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Recent topics hint ─────────────────────────────────────────────────────
function RecentTopicsHint({ nicheId }: { nicheId: number }) {
  const [topics, setTopics]   = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (nicheId <= 0) { setTopics([]); return; }
    getRecentTopicsAction(nicheId, 14).then(setTopics).catch(() => {});
  }, [nicheId]);

  if (topics.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-900/30 bg-amber-950/10 text-xs">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-amber-400/80 hover:text-amber-300 transition-colors"
      >
        <History className="h-3 w-3 shrink-0" />
        <span className="font-medium">{topics.length} tiêu đề đã làm trong 14 ngày qua</span>
        <span className="text-amber-600 ml-1">(AI tự tránh trùng lặp)</span>
        {expanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && (
        <div className="border-t border-amber-900/20 px-3 pb-3 pt-2 space-y-1 max-h-40 overflow-y-auto">
          {topics.map((t, i) => (
            <p key={i} className="text-slate-500 leading-snug">
              <span className="text-amber-800 mr-1">{i + 1}.</span>{t}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────
interface Props {
  niches: Niche[];
  initialNicheId?: number;
}

export function ContentGeneratorMain({ niches, initialNicheId }: Props) {
  const [nicheId, setNicheId]       = useState<number>(initialNicheId ?? niches.find(n => n.isActive)?.id ?? 0);
  const [topic, setTopic]           = useState("");
  const [contentMode, setContentMode] = useState<"short" | "long" | "both">("both");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<GeneratedContentResult | null>(null);
  const [error, setError]           = useState("");
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showTopics, setShowTopics]     = useState(false);
  const [suggestModel, setSuggestModel] = useState("openai/gpt-4o-mini");

  const active = niches.filter(n => n.isActive);
  const canGenerate = nicheId > 0 && topic.trim().length >= 3 && !loading;
  const selectedNiche = niches.find(n => n.id === nicheId);

  const handleGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canGenerate) return;
    setLoading(true);
    setResult(null);
    setError("");
    const res = await generateContentAction(nicheId, topic.trim(), undefined, contentMode);
    if ("error" in res) setError(res.error);
    else { setResult(res); setTopic(""); }
    setLoading(false);
  };

  const shortWords = result ? result.shortContent.trim().split(/\s+/).length : 0;
  const longWords  = result ? result.longContent.trim().split(/\s+/).length  : 0;

  return (
    <div className="space-y-5">
      {showPromptEditor && selectedNiche && (
        <PromptEditModal
          nicheId={nicheId}
          nicheName={selectedNiche.name}
          onClose={() => setShowPromptEditor(false)}
        />
      )}

      {/* ─── Input form ─── */}
      <form onSubmit={handleGenerate} className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4">

        {/* Row 1: Lĩnh vực */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Lĩnh vực</label>
          <div className="flex gap-2">
            <select
              value={nicheId}
              onChange={e => { setNicheId(Number(e.target.value)); }}
              disabled={loading}
              className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
            >
              <option value={0} disabled>-- Chọn lĩnh vực --</option>
              {active.map(n => (
                <option key={n.id} value={n.id}>
                  {n.icon ? `${n.icon} ` : ""}{n.name}
                  {n.category ? ` · ${n.category}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => nicheId > 0 && setShowPromptEditor(true)}
              disabled={nicheId === 0 || loading}
              title="Chỉnh sửa prompt & model"
              className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Prompt
            </button>
          </div>
          {active.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-400">
              Chưa có lĩnh vực nào.{" "}
              <a href="/niches/new" className="underline hover:text-amber-300">Tạo lĩnh vực trước.</a>
            </p>
          )}
        </div>

        {/* Row 2: Chủ đề */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-400">Chủ đề video</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              disabled={loading}
              placeholder="Nhập chủ đề video..."
              maxLength={200}
              className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={nicheId === 0 || loading}
              onClick={() => setShowTopics(v => !v)}
              className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                showTopics
                  ? "border-rose-500/70 bg-rose-950/30 text-rose-400"
                  : "border-slate-600 text-slate-400 hover:border-slate-500 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {showTopics
                ? <><ChevronUp className="h-3.5 w-3.5" />Ẩn gợi ý</>
                : <><Sparkles className="h-3.5 w-3.5" />Gợi ý AI</>
              }
            </button>
          </div>
          {/* Recent topics dedup hint */}
          {nicheId > 0 && !showTopics && (
            <RecentTopicsHint nicheId={nicheId} />
          )}

          {/* Panel gợi ý — render sau input, không nằm trong label row */}
          {showTopics && nicheId > 0 && (
            <TopicPanel
              nicheId={nicheId}
              model={suggestModel}
              onModelChange={setSuggestModel}
              onSelect={setTopic}
              onClose={() => setShowTopics(false)}
            />
          )}
        </div>

        {/* Row 3: Content mode */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Loại nội dung</label>
          <div className="flex gap-1.5">
            {(["both", "short", "long"] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setContentMode(m)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  contentMode === m
                    ? "border-rose-500 bg-rose-600/20 text-rose-300"
                    : "border-slate-600 text-slate-400 hover:border-slate-500 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                {m === "both" ? "Cả hai" : m === "short" ? "Short only" : "Long only"}
              </button>
            ))}
          </div>
        </div>

        {/* Row 4: Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!canGenerate}
            className="shrink-0 flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Đang tạo...</>
              : <><Zap className="h-4 w-4" />Tạo ngay</>
            }
          </button>
        </div>
      </form>

      {/* ─── Loading ─── */}
      {loading && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-5 py-8 justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-rose-400" />
          <span className="text-sm text-slate-400">AI đang tạo nội dung...</span>
        </div>
      )}

      {/* ─── Error ─── */}
      {error && (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-4">
          <p className="text-sm font-medium text-red-400">Lỗi tạo nội dung</p>
          <p className="mt-1 text-sm text-red-500">{error}</p>
        </div>
      )}

      {/* ─── Results ─── */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Timer className="h-3.5 w-3.5" />
                {(result.generationTime / 1000).toFixed(1)}s
              </span>
              <span className="flex items-center gap-1">
                <BarChart2 className="h-3.5 w-3.5" />
                {result.totalTokens.toLocaleString()} tokens
              </span>
              <span className="flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" />
                {result.totalCost.toFixed(5)}
              </span>
            </div>
            <button
              onClick={() => setResult(null)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tạo mới
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ContentCard
              title="Short Script (60s)"
              icon={FileVideo}
              content={result.shortContent}
              wordCount={shortWords}
              accent="bg-gradient-to-r from-rose-500 to-pink-600"
            />
            <ContentCard
              title="Long Script (20 phút)"
              icon={FileText}
              content={result.longContent}
              wordCount={longWords}
              accent="bg-gradient-to-r from-rose-600 to-blue-600"
            />
          </div>

        </div>
      )}

    </div>
  );
}
