import { createHash } from "node:crypto";

export function normalizeWhitespace(input: string): string {
  return input.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function cleanInlineText(input: string): string {
  return normalizeWhitespace(input.replace(/\s+/g, " "));
}

export function normalizeParagraphText(paragraphs: string[]): string {
  const cleaned = paragraphs
    .map((paragraph) => cleanInlineText(paragraph))
    .filter(Boolean)
    .filter((paragraph) => !paragraph.match(/^Mời bạn CLICK ADS NÀY/i))
    .filter((paragraph) => !paragraph.match(/^Nội dung chương đang bị khóa/i));

  return cleaned.join("\n\n").trim();
}

export function buildContentHash(contentText: string): string {
  return createHash("sha256").update(contentText).digest("hex");
}

export function countWords(contentText: string): number {
  const normalized = cleanInlineText(contentText);
  return normalized ? normalized.split(/\s+/).length : 0;
}

export function safeSlugFromUrl(sourceUrl: string): string {
  try {
    const { pathname } = new URL(sourceUrl);
    return pathname.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
  } catch {
    return "";
  }
}

export function extractChapterNumber(text: string): number {
  const match = text.match(/ch(?:ương|uong)\s*(\d+)/i) ?? text.match(/(\d+)/);
  return match ? Number.parseInt(match[1] ?? match[0], 10) : 0;
}
