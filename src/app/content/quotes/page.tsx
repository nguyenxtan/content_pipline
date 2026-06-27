import { AppShell } from "@/components/layout/app-shell";
import { QuoteShortsManager } from "@/components/content/quote-shorts-manager";
import { QuoteGeneratorPanel } from "@/components/content/quote-generator-panel";
import { getLegacyQuoteSamplesAction } from "@/actions/quote-shorts";

export const dynamic = "force-dynamic";

export default async function QuoteShortsPage() {
  const data = await getLegacyQuoteSamplesAction();

  return (
    <AppShell>
      <div className="space-y-6">
        <QuoteGeneratorPanel />
        <QuoteShortsManager samples={data.samples} />
      </div>
    </AppShell>
  );
}
