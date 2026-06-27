import "dotenv/config";

import fs from "fs";
import path from "path";
import pg from "pg";
import { generateShortCover } from "@/lib/short-cover-engine";
import { generateShortCoverAsset } from "@/lib/image/short-cover-asset-generator";

const { Pool } = pg;

type ContentSample = {
  id: string;
  topic: string;
  short_selected_hook: string | null;
  short_content: string | null;
  script: string | null;
  image_paths: string[] | null;
};

function readLimit(): number {
  const raw = process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
  const parsed = raw ? Number(raw) : 20;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(50, parsed)) : 10;
}

function buildWordCountDistribution(results: Array<{ coverTextWordCount: number }>): Record<string, number> {
  return results.reduce<Record<string, number>>((acc, row) => {
    const key = `${row.coverTextWordCount}_words`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

async function loadSamples(limit: number): Promise<ContentSample[]> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for verify-short-cover-assets.ts");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const result = await client.query<ContentSample>(
      `
      SELECT id, topic, short_selected_hook, short_content, script, image_paths
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
        const fallback = `media/videos/${row.id}-short-thumb.jpg`;
        return Boolean((original && fs.existsSync(original)) || fs.existsSync(fallback));
      })
      .slice(0, limit);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const limit = readLimit();
  const samples = await loadSamples(limit);
  const results = [];
  const outputDir = path.join(process.cwd(), "output", "short-cover-hook");
  fs.mkdirSync(outputDir, { recursive: true });

  for (const [index, sample] of samples.entries()) {
    const cover = generateShortCover({
      topic: sample.topic,
      selectedHook: sample.short_selected_hook,
      script: sample.short_content || sample.script,
    });
    const metadata = await generateShortCoverAsset({
      contentId: sample.id,
      topic: sample.topic,
      hookOrScriptExcerpt: sample.short_selected_hook || sample.short_content || sample.script,
      sourceImagePath: sample.image_paths?.[0] ?? null,
      coverText: cover.coverText,
      layoutPreset: "short_cover_hook",
      channelName: "Trí Tuệ An Nhiên",
      showBranding: true,
      outputPath: path.join(outputDir, `${String(index + 1).padStart(2, "0")}-${sample.id}-short-cover-hook.jpg`),
    });

    results.push({
      contentId: sample.id,
      topic: sample.topic,
      coverText: metadata.coverText,
      coverTextWordCount: metadata.coverTextWordCount,
      readabilityScore: metadata.readabilityScore,
      safeAreaPass: metadata.safeAreaPass,
      sourceImageMode: metadata.sourceImageMode,
      layoutPreset: metadata.layoutPreset,
      channelName: metadata.channelName,
      showBranding: metadata.showBranding,
      outputPath: metadata.outputPath,
      metadataPath: metadata.metadataPath,
    });
  }

  console.log(JSON.stringify({
    requested: limit,
    generated: results.length,
    coverTexts: results.map((row) => row.coverText),
    coverTextLengthDistribution: buildWordCountDistribution(results),
    readability: {
      min: Math.min(...results.map((row) => row.readabilityScore)),
      max: Math.max(...results.map((row) => row.readabilityScore)),
    },
    safeAreaPass: results.every((row) => row.safeAreaPass),
    outputDir,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
