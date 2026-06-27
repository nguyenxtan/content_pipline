import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PublishingErrorsClient } from "@/components/channels/publishing-errors-client";
import { getUploadQueueAction } from "@/actions/social-channels";

export const dynamic = "force-dynamic";

export default async function PublishingErrorsPage() {
  const items = await getUploadQueueAction({ limit: 300 });

  return (
    <AppShell>
      <Suspense>
        <PublishingErrorsClient initialItems={items.filter((item) => item.status === "error")} />
      </Suspense>
    </AppShell>
  );
}
