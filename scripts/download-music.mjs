#!/usr/bin/env node
/**
 * Batch download all pending/error music tracks via yt-dlp.
 * Usage:
 *   node scripts/download-music.mjs              # tất cả pending + error
 *   node scripts/download-music.mjs phat-phap    # 1 category
 *   node scripts/download-music.mjs --retry      # retry cả error
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { stat, readdir, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const HOME = process.env.HOME ?? "";
const YTDLP = existsSync(`${HOME}/venv-tts-new/bin/yt-dlp`)
  ? `${HOME}/venv-tts-new/bin/yt-dlp`
  : "yt-dlp";
const FFMPEG = existsSync(`${HOME}/miniforge3/bin/ffmpeg`)
  ? `${HOME}/miniforge3/bin/ffmpeg`
  : "ffmpeg";
const MUSIC_DIR = path.join(ROOT, "media", "music");
const DB_URL = "postgresql://admin:admin123@localhost:5433/content_pipeline";

const pool = new Pool({ connectionString: DB_URL });

const args = process.argv.slice(2);
const filterCategory = args.find(a => !a.startsWith("--"));

async function getFileSize(filePath) {
  try { return (await stat(filePath)).size; }
  catch { return null; }
}

const FFPROBE = existsSync(`${HOME}/miniforge3/bin/ffprobe`)
  ? `${HOME}/miniforge3/bin/ffprobe`
  : "ffprobe";

async function getDuration(filePath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE, [
      "-v", "quiet", "-print_format", "json", "-show_format", filePath,
    ]);
    const info = JSON.parse(stdout);
    return Math.round(parseFloat(info.format?.duration ?? "0"));
  } catch { return null; }
}

async function downloadTrack(track) {
  const outDir = path.join(MUSIC_DIR, track.category);
  await mkdir(outDir, { recursive: true });

  // Dùng trackId làm tên file (consistent với API route)
  const outputTemplate = path.join(outDir, `${track.id}.%(ext)s`);
  const expectedMp3 = path.join(outDir, `${track.id}.mp3`);

  console.log(`\n⬇  [${track.category}] ${track.title}`);

  await pool.query(
    "UPDATE music_tracks SET status = 'downloading', error_message = NULL WHERE id = $1",
    [track.id]
  );

  try {
    await execFileAsync(YTDLP, [
      track.youtube_url,
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--output", outputTemplate,
      "--no-playlist",
      "--no-warnings",
      "--quiet",
      "--ffmpeg-location", FFMPEG,
    ], { timeout: 300_000 });

    // Tìm file thực tế (có thể .mp3 hoặc extension khác)
    let filePath = expectedMp3;
    if (!existsSync(filePath)) {
      const files = (await readdir(outDir)).filter(f => f.startsWith(track.id));
      if (files.length === 0) throw new Error("File không tìm thấy sau khi tải");
      filePath = path.join(outDir, files[0]);
    }

    const [size, duration] = await Promise.all([getFileSize(filePath), getDuration(filePath)]);

    await pool.query(
      `UPDATE music_tracks
       SET status = 'done', file_path = $1, duration = $2, file_size_bytes = $3, error_message = NULL
       WHERE id = $4`,
      [filePath, duration, size, track.id]
    );

    const dur = duration ? `${Math.floor(duration/60)}p${duration%60}s` : "?";
    const mb = size ? `${(size/1024/1024).toFixed(1)}MB` : "?";
    console.log(`   ✅ ${dur} · ${mb}`);
    return true;

  } catch (err) {
    const msg = String(err.stderr || err.message || err).slice(0, 400);
    await pool.query(
      "UPDATE music_tracks SET status = 'error', error_message = $1 WHERE id = $2",
      [msg, track.id]
    );
    console.error(`   ❌ ${msg}`);
    return false;
  }
}

async function main() {
  let query = `SELECT id, title, youtube_url, category
               FROM music_tracks
               WHERE status IN ('pending', 'error') AND youtube_url IS NOT NULL`;
  const params = [];
  if (filterCategory) {
    query += " AND category = $1";
    params.push(filterCategory);
    console.log(`🎵 Downloading category: ${filterCategory}`);
  } else {
    console.log("🎵 Downloading all pending/error tracks...");
  }
  query += " ORDER BY category, created_at";

  const { rows } = await pool.query(query, params);
  console.log(`📋 ${rows.length} bài cần tải · yt-dlp: ${YTDLP}\n`);

  if (rows.length === 0) {
    console.log("✅ Không có gì để tải.");
    await pool.end();
    return;
  }

  let done = 0, failed = 0;
  for (let i = 0; i < rows.length; i++) {
    process.stdout.write(`[${i+1}/${rows.length}] `);
    const ok = await downloadTrack(rows[i]);
    ok ? done++ : failed++;
  }

  console.log(`\n🎉 Xong! ${done} thành công, ${failed} lỗi / ${rows.length} tổng.`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
