import "dotenv/config";

import fs from "fs";
import path from "path";
import pg from "pg";
import { enhanceSocialImage } from "@/lib/image/social-image-enhancer";
import { buildFacebookQuoteText } from "@/lib/social/youtube-metadata";

const { Pool } = pg;

type ContentSample = {
  id: string;
  topic: string;
  short_content: string | null;
  script: string | null;
  image_paths: string[] | null;
};

type VerifyResult = {
  contentId: string;
  topic: string;
  format: "facebook_quote" | "facebook_photo";
  aspectRatio: "4:5" | "1:1";
  quoteText: string;
  sourceImagePath: string;
  outputPath: string;
  exists: boolean;
  metadata: {
    width: number;
    height: number;
    aspectRatio: "4:5" | "1:1";
    textLineCount: number;
    safeAreaPass: boolean;
    readabilityScore: number;
    layoutPreset: string;
  };
};

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function findFirstImage(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFirstImage(fullPath);
      if (found) return found;
      continue;
    }

    if (/\.(jpe?g|png|webp)$/i.test(entry.name)) return fullPath;
  }

  return null;
}

async function loadDbSamples(limit: number): Promise<ContentSample[]> {
  if (!process.env.DATABASE_URL) return [];

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const result = await client.query<ContentSample>(
      `
      SELECT id, topic, short_content, script, image_paths
      FROM content_generations
      WHERE topic IS NOT NULL
        AND content_mode IN ('short', 'both')
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit * 4]
    );

    return result.rows
      .filter((row) => {
        const original = row.image_paths?.[0] ?? null;
        return Boolean(original && fs.existsSync(resolveProjectPath(original)));
      })
      .slice(0, limit);
  } finally {
    client.release();
    await pool.end();
  }
}

function fallbackSamples(limit: number): ContentSample[] {
  const sourceImagePath = findFirstImage(path.join(process.cwd(), "media", "images"));
  if (!sourceImagePath) return [];

  const examples = [
    {
      topic: "Tha thứ",
      short_content:
        "Có những điều ta chỉ thật sự buông được khi ngừng bắt quá khứ trả lời cho nỗi đau hôm nay.",
    },
    {
      topic: "Bình an",
      short_content:
        "Bình an không đến từ việc mọi chuyện đều đúng ý, mà từ lúc mình thôi chống lại những điều đã xảy ra.",
    },
    {
      topic: "Vô thường",
      short_content:
        "Có những cuộc gặp chỉ đi ngang qua đời mình, nhưng lại dạy ta cách trân trọng những ngày còn ở cạnh nhau.",
    },
  ];

  return Array.from({ length: limit }, (_, index) => ({
    id: `fallback-${index + 1}`,
    topic: examples[index % examples.length].topic,
    short_content: examples[index % examples.length].short_content,
    script: null,
    image_paths: [sourceImagePath],
  }));
}

async function loadSamples(limit: number): Promise<ContentSample[]> {
  const dbSamples = await loadDbSamples(limit);
  if (dbSamples.length >= limit) return dbSamples;
  return [...dbSamples, ...fallbackSamples(limit - dbSamples.length)].slice(0, limit);
}

async function main() {
  const sampleCount = 10;
  const samples = await loadSamples(sampleCount);
  if (samples.length < sampleCount) {
    throw new Error(`Need ${sampleCount} samples, found ${samples.length}`);
  }

  const outputDir = path.join(process.cwd(), "output", "facebook-quote-style");
  fs.mkdirSync(outputDir, { recursive: true });

  const results: VerifyResult[] = [];

  for (const [index, sample] of samples.entries()) {
    const format = index < 5 ? "facebook_quote" : "facebook_photo";
    const aspectRatio = index < 5 ? "4:5" : "1:1";
    const quoteText = buildFacebookQuoteText({
      topic: sample.topic,
      shortContent: sample.short_content || sample.script,
    });
    const sourceImagePath = resolveProjectPath(sample.image_paths?.[0] ?? "");
    const outputPath = path.join(
      outputDir,
      `${String(index + 1).padStart(2, "0")}-${format}-${sample.id}.jpg`
    );

    const enhanced = await enhanceSocialImage({
      sourceImagePath,
      quoteText,
      topic: sample.topic,
      format,
      aspectRatio,
      layoutPreset: "facebook_quote_premium",
      outputPath,
      channelName: "Trí Tuệ An Nhiên",
    });

    results.push({
      contentId: sample.id,
      topic: sample.topic,
      format,
      aspectRatio,
      quoteText,
      sourceImagePath,
      outputPath: enhanced.enhancedImagePath,
      exists: fs.existsSync(enhanced.enhancedImagePath),
      metadata: enhanced.metadata,
    });
  }

  const readabilityScores = results.map((row) => row.metadata.readabilityScore);

  console.log(JSON.stringify({
    generated: results.length,
    quote4x5: results.filter((row) => row.format === "facebook_quote").length,
    photo1x1: results.filter((row) => row.format === "facebook_photo").length,
    readability: {
      min: Math.min(...readabilityScores),
      max: Math.max(...readabilityScores),
    },
    safeAreaPass: results.every((row) => row.metadata.safeAreaPass),
    outputDir,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
