import fs from "fs";
import path from "path";
import { createRequire } from "module";

type SharpInstance = {
  resize(width: number, height: number, options?: Record<string, unknown>): SharpInstance;
  composite(layers: Array<{ input: Buffer }>): SharpInstance;
  jpeg(options?: Record<string, unknown>): SharpInstance;
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  toFile(outputPath: string): Promise<unknown>;
};

type SharpFactory = (input?: string | Buffer) => SharpInstance;

export type ShortCoverSourceImageMode = "original" | "short_thumb_fallback";
export type ShortCoverLayoutPreset = "short_cover_hook";

export type ShortCoverAssetInput = {
  contentId: string;
  topic: string;
  hookOrScriptExcerpt?: string | null;
  sourceImagePath?: string | null;
  coverText: string;
  layoutPreset?: ShortCoverLayoutPreset;
  channelName?: string | null;
  showBranding?: boolean;
  outputPath?: string | null;
};

export type ShortCoverAssetMetadata = {
  coverText: string;
  readabilityScore: number;
  safeAreaPass: boolean;
  sourceImageMode: ShortCoverSourceImageMode;
  sourceImagePath: string;
  outputPath: string;
  metadataPath: string;
  width: 1080;
  height: 1920;
  textLineCount: number;
  coverTextWordCount: number;
  layoutPreset: ShortCoverLayoutPreset;
  channelName: string | null;
  showBranding: boolean;
};

type ResolvedSource =
  | {
      ok: true;
      sourceImageMode: ShortCoverSourceImageMode;
      sourceImagePath: string;
    }
  | {
      ok: false;
      error: "missing_source_image_for_short_cover";
      originalImagePath: string | null;
      fallbackImagePath: string;
    };

type FittedCoverText = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  x: number;
  y: number;
  textBoxWidth: number;
  blockHeight: number;
  safeAreaPass: boolean;
};

const COVER_WIDTH = 1080;
const COVER_HEIGHT = 1920;
const SAFE_X = 96;
const SAFE_TOP = 330;
const SAFE_BOTTOM = 1570;
const TEXT_BOX_WIDTH = COVER_WIDTH - SAFE_X * 2;
const MAX_LINES = 3;
const INITIAL_FONT_SIZE = 118;
const MIN_FONT_SIZE = 68;
const DEFAULT_SHORT_COVER_CHANNEL_NAME = "Trí Tuệ An Nhiên";

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function fileExists(filePath: string | null | undefined): filePath is string {
  return Boolean(filePath && fs.existsSync(resolveProjectPath(filePath)));
}

async function loadSharp(): Promise<SharpFactory> {
  const require = createRequire(import.meta.url);
  const loaded = require("sharp") as { default?: SharpFactory } | SharpFactory;
  return typeof loaded === "function" ? loaded : loaded.default!;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeText(value: string): string {
  return value
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/[“”"']/g, "")
    .replace(/[!?.,;:…()[\]{}<>|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCoverText(value: string, fallback: string): string {
  const normalized = normalizeText(value || fallback);
  const words = normalized.split(/\s+/).filter(Boolean);
  const trimmed = words.length > 5 ? words.slice(0, 5).join(" ") : normalized;
  return trimmed.toLocaleUpperCase("vi-VN");
}

function countWords(value: string): number {
  return normalizeText(value).split(/\s+/).filter(Boolean).length;
}

function charWeight(char: string): number {
  if (/[MW@#%&]/.test(char)) return 0.92;
  if (/[A-ZĐ]/.test(char)) return 0.74;
  if (/[ilI1.,;:'|!]/.test(char)) return 0.36;
  if (/\s/.test(char)) return 0.34;
  return 0.62;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((total, char) => total + charWeight(char) * fontSize, 0);
}

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function fitCoverText(text: string): FittedCoverText {
  for (let fontSize = INITIAL_FONT_SIZE; fontSize >= MIN_FONT_SIZE; fontSize -= 4) {
    const lineHeight = Math.round(fontSize * 1.08);
    const lines = wrapText(text, fontSize, TEXT_BOX_WIDTH);
    const blockHeight = lines.length * lineHeight;
    const y = Math.round((COVER_HEIGHT - blockHeight) * 0.48);
    const safeAreaPass =
      lines.length <= MAX_LINES &&
      y >= SAFE_TOP &&
      y + blockHeight <= SAFE_BOTTOM &&
      lines.every((line) => estimateTextWidth(line, fontSize) <= TEXT_BOX_WIDTH);

    if (safeAreaPass) {
      return {
        lines,
        fontSize,
        lineHeight,
        x: SAFE_X,
        y,
        textBoxWidth: TEXT_BOX_WIDTH,
        blockHeight,
        safeAreaPass,
      };
    }
  }

  const fontSize = MIN_FONT_SIZE;
  const lineHeight = Math.round(fontSize * 1.08);
  const lines = wrapText(text, fontSize, TEXT_BOX_WIDTH).slice(0, MAX_LINES);
  const blockHeight = lines.length * lineHeight;
  const y = Math.round((COVER_HEIGHT - blockHeight) * 0.48);

  return {
    lines,
    fontSize,
    lineHeight,
    x: SAFE_X,
    y,
    textBoxWidth: TEXT_BOX_WIDTH,
    blockHeight,
    safeAreaPass:
      lines.length <= MAX_LINES &&
      y >= SAFE_TOP &&
      y + blockHeight <= SAFE_BOTTOM &&
      lines.every((line) => estimateTextWidth(line, fontSize) <= TEXT_BOX_WIDTH),
  };
}

function scoreReadability(fitted: FittedCoverText): number {
  let score = 8;
  if (fitted.safeAreaPass) score += 0.8;
  if (fitted.fontSize >= 102) score += 0.6;
  if (fitted.lines.length <= 2) score += 0.4;
  if (fitted.lines.length > 2) score -= 0.2;
  if (fitted.fontSize < 82) score -= 0.7;
  return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
}

function buildOverlaySvg(input: {
  fitted: FittedCoverText;
  topic: string;
  channelName: string | null;
  showBranding: boolean;
}): string {
  const { fitted } = input;
  const topic = normalizeText(input.topic).toLocaleUpperCase("vi-VN");
  const channelName = normalizeText(input.channelName || DEFAULT_SHORT_COVER_CHANNEL_NAME);
  const textLines = fitted.lines
    .map((line, index) => {
      const y = fitted.y + index * fitted.lineHeight;
      return `<text x="${COVER_WIDTH / 2}" y="${y}" class="cover">${escapeXml(line)}</text>`;
    })
    .join("\n");
  const pillWidth = Math.min(760, Math.max(360, estimateTextWidth(topic, 30) + 72));
  const pillX = Math.round((COVER_WIDTH - pillWidth) / 2);
  const brandingText = input.showBranding
    ? `<text x="84" y="1826" class="brand">${escapeXml(channelName)}</text>`
    : "";

  return `
  <svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="verticalShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.58"/>
        <stop offset="24%" stop-color="#000000" stop-opacity="0.18"/>
        <stop offset="52%" stop-color="#000000" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.72"/>
      </linearGradient>
      <linearGradient id="textField" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.04"/>
        <stop offset="48%" stop-color="#000000" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.05"/>
      </linearGradient>
      <radialGradient id="centerGlow" cx="50%" cy="49%" r="48%">
        <stop offset="0%" stop-color="#6B3B14" stop-opacity="0.24"/>
        <stop offset="62%" stop-color="#000000" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.48"/>
      </radialGradient>
      <filter id="coverShadow" x="-24%" y="-24%" width="148%" height="172%">
        <feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#000000" flood-opacity="0.82"/>
      </filter>
      <filter id="softGlow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="0" stdDeviation="14" flood-color="#F2B84B" flood-opacity="0.16"/>
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#verticalShade)"/>
    <rect width="100%" height="100%" fill="url(#centerGlow)"/>
    <rect x="92" y="${Math.max(SAFE_TOP - 22, fitted.y - 48)}" width="${COVER_WIDTH - 184}" height="${fitted.blockHeight + 92}" rx="42" fill="url(#textField)"/>
    <rect x="${pillX}" y="218" width="${pillWidth}" height="64" rx="32" fill="#000000" opacity="0.34"/>
    <style>
      .topic { font-family: Arial, Helvetica, sans-serif; font-size: 30px; font-weight: 800; letter-spacing: 2px; fill: #F5C76B; text-anchor: middle; filter: url(#coverShadow); }
      .cover { font-family: Arial, Helvetica, sans-serif; font-size: ${fitted.fontSize}px; font-weight: 900; letter-spacing: 0; fill: #FFF1C7; stroke: #0B0A08; stroke-width: 7px; paint-order: stroke fill; text-anchor: middle; filter: url(#coverShadow); }
      .brand { font-family: Arial, Helvetica, sans-serif; font-size: 32px; font-weight: 700; letter-spacing: 0.5px; fill: #FFF1C7; opacity: 0.8; filter: url(#coverShadow); }
    </style>
    <text x="${COVER_WIDTH / 2}" y="260" class="topic">${escapeXml(topic)}</text>
    <g filter="url(#softGlow)">
      ${textLines}
    </g>
    ${brandingText}
  </svg>`;
}

export function resolveShortCoverSourceImage(input: {
  contentId: string;
  sourceImagePath?: string | null;
}): ResolvedSource {
  const originalImagePath = input.sourceImagePath ?? null;
  const fallbackImagePath = `media/videos/${input.contentId}-short-thumb.jpg`;

  if (fileExists(originalImagePath)) {
    return {
      ok: true,
      sourceImageMode: "original",
      sourceImagePath: originalImagePath,
    };
  }

  if (fileExists(fallbackImagePath)) {
    return {
      ok: true,
      sourceImageMode: "short_thumb_fallback",
      sourceImagePath: fallbackImagePath,
    };
  }

  return {
    ok: false,
    error: "missing_source_image_for_short_cover",
    originalImagePath,
    fallbackImagePath,
  };
}

async function validateCoverAsset(input: {
  sharp: SharpFactory;
  outputPath: string;
  fitted: FittedCoverText;
  readabilityScore: number;
}): Promise<void> {
  if (!fs.existsSync(input.outputPath)) {
    throw new Error(`Short cover was not written: ${input.outputPath}`);
  }

  const metadata = await input.sharp(input.outputPath).metadata();
  if (metadata.width !== COVER_WIDTH || metadata.height !== COVER_HEIGHT) {
    throw new Error(
      `Short cover has wrong dimensions: ${metadata.width}x${metadata.height}, expected ${COVER_WIDTH}x${COVER_HEIGHT}`
    );
  }

  if (!input.fitted.safeAreaPass) {
    throw new Error("Short cover text failed safe-area validation");
  }

  if (input.readabilityScore < 8.5) {
    throw new Error(`Short cover readability score is too low: ${input.readabilityScore}`);
  }
}

export async function generateShortCoverAsset(input: ShortCoverAssetInput): Promise<ShortCoverAssetMetadata> {
  const source = resolveShortCoverSourceImage({
    contentId: input.contentId,
    sourceImagePath: input.sourceImagePath,
  });
  if (!source.ok) {
    throw new Error(source.error);
  }

  const coverText = normalizeCoverText(input.coverText, input.topic);
  const fitted = fitCoverText(coverText);
  const readabilityScore = scoreReadability(fitted);
  const layoutPreset = input.layoutPreset ?? "short_cover_hook";
  const showBranding = input.showBranding ?? true;
  const channelName = showBranding ? (input.channelName ?? DEFAULT_SHORT_COVER_CHANNEL_NAME) : null;
  const sharp = await loadSharp();
  const outputPath = resolveProjectPath(input.outputPath ?? `media/covers/${input.contentId}-short-cover.jpg`);
  const metadataPath = outputPath.replace(/\.(jpe?g|png)$/i, ".json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const overlaySvg = buildOverlaySvg({
    fitted,
    topic: input.topic,
    channelName,
    showBranding,
  });

  await sharp(resolveProjectPath(source.sourceImagePath))
    .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "cover", position: "center" })
    .composite([{ input: Buffer.from(overlaySvg) }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(outputPath);

  await validateCoverAsset({ sharp, outputPath, fitted, readabilityScore });

  const result: ShortCoverAssetMetadata = {
    coverText,
    readabilityScore,
    safeAreaPass: fitted.safeAreaPass,
    sourceImageMode: source.sourceImageMode,
    sourceImagePath: source.sourceImagePath,
    outputPath,
    metadataPath,
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    textLineCount: fitted.lines.length,
    coverTextWordCount: countWords(coverText),
    layoutPreset,
    channelName,
    showBranding,
  };

  fs.writeFileSync(metadataPath, JSON.stringify(result, null, 2));

  return result;
}
