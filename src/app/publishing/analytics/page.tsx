import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PublishingAnalyticsClient } from "@/components/channels/publishing-analytics-client";
import { getPublishingAnalyticsAction } from "@/actions/publishing-analytics";

export const dynamic = "force-dynamic";

export default async function PublishingAnalyticsPage() {
  const data = await getPublishingAnalyticsAction({
    platform: "youtube",
    limit: 120,
  });

  return (
    <AppShell>
      <Suspense>
        <PublishingAnalyticsClient initialData={data} />
      </Suspense>
    </AppShell>
  );
}
