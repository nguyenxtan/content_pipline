/**
 * TTS Artifact Audit — Phase 1 through 4
 * Identifies content for YouTube video GxR_7Ib73Nw and audits the TTS path.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const YOUTUBE_VIDEO_ID = "GxR_7Ib73Nw";
const AUDIO_CACHE_DIR = path.join(process.cwd(), "media", "audio-cache");

function buildTextHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeTextForTTS(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function main() {

// ── Phase 1: Find the video/content ─────────────────────────────────────────

console.log("\n═══ PHASE 1: Identify video/content ═══");

const pvRows = await db.execute(sql`
  SELECT
    pv.id as pv_id, pv.platform_video_id, pv.upload_queue_id, pv.content_id,
    pv.published_at, pv.platform,
    uq.id as uq_id, uq.scheduled_at, uq.uploaded_at, uq.status,
    uq.video_type, uq.platform as uq_platform, uq.title as uq_title,
    uq.channel_id, uq.error_message as uq_error_message,
    sc.name as channel_name, sc.channel_key
  FROM published_videos pv
  LEFT JOIN upload_queue uq ON pv.upload_queue_id = uq.id
  LEFT JOIN social_channels sc ON uq.channel_id = sc.id
  WHERE pv.platform_video_id = ${YOUTUBE_VIDEO_ID}
`);

if (pvRows.rows.length === 0) {
  console.log("⚠  No published_videos row found for GxR_7Ib73Nw");
  console.log("   Trying upload_queue.platform_video_id fallback...");
  const uqFallback = await db.execute(sql`
    SELECT id, content_id, platform_video_id, platform_video_url, status, scheduled_at, uploaded_at
    FROM upload_queue
    WHERE platform_video_id = ${YOUTUBE_VIDEO_ID}
  `);
  console.log("upload_queue fallback:", JSON.stringify(uqFallback.rows, null, 2));
  process.exit(0);
}

const row = pvRows.rows[0];
const contentId = row.content_id as string;
const uqId = row.uq_id as string;

console.log("\n── published_videos ──────────────────");
console.log(`  pv_id:           ${row.pv_id}`);
console.log(`  upload_queue_id: ${uqId}`);
console.log(`  content_id:      ${contentId}`);
console.log(`  platform:        ${row.platform}`);
console.log(`  published_at:    ${row.published_at}`);
console.log(`  scheduled_at:    ${row.scheduled_at}`);
console.log(`  uploaded_at:     ${row.uploaded_at}`);
console.log(`  status:          ${row.status}`);
console.log(`  video_type:      ${row.video_type}`);
console.log(`  channel_name:    ${row.channel_name}`);
console.log(`  channel_key:     ${row.channel_key}`);

// ── Content row ───────────────────────────────────────────────────────────────

const cgRows = await db.execute(sql`
  SELECT
    id, topic, short_content,
    audio_path, video_path,
    tts_status, tts_error_message, tts_duration_ms,
    video_status, video_error_message,
    channel_key, content_profile_key, niche_name,
    experiment_id, experiment_variant, format_type, content_mode,
    created_at
  FROM content_generations
  WHERE id = ${contentId}
`);

if (cgRows.rows.length === 0) {
  console.log(`⚠  No content_generations row for ${contentId}`);
  process.exit(0);
}

const cg = cgRows.rows[0];
console.log("\n── content_generations ───────────────");
console.log(`  id:                    ${cg.id}`);
console.log(`  topic:                 ${cg.topic}`);
console.log(`  format_type:           ${cg.format_type}`);
console.log(`  experiment_variant:    ${cg.experiment_variant}`);
console.log(`  channel_key:           ${cg.channel_key}`);
console.log(`  niche_name:            ${cg.niche_name}`);
console.log(`  tts_status:            ${cg.tts_status}`);
console.log(`  tts_error_message:     ${cg.tts_error_message}`);
console.log(`  video_status:          ${cg.video_status}`);
console.log(`  audio_path:            ${cg.audio_path}`);
console.log(`  video_path:            ${cg.video_path}`);
console.log(`  created_at:            ${cg.created_at}`);

const rawShortContent = cg.short_content as string;
console.log("\n── short_content (raw) ───────────────");
console.log(JSON.stringify(rawShortContent)); // show escape sequences
console.log("\n── short_content (display) ───────────");
console.log(rawShortContent);

// ── Phase 2: Sanitizer analysis ───────────────────────────────────────────────

console.log("\n═══ PHASE 2: Sanitizer analysis ═══");

const normalizedText = normalizeTextForTTS(rawShortContent);
const rawHash = buildTextHash(rawShortContent);
const normalizedHash = buildTextHash(normalizedText);

console.log(`  raw hash:              ${rawHash}`);
console.log(`  normalized hash:       ${normalizedHash}`);
console.log(`  hashes differ:         ${rawHash !== normalizedHash}`);
console.log(`  first 120 chars raw:   ${JSON.stringify(rawShortContent.slice(0, 120))}`);
console.log(`  first 120 normalized:  ${JSON.stringify(normalizedText.slice(0, 120))}`);

// Check for problematic patterns
const checks = {
  starts_with_separator: /^\s*(?:[-*_]\s*){3,}/.test(rawShortContent),
  has_separator_line: /^\s*(?:[-*_]\s*){3,}\s*$/m.test(rawShortContent),
  starts_with_doi_khi: /^\s*[Ðđ][ôÔ][iI]\s+[kK][hH][iI]/u.test(rawShortContent.normalize("NFC")),
  has_hidden_unicode: /[​-‏‪-‮﻿­]/u.test(rawShortContent),
  has_leading_newlines: /^\s*\n/.test(rawShortContent),
  starts_with_markdown: /^\s*[#*_>-]/.test(rawShortContent),
  normalized_starts_with_doi_khi: /^\s*[Ðđ][ôÔ][iI]\s+[kK][hH][iI]/u.test(normalizedText.normalize("NFC")),
};

console.log("\n── Pattern checks ────────────────────");
for (const [k, v] of Object.entries(checks)) {
  console.log(`  ${k.padEnd(35)}: ${v}`);
}

// Check for "Đôi khi" more carefully
const rawPrefix = rawShortContent.trim().slice(0, 30);
const normPrefix = normalizedText.trim().slice(0, 30);
console.log(`\n  raw prefix (trimmed):  ${JSON.stringify(rawPrefix)}`);
console.log(`  norm prefix (trimmed): ${JSON.stringify(normPrefix)}`);

// Unicode code points of first 10 chars (normalized)
const firstChars = [...normalizedText.trim()].slice(0, 15);
console.log(`\n  first 15 chars (codepoints):`);
for (const ch of firstChars) {
  console.log(`    U+${ch.codePointAt(0)!.toString(16).padStart(4,"0")} ${JSON.stringify(ch)}`);
}

// ── Phase 3: Cache analysis ───────────────────────────────────────────────────

console.log("\n═══ PHASE 3: TTS cache analysis ═══");

const cacheDir = path.join(AUDIO_CACHE_DIR, normalizedHash);
const rawCacheDir = path.join(AUDIO_CACHE_DIR, rawHash);

console.log(`  normalized cache dir:  ${cacheDir}`);
console.log(`  raw cache dir:         ${rawCacheDir}`);

const cacheExists = fs.existsSync(cacheDir);
const rawCacheExists = fs.existsSync(rawCacheDir);
console.log(`  normalized cache hit:  ${cacheExists}`);
console.log(`  raw (unsanitized) hit: ${rawCacheExists}`);

if (cacheExists) {
  const files = fs.readdirSync(cacheDir);
  for (const f of files) {
    const fp = path.join(cacheDir, f);
    const stat = fs.statSync(fp);
    console.log(`    ${f}  mtime=${stat.mtime.toISOString()}  size=${stat.size}B`);
  }
}

if (rawCacheExists && rawHash !== normalizedHash) {
  console.log("\n  ⚠  Raw (pre-sanitizer) cache ALSO exists:");
  const files = fs.readdirSync(rawCacheDir);
  for (const f of files) {
    const fp = path.join(rawCacheDir, f);
    const stat = fs.statSync(fp);
    console.log(`    ${f}  mtime=${stat.mtime.toISOString()}  size=${stat.size}B`);
  }
}

// ── Audio file inspection ─────────────────────────────────────────────────────

console.log("\n═══ PHASE 4: Audio/video file inspection ═══");

const audioPathRel = cg.audio_path as string | null;
const videoPathRel = cg.video_path as string | null;

if (audioPathRel) {
  const audioAbs = path.join(process.cwd(), audioPathRel.replace(/^\//, ""));
  if (fs.existsSync(audioAbs)) {
    const stat = fs.statSync(audioAbs);
    console.log(`  audio file:  ${audioAbs}`);
    console.log(`  audio mtime: ${stat.mtime.toISOString()}`);
    console.log(`  audio size:  ${stat.size}B`);
  } else {
    console.log(`  ⚠  audio file missing: ${audioAbs}`);
  }
} else {
  console.log("  audio_path: null");
}

if (videoPathRel) {
  const videoAbs = path.join(process.cwd(), videoPathRel.replace(/^\//, ""));
  if (fs.existsSync(videoAbs)) {
    const stat = fs.statSync(videoAbs);
    console.log(`  video file:  ${videoAbs}`);
    console.log(`  video mtime: ${stat.mtime.toISOString()}`);
    console.log(`  video size:  ${stat.size}B`);
  } else {
    console.log(`  ⚠  video file missing: ${videoAbs}`);
  }
} else {
  console.log("  video_path: null");
}

// ── Sanitizer fix commit timestamp check ─────────────────────────────────────

console.log("\n═══ PHASE 1b: Timing analysis ═══");
// Fix was committed 2026-06-07
const fixTimestamp = new Date("2026-06-07T00:00:00Z");
const contentCreated = new Date(cg.created_at as string);

console.log(`  sanitizer fix commit:  2026-06-07 (commit 3741701)`);
console.log(`  content created_at:    ${contentCreated.toISOString()}`);
console.log(`  created after fix:     ${contentCreated >= fixTimestamp}`);

if (audioPathRel) {
  const audioAbs = path.join(process.cwd(), audioPathRel.replace(/^\//, ""));
  if (fs.existsSync(audioAbs)) {
    const stat = fs.statSync(audioAbs);
    console.log(`  audio mtime:           ${stat.mtime.toISOString()}`);
    console.log(`  audio after fix:       ${stat.mtime >= fixTimestamp}`);
  }
}

} // end main

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
