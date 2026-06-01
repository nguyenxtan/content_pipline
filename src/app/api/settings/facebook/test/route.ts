import { NextResponse } from "next/server";
import { refreshFacebookEnvHealth } from "@/lib/social/facebook-api";

export async function GET() {
  const health = await refreshFacebookEnvHealth();
  return NextResponse.json(health, { status: health.ok ? 200 : 400 });
}
