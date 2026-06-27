import { NextResponse } from "next/server";
import { runTTS } from "@/lib/pipeline/tts";

export async function POST(req: Request) {
  const { contentId, contentType = "short" } = await req.json() as {
    contentId: string;
    contentType?: "short";
  };
  if (!contentId) return NextResponse.json({ error: "contentId required" }, { status: 400 });

  const result = await runTTS(contentId, contentType);
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({
    success: true,
    audioPath: result.audioPath,
    ttsDurationMs: result.ttsDurationMs,
    contentType,
  });
}
