import { AppShell } from "@/components/layout/app-shell";
import { SchedulerPanel } from "@/components/content/scheduler-panel";
import { getNiches } from "@/actions/niches";
import { getSchedulerJobsAction } from "@/actions/content-generator";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SchedulerPage() {
  const [niches, schedulerJobs] = await Promise.all([
    getNiches(),
    getSchedulerJobsAction(),
  ]);

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Lập lịch pipeline</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản lý job tạo content và pipeline render. Nếu muốn lập lịch đăng TTS / Quote đã tạo sẵn, dùng Đăng bài -&gt; Lập lịch trộn.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Link href="/content/gallery" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700">
            <p className="text-sm font-medium text-slate-100">TTS Shorts</p>
            <p className="mt-1 text-xs text-slate-500">Review video TTS đã tạo hoặc cần render tiếp.</p>
          </Link>
          <Link href="/content/quotes" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700">
            <p className="text-sm font-medium text-slate-100">Quote Shorts</p>
            <p className="mt-1 text-xs text-slate-500">Tạo hoặc review Quote Short đã render. Đây là nơi tạo video, không phải nơi đăng.</p>
          </Link>
          <Link href="/publishing/mixer" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700">
            <p className="text-sm font-medium text-slate-100">Lập lịch đăng TTS / Quote</p>
            <p className="mt-1 text-xs text-slate-500">Tạo hàng chờ đăng bằng cách trộn video đã có sẵn. Không upload ngay.</p>
          </Link>
        </div>
        <SchedulerPanel initialJobs={schedulerJobs} niches={niches} />
      </div>
    </AppShell>
  );
}
