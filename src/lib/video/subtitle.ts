export interface SubtitleChunk {
  start: number;
  end: number;
  text: string;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface SpeechSegment {
  start: number;
  end: number;
}

export interface SubtitleHealthCheckFlags {
  firstSubtitleStart: boolean;
  blankSegments: boolean;
  excessiveNewlineBlocks: boolean;
  subtitleAudioDrift: boolean;
  largeSubtitleGaps: boolean;
}

export interface SubtitleValidationResult {
  status: "PASS" | "FAIL";
  subtitleHealthScore: number;
  chunks: SubtitleChunk[];
  checks: SubtitleHealthCheckFlags;
  metrics: {
    firstSubtitleStartSec: number | null;
    expectedSpeechStartSec: number;
    expectedSpeechEndSec: number;
    blankSegmentCount: number;
    excessiveNewlineBlockCount: number;
    driftSeconds: number;
    maxGapSeconds: number;
    largeGapCount: number;
  };
  repairs: string[];
  issues: string[];
}

/* ─── Style presets ─────────────────────────────────────────
   ASS color format: &HAABBGGRR (alpha, blue, green, red)
   Alpha 00 = opaque
   PrimaryColour  = màu chữ đang được highlight (karaoke)
   SecondaryColour = màu chữ chưa đến lượt
   ─────────────────────────────────────────────────────────── */
interface StylePreset {
  font:      string;
  size:      number;
  primary:   string;  // highlight color
  secondary: string;  // resting color (white variants)
  spacing:   number;
}

const PRESETS: StylePreset[] = [
  // Gold — ấm, sang
  { font: "Arial", size: 72, primary: "&H0000CCFF", secondary: "&H00BBBBBB", spacing: 1 },
  // Cyan neon — tươi, trẻ
  { font: "Arial", size: 72, primary: "&H00FFFF00", secondary: "&H00BBBBBB", spacing: 1 },
  // Hot pink — sôi động
  { font: "Arial", size: 72, primary: "&H00EE44FF", secondary: "&H00BBBBBB", spacing: 0 },
  // Neon green — năng động
  { font: "Arial", size: 72, primary: "&H0030EE30", secondary: "&H00BBBBBB", spacing: 0 },
  // Orange fire — hứng khởi
  { font: "Arial", size: 72, primary: "&H000055FF", secondary: "&H00BBBBBB", spacing: 0 },
  // Sky blue — nhẹ nhàng
  { font: "Arial", size: 72, primary: "&H00FFB422", secondary: "&H00BBBBBB", spacing: 1 },
];

/** Chọn preset cố định theo contentId (deterministic, mỗi video 1 style) */
export function pickPreset(seed: string): StylePreset {
  const n = seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return PRESETS[n % PRESETS.length];
}

/* ─── Chunk builder ─────────────────────────────────────────
   Mỗi chunk ~7-8 từ để karaoke dễ đọc hơn
   ─────────────────────────────────────────────────────────── */
/** Map một vị trí trong speech-time (bỏ silences) sang absolute audio time */
function speechToAbsolute(speechTime: number, segments: SpeechSegment[]): number {
  let remaining = speechTime;
  for (const seg of segments) {
    const len = seg.end - seg.start;
    if (remaining <= len) return seg.start + remaining;
    remaining -= len;
  }
  return segments[segments.length - 1].end;
}

const MAX_WORDS_PER_CHUNK = 5;
const MAX_FIRST_SUBTITLE_DELAY_SEC = 0.45;
const MAX_SUBTITLE_DRIFT_SEC = 0.9;
const MAX_LARGE_GAP_SEC = 2.25;

// Vietnamese fixed phrase pairs that must not be split across subtitle chunks.
// Each entry is [word1, word2] — both stripped of punctuation, lowercase.
const PROTECTED_PAIRS: [string, string][] = [
  ["thực", "tại"],
  ["hiện", "tại"],
  ["khổ", "đau"],
  ["buông", "xuống"],
  ["chấp", "nhận"],
  ["bình", "an"],
  ["vô", "thường"],
  ["nhân", "quả"],
];

function stripPunct(w: string): string {
  return w.replace(/[.,!?;:"""''…—–()\[\]]/g, "").toLowerCase();
}

function isProtectedPair(w1: string, w2: string): boolean {
  const a = stripPunct(w1);
  const b = stripPunct(w2);
  return PROTECTED_PAIRS.some(([p1, p2]) => a === p1 && b === p2);
}

// Merge trailing orphan: if the last chunk is a single short word (≤4 chars stripped),
// pull it into the preceding chunk.
function mergeTrailingOrphan(chunks: string[]): string[] {
  if (chunks.length < 2) return chunks;
  const last = chunks[chunks.length - 1];
  const lastWords = last.trim().split(/\s+/);
  if (lastWords.length === 1 && stripPunct(lastWords[0]).length <= 4) {
    const merged = chunks.slice(0, -1);
    merged[merged.length - 1] = merged[merged.length - 1] + " " + last;
    return merged;
  }
  return chunks;
}

export function normalizeSubtitleText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Post-process SubtitleChunks built from Whisper timing:
 * 1. Fix protected-pair splits by moving the split word into the next chunk.
 * 2. Merge trailing orphan (single short word) into the preceding chunk.
 * Timing is adjusted by splitting the affected chunk's duration proportionally.
 */
function repairChunkBoundaries(chunks: SubtitleChunk[]): SubtitleChunk[] {
  if (chunks.length === 0) return chunks;
  let out = [...chunks];

  // Pass 1: fix protected-pair splits
  for (let i = 0; i < out.length - 1; i++) {
    const cur = out[i];
    const nxt = out[i + 1];
    const curWords = cur.text.split(/\s+/);
    const nxtWords = nxt.text.split(/\s+/);
    if (curWords.length === 0 || nxtWords.length === 0) continue;
    const lastWord = curWords[curWords.length - 1];
    const firstWord = nxtWords[0];
    if (isProtectedPair(lastWord, firstWord)) {
      // Move lastWord of cur to the front of nxt
      const splitDur = (cur.end - cur.start) / Math.max(1, curWords.length);
      const newCurEnd = Math.max(cur.start + 0.05, cur.end - splitDur);
      out[i] = { ...cur, end: newCurEnd, text: curWords.slice(0, -1).join(" ") || "…" };
      out[i + 1] = { ...nxt, text: [lastWord, ...nxtWords].join(" ") };
    }
  }

  // Pass 2: trailing orphan — merge single short word into previous chunk
  if (out.length >= 2) {
    const last = out[out.length - 1];
    const lastWords = last.text.trim().split(/\s+/);
    if (lastWords.length === 1 && stripPunct(lastWords[0]).length <= 4) {
      const prev = out[out.length - 2];
      out = [
        ...out.slice(0, -2),
        { ...prev, end: last.end, text: prev.text + " " + last.text },
      ];
    }
  }

  return out;
}

/**
 * Build subtitle chunks from Whisper word-level timestamps.
 * Timing comes from Whisper (accurate), text comes from actualText (correct spelling).
 * If actualText is not provided, falls back to Whisper's transcription.
 */
export function buildSubtitleChunksFromWords(words: WordTimestamp[], actualText?: string): SubtitleChunk[] {
  if (words.length === 0) return [];

  // Build timing windows from Whisper (groups of MAX_WORDS_PER_CHUNK)
  const timingWindows: { start: number; end: number; wordCount: number }[] = [];
  for (let i = 0; i < words.length; i += MAX_WORDS_PER_CHUNK) {
    const group = words.slice(i, i + MAX_WORDS_PER_CHUNK);
    timingWindows.push({ start: group[0].start, end: group[group.length - 1].end, wordCount: group.length });
  }

  if (!actualText) {
    // Fallback: use Whisper text (may have wrong diacritics)
    const raw = timingWindows.map((tw, i) => ({
      start: tw.start,
      end: tw.end,
      text: words.slice(i * MAX_WORDS_PER_CHUNK, (i + 1) * MAX_WORDS_PER_CHUNK).map(w => w.word).join(" "),
    }));
    return repairChunkBoundaries(raw);
  }

  // Keep chunk boundaries close to Whisper grouping so subtitle timing stays attached
  // to the spoken words even when Whisper misses some diacritics.
  const actualWords = actualText.trim().split(/\s+/).filter(w => w.length > 0);
  const result: SubtitleChunk[] = [];
  let cursor = 0;

  for (let i = 0; i < timingWindows.length; i += 1) {
    const tw = timingWindows[i];
    const remainingChunks = timingWindows.length - i;
    const remainingWords = actualWords.length - cursor;
    const take = i === timingWindows.length - 1
      ? remainingWords
      : Math.max(1, Math.min(tw.wordCount, remainingWords - (remainingChunks - 1)));
    const slice = actualWords.slice(cursor, cursor + take);
    result.push({
      start: tw.start,
      end: tw.end,
      text: slice.join(" ") || "…",
    });
    cursor += take;
  }

  return repairChunkBoundaries(result);
}

export function buildSubtitleChunks(
  text: string,
  totalDuration: number,
  speechSegments?: SpeechSegment[],
): SubtitleChunk[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  const rawSentences = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const allWords: string[] = [];
  for (const sentence of rawSentences) {
    for (const word of sentence.split(/\s+/)) {
      if (word) allWords.push(word);
    }
  }

  const rawChunks: string[] = [];
  let current: string[] = [];
  for (let i = 0; i < allWords.length; i++) {
    current.push(allWords[i]);
    if (current.length >= MAX_WORDS_PER_CHUNK) {
      // Don't break here if doing so would split a protected pair
      if (i + 1 < allWords.length && isProtectedPair(allWords[i], allWords[i + 1])) {
        current.push(allWords[i + 1]);
        i++;
      }
      rawChunks.push(current.join(" ").trim());
      current = [];
    }
  }
  if (current.length > 0) rawChunks.push(current.join(" ").trim());

  const chunks = mergeTrailingOrphan(rawChunks);
  if (chunks.length === 0) return [];

  const wordCounts = chunks.map((c) => c.split(/\s+/).length);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);

  // Dùng speech segments nếu có → subtitle khớp giọng đọc, bỏ qua silences
  const segs = speechSegments && speechSegments.length > 0 ? speechSegments : null;
  const speechDuration = segs
    ? segs.reduce((s, seg) => s + (seg.end - seg.start), 0)
    : totalDuration;

  const result: SubtitleChunk[] = [];
  let speechCursor = 0;
  for (let i = 0; i < chunks.length; i++) {
    const dur = Math.max(0.3, (wordCounts[i] / totalWords) * speechDuration);
    const speechEnd = Math.min(speechCursor + dur, speechDuration);
    const start = segs ? speechToAbsolute(speechCursor, segs) : speechCursor;
    const end   = segs ? speechToAbsolute(speechEnd,   segs) : Math.min(speechEnd, totalDuration);
    result.push({ start, end, text: chunks[i] });
    speechCursor = speechEnd;
  }
  return result;
}

export function validateAndRepairSubtitleChunks(
  inputChunks: SubtitleChunk[],
  totalDuration: number,
  speechSegments?: SpeechSegment[],
): SubtitleValidationResult {
  const repairs: string[] = [];
  const expectedSpeechStart = speechSegments?.[0]?.start ?? 0;
  const expectedSpeechEnd = speechSegments?.[speechSegments.length - 1]?.end ?? totalDuration;

  let blankSegmentCount = 0;
  let excessiveNewlineBlockCount = 0;

  let chunks = inputChunks
    .map((chunk) => {
      const rawText = chunk.text ?? "";
      if (/\n{2,}|\r\n|\r/.test(rawText)) excessiveNewlineBlockCount += 1;
      const normalizedText = normalizeSubtitleText(rawText);
      if (!normalizedText || chunk.end <= chunk.start) {
        blankSegmentCount += 1;
      }
      return {
        start: Math.max(0, chunk.start),
        end: Math.min(totalDuration, Math.max(chunk.end, chunk.start)),
        text: normalizedText,
      };
    })
    .filter((chunk) => chunk.text.length > 0 && chunk.end - chunk.start >= 0.05)
    .sort((a, b) => a.start - b.start);

  if (excessiveNewlineBlockCount > 0) repairs.push("collapse_newlines");
  if (blankSegmentCount > 0 || chunks.length !== inputChunks.length) repairs.push("remove_blank_segments");
  if (chunks.length > 0 && inputChunks.some((chunk) => normalizeSubtitleText(chunk.text ?? "") !== chunk.text)) {
    repairs.push("normalize_text");
  }

  if (chunks.length > 0) {
    const leadingDelta = chunks[0].start - expectedSpeechStart;
    if (leadingDelta > 0.18) {
      chunks = chunks.map((chunk) => ({
        ...chunk,
        start: Math.max(expectedSpeechStart, chunk.start - leadingDelta),
        end: Math.max(expectedSpeechStart + 0.05, chunk.end - leadingDelta),
      }));
      repairs.push("trim_leading_silence_alignment");
    }
  }

  // Extend last chunk when Whisper misses trailing TTS tail (e.g. reverb/breath).
  // Only stretches end; does not shift other chunks.
  if (chunks.length > 0) {
    const trailingGap = expectedSpeechEnd - chunks[chunks.length - 1].end;
    if (trailingGap > 0.18 && trailingGap <= 1.5) {
      chunks[chunks.length - 1] = {
        ...chunks[chunks.length - 1],
        end: Math.min(totalDuration, expectedSpeechEnd),
      };
      repairs.push("extend_trailing_coverage");
    }
  }

  let maxGapSeconds = 0;
  let largeGapCount = 0;
  for (let i = 1; i < chunks.length; i += 1) {
    const gap = Math.max(0, chunks[i].start - chunks[i - 1].end);
    maxGapSeconds = Math.max(maxGapSeconds, gap);
    if (gap > MAX_LARGE_GAP_SEC) largeGapCount += 1;
  }

  const firstSubtitleStartSec = chunks[0]?.start ?? null;
  const firstStartDelay = firstSubtitleStartSec == null ? totalDuration : Math.max(0, firstSubtitleStartSec - expectedSpeechStart);
  const endDrift = chunks.length > 0 ? Math.abs(expectedSpeechEnd - chunks[chunks.length - 1].end) : totalDuration;
  const driftSeconds = Math.max(firstStartDelay, endDrift);

  const checks: SubtitleHealthCheckFlags = {
    firstSubtitleStart: firstStartDelay <= MAX_FIRST_SUBTITLE_DELAY_SEC,
    blankSegments: blankSegmentCount === 0,
    excessiveNewlineBlocks: excessiveNewlineBlockCount === 0,
    subtitleAudioDrift: driftSeconds <= MAX_SUBTITLE_DRIFT_SEC,
    largeSubtitleGaps: largeGapCount === 0,
  };

  let subtitleHealthScore = 100;
  if (!checks.firstSubtitleStart) subtitleHealthScore -= 18;
  subtitleHealthScore -= Math.min(30, blankSegmentCount * 12);
  subtitleHealthScore -= Math.min(15, excessiveNewlineBlockCount * 5);
  if (!checks.subtitleAudioDrift) subtitleHealthScore -= 22;
  subtitleHealthScore -= Math.min(25, largeGapCount * 8);
  subtitleHealthScore = Math.max(0, Math.min(100, subtitleHealthScore));

  const issues: string[] = [];
  if (!checks.firstSubtitleStart) {
    issues.push(`First subtitle starts too late (${firstStartDelay.toFixed(2)}s).`);
  }
  if (!checks.blankSegments) {
    issues.push(`Found ${blankSegmentCount} blank/invalid subtitle segments.`);
  }
  if (!checks.excessiveNewlineBlocks) {
    issues.push(`Found ${excessiveNewlineBlockCount} excessive newline subtitle blocks.`);
  }
  if (!checks.subtitleAudioDrift) {
    issues.push(`Subtitle/audio drift is ${driftSeconds.toFixed(2)}s.`);
  }
  if (!checks.largeSubtitleGaps) {
    issues.push(`Found ${largeGapCount} large subtitle gaps (max ${maxGapSeconds.toFixed(2)}s).`);
  }
  if (chunks.length === 0) {
    issues.push("No subtitle chunks remain after repair.");
    subtitleHealthScore = 0;
  }

  // blank segments are always removed by the filter above; subtitleHealthScore already
  // penalises them (−12 each), so checks.blankSegments is redundant in the PASS gate.
  const status: "PASS" | "FAIL" =
    chunks.length > 0 &&
    subtitleHealthScore >= 70 &&
    checks.firstSubtitleStart &&
    checks.subtitleAudioDrift
      ? "PASS"
      : "FAIL";

  return {
    status,
    subtitleHealthScore,
    chunks,
    checks,
    metrics: {
      firstSubtitleStartSec,
      expectedSpeechStartSec: expectedSpeechStart,
      expectedSpeechEndSec: expectedSpeechEnd,
      blankSegmentCount,
      excessiveNewlineBlockCount,
      driftSeconds,
      maxGapSeconds,
      largeGapCount,
    },
    repairs: Array.from(new Set(repairs)),
    issues,
  };
}

function toAssTime(s: number): string {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100);
  return `${h}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
}

/* ─── ASS builder ───────────────────────────────────────────
   Karaoke style (CapCut/TikTok chuẩn):
   - 1 dialogue line / chunk, ASS tự căn lề, không tính pixel
   - \k{cs}: từng chữ pop instant sang màu primary khi đến lượt
   - secondary = xám nhạt → primary = màu vivid: contrast rõ ràng
   - Chunk bounce-in nhẹ (110%→100%) + fade-out mượt
   ─────────────────────────────────────────────────────────── */
export function buildAssFile(
  chunks: SubtitleChunk[],
  width   = 1080,
  height  = 1920,
  seed    = "",
  marginV = 320,
): string {
  const p = pickPreset(seed);

  const styleRow =
    `Style: Default,${p.font},${p.size},` +
    `${p.primary},${p.secondary},` +
    `&H00000000,&H88000000,` +
    `-1,0,0,0,` +
    `100,100,${p.spacing},0,` +
    `1,3,2,` +
    `2,` +
    `60,60,${marginV},1`;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 1
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleRow}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = chunks.map((chunk) => {
    const words     = chunk.text.split(/\s+/);
    const totalCs   = Math.max(1, Math.round((chunk.end - chunk.start) * 100));
    const charLens  = words.map((w) => Math.max(1, w.length));
    const totalChars = charLens.reduce((a, b) => a + b, 0);

    // \k{cs} per word: tỉ lệ theo độ dài ký tự
    let assigned = 0;
    const kWords = words.map((word, i) => {
      const cs =
        i === words.length - 1
          ? Math.max(1, totalCs - assigned)
          : Math.max(1, Math.round((charLens[i] / totalChars) * totalCs));
      assigned += cs;
      return `{\\k${cs}}${word}`;
    });

    // Clean fade-in/out — no scale overshoot (110% caused stretch/distortion artifacts)
    // No \4blur (shadow blur caused muddy/halo appearance)
    const fx   = `{\\fad(60,120)}`;
    const text = fx + kWords.join(" ");
    return `Dialogue: 0,${toAssTime(chunk.start)},${toAssTime(chunk.end)},Default,,0,0,0,,${text}`;
  });

  return [header, ...events].join("\n");
}

// ── Longform subtitle style (no karaoke, sentence-sized chunks) ───────────────

const MAX_WORDS_LONGFORM = 12;

/**
 * Build larger subtitle chunks for longform videos.
 * Prefers sentence boundaries; targets ~12 words per chunk.
 * Timing comes from Whisper word timestamps.
 */
export function buildSubtitleChunksLongform(
  words: WordTimestamp[],
  maxWords = MAX_WORDS_LONGFORM,
): SubtitleChunk[] {
  if (words.length === 0) return [];
  const chunks: SubtitleChunk[] = [];
  let i = 0;
  while (i < words.length) {
    const group: WordTimestamp[] = [];
    while (i < words.length && group.length < maxWords) {
      group.push(words[i]);
      const w = words[i].word;
      i++;
      // Break at sentence-ending punctuation once we have at least half target size
      if (group.length >= Math.ceil(maxWords / 2) && /[.!?。]/.test(w)) break;
    }
    chunks.push({
      start: group[0].start,
      end:   group[group.length - 1].end,
      text:  group.map(w => w.word).join(" "),
    });
  }
  return chunks;
}

/**
 * ASS file for longform: clean white text, no karaoke animation.
 * Soft fade in/out, dark outline for readability over any background.
 */
export function buildLongformAssFile(
  chunks: SubtitleChunk[],
  width   = 1920,
  height  = 1080,
  marginV = 80,
): string {
  const fontSize     = 52;
  const primaryColor = "&H00FFFFFF"; // white
  const outlineColor = "&H00000000"; // black
  const backColor    = "&HAA000000"; // semi-transparent black shadow

  const styleRow =
    `Style: Default,Arial,${fontSize},` +
    `${primaryColor},${primaryColor},` +
    `${outlineColor},${backColor},` +
    `0,0,0,0,` +
    `100,100,0,0,` +
    `1,2.5,1.5,` +
    `2,` +
    `60,60,${marginV},1`;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 1
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleRow}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = chunks.map((chunk) => {
    const text = `{\\fad(250,200)}${chunk.text}`;
    return `Dialogue: 0,${toAssTime(chunk.start)},${toAssTime(chunk.end)},Default,,0,0,0,,${text}`;
  });

  return [header, ...events].join("\n");
}

// ── Subtitle render metadata & validation ────────────────────────────────────

/** Config constants exposed for QA validation */
export const SUBTITLE_RENDER_CONSTANTS = {
  RENDER_WIDTH:        1080,
  RENDER_HEIGHT:       1920,
  FONT_FAMILY:         "Arial",
  FONT_SIZE:           72,
  MARGIN_V:            340,   // default; actual value passed at runtime
  MAX_WORDS_PER_CHUNK: MAX_WORDS_PER_CHUNK,  // 5
  SCALE_X:             100,
  SCALE_Y:             100,
  WRAP_STYLE:          1,
  BURN_STAGE:          "post-scale-crop-concat",
  HAS_LATE_SCALE_AFTER_SUBTITLE: false,
  VIETNAMESE_SAFE_FONTS: ["Arial", "Arial Unicode MS", "Noto Sans", "DejaVu Sans"],
} as const;

export interface SubtitleRenderMetadata {
  contentId:                   string;
  videoPath:                   string | null;
  subtitlePath:                string | null;
  subtitleFormat:              "ass";
  playResX:                    number;
  playResY:                    number;
  fontFamily:                  string;
  fontSize:                    number;
  marginV:                     number;
  maxLineChars:                number;   // estimated: MAX_WORDS_PER_CHUNK × avg chars
  burnStage:                   string;
  hasLateScaleAfterSubtitle:   boolean;
  validationResult:            "PASS" | "FAIL";
  validationErrors:            string[];
}

export interface SubtitleRenderValidation {
  pass: boolean;
  errors: string[];
}

const MIN_READABLE_FONT_SIZE   = 56;    // below this is too small at 1080p
const MIN_SAFE_MARGIN_V        = 200;   // below this clips into bottom UI chrome
const MAX_SAFE_LINE_CHARS      = 30;    // ~5 Vietnamese words × avg 5 chars + spaces

export function validateSubtitleRenderConfig(opts: {
  playResX: number;
  playResY: number;
  renderWidth: number;
  renderHeight: number;
  fontFamily: string;
  fontSize: number;
  marginV: number;
  scaleX: number;
  scaleY: number;
  hasLateScaleAfterSubtitle: boolean;
  subtitleExists: boolean;
  maxWordsPerChunk: number;
}): SubtitleRenderValidation {
  const errors: string[] = [];

  if (!opts.subtitleExists) {
    errors.push("Subtitle file missing.");
  }
  if (opts.playResX === 0 || opts.playResY === 0) {
    errors.push("ASS PlayResX/PlayResY is zero or missing.");
  }
  if (opts.playResX !== opts.renderWidth || opts.playResY !== opts.renderHeight) {
    errors.push(
      `ASS PlayRes (${opts.playResX}×${opts.playResY}) does not match render target (${opts.renderWidth}×${opts.renderHeight}).`
    );
  }
  if (opts.scaleX !== 100) {
    errors.push(`ASS Style ScaleX is ${opts.scaleX}, expected 100.`);
  }
  if (opts.scaleY !== 100) {
    errors.push(`ASS Style ScaleY is ${opts.scaleY}, expected 100.`);
  }
  if (opts.fontSize < MIN_READABLE_FONT_SIZE) {
    errors.push(`Font size ${opts.fontSize} is below readable minimum (${MIN_READABLE_FONT_SIZE}).`);
  }
  if (opts.marginV < MIN_SAFE_MARGIN_V) {
    errors.push(`MarginV ${opts.marginV} is below safe minimum (${MIN_SAFE_MARGIN_V}).`);
  }
  const estimatedMaxChars = opts.maxWordsPerChunk * 6; // avg 6 chars/word incl space
  if (estimatedMaxChars > MAX_SAFE_LINE_CHARS * 1.4) {
    errors.push(
      `maxWordsPerChunk=${opts.maxWordsPerChunk} may produce lines >~${estimatedMaxChars} chars — wrapping risk.`
    );
  }
  if (opts.hasLateScaleAfterSubtitle) {
    errors.push("Subtitle burned before a later non-uniform scale step — text will be distorted.");
  }
  const vnsafe = SUBTITLE_RENDER_CONSTANTS.VIETNAMESE_SAFE_FONTS as readonly string[];
  if (!vnsafe.includes(opts.fontFamily)) {
    errors.push(
      `Font "${opts.fontFamily}" is not in Vietnamese-safe allowlist: ${vnsafe.join(", ")}.`
    );
  }

  return { pass: errors.length === 0, errors };
}

/** Build metadata record from runtime render parameters. */
export function buildSubtitleRenderMetadata(opts: {
  contentId:     string;
  videoPath:     string | null;
  subtitlePath:  string | null;
  marginV:       number;
  subtitleExists: boolean;
}): SubtitleRenderMetadata {
  const C = SUBTITLE_RENDER_CONSTANTS;
  const validation = validateSubtitleRenderConfig({
    playResX:                  C.RENDER_WIDTH,
    playResY:                  C.RENDER_HEIGHT,
    renderWidth:               C.RENDER_WIDTH,
    renderHeight:              C.RENDER_HEIGHT,
    fontFamily:                C.FONT_FAMILY,
    fontSize:                  C.FONT_SIZE,
    marginV:                   opts.marginV,
    scaleX:                    C.SCALE_X,
    scaleY:                    C.SCALE_Y,
    hasLateScaleAfterSubtitle: C.HAS_LATE_SCALE_AFTER_SUBTITLE,
    subtitleExists:            opts.subtitleExists,
    maxWordsPerChunk:          C.MAX_WORDS_PER_CHUNK,
  });

  return {
    contentId:                  opts.contentId,
    videoPath:                  opts.videoPath,
    subtitlePath:               opts.subtitlePath,
    subtitleFormat:             "ass",
    playResX:                   C.RENDER_WIDTH,
    playResY:                   C.RENDER_HEIGHT,
    fontFamily:                 C.FONT_FAMILY,
    fontSize:                   C.FONT_SIZE,
    marginV:                    opts.marginV,
    maxLineChars:               C.MAX_WORDS_PER_CHUNK * 6,
    burnStage:                  C.BURN_STAGE,
    hasLateScaleAfterSubtitle:  C.HAS_LATE_SCALE_AFTER_SUBTITLE,
    validationResult:           validation.pass ? "PASS" : "FAIL",
    validationErrors:           validation.errors,
  };
}
