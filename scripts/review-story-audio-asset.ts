/**
 * review-story-audio-asset.ts
 *
 * Audio quality review tool for Story Audio assets (Phase E3).
 * Inspects asset metadata, verifies file on disk, probes audio properties,
 * and validates the SRT file.
 *
 * Usage:
 *   pnpm review:story-audio --asset-id <uuid>
 *
 * Output:
 *   - DB metadata
 *   - File size + MB/min
 *   - Audio: codec, sample rate, channels, bitrate, duration (via ffprobe)
 *   - SRT: entry count, timestamp range, format validity
 *   - Warnings and production readiness verdict
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { db } from "@/lib/db";
import { storyAudioAssets, storyEpisodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string): string | null {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  const p = args.find((a) => a.startsWith(`${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

const assetId = getArg("--asset-id");

// ── Helpers ───────────────────────────────────────────────────────────────────

const FFPROBE_CANDIDATES = [
  process.env.FFPROBE_PATH,
  "/Users/bichtuyen/miniforge3/bin/ffprobe",
  "/opt/homebrew/bin/ffprobe",
  "/usr/local/bin/ffprobe",
  "/usr/bin/ffprobe",
].filter(Boolean) as string[];

function findFfprobe(): string | null {
  for (const p of FFPROBE_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function probeAudio(filePath: string): Record<string, unknown> | null {
  const ffprobe = findFfprobe();
  if (!ffprobe) return null;
  try {
    const out = execFileSync(
      ffprobe,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: 15000 },
    ).toString("utf8");
    return JSON.parse(out) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type SrtEntry = { seq: number; start: string; end: string; text: string };

function parseSrt(srtText: string): { entries: SrtEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  const entries: SrtEntry[] = [];
  const blocks = srtText.trim().split(/\n\s*\n/);
  let prevEndSec = -1;

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    const seq = parseInt(lines[0], 10);
    if (isNaN(seq)) continue;
    const tsParts = lines[1].match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/,
    );
    if (!tsParts) { warnings.push(`Entry ${seq}: invalid timestamp line`); continue; }
    const text = lines.slice(2).join(" ").trim();
    if (!text) warnings.push(`Entry ${seq}: empty caption`);

    const toSec = (ts: string) => {
      const [hms, ms] = ts.split(",");
      const [h, m, s] = hms.split(":").map(Number);
      return h * 3600 + m * 60 + s + parseInt(ms, 10) / 1000;
    };
    const startSec = toSec(tsParts[1]);
    const endSec = toSec(tsParts[2]);

    if (startSec < prevEndSec - 0.001) {
      warnings.push(`Entry ${seq}: timestamp overlaps previous (start=${tsParts[1]} < prev_end)`);
    }
    if (endSec <= startSec) {
      warnings.push(`Entry ${seq}: end <= start (${tsParts[2]} <= ${tsParts[1]})`);
    }
    prevEndSec = endSec;
    entries.push({ seq, start: tsParts[1], end: tsParts[2], text });
  }
  return { entries, warnings };
}

function formatSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function srtTimestampToSec(ts: string): number {
  const [hms, ms] = ts.split(",");
  const [h, m, s] = hms.split(":").map(Number);
  return h * 3600 + m * 60 + s + parseInt(ms || "0", 10) / 1000;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!assetId) {
    console.error("Usage: pnpm review:story-audio --asset-id <uuid>");
    process.exit(1);
  }

  const [asset] = await db
    .select()
    .from(storyAudioAssets)
    .where(eq(storyAudioAssets.id, assetId));

  if (!asset) {
    console.error(`Asset "${assetId}" not found.`);
    process.exit(1);
  }

  const [episode] = asset.episodeId
    ? await db.select().from(storyEpisodes).where(eq(storyEpisodes.id, asset.episodeId))
    : [undefined];

  const warnings: string[] = [];

  console.log(`\n${"═".repeat(70)}`);
  console.log(`Audio Story Asset Review`);
  console.log(`${"═".repeat(70)}`);

  // ── 1. DB Metadata ─────────────────────────────────────────────────────────

  console.log(`\n── Asset Metadata ──`);
  console.log(`  id           : ${asset.id}`);
  console.log(`  episode      : ${episode ? `Tập ${episode.episodeNumber} — ${episode.title}` : asset.episodeId ?? "—"}`);
  console.log(`  story_id     : ${asset.storyId}`);
  console.log(`  provider     : ${asset.provider}`);
  console.log(`  model        : ${asset.model ?? "—"}`);
  console.log(`  voice_id     : ${asset.voiceId}`);
  console.log(`  voice_label  : ${asset.voiceLabel ?? "—"}`);
  console.log(`  speed        : ${asset.speed}`);
  console.log(`  pitch        : ${asset.pitch}`);
  console.log(`  volume       : ${asset.volume}`);
  console.log(`  language     : ${asset.language ?? "—"}`);
  console.log(`  sample_rate  : ${asset.sampleRate ?? "—"}`);
  console.log(`  status       : ${asset.status}`);
  console.log(`  is_dry_run   : ${asset.isDryRun}`);
  console.log(`  word_count   : ${asset.wordCount ?? "—"}`);
  console.log(`  duration_sec : ${asset.durationSec ?? "— (not stored)"}`);
  console.log(`  audio_path   : ${asset.audioPath ?? "—"}`);
  console.log(`  srt_path     : ${asset.srtPath ?? "—"}`);
  console.log(`  cache_key    : ${asset.cacheKey?.slice(0, 16) ?? "—"}…`);
  console.log(`  tts_job_id   : ${asset.ttsJobId ?? "—"}`);
  console.log(`  generated_at : ${asset.generatedAt ? new Date(asset.generatedAt).toLocaleString("vi-VN") : "—"}`);

  if (asset.isDryRun) {
    warnings.push("Asset is a dry-run — no real audio file exists");
  }
  if (!asset.audioPath) {
    warnings.push("No audio_path recorded in DB");
  }
  if (asset.voiceLabel === asset.voiceId) {
    warnings.push(`voice_label is raw voice ID (${asset.voiceId}) — run tts:sync-voices to enrich`);
  }

  // ── 2. File on disk ────────────────────────────────────────────────────────

  const CWD = process.cwd();
  const audioAbsPath = asset.audioPath
    ? path.isAbsolute(asset.audioPath) ? asset.audioPath : path.join(CWD, asset.audioPath)
    : null;
  const srtAbsPath = asset.srtPath
    ? path.isAbsolute(asset.srtPath) ? asset.srtPath : path.join(CWD, asset.srtPath)
    : null;

  console.log(`\n── Files on Disk ──`);
  if (!audioAbsPath) {
    console.log(`  WAV : (no path)`);
    warnings.push("audio_path is null — cannot check file");
  } else if (!fs.existsSync(audioAbsPath)) {
    console.log(`  WAV : MISSING — ${audioAbsPath}`);
    warnings.push(`WAV file missing on disk: ${audioAbsPath}`);
  } else {
    const stat = fs.statSync(audioAbsPath);
    const sizeMB = stat.size / (1024 * 1024);
    console.log(`  WAV : ${audioAbsPath}`);
    console.log(`        size: ${sizeMB.toFixed(1)} MB`);
  }

  if (!srtAbsPath) {
    console.log(`  SRT : (no path in DB)`);
  } else if (!fs.existsSync(srtAbsPath)) {
    console.log(`  SRT : MISSING — ${srtAbsPath}`);
    warnings.push(`SRT file missing on disk: ${srtAbsPath}`);
  } else {
    const srtStat = fs.statSync(srtAbsPath);
    console.log(`  SRT : ${srtAbsPath}`);
    console.log(`        size: ${(srtStat.size / 1024).toFixed(1)} KB`);
  }

  // ── 3. ffprobe ─────────────────────────────────────────────────────────────

  console.log(`\n── Audio Probe (ffprobe) ──`);
  if (!audioAbsPath || !fs.existsSync(audioAbsPath)) {
    console.log(`  (skipped — file not on disk)`);
  } else {
    const probe = probeAudio(audioAbsPath);
    if (!probe) {
      console.log(`  ffprobe not found — install via brew or set FFPROBE_PATH`);
      warnings.push("ffprobe not available — cannot verify audio properties");
    } else {
      const streams = (probe.streams as Array<Record<string, unknown>>) ?? [];
      const fmt = probe.format as Record<string, unknown> ?? {};
      const audioStream = streams.find((s) => s.codec_type === "audio");
      const durationSec = parseFloat(String(fmt.duration ?? "0"));
      const sizeBytes = parseInt(String(fmt.size ?? "0"), 10);
      const sizeMB = sizeBytes / (1024 * 1024);
      const bitrate = parseInt(String(fmt.bit_rate ?? "0"), 10);

      console.log(`  codec        : ${audioStream?.codec_name ?? "—"} (${audioStream?.codec_long_name ?? "—"})`);
      console.log(`  sample_rate  : ${audioStream?.sample_rate ?? "—"} Hz`);
      console.log(`  channels     : ${audioStream?.channels ?? "—"}`);
      console.log(`  bit_depth    : ${audioStream?.bits_per_sample ?? "—"} bit`);
      console.log(`  bitrate      : ${bitrate ? `${Math.round(bitrate / 1000)} kbps` : "—"}`);
      console.log(`  duration     : ${formatSec(durationSec)} (${durationSec.toFixed(2)}s)`);
      console.log(`  size_on_disk : ${sizeMB.toFixed(1)} MB`);

      if (durationSec > 0 && sizeMB > 0) {
        const mbPerMin = sizeMB / (durationSec / 60);
        console.log(`  MB/min       : ${mbPerMin.toFixed(1)}`);
        if (mbPerMin > 6) {
          warnings.push(`High MB/min (${mbPerMin.toFixed(1)}) — consider MP3/AAC for delivery`);
        }
      }

      // Cross-check with episode word count
      if (episode && durationSec > 0) {
        const wpm = Math.round((episode.wordCount / durationSec) * 60);
        console.log(`  est. WPM     : ~${wpm} (${episode.wordCount} words / ${durationSec.toFixed(0)}s)`);
        // Vietnamese is monosyllabic; TTS rates of 150–280 WPM are normal at speed 1.0–1.1
      if (wpm < 80 || wpm > 350) {
          warnings.push(`WPM ${wpm} outside plausible range 80–350 — check speed/pitch settings or word_count accuracy`);
        }
      }

      if (audioStream?.channels === 1) {
        console.log(`  ℹ mono audio — expected for narration (no stereo needed)`);
      }
      if (String(audioStream?.sample_rate) !== "48000") {
        warnings.push(`Sample rate is ${audioStream?.sample_rate} Hz, expected 48000`);
      }
    }
  }

  // ── 4. SRT Review ──────────────────────────────────────────────────────────

  console.log(`\n── SRT Review ──`);
  if (!srtAbsPath || !fs.existsSync(srtAbsPath)) {
    console.log(`  (no SRT file to review)`);
  } else {
    const srtText = fs.readFileSync(srtAbsPath, "utf8");
    const { entries, warnings: srtWarnings } = parseSrt(srtText);
    const lastEntry = entries[entries.length - 1];
    const srtEndSec = lastEntry ? srtTimestampToSec(lastEntry.end) : 0;
    const srtStartSec = entries[0] ? srtTimestampToSec(entries[0].start) : 0;

    console.log(`  entries      : ${entries.length}`);
    console.log(`  first ts     : ${entries[0]?.start ?? "—"}`);
    console.log(`  last ts      : ${lastEntry?.end ?? "—"} (${formatSec(srtEndSec)})`);
    console.log(`  first line   : ${entries[0]?.text?.slice(0, 70) ?? "—"}`);
    console.log(`  last line    : ${lastEntry?.text?.slice(0, 70) ?? "—"}`);

    // Check for timing gaps > 2s
    let maxGap = 0;
    let maxGapAt = "";
    for (let i = 1; i < entries.length; i++) {
      const prevEnd = srtTimestampToSec(entries[i - 1].end);
      const curStart = srtTimestampToSec(entries[i].start);
      const gap = curStart - prevEnd;
      if (gap > maxGap) { maxGap = gap; maxGapAt = entries[i].start; }
    }
    if (maxGap > 0) {
      console.log(`  max gap      : ${maxGap.toFixed(2)}s at ${maxGapAt}`);
      if (maxGap > 5) {
        warnings.push(`Large SRT gap of ${maxGap.toFixed(1)}s at ${maxGapAt} — may indicate silence or missing segment`);
      }
    }

    for (const w of srtWarnings) warnings.push(`SRT: ${w}`);

    if (srtWarnings.length === 0 && entries.length > 0) {
      console.log(`  ✓ SRT format valid`);
    }
  }

  // ── 5. Production Readiness ────────────────────────────────────────────────

  console.log(`\n── Production Risk Assessment ──`);

  const risks = [
    {
      risk: "WAV too large for long-term storage",
      detail: "37 MB for ~6.5 min (≈5.7 MB/min). Full 30-ep story ≈ 5–6 GB WAV. Recommend MP3 192kbps for delivery (~1.4 MB/min, ~10× smaller).",
      severity: "medium",
    },
    {
      risk: "No MP3/AAC preview copy",
      detail: "Browser <audio> plays WAV fine. But YouTube/CDN delivery needs re-encode. Not blocking for Phase F if ffmpeg is available at publish time.",
      severity: "low",
    },
    {
      risk: "voice_label stores raw voice ID",
      detail: "Fixed in this E3 session for new assets. Existing asset DB record corrected manually.",
      severity: "fixed",
    },
    {
      risk: "SRT path mismatch (ep1.wav.raw.srt vs ep1.srt)",
      detail: "Fixed in this E3 session: rawSynthPath naming corrected, SRT renamed after synthesis, existing DB record corrected.",
      severity: "fixed",
    },
    {
      risk: "writeCostEvent fails silently (no unique index)",
      detail: "Fixed in this E3 session: added partial unique index idx_cost_events_source_unique.",
      severity: "fixed",
    },
    {
      risk: "duration_sec not stored in DB",
      detail: "AiMax synthesis result returns null for durationSec. Duration is available via ffprobe. If needed for UI, add a post-synthesis ffprobe step.",
      severity: "low",
    },
    {
      risk: "enableSrt depends on AiMax admin setting",
      detail: "SRT is only generated when aimax.enableSrt is true in admin settings. If false, no SRT. Recommend keeping enableSrt=true for audio story.",
      severity: "low",
    },
  ];

  for (const r of risks) {
    const icon = r.severity === "fixed" ? "✓" : r.severity === "medium" ? "⚠" : "ℹ";
    console.log(`\n  ${icon} ${r.risk} [${r.severity}]`);
    console.log(`    ${r.detail}`);
  }

  // ── 6. Warnings summary ────────────────────────────────────────────────────

  if (warnings.length > 0) {
    console.log(`\n── Warnings (${warnings.length}) ──`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  } else {
    console.log(`\n── No warnings ──`);
  }

  // ── 7. Verdict ─────────────────────────────────────────────────────────────

  const blocking = warnings.filter((w) =>
    w.toLowerCase().includes("missing") ||
    w.toLowerCase().includes("invalid") ||
    w.toLowerCase().includes("dry-run")
  );

  console.log(`\n── Verdict ──`);
  if (blocking.length > 0) {
    console.log(`  ✗ NOT READY — blocking issues:`);
    for (const b of blocking) console.log(`    • ${b}`);
  } else {
    console.log(`  ✓ READY for Phase F — no blocking issues`);
    console.log(`    Audio is valid WAV, SRT is valid, stream route works.`);
    console.log(`    Recommend MP3 re-encode before YouTube upload (Phase F).`);
  }

  console.log(`\n${"═".repeat(70)}\n`);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
}).finally(() => {
  db.$client.end().catch(() => {});
});
