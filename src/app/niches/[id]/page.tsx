export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { getNicheById, getNiches } from "@/actions/niches";
import { NicheDetailTabs } from "@/components/niches/niche-detail-tabs";
import { ChevronLeft } from "lucide-react";

export default async function NicheDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const nicheId = parseInt(id, 10);
  if (isNaN(nicheId)) notFound();

  const [niche, allNiches] = await Promise.all([
    getNicheById(nicheId),
    getNiches(),
  ]);

  if (!niche) notFound();

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Back */}
        <Link
          href="/niches"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-100 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Danh sách lĩnh vực
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {niche.icon && (
                <span className="text-2xl leading-none">{niche.icon}</span>
              )}
              <h1 className="text-2xl font-bold text-slate-100">
                {niche.name}
              </h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  niche.isActive
                    ? "bg-green-500/15 text-green-400"
                    : "bg-slate-800/50 text-slate-400"
                }`}
              >
                {niche.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1 font-mono">
              /{niche.slug}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <NicheDetailTabs niche={niche} allNiches={allNiches} />
      </div>
    </AppShell>
  );
}
