import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PublishingQueueClient } from "@/components/channels/publishing-queue-client";
import { getUploadQueueAction } from "@/actions/social-channels";

export const dynamic = "force-dynamic";

export default async function PublishingQueuePage() {
  const items = await getUploadQueueAction({ limit: 300 });

  return (
    <AppShell>
      <Suspense>
        <PublishingQueueClient initialItems={items} />
      </Suspense>
    </AppShell>
  );
}
