import fs from "fs";
import path from "path";
import { suggestTopicsAction } from "@/actions/content-generator";
import { runScriptEngineAction } from "@/actions/script-engine";

type ShortTestRecord =
  | {
      ok: true;
      topic: string;
      selectedHook: string;
      script: string;
      validation: {
        wordCount: number;
        estimatedDurationSec: number;
        bannedOpeningMatched: string | null;
        pronounCheckPassed: boolean;
        genericAiPhrases: string[];
        passes: boolean;
        issues: string[];
      };
      rewriteCount: number;
    }
  | {
      ok: false;
      topic: string;
      error: string;
    };

type LongTestRecord =
  | {
      ok: true;
      topic: string;
      selectedHook: string;
      script: string;
      outline: unknown;
      chapters: unknown;
      validation: {
        wordCount: number;
        estimatedDurationSec: number;
        bannedOpeningMatched: string | null;
        pronounCheckPassed: boolean;
        genericAiPhrases: string[];
        passes: boolean;
        issues: string[];
      };
      rewriteCount: number;
    }
  | {
      ok: false;
      topic: string;
      error: string;
    };

const FALLBACK_SHORT_TOPICS = [
  "Dằn vặt quá khứ",
  "Nỗi lo về tương lai",
  "Ám ảnh lỗi lầm",
  "Thiếu cảm giác an toàn",
  "Sợ bị bỏ rơi",
];

async function main() {
  const nicheId = 13;
  const outputDir = path.join(process.cwd(), "output", "phase4");
  fs.mkdirSync(outputDir, { recursive: true });

  const suggested = await suggestTopicsAction(nicheId, "openai/gpt-4o-mini", 20);
  if ("error" in suggested) throw new Error(suggested.error);
  const shortTopics = [...suggested.topics];
  for (const topic of FALLBACK_SHORT_TOPICS) {
    if (shortTopics.length >= 20) break;
    if (!shortTopics.includes(topic)) shortTopics.push(topic);
  }
  const shortTopicsFinal = shortTopics.slice(0, 20);
  const longTopics = shortTopicsFinal.slice(0, 3);

  const shortResults: ShortTestRecord[] = [];
  for (const [index, topic] of shortTopicsFinal.entries()) {
    console.log(`[short ${index + 1}/${shortTopicsFinal.length}] ${topic}`);
    const result = await runScriptEngineAction({ topic, nicheId, mode: "short", model: "openai/gpt-4o-mini" });
    if (!result.success || result.mode !== "short") {
      shortResults.push({ ok: false, topic, error: result.success ? "Unexpected short mode response" : result.error });
      fs.writeFileSync(path.join(outputDir, "short-scripts.json"), JSON.stringify(shortResults, null, 2));
      continue;
    }
    shortResults.push({
      ok: true,
      topic,
      selectedHook: result.selectedHook,
      script: result.script,
      validation: result.validation,
      rewriteCount: result.rewriteCount,
    });
    fs.writeFileSync(path.join(outputDir, "short-scripts.json"), JSON.stringify(shortResults, null, 2));
  }

  const longResults: LongTestRecord[] = [];
  for (const [index, topic] of longTopics.entries()) {
    console.log(`[long ${index + 1}/${longTopics.length}] ${topic}`);
    const result = await runScriptEngineAction({ topic, nicheId, mode: "long", model: "openai/gpt-4o-mini" });
    if (!result.success || result.mode !== "long") {
      longResults.push({ ok: false, topic, error: result.success ? "Unexpected long mode response" : result.error });
      fs.writeFileSync(path.join(outputDir, "long-scripts.json"), JSON.stringify(longResults, null, 2));
      continue;
    }
    longResults.push({
      ok: true,
      topic,
      selectedHook: result.selectedHook,
      script: result.script,
      outline: result.outline,
      chapters: result.chapters,
      validation: result.validation,
      rewriteCount: result.rewriteCount,
    });
    fs.writeFileSync(path.join(outputDir, "long-scripts.json"), JSON.stringify(longResults, null, 2));
  }

  const commonShortIssues = shortResults
    .filter((item): item is Extract<ShortTestRecord, { ok: true }> => item.ok)
    .flatMap((item) => item.validation.issues);
  const commonLongIssues = longResults
    .filter((item): item is Extract<LongTestRecord, { ok: true }> => item.ok)
    .flatMap((item) => item.validation.issues);

  const summary = {
    shortTopics: shortTopicsFinal,
    longTopics,
    shortSuccess: shortResults.filter((item) => item.ok).length,
    shortFailure: shortResults.filter((item) => !item.ok).length,
    longSuccess: longResults.filter((item) => item.ok).length,
    longFailure: longResults.filter((item) => !item.ok).length,
    commonShortIssues,
    commonLongIssues,
  };

  fs.writeFileSync(path.join(outputDir, "short-scripts.json"), JSON.stringify(shortResults, null, 2));
  fs.writeFileSync(path.join(outputDir, "long-scripts.json"), JSON.stringify(longResults, null, 2));
  fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
