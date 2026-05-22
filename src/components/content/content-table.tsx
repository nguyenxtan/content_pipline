"use client";

import { useState } from "react";
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
      className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}

function ExpandModal({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
          <div className="flex items-center gap-2">
            <CopyButton text={content} />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-lg leading-none">×</button>
          </div>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-sm text-gray-100 whitespace-pre-wrap font-mono">
          {content}
        </pre>
      </div>
    </div>
  );
}

interface ColumnProps {
  title: string;
  content: string;
  className?: string;
}

function ContentColumn({ title, content, className }: ColumnProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {expanded && (
        <ExpandModal title={title} content={content} onClose={() => setExpanded(false)} />
      )}
      <div className={`flex flex-col border-r border-gray-200 last:border-r-0 ${className ?? ""}`}>
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{title}</span>
          <div className="flex items-center gap-1">
            <CopyButton text={content} />
            <button
              onClick={() => setExpanded(true)}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              ⤢
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 max-h-[400px]">
          <pre className="text-xs text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        </div>
      </div>
    </>
  );
}

export function ContentTable({
  topic,
  nicheName,
  script,
  shortContent,
  longContent,
  totalTokens,
  totalCost,
  generationTime,
  onNewGeneration,
}: Props) {
  const copyAll = () => {
    const all = `TOPIC: ${topic}\nNICHE: ${nicheName}\n\n=== SCRIPT ===\n${script}\n\n=== SHORT CONTENT ===\n${shortContent}\n\n=== LONG CONTENT ===\n${longContent}`;
    navigator.clipboard.writeText(all);
  };

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[120px_120px_1fr_1fr_1fr] min-w-0">
          {/* Static columns */}
          <div className="flex flex-col border-r border-gray-200">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Topic</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 max-h-[400px]">
              <p className="text-xs text-gray-800 font-medium">{topic}</p>
            </div>
          </div>

          <div className="flex flex-col border-r border-gray-200">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Niche</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 max-h-[400px]">
              <p className="text-xs text-gray-800">{nicheName}</p>
            </div>
          </div>

          <ContentColumn title="Script" content={script} />
          <ContentColumn title="Short 🎬" content={shortContent} />
          <ContentColumn title="Long 🎬" content={longContent} />
        </div>
      </div>

      {/* Metrics */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span>⏱️ {(generationTime / 1000).toFixed(1)}s</span>
        <span>📊 {totalTokens.toLocaleString()} tokens</span>
        <span>💰 ${totalCost.toFixed(5)}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={copyAll}
          className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          📋 Copy All
        </button>
        <button
          onClick={onNewGeneration}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          🔄 New Generation
        </button>
      </div>
    </div>
  );
}
