import { AppShell } from "@/components/layout/app-shell";
import { ContentGeneratorMain } from "@/components/content/content-generator-main";
import { getNiches } from "@/actions/niches";

export const dynamic = "force-dynamic";

export default async function ContentPage() {
  const niches = await getNiches();

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Content Generator</h1>
          <p className="text-sm text-gray-500 mt-1">
            Chọn lĩnh vực + nhập chủ đề → tạo script, short và long content
          </p>
        </div>
        <ContentGeneratorMain niches={niches} />
      </div>
    </AppShell>
  );
}
