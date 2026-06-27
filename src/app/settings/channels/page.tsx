import { Suspense } from "react";
import { ChannelManagerClient } from "@/components/channels/channel-manager-client";
import { getChannelsAction } from "@/actions/social-channels";
import { getYoutubeOauthClientsAction, getYoutubeQuotaStatsAction } from "@/actions/youtube-clients";
import { refreshFacebookEnvHealth } from "@/lib/social/facebook-api";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

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

  // Determine canonical YouTube row per brand: the social_channel row with most upload_queue usage.
  // Both queries run in parallel. Fall back to null on error or no queue rows (first-connect).
  async function queryCanonical(channelKey: string): Promise<number | null> {
    try {
      const result = await db.execute(sql`
        SELECT uq.channel_id, COUNT(*) AS cnt
        FROM upload_queue uq
        JOIN content_generations cg ON cg.id = uq.content_id
        JOIN social_channels sc ON sc.id = uq.channel_id
        WHERE cg.channel_key = ${channelKey} AND sc.platform = 'youtube'
        GROUP BY uq.channel_id
        ORDER BY cnt DESC
        LIMIT 1
      `);
      if (result.rows.length > 0) {
        return Number((result.rows[0] as Record<string, unknown>).channel_id);
      }
    } catch {
      // non-fatal: fallback to null, UI will not show "queue badge" but will still function
    }
    return null;
  }

  const [canonicalPhatPhapScId, canonicalTangSauScId] = await Promise.all([
    queryCanonical("phat_phap"),
    queryCanonical("tang_sau"),
  ]);

  return (
    <Suspense>
      <ChannelManagerClient
        initialChannels={channels}
        initialOauthClients={oauthClients}
        initialQuotaStats={quotaStats}
        hasGoogleCreds={hasGoogleCreds}
        hasFacebookEnvConfig={hasFacebookEnvConfig}
        canonicalPhatPhapScId={canonicalPhatPhapScId}
        canonicalTangSauScId={canonicalTangSauScId}
      />
    </Suspense>
  );
}
