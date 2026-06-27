import fs from "fs";
import os from "os";
import path from "path";
import { buildFacebookQuoteText } from "@/lib/social/youtube-metadata";
import { enhanceSocialImage, type SocialImageEnhancerMetadata } from "@/lib/image/social-image-enhancer";
import { resolveQuoteVisualStyle } from "@/lib/quotes/quote-style";

export async function renderFacebookQuoteImage(input: {
  contentId: string;
  topic: string;
  shortContent?: string | null;
  quoteText?: string | null;
  imagePath: string;
  channelKey?: string | null;
  contentProfileKey?: string | null;
  nicheName?: string | null;
}): Promise<{ imagePath: string; quoteText: string; metadata: SocialImageEnhancerMetadata }> {
  const style = resolveQuoteVisualStyle({
    channelKey: input.channelKey,
    contentProfileKey: input.contentProfileKey,
    nicheName: input.nicheName,
    platform: "facebook",
    videoType: "quote",
  });
  const quoteText = input.quoteText?.trim()
    ? input.quoteText.trim()
    : buildFacebookQuoteText({
        topic: input.topic,
        shortContent: input.shortContent,
        channelKey: input.channelKey,
        contentProfileKey: input.contentProfileKey,
        nicheName: input.nicheName,
      });

  const sourcePath = input.imagePath.startsWith("/")
    ? input.imagePath
    : path.join(process.cwd(), input.imagePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Ảnh quote không tồn tại: ${sourcePath}`);
  }

  const outPath = path.join(os.tmpdir(), `${input.contentId}-fb-quote-${Date.now()}.jpg`);
  const enhanced = await enhanceSocialImage({
    sourceImagePath: sourcePath,
    quoteText,
    topic: input.topic,
    format: "facebook_quote",
    aspectRatio: "4:5",
    outputPath: outPath,
    channelName: process.env.FACEBOOK_QUOTE_CHANNEL_NAME ?? null,
    layoutPreset: style.facebookLayoutPreset,
  });

  return {
    imagePath: enhanced.enhancedImagePath,
    quoteText,
    metadata: enhanced.metadata,
  };
}
