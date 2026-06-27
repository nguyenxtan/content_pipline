"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Rocket,
  XCircle,
} from "lucide-react";
import { generateQuoteShortsAction } from "@/actions/quote-generator";
import type { QuoteGenResult } from "@/lib/pipeline/quote-short-pipeline";
import {
  CHANNEL_PROFILES,
  getTopicFamiliesForChannel,
} from "@/lib/prompt-studio-registry";
import {
  getChannelWorkspaces,
  getWorkspaceTopicFamiliesResolved,
} from "@/lib/channel-workspace-registry";

const WORKSPACES = getChannelWorkspaces();

const COUNT_OPTIONS = [1, 3, 5, 10];

function GenerateResultCard({ result }: { result: QuoteGenResult }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`rounded-xl border p-4 ${
        result.ok
          ? "border-emerald-500/30 bg-emerald-950/20"
          : "border-red-500/30 bg-red-950/20"
      }`}
    >
      <div className="flex items-start gap-3">
        {result.ok ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100">{result.topic}</p>
          <p className="mt-1 text-xs text-slate-400 italic">&ldquo;{result.quoteText}&rdquo;</p>
          {result.reflectionText && (
            <p className="mt-1 text-xs leading-5 text-slate-500">{result.reflectionText}</p>
          )}
          {result.error && <p className="mt-1 text-xs text-red-400">{result.error}</p>}
        </div>
        {result.ok && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="shrink-0 text-slate-500 transition-colors hover:text-slate-300"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {open && result.ok && (
        <div className="mt-3 space-y-1 text-xs font-mono text-slate-500">
          <p className="truncate">video: {result.videoPath}</p>
          <p className="truncate">sidecar: {result.sidecarPath}</p>
        </div>
      )}
    </div>
  );
}

export function QuoteGeneratorPanel() {
  const router = useRouter();
  const [isGenerating, startGenerate] = useTransition();
  const [count, setCount] = useState(3);
  const [workspaceId, setWorkspaceId] = useState("");
  const [channelProfileId, setChannelProfileId] = useState("");
  const [topicFamily, setTopicFamily] = useState("");
  const [durationSec, setDurationSec] = useState(14);
  const [quoteFormat, setQuoteFormat] = useState<"short_quote" | "quote_reflection" | "note_letter_card" | "kinetic_text" | "bilingual_minimal">("short_quote");

  // When workspace is selected, its promptProfileId takes precedence
  const activeWorkspace = WORKSPACES.find((w) => w.workspaceId === workspaceId) ?? null;
  const activeChannelProfileId = activeWorkspace?.promptProfileId ?? channelProfileId;
  const isTangSau =
    activeWorkspace?.workspaceId === "tang_sau_workspace" || activeChannelProfileId === "tang_sau_v1";
  // Alias kept for readability in JSX.
  const reflectionAllowed = isTangSau;
  const TANG_SAU_FORMATS = ["quote_reflection", "note_letter_card", "kinetic_text", "bilingual_minimal"] as const;
  const effectiveQuoteFormat =
    isTangSau ? quoteFormat :
    TANG_SAU_FORMATS.includes(quoteFormat as typeof TANG_SAU_FORMATS[number]) ? "short_quote" :
    quoteFormat;
  const [showPanel, setShowPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [results, setResults] = useState<QuoteGenResult[]>([]);

  const handleGenerate = () => {
    setError(null);
    setResults([]);
    setSuccessCount(0);
    setFailCount(0);

    startGenerate(async () => {
      const result = await generateQuoteShortsAction({
        count,
        workspaceId: workspaceId || undefined,
        channelProfileId: activeChannelProfileId || undefined,
        topicFamily: topicFamily || undefined,
        durationSec,
        quoteFormat: effectiveQuoteFormat,
      });

      setResults(result.results);
      setSuccessCount(result.successCount);
      setFailCount(result.failCount);

      if (!result.ok && result.error) {
        setError(result.error);
      }

      router.refresh();
    });
  };

  const reset = () => {
    setError(null);
    setResults([]);
    setSuccessCount(0);
    setFailCount(0);
  };

  const topicFamilyOptions = [
    { id: "", label: "Tự động (trộn các chủ đề)" },
    ...(activeWorkspace
      ? getWorkspaceTopicFamiliesResolved(activeWorkspace.workspaceId).map((f) => ({
          id: f.familyId,
          label: f.label,
        }))
      : getTopicFamiliesForChannel(channelProfileId).map((family) => ({
          id: family.id,
          label: family.label,
        }))
    ),
  ];

  return (
    <div className="rounded-2xl border border-rose-500/20 bg-slate-900/70">
      <button
        type="button"
        onClick={() => setShowPanel((value) => !value)}
        className="flex w-full items-center justify-between rounded-2xl px-6 py-4 transition-colors hover:bg-slate-800/40"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2">
            <Plus className="h-4 w-4 text-rose-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-slate-100">Tạo Quote Short</p>
            <p className="text-xs text-slate-400">
              Tự động tạo quote, ảnh nền, nhạc và video. Không tự lập lịch, không tự upload.
            </p>
          </div>
        </div>
        {showPanel ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        )}
      </button>

      {showPanel && (
        <div className="space-y-5 border-t border-slate-800 px-6 pb-6 pt-5">
          <div className="grid gap-4 sm:grid-cols-4">
            {/* Workspace selector — when selected, auto-fills profile and topic families */}
            <div className="space-y-1.5 sm:col-span-4">
              <label className="text-xs font-medium text-slate-300">Workspace (tùy chọn)</label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => { setWorkspaceId(""); setTopicFamily(""); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    !workspaceId
                      ? "bg-slate-700 text-white"
                      : "border border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  Không chọn
                </button>
                {WORKSPACES.map((w) => (
                  <button
                    key={w.workspaceId}
                    type="button"
                    onClick={() => { setWorkspaceId(w.workspaceId); setTopicFamily(""); setChannelProfileId(""); }}
                    
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      workspaceId === w.workspaceId
                        ? "bg-rose-600 text-white"
                        : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {w.displayName}
                  </button>
                ))}
              </div>
              {activeWorkspace && (
                <p className="text-xs text-slate-500">
                  Profile: <span className="text-rose-300">{activeWorkspace.promptProfileId}</span>
                  {" · "}Topic families từ workspace
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">
                Số lượng Quote Shorts cần tạo
              </label>
              <div className="flex flex-wrap gap-1.5">
                {COUNT_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCount(value)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      count === value
                        ? "bg-rose-600 text-white"
                        : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Hệ thống sẽ tự viết quote, tạo ảnh nền, chọn nhạc và render video cho từng mục.
              </p>
            </div>

            {!activeWorkspace && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Channel profile</label>
                <select
                  value={channelProfileId}
                  onChange={(event) => {
                    setChannelProfileId(event.target.value);
                    setTopicFamily("");
                  }}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
                >
                  <option value="">Mặc định hiện tại</option>
                  {CHANNEL_PROFILES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.channelName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Topic family</label>
              <select
                value={topicFamily}
                onChange={(event) => setTopicFamily(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
              >
                {topicFamilyOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Thời lượng (giây)</label>
              <input
                type="number"
                min={10}
                max={20}
                step={1}
                value={durationSec}
                onChange={(event) => {
                  const next = Number(event.target.value || 14);
                  setDurationSec(Math.max(10, Math.min(20, next)));
                }}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-rose-500"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-4">
              <label className="text-xs font-medium text-slate-300">Quote format</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setQuoteFormat("short_quote")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    effectiveQuoteFormat === "short_quote"
                      ? "bg-rose-600 text-white"
                      : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  Short Quote
                </button>
                <button
                  type="button"
                  onClick={() => reflectionAllowed && setQuoteFormat("quote_reflection")}
                  disabled={!reflectionAllowed}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    effectiveQuoteFormat === "quote_reflection"
                      ? "bg-rose-600 text-white"
                      : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  Quote + Reflection
                </button>
                {isTangSau && (
                  <>
                    <button
                      type="button"
                      onClick={() => setQuoteFormat("note_letter_card")}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        effectiveQuoteFormat === "note_letter_card"
                          ? "bg-rose-600 text-white"
                          : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                      }`}
                    >
                      Note Letter Card
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuoteFormat("kinetic_text")}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        effectiveQuoteFormat === "kinetic_text"
                          ? "bg-rose-600 text-white"
                          : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                      }`}
                    >
                      Kinetic Text
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuoteFormat("bilingual_minimal")}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        effectiveQuoteFormat === "bilingual_minimal"
                          ? "bg-rose-600 text-white"
                          : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                      }`}
                    >
                      Bilingual Minimal
                    </button>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {isTangSau
                  ? "Note Letter Card, Kinetic Text, Bilingual Minimal là định dạng Tầng Sâu. Không TTS, không upload tự động."
                  : "Quote + Reflection, Note Letter Card, Kinetic Text và Bilingual Minimal chỉ mở cho workspace Tầng Sâu."}
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {isGenerating && (
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-rose-400" />
              Đang tự động tạo quote, ảnh nền, nhạc và render video… Có thể mất vài phút.
            </div>
          )}

          {!isGenerating && results.length > 0 && (
            <div className="space-y-4">
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  successCount > 0
                    ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
                    : "border-red-500/30 bg-red-950/20 text-red-300"
                }`}
              >
                Thành công {successCount} · Lỗi {failCount}. Chưa có lịch đăng nào được tạo.
              </div>
              <div className="space-y-2">
                {results.map((result, index) => (
                  <GenerateResultCard key={`${result.contentId}-${index}`} result={result} />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Tạo {count} Quote Short{count !== 1 ? "s" : ""}
            </button>

            {results.length > 0 && !isGenerating && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500"
              >
                <Plus className="h-4 w-4" />
                Tạo thêm
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Sau khi tạo xong, vào Đăng bài -&gt; Lập lịch trộn để đưa video vào hàng chờ đăng.
          </p>
        </div>
      )}
    </div>
  );
}
