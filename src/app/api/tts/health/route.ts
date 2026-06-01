/**
 * GET /api/tts/health
 * Server-side proxy → http://localhost:8765/health + /queue
 * Tránh CORS khi browser gọi thẳng TTS server.
 */
import { NextResponse } from "next/server";

const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";

export async function GET() {
  try {
    const [healthRes, queueRes] = await Promise.all([
      fetch(`${TTS_API_URL}/health`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${TTS_API_URL}/queue`,  { signal: AbortSignal.timeout(3000) }).catch(() => null),
    ]);

    if (!healthRes.ok) {
      return NextResponse.json({ online: false }, { status: 200 });
    }

    const health = await healthRes.json() as { status: string; tts_engine: string };
    const queue  = queueRes?.ok ? await queueRes.json() as { queue?: { pending: number; done: number; error: number } } : null;

    return NextResponse.json({
      online: health.status === "ok",
      engine: health.tts_engine,
      queue:  queue?.queue ?? null,
    });
  } catch {
    return NextResponse.json({ online: false }, { status: 200 });
  }
}
