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
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
              Ngách nội dung
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              {niches.length} ngách
            </p>
          </div>
          <Link
            href="/niches/new"
            className="flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            Tạo ngách mới
          </Link>
        </div>

        {/* Table with search/filter */}
        <NichesTable niches={niches} search={search} filter={filter} />
      </div>
    </AppShell>
  );
}
