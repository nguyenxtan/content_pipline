"use client";

import { useState } from "react";
import { ImageIcon, Check, Loader2, DollarSign, Zap, Settings2 } from "lucide-react";
import type { AIModel, ModelProvider } from "@/lib/ai-models";
import { PROVIDER_META } from "@/lib/ai-models";
import {
  setImagePromptModel,
  setFalImageModel,
  setImageCount,
  setImageSteps,
} from "@/actions/app-config";

/* ─── fal.ai model presets ───────────────────────────────── */
interface FalModelOption {
  id: string;
  name: string;
  desc: string;
  costPerImg: number;
  defaultSteps: number;
  minSteps: number;
  maxSteps: number;
  quality: "fast" | "balanced" | "high" | "best";
}

const FAL_MODELS: FalModelOption[] = [
  {
    id: "fal-ai/flux/schnell",
    name: "Flux Schnell",
    desc: "Nhanh nhất, giá rẻ. Phù hợp thử nghiệm & sản xuất số lượng lớn.",
    costPerImg: 0.003, defaultSteps: 8, minSteps: 4, maxSteps: 12,
    quality: "fast",
  },
  {
    id: "fal-ai/flux/dev",
    name: "Flux Dev",
    desc: "Chất lượng cao, cân bằng tốt giữa giá và chất lượng. Khuyến nghị cho production.",
    costPerImg: 0.025, defaultSteps: 28, minSteps: 20, maxSteps: 50,
    quality: "high",
  },
  {
    id: "fal-ai/flux-pro/v1.1",
    name: "Flux Pro 1.1",
    desc: "Chất lượng tốt nhất dòng Flux, ảnh sắc nét, màu sắc đẹp.",
    costPerImg: 0.040, defaultSteps: 28, minSteps: 20, maxSteps: 50,
    quality: "best",
  },
  {
    id: "fal-ai/flux-pro/v1.1-ultra",
    name: "Flux Pro Ultra",
    desc: "Độ phân giải cực cao, chi tiết tuyệt vời. Cho video cao cấp.",
    costPerImg: 0.060, defaultSteps: 28, minSteps: 20, maxSteps: 50,
    quality: "best",
  },
];

const QUALITY_BADGE: Record<FalModelOption["quality"], { label: string; cls: string }> = {
  fast:     { label: "Nhanh",    cls: "bg-green-900/40 text-green-400"   },
  balanced: { label: "Cân bằng", cls: "bg-blue-900/40 text-blue-400"     },
  high:     { label: "Cao",      cls: "bg-violet-900/40 text-violet-400" },
  best:     { label: "Tốt nhất", cls: "bg-amber-900/40 text-amber-400"   },
};

const COUNT_MIN = 1;
const COUNT_MAX = 10;

const PROVIDER_ORDER: ModelProvider[] = ["openai", "google", "anthropic", "deepseek"];

interface Props {
  currentLlmModel:  string;
  currentFalModel:  string;
  currentCount:     number;
  currentSteps:     number | null;
  models:           AIModel[];
}

export function ImagesSettingsClient({
  currentLlmModel,
  currentFalModel,
  currentCount,
  currentSteps,
  models,
}: Props) {
  const [llmModel, setLlmModel]     = useState(currentLlmModel);
  const [falModel, setFalModel]     = useState(currentFalModel);
  const [count, setCount]           = useState(currentCount);

  const selectedFalPreset = FAL_MODELS.find((m) => m.id === falModel) ?? FAL_MODELS[0];
  const [steps, setStepsState] = useState(
    currentSteps ?? selectedFalPreset.defaultSteps
  );

  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  const isDirty =
    llmModel !== currentLlmModel ||
    falModel  !== currentFalModel ||
    count     !== currentCount    ||
    steps     !== (currentSteps ?? selectedFalPreset.defaultSteps);

  const handleFalModelChange = (id: string) => {
    setFalModel(id);
    const preset = FAL_MODELS.find((m) => m.id === id);
    if (preset) setStepsState(preset.defaultSteps);
  };

  const handleSave = async () => {
    setSaving(true);
    await Promise.all([
      setImagePromptModel(llmModel),
      setFalImageModel(falModel),
      setImageCount(count),
      setImageSteps(steps),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // Cost estimates
  const selectedFal    = FAL_MODELS.find((m) => m.id === falModel) ?? FAL_MODELS[0];
  const falCost        = count * selectedFal.costPerImg;
  const selectedLlm    = models.find((m) => m.id === llmModel);
  const llmCost        = selectedLlm
    ? (500 * selectedLlm.inputPer1M + 200 * selectedLlm.outputPer1M) / 1_000_000
    : 0;
  const totalCost = falCost + llmCost;

  // Grouped LLM models
  const byProvider = PROVIDER_ORDER.reduce<Record<string, AIModel[]>>((acc, p) => {
    const group = models.filter((m) => m.provider === p);
    if (group.length) acc[p] = group;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header + Save */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-violet-400" />
            Cài đặt tạo ảnh
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Cấu hình model AI để sinh image prompts và tạo ảnh
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className={[
            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            saved
              ? "bg-emerald-700 text-emerald-200"
              : isDirty
              ? "bg-rose-600 hover:bg-rose-500 text-white"
              : "bg-slate-800 text-slate-500 cursor-not-allowed",
          ].join(" ")}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saving ? "Đang lưu..." : saved ? "Đã lưu" : "Lưu thay đổi"}
        </button>
      </div>

      {/* Cost estimate */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          Chi phí ước tính / video
        </h2>
        <div className="grid grid-cols-4 gap-3 text-center">
          <div>
            <p className="text-base font-bold text-violet-300">{count} ảnh</p>
            <p className="text-xs text-slate-500">số lượng</p>
          </div>
          <div>
            <p className="text-base font-bold text-slate-200">${selectedFal.costPerImg.toFixed(3)}</p>
            <p className="text-xs text-slate-500">/ ảnh (fal.ai)</p>
          </div>
          <div>
            <p className="text-base font-bold text-slate-200">${llmCost.toFixed(5)}</p>
            <p className="text-xs text-slate-500">LLM prompts</p>
          </div>
          <div>
            <p className="text-base font-bold text-emerald-400">${totalCost.toFixed(4)}</p>
            <p className="text-xs text-slate-500">tổng cộng</p>
          </div>
        </div>
      </div>

      {/* ─── fal.ai model + count + steps ─────────────────── */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/50">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-400" /> fal.ai · Model tạo ảnh
          </h2>
        </div>

        {/* Model cards */}
        <div className="p-4 grid grid-cols-2 gap-3">
          {FAL_MODELS.map((m) => {
            const isSelected = falModel === m.id;
            const badge = QUALITY_BADGE[m.quality];
            return (
              <button
                key={m.id}
                onClick={() => handleFalModelChange(m.id)}
                className={[
                  "rounded-xl border-2 p-3.5 text-left transition-all",
                  isSelected
                    ? "border-violet-500 bg-violet-950/30"
                    : "border-slate-700 hover:border-slate-500 hover:bg-slate-800/40",
                ].join(" ")}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-sm font-semibold ${isSelected ? "text-violet-300" : "text-slate-200"}`}>
                    {m.name}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-snug mb-2">{m.desc}</p>
                <p className="text-xs font-semibold text-emerald-400">${m.costPerImg.toFixed(3)}/ảnh</p>
              </button>
            );
          })}
        </div>

        {/* Count + Steps */}
        <div className="grid grid-cols-2 gap-4 px-5 pb-5">
          {/* Số ảnh */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              Số ảnh / video
              <span className="text-slate-600">({COUNT_MIN}–{COUNT_MAX})</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={COUNT_MIN}
                max={COUNT_MAX}
                step={1}
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value))}
                className="flex-1 accent-violet-500"
              />
              <span className="text-sm font-bold text-violet-300 w-6 text-right shrink-0">{count}</span>
            </div>
          </div>

          {/* Inference steps */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <Settings2 className="h-3 w-3" />
              Inference steps
              <span className="text-slate-600">({selectedFalPreset.minSteps}–{selectedFalPreset.maxSteps})</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={selectedFalPreset.minSteps}
                max={selectedFalPreset.maxSteps}
                step={1}
                value={steps}
                onChange={(e) => setStepsState(parseInt(e.target.value))}
                className="flex-1 accent-violet-500"
              />
              <span className="text-sm font-bold text-violet-300 w-6 text-right shrink-0">{steps}</span>
            </div>
            <p className="text-[10px] text-slate-600">
              Cao hơn = chất lượng tốt hơn nhưng chậm hơn. Default: {selectedFalPreset.defaultSteps}
            </p>
          </div>
        </div>
      </div>

      {/* ─── LLM model cho image prompts ──────────────────── */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/50">
          <h2 className="text-sm font-semibold text-slate-200">Model LLM để sinh image prompts</h2>
          <p className="text-xs text-slate-500 mt-0.5">Dùng để phân tích script và tạo mô tả ảnh bằng tiếng Anh</p>
        </div>

        <div className="divide-y divide-slate-800">
          {PROVIDER_ORDER.filter((p) => byProvider[p]).map((provider) => {
            const meta = PROVIDER_META[provider];
            return (
              <div key={provider}>
                <div className="px-5 py-2 bg-slate-800/30">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${meta.color}`}>
                    {meta.label}
                  </span>
                </div>
                {byProvider[provider].map((m) => {
                  const isSelected = llmModel === m.id;
                  const estCost = (500 * m.inputPer1M + 200 * m.outputPer1M) / 1_000_000;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setLlmModel(m.id)}
                      className={[
                        "w-full flex items-center gap-3 px-5 py-3 text-left transition-colors border-l-2",
                        isSelected
                          ? "bg-rose-600/10 border-rose-500"
                          : "border-transparent hover:bg-slate-800/50",
                      ].join(" ")}
                    >
                      <div className={[
                        "w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center",
                        isSelected ? "border-rose-500 bg-rose-500" : "border-slate-600",
                      ].join(" ")}>
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${isSelected ? "text-rose-300" : "text-slate-200"}`}>
                            {m.name}
                          </span>
                          {m.tags?.map((tag) => (
                            <span key={tag} className={[
                              "text-[10px] px-1.5 py-0.5 rounded font-medium",
                              tag === "latest"    ? "bg-blue-900/40 text-blue-400"   :
                              tag === "fast"      ? "bg-green-900/40 text-green-400" :
                              tag === "reasoning" ? "bg-amber-900/40 text-amber-400" :
                              "bg-slate-800 text-slate-500",
                            ].join(" ")}>{tag}</span>
                          ))}
                        </div>
                        {m.description && (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">{m.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-slate-400">
                          ${m.inputPer1M.toFixed(2)} / ${m.outputPer1M.toFixed(2)}
                          <span className="text-slate-600 ml-1">per 1M</span>
                        </p>
                        <p className="text-[10px] text-emerald-500 mt-0.5">~${estCost.toFixed(5)} / gen</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
