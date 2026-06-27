/**
 * qa-long-pilot-first3min.ts
 * Human QA preview pack for first 3 minutes of Sợ Già longform audio.
 *
 * Outputs:
 *   reports/longform-audio-qa/b0ea0fff-first-3min.md        ← main report
 *   media/audio/qa-b0ea0fff/first-60s.wav
 *   media/audio/qa-b0ea0fff/first-3min.wav
 *   media/audio/qa-b0ea0fff/seg-NNN.wav                     ← per-segment copies
 *
 * Read-only except for output dir. Does NOT modify any pipeline files.
 *
 * Run:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/qa-long-pilot-first3min.ts
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const execFileAsync = promisify(execFile);
const FFMPEG = ffmpegInstaller.path;

const CONTENT_ID  = "b0ea0fff-7348-415a-93c8-e3a4cb02e88d";
const AUDIO_DIR   = path.join(process.cwd(), "media", "audio");
const REPAIR_DIR  = path.join(AUDIO_DIR, `${CONTENT_ID}-long-chunks-repaired`);
const MERGED_PATH = path.join(AUDIO_DIR, `${CONTENT_ID}-long.wav`);
const QA_DIR      = path.join(AUDIO_DIR, `qa-${CONTENT_ID.slice(0, 8)}`);
const REPORT_PATH = path.join(process.cwd(), "reports", "longform-audio-qa", `${CONTENT_ID.slice(0, 8)}-first-3min.md`);

const PREVIEW_SECONDS  = 180;   // 3 minutes
const CLIP_60S         = 60;
const SILENCE_THRESH   = 1.2;   // flag pauses > 1.2s
const MAX_SEG_WORDS    = 130;
const MIN_SEG_WORDS    = 30;

const execOpts = { timeout: 300_000 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countWords(t: string): number {
  return t.trim().split(/\s+/).filter(Boolean).length;
}

function splitIntoSegments(script: string): string[] {
  const paragraphs = script.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const rawUnits: string[] = [];
  for (const para of paragraphs) {
    const wc = countWords(para);
    if (wc <= MAX_SEG_WORDS) { rawUnits.push(para); continue; }
    const sentences = para.match(/[^.!?…]+(?:[.!?…]+["')\]]*)?/gu) ?? [para];
    let current: string[] = [];
    let currentWc = 0;
    for (const sent of sentences) {
      const sentWc = countWords(sent.trim());
      if (currentWc > 0 && currentWc + sentWc > MAX_SEG_WORDS) {
        rawUnits.push(current.join(" ").trim());
        current = [sent.trim()]; currentWc = sentWc;
      } else {
        current.push(sent.trim()); currentWc += sentWc;
      }
    }
    if (current.length > 0) rawUnits.push(current.join(" ").trim());
  }
  const merged: string[] = [];
  let pending = ""; let pendingWc = 0;
  for (const unit of rawUnits) {
    const wc = countWords(unit);
    if (pendingWc > 0) {
      if (pendingWc + wc <= MAX_SEG_WORDS) {
        pending = pending + " " + unit; pendingWc += wc;
        if (pendingWc >= MIN_SEG_WORDS) { merged.push(pending.trim()); pending = ""; pendingWc = 0; }
        continue;
      } else { merged.push(pending.trim()); pending = ""; pendingWc = 0; }
    }
    if (wc < MIN_SEG_WORDS) { pending = unit; pendingWc = wc; }
    else merged.push(unit);
  }
  if (pending) merged.push(pending.trim());
  return merged.filter(s => countWords(s) > 0);
}

function pcmDurSec(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  return Math.max(0, fs.statSync(filePath).size - 44) / 96_000;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${String(m).padStart(2, "0")}:${s}`;
}

function fmtDur(sec: number): string {
  if (sec < 1) return `${(sec * 1000).toFixed(0)}ms`;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}m ${(sec % 60).toFixed(1)}s`;
}

async function ffmpegCut(
  input: string, start: number, duration: number, output: string
): Promise<void> {
  await execFileAsync(FFMPEG, [
    "-y", "-i", input,
    "-ss", String(start.toFixed(3)),
    "-t", String(duration.toFixed(3)),
    "-c", "copy",
    output,
  ], execOpts);
}

async function detectSilence(
  filePath: string, minDurSec: number
): Promise<Array<{ start: number; end: number; dur: number }>> {
  const res = await execFileAsync(FFMPEG, [
    "-i", filePath,
    "-af", `silencedetect=noise=-40dB:d=${minDurSec}`,
    "-f", "null", "-",
  ], execOpts).catch(e => e as { stderr: string });
  const stderr = (res as { stderr: string }).stderr ?? "";
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map(m => parseFloat(m[1]));
  const ends   = [...stderr.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)]
    .map(m => ({ end: parseFloat(m[1]), dur: parseFloat(m[2]) }));
  return starts.map((start, i) => ({ start, end: ends[i]?.end ?? 0, dur: ends[i]?.dur ?? 0 }));
}

/** Compute RMS of PCM 16-bit samples (after 44-byte WAV header) */
async function rmsDb(filePath: string): Promise<number> {
  const res = await execFileAsync(FFMPEG, [
    "-i", filePath,
    "-af", "volumedetect",
    "-f", "null", "-",
  ], execOpts).catch(e => e as { stderr: string });
  const stderr = (res as { stderr: string }).stderr ?? "";
  const m = stderr.match(/mean_volume: ([-\d.]+) dB/);
  return m ? parseFloat(m[1]) : -99;
}

function detectRepeatedWords(text: string): string[] {
  const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const repeated: string[] = [];
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1] && words[i].length > 2) {
      repeated.push(words[i]);
    }
  }
  return [...new Set(repeated)];
}

function detectBoundaryRepeat(prev: string, curr: string): string | null {
  const prevWords = prev.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const currWords = curr.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  // Check if last 3 words of prev overlap with first 3 of curr
  const tailLen = Math.min(4, prevWords.length);
  const headLen = Math.min(4, currWords.length);
  const tail = prevWords.slice(-tailLen).join(" ");
  const head = currWords.slice(0, headLen).join(" ");
  for (let len = Math.min(tailLen, headLen); len >= 2; len--) {
    const tailEnd = prevWords.slice(-len).join(" ");
    const headStart = currWords.slice(0, len).join(" ");
    if (tailEnd === headStart) {
      return `"...${tailEnd}..." repeated at boundary`;
    }
  }
  // Check if any 3-gram at end of prev matches start of curr
  if (tail.length > 0 && head.length > 0) {
    const tailParts = tail.split(" ");
    const headParts = head.split(" ");
    // 2-word match
    if (tailParts.length >= 2 && headParts.length >= 2) {
      const last2 = tailParts.slice(-2).join(" ");
      const first2 = headParts.slice(0, 2).join(" ");
      if (last2 === first2 && last2.length > 4) return `"${last2}" repeated at boundary`;
    }
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nQA Preview Pack — Sợ Già — first ${PREVIEW_SECONDS / 60} min`);
  console.log("=" .repeat(60));

  // 1. Load script
  const row = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, CONTENT_ID),
  });
  if (!row?.longContent) {
    console.error("Content not found"); process.exit(1);
  }
  const segments = splitIntoSegments(row.longContent);
  console.log(`Script: ${segments.length} segments, ${row.longContent.split(/\s+/).filter(Boolean).length} words`);

  // 2. Build cumulative timing from repaired chunks
  const repairFiles = fs.readdirSync(REPAIR_DIR)
    .filter(f => f.endsWith(".wav"))
    .sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10));

  interface SegInfo {
    idx: number;
    text: string;
    filePath: string;
    startSec: number;
    endSec: number;
    durSec: number;
    inPreview: boolean;
  }

  const segInfos: SegInfo[] = [];
  let cursor = 0;
  for (let i = 0; i < repairFiles.length; i++) {
    const fp = path.join(REPAIR_DIR, repairFiles[i]);
    const dur = pcmDurSec(fp);
    const start = cursor;
    const end = cursor + dur;
    segInfos.push({
      idx: i + 1,
      text: segments[i] ?? "",
      filePath: fp,
      startSec: start,
      endSec: end,
      durSec: dur,
      inPreview: start < PREVIEW_SECONDS,
    });
    cursor = end;
  }

  const previewSegs = segInfos.filter(s => s.inPreview);
  console.log(`Segments in first 3 min: ${previewSegs.length} (segs 1–${previewSegs[previewSegs.length - 1].idx})`);

  // 3. Create QA output directory
  fs.mkdirSync(QA_DIR, { recursive: true });

  // 4. Extract first-60s and first-3min clips from merged WAV
  const clip60Path   = path.join(QA_DIR, "first-60s.wav");
  const clip3minPath = path.join(QA_DIR, "first-3min.wav");

  console.log("Extracting preview clips...");
  await ffmpegCut(MERGED_PATH, 0, CLIP_60S,          clip60Path);
  await ffmpegCut(MERGED_PATH, 0, PREVIEW_SECONDS,   clip3minPath);
  console.log(`  → ${path.relative(process.cwd(), clip60Path)}`);
  console.log(`  → ${path.relative(process.cwd(), clip3minPath)}`);

  // 5. Copy per-segment files for preview segs
  console.log("Copying segment audio files...");
  for (const seg of previewSegs) {
    const dest = path.join(QA_DIR, `seg-${String(seg.idx).padStart(3, "0")}.wav`);
    fs.copyFileSync(seg.filePath, dest);
  }
  console.log(`  → ${previewSegs.length} segment files in ${path.relative(process.cwd(), QA_DIR)}/`);

  // 6. Silence analysis on 3-min clip
  console.log("Detecting silence in first 3 min...");
  const silenceBlocks = await detectSilence(clip3minPath, SILENCE_THRESH);

  // 7. RMS analysis for adjacent segment timbre comparison
  console.log("Measuring RMS levels for preview segments...");
  const rmsValues: Map<number, number> = new Map();
  for (const seg of previewSegs) {
    const rms = await rmsDb(seg.filePath);
    rmsValues.set(seg.idx, rms);
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  // 8. Detect timbre/level jumps between adjacent preview segs
  const timbreFlags: Array<{ between: string; delta: number; note: string }> = [];
  for (let i = 1; i < previewSegs.length; i++) {
    const prev = previewSegs[i - 1];
    const curr = previewSegs[i];
    const prevRms = rmsValues.get(prev.idx) ?? -99;
    const currRms = rmsValues.get(curr.idx) ?? -99;
    const delta = Math.abs(currRms - prevRms);
    if (delta >= 4) {
      timbreFlags.push({
        between: `seg-${prev.idx} → seg-${curr.idx}`,
        delta,
        note: `level jump ${prevRms.toFixed(1)} dB → ${currRms.toFixed(1)} dB (Δ${delta.toFixed(1)} dB)`,
      });
    }
  }

  // 9. Detect repeated words per segment
  const segRepeatFlags: Array<{ seg: number; words: string[] }> = [];
  for (const seg of previewSegs) {
    const rw = detectRepeatedWords(seg.text);
    if (rw.length > 0) segRepeatFlags.push({ seg: seg.idx, words: rw });
  }

  // 10. Detect boundary phrase repeats
  const boundaryFlags: Array<{ between: string; match: string }> = [];
  for (let i = 1; i < previewSegs.length; i++) {
    const match = detectBoundaryRepeat(previewSegs[i-1].text, previewSegs[i].text);
    if (match) {
      boundaryFlags.push({
        between: `seg-${previewSegs[i-1].idx} → seg-${previewSegs[i].idx}`,
        match,
      });
    }
  }

  // 11. Map silence blocks to segments
  type SilenceBlock = { startSec: number; endSec: number; durSec: number; segIdx: number };
  const mappedSilence: SilenceBlock[] = silenceBlocks.map(b => {
    const mid = (b.start + b.end) / 2;
    const seg = segInfos.find(s => mid >= s.startSec && mid < s.endSec);
    return { startSec: b.start, endSec: b.end, durSec: b.dur, segIdx: seg?.idx ?? -1 };
  });

  // 12. Compute recommendation
  const hardIssueCount =
    timbreFlags.filter(f => f.delta >= 6).length +
    mappedSilence.filter(b => b.durSec >= 2.5).length;
  const minorIssueCount =
    segRepeatFlags.length +
    boundaryFlags.length +
    timbreFlags.filter(f => f.delta >= 4 && f.delta < 6).length +
    mappedSilence.filter(b => b.durSec >= 1.2 && b.durSec < 2.5).length;

  let recommendation: string;
  let rationale: string;
  if (hardIssueCount >= 2) {
    recommendation = "REJECT VOICE";
    rationale = `${hardIssueCount} hard issue(s) (timbre jump ≥6dB or pause ≥2.5s) in first 3 min.`;
  } else if (hardIssueCount === 1 || minorIssueCount >= 3) {
    recommendation = "REPAIR FIRST 3 MIN";
    rationale = `${hardIssueCount} hard issue(s), ${minorIssueCount} minor issue(s). Targeted rerun of affected segments may fix.`;
  } else {
    recommendation = "KEEP";
    rationale = `No hard issues. ${minorIssueCount} minor observation(s) — natural variation within acceptable range.`;
  }

  // 13. Build markdown report
  const relQaDir = path.relative(process.cwd(), QA_DIR);
  const relReport = path.relative(process.cwd(), REPORT_PATH);

  const lines: string[] = [];

  lines.push(`# Longform Audio QA — First 3 Minutes`);
  lines.push(`**Content ID:** \`${CONTENT_ID}\``);
  lines.push(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Voice:** Sơn (100% confirmed, 92/92 segments)`);
  lines.push(`**Scope:** Segments 1–${previewSegs[previewSegs.length - 1].idx} (0:00–${fmtTime(Math.min(PREVIEW_SECONDS, segInfos[previewSegs.length-1]?.endSec ?? PREVIEW_SECONDS))})`);
  lines.push(``);

  lines.push(`## Preview Audio Files`);
  lines.push(``);
  lines.push(`| File | Duration | Path |`);
  lines.push(`|---|---|---|`);
  lines.push(`| First 60s | 60s | \`${relQaDir}/first-60s.wav\` |`);
  lines.push(`| First 3 min | 3:00 | \`${relQaDir}/first-3min.wav\` |`);
  for (const seg of previewSegs) {
    const segDest = `${relQaDir}/seg-${String(seg.idx).padStart(3, "0")}.wav`;
    lines.push(`| Seg ${String(seg.idx).padStart(3)} | ${fmtDur(seg.durSec)} | \`${segDest}\` |`);
  }
  lines.push(``);

  lines.push(`## Transcript Alignment — First 3 Minutes`);
  lines.push(``);
  lines.push(`| Seg | Start | End | Words | Text (first 80 chars) |`);
  lines.push(`|---|---|---|---|---|`);
  for (const seg of previewSegs) {
    const preview = seg.text.slice(0, 80).replace(/\|/g, "\\|") + (seg.text.length > 80 ? "…" : "");
    lines.push(`| ${String(seg.idx).padStart(3)} | ${fmtTime(seg.startSec)} | ${fmtTime(seg.endSec)} | ${countWords(seg.text)} | ${preview} |`);
  }
  lines.push(``);

  lines.push(`## Full Segment Texts — First 3 Minutes`);
  lines.push(``);
  for (const seg of previewSegs) {
    const segFile = `${relQaDir}/seg-${String(seg.idx).padStart(3, "0")}.wav`;
    lines.push(`### Segment ${seg.idx} — ${fmtTime(seg.startSec)} → ${fmtTime(seg.endSec)} (${fmtDur(seg.durSec)})`);
    lines.push(`**Audio:** \`${segFile}\`  |  **RMS:** ${(rmsValues.get(seg.idx) ?? -99).toFixed(1)} dB`);
    lines.push(``);
    lines.push(`> ${seg.text}`);
    lines.push(``);
  }

  lines.push(`## Issue Detection`);
  lines.push(``);

  // Silence blocks
  lines.push(`### Pauses > ${SILENCE_THRESH}s`);
  lines.push(``);
  if (mappedSilence.length === 0) {
    lines.push(`_None detected in first 3 min._`);
  } else {
    lines.push(`| Start | End | Duration | Segment | Severity |`);
    lines.push(`|---|---|---|---|---|`);
    for (const b of mappedSilence) {
      const sev = b.durSec >= 2.5 ? "⚠️ HARD" : b.durSec >= 1.8 ? "⚠ notable" : "minor";
      lines.push(`| ${fmtTime(b.startSec)} | ${fmtTime(b.endSec)} | ${fmtDur(b.durSec)} | seg-${b.segIdx} | ${sev} |`);
    }
  }
  lines.push(``);

  // Timbre / level jumps
  lines.push(`### Level / Timbre Changes Between Adjacent Segments`);
  lines.push(``);
  if (timbreFlags.length === 0) {
    lines.push(`_No significant level jumps (< 4 dB delta) between adjacent segments._`);
  } else {
    lines.push(`| Boundary | Delta | Note | Severity |`);
    lines.push(`|---|---|---|---|`);
    for (const f of timbreFlags) {
      const sev = f.delta >= 6 ? "⚠️ HARD" : "⚠ notable";
      lines.push(`| ${f.between} | ${f.delta.toFixed(1)} dB | ${f.note} | ${sev} |`);
    }
  }
  lines.push(``);

  // Repeated words in segment text
  lines.push(`### Repeated Words Within Segments`);
  lines.push(``);
  if (segRepeatFlags.length === 0) {
    lines.push(`_No consecutive word repetitions detected._`);
  } else {
    for (const f of segRepeatFlags) {
      lines.push(`- **Seg ${f.seg}:** \`${f.words.join(", ")}\` repeated consecutively in text`);
    }
  }
  lines.push(``);

  // Boundary phrase repeats
  lines.push(`### Repeated Phrase at Segment Boundaries`);
  lines.push(``);
  if (boundaryFlags.length === 0) {
    lines.push(`_No boundary phrase repetitions detected._`);
  } else {
    for (const f of boundaryFlags) {
      lines.push(`- **${f.between}:** ${f.match}`);
    }
  }
  lines.push(``);

  // RMS table for all preview segs
  lines.push(`### RMS Level Per Segment`);
  lines.push(``);
  lines.push(`| Seg | Start | RMS (dB) | Note |`);
  lines.push(`|---|---|---|---|`);
  for (const seg of previewSegs) {
    const rms = rmsValues.get(seg.idx) ?? -99;
    let note = "";
    if (rms < -30) note = "very quiet";
    else if (rms < -24) note = "quiet";
    else if (rms > -10) note = "loud";
    lines.push(`| ${String(seg.idx).padStart(3)} | ${fmtTime(seg.startSec)} | ${rms.toFixed(1)} | ${note} |`);
  }
  lines.push(``);

  // Summary
  lines.push(`## Summary of Issues`);
  lines.push(``);
  lines.push(`| Category | Count | Severity |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Pauses > ${SILENCE_THRESH}s | ${mappedSilence.length} | ${mappedSilence.filter(b => b.durSec >= 2.5).length > 0 ? "has HARD" : "minor only"} |`);
  lines.push(`| Level jumps ≥ 4 dB | ${timbreFlags.length} | ${timbreFlags.filter(f => f.delta >= 6).length > 0 ? "has HARD" : timbreFlags.length > 0 ? "notable" : "none"} |`);
  lines.push(`| Repeated words (text) | ${segRepeatFlags.length} | minor |`);
  lines.push(`| Boundary phrase repeat | ${boundaryFlags.length} | minor |`);
  lines.push(``);

  lines.push(`## Recommendation`);
  lines.push(``);
  lines.push(`> **${recommendation}**`);
  lines.push(``);
  lines.push(`${rationale}`);
  lines.push(``);
  if (recommendation === "REPAIR FIRST 3 MIN") {
    const repairSegs = new Set<number>();
    timbreFlags.filter(f => f.delta >= 4).forEach(f => {
      const [a, b2] = f.between.split(" → ").map(s => parseInt(s.replace("seg-", ""), 10));
      repairSegs.add(a); repairSegs.add(b2);
    });
    mappedSilence.filter(b => b.durSec >= 2.0).forEach(b => repairSegs.add(b.segIdx));
    if (repairSegs.size > 0) {
      lines.push(`Segments to inspect: **${[...repairSegs].sort((a,b) => a-b).join(", ")}**`);
      lines.push(``);
    }
  }
  lines.push(`---`);
  lines.push(`_Generated by qa-long-pilot-first3min.ts. Read-only audit — no pipeline files modified._`);

  // Write report
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join("\n") + "\n", "utf8");

  // 14. Console summary
  console.log("\n" + "=".repeat(60));
  console.log("QA RESULTS — FIRST 3 MINUTES");
  console.log("=".repeat(60));
  console.log(`Segments in preview : ${previewSegs.length} (1–${previewSegs[previewSegs.length-1].idx})`);
  console.log(`Pauses > ${SILENCE_THRESH}s         : ${mappedSilence.length} (${mappedSilence.filter(b=>b.durSec>=2.5).length} hard ≥2.5s)`);
  console.log(`Level jumps ≥4dB    : ${timbreFlags.length} (${timbreFlags.filter(f=>f.delta>=6).length} hard ≥6dB)`);
  console.log(`Repeated words      : ${segRepeatFlags.length} segment(s)`);
  console.log(`Boundary repeats    : ${boundaryFlags.length}`);
  console.log("");

  if (mappedSilence.length > 0) {
    console.log("Pauses:");
    for (const b of mappedSilence) {
      console.log(`  ${fmtTime(b.startSec)} – ${fmtTime(b.endSec)}  ${fmtDur(b.durSec).padEnd(6)}  seg-${b.segIdx}`);
    }
  }
  if (timbreFlags.length > 0) {
    console.log("Level jumps:");
    for (const f of timbreFlags) {
      console.log(`  ${f.between.padEnd(20)}  ${f.note}`);
    }
  }
  if (segRepeatFlags.length > 0) {
    console.log("Repeated words:");
    for (const f of segRepeatFlags) {
      console.log(`  seg-${f.seg}: ${f.words.join(", ")}`);
    }
  }
  if (boundaryFlags.length > 0) {
    console.log("Boundary repeats:");
    for (const f of boundaryFlags) {
      console.log(`  ${f.between}: ${f.match}`);
    }
  }

  console.log("");
  console.log(`RECOMMENDATION: ${recommendation}`);
  console.log(`Rationale: ${rationale}`);
  console.log("");
  console.log("Preview files:");
  console.log(`  ${path.relative(process.cwd(), clip60Path)}`);
  console.log(`  ${path.relative(process.cwd(), clip3minPath)}`);
  console.log(`  ${relQaDir}/seg-001.wav … seg-${String(previewSegs[previewSegs.length-1].idx).padStart(3,"0")}.wav`);
  console.log(`Report: ${relReport}`);
  console.log("=".repeat(60));

  process.exit(0);
}

main().catch(e => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
