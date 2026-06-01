/**
 * POST /api/music/download
 * Tải nhạc từ YouTube về local dùng yt-dlp (audio only, mp3)
 * Body: { trackId: string }
 *
 * Flow: cập nhật status → chạy yt-dlp → lưu file → cập nhật DB
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { musicTracks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const MEDIA_MUSIC_DIR = path.join(process.cwd(), "media", "music");
const HOME = process.env.HOME ?? "";
const YTDLP_PATH = process.env.YTDLP_PATH ?? (
  fs.existsSync(`${HOME}/venv-tts-new/bin/yt-dlp`)
    ? `${HOME}/venv-tts-new/bin/yt-dlp`
    : "yt-dlp"
);
// ffmpeg from miniforge (conda install -c conda-forge ffmpeg)
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? (
  fs.existsSync(`${HOME}/miniforge3/bin/ffmpeg`)
    ? `${HOME}/miniforge3/bin/ffmpeg`
    : "ffmpeg"
);

export async function POST(req: Request) {
  const { trackId } = await req.json() as { trackId: string };
  if (!trackId) return NextResponse.json({ error: "trackId required" }, { status: 400 });

  const track = await db.query.musicTracks.findFirst({ where: eq(musicTracks.id, trackId) });
  if (!track) return NextResponse.json({ error: "Track not found" }, { status: 404 });
  if (!track.youtubeUrl) return NextResponse.json({ error: "Không có YouTube URL" }, { status: 400 });

  // Mark downloading
  await db.update(musicTracks).set({ status: "downloading" }).where(eq(musicTracks.id, trackId));

  // Tạo thư mục category
  const categoryDir = path.join(MEDIA_MUSIC_DIR, track.category);
  fs.mkdirSync(categoryDir, { recursive: true });

  // Output template — dùng trackId làm tên file để tránh trùng
  const outputTemplate = path.join(categoryDir, `${trackId}.%(ext)s`);

  try {
    const { filePath, duration } = await runYtDlp(track.youtubeUrl, outputTemplate, categoryDir, trackId);

    const stat = fs.statSync(filePath);
    await db.update(musicTracks).set({
      status: "done",
      filePath,
      duration,
      fileSizeBytes: stat.size,
      errorMessage: null,
    }).where(eq(musicTracks.id, trackId));

    return NextResponse.json({ success: true, filePath, duration });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(musicTracks).set({
      status: "error",
      errorMessage: msg,
    }).where(eq(musicTracks.id, trackId));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function runYtDlp(url: string, outputTemplate: string, categoryDir: string, trackId: string): Promise<{ filePath: string; duration: number }> {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",       // best quality
      "--output", outputTemplate,
      "--no-playlist",
      "--no-warnings",
      "--ffmpeg-location", FFMPEG_PATH,
    ];

    const proc = spawn(YTDLP_PATH, args);
    let jsonOutput = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { jsonOutput += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.slice(-500) || `yt-dlp exit ${code}`));
      }

      // File thực tế là .mp3
      const filePath = path.join(categoryDir, `${trackId}.mp3`);
      if (!fs.existsSync(filePath)) {
        // Thử tìm file với extension khác
        const files = fs.readdirSync(categoryDir).filter(f => f.startsWith(trackId));
        if (files.length === 0) return reject(new Error("File không tìm thấy sau khi tải"));
        return resolve({ filePath: path.join(categoryDir, files[0]), duration: 0 });
      }

      // Parse duration via ffprobe
      let duration = 0;
      try {
        const { execFileSync } = require("child_process") as typeof import("child_process");
        const ffprobePath = FFMPEG_PATH.replace(/ffmpeg$/, "ffprobe");
        const ffprobeOut = execFileSync(ffprobePath, [
          "-v", "quiet", "-print_format", "json", "-show_format", filePath,
        ]).toString();
        const info = JSON.parse(ffprobeOut) as { format?: { duration?: string } };
        duration = Math.round(parseFloat(info.format?.duration ?? "0"));
      } catch { /* ignore */ }

      resolve({ filePath, duration });
    });

    proc.on("error", reject);
  });
}
