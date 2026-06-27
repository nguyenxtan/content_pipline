import fs from "fs";
import path from "path";
import { createRequire } from "module";

type SharpInstance = {
  resize(width: number, height: number, options?: Record<string, unknown>): SharpInstance;
  composite(layers: Array<{ input: Buffer }>): SharpInstance;
  jpeg(options?: Record<string, unknown>): SharpInstance;
  png(options?: Record<string, unknown>): SharpInstance;
  toFile(outputPath: string): Promise<unknown>;
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
};

type SharpFactory = (input?: string | Buffer) => SharpInstance;

export type SocialImageFormat = "facebook_quote" | "facebook_photo" | "short_cover";
export type SocialImageAspectRatio = "4:5" | "1:1";
export type SocialImageLayoutPreset = "default" | "facebook_quote_premium";

export type SocialImageEnhancerInput = {
  sourceImagePath: string;
  quoteText: string;
  topic: string;
  format: SocialImageFormat;
  aspectRatio?: SocialImageAspectRatio;
  layoutPreset?: SocialImageLayoutPreset;
  outputPath?: string;
  channelName?: string | null;
};

export type SocialImageEnhancerMetadata = {
  width: number;
  height: number;
  aspectRatio: SocialImageAspectRatio;
  textLineCount: number;
  safeAreaPass: boolean;
  readabilityScore: number;
  layoutPreset: SocialImageLayoutPreset;
};

export type SocialImageEnhancerResult = {
  enhancedImagePath: string;
  metadata: SocialImageEnhancerMetadata;
};

type LayoutConfig = {
  width: number;
  height: number;
  aspectRatio: SocialImageAspectRatio;
  layoutPreset: SocialImageLayoutPreset;
  margin: number;
  maxLines: number;
  initialFontSize: number;
  minFontSize: number;
  brandFontSize: number;
  topicFontSize: number;
  quoteWeight: number;
  quoteStrokeWidth: number;
  textBoxOpacity: number;
  lowerThirdOffset: number;
};

type FittedText = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  textBoxWidth: number;
  blockHeight: number;
  x: number;
  y: number;
  safeAreaPass: boolean;
};

const DEFAULT_CHANNEL_NAME = "Trí Tuệ An Nhiên";

export function getConfig(
  format: SocialImageFormat,
  aspectRatio?: SocialImageAspectRatio,
  layoutPreset?: SocialImageLayoutPreset
): LayoutConfig {
  const resolvedRatio = aspectRatio ?? (format === "facebook_photo" ? "1:1" : "4:5");
  const resolvedPreset =
    layoutPreset ?? (format === "facebook_quote" || format === "facebook_photo" ? "facebook_quote_premium" : "default");
  const size = resolvedRatio === "1:1"
    ? { width: 1080, height: 1080 }
    : { width: 1080, height: 1350 };

  if (resolvedPreset === "facebook_quote_premium") {
    return {
      ...size,
      aspectRatio: resolvedRatio,
      layoutPreset: resolvedPreset,
      margin: resolvedRatio === "1:1" ? 76 : 88,
      maxLines: 5,
      initialFontSize: resolvedRatio === "1:1" ? 42 : 50,
      minFontSize: resolvedRatio === "1:1" ? 31 : 34,
      brandFontSize: resolvedRatio === "1:1" ? 21 : 24,
      topicFontSize: resolvedRatio === "1:1" ? 20 : 22,
      quoteWeight: 720,
      quoteStrokeWidth: resolvedRatio === "1:1" ? 2.8 : 3,
      textBoxOpacity: 0.05,
      lowerThirdOffset: resolvedRatio === "1:1" ? 118 : 142,
    };
  }

  return {
    ...size,
    aspectRatio: resolvedRatio,
    layoutPreset: resolvedPreset,
    margin: resolvedRatio === "1:1" ? 82 : 90,
    maxLines: resolvedRatio === "1:1" ? 5 : 6,
    initialFontSize: resolvedRatio === "1:1" ? 64 : 68,
    minFontSize: 38,
    brandFontSize: 28,
    topicFontSize: 26,
    quoteWeight: 800,
    quoteStrokeWidth: 5,
    textBoxOpacity: 0.18,
    lowerThirdOffset: 34,
  };
}

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
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
    .replace(/[“”]/g, "")
    .replace(/^\s*[-–—]{2,}\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function prepareQuoteExcerpt(value: string, config: LayoutConfig): string {
  const normalized = normalizeText(value);
  if (config.layoutPreset !== "facebook_quote_premium") return normalized;
  return normalized;
}

function charWeight(char: string): number {
  if (/[MW@#%&]/.test(char)) return 0.9;
  if (/[A-ZĐ]/.test(char)) return 0.72;
  if (/[ilI1.,;:'|!]/.test(char)) return 0.34;
  if (/\s/.test(char)) return 0.32;
  return 0.58;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((total, char) => total + charWeight(char) * fontSize, 0);
}

function trimToCleanBoundary(value: string): string {
  const normalized = value.trim();
  const sentenceBoundary = Math.max(
    normalized.lastIndexOf("."),
    normalized.lastIndexOf("!"),
    normalized.lastIndexOf("?"),
    normalized.lastIndexOf("…"),
  );
  if (sentenceBoundary >= Math.round(normalized.length * 0.45)) {
    return normalized.slice(0, sentenceBoundary + 1).trim();
  }
  return normalized.replace(/\s+\S*$/, "").trim();
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

export function fitText(text: string, config: LayoutConfig): FittedText {
  const textBoxWidth = config.width - config.margin * 2;
  const textBoxHeight = Math.round(config.height * (config.layoutPreset === "facebook_quote_premium" ? 0.34 : 0.48));

  for (let fontSize = config.initialFontSize; fontSize >= config.minFontSize; fontSize -= 2) {
    const lineHeight = Math.round(fontSize * (config.layoutPreset === "facebook_quote_premium" ? 1.26 : 1.18));
    const lines = wrapText(text, fontSize, textBoxWidth);
    const blockHeight = lines.length * lineHeight;

    if (
      lines.length <= config.maxLines &&
      blockHeight <= textBoxHeight &&
      lines.every((line) => estimateTextWidth(line, fontSize) <= textBoxWidth)
    ) {
      const y = config.height - config.margin - config.brandFontSize - config.lowerThirdOffset - blockHeight;
      return {
        lines,
        fontSize,
        lineHeight,
        textBoxWidth,
        blockHeight,
        x: config.margin,
        y,
        safeAreaPass: y >= config.margin,
      };
    }
  }

  const fontSize = config.minFontSize;
  const lineHeight = Math.round(fontSize * (config.layoutPreset === "facebook_quote_premium" ? 1.26 : 1.18));
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  let bestCut = 1;
  let lastSentenceCut = 0;

  for (let count = 1; count <= words.length; count += 1) {
    const candidateText = words.slice(0, count).join(" ");
    const candidateLines = wrapText(candidateText, fontSize, textBoxWidth);
    if (candidateLines.length > config.maxLines) break;
    bestCut = count;
    if (/[.!?…]$/u.test(words[count - 1] ?? "")) {
      lastSentenceCut = count;
    }
  }

  const chosenCut =
    lastSentenceCut >= Math.max(3, Math.floor(bestCut * 0.6))
      ? lastSentenceCut
      : bestCut;

  const fittedText = words.slice(0, chosenCut).join(" ");
  const lines = wrapText(fittedText, fontSize, textBoxWidth).slice(0, config.maxLines);
  if (chosenCut < words.length && lines.length > 0) {
    let lastLine = trimToCleanBoundary(lines[lines.length - 1] ?? "");
    if (!lastLine) lastLine = lines[lines.length - 1] ?? "";
    while (lastLine && estimateTextWidth(`${lastLine}…`, fontSize) > textBoxWidth) {
      const trimmed = lastLine.replace(/\s+\S*$/u, "").trim();
      if (trimmed === lastLine) {
        lastLine = lastLine.slice(0, -1).trim();
      } else {
        lastLine = trimmed;
      }
    }
    lines[lines.length - 1] = lastLine ? `${lastLine}…` : "…";
  }
  const blockHeight = lines.length * lineHeight;
  const y = config.height - config.margin - config.brandFontSize - config.lowerThirdOffset - blockHeight;

  return {
    lines,
    fontSize,
    lineHeight,
    textBoxWidth,
    blockHeight,
    x: config.margin,
    y,
    safeAreaPass: y >= config.margin && lines.every((line) => estimateTextWidth(line, fontSize) <= textBoxWidth),
  };
}

function buildOverlaySvg(input: {
  config: LayoutConfig;
  fitted: FittedText;
  topic: string;
  channelName: string | null;
}): string {
  const { config, fitted } = input;
  const brand = normalizeText(input.channelName || DEFAULT_CHANNEL_NAME);
  const topic = normalizeText(input.topic);
  const textColor = "#FFF4D8";
  const accentColor = "#F5C76B";
  const brandY = config.height - config.margin;
  const topicY = Math.max(config.margin, fitted.y - config.topicFontSize - 26);
  const quoteMarkY = fitted.y - Math.round(fitted.fontSize * 0.32);

  const textLines = fitted.lines
    .map((line, index) => {
      const y = fitted.y + index * fitted.lineHeight;
      return `
        <text x="${fitted.x}" y="${y}" class="quote">${escapeXml(line)}</text>`;
    })
    .join("");

  return `
  <svg width="${config.width}" height="${config.height}" viewBox="0 0 ${config.width} ${config.height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bottomShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="42%" stop-color="#000000" stop-opacity="${config.layoutPreset === "facebook_quote_premium" ? "0.10" : "0.36"}"/>
        <stop offset="76%" stop-color="#000000" stop-opacity="${config.layoutPreset === "facebook_quote_premium" ? "0.58" : "0.62"}"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="${config.layoutPreset === "facebook_quote_premium" ? "0.86" : "0.76"}"/>
      </linearGradient>
      <linearGradient id="leftShade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#000000" stop-opacity="${config.layoutPreset === "facebook_quote_premium" ? "0.34" : "0.42"}"/>
        <stop offset="58%" stop-color="#000000" stop-opacity="${config.layoutPreset === "facebook_quote_premium" ? "0.06" : "0.08"}"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
      <filter id="textShadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="${config.layoutPreset === "facebook_quote_premium" ? "4" : "5"}" stdDeviation="${config.layoutPreset === "facebook_quote_premium" ? "6" : "5"}" flood-color="#000000" flood-opacity="${config.layoutPreset === "facebook_quote_premium" ? "0.78" : "0.72"}"/>
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#bottomShade)"/>
    <rect width="100%" height="100%" fill="url(#leftShade)"/>
    <rect x="${config.margin - 20}" y="${Math.max(config.margin, fitted.y - 26)}" width="${fitted.textBoxWidth + 40}" height="${fitted.blockHeight + 44}" rx="28" fill="#000000" opacity="${config.textBoxOpacity}"/>
    <style>
      .topic { font-family: Arial, Helvetica, sans-serif; font-size: ${config.topicFontSize}px; font-weight: 760; letter-spacing: 2px; fill: ${accentColor}; filter: url(#textShadow); }
      .quoteMark { font-family: Georgia, 'Times New Roman', serif; font-size: ${Math.round(fitted.fontSize * 1.28)}px; font-weight: 700; fill: ${accentColor}; opacity: 0.34; filter: url(#textShadow); }
      .quote { font-family: Arial, Helvetica, sans-serif; font-size: ${fitted.fontSize}px; font-weight: ${config.quoteWeight}; fill: ${textColor}; stroke: #111111; stroke-width: ${config.quoteStrokeWidth}px; paint-order: stroke fill; filter: url(#textShadow); }
      .brand { font-family: Arial, Helvetica, sans-serif; font-size: ${config.brandFontSize}px; font-weight: 700; fill: #F7E6BA; opacity: 0.92; filter: url(#textShadow); }
    </style>
    <text x="${config.margin}" y="${topicY}" class="topic">${escapeXml(topic.toUpperCase())}</text>
    <text x="${config.margin}" y="${quoteMarkY}" class="quoteMark">“</text>
    ${textLines}
    <text x="${config.margin}" y="${brandY}" class="brand">${escapeXml(brand)}</text>
  </svg>`;
}

function scoreReadability(fitted: FittedText, config: LayoutConfig): number {
  let score = 8.2;
  if (fitted.safeAreaPass) score += 0.7;
  if (fitted.fontSize >= (config.layoutPreset === "facebook_quote_premium" ? 42 : 54)) score += 0.6;
  if (fitted.lines.length <= 4) score += 0.4;
  if (fitted.lines.length > 5) score -= 0.5;
  if (fitted.fontSize < (config.layoutPreset === "facebook_quote_premium" ? 34 : 42)) score -= 0.6;
  if (fitted.blockHeight > config.height * 0.42) score -= 0.4;
  return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
}

async function validateEnhancedImage(input: {
  sharp: SharpFactory;
  outputPath: string;
  config: LayoutConfig;
  fitted: FittedText;
}): Promise<void> {
  if (!fs.existsSync(input.outputPath)) {
    throw new Error(`Enhanced image was not written: ${input.outputPath}`);
  }

  const metadata = await input.sharp(input.outputPath).metadata();
  if (metadata.width !== input.config.width || metadata.height !== input.config.height) {
    throw new Error(
      `Enhanced image has wrong dimensions: ${metadata.width}x${metadata.height}, expected ${input.config.width}x${input.config.height}`
    );
  }

  const expectedRatio = input.config.width / input.config.height;
  const actualRatio = (metadata.width ?? 1) / (metadata.height ?? 1);
  if (Math.abs(expectedRatio - actualRatio) > 0.002) {
    throw new Error(`Enhanced image has wrong aspect ratio: ${actualRatio.toFixed(4)}`);
  }

  if (!input.fitted.safeAreaPass) {
    throw new Error("Enhanced image text failed safe-area validation");
  }

  if (input.fitted.lines.length > input.config.maxLines) {
    throw new Error(`Enhanced image has too many text lines: ${input.fitted.lines.length}`);
  }

  const readabilityScore = scoreReadability(input.fitted, input.config);
  if (readabilityScore < 8.5) {
    throw new Error(`Enhanced image readability score is too low: ${readabilityScore}`);
  }
}

export async function enhanceSocialImage(input: SocialImageEnhancerInput): Promise<SocialImageEnhancerResult> {
  const sourcePath = resolveProjectPath(input.sourceImagePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source image does not exist: ${sourcePath}`);
  }

  const sharp = await loadSharp();
  const config = getConfig(input.format, input.aspectRatio, input.layoutPreset);
  const quoteText = prepareQuoteExcerpt(input.quoteText || input.topic, config);
  const fitted = fitText(quoteText, config);
  const outputPath = input.outputPath
    ? resolveProjectPath(input.outputPath)
    : path.join(process.cwd(), "output", "social-images", `${Date.now()}-${input.format}-${config.aspectRatio.replace(":", "x")}.jpg`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const overlaySvg = buildOverlaySvg({
    config,
    fitted,
    topic: input.topic,
    channelName: input.channelName ?? DEFAULT_CHANNEL_NAME,
  });

  await sharp(sourcePath)
    .resize(config.width, config.height, { fit: "cover", position: "center" })
    .composite([{ input: Buffer.from(overlaySvg) }])
    .jpeg({ quality: 91, mozjpeg: true })
    .toFile(outputPath);

  await validateEnhancedImage({ sharp, outputPath, config, fitted });

  return {
    enhancedImagePath: outputPath,
    metadata: {
      width: config.width,
      height: config.height,
      aspectRatio: config.aspectRatio,
      textLineCount: fitted.lines.length,
      safeAreaPass: fitted.safeAreaPass,
      readabilityScore: scoreReadability(fitted, config),
      layoutPreset: config.layoutPreset,
    },
  };
}
