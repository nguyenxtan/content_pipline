"use client";

import { useState, useEffect } from "react";
import { X, Save, Loader2, RotateCcw, Sparkles } from "lucide-react";
import {
  getContentPromptsAction,
  saveContentPromptAction,
  generateNichePromptAction,
} from "@/actions/content-generator";
import { DEFAULT_SHORT_PROMPT, DEFAULT_LONG_PROMPT } from "@/lib/content-prompts";
import { ModelDropdown } from "@/components/ui/model-dropdown";

type Tab = "short" | "long";

const DEFAULT_MODEL = "openai/gpt-4o-mini";

interface Props {
  nicheId: number;
  nicheName: string;
  onClose: () => void;
}

export function PromptEditModal({ nicheId, nicheName, onClose }: Props) {
  const [tab, setTab]               = useState<Tab>("short");
  const [shortPrompt, setShortPrompt] = useState("");
  const [longPrompt,  setLongPrompt]  = useState("");
  const [shortModel,  setShortModel]  = useState<string>(DEFAULT_MODEL);
  const [longModel,   setLongModel]   = useState<string>(DEFAULT_MODEL);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [generating,  setGenerating]  = useState(false);
  const [genError,    setGenError]    = useState("");
  const [saveError,   setSaveError]   = useState("");

  useEffect(() => {
    getContentPromptsAction(nicheId).then((res) => {
      setShortPrompt(res.short);
      setLongPrompt(res.long);
      setShortModel(res.shortModel || DEFAULT_MODEL);
      setLongModel(res.longModel   || DEFAULT_MODEL);
      setLoading(false);
    });
  }, [nicheId]);

  const isShort         = tab === "short";
  const current         = isShort ? shortPrompt : longPrompt;
  const setCurrent      = isShort ? setShortPrompt : setLongPrompt;
  const currentModel    = isShort ? shortModel : longModel;
  const setCurrentModel = isShort
    ? (v: string) => setShortModel(v)
    : (v: string) => setLongModel(v);
  const defaultPrompt   = isShort ? DEFAULT_SHORT_PROMPT : DEFAULT_LONG_PROMPT;

  async function handleGenerate() {
    setGenerating(true);
    setGenError("");
    const res = await generateNichePromptAction(nicheId, tab, currentModel);
    setGenerating(false);
    if ("error" in res) setGenError(res.error);
    else setCurrent(res.prompt);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    const res = await saveContentPromptAction(nicheId, tab, current, currentModel);
    setSaving(false);
    if (!res.success) {
      setSaveError(res.error ?? "Lưu thất bại");
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  function handleReset() {
    if (confirm("Reset về prompt mặc định?")) {
      setCurrent(defaultPrompt);
      setCurrentModel(DEFAULT_MODEL);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-3xl flex-col rounded-xl border border-slate-700 bg-slate-900 max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3 shrink-0">
          <div>
            <h3 className="font-semibold text-slate-100">Prompt tạo nội dung</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="text-slate-300">{nicheName}</span>
              {" · "}Biến:{" "}
              {["topic", "niche", "script"].map((v) => (
                <code key={v} className="font-mono text-amber-400 text-[11px] mr-1">{`{{${v}}}`}</code>
              ))}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-slate-700 shrink-0">
          {(["short", "long"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setGenError(""); }}
              className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? "border-rose-500 text-rose-400"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {t === "short" ? "Short (60s)" : "Long (20 phút)"}
            </button>
          ))}
        </div>

        {/* ── Model + Generate row ── */}
        {!loading && (
          <div className="border-b border-slate-800 bg-slate-800/20 px-5 py-3 shrink-0">
            <div className="flex items-end gap-3">
              {/* Model dropdown */}
              <div className="flex-1">
                <ModelDropdown
                  label="Model AI"
                  value={currentModel}
                  onChange={setCurrentModel}
                  size="sm"
                />
              </div>

              {/* Generate from niche button */}
              <div className="shrink-0 flex flex-col gap-1">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || saving}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-[7px] text-xs font-medium text-slate-200 hover:border-rose-500/60 hover:bg-slate-700 hover:text-rose-300 disabled:opacity-50 transition-all"
                >
                  {generating ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang tạo...</>
                  ) : (
                    <><Sparkles className="h-3.5 w-3.5 text-rose-400" />✨ Tạo từ phân mục</>
                  )}
                </button>
                {genError && (
                  <p className="text-[11px] text-red-400">{genError}</p>
                )}
              </div>
            </div>

            <p className="mt-2 text-[11px] text-slate-600 leading-relaxed">
              AI đọc thông tin phân mục (mô tả, đối tượng, giọng điệu) và tự viết prompt phù hợp
              cho <span className="text-slate-400">{isShort ? "short video 60s" : "long video 20 phút"}</span>.
            </p>
          </div>
        )}

        {/* ── Textarea ── */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-rose-400" />
            </div>
          ) : (
            <textarea
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200 font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between border-t border-slate-700 px-5 py-3 shrink-0">
          <button
            onClick={handleReset}
            disabled={loading || saving || generating}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset mặc định
          </button>
          <div className="flex items-center gap-3">
            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            <button
              onClick={handleSave}
              disabled={loading || saving || generating}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {saved ? "Đã lưu!" : "Lưu"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
