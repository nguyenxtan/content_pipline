import { NextResponse } from "next/server";
import { runImages } from "@/lib/pipeline/images";

export async function POST(req: Request) {
  const { contentId } = await req.json() as { contentId: string };
  if (!contentId) return NextResponse.json({ error: "contentId required" }, { status: 400 });

  const result = await runImages(contentId);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({
    success: true,
    imagePaths: result.imagePaths,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
  });
}
