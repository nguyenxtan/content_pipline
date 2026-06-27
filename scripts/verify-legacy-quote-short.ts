import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import {
  generateLegacyQuoteText,
  renderLegacyQuoteShort,
  type LegacyQuoteShortMetadata,
} from "@/lib/legacy-quote-short-generator";

config({ path: ".env.local" });
config();

const OUTPUT_DIR = path.join(process.cwd(), "output", "legacy-quote-short-v1");
const MUSIC_DIR = path.join(process.cwd(), "media", "music", "phat-phap");
const SAMPLE_TOPICS = [
  "Bình an từ chính chánh niệm",
  "Buông bỏ khổ đau",
  "Nhân quả không quên",
  "Từ bi chữa lành",
  "Đời nhẹ hơn khi biết đủ",
];

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function pickMusic(seed: string): string | null {
  if (!fs.existsSync(MUSIC_DIR)) return null;
  const files = fs.readdirSync(MUSIC_DIR)
    .filter((file) => /\.(mp3|m4a|wav)$/i.test(file))
    .sort();
  if (files.length === 0) return null;
  const index = Array.from(seed).reduce((sum, ch) => sum + ch.codePointAt(0)!, 0) % files.length;
  return path.join("media", "music", "phat-phap", files[index]!);
}

async function loadSourceImages(): Promise<string[]> {
  const images: string[] = [];

  try {
    const rows = await db.query.contentGenerations.findMany({
      orderBy: (t, { desc: orderDesc }) => orderDesc(t.createdAt),
      limit: 80,
    });
    for (const row of rows) {
      const paths = (row.imagePaths ?? []) as string[];
      for (const imagePath of paths) {
        if (fs.existsSync(resolveProjectPath(imagePath))) images.push(imagePath);
      }
      const thumbPath = `media/videos/${row.id}-short-thumb.jpg`;
      if (fs.existsSync(resolveProjectPath(thumbPath))) images.push(thumbPath);
      if (images.length >= SAMPLE_TOPICS.length) break;
    }
  } catch (error) {
    console.warn(`[verify-legacy-quote-short] DB image lookup failed, falling back to local media scan: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (images.length >= SAMPLE_TOPICS.length) {
    return images.slice(0, SAMPLE_TOPICS.length);
  }

  const fallbackDirs = [
    path.join(process.cwd(), "media", "images"),
    path.join(process.cwd(), "media", "news-images"),
    path.join(process.cwd(), "media", "videos"),
  ];
  for (const dir of fallbackDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
      images.push(path.join(dir, file));
      if (images.length >= SAMPLE_TOPICS.length) break;
    }
    if (images.length >= SAMPLE_TOPICS.length) break;
  }
  return images.slice(0, SAMPLE_TOPICS.length);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const sourceImages = await loadSourceImages();
  if (sourceImages.length < SAMPLE_TOPICS.length) {
    throw new Error(`Need ${SAMPLE_TOPICS.length} source images, found ${sourceImages.length}`);
  }

  const results: LegacyQuoteShortMetadata[] = [];
  for (const [index, topic] of SAMPLE_TOPICS.entries()) {
    const contentId = `legacy-quote-v2-sample-${String(index + 1).padStart(2, "0")}`;
    const quoteText = generateLegacyQuoteText(topic);
    const result = await renderLegacyQuoteShort({
      contentId,
      topic,
      quoteText,
      sourceImagePath: sourceImages[index]!,
      musicPath: pickMusic(topic),
      outputDir: OUTPUT_DIR,
      durationSec: 14,
      experimentId: "LEGACY_QUOTE_SHORT",
      experimentVariant: "LEGACY_QUOTE_NO_VOICE_V2",
    });
    results.push(result);
  }

  const summaryPath = path.join(OUTPUT_DIR, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");

  console.log("\nLegacy Quote Short V1 samples");
  console.log("=".repeat(72));
  for (const row of results) {
    console.log(`- ${row.contentId}`);
    console.log(`  topic      : ${row.topic}`);
    console.log(`  quote      : ${row.quoteText}`);
    console.log(`  duration   : ${row.durationSec}s`);
    console.log(`  video      : ${row.videoPath}`);
    console.log(`  music      : ${row.backgroundMusicPath ?? "none"}`);
    console.log(`  visualMode : ${row.visualMode}`);
    console.log(`  motion     : ${row.motionStrength}`);
    console.log(`  audio      : ${row.audioValidation.audioStreamPresent ? "present" : "missing"}`);
    console.log(`  meanVolume : ${row.audioValidation.meanVolumeDb ?? "unknown"} dB`);
    console.log(`  maxVolume  : ${row.audioValidation.maxVolumeDb ?? "unknown"} dB`);
    console.log(`  formatType : ${row.formatType}`);
  }
  console.log(`\nSummary: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
