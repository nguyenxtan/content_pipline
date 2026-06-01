"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Zap, Brain, Eye, Sparkles } from "lucide-react";
import { AI_MODELS, PROVIDER_META, type ModelProvider } from "@/lib/ai-models";

/* ─── Provider icon/logo ─────────────────────────────────── */
function ProviderDot({ provider }: { provider: ModelProvider }) {
  const colors: Record<ModelProvider, string> = {
    openai:    "bg-green-400",
    google:    "bg-blue-400",
    anthropic: "bg-amber-400",
    deepseek:  "bg-violet-400",
  };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${colors[provider]}`} />;
}

/* ─── Tag chips ──────────────────────────────────────────── */
const TAG_META: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  latest:    { label: "Mới nhất", icon: <Sparkles className="w-2.5 h-2.5" />, cls: "bg-rose-900/60 text-rose-300 border-rose-700/40" },
  fast:      { label: "Nhanh",    icon: <Zap className="w-2.5 h-2.5" />,      cls: "bg-green-900/60 text-green-300 border-green-700/40" },
  reasoning: { label: "Reasoning",icon: <Brain className="w-2.5 h-2.5" />,    cls: "bg-violet-900/60 text-violet-300 border-violet-700/40" },
  vision:    { label: "Vision",   icon: <Eye className="w-2.5 h-2.5" />,      cls: "bg-blue-900/60 text-blue-300 border-blue-700/40" },
};

function Tag({ tag }: { tag: string }) {
  const meta = TAG_META[tag];
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 border rounded px-1 py-0.5 text-[9px] font-semibold leading-none ${meta.cls}`}>
      {meta.icon}{meta.label}
    </span>
  );
}

/* ─── Cost badge ─────────────────────────────────────────── */
function CostHint({ inputPer1M, outputPer1M }: { inputPer1M: number; outputPer1M: number }) {
  function fmt(n: number) {
    return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
  }
  return (
    <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap">
      {fmt(inputPer1M)} / {fmt(outputPer1M)}
    </span>
  );
}

/* ─── Main component ─────────────────────────────────────── */
interface ModelDropdownProps {
  value: string;
  onChange: (model: string) => void;
  /** Lọc chỉ show các provider cụ thể — nếu không truyền thì show tất cả */
  providers?: ModelProvider[];
  /** Lọc chỉ show model có tag này */
  filterTags?: string[];
  size?: "sm" | "md";
  label?: string;
  disabled?: boolean;
}

export function ModelDropdown({
  value,
  onChange,
  providers,
  filterTags,
  size = "md",
  label,
  disabled = false,
}: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Detect if there's enough room below; if not, open upward
  function handleToggle() {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 420);
    }
    setOpen((o) => !o);
  }

  const allProviders = (Object.keys(PROVIDER_META) as ModelProvider[]).filter(
    (p) => !providers || providers.includes(p)
  );

  const filteredModels = AI_MODELS.filter(
    (m) =>
      (!providers || providers.includes(m.provider)) &&
      (!filterTags || filterTags.some((t) => m.tags?.includes(t)))
  );

  const selected = AI_MODELS.find((m) => m.id === value) ?? null;
  const selectedMeta = selected ? PROVIDER_META[selected.provider] : null;

  const sm = size === "sm";

  return (
    <div className="relative" ref={ref}>
      {label && (
        <p className={`mb-1 font-medium text-slate-400 ${sm ? "text-[11px]" : "text-xs"}`}>
          {label}
        </p>
      )}

      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className={`group flex w-full items-center gap-2 rounded-lg border bg-slate-800/80 text-left transition-all
          ${open ? "border-rose-500/70 ring-1 ring-rose-500/20" : "border-slate-700 hover:border-slate-500"}
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
          ${sm ? "px-2.5 py-1.5" : "px-3 py-2"}
        `}
      >
        {selected ? (
          <>
            <ProviderDot provider={selected.provider} />
            <span className={`flex-1 font-medium truncate ${sm ? "text-xs" : "text-sm"} ${selectedMeta?.color ?? "text-slate-200"}`}>
              {selected.name}
            </span>
            <span className="hidden sm:flex items-center gap-1 shrink-0">
              {(selected.tags ?? []).slice(0, 2).map((t) => <Tag key={t} tag={t} />)}
            </span>
            <CostHint inputPer1M={selected.inputPer1M} outputPer1M={selected.outputPer1M} />
          </>
        ) : (
          <span className={`flex-1 text-slate-500 ${sm ? "text-xs" : "text-sm"}`}>Chọn model...</span>
        )}
        <ChevronDown
          className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""} ${sm ? "w-3 h-3" : "w-4 h-4"}`}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className={`absolute left-0 z-50 w-full min-w-[340px] max-w-[480px] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50 overflow-hidden ${openUp ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
          {/* Provider groups */}
          <div className="max-h-[380px] overflow-y-auto overscroll-contain">
            {allProviders.map((provider) => {
              const meta = PROVIDER_META[provider];
              const models = filteredModels.filter((m) => m.provider === provider);
              if (models.length === 0) return null;
              return (
                <div key={provider}>
                  {/* Provider header */}
                  <div className={`sticky top-0 px-3 py-1.5 flex items-center gap-2 border-b border-slate-800 bg-slate-900 ${meta.bg}`}>
                    <ProviderDot provider={provider} />
                    <span className={`text-[11px] font-bold uppercase tracking-widest ${meta.color}`}>
                      {meta.label}
                    </span>
                  </div>
                  {/* Models in provider */}
                  {models.map((m) => {
                    const active = m.id === value;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { onChange(m.id); setOpen(false); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-slate-800/60 last:border-0
                          ${active ? "bg-rose-950/50" : "hover:bg-slate-800/60"}
                        `}
                      >
                        {/* Name + description */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-sm font-semibold ${active ? meta.color : "text-slate-200"}`}>
                              {m.name}
                            </span>
                            {(m.tags ?? []).map((t) => <Tag key={t} tag={t} />)}
                          </div>
                          {m.description && (
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{m.description}</p>
                          )}
                        </div>

                        {/* Pricing col */}
                        <div className="shrink-0 text-right space-y-0.5">
                          <p className="text-[10px] text-slate-500 font-mono">
                            <span className="text-slate-400">in</span>{" "}
                            {m.inputPer1M < 1 ? `$${m.inputPer1M.toFixed(3)}` : `$${m.inputPer1M.toFixed(2)}`}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            <span className="text-slate-400">out</span>{" "}
                            {m.outputPer1M < 1 ? `$${m.outputPer1M.toFixed(3)}` : `$${m.outputPer1M.toFixed(2)}`}
                          </p>
                        </div>

                        {/* Check mark */}
                        <div className="w-4 shrink-0">
                          {active && <Check className="w-3.5 h-3.5 text-rose-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 border-t border-slate-800 bg-slate-950/50">
            <p className="text-[10px] text-slate-600">Giá mỗi 1M token · qua OpenRouter</p>
          </div>
        </div>
      )}
    </div>
  );
}
