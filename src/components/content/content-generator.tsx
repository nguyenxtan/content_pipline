"use client";

import { useState, useEffect, useCallback } from "react";
import type { Niche } from "@/lib/db/schema";
import type { GenerationResult, PromptVersionInfo } from "@/lib/validations/content";
import { generateContentAction, getPromptVersionsForStageAction } from "@/actions/content";
import { StepNicheSelect } from "./step-niche-select";
import { StepStageSelect } from "./step-stage-select";
import { StepPromptSelect } from "./step-prompt-select";
import { StepVariableInput } from "./step-variable-input";
import { ResultPanel } from "./result-panel";
import { RecentGenerationsPanel } from "./recent-generations-panel";

const STEPS = ["Ngách", "Stage", "Prompt", "Biến", "Kết quả"];

interface Props {
  niches: Niche[];
}

export function ContentGenerator({ niches }: Props) {
  const [step, setStep] = useState(1);
  const [selectedNicheId, setSelectedNicheId] = useState<number | null>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [promptVersions, setPromptVersions] = useState<PromptVersionInfo[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PromptVersionInfo | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const selectedNiche = niches.find((n) => n.id === selectedNicheId) ?? null;

  // Polling for processing status
  useEffect(() => {
    if (!result || result.status !== "processing") return;

    const id = result.id;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/content/${id}/status`);
        if (!res.ok) return;
        const data = await res.json() as GenerationResult;
        if (data.status === "done" || data.status === "error") {
          setResult(data);
          setRefreshKey((k) => k + 1);
          clearInterval(timer);
        }
      } catch {
        // ignore transient fetch errors
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [result]);

  const handleNicheSelect = (id: number) => {
    setSelectedNicheId(id);
    setSelectedStage(null);
    setPromptVersions([]);
    setSelectedTemplateId(null);
    setSelectedTemplate(null);
    setStep(2);
  };

  const handleStageSelect = useCallback(async (stage: string) => {
    if (!selectedNicheId) return;
    setSelectedStage(stage);
    const versions = await getPromptVersionsForStageAction(selectedNicheId, stage);
    setPromptVersions(versions);
    setSelectedTemplateId(null);
    setSelectedTemplate(null);
    setStep(3);
  }, [selectedNicheId]);

  const handlePromptSelect = (id: number, template: PromptVersionInfo) => {
    setSelectedTemplateId(id);
    setSelectedTemplate(template);
    setVariableValues({});
    setStep(4);
  };

  const handleGenerate = async () => {
    if (!selectedNicheId || !selectedStage || !selectedTemplateId) return;
    setIsGenerating(true);
    setStep(5);

    const res = await generateContentAction({
      nicheId: selectedNicheId,
      stage: selectedStage,
      promptTemplateId: selectedTemplateId,
      inputVariables: variableValues,
    });

    setResult(res);
    setIsGenerating(false);
    if (res.status === "done" || res.status === "error") {
      setRefreshKey((k) => k + 1);
    }
  };

  const handleNew = () => {
    setStep(1);
    setSelectedNicheId(null);
    setSelectedStage(null);
    setPromptVersions([]);
    setSelectedTemplateId(null);
    setSelectedTemplate(null);
    setVariableValues({});
    setResult(null);
  };

  const canProceedStep4 = selectedTemplate
    ? selectedTemplate.variables.every((v) => (variableValues[v] ?? "").trim() !== "")
    : true;

  return (
    <div className="flex gap-6">
      {/* Main wizard */}
      <div className="flex-1 min-w-0">
        {/* Step indicator */}
        <div className="flex items-center gap-0 mb-8">
          {STEPS.map((label, i) => {
            const num = i + 1;
            const isDone = step > num;
            const isActive = step === num;
            return (
              <div key={num} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      isDone
                        ? "bg-blue-500 text-white"
                        : isActive
                        ? "bg-blue-600 text-white ring-4 ring-blue-100"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {isDone ? "✓" : num}
                  </div>
                  <span className={`text-xs mt-1 ${isActive ? "text-blue-600 font-medium" : "text-gray-400"}`}>
                    {label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 w-8 mx-1 mb-4 ${step > num ? "bg-blue-500" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 min-h-[300px]">
          {step === 1 && (
            <StepNicheSelect
              niches={niches}
              selected={selectedNicheId}
              onSelect={handleNicheSelect}
            />
          )}
          {step === 2 && selectedNiche && (
            <StepStageSelect
              niche={{
                id: selectedNiche.id,
                name: selectedNiche.name,
                icon: selectedNiche.icon ?? null,
                stages: (selectedNiche.stages as string[]) ?? [],
              }}
              selected={selectedStage}
              onSelect={handleStageSelect}
            />
          )}
          {step === 3 && (
            <StepPromptSelect
              versions={promptVersions}
              selected={selectedTemplateId}
              onSelect={handlePromptSelect}
            />
          )}
          {step === 4 && selectedTemplate && (
            <>
              <StepVariableInput
                variables={selectedTemplate.variables}
                values={variableValues}
                onChange={(key, val) =>
                  setVariableValues((prev) => ({ ...prev, [key]: val }))
                }
              />
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setStep(3)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  ← Quay lại
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!canProceedStep4 || isGenerating}
                  className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {isGenerating ? "Đang tạo..." : "Generate ✨"}
                </button>
              </div>
            </>
          )}
          {step === 5 && result && (
            <ResultPanel result={result} onNew={handleNew} />
          )}
          {step === 5 && !result && (
            <div className="flex items-center gap-3 py-12 justify-center">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-500">Đang khởi tạo...</span>
            </div>
          )}
        </div>

        {/* Back nav for non-variable steps */}
        {step >= 2 && step <= 3 && (
          <button
            onClick={() => setStep(step - 1)}
            className="mt-3 text-sm text-gray-500 hover:text-gray-700"
          >
            ← Quay lại
          </button>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-72 shrink-0">
        <RecentGenerationsPanel refreshKey={refreshKey} />
      </div>
    </div>
  );
}
