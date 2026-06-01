export const dynamic = "force-dynamic";

import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { getNiches } from "@/actions/niches";
import { NichesTable } from "@/components/niches/niches-table";
import { Plus } from "lucide-react";

export default async function NichesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; filter?: string }>;
}) {
  const { search, filter } = await searchParams;
  const niches = await getNiches(search, filter);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">
              Lĩnh vực
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {niches.length} lĩnh vực
            </p>
          </div>
          <Link
            href="/niches/new"
            className="flex items-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            Tạo lĩnh vực mới
          </Link>
        </div>

        {/* Table with search/filter */}
        <NichesTable niches={niches} search={search} filter={filter} />
      </div>
    </AppShell>
  );
}
