/**
 * GET /api/tts/stream?file=test-123456.wav
 * Serve WAV/MP3 file từ media/audio/ với Range request support.
 * Dùng Buffer thay vì ReadableStream để tránh lỗi Node.js Readable cast trong Next.js App Router.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const AUDIO_DIR = path.join(process.cwd(), "media", "audio");

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const file = searchParams.get("file");
  const relPath = searchParams.get("path");

  if (!file && !relPath) return NextResponse.json({ error: "file required" }, { status: 400 });

  const requestedPath = relPath
    ? path
        .normalize(relPath)
        .replace(/^([/\\])+/, "")
        .replace(/^(\.\.(\/|\\|$))+/, "")
    : path.basename(file as string);
  const filePath = path.join(AUDIO_DIR, requestedPath);

  if (!filePath.startsWith(AUDIO_DIR)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File không tồn tại" }, { status: 404 });
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileSize = fileBuffer.length;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".mp3" ? "audio/mpeg" : "audio/wav";
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : fileSize - 1;
    const chunkSize = end - start + 1;
    const chunk = fileBuffer.slice(start, end + 1);

    return new Response(chunk, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      },
    });
  }

  return new Response(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    },
  });
}
