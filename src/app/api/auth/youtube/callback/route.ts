import { NextResponse } from "next/server";
import { connectYouTubeChannel, decodeYouTubeAuthState } from "@/lib/social/youtube-api";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  if (error || !code) {
    return NextResponse.redirect(new URL("/settings/channels?error=access_denied", req.url));
  }

  const decodedState = decodeYouTubeAuthState(state);
  const result = await connectYouTubeChannel(
    code,
    decodedState.clientConfigId,
    decodedState.channelKey,
    decodedState.targetPlatformChannelId,
  );
  if ("error" in result) {
    const msg = encodeURIComponent(result.error);
    return NextResponse.redirect(new URL(`/settings/channels?error=${msg}`, req.url));
  }

  const redirectUrl = new URL("/settings/channels", req.url);
  redirectUrl.searchParams.set("connected", "youtube");
  if (decodedState.channelKey) {
    redirectUrl.searchParams.set("channelKey", decodedState.channelKey);
  }
  return NextResponse.redirect(redirectUrl);
}
