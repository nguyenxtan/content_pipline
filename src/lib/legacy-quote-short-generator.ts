import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { getLibx264Args, getVideoToolboxArgs, isAppleSilicon } from "@/lib/pipeline/perf";
import { inferStrategicTopicFamily, normalizeTopicFamily } from "@/lib/config/topic-family-registry";
import type { BuddhistVisualMetadata } from "@/lib/config/buddhist-visual-categories";
import type { QuoteImageMeta } from "@/lib/quote-image-meta";

const execFileAsync = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg") as { path: string };
const FFMPEG_PATH = ffmpegInstaller.path;

const WIDTH = 1080;
const HEIGHT = 1920;
const DEFAULT_DURATION_SEC = 14;
const FORMAT_TYPE = "legacy_quote_short" as const;
const DEFAULT_CHANNEL_NAME = "Giới Định Tuệ";
const MUSIC_VOLUME = 0.38;
const SILENT_MEAN_VOLUME_DB = -55;
const FPS = 30;
const KEN_BURNS_MOTION_STRENGTH = "medium_strong";

export type KineticChunk = {
  text: string;
  emphasis: boolean;
  size: "small" | "medium" | "large" | "xlarge";
};

export type KineticTextSidecar = {
  chunks: KineticChunk[];
  accentWords: string[];
  microReflection?: string;
  layoutPreset?: string;
  layoutWarnings?: string[];
};

export type ContentTagFields = {
  contentType?: string;
  teachingType?: string;
  seriesName?: string;
  seriesNumber?: number;
  sourceType?: string;
  contentMood?: string;
  audienceIntent?: string;
  retentionDevice?: string;
  openingSceneType?: string;
  visualMotifs?: string[];
  hookStyle?: string;
  profileVerified?: boolean;
};

export type LegacyQuoteShortInput = {
  contentId: string;
  topic: string;
  sourceImagePath: string;
  outputDir?: string;
  quoteText?: string;
  reflectionText?: string;
  topicFamily?: string;
  durationSec?: number;
  musicPath?: string | null;
  channelName?: string;
  channelProfileId?: string;
  workspaceId?: string;
  channelKey?: string;
  contentProfileKey?: string;
  experimentId?: string;
  experimentVariant?: string;
  visualMode?: "footage" | "ken_burns_image" | "quote_reflection_card" | "note_letter_card" | "kinetic_typography" | "bilingual_minimal";
  quoteStyle?: "short_quote" | "reflection_card" | "note_letter" | "kinetic_quote" | "bilingual_minimal" | "static_deep_quote";
  visualMood?: string;
  musicMood?: string;
  colorPalette?: string;
  visualTemperature?: string;
  buddhistVisualMeta?: BuddhistVisualMetadata;
  noteLetterText?: string;
  englishLine?: string;
  kineticText?: KineticTextSidecar;
  imageMeta?: QuoteImageMeta;
  tags?: ContentTagFields;
};

export type LegacyQuoteShortMetadata = {
  formatType: typeof FORMAT_TYPE;
  contentId: string;
  topic: string;
  topicFamily: string;
  channelName: string;
  channelProfileId?: string;
  workspaceId?: string;
  channelKey?: string;
  contentProfileKey?: string;
  quoteText: string;
  mainQuote: string;
  reflectionText?: string;
  noteLetterText?: string;
  englishLine?: string;
  kineticText?: KineticTextSidecar;
  quoteStyle: "short_quote" | "reflection_card" | "note_letter" | "kinetic_quote" | "bilingual_minimal" | "static_deep_quote";
  visualMood: string;
  musicMood: string;
  visualSearchKeywords: string[];
  backgroundMusicPath: string | null;
  sourceImagePath: string;
  renderedImagePath: string;
  videoPath: string;
  metadataPath: string;
  durationSec: number;
  width: 1080;
  height: 1920;
  experimentId: string;
  experimentVariant: string;
  noTtsVoice: true;
  platformReady: {
    youtubeShorts: boolean;
    facebookReels: boolean;
  };
  visualMode: "footage" | "ken_burns_image" | "quote_reflection_card" | "note_letter_card" | "kinetic_typography" | "bilingual_minimal";
  motionStrength: string;
  colorPalette?: string;
  visualTemperature?: string;
  buddhistVisualMeta?: BuddhistVisualMetadata;
  imageMeta?: QuoteImageMeta;
  audioValidation: {
    musicPath: string | null;
    audioStreamPresent: boolean;
    meanVolumeDb: number | null;
    maxVolumeDb: number | null;
  };
  tags?: ContentTagFields;
};

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function escapeAssText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function normalizeText(value: string): string {
  return value
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMultilineText(value: string): string {
  return value
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/[“”"]/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Internal helper for fallback quote-text library selection only.
// The sidecar topicFamily field uses inferStrategicTopicFamily() instead.
function legacyFamilyForQuoteText(topic: string): string {
  const t = topic.toLocaleLowerCase("vi-VN");
  if (/sợ|bất an|lo|hoang mang/.test(t)) return "fear_anxiety";
  if (/buông|tha thứ|oán|giận|hận/.test(t)) return "letting_go_forgiveness";
  if (/bình yên|an nhiên|chánh niệm|tĩnh/.test(t)) return "peace_mindfulness";
  if (/nhân quả|karma|phước|nghiệp/.test(t)) return "karma";
  if (/cô đơn|tổn thương|đau|buồn/.test(t)) return "hurt_loneliness";
  return "buddhist_life_wisdom";
}

export function generateLegacyQuoteText(topic: string): string {
  const family = legacyFamilyForQuoteText(topic);
  const cleanTopic = normalizeText(topic).toLocaleLowerCase("vi-VN");
  const library: Record<string, string[]> = {
    fear_anxiety: [
      "Bình an đến khi ta thôi chạy theo nỗi sợ.",
      "Điều làm ta bất an thường chỉ là một ý nghĩ chưa được buông xuống.",
      "Tâm lặng rồi, chuyện lớn cũng hóa nhẹ.",
    ],
    letting_go_forgiveness: [
      "Buông được một niệm, lòng nhẹ thêm một đời.",
      "Tha thứ không phải quên đi, mà là thôi tự làm đau mình.",
      "Giữ oán hận lâu ngày, người mệt nhất vẫn là ta.",
    ],
    peace_mindfulness: [
      "Bình yên không ở đâu xa, nó bắt đầu từ một hơi thở biết đủ.",
      "Tâm càng đơn giản, đời càng nhẹ nhàng.",
      "Một phút tĩnh lặng có thể cứu ta khỏi nhiều ngày rối ren.",
    ],
    karma: [
      "Nhân quả không vội, nhưng chưa từng quên ai.",
      "Gieo điều lành hôm nay, lòng đã nhẹ hơn ngày hôm qua.",
      "Mỗi việc nhỏ ta làm đều đang âm thầm viết nên ngày mai.",
    ],
    hurt_loneliness: [
      "Có những nỗi đau chỉ dịu lại khi ta thôi chống cự với chính mình.",
      "Cô đơn nhất là khi ta quên lắng nghe lòng mình.",
      "Vết thương nào cũng cần một khoảng lặng để lành.",
    ],
    buddhist_life_wisdom: [
      "Đời nhẹ hơn khi ta biết dừng lại đúng lúc.",
      "Người hiểu đời không nói nhiều, chỉ sống sâu hơn mỗi ngày.",
      "Có những điều mất đi để lòng người học cách rộng hơn.",
    ],
  };
  const choices = library[family] ?? library.buddhist_life_wisdom;
  const index = Array.from(cleanTopic).reduce((sum, ch) => sum + ch.codePointAt(0)!, 0) % choices.length;
  return choices[index]!;
}

export function getLegacyQuoteVisualKeywords(topic: string): string[] {
  const family = legacyFamilyForQuoteText(topic);
  const base = ["serene Buddha statue golden light", "lotus flower blooming", "warm sunrise temple", "peaceful monastery"];
  const byFamily: Record<string, string[]> = {
    fear_anxiety: ["Buddha silhouette dawn", "lotus pond calm", "warm morning light"],
    letting_go_forgiveness: ["lotus releasing petals", "gentle river lotus", "soft golden sunset temple"],
    peace_mindfulness: ["Buddha meditation golden halo", "temple sunrise pink lotus", "monks morning walk"],
    karma: ["golden lotus light", "temple bell sunrise", "radiant Buddha halo"],
    hurt_loneliness: ["lotus blooming water", "warm monastery courtyard", "compassionate Buddha face"],
    buddhist_life_wisdom: ["pagoda dawn light", "bamboo morning mist", "Buddha garden golden hour"],
  };
  return [...base, ...(byFamily[family] ?? byFamily.buddhist_life_wisdom)];
}

// Tầng Sâu is a secular philosophy channel — not Buddhist content.
// These replace the Buddhist-coded default keywords in sidecar metadata for Tang Sau context.
export const TANG_SAU_VISUAL_KEYWORDS = [
  "modern editorial lifestyle",
  "quiet city moment",
  "soft daylight interior",
  "apartment window light",
  "cafe corner daylight",
  "clean desk still life",
  "rain on glass",
  "empty street after rain",
  "blue hour city",
  "Kinfolk style photography",
];

function isTangSauInput(input: { channelProfileId?: string; channelKey?: string; workspaceId?: string; contentProfileKey?: string }): boolean {
  return (
    input.workspaceId === "tang_sau_workspace" ||
    input.channelProfileId === "tang_sau_v1" ||
    input.channelKey === "tang_sau" ||
    input.contentProfileKey === "philosophy"
  );
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((sum, ch) => {
    if (/\s/.test(ch)) return sum + fontSize * 0.32;
    if (/[MWĐ]/.test(ch)) return sum + fontSize * 0.82;
    if (/[ilI1.,;:'|!]/.test(ch)) return sum + fontSize * 0.36;
    return sum + fontSize * 0.62;
  }, 0);
}

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrapParagraphToWidth(text: string, fontSize: number, maxWidth: number): string[] {
  return wrapText(text, fontSize, maxWidth);
}

function normalizeSentenceTrim(value: string): string {
  return value.replace(/[\s,;:]+$/u, "").trim();
}

function splitWords(text: string): string[] {
  return normalizeText(text).split(/\s+/).filter(Boolean);
}

function trimLineWithEllipsis(line: string, fontSize: number, maxWidth: number): string {
  const normalized = normalizeSentenceTrim(line);
  if (!normalized) return "…";

  const sentenceBoundary = Math.max(
    normalized.lastIndexOf("."),
    normalized.lastIndexOf("!"),
    normalized.lastIndexOf("?"),
    normalized.lastIndexOf("…"),
  );
  const preferred = sentenceBoundary >= Math.round(normalized.length * 0.5)
    ? normalizeSentenceTrim(normalized.slice(0, sentenceBoundary + 1))
    : normalized;

  const words = preferred.split(/\s+/).filter(Boolean);
  for (let count = words.length; count >= 1; count -= 1) {
    const candidate = normalizeSentenceTrim(words.slice(0, count).join(" "));
    if (!candidate) continue;
    const withEllipsis = `${candidate}…`;
    if (estimateTextWidth(withEllipsis, fontSize) <= maxWidth) return withEllipsis;
  }

  const chars = Array.from(preferred);
  while (chars.length > 1) {
    chars.pop();
    const candidate = `${normalizeSentenceTrim(chars.join(""))}…`;
    if (candidate !== "…" && estimateTextWidth(candidate, fontSize) <= maxWidth) return candidate;
  }
  return "…";
}

function fitLinesWithCleanFallback(input: {
  text: string;
  initialFontSize: number;
  minFontSize: number;
  fallbackMinFontSize: number;
  fontStep: number;
  maxWidth: number;
  maxLines: number;
  lineHeightFactor: number;
}): { lines: string[]; fontSize: number; lineHeight: number } {
  const normalized = normalizeText(input.text);
  const words = splitWords(normalized);
  if (words.length === 0) {
    const lineHeight = Math.round(input.minFontSize * input.lineHeightFactor);
    return { lines: [""], fontSize: input.minFontSize, lineHeight };
  }

  for (let fontSize = input.initialFontSize; fontSize >= input.minFontSize; fontSize -= input.fontStep) {
    const lines = wrapText(normalized, fontSize, input.maxWidth);
    if (lines.length <= input.maxLines) {
      return { lines, fontSize, lineHeight: Math.round(fontSize * input.lineHeightFactor) };
    }
  }

  for (let fontSize = input.minFontSize - input.fontStep; fontSize >= input.fallbackMinFontSize; fontSize -= input.fontStep) {
    const lines = wrapText(normalized, fontSize, input.maxWidth);
    if (lines.length <= input.maxLines) {
      return { lines, fontSize, lineHeight: Math.round(fontSize * input.lineHeightFactor) };
    }
  }

  const fontSize = input.fallbackMinFontSize;
  let bestCut = 1;
  let lastSentenceCut = 0;
  for (let count = 1; count <= words.length; count += 1) {
    const candidateText = words.slice(0, count).join(" ");
    const lines = wrapText(candidateText, fontSize, input.maxWidth);
    if (lines.length > input.maxLines) break;
    bestCut = count;
    if (/[.!?…]$/u.test(words[count - 1] ?? "")) {
      lastSentenceCut = count;
    }
  }

  const chosenCut =
    lastSentenceCut >= Math.max(3, Math.floor(bestCut * 0.6))
      ? lastSentenceCut
      : bestCut;

  const truncatedText = words.slice(0, chosenCut).join(" ");
  const lines = wrapText(truncatedText, fontSize, input.maxWidth).slice(0, input.maxLines);
  const lastIndex = Math.max(0, lines.length - 1);
  lines[lastIndex] = trimLineWithEllipsis(lines[lastIndex] ?? truncatedText, fontSize, input.maxWidth);

  return {
    lines,
    fontSize,
    lineHeight: Math.round(fontSize * input.lineHeightFactor),
  };
}

type KineticLayoutPreset =
  | "note_left_kinetic_right"
  | "note_right_kinetic_left"
  | "note_top_kinetic_bottom"
  | "note_bottom_kinetic_top"
  | "note_center_low_kinetic_upper"
  | "note_wide_center_kinetic_split";

type NoteRect = {
  x: number;
  y: number;
  width: number;
  maxHeight: number;
};

type PlacedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type KineticRegion = {
  centerX: number;
  top: number;
  bottom: number;
  centerShiftForEmphasis?: number;
  centerShiftForSmall?: number;
};

type KineticLayoutSpec = {
  preset: KineticLayoutPreset;
  noteRect: NoteRect;
  kineticRegion: KineticRegion;
};

type FittedMicroReflection = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  blockHeight: number;
  warnings: string[];
};

const KINETIC_LAYOUT_PRESETS: KineticLayoutSpec[] = [
  {
    preset: "note_left_kinetic_right",
    noteRect: { x: 104, y: 1000, width: 720, maxHeight: 500 },
    kineticRegion: { centerX: 706, top: 250, bottom: 930, centerShiftForEmphasis: 14, centerShiftForSmall: -18 },
  },
  {
    preset: "note_bottom_kinetic_top",
    noteRect: { x: 180, y: 1088, width: 720, maxHeight: 470 },
    kineticRegion: { centerX: 540, top: 220, bottom: 840, centerShiftForEmphasis: 16, centerShiftForSmall: -18 },
  },
  {
    preset: "note_center_low_kinetic_upper",
    noteRect: { x: 178, y: 1020, width: 720, maxHeight: 490 },
    kineticRegion: { centerX: 540, top: 230, bottom: 880, centerShiftForEmphasis: 18, centerShiftForSmall: -22 },
  },
];

function hashSeed(value: string): number {
  let hash = 0;
  for (const ch of value) {
    hash = (hash * 131 + (ch.codePointAt(0) ?? 0)) % 2147483647;
  }
  return hash;
}

function selectSeededKineticLayoutOrder(seed: string): KineticLayoutSpec[] {
  const items = [...KINETIC_LAYOUT_PRESETS];
  const startIndex = hashSeed(seed) % items.length;
  return [...items.slice(startIndex), ...items.slice(0, startIndex)];
}

function fitKineticMicroReflectionToRect(
  text: string,
  rect: NoteRect,
): FittedMicroReflection {
  const normalized = normalizeMultilineText(text);
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const warnings: string[] = [];

  for (let fontSize = 42; fontSize >= 38; fontSize -= 2) {
    for (const spacingFactor of [1.4, 1.34, 1.28, 1.24]) {
      const lineHeight = Math.round(fontSize * spacingFactor);
      const lines = paragraphs.flatMap((paragraph, index) => {
        const wrapped = wrapParagraphToWidth(paragraph, fontSize, rect.width);
        if (index < paragraphs.length - 1) wrapped.push("");
        return wrapped;
      });
      const compactLines = lines.filter((line, index, arr) => {
        if (line !== "") return true;
        return arr[index - 1] !== "";
      });
      const nonEmptyCount = compactLines.filter((line) => line.trim().length > 0).length;
      const blockHeight = compactLines.length * lineHeight;
      const longestLineWords = compactLines.reduce((max, line) => Math.max(max, line.trim().split(/\s+/).filter(Boolean).length), 0);
      if (nonEmptyCount <= 8 && compactLines.length <= 9 && longestLineWords <= 10 && blockHeight <= rect.maxHeight) {
        return { lines: compactLines, fontSize, lineHeight, blockHeight, warnings };
      }
    }
  }

  warnings.push("micro_reflection_dense_fit");
  for (let fontSize = 36; fontSize >= 34; fontSize -= 2) {
    for (const spacingFactor of [1.22, 1.18]) {
      const lineHeight = Math.round(fontSize * spacingFactor);
      const lines = paragraphs.flatMap((paragraph, index) => {
        const wrapped = wrapParagraphToWidth(paragraph, fontSize, rect.width + 32);
        if (index < paragraphs.length - 1) wrapped.push("");
        return wrapped;
      });
      const compactLines = lines.filter((line, index, arr) => {
        if (line !== "") return true;
        return arr[index - 1] !== "";
      });
      const blockHeight = compactLines.length * lineHeight;
      if (compactLines.length <= 8 && blockHeight <= rect.maxHeight) {
        warnings.push("micro_reflection_stress_font_below_normal");
        return { lines: compactLines, fontSize, lineHeight, blockHeight, warnings };
      }
    }
  }

  const fallbackWrapped = paragraphs.flatMap((paragraph, index) => {
    const wrapped = wrapParagraphToWidth(paragraph, 32, rect.width + 40);
    if (index < paragraphs.length - 1) wrapped.push("");
    return wrapped;
  });
  const visibleLines: string[] = [];
  for (const line of fallbackWrapped) {
    if (visibleLines.length >= 8) break;
    visibleLines.push(line);
  }
    warnings.push("micro_reflection_clamped_to_8_lines");
  return {
    lines: visibleLines,
    fontSize: 34,
    lineHeight: Math.round(34 * 1.18),
    blockHeight: visibleLines.length * Math.round(34 * 1.18),
    warnings,
  };
}

function estimateKineticBlockBounds(
  chunks: KineticChunk[],
  region: KineticRegion,
): { top: number; bottom: number; left: number; right: number; totalHeight: number; lineHeights: number[]; startY: number } | null {
  const lineHeights = chunks.map((c) => Math.round((KINETIC_FONT_SIZES[c.size] ?? 66) * 1.45));
  const totalHeight = lineHeights.reduce((s, h) => s + h, 0) + (chunks.length - 1) * 20;
  const usableHeight = region.bottom - region.top;
  if (totalHeight > usableHeight) return null;
  const startY = Math.max(region.top, Math.round(region.top + (usableHeight - totalHeight) / 2));

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const chunk of chunks) {
    const fontSize = KINETIC_FONT_SIZES[chunk.size ?? "medium"] ?? 66;
    const x = chunk.size === "small" && !chunk.emphasis
      ? region.centerX + (region.centerShiftForSmall ?? -24)
      : chunk.emphasis
        ? region.centerX + (region.centerShiftForEmphasis ?? 18)
        : region.centerX;
    const width = estimateTextWidth(chunk.text, fontSize);
    const half = width / 2;
    left = Math.min(left, x - half);
    right = Math.max(right, x + half);
  }
  return {
    top: startY,
    bottom: startY + totalHeight,
    left,
    right,
    totalHeight,
    lineHeights,
    startY,
  };
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function chooseKineticLayout(input: {
  contentId?: string;
  topic?: string;
  quoteText: string;
  chunks: KineticChunk[];
  microReflection?: string;
}): {
  preset: KineticLayoutPreset;
  noteFit: FittedMicroReflection | null;
  noteRect: PlacedRect | null;
  kineticRegion: KineticRegion;
  kineticBounds: { top: number; bottom: number; left: number; right: number; totalHeight: number; lineHeights: number[]; startY: number };
  warnings: string[];
} {
  const seed = `${input.contentId ?? ""}|${input.topic ?? ""}|${input.quoteText}`;
  const orderedPresets = selectSeededKineticLayoutOrder(seed);
  const fallbackPresetOrder: KineticLayoutPreset[] = [
    "note_left_kinetic_right",
    "note_center_low_kinetic_upper",
  ];
  for (const preset of orderedPresets) {
    const noteFit = input.microReflection ? fitKineticMicroReflectionToRect(input.microReflection, preset.noteRect) : null;
    const kineticBounds = estimateKineticBlockBounds(input.chunks, preset.kineticRegion);
    if (!kineticBounds) continue;

    const noteHeight = noteFit?.blockHeight ?? 0;
    const noteRect = noteFit
      ? {
          x: preset.noteRect.x,
          y: preset.noteRect.y,
          width: preset.noteRect.width,
          height: noteHeight,
        }
      : null;
    const kineticRect = {
      x: kineticBounds.left,
      y: kineticBounds.top,
      width: kineticBounds.right - kineticBounds.left,
      height: kineticBounds.bottom - kineticBounds.top,
    };

    const noteInsideFrame = !noteRect || (
      noteRect.x >= 80 &&
      noteRect.x + noteRect.width <= 920 &&
      noteRect.y >= 160 &&
      noteRect.y + noteRect.height <= 1680
    );
    const kineticInsideFrame = (
      kineticRect.x >= 80 &&
      kineticRect.x + kineticRect.width <= 920 &&
      kineticRect.y >= 160 &&
      kineticRect.y + kineticRect.height <= 1680
    );
    const noOverlap = !noteRect || !rectsOverlap(noteRect, kineticRect);
    const keepBottomClear = (!noteRect || noteRect.y + noteRect.height <= 1700) && kineticRect.y + kineticRect.height <= 1660;
    if (noteInsideFrame && kineticInsideFrame && noOverlap && keepBottomClear) {
      return {
        preset: preset.preset,
        noteFit,
        noteRect,
        kineticRegion: preset.kineticRegion,
        kineticBounds,
        warnings: [...(noteFit?.warnings ?? [])],
      };
    }
  }

  const fallbackCandidates = fallbackPresetOrder
    .map((preset) => KINETIC_LAYOUT_PRESETS.find((item) => item.preset === preset)!)
    .filter(Boolean);
  for (const preset of fallbackCandidates) {
    const noteFit = input.microReflection ? fitKineticMicroReflectionToRect(input.microReflection, preset.noteRect) : null;
    const kineticBounds = estimateKineticBlockBounds(input.chunks, preset.kineticRegion);
    if (!kineticBounds) continue;

    const noteHeight = noteFit?.blockHeight ?? 0;
    const noteRect = noteFit
      ? {
          x: preset.noteRect.x,
          y: preset.noteRect.y,
          width: preset.noteRect.width,
          height: noteHeight,
        }
      : null;
    const kineticRect = {
      x: kineticBounds.left,
      y: kineticBounds.top,
      width: kineticBounds.right - kineticBounds.left,
      height: kineticBounds.bottom - kineticBounds.top,
    };
    const noteInsideFrame = !noteRect || (
      noteRect.x >= 80 &&
      noteRect.x + noteRect.width <= 920 &&
      noteRect.y >= 160 &&
      noteRect.y + noteRect.height <= 1680
    );
    const kineticInsideFrame = (
      kineticRect.x >= 80 &&
      kineticRect.x + kineticRect.width <= 920 &&
      kineticRect.y >= 160 &&
      kineticRect.y + kineticRect.height <= 1680
    );
    const noOverlap = !noteRect || !rectsOverlap(noteRect, kineticRect);
    const keepBottomClear = (!noteRect || noteRect.y + noteRect.height <= 1700) && kineticRect.y + kineticRect.height <= 1660;
    if (noteInsideFrame && kineticInsideFrame && noOverlap && keepBottomClear) {
      return {
        preset: preset.preset,
        noteFit,
        noteRect,
        kineticRegion: preset.kineticRegion,
        kineticBounds,
        warnings: [...(noteFit?.warnings ?? [])],
      };
    }
  }

  const hardFallback = KINETIC_LAYOUT_PRESETS.find((item) => item.preset === "note_left_kinetic_right")!;
  const noteFit = input.microReflection ? fitKineticMicroReflectionToRect(input.microReflection, hardFallback.noteRect) : null;
  const kineticBounds = estimateKineticBlockBounds(input.chunks, hardFallback.kineticRegion)!;
  return {
    preset: hardFallback.preset,
    noteFit,
    noteRect: noteFit ? {
      x: hardFallback.noteRect.x,
      y: hardFallback.noteRect.y,
      width: hardFallback.noteRect.width,
      height: noteFit.blockHeight,
    } : null,
    kineticRegion: hardFallback.kineticRegion,
    kineticBounds,
    warnings: [...(noteFit?.warnings ?? [])],
  };
}

export function fitQuoteText(text: string) {
  return fitLinesWithCleanFallback({
    text,
    initialFontSize: 72,
    minFontSize: 48,
    fallbackMinFontSize: 40,
    fontStep: 4,
    maxWidth: 860,
    maxLines: 5,
    lineHeightFactor: 1.22,
  });
}

export function fitReflectionText(text: string) {
  return fitLinesWithCleanFallback({
    text,
    initialFontSize: 34,
    minFontSize: 26,
    fallbackMinFontSize: 22,
    fontStep: 2,
    maxWidth: 820,
    maxLines: 6,
    lineHeightFactor: 1.35,
  });
}

function escapeAssPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const hh = Math.floor(cs / 360000);
  const mm = Math.floor((cs % 360000) / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  const cc = cs % 100;
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

function buildQuoteAss(input: {
  quoteText: string;
  reflectionText?: string;
  topic: string;
  channelName: string;
  durationSec: number;
  visualMode?: "footage" | "ken_burns_image" | "quote_reflection_card";
}) {
  if (input.visualMode === "quote_reflection_card" && input.reflectionText) {
    const main = fitQuoteText(input.quoteText);
    const reflection = fitReflectionText(input.reflectionText);
    const mainBlockHeight = main.lines.length * main.lineHeight;
    const mainStartY = 600;
    const reflectionY = mainStartY + mainBlockHeight + 84;
    const mainLines = main.lines.map(escapeAssText).join("\\N");
    const reflectionLines = reflection.lines.map(escapeAssText).join("\\N");
    const topic = normalizeText(input.topic).toLocaleUpperCase("vi-VN");
    const end = assTime(input.durationSec);
    return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Topic,Arial,20,&H0090A8B6,&H000000FF,&H44020305,&H00000000,0,0,0,0,100,100,1,0,1,1,0.8,8,120,120,0,1
Style: Quote,Arial,${Math.max(56, main.fontSize - 4)},&H00F5F7FA,&H000000FF,&H3A010203,&H00000000,-1,0,0,0,100,100,0,0,1,1.6,1.2,8,128,128,0,1
Style: Reflection,Arial,${reflection.fontSize},&H00CCD7DE,&H000000FF,&H28010203,&H00000000,0,0,0,0,100,100,0.2,0,1,0.8,0.8,8,164,164,0,1
Style: Brand,Arial,20,&H009FB3C1,&H000000FF,&H33010203,&H00000000,0,0,0,0,100,100,0,0,1,0.8,0.6,8,128,128,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Topic,,0,0,0,,{\\pos(${WIDTH / 2},470)}${escapeAssText(topic)}
Dialogue: 0,0:00:00.00,${end},Quote,,0,0,0,,{\\pos(${WIDTH / 2},${mainStartY})}${mainLines}
Dialogue: 0,0:00:00.00,${end},Reflection,,0,0,0,,{\\pos(${WIDTH / 2},${reflectionY})}${reflectionLines}
Dialogue: 0,0:00:00.00,${end},Brand,,0,0,0,,{\\pos(${WIDTH / 2},1776)}${escapeAssText(input.channelName)}
`;
  }

  const fitted = fitQuoteText(input.quoteText);
  const blockHeight = fitted.lines.length * fitted.lineHeight;
  const startY = Math.round(HEIGHT * 0.56 - blockHeight / 2);
  const quoteLines = fitted.lines.map(escapeAssText).join("\\N");
  const topic = normalizeText(input.topic).toLocaleUpperCase("vi-VN");
  const end = assTime(input.durationSec);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Topic,Arial,22,&H00B9D7E8,&H000000FF,&H66030406,&H00000000,0,0,0,0,100,100,1,0,1,1.4,1.2,7,96,96,0,1
Style: Quote,Arial,${fitted.fontSize},&H00E6F6FF,&H000000FF,&H55030406,&H00000000,-1,0,0,0,100,100,0,0,1,2.2,1.8,7,96,96,0,1
Style: Brand,Arial,24,&H00CFE5F2,&H000000FF,&H55030406,&H00000000,0,0,0,0,100,100,0,0,1,1,1,7,96,96,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Topic,,0,0,0,,{\\pos(96,${startY - 42})}${escapeAssText(topic)}
Dialogue: 0,0:00:00.00,${end},Quote,,0,0,0,,{\\pos(96,${startY})}${quoteLines}
Dialogue: 0,0:00:00.00,${end},Brand,,0,0,0,,{\\pos(96,1818)}${escapeAssText(input.channelName)}
`;
}

function normalizeNoteText(value: string): string {
  return value
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/["""]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function buildNoteLetterAss(input: {
  noteLetterText: string;
  topic: string;
  channelName: string;
  durationSec: number;
  contentId: string;
}): string {
  const noteNum = Math.abs(
    Array.from(input.contentId).reduce((sum, ch) => sum + (ch.codePointAt(0) ?? 0), 0),
  ) % 99 + 1;
  const header = `LỜI NHẮN ${String(noteNum).padStart(2, "0")}`;
  const noteLines = input.noteLetterText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const assNoteText = noteLines.map(escapeAssText).join("\\N");
  const end = assTime(input.durationSec);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: NoteHeader,Arial,22,&H00B8CDD8,&H000000FF,&H33010203,&H00000000,0,0,0,0,100,100,4,0,1,0.8,0.6,7,120,120,0,1
Style: NoteDivider,Arial,14,&H00607880,&H000000FF,&H66010203,&H00000000,0,0,0,0,100,100,0,0,1,0.4,0,7,120,120,0,1
Style: NoteText,Arial,46,&H00ECF0F4,&H000000FF,&H44010203,&H00000000,0,0,0,0,100,100,0.4,0,1,1.2,0.8,7,120,120,0,1
Style: Brand,Arial,20,&H009FB3C1,&H000000FF,&H33010203,&H00000000,0,0,0,0,100,100,0,0,1,0.8,0.6,8,128,128,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},NoteHeader,,0,0,0,,{\\pos(120,420)}${escapeAssText(header)}
Dialogue: 0,0:00:00.00,${end},NoteDivider,,0,0,0,,{\\pos(120,465)}────────────────────
Dialogue: 0,0:00:00.00,${end},NoteText,,0,0,0,,{\\pos(120,510)}${assNoteText}
Dialogue: 0,0:00:00.00,${end},Brand,,0,0,0,,{\\pos(${WIDTH / 2},1776)}${escapeAssText(input.channelName)}
`;
}

// V1.1: per-chunk emphasis, accent colors, vertical rhythm, motion polish
const KINETIC_FONT_SIZES: Record<string, number> = {
  small: 50,
  medium: 66,
  large: 90,
  xlarge: 112,
};

// Premium accent palette — one picked per video, no neon, no rainbow
// ASS color format: &HAABBGGRR (alpha, blue, green, red bytes)
const TANG_SAU_ACCENT_PALETTE = [
  "&H0050B4E6", // warm amber  RGB(230,180,80)
  "&H00AAC8DC", // soft beige  RGB(220,200,170)
  "&H00D2C86E", // muted cyan  RGB(110,200,210)
  "&H009BA0D2", // dusty rose  RGB(210,160,155)
  "&H0082D2F0", // pale gold   RGB(240,210,130)
] as const;

function pickAccentColor(seed: string): string {
  const idx = Array.from(seed).reduce((s, c) => s + (c.codePointAt(0) ?? 0), 0) % TANG_SAU_ACCENT_PALETTE.length;
  return TANG_SAU_ACCENT_PALETTE[idx]!;
}

function buildKineticTypographyAss(input: {
  contentId?: string;
  topic?: string;
  quoteText: string;
  chunks: KineticChunk[];
  accentWords?: string[];
  microReflection?: string;
  channelName: string;
  durationSec: number;
}): { ass: string; layoutWarnings: string[]; layoutPreset: KineticLayoutPreset } {
  const { chunks, accentWords, microReflection, channelName, durationSec } = input;
  // Hold final composition a bit longer so both blocks can be read together
  const HOLD_TIME = Math.min(1.8, Math.max(1.2, durationSec * 0.16));
  const revealSpacing = Math.max(0.7, (durationSec - HOLD_TIME) / Math.max(1, chunks.length));
  const chosenLayout = chooseKineticLayout({
    contentId: input.contentId,
    topic: input.topic,
    quoteText: input.quoteText,
    chunks,
    microReflection,
  });
  const layoutWarnings: string[] = [...chosenLayout.warnings];
  const noteFit = chosenLayout.noteFit;
  const noteRect = chosenLayout.noteRect;
  const startY = chosenLayout.kineticBounds.startY;
  const end = assTime(durationSec);

  // One accent color per video, keyed on the first accent word (deterministic)
  const accentSeed = accentWords?.[0] ?? chunks[0]?.text ?? "tang_sau";
  const accentColor = pickAccentColor(accentSeed);

  // Tolerant accent match: an accentWord hits a chunk when either is a substring of the other.
  // Ignore candidates shorter than 3 chars to avoid false positives on particles ("là", "ta"…).
  // Trailing punctuation is stripped before comparison so "mệt." and "mệt" are treated the same.
  function stripPunct(s: string): string {
    return s.replace(/[.,!?…–—\s]+$/, "").replace(/^[.,!?…–—\s]+/, "");
  }
  const accentCandidates = (accentWords ?? [])
    .map((w) => stripPunct(w.trim().toLocaleLowerCase("vi-VN")))
    .filter((w) => Array.from(w).length >= 3);

  function chunkMatchesAccent(chunkText: string): boolean {
    const norm = stripPunct(chunkText.trim().toLocaleLowerCase("vi-VN"));
    return accentCandidates.some(
      (a) => a === norm || norm.includes(a) || a.includes(norm),
    );
  }

  const styleSet = new Set<string>();
  for (const c of chunks) styleSet.add(c.size ?? "medium");
  const styleLines: string[] = [];
  for (const sizeName of ["small", "medium", "large", "xlarge"]) {
    if (!styleSet.has(sizeName)) continue;
    const fontSize = KINETIC_FONT_SIZES[sizeName]!;
    const isEmphasis = sizeName === "large" || sizeName === "xlarge";
    const bold = isEmphasis ? -1 : 0;
    const outline = isEmphasis ? "2.0" : "1.2";
    const shadow = isEmphasis ? "1.4" : "0.6";
    // Off-white for emphasis; muted tones for supporting (accent overridden inline)
    const color = sizeName === "xlarge" ? "&H00EEF0F2"   // near-white
                : sizeName === "large"  ? "&H00E8ECF2"   // off-white
                : sizeName === "medium" ? "&H00CCD8E0"   // light-muted
                :                         "&H00BAC8D4";  // dim supporting
    styleLines.push(
      `Style: Kinetic_${sizeName},Arial,${fontSize},${color},&H000000FF,&H55000000,&H00000000,${bold},0,0,0,100,100,0.3,0,1,${outline},${shadow},5,72,72,0,1`,
    );
  }
  styleLines.push(
    `Style: Brand,Arial,20,&H009FB3C1,&H000000FF,&H33010203,&H00000000,0,0,0,0,100,100,0,0,1,0.8,0.6,8,128,128,0,1`,
  );
  if (noteFit) {
    styleLines.push(
      `Style: ReflectionBlock,Arial,${noteFit.fontSize},&H00EEF2F5,&H000000FF,&H56000000,&H30000000,0,0,0,0,100,100,0.05,0,1,1.1,0.9,7,90,90,0,1`,
    );
  }

  const kineticCenterX = chosenLayout.kineticRegion.centerX;
  const eventLines: string[] = [];
  let currentY = startY;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const fontSize = KINETIC_FONT_SIZES[chunk.size ?? "medium"] ?? 66;
    const lineH = Math.round(fontSize * 1.45);
    const startSec = i * revealSpacing;
    const startTime = assTime(startSec);
    const sizeName = chunk.size ?? "medium";
    const y = currentY + Math.round(lineH / 2);

    // Keep the kinetic block slightly right of center but within the safe frame.
    const x = chunk.size === "small" && !chunk.emphasis
      ? kineticCenterX + (chosenLayout.kineticRegion.centerShiftForSmall ?? -24)
      : chunk.emphasis
        ? kineticCenterX + (chosenLayout.kineticRegion.centerShiftForEmphasis ?? 18)
        : kineticCenterX;

    // Accent: emphasis chunks that match any accentWord (tolerant substring match)
    const useAccent = chunk.emphasis && (accentCandidates.length === 0 || chunkMatchesAccent(chunk.text));
    const colorTag = useAccent ? `\\1c${accentColor}&` : "";

    let tags: string;
    if (chunk.emphasis) {
      // Scale in 93→100 % + optional accent color; stronger fade-in
      tags = `{\\pos(${x},${y})\\fscx93\\fscy93\\fad(200,0)\\t(0,350,\\fscx100\\fscy100)${colorTag}}`;
    } else {
      // Supporting: gentle upward drift while fading in
      const y1 = y + 18;
      tags = `{\\move(${x},${y1},${x},${y},0,380)\\fad(320,0)}`;
    }

    eventLines.push(
      `Dialogue: 0,${startTime},${end},Kinetic_${sizeName},,0,0,0,,${tags}${escapeAssText(chunk.text)}`,
    );
    currentY += lineH + 20;
  }
  if (noteFit && noteRect) {
    const panelWidth = noteRect.width + 44;
    const panelHeight = noteRect.height + 52;
    const panelX = noteRect.x - 22;
    const panelY = noteRect.y - 26;
    const panelShape = `m 0 0 l ${panelWidth} 0 l ${panelWidth} ${panelHeight} l 0 ${panelHeight}`;
    const reflectionText = noteFit.lines
      .map((line) => line.trim().length > 0 ? escapeAssText(line) : " ")
      .join("\\N");
    const reflectionStart = assTime(Math.max(0, Math.min(2, revealSpacing * 0.6)));
    eventLines.push(
      `Dialogue: 0,${reflectionStart},${end},ReflectionBlock,,0,0,0,,{\\an7\\pos(${panelX},${panelY})\\p1\\bord0\\shad0\\1c&H101418&\\alpha&H58&}${panelShape}{\\p0}`,
    );
    eventLines.push(
      `Dialogue: 0,${reflectionStart},${end},ReflectionBlock,,0,0,0,,{\\alpha&H12&\\fad(260,0)\\pos(${noteRect.x},${noteRect.y})}${reflectionText}`,
    );
  }
  eventLines.push(
    `Dialogue: 0,0:00:00.00,${end},Brand,,0,0,0,,{\\pos(${WIDTH / 2},1776)}${escapeAssText(channelName)}`,
  );

  return { ass: `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines.join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${eventLines.join("\n")}
`, layoutWarnings, layoutPreset: chosenLayout.preset };
}

function normalizeKineticChunkText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function countChunkWords(value: string): number {
  return normalizeKineticChunkText(value).split(/\s+/).filter(Boolean).length;
}

function mergeKineticChunkPair(
  left: KineticChunk,
  right: KineticChunk,
): KineticChunk {
  const leftWords = countChunkWords(left.text);
  const rightWords = countChunkWords(right.text);
  return {
    text: normalizeKineticChunkText(`${left.text} ${right.text}`),
    emphasis: left.emphasis || right.emphasis,
    size:
      left.size === "xlarge" || right.size === "xlarge" ? "xlarge" :
      left.size === "large" || right.size === "large" ? "large" :
      leftWords + rightWords <= 3 ? "small" : "medium",
  };
}

function splitKineticChunkText(text: string): string[] {
  const normalized = normalizeKineticChunkText(text);
  if (!normalized) return [];
  const chunks = normalized
    .split(/(?<=[,.!?;:])\s+/u)
    .flatMap((segment) =>
      segment
        .split(/\s+(?=không phải vì\b|không phải\b|chỉ là\b|mà vì\b|nhưng\b|nên\b|để rồi\b)/iu)
        .map((part) => part.trim())
        .filter(Boolean),
    );
  const output = chunks.length ? chunks : [normalized];

  while (output.length < 3) {
    let longestIndex = 0;
    for (let i = 1; i < output.length; i++) {
      if (countChunkWords(output[i]!) > countChunkWords(output[longestIndex]!)) longestIndex = i;
    }
    const longest = output[longestIndex]!;
    const words = longest.split(/\s+/).filter(Boolean);
    if (words.length < 5) break;
    const splitAt = Math.max(2, Math.min(words.length - 2, Math.ceil(words.length / 2)));
    output.splice(longestIndex, 1, words.slice(0, splitAt).join(" "), words.slice(splitAt).join(" "));
  }

  while (output.length > 4) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < output.length - 1; i++) {
      const pairScore = countChunkWords(output[i]!) + countChunkWords(output[i + 1]!);
      if (pairScore < bestScore) {
        bestScore = pairScore;
        bestIndex = i;
      }
    }
    const left = output[bestIndex]!;
    const right = output[bestIndex + 1]!;
    output.splice(bestIndex, 2, normalizeKineticChunkText(`${left} ${right}`));
  }

  return output.map((chunk) => normalizeKineticChunkText(chunk)).filter(Boolean);
}

export function harmonizeKineticTextSidecar(input: KineticTextSidecar, quoteText?: string): KineticTextSidecar {
  const sourceText =
    normalizeKineticChunkText(quoteText ?? "") ||
    input.chunks.map((chunk) => normalizeKineticChunkText(chunk.text)).filter(Boolean).join(" ");
  let chunks = (input.chunks ?? [])
    .map((chunk) => ({
      ...chunk,
      text: normalizeKineticChunkText(chunk.text),
    }))
    .filter((chunk) => chunk.text.length > 0);

  if (!chunks.length && sourceText) {
    chunks = splitKineticChunkText(sourceText).map((text) => ({
      text,
      emphasis: false,
      size: "medium" as const,
    }));
  }

  for (let i = 0; i < chunks.length - 1; ) {
    const current = chunks[i]!;
    const next = chunks[i + 1]!;
    const currentWords = countChunkWords(current.text);
    const currentLower = current.text.toLocaleLowerCase("vi-VN");
    const nextLower = next.text.toLocaleLowerCase("vi-VN");
    const mergeForward =
      currentWords === 1 ||
      /^(không phải|chỉ là|mà|vì|để|rồi|nhưng)$/iu.test(currentLower) ||
      /^(vì|để|rồi|nhưng)/iu.test(nextLower);
    if (mergeForward) {
      chunks.splice(i, 2, mergeKineticChunkPair(current, next));
    } else {
      i++;
    }
  }

  if (chunks.length < 3 && sourceText) {
    chunks = splitKineticChunkText(sourceText).map((text) => ({
      text,
      emphasis: false,
      size: "medium" as const,
    }));
  }
  if (sourceText && chunks.some((chunk) => countChunkWords(chunk.text) > 7)) {
    chunks = splitKineticChunkText(sourceText).map((text) => ({
      text,
      emphasis: false,
      size: "medium" as const,
    }));
  }

  while (chunks.length > 4) {
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < chunks.length - 1; i++) {
      const pairScore =
        countChunkWords(chunks[i]!.text) +
        countChunkWords(chunks[i + 1]!.text) -
        (chunks[i]!.emphasis || chunks[i + 1]!.emphasis ? 0.4 : 0);
      if (pairScore < bestScore) {
        bestScore = pairScore;
        bestIndex = i;
      }
    }
    const left = chunks[bestIndex]!;
    const right = chunks[bestIndex + 1]!;
    chunks.splice(bestIndex, 2, mergeKineticChunkPair(left, right));
  }

  const emphasisIndices = new Set<number>();
  chunks.forEach((chunk, index) => {
    if (chunk.emphasis) emphasisIndices.add(index);
  });
  if (!emphasisIndices.size && chunks.length) {
    emphasisIndices.add(Math.max(0, chunks.length - 1));
    if (chunks.length >= 4) emphasisIndices.add(1);
  }

  const harmonizedChunks = chunks.map((chunk, index) => {
    const words = countChunkWords(chunk.text);
    const emphasis = emphasisIndices.has(index);
    const size: KineticChunk["size"] =
      emphasis && index === chunks.length - 1 ? "xlarge" :
      emphasis ? "large" :
      words <= 2 ? "small" : "medium";
    return {
      text: chunk.text,
      emphasis,
      size,
    };
  });
  const accentWords = harmonizedChunks.filter((chunk) => chunk.emphasis).slice(0, 2).map((chunk) => chunk.text);
  return {
    ...input,
    chunks: harmonizedChunks,
    accentWords,
  };
}

function buildBilingualMinimalAss(input: {
  englishLine: string;
  vietnameseLine: string;
  channelName: string;
  durationSec: number;
}): string {
  const { englishLine, vietnameseLine, channelName, durationSec } = input;

  // English block: split on \n (already preserved by normalizeNoteText)
  const EN_FONT_SIZE = 32;
  const EN_LINE_H = Math.round(EN_FONT_SIZE * 1.38);
  const enRawLines = englishLine.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const enBlockH = enRawLines.length * EN_LINE_H;
  const assEnText = enRawLines.map(escapeAssText).join("\\N");

  // Vietnamese block: wrap with existing helper
  const vnFitted = fitQuoteText(vietnameseLine);
  const vnLines = vnFitted.lines.map(escapeAssText).join("\\N");
  const vnBlockH = vnFitted.lines.length * vnFitted.lineHeight;

  // 56 px gap between English bottom and Vietnamese top
  const GAP = 56;
  const totalH = enBlockH + GAP + vnBlockH;

  // Centre the combined block around 52 % of canvas height
  const centerY = Math.round(HEIGHT * 0.52);
  const enStartY = Math.max(200, centerY - Math.round(totalH / 2));
  const vnStartY = enStartY + enBlockH + GAP;

  const end = assTime(durationSec);

  // Both styles use Alignment=8 (top-center) so \pos sets the top of each block.
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: English,Arial,${EN_FONT_SIZE},&H0094AABB,&H000000FF,&H44010203,&H00000000,0,1,0,0,100,100,0.2,0,1,0.8,0.6,8,100,100,0,1
Style: Vietnamese,Arial,${vnFitted.fontSize},&H00EDF1F5,&H000000FF,&H3A010203,&H00000000,-1,0,0,0,100,100,0,0,1,1.6,1.2,8,100,100,0,1
Style: Brand,Arial,20,&H009FB3C1,&H000000FF,&H33010203,&H00000000,0,0,0,0,100,100,0,0,1,0.8,0.6,8,128,128,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},English,,0,0,0,,{\\pos(${WIDTH / 2},${enStartY})}${assEnText}
Dialogue: 0,0:00:00.00,${end},Vietnamese,,0,0,0,,{\\pos(${WIDTH / 2},${vnStartY})}${vnLines}
Dialogue: 0,0:00:00.00,${end},Brand,,0,0,0,,{\\pos(${WIDTH / 2},1776)}${escapeAssText(channelName)}
`;
}

function parseVolumeDb(output: string, key: "mean_volume" | "max_volume"): number | null {
  const match = output.match(new RegExp(`${key}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*dB`));
  return match ? Number(match[1]) : null;
}

async function validateBackgroundMusic(videoPath: string, musicPath: string | null) {
  try {
    const { stderr } = await execFileAsync(
      FFMPEG_PATH,
      ["-hide_banner", "-i", videoPath, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"],
      { timeout: 45_000 },
    );
    const meanVolumeDb = parseVolumeDb(stderr, "mean_volume");
    const maxVolumeDb = parseVolumeDb(stderr, "max_volume");
    if (meanVolumeDb === null || meanVolumeDb <= SILENT_MEAN_VOLUME_DB) {
      throw new Error(
        `Legacy quote short audio is silent or too low: meanVolume=${meanVolumeDb ?? "unknown"}dB musicPath=${musicPath ?? "none"}`,
      );
    }
    return {
      musicPath,
      audioStreamPresent: true,
      meanVolumeDb,
      maxVolumeDb,
    };
  } catch (err) {
    throw new Error(
      `Legacy quote short is missing usable background music: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function renderLegacyQuoteShort(input: LegacyQuoteShortInput): Promise<LegacyQuoteShortMetadata> {
  const sourceImagePath = resolveProjectPath(input.sourceImagePath);
  if (!fs.existsSync(sourceImagePath)) {
    throw new Error(`Source image missing: ${input.sourceImagePath}`);
  }
  const outputDir = resolveProjectPath(input.outputDir ?? "output/legacy-quote-short-v1");
  fs.mkdirSync(outputDir, { recursive: true });

  const quoteText = normalizeText(input.quoteText ?? generateLegacyQuoteText(input.topic));
  const reflectionText = input.reflectionText ? normalizeText(input.reflectionText) : undefined;
  const noteLetterText = input.noteLetterText ? normalizeNoteText(input.noteLetterText) : undefined;
  // Preserve intentional line breaks for bilingual minimal English lines.
  const englishLine = input.englishLine ? normalizeNoteText(input.englishLine) : undefined;
  // Use strategic family ID: normalize stored value (may be an old-system ID) or infer from topic.
  const resolvedTopicFamily = input.topicFamily
    ? normalizeTopicFamily(input.topicFamily)
    : inferStrategicTopicFamily(input.topic);
  const harmonizedKineticText = input.kineticText
    ? harmonizeKineticTextSidecar(input.kineticText, quoteText)
    : undefined;

  // Kinetic text targets 8–12 s; other modes use the standard range.
  const isKinetic = input.visualMode === "kinetic_typography";
  const durationSec = isKinetic
    ? Math.max(8, Math.min(12, input.durationSec ?? 10))
    : Math.max(10, Math.min(20, input.durationSec ?? DEFAULT_DURATION_SEC));

  const channelName = normalizeText(input.channelName ?? DEFAULT_CHANNEL_NAME);
  const renderedImagePath = path.join(outputDir, `${input.contentId}-legacy-quote-card.jpg`);
  const videoPath = path.join(outputDir, `${input.contentId}-legacy-quote-short.mp4`);
  const metadataPath = path.join(outputDir, `${input.contentId}-legacy-quote-short.json`);
  const assPath = path.join(os.tmpdir(), `${input.contentId}-legacy-quote.ass`);
  const resolvedVisualMode =
    input.visualMode ??
    (reflectionText ? "quote_reflection_card" : "ken_burns_image");
  const quoteStyle =
    input.quoteStyle ??
    (reflectionText ? "reflection_card" : "short_quote");
  const isStaticDeepQuote = quoteStyle === "static_deep_quote";

  let assContent: string;
  let kineticLayoutWarnings: string[] | undefined;
  let kineticLayoutPreset: string | undefined;
  if (resolvedVisualMode === "note_letter_card" && noteLetterText) {
    assContent = buildNoteLetterAss({
      noteLetterText,
      topic: input.topic,
      channelName,
      durationSec,
      contentId: input.contentId,
    });
  } else if (resolvedVisualMode === "kinetic_typography" && input.kineticText) {
    const kineticAss = buildKineticTypographyAss({
      contentId: input.contentId,
      topic: input.topic,
      quoteText,
      chunks: harmonizedKineticText?.chunks ?? input.kineticText.chunks,
      accentWords: harmonizedKineticText?.accentWords ?? input.kineticText.accentWords,
      microReflection: harmonizedKineticText?.microReflection ?? input.kineticText.microReflection,
      channelName,
      durationSec,
    });
    assContent = kineticAss.ass;
    kineticLayoutWarnings = kineticAss.layoutWarnings;
    kineticLayoutPreset = kineticAss.layoutPreset;
  } else if (resolvedVisualMode === "bilingual_minimal" && englishLine) {
    assContent = buildBilingualMinimalAss({
      englishLine,
      vietnameseLine: quoteText,
      channelName,
      durationSec,
    });
  } else {
    assContent = buildQuoteAss({
      quoteText,
      reflectionText,
      topic: input.topic,
      channelName,
      durationSec,
      visualMode: resolvedVisualMode as "footage" | "ken_burns_image" | "quote_reflection_card",
    });
  }

  fs.writeFileSync(assPath, assContent, "utf8");

  const args = [
    "-y",
    "-i", sourceImagePath,
  ];
  if (input.musicPath) {
    args.push("-stream_loop", "-1", "-i", resolveProjectPath(input.musicPath));
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  }

  const escapedAss = escapeAssPath(assPath);
  const frameCount = Math.round(durationSec * FPS);

  // Darker overlay for kinetic typography (cinematic) and slightly darker for new text modes.
  // ken_burns_image reduced from 0.34 → 0.20 to preserve warm gold palette from V2 prompts.
  const dimFactor =
    resolvedVisualMode === "kinetic_typography" ? 0.72 :
    resolvedVisualMode === "note_letter_card" || resolvedVisualMode === "bilingual_minimal" ? 0.46 :
    0.20;

  // Yellow accent line only for the classic ken_burns and reflection modes.
  const useAccentLine = resolvedVisualMode === "ken_burns_image" || resolvedVisualMode === "quote_reflection_card";
  const accentLineFilter = useAccentLine
    ? `,drawbox=x=72:y=760:w=5:h=${reflectionText ? 520 : 390}:color=0xF1C36A@0.88:t=fill`
    : "";

  const videoFilter = [
    `[0:v]scale=1320:2347:force_original_aspect_ratio=increase`,
    isStaticDeepQuote
      ? `zoompan=z='1.035':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`
      : `zoompan=z='min(zoom+0.00072,1.18)':x='iw/2-(iw/zoom/2)+sin(on/54)*42':y='ih/2-(ih/zoom/2)+cos(on/72)*58':d=${frameCount}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
    `trim=duration=${durationSec.toFixed(3)},setpts=PTS-STARTPTS`,
    `drawbox=x=0:y=0:w=iw:h=ih:color=black@${dimFactor.toFixed(2)}:t=fill${accentLineFilter}`,
    `ass='${escapedAss}':fontsdir='/Library/Fonts'`,
    "format=yuv420p[vout]",
  ].join(",");
  const fadeOutStart = Math.max(0, durationSec - 1.1).toFixed(3);
  const audioFilter = input.musicPath
    ? `[1:a]atrim=duration=${durationSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${MUSIC_VOLUME},afade=t=in:st=0:d=0.45,afade=t=out:st=${fadeOutStart}:d=1.0,loudnorm=I=-18:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo[aout]`
    : `[1:a]atrim=duration=${durationSec.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[aout]`;
  const filterComplex = `${videoFilter};${audioFilter}`;
  const baseArgs = [
    ...args,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[aout]",
  ];
  const outputArgs = [
    "-r", String(FPS),
    "-vsync", "cfr",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-t", durationSec.toFixed(3),
    "-movflags", "+faststart",
    videoPath,
  ];

  try {
    const videoArgs = isAppleSilicon() ? getVideoToolboxArgs("short") : getLibx264Args("short");
    await execFileAsync(FFMPEG_PATH, [...baseArgs, ...videoArgs, ...outputArgs], { timeout: 180_000 });
  } catch (err) {
    if (!isAppleSilicon()) throw err;
    await execFileAsync(FFMPEG_PATH, [...baseArgs, ...getLibx264Args("short"), ...outputArgs], { timeout: 180_000 });
  } finally {
    try { fs.unlinkSync(assPath); } catch { /* ignore */ }
  }

  await execFileAsync(FFMPEG_PATH, ["-y", "-ss", "0.4", "-i", videoPath, "-vframes", "1", "-q:v", "2", renderedImagePath], { timeout: 30_000 });
  const audioValidation = await validateBackgroundMusic(videoPath, input.musicPath ?? null);

  const result: LegacyQuoteShortMetadata = {
    formatType: FORMAT_TYPE,
    contentId: input.contentId,
    topic: input.topic,
    topicFamily: resolvedTopicFamily,
    channelName,
    channelProfileId: input.channelProfileId,
    workspaceId: input.workspaceId,
    channelKey: input.channelKey,
    contentProfileKey: input.contentProfileKey,
    quoteText,
    mainQuote: quoteText,
    reflectionText,
    noteLetterText,
    englishLine,
    kineticText: harmonizedKineticText
      ? {
          ...harmonizedKineticText,
          layoutPreset: kineticLayoutPreset ?? harmonizedKineticText.layoutPreset,
          layoutWarnings: kineticLayoutWarnings?.length ? kineticLayoutWarnings : harmonizedKineticText.layoutWarnings,
        }
      : undefined,
    quoteStyle,
    visualMood: input.visualMood ?? (input.channelProfileId === "tang_sau_v1" ? "editorial_stillness" : "gentle_nature"),
    musicMood: input.musicMood ?? (input.channelProfileId === "tang_sau_v1" ? "ambient_reflection" : "soft_meditation"),
    visualSearchKeywords: isTangSauInput(input) ? TANG_SAU_VISUAL_KEYWORDS : getLegacyQuoteVisualKeywords(input.topic),
    backgroundMusicPath: input.musicPath ?? null,
    sourceImagePath: input.sourceImagePath,
    renderedImagePath,
    videoPath,
    metadataPath,
    durationSec,
    width: WIDTH,
    height: HEIGHT,
    experimentId: input.experimentId ?? "LEGACY_QUOTE_SHORT",
    experimentVariant: input.experimentVariant ?? "LEGACY_QUOTE_NO_VOICE_V2",
    noTtsVoice: true,
    platformReady: {
      youtubeShorts: durationSec <= 60,
      facebookReels: durationSec <= 90,
    },
    visualMode: resolvedVisualMode,
    motionStrength: isStaticDeepQuote ? "minimal_static" : KEN_BURNS_MOTION_STRENGTH,
    colorPalette: input.colorPalette,
    visualTemperature: input.visualTemperature,
    buddhistVisualMeta: input.buddhistVisualMeta,
    imageMeta: input.imageMeta,
    audioValidation,
    tags: input.tags,
  };

  fs.writeFileSync(metadataPath, JSON.stringify(result, null, 2), "utf8");
  return result;
}
