"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { updateNicheAction, deleteNicheAction } from "@/actions/niches";
import { NicheForm } from "./niche-form";
import type { Niche } from "@/lib/db/schema";
import { ContentGeneratorMain } from "@/components/content/content-generator-main";
import { Trash2 } from "lucide-react";
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

const TABS = ["Thông tin", "Tạo content"] as const;
type Tab = (typeof TABS)[number];

interface NicheDetailTabsProps {
  niche: Niche;
  allNiches: Niche[];
}

export function NicheDetailTabs({ niche, allNiches }: NicheDetailTabsProps) {
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
      <div className="flex items-center gap-1 border-b border-slate-700">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-rose-500 text-slate-100"
                : "border-transparent text-slate-400 hover:text-slate-100"
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
                className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Xóa lĩnh vực
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-slate-900 border-slate-700">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-slate-100">
                  Xóa lĩnh vực?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400">
                  Xóa vĩnh viễn{" "}
                  <strong className="text-slate-100">{niche.name}</strong>{" "}
                  và toàn bộ prompt templates. Không thể hoàn tác.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-slate-700 text-slate-100">
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
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
          <NicheForm
            niche={niche}
            action={boundUpdateAction}
            submitLabel="Lưu thay đổi"
          />
        </div>
      )}

      {/* Tab: Tạo content */}
      {activeTab === "Tạo content" && (
        <ContentGeneratorMain niches={allNiches} initialNicheId={niche.id} />
      )}
    </div>
  );
}
