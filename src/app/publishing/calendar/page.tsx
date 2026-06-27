import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PublishingCalendarView } from "@/components/channels/publishing-calendar-view";
import { getUploadQueueAction } from "@/actions/social-channels";

export const dynamic = "force-dynamic";

export default async function PublishingCalendarPage() {
  const items = (await getUploadQueueAction({ limit: 300 }))
    .filter((item) => item.status !== "cancelled");

  return (
    <AppShell>
      <Suspense>
        <PublishingCalendarView initialItems={items} />
      </Suspense>
    </AppShell>
  );
}
