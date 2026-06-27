import { NextResponse } from "next/server";
import { runLongImages } from "@/lib/pipeline/long-images";

export async function POST(req: Request) {
  const { contentId } = await req.json() as { contentId: string };
  if (!contentId) return NextResponse.json({ error: "contentId required" }, { status: 400 });

  const result = await runLongImages(contentId);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({
    success: true,
    imagePaths: result.imagePaths,
    thumbnailPath: result.thumbnailPath,
    seoDescription: result.seoDescription,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
  });
}
