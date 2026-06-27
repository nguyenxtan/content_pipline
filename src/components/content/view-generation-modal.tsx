"use client";

import { useState } from "react";
import type { ContentGenerationRow } from "@/lib/validations/content-generator";

interface Props {
  generation: ContentGenerationRow;
  onClose: () => void;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}

function Section({ title, content }: { title: string; content: string }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-300">{title}</h4>
        <CopyBtn text={content} />
      </div>
      <pre className="bg-gray-950 rounded-lg p-3 text-xs text-gray-200 whitespace-pre-wrap font-mono overflow-y-auto max-h-52 leading-relaxed">
        {content}
      </pre>
    </div>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "neutral" }) {
  const color = tone === "ok"
    ? "text-emerald-300"
    : tone === "warn"
      ? "text-amber-300"
      : "text-gray-300";
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={color}>{value}</span>
    </div>
  );
}

export function ViewGenerationModal({ generation, onClose }: Props) {
  const hooksText = generation.shortHookCandidates?.length
    ? generation.shortHookCandidates.map((hook: string, index: number) => `${index + 1}. ${hook}`).join("\n")
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-100">{generation.topic}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{generation.nicheName} · {new Date(generation.createdAt).toLocaleDateString("vi-VN")}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none ml-4">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid gap-2 sm:grid-cols-3">
            <StatusRow
              label="CoverText"
              value={generation.shortCoverText ? "Có" : "Thiếu"}
              tone={generation.shortCoverText ? "ok" : "warn"}
            />
            <StatusRow
              label="Cover Asset"
              value={generation.shortCoverAssetPath ? "Có" : "Thiếu"}
              tone={generation.shortCoverAssetPath ? "ok" : "warn"}
            />
            <StatusRow
              label="Hook Pattern"
              value={generation.hookPattern ?? generation.hookType ?? "Thiếu"}
              tone={generation.hookPattern || generation.hookType ? "ok" : "warn"}
            />
          </div>
          {generation.shortCoverText && (
            <Section title="🖼️ Cover Text" content={generation.shortCoverText} />
          )}
          <Section title="📄 Script / Kịch bản" content={generation.script} />
          {generation.shortSelectedHook && (
            <Section title="🎣 Hook đã chọn" content={generation.shortSelectedHook} />
          )}
          {hooksText && (
            <Section title="🪝 Danh sách hook" content={hooksText} />
          )}
          <Section title="🎬 Short Content (60s)" content={generation.shortContent} />
          <Section title="📹 Long Content (20 phút)" content={generation.longContent} />
        </div>
        <div className="px-5 py-3 border-t border-gray-700 flex justify-end shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
