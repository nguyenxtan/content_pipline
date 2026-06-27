import { getCostDashboardSummaryAction, listVideoCostBreakdownAction } from "@/actions/cost-dashboard";
import { CostDashboardClient } from "@/components/dashboard/cost-dashboard-client";

export const dynamic = "force-dynamic";

export default async function CostDashboardPage() {
  const [summaryResult, listResult] = await Promise.all([
    getCostDashboardSummaryAction({}),
    listVideoCostBreakdownAction({ limit: 50, offset: 0 }),
  ]);

  return <CostDashboardClient initialSummary={summaryResult} initialList={listResult} />;
}
