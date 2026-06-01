import { AppShell } from "@/components/layout/app-shell";
import { SchedulerPanel } from "@/components/content/scheduler-panel";
import { getNiches } from "@/actions/niches";
import { getSchedulerJobsAction } from "@/actions/content-generator";

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
          <h1 className="text-xl font-bold text-slate-100">Lập lịch tự động</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản lý lịch tạo content, chạy pipeline short và long tự động
          </p>
        </div>
        <SchedulerPanel initialJobs={schedulerJobs} niches={niches} />
      </div>
    </AppShell>
  );
}
