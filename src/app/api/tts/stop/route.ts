/**
 * POST /api/tts/stop — docker stop cp_tts
 */
import { NextResponse } from "next/server";
import { execSync } from "child_process";

export async function POST() {
  try {
    execSync("docker stop cp_tts", { timeout: 15_000, stdio: "pipe" });
    return NextResponse.json({ success: true, message: "TTS server stopped" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
