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
  { font: "Arial", size: 64, primary: "&H0000CCFF", secondary: "&H00BBBBBB", spacing: 1 },
  // Cyan neon — tươi, trẻ
  { font: "Arial", size: 64, primary: "&H00FFFF00", secondary: "&H00BBBBBB", spacing: 1 },
  // Hot pink — sôi động
  { font: "Arial", size: 64, primary: "&H00EE44FF", secondary: "&H00BBBBBB", spacing: 0 },
  // Neon green — năng động
  { font: "Arial", size: 64, primary: "&H0030EE30", secondary: "&H00BBBBBB", spacing: 0 },
  // Orange fire — hứng khởi
  { font: "Arial", size: 64, primary: "&H000055FF", secondary: "&H00BBBBBB", spacing: 0 },
  // Sky blue — nhẹ nhàng
  { font: "Arial", size: 64, primary: "&H00FFB422", secondary: "&H00BBBBBB", spacing: 1 },
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

const MAX_WORDS_PER_CHUNK = 4;

/**
 * Build subtitle chunks from Whisper word-level timestamps.
 * Timing comes from Whisper (accurate), text comes from actualText (correct spelling).
 * If actualText is not provided, falls back to Whisper's transcription.
 */
export function buildSubtitleChunksFromWords(words: WordTimestamp[], actualText?: string): SubtitleChunk[] {
  if (words.length === 0) return [];

  // Build timing windows from Whisper (groups of MAX_WORDS_PER_CHUNK)
  const timingWindows: { start: number; end: number }[] = [];
  for (let i = 0; i < words.length; i += MAX_WORDS_PER_CHUNK) {
    const group = words.slice(i, i + MAX_WORDS_PER_CHUNK);
    timingWindows.push({ start: group[0].start, end: group[group.length - 1].end });
  }

  if (!actualText) {
    // Fallback: use Whisper text (may have wrong diacritics)
    return timingWindows.map((tw, i) => ({
      ...tw,
      text: words.slice(i * MAX_WORDS_PER_CHUNK, (i + 1) * MAX_WORDS_PER_CHUNK).map(w => w.word).join(" "),
    }));
  }

  // Distribute actual words proportionally across timing windows
  const actualWords = actualText.trim().split(/\s+/).filter(w => w.length > 0);
  const numChunks = timingWindows.length;

  return timingWindows.map((tw, i) => {
    const startIdx = Math.round((i / numChunks) * actualWords.length);
    const endIdx   = i === numChunks - 1
      ? actualWords.length
      : Math.round(((i + 1) / numChunks) * actualWords.length);
    return {
      start: tw.start,
      end:   tw.end,
      text:  actualWords.slice(startIdx, endIdx).join(" ") || "…",
    };
  });
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

  const MAX_WORDS = 4;
  const chunks: string[] = [];
  let current = "";
  // Split word-by-word so sentences longer than MAX_WORDS are also broken up
  for (const sentence of rawSentences) {
    for (const word of sentence.split(/\s+/)) {
      const cw = current ? current.split(/\s+/).length : 0;
      if (current && cw >= MAX_WORDS) {
        chunks.push(current.trim());
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
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
    `1,5,3,` +
    `2,` +
    `60,60,${marginV},1`;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
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

    // Bounce-in chunk (110%→100% / 280ms) + blur shadow + fade-out cuối
    const fx   = `{\\t(0,100,\\fscx110\\fscy110)\\t(100,280,\\fscx100\\fscy100)\\4blur6\\fad(0,150)}`;
    const text = fx + kWords.join(" ");
    return `Dialogue: 0,${toAssTime(chunk.start)},${toAssTime(chunk.end)},Default,,0,0,0,,${text}`;
  });

  return [header, ...events].join("\n");
}
