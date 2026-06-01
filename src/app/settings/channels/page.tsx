import { Suspense } from "react";
import { ChannelManagerClient } from "@/components/channels/channel-manager-client";
import { getChannelsAction } from "@/actions/social-channels";
import { getYoutubeOauthClientsAction, getYoutubeQuotaStatsAction } from "@/actions/youtube-clients";
import { refreshFacebookEnvHealth } from "@/lib/social/facebook-api";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const hasFacebookEnvConfig = !!(process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_ACCESS_TOKEN);
  if (hasFacebookEnvConfig) {
    await refreshFacebookEnvHealth().catch(() => null);
  }

  const [channels, oauthClients, quotaStats] = await Promise.all([
    getChannelsAction(),
    getYoutubeOauthClientsAction(),
    getYoutubeQuotaStatsAction(),
  ]);
  const hasGoogleCreds = !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);

  return (
    <Suspense>
      <ChannelManagerClient
        initialChannels={channels}
        initialOauthClients={oauthClients}
        initialQuotaStats={quotaStats}
        hasGoogleCreds={hasGoogleCreds}
        hasFacebookEnvConfig={hasFacebookEnvConfig}
      />
    </Suspense>
  );
}
