import { AppShell } from "@/components/layout/app-shell";
import { ContentGallery } from "@/components/content/content-gallery";
import { getNiches } from "@/actions/niches";
import { getContentGenerationsAction } from "@/actions/content-generator";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const [niches, initialData] = await Promise.all([
    getNiches(),
    getContentGenerationsAction({ page: 1, perPage: 20, sortBy: "newest" }),
  ]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Content Gallery</h1>
            <p className="text-sm text-gray-500 mt-1">
              {initialData.total} nội dung · Nhóm theo topic · Theo dõi TTS + YouTube
            </p>
          </div>
          <a
            href="/content"
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Tạo mới
          </a>
        </div>
        <ContentGallery niches={niches} initialData={initialData} />
      </div>
    </AppShell>
  );
}
