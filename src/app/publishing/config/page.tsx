import { AppShell } from "@/components/layout/app-shell";
import { AutoScheduleConfigPanel } from "@/components/channels/auto-schedule-config-panel";
import { getChannelsAction } from "@/actions/social-channels";

export const dynamic = "force-dynamic";

export default async function PublishingConfigPage() {
  const channels = await getChannelsAction();
  const activeChannels = channels.filter((channel) => channel.isActive && !channel.needsReconnect);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">Cấu hình kênh</h1>
          <p className="text-sm text-slate-400">
            Chỉnh auto-schedule cho từng nhóm video và từng kênh. Màn này chỉ cấu hình lịch tự động, không theo dõi queue và không đăng bài ngay.
          </p>
        </div>
        <AutoScheduleConfigPanel channels={activeChannels} />
      </div>
    </AppShell>
  );
}
