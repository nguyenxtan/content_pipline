/**
 * POST /api/tts/test
 * Proxy test TTS → localhost:8765/tts (không cần lưu DB).
 * Body: { text: string; voice: string; contentId?: string }
 */
import { NextResponse } from "next/server";

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";

export async function POST(req: Request) {
  const { text, voice = "Ly", contentId } = await req.json() as {
    text: string;
    voice?: string;
    contentId?: string;
  };

  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const fileId = contentId ?? `tts-test-${Date.now()}`;

  try {
    const res = await fetch(`${TTS_API_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, content_id: fileId }),
      signal: AbortSignal.timeout(60_000),
    });

    const data = await res.json() as { success: boolean; duration_seconds?: number; path?: string; error?: string };
    if (!data.success) throw new Error(data.error ?? "TTS failed");

    return NextResponse.json({ success: true, audioFile: `${fileId}.wav`, duration: data.duration_seconds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
