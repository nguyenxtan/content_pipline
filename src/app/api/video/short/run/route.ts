import { NextResponse } from "next/server";
import { runShortVideo } from "@/lib/pipeline/short-video";

export async function POST(req: Request) {
  const { contentId } = (await req.json()) as { contentId?: string };
  if (!contentId) return NextResponse.json({ error: "contentId required" }, { status: 400 });

  const result = await runShortVideo(contentId);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({
    success: true,
    videoPath: result.videoPath,
    durationMs: result.durationMs,
  });
}
