import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ScheduleClient } from "@/components/channels/schedule-client";
import { getUploadQueueAction, getReadyVideosAction } from "@/actions/social-channels";

export const dynamic = "force-dynamic";

export default async function PublishingPage() {
  const [allItems, readyVideos] = await Promise.all([
    getUploadQueueAction({ limit: 200 }),
    getReadyVideosAction(),
  ]);
  const items = allItems.filter(r => r.status !== "done");
  return (
    <AppShell>
      <Suspense>
        <ScheduleClient initialItems={items} initialReady={readyVideos} />
      </Suspense>
    </AppShell>
  );
}
