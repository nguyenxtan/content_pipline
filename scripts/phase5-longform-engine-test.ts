import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { runLongformEngine } from "@/lib/longform-engine";
import { runHookEngine } from "@/lib/hook-engine";
import { runScriptEngine } from "@/lib/script-engine";

const MODEL = process.env.LONGFORM_MODEL ?? "google/gemini-2.0-flash";
const SCRIPT_MODEL = process.env.SCRIPT_MODEL ?? "google/gemini-2.0-flash";

const TEST_TOPICS = [
  "Khi người thân ra đi, ta mới hiểu điều gì thực sự quan trọng",
  "Tại sao những người im lặng thường hiểu đời hơn",
  "Sống chậm lại để thấy mình đang bỏ lỡ điều gì",
];

const NICHE = "Phật pháp / chữa lành / chiêm nghiệm đời sống";

type TestRecord =
  | {
      ok: true;
      topic: string;
      best_title: string;
      description_preview: string;
      chapters_count: number;
      tags_count: number;
      pinned_comment: string;
      thumbnail_intent_emotion: string;
      thumbnail_intent_text: string;
      title_candidates_count: number;
      usage: { inputTokens: number; outputTokens: number };
    }
  | {
      ok: false;
      topic: string;
      error: string;
    };

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const outDir = path.join(process.cwd(), "output", "phase5");
  fs.mkdirSync(outDir, { recursive: true });

  const records: TestRecord[] = [];
  const packages: object[] = [];

  for (const topic of TEST_TOPICS) {
    console.log(`\n=== Topic: ${topic} ===`);
    try {
      console.log("  → Hook engine...");
      const hookResult = await runHookEngine({
        client,
        model: SCRIPT_MODEL,
        topic,
        nicheName: NICHE,
      });
      console.log(`  → Hook: ${hookResult.selectedHook.slice(0, 80)}`);

      console.log("  → Script engine (long)...");
      const scriptResult = await runScriptEngine({
        client,
        model: SCRIPT_MODEL,
        topic,
        nicheName: NICHE,
        selectedHook: hookResult.selectedHook,
        mode: "long",
      });

      if (scriptResult.mode !== "long") throw new Error("Expected long mode");
      const { script, outline, chapters } = scriptResult.result;
      const wordCount = script.split(/\s+/).length;
      console.log(`  → Script: ${wordCount} words, ${chapters.length} chapters`);

      console.log("  → Longform package engine...");
      const pkgResult = await runLongformEngine({
        client,
        model: MODEL,
        topic,
        script,
        outline,
        rawChapters: chapters,
        audioDurationSec: Math.round(wordCount / 2.8),
        scriptPath: `output/phase5/${topic.slice(0, 20).replace(/\s/g, "_")}_script.txt`,
        videoPath: "",
        thumbnailPath: "",
      });

      const pkg = pkgResult.package;
      console.log(`  → Title: ${pkg.best_title}`);
      console.log(`  → Tags: ${pkg.tags.length}, Chapters: ${pkg.chapters.length}`);

      fs.writeFileSync(
        path.join(outDir, `${topic.slice(0, 20).replace(/[^\w]/g, "_")}_script.txt`),
        script,
        "utf-8",
      );

      packages.push({ hook: hookResult.selectedHook, ...pkg });
      records.push({
        ok: true,
        topic,
        best_title: pkg.best_title,
        description_preview: pkg.description.slice(0, 120),
        chapters_count: pkg.chapters.length,
        tags_count: pkg.tags.length,
        pinned_comment: pkg.pinned_comment,
        thumbnail_intent_emotion: pkg.thumbnail_intent.emotion,
        thumbnail_intent_text: pkg.thumbnail_intent.text,
        title_candidates_count: pkg.title_candidates.length,
        usage: pkgResult.usage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${msg}`);
      records.push({ ok: false, topic, error: msg });
    }
  }

  fs.writeFileSync(path.join(outDir, "packages.json"), JSON.stringify(packages, null, 2), "utf-8");
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(records, null, 2), "utf-8");

  const ok = records.filter((r) => r.ok).length;
  console.log(`\n=== Phase 5 Test Complete ===`);
  console.log(`Pass: ${ok}/${records.length}`);
  if (ok > 0) {
    const passed = records.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
    console.log("\nTitles:");
    passed.forEach((r) => console.log(`  • ${r.best_title}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
