/**
 * POST /api/tts/start  — docker compose up -d tts (cp_tts container)
 * POST /api/tts/stop   — docker stop cp_tts
 */
import { NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";

const PROJECT_ROOT = process.cwd();

export async function POST() {
  try {
    execSync("docker compose up -d tts", {
      cwd: PROJECT_ROOT,
      timeout: 30_000,
      stdio: "pipe",
    });

    // Đợi TTS load xong (tối đa 15s)
    const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const res = await fetch(`${TTS_API_URL}/health`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          const data = await res.json() as { status: string };
          if (data.status === "ok") {
            return NextResponse.json({ success: true, message: "TTS server started" });
          }
        }
      } catch { /* còn đang boot */ }
    }

    return NextResponse.json({ success: true, message: "Container started, TTS may still be loading" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
