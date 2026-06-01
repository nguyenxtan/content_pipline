/**
 * CLI: create YouTube metadata package for a long video.
 *
 * Usage:
 *   npm run package:long -- --topic "..." --script path/to/script.txt \
 *       --video path/to/video.mp4 --thumbnail path/to/thumb.jpg \
 *       [--duration 600] [--output output/my-package.json]
 */
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { runLongformEngine } from "@/lib/longform-engine";

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] ?? "";
      i++;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs();

  const topic = args.topic;
  const scriptPath = args.script;
  const videoPath = args.video ?? "";
  const thumbnailPath = args.thumbnail ?? "";
  const audioDurationSec = args.duration ? Number(args.duration) : undefined;
  const outputPath = args.output ?? `output/longform-package-${Date.now()}.json`;

  if (!topic) {
    console.error("Error: --topic is required");
    process.exit(1);
  }
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    console.error(`Error: --script path not found: ${scriptPath}`);
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const model = process.env.LONGFORM_MODEL ?? "google/gemini-2.0-flash";
  const script = fs.readFileSync(scriptPath, "utf-8");
  const wordCount = script.split(/\s+/).length;
  const duration = audioDurationSec ?? Math.round(wordCount / 2.8);

  console.log(`Topic:    ${topic}`);
  console.log(`Script:   ${scriptPath} (${wordCount} words, ~${duration}s)`);
  console.log(`Model:    ${model}`);
  console.log("Generating package...\n");

  const result = await runLongformEngine({
    client,
    model,
    topic,
    script,
    audioDurationSec: duration,
    scriptPath,
    videoPath,
    thumbnailPath,
  });

  const pkg = result.package;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(pkg, null, 2), "utf-8");

  console.log(`✓ Title:       ${pkg.best_title}`);
  console.log(`✓ Tags:        ${pkg.tags.join(", ")}`);
  console.log(`✓ Chapters:    ${pkg.chapters.length}`);
  console.log(`✓ Thumbnail:   ${pkg.thumbnail_intent.text} (${pkg.thumbnail_intent.emotion})`);
  console.log(`✓ Comment:     ${pkg.pinned_comment.slice(0, 80)}`);
  console.log(`\nPackage saved: ${outputPath}`);
  console.log(`Usage: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
