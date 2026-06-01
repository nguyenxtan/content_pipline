import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { buildFacebookQuoteText } from "@/lib/social/youtube-metadata";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = ffmpegInstaller.path;
const WIDTH = 1080;
const HEIGHT = 1350;

export async function renderFacebookQuoteImage(input: {
  contentId: string;
  topic: string;
  shortContent?: string | null;
  imagePath: string;
}): Promise<{ imagePath: string; quoteText: string }> {
  const quoteText = buildFacebookQuoteText({
    topic: input.topic,
    shortContent: input.shortContent,
  });

  const sourcePath = input.imagePath.startsWith("/")
    ? input.imagePath
    : path.join(process.cwd(), input.imagePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Ảnh quote không tồn tại: ${sourcePath}`);
  }

  const outPath = path.join(os.tmpdir(), `${input.contentId}-fb-quote-${Date.now()}.jpg`);

  try {
    const vf = [
      `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${WIDTH}:${HEIGHT}`,
      "setsar=1",
    ].join(",");

    await execFileAsync(FFMPEG_PATH, [
      "-y",
      "-loop", "1",
      "-i", sourcePath,
      "-frames:v", "1",
      "-vf", vf,
      "-q:v", "2",
      outPath,
    ], { timeout: 60_000 });

    return { imagePath: outPath, quoteText };
  } finally {
    // no temp subtitle/ass assets
  }
}
