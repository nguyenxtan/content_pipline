"use client";

import { useState } from "react";
import { Check, X, Maximize2, Timer, BarChart2, DollarSign, Clipboard, RefreshCw, Video } from "lucide-react";
import type { GeneratedContentResult } from "@/lib/validations/content-generator";

interface Props extends GeneratedContentResult {
  onNewGeneration: () => void;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Clipboard className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function ExpandModal({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-slate-900 rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col border border-slate-700" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          <div className="flex items-center gap-2">
            <CopyButton text={content} />
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-sm text-slate-100 whitespace-pre-wrap font-mono">
          {content}
        </pre>
      </div>
    </div>
  );
}

function ContentColumn({ title, content, className }: { title: string; content: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      {expanded && <ExpandModal title={title} content={content} onClose={() => setExpanded(false)} />}
      <div className={`flex flex-col border-r border-slate-700 last:border-r-0 ${className ?? ""}`}>
        <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{title}</span>
          <div className="flex items-center gap-1">
            <CopyButton text={content} />
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center justify-center text-xs px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded transition-colors"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 max-h-[400px]">
          <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        </div>
      </div>
    </>
  );
}

export function ContentTable({ topic, nicheName, script, shortContent, longContent, totalTokens, totalCost, generationTime, onNewGeneration }: Props) {
  const copyAll = () => {
    const all = `TOPIC: ${topic}\nNICHE: ${nicheName}\n\n=== SCRIPT ===\n${script}\n\n=== SHORT CONTENT ===\n${shortContent}\n\n=== LONG CONTENT ===\n${longContent}`;
    navigator.clipboard.writeText(all);
  };

  return (
    <div className="space-y-4">
      <div className="border border-slate-700 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[120px_120px_1fr_1fr_1fr] min-w-0">
          <div className="flex flex-col border-r border-slate-700">
            <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Topic</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 max-h-[400px]">
              <p className="text-xs text-slate-200 font-medium">{topic}</p>
            </div>
          </div>
          <div className="flex flex-col border-r border-slate-700">
            <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Niche</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 max-h-[400px]">
              <p className="text-xs text-slate-300">{nicheName}</p>
            </div>
          </div>
          <ContentColumn title="Script" content={script} />
          <ContentColumn title={`Short`} content={shortContent} />
          <ContentColumn title={`Long`} content={longContent} />
        </div>
      </div>

      {/* Metrics */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Timer className="h-3.5 w-3.5" />
          {(generationTime / 1000).toFixed(1)}s
        </span>
        <span className="flex items-center gap-1">
          <BarChart2 className="h-3.5 w-3.5" />
          {totalTokens.toLocaleString()} tokens
        </span>
        <span className="flex items-center gap-1">
          <DollarSign className="h-3.5 w-3.5" />
          {totalCost.toFixed(5)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={copyAll}
          className="flex items-center gap-1.5 px-4 py-2 text-sm border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <Clipboard className="h-4 w-4" />
          Copy All
        </button>
        <button
          onClick={onNewGeneration}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-rose-600 text-white rounded-lg hover:bg-rose-500 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          New Generation
        </button>
      </div>
    </div>
  );
}
