import { AppShell } from "@/components/layout/app-shell";
import { ContentGallery } from "@/components/content/content-gallery";
import { getNiches } from "@/actions/niches";
import { getContentGenerationsAction } from "@/actions/content-generator";

export const dynamic = "force-dynamic";

export default async function GalleryLongPage() {
  const [niches, initialData] = await Promise.all([
    getNiches(),
    getContentGenerationsAction({ page: 1, perPage: 30, sortBy: "newest", contentType: "long" }),
  ]);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Video dài</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {initialData.total} bài · pipeline: TTS → Video → Đăng · ~15-30 phút
            </p>
          </div>
          <a
            href="/content"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-500 transition-colors"
          >
            + Tạo mới
          </a>
        </div>
        <ContentGallery niches={niches} initialData={initialData} initialTab="long" />
      </div>
    </AppShell>
  );
}
