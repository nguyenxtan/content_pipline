import fs from "fs";
import path from "path";
import { enhanceSocialImage } from "@/lib/image/social-image-enhancer";

function findFirstImage(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFirstImage(fullPath);
      if (found) return found;
      continue;
    }

    if (/\.(jpe?g|png|webp)$/i.test(entry.name)) {
      return fullPath;
    }
  }

  return null;
}

async function main() {
  const sourceImagePath = process.argv[2] || findFirstImage(path.join(process.cwd(), "media", "images"));
  if (!sourceImagePath) {
    const fallback = findFirstImage(path.join(process.cwd(), "media"));
    if (!fallback) {
      throw new Error("No source image found. Pass an image path or create media/images first.");
    }
    fs.mkdirSync(path.join(process.cwd(), "output", "social-image-enhancer"), { recursive: true });
    return renderCases(fallback);
  }

  return renderCases(sourceImagePath);
}

async function renderCases(sourceImagePath: string) {
  const cases = [
    {
      key: "short",
      topic: "Bình an",
      quoteText: "Bình an bắt đầu từ một hơi thở biết đủ.",
    },
    {
      key: "medium",
      topic: "Buông bỏ",
      quoteText: "Có những ngày lòng người chỉ dịu lại khi ta thôi đòi cuộc đời phải trả lời ngay lập tức.",
    },
    {
      key: "long",
      topic: "Tha thứ",
      quoteText:
        "Có những điều ta chỉ thật sự buông được khi ngừng bắt quá khứ trả lời cho nỗi đau hôm nay. Có những vết thương không lành vì thời gian, mà lành khi ta thôi tự ép mình phải mạnh mẽ trước khi trái tim kịp nghỉ ngơi.",
    },
  ] as const;

  const outputDir = path.join(process.cwd(), "output", "social-image-enhancer");
  fs.mkdirSync(outputDir, { recursive: true });

  const outputs = [];
  for (const item of cases) {
    const facebookQuote = await enhanceSocialImage({
      sourceImagePath,
      quoteText: item.quoteText,
      topic: item.topic,
      format: "facebook_quote",
      aspectRatio: "4:5",
      outputPath: path.join(outputDir, `verify-facebook-quote-${item.key}-4x5.jpg`),
      channelName: "Trí Tuệ An Nhiên",
    });

    const facebookPhoto = await enhanceSocialImage({
      sourceImagePath,
      quoteText: item.quoteText,
      topic: item.topic,
      format: "facebook_photo",
      aspectRatio: "1:1",
      outputPath: path.join(outputDir, `verify-facebook-photo-${item.key}-1x1.jpg`),
      channelName: "Trí Tuệ An Nhiên",
    });

    outputs.push(
      {
        case: item.key,
        format: "facebook_quote",
        quoteText: item.quoteText,
        after: facebookQuote.enhancedImagePath,
        metadata: facebookQuote.metadata,
        exists: fs.existsSync(facebookQuote.enhancedImagePath),
      },
      {
        case: item.key,
        format: "facebook_photo",
        quoteText: item.quoteText,
        after: facebookPhoto.enhancedImagePath,
        metadata: facebookPhoto.metadata,
        exists: fs.existsSync(facebookPhoto.enhancedImagePath),
      },
    );
  }

  console.log(JSON.stringify({
    sourceImagePath,
    outputs,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
