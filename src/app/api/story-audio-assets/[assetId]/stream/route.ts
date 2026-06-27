/**
 * GET /api/story-audio-assets/[assetId]/stream
 *
 * Serve a story episode audio file by asset ID.
 * Security model:
 *   - Asset lookup is by UUID (not user-supplied file path)
 *   - Status must be "ready"
 *   - Resolved file path must stay inside allowed audio directories
 *   - Returns 404 if file missing on disk
 *   - Supports byte-range requests for browser <audio> seek/scrub
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { storyAudioAssets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const CWD = process.cwd();
const ALLOWED_DIRS = [
  path.join(CWD, "media", "story-audio"),
  path.join(CWD, "media", "story-audio-cache"),
];

function isPathAllowed(absPath: string): boolean {
  return ALLOWED_DIRS.some((dir) => absPath.startsWith(dir + path.sep) || absPath === dir);
}

function contentTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".mp3": return "audio/mpeg";
    case ".mp4": return "audio/mp4";
    case ".aac": return "audio/aac";
    case ".ogg": return "audio/ogg";
    default: return "audio/wav";
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;

  if (!assetId || typeof assetId !== "string" || !/^[0-9a-f-]{36}$/i.test(assetId)) {
    return NextResponse.json({ error: "Invalid asset ID" }, { status: 400 });
  }

  // ── 1. Load asset from DB ────────────────────────────────────────────────
  const [asset] = await db
    .select()
    .from(storyAudioAssets)
    .where(eq(storyAudioAssets.id, assetId));

  if (!asset) {
    return NextResponse.json({ error: "Asset không tồn tại" }, { status: 404 });
  }

  if (asset.status !== "ready") {
    return NextResponse.json(
      { error: `Asset status "${asset.status}" — chỉ status "ready" mới có thể stream` },
      { status: 400 },
    );
  }

  if (!asset.audioPath) {
    return NextResponse.json({ error: "Asset chưa có audio path" }, { status: 404 });
  }

  // ── 2. Resolve and validate file path ────────────────────────────────────
  const storedPath = asset.audioPath;
  const absPath = path.isAbsolute(storedPath)
    ? path.normalize(storedPath)
    : path.normalize(path.join(CWD, storedPath));

  if (!isPathAllowed(absPath)) {
    return NextResponse.json({ error: "Forbidden path" }, { status: 403 });
  }

  // Dry-run assets reference fake paths that don't exist
  if (asset.isDryRun) {
    return NextResponse.json(
      { error: "Dry-run asset — không có file thực trên disk" },
      { status: 404 },
    );
  }

  if (!fs.existsSync(absPath)) {
    return NextResponse.json(
      { error: "File audio không tồn tại trên server" },
      { status: 404 },
    );
  }

  // ── 3. Serve with range support ──────────────────────────────────────────
  const fileBuffer = fs.readFileSync(absPath);
  const fileSize = fileBuffer.length;
  const ext = path.extname(absPath);
  const contentType = contentTypeForExt(ext);
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
