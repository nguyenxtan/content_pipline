/**
 * POST /api/youtube/upload
 * Upload short hoặc long video lên YouTube.
 * Body: { contentId: string, contentType?: "short" | "long" }
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthorizedClient } from "@/lib/youtube/client";
import { buildYouTubeVideoMetadata } from "@/lib/social/youtube-metadata";

export async function POST(req: Request) {
  const { contentId, contentType = "short" } = (await req.json()) as {
    contentId?: string;
    contentType?: "short" | "long";
  };
  if (!contentId) return NextResponse.json({ error: "contentId required" }, { status: 400 });

  const item = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
  if (!item) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  const isLong = contentType === "long";

  // Validate the right video is ready
  if (isLong) {
    if (item.longVideoStatus !== "done" || !item.longVideoPath) {
      return NextResponse.json({ error: "Long video chưa được dựng" }, { status: 400 });
    }
  } else {
    if (item.videoStatus !== "done" || !item.videoPath) {
      return NextResponse.json({ error: "Video chưa được dựng" }, { status: 400 });
    }
  }

  const auth = await getAuthorizedClient();
  if (!auth) return NextResponse.json({ error: "YouTube chưa được kết nối" }, { status: 401 });

  const videoRelPath = isLong ? item.longVideoPath! : item.videoPath!;
  const absVideoPath = path.join(process.cwd(), videoRelPath);
  if (!fs.existsSync(absVideoPath)) {
    return NextResponse.json({ error: "File video không tồn tại" }, { status: 400 });
  }

  // Mark processing on the right status field
  await db.update(contentGenerations)
    .set(isLong
      ? { longYoutubeUploadStatus: "processing", longYoutubeUploadError: null }
      : { youtubeUploadStatus: "processing", youtubeUploadError: null }
    )
    .where(eq(contentGenerations.id, contentId));

  try {
    const youtube = google.youtube({ version: "v3", auth });

    const { title, description, tags } = buildYouTubeVideoMetadata({
      contentType: isLong ? "long" : "short",
      topic: item.topic ?? "Video",
      nicheName: item.nicheName ?? "",
      shortContent: item.shortContent,
      longContent: item.longContent,
      longYoutubeDescription: item.longYoutubeDescription,
    });

    const res = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { title, description, tags, categoryId: "22" },
        status:  { privacyStatus: "public", selfDeclaredMadeForKids: false },
      },
      media: { mimeType: "video/mp4", body: fs.createReadStream(absVideoPath) },
    });

    const videoId  = res.data.id!;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Upload thumbnail for long video if available
    if (isLong && item.longThumbnailPath) {
      const absThumbnailPath = path.join(process.cwd(), item.longThumbnailPath);
      if (fs.existsSync(absThumbnailPath)) {
        try {
          await youtube.thumbnails.set({
            videoId,
            media: { mimeType: "image/jpeg", body: fs.createReadStream(absThumbnailPath) },
          });
        } catch {
          // Thumbnail upload failure is non-fatal — video already uploaded
        }
      }
    }

    await db.update(contentGenerations)
      .set(isLong
        ? { longYoutubeUploadStatus: "done", longYoutubeVideoUrl: videoUrl, longYoutubeUploadError: null }
        : { youtubeUploadStatus: "done", youtubeVideoUrl: videoUrl, youtubeUploadError: null }
      )
      .where(eq(contentGenerations.id, contentId));

    return NextResponse.json({ success: true, videoId, videoUrl });
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 600);
    await db.update(contentGenerations)
      .set(isLong
        ? { longYoutubeUploadStatus: "error", longYoutubeUploadError: msg }
        : { youtubeUploadStatus: "error", youtubeUploadError: msg }
      )
      .where(eq(contentGenerations.id, contentId));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
