import { getAiMaxSettingsPageDataAction } from "@/actions/aimax-settings";
import { AiMaxSettingsClient } from "@/components/settings/aimax-settings-client";

export const dynamic = "force-dynamic";

export default async function AiMaxSettingsPage() {
  const data = await getAiMaxSettingsPageDataAction();
  return <AiMaxSettingsClient initialData={data} />;
}
