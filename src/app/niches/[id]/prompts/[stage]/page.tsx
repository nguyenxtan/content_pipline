import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PromptEditor } from "@/components/prompts/prompt-editor";
import { getNicheById } from "@/actions/niches";
import {
  getActivePromptTemplate,
  getPromptVersions,
} from "@/actions/prompts";
import { STAGE_LABELS } from "@/types";
import type { Stage } from "@/types";

export const dynamic = "force-dynamic";

export default async function PromptEditorPage({
  params,
}: {
  params: Promise<{ id: string; stage: string }>;
}) {
  const { id, stage } = await params;
  const nicheId = parseInt(id);

  if (isNaN(nicheId)) notFound();

  const [niche, activeTemplate, versions] = await Promise.all([
    getNicheById(nicheId),
    getActivePromptTemplate(nicheId, stage),
    getPromptVersions(nicheId, stage),
  ]);

  if (!niche) notFound();

  const stageLabel = STAGE_LABELS[stage as Stage] ?? stage;

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <Link
            href={`/niches/${id}`}
            className="inline-flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            {niche.name}
          </Link>
          <span className="text-[hsl(var(--muted-foreground))]">/</span>
          <span className="text-sm text-[hsl(var(--foreground))]">
            {stageLabel}
          </span>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
            Prompt — {stageLabel}
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            {activeTemplate
              ? `Version hiện tại: v${activeTemplate.version} — ${activeTemplate.name}`
              : "Chưa có template — tạo version đầu tiên"}
          </p>
        </div>

        <PromptEditor
          niche={niche}
          stage={stage}
          template={activeTemplate}
          versions={versions}
        />
      </div>
    </AppShell>
  );
}
