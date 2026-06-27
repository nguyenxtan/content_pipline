import { AppShell } from "@/components/layout/app-shell";
import { ScheduleMixerPanel } from "@/components/content/schedule-mixer-panel";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function PublishingMixerPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">Lập lịch trộn</h1>
          <p className="text-sm text-slate-400">
            Tạo hàng chờ đăng bằng cách trộn TTS Shorts và Quote Shorts. Không sinh video mới, không upload ngay. Cron sẽ đăng theo lịch.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Link href="/content/quotes" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700">
            <p className="text-sm font-medium text-slate-100">Tạo thêm Quote Shorts</p>
            <p className="mt-1 text-xs text-slate-500">
              Quote Short là video đã tạo ở Nội dung -&gt; Quote Shorts. Màn đó chỉ tạo video, không lập lịch.
            </p>
          </Link>
          <Link href="/publishing/queue" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700">
            <p className="text-sm font-medium text-slate-100">Xem hàng chờ</p>
            <p className="mt-1 text-xs text-slate-500">
              Sau khi tạo queue rows ở đây, vào Hàng chờ để theo dõi thứ tự đăng, nền tảng, kênh và trạng thái hiện tại.
            </p>
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs leading-relaxed text-slate-400">
          <p>TTS Short = video đã render sẵn từ pipeline TTS.</p>
          <p>Quote Short = video đã tạo ở Nội dung -&gt; Quote Shorts.</p>
          <p>Trang này chỉ tạo <code>upload_queue</code> rows cho video đã có sẵn.</p>
        </div>

        <ScheduleMixerPanel />
      </div>
    </AppShell>
  );
}
