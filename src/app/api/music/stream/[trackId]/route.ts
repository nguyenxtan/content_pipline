/**
 * GET /api/music/stream/[trackId]
 * Stream mp3 file với support Range requests (cho HTML5 audio seek)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { musicTracks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ trackId: string }> }
) {
  const { trackId } = await params;

  const track = await db.query.musicTracks.findFirst({
    where: eq(musicTracks.id, trackId),
  });

  if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!track.filePath) return NextResponse.json({ error: "Chưa tải file" }, { status: 404 });
  if (!fs.existsSync(track.filePath)) return NextResponse.json({ error: "File không tồn tại trên disk" }, { status: 404 });

  const stat = fs.statSync(track.filePath);
  const fileSize = stat.size;
  const rangeHeader = req.headers.get("range");

  const ext = path.extname(track.filePath).toLowerCase();
  const contentType = ext === ".mp3" ? "audio/mpeg" : ext === ".m4a" ? "audio/mp4" : "audio/mpeg";

  // Range request (seek trong HTML5 audio)
  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(track.filePath, { start, end });
    const headers = new Headers({
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(chunkSize),
      "Content-Type": contentType,
    });

    return new Response(stream as unknown as ReadableStream, {
      status: 206,
      headers,
    });
  }

  // Full file
  const stream = fs.createReadStream(track.filePath);
  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
    },
  });
}
