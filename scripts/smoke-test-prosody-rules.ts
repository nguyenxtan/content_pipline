/**
 * smoke-test-prosody-rules.ts
 *
 * Prosody smoke test for phat_phap short script generation.
 * Tests the 10 sentence-length rules added to buildShortDraftPrompt().
 *
 * SAFE: no DB, no TTS, no media, no queue mutation, no publish.
 *
 * Run:
 *   OPENROUTER_API_KEY="sk-or-..." npx tsx scripts/smoke-test-prosody-rules.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { runScriptEngine, validateShortScriptProsody } from "@/lib/script-engine";
import { DEFAULT_SHORT_PROMPT } from "@/lib/content-prompts";

// ─── 10 phat_phap topics with pre-written realistic hooks ─────────────────────
const TEST_CASES: Array<{ topic: string; hook: string }> = [
  {
    topic: "Sự im lặng trong tâm",
    hook: "Có những buổi sáng ta thức dậy mà không biết mình đang buồn chuyện gì.",
  },
  {
    topic: "Buông bỏ oán giận",
    hook: "Ta giữ mãi một lời nói của người khác từ năm ngoái — còn họ đã quên từ lâu.",
  },
  {
    topic: "Vô thường trong cuộc sống",
    hook: "Bữa cơm gia đình đông đủ nhất là lúc ta chưa biết đó là lần cuối.",
  },
  {
    topic: "Tâm từ bi với bản thân",
    hook: "Ta hay an ủi người khác, nhưng khi chính mình sai thì lại không tha cho mình.",
  },
  {
    topic: "Sống chậm lại",
    hook: "Một ngày qua đi, ta không nhớ mình đã làm gì — chỉ biết là rất mệt.",
  },
  {
    topic: "Nhân quả trong đời thường",
    hook: "Người hay than thở rằng đời không công bằng thường quên mất điều họ đã làm trước đó.",
  },
  {
    topic: "Chấp nhận bản thân",
    hook: "Ta dành cả đời chạy theo một phiên bản của mình mà người khác muốn ta trở thành.",
  },
  {
    topic: "Sợ hãi và dũng cảm",
    hook: "Không phải người dũng cảm là người không sợ — họ chỉ không để sợ làm chủ.",
  },
  {
    topic: "Cô đơn và kết nối",
    hook: "Có thể ngồi cùng nhiều người mà vẫn thấy hoàn toàn một mình.",
  },
  {
    topic: "Lời nói và tổn thương",
    hook: "Một câu nói mất ba giây — nhưng vết thương của nó có thể kéo dài ba năm.",
  },
];

const PASS_CRITERIA = {
  maxAvgWords: 15,
  maxSentenceWords: 18,
  maxCommasPerSentence: 1,
  minSentences: 5,
};

type ScriptResult = {
  index: number;
  topic: string;
  sentenceCount: number;
  avgWordsPerSentence: number;
  maxSentenceWords: number;
  totalCommas: number;
  multiCommaSentences: number;
  prosodyWarnings: string[];
  passes: boolean;
  rewriteCount: number;
  script: string;
};

function checkPasses(qa: ReturnType<typeof validateShortScriptProsody>): boolean {
  return (
    qa.avgWordsPerSentence <= PASS_CRITERIA.maxAvgWords &&
    qa.maxSentenceWords <= PASS_CRITERIA.maxSentenceWords &&
    qa.multiCommaWarnings.length === 0 &&
    qa.sentenceCount >= PASS_CRITERIA.minSentences
  );
}

function bar(val: number, max: number, width = 20): string {
  const filled = Math.round((val / max) * width);
  return "█".repeat(Math.min(filled, width)) + "░".repeat(Math.max(0, width - filled));
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function main() {
  console.log("═".repeat(70));
  console.log("  PROSODY SMOKE TEST — phat_phap short script generation");
  console.log(`  ${new Date().toISOString()}`);
  console.log("═".repeat(70));
  console.log(`  Topics: ${TEST_CASES.length} | Model: openai/gpt-4o-mini`);
  console.log(`  Pass criteria: avg≤${PASS_CRITERIA.maxAvgWords}w/s  max≤${PASS_CRITERIA.maxSentenceWords}w  commas≤1/s  sentences≥${PASS_CRITERIA.minSentences}`);
  console.log("═".repeat(70));
  console.log();

  const client = getOpenRouterClient();
  const model = "openai/gpt-4o-mini";
  const results: ScriptResult[] = [];

  for (const [i, tc] of TEST_CASES.entries()) {
    process.stdout.write(`  [${i + 1}/${TEST_CASES.length}] ${truncate(tc.topic, 30)} ... `);

    try {
      const out = await runScriptEngine({
        client,
        model,
        topic: tc.topic,
        nicheName: "Phật Pháp",
        selectedHook: tc.hook,
        contentProfileKey: "buddhism",
        mode: "short",
        shortBasePrompt: DEFAULT_SHORT_PROMPT,
      });

      if (out.mode !== "short") throw new Error("Unexpected mode");

      const { result } = out;
      const qa = result.prosodyQa;
      const passes = checkPasses(qa);

      process.stdout.write(
        `${passes ? "✓ PASS" : "✗ FAIL"}  (rewrites=${result.rewriteCount}  sentences=${qa.sentenceCount}  avg=${qa.avgWordsPerSentence}w/s  max=${qa.maxSentenceWords}w)\n`,
      );

      results.push({
        index: i + 1,
        topic: tc.topic,
        sentenceCount: qa.sentenceCount,
        avgWordsPerSentence: qa.avgWordsPerSentence,
        maxSentenceWords: qa.maxSentenceWords,
        totalCommas: qa.totalCommas,
        multiCommaSentences: qa.multiCommaWarnings.length,
        prosodyWarnings: qa.prosodyWarnings,
        passes,
        rewriteCount: result.rewriteCount,
        script: result.script,
      });
    } catch (err) {
      process.stdout.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
      results.push({
        index: i + 1,
        topic: tc.topic,
        sentenceCount: 0,
        avgWordsPerSentence: 0,
        maxSentenceWords: 0,
        totalCommas: 0,
        multiCommaSentences: 0,
        prosodyWarnings: [`ERROR: ${err instanceof Error ? err.message : String(err)}`],
        passes: false,
        rewriteCount: 0,
        script: "",
      });
    }
  }

  // ─── REPORT ─────────────────────────────────────────────────────────────────

  const passed = results.filter((r) => r.passes);
  const failed = results.filter((r) => !r.passes);
  const avgSentences = results.reduce((a, r) => a + r.sentenceCount, 0) / results.length;
  const avgAvgWords = results.reduce((a, r) => a + r.avgWordsPerSentence, 0) / results.length;
  const avgMaxWords = results.reduce((a, r) => a + r.maxSentenceWords, 0) / results.length;
  const avgTotalCommas = results.reduce((a, r) => a + r.totalCommas, 0) / results.length;
  const totalWarnings = results.reduce((a, r) => a + r.prosodyWarnings.length, 0);

  console.log();
  console.log("═".repeat(70));
  console.log("## Prosody Smoke Test Summary");
  console.log("═".repeat(70));
  console.log();
  console.log(`  Scripts generated : ${results.length}`);
  console.log(`  PASS              : ${passed.length}/${results.length} (${Math.round((passed.length / results.length) * 100)}%)`);
  console.log(`  FAIL              : ${failed.length}/${results.length}`);
  console.log(`  Total warnings    : ${totalWarnings}`);
  console.log();
  console.log("  Aggregate metrics (avg across all scripts):");
  console.log(`    Sentence count      : ${avgSentences.toFixed(1)}  (target ≥5)`);
  console.log(`    Avg words/sentence  : ${avgAvgWords.toFixed(1)}  (target ≤15)  ${bar(avgAvgWords, 20)}`);
  console.log(`    Avg max word/sent   : ${avgMaxWords.toFixed(1)}  (target ≤18)  ${bar(avgMaxWords, 25)}`);
  console.log(`    Avg total commas    : ${avgTotalCommas.toFixed(1)}`);
  console.log();

  // ─── Per-script QA table ────────────────────────────────────────────────────

  console.log("═".repeat(70));
  console.log("## Per-script QA Table");
  console.log("═".repeat(70));
  console.log();

  const col = (s: string | number, w: number) => String(s).padEnd(w);
  const hdr = [
    col("#",    3),
    col("Topic",                  28),
    col("Sent", 5),
    col("Avg",  6),
    col("Max",  5),
    col("Cmma", 5),
    col(">1,",  4),
    col("Rew",  4),
    col("Warn", 5),
    col("Pass", 5),
  ].join(" ");
  console.log("  " + hdr);
  console.log("  " + "─".repeat(hdr.length));

  for (const r of results) {
    const row = [
      col(r.index,                    3),
      col(truncate(r.topic, 27),     28),
      col(r.sentenceCount,            5),
      col(r.avgWordsPerSentence,      6),
      col(r.maxSentenceWords,         5),
      col(r.totalCommas,              5),
      col(r.multiCommaSentences,      4),
      col(r.rewriteCount,             4),
      col(r.prosodyWarnings.length,   5),
      col(r.passes ? "✓" : "✗",     5),
    ].join(" ");
    console.log("  " + row);
  }

  console.log();
  console.log("  Columns: # Topic Sentences AvgW/S MaxW Commas >1comma Rewrites Warnings Pass");

  // ─── Worst vs. best ─────────────────────────────────────────────────────────

  const bestByAvg = [...results].sort((a, b) => a.avgWordsPerSentence - b.avgWordsPerSentence)[0];
  const worstByAvg = [...results].sort((a, b) => b.avgWordsPerSentence - a.avgWordsPerSentence)[0];

  console.log();
  console.log("═".repeat(70));
  console.log("## Example Good Script");
  console.log("═".repeat(70));
  if (bestByAvg) {
    console.log();
    console.log(`  Topic    : ${bestByAvg.topic}`);
    console.log(`  Sentences: ${bestByAvg.sentenceCount}  Avg: ${bestByAvg.avgWordsPerSentence}w/s  Max: ${bestByAvg.maxSentenceWords}w  Commas: ${bestByAvg.totalCommas}  Pass: ${bestByAvg.passes ? "✓" : "✗"}`);
    console.log();
    const lines = bestByAvg.script.split("\n").filter(Boolean);
    for (const line of lines) {
      console.log(`  ${line}`);
    }
  }

  console.log();
  console.log("═".repeat(70));
  if (failed.length > 0) {
    const worstFail = failed.sort((a, b) => b.prosodyWarnings.length - a.prosodyWarnings.length)[0];
    console.log("## Example Failed Script");
    console.log("═".repeat(70));
    if (worstFail) {
      console.log();
      console.log(`  Topic    : ${worstFail.topic}`);
      console.log(`  Sentences: ${worstFail.sentenceCount}  Avg: ${worstFail.avgWordsPerSentence}w/s  Max: ${worstFail.maxSentenceWords}w  Commas: ${worstFail.totalCommas}  Pass: ✗`);
      console.log(`  Warnings:`);
      for (const w of worstFail.prosodyWarnings) {
        console.log(`    - ${w}`);
      }
      console.log();
      const lines = worstFail.script.split("\n").filter(Boolean);
      for (const line of lines) {
        console.log(`  ${line}`);
      }
    }
  } else {
    console.log("## Example Failed Script");
    console.log("═".repeat(70));
    console.log();
    console.log("  (none — all scripts passed prosody criteria)");
    if (worstByAvg) {
      console.log();
      console.log(`  Closest to failing — Topic: ${worstByAvg.topic}`);
      console.log(`  Sentences: ${worstByAvg.sentenceCount}  Avg: ${worstByAvg.avgWordsPerSentence}w/s  Max: ${worstByAvg.maxSentenceWords}w  Warnings: ${worstByAvg.prosodyWarnings.length}`);
    }
  }

  // ─── Recommendation ─────────────────────────────────────────────────────────

  console.log();
  console.log("═".repeat(70));
  console.log("## Recommendation");
  console.log("═".repeat(70));
  console.log();

  const passRate = passed.length / results.length;
  const avgWarn = totalWarnings / results.length;

  if (passRate >= 0.9) {
    console.log("  ✅ Rules are working. 90%+ scripts meet all prosody criteria.");
    console.log(`     avg=${avgAvgWords.toFixed(1)}w/s  max=${avgMaxWords.toFixed(1)}w  avg_warnings=${avgWarn.toFixed(1)}/script`);
    console.log("     VieNeu TTS will have natural sentence-boundary pauses.");
    console.log("     No further prompt changes needed at this time.");
  } else if (passRate >= 0.7) {
    console.log(`  ⚠️  ${Math.round(passRate * 100)}% pass rate — rules partially working.`);
    console.log("     Most common failure: " + (avgAvgWords > 15 ? "avg words/sentence too high" : "multi-comma sentences"));
    console.log("     Consider tightening the rule emphasis or adding a post-gen repair pass");
    console.log("     specifically targeting the failing metric.");
  } else {
    console.log(`  ❌ Only ${Math.round(passRate * 100)}% pass rate — rules may not be registering.`);
    console.log("     Check if prompt template is being applied for buddhism profile.");
    console.log("     Most scripts: avg=" + avgAvgWords.toFixed(1) + "w/s  max=" + avgMaxWords.toFixed(1) + "w");
  }

  console.log();
  console.log("═".repeat(70));
  console.log();

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
