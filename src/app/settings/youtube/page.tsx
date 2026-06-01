import { Suspense } from "react";
import { YoutubeSettingsClient } from "@/components/settings/youtube-settings-client";
import { isYoutubeConnected } from "@/lib/youtube/client";

export const dynamic = "force-dynamic";

export default async function YoutubeSettingsPage() {
  const connected = await isYoutubeConnected();
  return (
    <Suspense>
      <YoutubeSettingsClient connected={connected} />
    </Suspense>
  );
}
