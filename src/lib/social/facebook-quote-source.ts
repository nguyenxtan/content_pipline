import fs from "fs";
import path from "path";

export type FacebookQuoteImageSourceMode = "original" | "short_thumb_fallback";

export type FacebookQuoteImageSourceResolution =
  | {
      ok: true;
      sourceImageMode: FacebookQuoteImageSourceMode;
      sourceImagePath: string;
      originalImagePath: string | null;
      fallbackImagePath: string;
    }
  | {
      ok: false;
      error: "missing_source_image_for_facebook_quote";
      originalImagePath: string | null;
      fallbackImagePath: string;
    };

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function fileExists(filePath: string | null | undefined): filePath is string {
  return Boolean(filePath && fs.existsSync(resolveProjectPath(filePath)));
}

export function resolveFacebookQuoteImageSource(input: {
  contentId: string;
  imagePaths: string[] | null | undefined;
}): FacebookQuoteImageSourceResolution {
  const originalImagePath = input.imagePaths?.[0] ?? null;
  const fallbackImagePath = `media/videos/${input.contentId}-short-thumb.jpg`;

  if (fileExists(originalImagePath)) {
    return {
      ok: true,
      sourceImageMode: "original",
      sourceImagePath: originalImagePath,
      originalImagePath,
      fallbackImagePath,
    };
  }

  if (fileExists(fallbackImagePath)) {
    return {
      ok: true,
      sourceImageMode: "short_thumb_fallback",
      sourceImagePath: fallbackImagePath,
      originalImagePath,
      fallbackImagePath,
    };
  }

  return {
    ok: false,
    error: "missing_source_image_for_facebook_quote",
    originalImagePath,
    fallbackImagePath,
  };
}
