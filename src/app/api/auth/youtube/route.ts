import { NextResponse } from "next/server";
import { getYouTubeAuthUrl } from "@/lib/social/youtube-api";
import { normalizeChannelKey } from "@/lib/config/channel-configs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientConfigId = searchParams.get("clientConfigId")
    ? Number(searchParams.get("clientConfigId"))
    : undefined;
  const channelKey = normalizeChannelKey(searchParams.get("channelKey")) ?? undefined;
  const targetPlatformChannelId = searchParams.get("targetPlatformChannelId")?.trim() || undefined;

  // Allow env-based flow OR stored-client flow
  const hasEnvCreds = !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
  if (!hasEnvCreds && !clientConfigId) {
    return NextResponse.json(
      { error: "Chưa cấu hình YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET" },
      { status: 500 }
    );
  }

  const url = await getYouTubeAuthUrl(clientConfigId, channelKey, targetPlatformChannelId);
  return NextResponse.redirect(url);
}
