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
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-100 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Quay lại danh sách
        </Link>

        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            Tạo lĩnh vực mới
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Điền thông tin để tạo lĩnh vực nội dung YouTube mới
          </p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
          <NicheForm action={createNicheAction} submitLabel="Tạo lĩnh vực" />
        </div>
      </div>
    </AppShell>
  );
}
