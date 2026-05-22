"use client";

import { useState } from "react";
import type { Niche } from "@/lib/db/schema";
import type { GeneratedContentResult, SchedulerJobRecord } from "@/lib/validations/content-generator";
import { generateContentAction } from "@/actions/content-generator";
import { ContentGeneratorForm } from "./content-generator-form";
import { GenerationProgress } from "./generation-progress";
import { ContentTable } from "./content-table";
import { SchedulerPanel } from "./scheduler-panel";

type Phase = "form" | "generating" | "results" | "error";

interface Props {
  niches: Niche[];
  initialSchedulerJobs: SchedulerJobRecord[];
}

export function ContentGeneratorMain({ niches, initialSchedulerJobs }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<GeneratedContentResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastNicheId, setLastNicheId] = useState<number | undefined>();

  const handleGenerate = async (nicheId: number, topic: string) => {
    setLastNicheId(nicheId);
    setPhase("generating");
    setIsLoading(true);
    setErrorMsg("");

    const res = await generateContentAction(nicheId, topic);

    if ("error" in res) {
      setErrorMsg(res.error);
      setPhase("error");
      setIsLoading(false);
      return;
    }

    setResult(res);
    setPhase("results");
    setIsLoading(false);
  };

  const handleNew = () => {
    setPhase("form");
    setResult(null);
    setErrorMsg("");
    setIsLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Form */}
      {(phase === "form" || phase === "error") && (
        <>
          <ContentGeneratorForm
            niches={niches}
            initialNicheId={lastNicheId}
            onSubmit={handleGenerate}
            isLoading={isLoading}
          />
          {phase === "error" && (
            <div className="max-w-2xl bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm font-medium text-red-700">Lỗi tạo nội dung</p>
              <p className="text-sm text-red-600 mt-1">{errorMsg}</p>
            </div>
          )}
        </>
      )}

      {/* Progress */}
      <GenerationProgress isVisible={phase === "generating"} />

      {/* Results */}
      {phase === "results" && result && (
        <ContentTable {...result} onNewGeneration={handleNew} />
      )}

      {/* Scheduler */}
      <SchedulerPanel initialJobs={initialSchedulerJobs} niches={niches} />
    </div>
  );
}
