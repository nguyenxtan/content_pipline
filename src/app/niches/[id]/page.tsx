export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { getNicheById } from "@/actions/niches";
import { NicheDetailTabs } from "@/components/niches/niche-detail-tabs";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { promptTemplates, contentPieces } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

async function getPromptsByNiche(nicheId: number) {
  return db.query.promptTemplates.findMany({
    where: (pt, { and, eq }) => and(eq(pt.nicheId, nicheId), eq(pt.isActive, true)),
    orderBy: (pt, { asc }) => [asc(pt.stage)],
  });
}

async function getContentByNiche(nicheId: number) {
  return db.query.contentPieces.findMany({
    where: (cp, { eq }) => eq(cp.nicheId, nicheId),
    orderBy: (cp, { desc }) => [desc(cp.updatedAt)],
    limit: 20,
  });
}

export default async function NicheDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const nicheId = parseInt(id, 10);
  if (isNaN(nicheId)) notFound();

  const [niche, prompts, pieces] = await Promise.all([
    getNicheById(nicheId),
    getPromptsByNiche(nicheId),
    getContentByNiche(nicheId),
  ]);

  if (!niche) notFound();

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Back */}
        <Link
          href="/niches"
          className="inline-flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Danh sách ngách
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {niche.icon && (
                <span className="text-2xl leading-none">{niche.icon}</span>
              )}
              <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
                {niche.name}
              </h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  niche.isActive
                    ? "bg-green-500/15 text-green-400"
                    : "bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))]"
                }`}
              >
                {niche.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1 font-mono">
              /{niche.slug}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <NicheDetailTabs niche={niche} prompts={prompts} pieces={pieces} />
      </div>
    </AppShell>
  );
}
