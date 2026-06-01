import { SettingsClient } from "@/components/settings/settings-client";
import { getUsageSummaryAction } from "@/actions/ai-usage";
import { AI_MODELS, PROVIDER_META } from "@/lib/ai-models";

export default async function TokensPage() {
  const usage = await getUsageSummaryAction(30);
  return (
    <SettingsClient
      usage={usage}
      models={AI_MODELS}
      providerMeta={PROVIDER_META}
    />
  );
}
