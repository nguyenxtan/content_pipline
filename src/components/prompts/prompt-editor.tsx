"use client";

import dynamic from "next/dynamic";
import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { oneDark } from "@codemirror/theme-one-dark";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { Loader2, ChevronDown, Play, Save } from "lucide-react";
import { variableHighlight } from "./variable-highlight";
import { ModelSelector } from "./model-selector";
import { CostBadge } from "./cost-badge";
import { UsagePanel } from "./usage-panel";
import {
  savePromptTemplateAction,
  testPromptRunAction,
} from "@/actions/prompts";
import { STAGE_LABELS } from "@/types";
import type { Niche, PromptTemplate } from "@/lib/db/schema";
import type { Stage } from "@/types";
import type { TestPromptResult } from "@/lib/validations/prompts";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] rounded-md border border-[hsl(var(--input))] bg-slate-900 flex items-center justify-center text-sm text-slate-400">
      Đang tải editor...
    </div>
  ),
});

const DEFAULT_MODEL =
  process.env.NEXT_PUBLIC_LLM_TEST_MODEL ?? "openai/gpt-4o-mini";

const STAGE_VARIABLES: Record<string, string[]> = {
  ideation: ["niche_name", "target_audience", "tone", "keywords", "date"],
  script: ["niche_name", "topic", "target_audience", "tone", "key_points"],
  short: ["niche_name", "topic", "hook", "main_content", "cta"],
  long: [
    "niche_name",
    "topic",
    "target_audience",
    "hook",
    "main_content",
    "sections",
    "cta",
  ],
};

function extractVariables(content: string): string[] {
  return [
    ...new Set(
      [...content.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)].map(
        (m) => m[1]
      )
    ),
  ];
}

interface PromptEditorProps {
  niche: Niche;
  stage: string;
  template: PromptTemplate | undefined;
  versions: PromptTemplate[];
}

export function PromptEditor({
  niche,
  stage,
  template,
  versions,
}: PromptEditorProps) {
  const router = useRouter();
  const editorViewRef = useRef<EditorView | null>(null);

  const [name, setName] = useState(template?.name ?? "");
  const [content, setContent] = useState(template?.content ?? "");
  const [model, setModel] = useState(
    template?.model ?? DEFAULT_MODEL
  );
  const [temperature, setTemperature] = useState(
    Number(template?.temperature ?? 0.7)
  );
  const [maxTokens, setMaxTokens] = useState(template?.maxTokens ?? 4000);

  const [testInputs, setTestInputs] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<TestPromptResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<
    PromptTemplate | undefined
  >(undefined);
  const [usageRefreshKey, setUsageRefreshKey] = useState(0);

  const detectedVars = extractVariables(content);
  const stageLabel = STAGE_LABELS[stage as Stage] ?? stage;

  const handleInsertVariable = useCallback((varName: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    const { from } = view.state.selection.main;
    view.dispatch({ changes: { from, insert: `{{${varName}}}` } });
    view.focus();
    setShowInsertMenu(false);
  }, []);

  async function handleSave() {
    setIsSaving(true);
    try {
      const result = await savePromptTemplateAction({
        nicheId: niche.id,
        stage,
        name,
        content,
        model,
        temperature,
        maxTokens,
      });
      if (result?.success) {
        toast.success(`Đã lưu version ${result.version}`);
        router.refresh();
      } else if (result?.error) {
        toast.error(result.error);
      }
    } catch {
      toast.error("Có lỗi khi lưu");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTest() {
    if (!content.trim()) {
      toast.error("Nhập nội dung prompt trước");
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testPromptRunAction({
        content,
        variables: testInputs,
        model,
        temperature,
        maxTokens,
        nicheId: niche.id,
        stage,
        promptTemplateId: template?.id,
      });
      setTestResult(result);
      setUsageRefreshKey((k) => k + 1);
      if (!result.success) toast.error(result.error ?? "Test thất bại");
    } catch {
      toast.error("Có lỗi khi test");
    } finally {
      setIsTesting(false);
    }
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="flex gap-6 min-h-0">
      {/* LEFT — editor */}
      <div className="flex-[3] min-w-0 space-y-4">
        {/* Template name */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-100">
            Tên template <span className="text-red-400">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${stageLabel} prompt v1`}
            className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowInsertMenu((v) => !v)}
              className="flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            >
              Insert Variable
              <ChevronDown className="h-3 w-3" />
            </button>
            {showInsertMenu && (
              <div className="absolute top-full left-0 mt-1 z-10 min-w-[160px] rounded-md border border-slate-700 bg-slate-800 shadow-lg py-1">
                {(STAGE_VARIABLES[stage] ?? []).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleInsertVariable(v)}
                    className="w-full text-left px-3 py-1.5 text-xs font-mono text-slate-100 hover:bg-slate-800 transition-colors"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-xs text-slate-400">
            {wordCount} từ
          </span>
        </div>

        {/* CodeMirror */}
        <div className="rounded-md overflow-hidden border border-[hsl(var(--input))]">
          <CodeMirror
            value={content}
            onChange={setContent}
            height="400px"
            theme={oneDark}
            extensions={[markdown(), variableHighlight]}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
            }}
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              dropCursor: false,
              allowMultipleSelections: false,
              indentOnInput: false,
            }}
          />
        </div>

        {/* Model + Temperature + Max Tokens */}
        <div className="grid grid-cols-3 gap-4">
          <ModelSelector value={model} onChange={setModel} />

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">
              Temperature:{" "}
              <span className="text-slate-100">
                {temperature.toFixed(1)}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-[hsl(var(--primary))]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">
              Max tokens
            </label>
            <input
              type="number"
              min={500}
              max={8000}
              step={100}
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value))}
              className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-md bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Lưu version mới
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-slate-700 px-5 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            Hủy
          </button>
        </div>
      </div>

      {/* RIGHT — variables + test + usage */}
      <div className="flex-[2] min-w-0 space-y-5">
        {/* Detected variables */}
        <div className="rounded-md border border-slate-700 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">
            Variables detected
          </h3>
          {detectedVars.length === 0 ? (
            <p className="text-xs text-slate-400">
              Dùng{" "}
              <code className="font-mono text-amber-400">{"{{tên_biến}}"}</code>{" "}
              trong prompt.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detectedVars.map((v) => (
                <span
                  key={v}
                  className="rounded px-2 py-0.5 text-xs font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30"
                >
                  {`{{${v}}}`}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Test inputs */}
        <div className="rounded-md border border-slate-700 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">
            Test inputs
          </h3>
          {detectedVars.length === 0 ? (
            <p className="text-xs text-slate-400">
              Thêm variable vào prompt để điền test value.
            </p>
          ) : (
            <div className="space-y-2">
              {detectedVars.map((v) => (
                <div key={v} className="space-y-1">
                  <label className="text-xs font-mono text-slate-400">
                    {`{{${v}}}`}
                  </label>
                  <input
                    value={testInputs[v] ?? ""}
                    onChange={(e) =>
                      setTestInputs((prev) => ({
                        ...prev,
                        [v]: e.target.value,
                      }))
                    }
                    placeholder={`Nhập ${v}...`}
                    className="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Run button + cost badge */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="flex items-center gap-2 flex-1 justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {isTesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Test Run
            </button>
            <CostBadge content={content} model={model} />
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className="rounded-md border border-slate-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                Output
              </h3>
              {testResult.success && (
                <div className="flex gap-3 text-xs text-slate-400">
                  <span>{testResult.inputTokens}↑</span>
                  <span>{testResult.outputTokens}↓</span>
                  <span className="text-amber-400">
                    {testResult.costUsd !== undefined
                      ? `$${testResult.costUsd.toFixed(6)}`
                      : "—"}
                  </span>
                  <span>{testResult.durationMs}ms</span>
                </div>
              )}
            </div>
            {testResult.success ? (
              <OutputDisplay output={testResult.output ?? ""} />
            ) : (
              <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">
                {testResult.error}
              </p>
            )}
          </div>
        )}

        {/* Version history */}
        {versions.length > 0 && (
          <div className="rounded-md border border-slate-700 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Version history
            </h3>
            <select
              value={selectedVersion?.id ?? ""}
              onChange={(e) => {
                const id = parseInt(e.target.value);
                setSelectedVersion(versions.find((v) => v.id === id));
              }}
              className="w-full rounded-md border border-[hsl(var(--input))] bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              <option value="">— Chọn version —</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} — {v.name}
                  {v.isActive ? " ✓" : ""}
                </option>
              ))}
            </select>
            {selectedVersion && (
              <pre className="text-xs text-slate-400 bg-slate-900 rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap break-words border border-slate-700">
                {selectedVersion.content}
              </pre>
            )}
          </div>
        )}

        {/* Usage history */}
        <UsagePanel
          nicheId={niche.id}
          stage={stage}
          refreshKey={usageRefreshKey}
        />
      </div>
    </div>
  );
}

function OutputDisplay({ output }: { output: string }) {
  let pretty: string | null = null;
  try {
    const parsed = JSON.parse(output);
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    // not JSON — show raw
  }

  return (
    <pre className="text-xs text-slate-100 bg-slate-900 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words border border-slate-700">
      {pretty ?? output}
    </pre>
  );
}
