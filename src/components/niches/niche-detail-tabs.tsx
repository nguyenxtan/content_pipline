"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useActionState } from "react";
import { toast } from "sonner";
import { updateNicheAction, deleteNicheAction } from "@/actions/niches";
import { NicheForm } from "./niche-form";
import type { Niche, PromptTemplate, ContentPiece } from "@/lib/db/schema";
import { STAGE_LABELS } from "@/types";
import type { Stage } from "@/types";

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as Stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);
}
import { Pencil, Plus, FileText, Loader2, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { STATUS_LABELS } from "@/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const TABS = ["Thông tin", "Prompts", "Nội dung"] as const;
type Tab = (typeof TABS)[number];

// use niche.stages at runtime — fallback for legacy records without stages

interface NicheDetailTabsProps {
  niche: Niche;
  prompts: PromptTemplate[];
  pieces: ContentPiece[];
}

export function NicheDetailTabs({
  niche,
  prompts,
  pieces,
}: NicheDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Thông tin");
  const [isPending, startTransition] = useTransition();

  const boundUpdateAction = updateNicheAction.bind(null, niche.id);

  function handleDelete() {
    startTransition(async () => {
      await deleteNicheAction(niche.id);
    });
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-[hsl(var(--border))]">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]"
                : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            {tab}
          </button>
        ))}

        {/* Delete button far right */}
        <div className="ml-auto pb-1">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={isPending}
                className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-[hsl(var(--muted-foreground))] hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Xóa ngách
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-[hsl(var(--card))] border-[hsl(var(--border))]">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-[hsl(var(--foreground))]">
                  Xóa ngách?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-[hsl(var(--muted-foreground))]">
                  Xóa vĩnh viễn{" "}
                  <strong className="text-[hsl(var(--foreground))]">
                    {niche.name}
                  </strong>{" "}
                  và toàn bộ prompt templates. Không thể hoàn tác.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[hsl(var(--border))] text-[hsl(var(--foreground))]">
                  Hủy
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  Xóa
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Tab: Thông tin */}
      {activeTab === "Thông tin" && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
          <NicheForm
            niche={niche}
            action={boundUpdateAction}
            submitLabel="Lưu thay đổi"
          />
        </div>
      )}

      {/* Tab: Prompts */}
      {activeTab === "Prompts" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {niche.stages.length} prompt stages cho pipeline content
            </p>
            <Link
              href={`/agent?niche_id=${niche.id}`}
              className="flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Agent gợi ý
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(niche.stages ?? ["ideation", "script", "short", "long"]).map((stage) => {
              const prompt = prompts.find((p) => p.stage === stage);
              return (
                <div
                  key={stage}
                  className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        {stage}
                      </p>
                      <h3 className="mt-1 font-medium text-[hsl(var(--foreground))]">
                        {stageLabel(stage)}
                      </h3>
                    </div>
                    {prompt ? (
                      <Link
                        href={`/niches/${niche.id}/prompts/${stage}`}
                        className="flex items-center gap-1 rounded-md border border-[hsl(var(--border))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] transition-colors whitespace-nowrap"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Link>
                    ) : (
                      <Link
                        href={`/niches/${niche.id}/prompts/${stage}`}
                        className="flex items-center gap-1 rounded-md bg-[hsl(var(--primary))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity whitespace-nowrap"
                      >
                        <Plus className="h-3 w-3" />
                        Tạo
                      </Link>
                    )}
                  </div>

                  {prompt ? (
                    <div className="mt-3 space-y-1">
                      <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                        {prompt.name}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        v{prompt.version} · {prompt.model}
                      </p>
                      <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))] line-clamp-2">
                        {prompt.content.slice(0, 120)}…
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-md border border-dashed border-[hsl(var(--border))] py-4 text-center">
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        Chưa có prompt
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: Nội dung */}
      {activeTab === "Nội dung" && (
        <div className="space-y-4">
          {pieces.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[hsl(var(--border))] py-16">
              <FileText className="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
              <p className="text-[hsl(var(--muted-foreground))]">
                Chưa có nội dung nào
              </p>
              <Link
                href="/content"
                className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-[hsl(var(--primary-foreground))] hover:opacity-90"
              >
                Tạo nội dung mới
              </Link>
            </div>
          ) : (
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="px-4 py-3 text-left font-medium text-[hsl(var(--muted-foreground))]">
                      Tiêu đề
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-[hsl(var(--muted-foreground))]">
                      Trạng thái
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-[hsl(var(--muted-foreground))]">
                      Cập nhật
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pieces.map((piece) => (
                    <tr
                      key={piece.id}
                      className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--accent))]/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/content/${piece.id}`}
                          className="font-medium text-[hsl(var(--foreground))] hover:underline"
                        >
                          {piece.title ?? `Piece #${piece.id}`}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--secondary-foreground))]">
                          {STATUS_LABELS[piece.status as keyof typeof STATUS_LABELS] ?? piece.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                        {formatDate(piece.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
