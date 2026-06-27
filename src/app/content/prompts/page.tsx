import { AppShell } from "@/components/layout/app-shell";
import { PromptStudioClient } from "@/components/content/prompt-studio-client";
import { getPromptStudioSnapshotAction } from "@/actions/prompt-studio";

export const dynamic = "force-dynamic";

export default async function ContentPromptsPage() {
  const data = await getPromptStudioSnapshotAction();

  return (
    <AppShell>
      <PromptStudioClient data={data} />
    </AppShell>
  );
}
