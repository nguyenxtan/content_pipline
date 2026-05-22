import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { NicheForm } from "@/components/niches/niche-form";
import { createNicheAction } from "@/actions/niches";
import { ChevronLeft } from "lucide-react";

export default function NewNichePage() {
  return (
    <AppShell>
      <div className="space-y-6">
        {/* Back link */}
        <Link
          href="/niches"
          className="inline-flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Quay lại danh sách
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
            Tạo ngách mới
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Điền thông tin để tạo ngách nội dung YouTube mới
          </p>
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
          <NicheForm action={createNicheAction} submitLabel="Tạo ngách" />
        </div>
      </div>
    </AppShell>
  );
}
