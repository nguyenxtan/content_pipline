import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceList } from "@/components/content/workspace-list";
import {
  getChannelWorkspacesAction,
  getWorkspaceDashboardAction,
  getWorkspaceTopicFamiliesAction,
} from "@/actions/channel-workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const workspaces = await getChannelWorkspacesAction();
  const dashboard = await getWorkspaceDashboardAction();

  const familiesByWorkspace = Object.fromEntries(
    await Promise.all(
      workspaces.map(async (w) => [
        w.workspaceId,
        await getWorkspaceTopicFamiliesAction(w.workspaceId),
      ]),
    ),
  );

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Channel Workspaces</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Mỗi workspace gắn một kênh với prompt profile, topic plan, format mix và lịch đăng mặc định.
            Quote generator và Schedule Mixer có thể chọn workspace để tự điền các thông số phù hợp.
          </p>
        </div>

        <WorkspaceList
          workspaces={workspaces}
          familiesByWorkspace={familiesByWorkspace}
          summaries={dashboard.summaries}
          scheduleItems={dashboard.scheduleItems}
          tangSauQueuedReview={dashboard.tangSauQueuedReview}
        />
      </div>
    </AppShell>
  );
}
