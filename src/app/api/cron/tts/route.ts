/**
 * POST /api/cron/tts
 * Cron job: chạy TTS cho các content đang ở trạng thái pending.
 * Xử lý 1 item mỗi lần để không quá tải M4.
 *
 * TTS server (Python FastAPI) phải đang chạy tại TTS_API_URL (mặc định: http://localhost:8765)
 *
 * Test: curl -X POST http://localhost:3000/api/cron/tts
 * Status: curl http://localhost:3000/api/cron/tts
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentGenerations, niches } from "@/lib/db/schema";
import { eq, and, isNull, or } from "drizzle-orm";
import path from "path";

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const TTS_API_URL = process.env.TTS_API_URL ?? "http://localhost:8765";
const MEDIA_ROOT = path.join(process.cwd(), "media");

export async function POST(req: Request) {
  // Auth (bỏ qua khi dev + không cấu hình CRON_SECRET)
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Lấy 1 item pending TTS
  const item = await db.query.contentGenerations.findFirst({
    where: and(
      or(
        eq(contentGenerations.ttsStatus, "pending"),
        isNull(contentGenerations.ttsStatus)
      ),
      eq(contentGenerations.status, "completed")
    ),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });

  if (!item) {
    return NextResponse.json({ message: "Không có item nào cần TTS", processed: 0 });
  }

  // Lấy voice từ niche config
  const niche = await db.query.niches.findFirst({
    where: eq(niches.id, item.nicheId),
  });
  const ttsVoice = (niche as { ttsVoice?: string | null } | undefined)?.ttsVoice ?? "Ly";
  const videoType = (niche as { videoType?: string | null } | undefined)?.videoType ?? "both";

  // Mark as processing
  await db
    .update(contentGenerations)
    .set({ ttsStatus: "processing" })
    .where(eq(contentGenerations.id, item.id));

  const outputPath = path.join(MEDIA_ROOT, "audio", `${item.id}.wav`);

  try {
    // Chọn text dựa theo videoType của niche
    // "short" → chỉ short content, "long" → chỉ long content, "both" → short trước
    const text = videoType === "long" ? item.longContent : item.shortContent;

    const res = await fetch(`${TTS_API_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        output_path: outputPath,
        content_id: item.id,
        voice: ttsVoice,
      }),
      signal: AbortSignal.timeout(10 * 60 * 1000), // 10 phút
    });

    if (!res.ok) {
      throw new Error(`TTS API error ${res.status}: ${await res.text()}`);
    }

    const result = await res.json() as {
      success: boolean;
      path: string;
      duration_seconds?: number;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error ?? "TTS thất bại");
    }

    await db
      .update(contentGenerations)
      .set({
        ttsStatus: "done",
        audioPath: result.path,
        ttsErrorMessage: null,
      })
      .where(eq(contentGenerations.id, item.id));

    return NextResponse.json({
      message: "TTS thành công",
      processed: 1,
      contentId: item.id,
      topic: item.topic,
      voice: ttsVoice,
      audioPath: result.path,
      durationSeconds: result.duration_seconds,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(contentGenerations)
      .set({ ttsStatus: "error", ttsErrorMessage: message })
      .where(eq(contentGenerations.id, item.id));
    console.error(`[TTS Cron] Error for ${item.id}:`, message);
    return NextResponse.json({ error: message, contentId: item.id }, { status: 500 });
  }
}

export async function GET() {
  // Status queue
  const [pending, processing, done, error] = await Promise.all([
    db.$count(contentGenerations, eq(contentGenerations.ttsStatus, "pending")),
    db.$count(contentGenerations, eq(contentGenerations.ttsStatus, "processing")),
    db.$count(contentGenerations, eq(contentGenerations.ttsStatus, "done")),
    db.$count(contentGenerations, eq(contentGenerations.ttsStatus, "error")),
  ]);

  let ttsServerOnline = false;
  try {
    const ping = await fetch(`${TTS_API_URL}/health`, { signal: AbortSignal.timeout(3000) });
    ttsServerOnline = ping.ok;
  } catch { ttsServerOnline = false; }

  return NextResponse.json({
    queue: { pending, processing, done, error },
    ttsServer: { url: TTS_API_URL, online: ttsServerOnline },
  });
}
