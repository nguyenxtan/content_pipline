import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PublishingAnalyticsClient } from "@/components/channels/publishing-analytics-client";
import {
  getTopicCoverageReportAction,
  getPublishingAnalyticsAction,
  getTopicPerformanceAction,
  getTopicPerformanceSummaryAction,
  getHookPerformanceAction,
  getStrategicFamilyCoverageAction,
} from "@/actions/publishing-analytics";

export const dynamic = "force-dynamic";

export default async function PublishingAnalyticsPage() {
  const [data, topics, topicSummary, topicCoverage, hookPerformance, strategicCoverage] = await Promise.all([
    getPublishingAnalyticsAction({
      platform: "youtube",
      limit: 120,
    }),
    getTopicPerformanceAction({
      platform: "youtube",
      limit: 50,
    }),
    getTopicPerformanceSummaryAction({
      platform: "youtube",
      limit: 100,
    }),
    getTopicCoverageReportAction({
      platform: "youtube",
      limit: 100,
    }),
    getHookPerformanceAction({
      platform: "youtube",
      limit: 100,
    }),
    getStrategicFamilyCoverageAction(),
  ]);

  return (
    <AppShell>
      <Suspense>
        <PublishingAnalyticsClient
          initialData={data}
          initialTopics={topics}
          initialTopicSummary={topicSummary}
          initialTopicCoverage={topicCoverage}
          initialHookPerformance={hookPerformance}
          initialStrategicCoverage={strategicCoverage}
        />
      </Suspense>
    </AppShell>
  );
}
