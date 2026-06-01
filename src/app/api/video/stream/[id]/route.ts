/**
 * GET /api/video/stream/[id]?type=short|thumb
 * Serve video MP4 hoặc thumbnail JPG từ media/videos/ với Range support.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const VIDEOS_DIR = path.join(process.cwd(), "media", "videos");

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const type = new URL(req.url).searchParams.get("type") ?? "short";

  const safeName = type === "thumb"
    ? `${path.basename(id)}-short-thumb.jpg`
    : type === "long"
    ? `${path.basename(id)}-long.mp4`
    : `${path.basename(id)}-short.mp4`;

  const filePath = path.join(VIDEOS_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File không tồn tại" }, { status: 404 });
  }

  const isVideo   = safeName.endsWith(".mp4");
  const contentType = isVideo ? "video/mp4" : "image/jpeg";
  const fileSize  = fs.statSync(filePath).size;
  const range     = req.headers.get("range");

  if (range && isVideo) {
    const [startStr, endStr] = range.replace("bytes=", "").split("-");
    const start = parseInt(startStr, 10);
    const end   = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : Math.min(start + 2_097_152 - 1, fileSize - 1);
    const chunkSize = end - start + 1;
    const buffer = Buffer.alloc(chunkSize);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, chunkSize, start);
    fs.closeSync(fd);

    return new Response(buffer, {
      status: 206,
      headers: {
        "Content-Range":  `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges":  "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type":   contentType,
        "Cache-Control":  "public, max-age=3600",
      },
    });
  }

  // Full file (thumbnails + small videos)
  const buffer = fs.readFileSync(filePath);
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":   contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges":  "bytes",
      "Cache-Control":  "public, max-age=3600",
    },
  });
}
