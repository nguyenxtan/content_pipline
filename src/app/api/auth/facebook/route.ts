import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Facebook OAuth disabled. Use env-based config: FACEBOOK_PAGE_ID + FACEBOOK_PAGE_ACCESS_TOKEN." },
    { status: 410 },
  );
}
