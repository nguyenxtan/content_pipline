import { getAiMaxUsageSummaryAction, listAiMaxUsageRequestsAction } from "@/actions/aimax-usage";
import { AiMaxUsageClient } from "@/components/settings/aimax-usage-client";

export const dynamic = "force-dynamic";

export default async function AiMaxUsagePage() {
  const [summaryResult, listResult] = await Promise.all([
    getAiMaxUsageSummaryAction({}),
    listAiMaxUsageRequestsAction({ limit: 50, offset: 0 }),
  ]);

  return (
    <AiMaxUsageClient
      initialSummary={summaryResult}
      initialList={listResult}
    />
  );
}
