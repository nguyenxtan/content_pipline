import { ImagesSettingsClient } from "@/components/settings/images-settings-client";
import { getImageConfig } from "@/actions/app-config";
import { AI_MODELS } from "@/lib/ai-models";

export default async function ImagesSettingsPage() {
  const config = await getImageConfig();
  return (
    <ImagesSettingsClient
      currentLlmModel={config.llmModel}
      currentFalModel={config.falModel}
      currentCount={config.numImages}
      currentSteps={config.steps}
      models={AI_MODELS}
    />
  );
}
