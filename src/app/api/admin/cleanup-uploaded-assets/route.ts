import { NextResponse } from "next/server";
import { cleanupUploadedAssetsAction } from "@/actions/cleanup-uploaded-assets";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_API_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as {
    dryRun?: boolean;
    limit?: number;
  };

  const result = await cleanupUploadedAssetsAction({
    dryRun: body.dryRun !== false,
    limit: body.limit,
  });

  return NextResponse.json({ ok: true, ...result });
}
