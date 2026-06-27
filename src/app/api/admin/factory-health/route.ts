import { NextResponse } from "next/server";
import { getFactoryHealthAction } from "@/actions/factory-health";
import { isAuthenticated } from "@/lib/auth";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_API_SECRET;

  // `/api/admin` is intentionally public at the middleware layer, so each admin
  // route must enforce its own auth. Accept either the shared Bearer secret or
  // an authenticated admin session cookie from the app.
  const hasBearerAuth = Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`);
  const hasAdminSession = await isAuthenticated();

  if (!hasBearerAuth && !hasAdminSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getFactoryHealthAction();
  return NextResponse.json(payload);
}
