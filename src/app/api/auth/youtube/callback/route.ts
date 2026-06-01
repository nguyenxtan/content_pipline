import { NextResponse } from "next/server";
import { connectYouTubeChannel } from "@/lib/social/youtube-api";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  if (error || !code) {
    return NextResponse.redirect(new URL("/settings/channels?error=access_denied", req.url));
  }

  const clientConfigId = state ? Number(state) || undefined : undefined;
  const result = await connectYouTubeChannel(code, clientConfigId);
  if ("error" in result) {
    const msg = encodeURIComponent(result.error);
    return NextResponse.redirect(new URL(`/settings/channels?error=${msg}`, req.url));
  }

  return NextResponse.redirect(new URL("/settings/channels?connected=youtube", req.url));
}
