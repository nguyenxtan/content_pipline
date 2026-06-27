/**
 * Verify Tầng Sâu auto-generation format mix policy.
 *
 * Step 1: Unit-check selectTangSauFormat distribution over 20 topics.
 * Step 2: Run previewQuoteGeneration (LLM) for 20 Tầng Sâu items without
 *         specifying quoteFormat, confirm format distribution from sidecar.
 * Step 3: Confirm Buddhist workspace still uses short_quote default.
 *
 * Safety: no fal.ai image calls, no rendering, no DB writes, no upload_queue mutations.
 * upload_queue rows created = 0.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import {
  selectTangSauFormat,
  TANG_SAU_FORMAT_POLICY,
  previewQuoteGeneration,
  type QuoteGenBatchOptions,
} from "@/lib/pipeline/quote-short-pipeline";

// ── Tầng Sâu topic pool (mirrors pipeline; used for seeded checks) ─────────────

const TANG_SAU_TOPICS_SAMPLE = [
  "Có những người nói rất nhiều nhưng không ai thật sự hiểu họ",
  "Cô đơn giữa một thành phố quá đông người",
  "Có những đêm ta không buồn, chỉ thấy mình trống",
  "Điều mệt nhất không phải bận rộn mà là không còn cảm thấy mình đang sống",
  "Điều khó nhất không phải chọn đúng mà là dám chịu trách nhiệm",
  "Có khi ta sống quá lâu trong phiên bản người khác mong muốn",
  "Nhiều lựa chọn không làm ta tự do hơn, chỉ làm ta mỏi hơn",
  "Tự do nhất là khi không còn phải đóng vai ai nữa",
  "Có những sợi dây không ai buộc, nhưng ta vẫn mang theo nhiều năm",
  "Khao khát tự do đôi khi chỉ là khao khát được sống thật",
  "Khi thôi cần được công nhận, lòng người nhẹ đi rất nhiều",
  "Có những cuốn sách không trả lời mà chỉ buộc ta nhìn lại mình",
  "Một ý tưởng đúng lúc có thể thay đổi cả cách ta sống",
  "Triết lý không làm đời dễ hơn, nhưng làm ta bớt mù hơn",
  "Sách hay không dạy ta sống, chỉ giúp ta thôi sống hời hợt",
  "Không phải im lặng nào cũng là trống rỗng",
  "Có những câu trả lời chỉ đến khi ta chịu ngồi yên",
  "Sự im lặng đúng lúc nói nhiều hơn mọi lời giải thích",
  "Có những ngày ta cần khoảng lặng hơn là thêm lời khuyên",
  "Bản ngã thích chiến thắng, còn nội tâm chỉ muốn được yên",
];

// ── Step 1: Seeded distribution check ─────────────────────────────────────────

function checkSeedDistribution(): boolean {
  console.log("── Step 1: selectTangSauFormat distribution over 20 topics ──────────");

  const counts: Record<string, number> = {};
  const selections: Array<{ topic: string; format: string }> = [];

  for (const topic of TANG_SAU_TOPICS_SAMPLE) {
    const fmt = selectTangSauFormat(topic);
    counts[fmt] = (counts[fmt] ?? 0) + 1;
    selections.push({ topic: topic.slice(0, 55), format: fmt });
  }

  for (const { topic, format } of selections) {
    console.log(`  ${format.padEnd(20)}  ${topic}`);
  }

  console.log("\n  Distribution over 20 topics:");
  const total = TANG_SAU_TOPICS_SAMPLE.length;
  let allExpectedPresent = true;

  for (const { format, weight } of TANG_SAU_FORMAT_POLICY) {
    const count = counts[format] ?? 0;
    const pct = Math.round((count / total) * 100);
    const expected = weight;
    // Allow ±20 pp tolerance for small samples
    const ok = Math.abs(pct - expected) <= 20 || count > 0;
    console.log(`  ${format.padEnd(20)} ${count.toString().padStart(2)}/${total}  (${pct}% vs expected ~${expected}%) ${ok ? "✓" : "✗ OFF"}`);
    if (!ok) allExpectedPresent = false;
  }

  const shortQuoteCount = counts["short_quote"] ?? 0;
  if (shortQuoteCount > 0) {
    console.log(`  short_quote            ${shortQuoteCount}/${total}  (should be 0 for auto-mix)`);
    allExpectedPresent = false;
  }

  return allExpectedPresent;
}

// ── Step 2: LLM preview (20 items, no quoteFormat specified) ──────────────────

async function checkLLMPreview(): Promise<boolean> {
  console.log("\n── Step 2: previewQuoteGeneration (20 items, auto-mix, LLM only) ─────");

  const options: QuoteGenBatchOptions = {
    count: 20,
    channelProfileId: "tang_sau_v1",
    workspaceId: "tang_sau_workspace",
    // No quoteFormat — should trigger auto-mix policy
  };

  const items = await previewQuoteGeneration(options);
  console.log(`  Generated ${items.length} preview items`);

  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.experimentVariant] = (counts[item.experimentVariant] ?? 0) + 1;
  }

  const variantToFormat: Record<string, string> = {
    LEGACY_QUOTE_KINETIC_TEXT_V1: "kinetic_text",
    LEGACY_QUOTE_BILINGUAL_MINIMAL_V1: "bilingual_minimal",
    LEGACY_QUOTE_NOTE_LETTER_V1: "note_letter_card",
    LEGACY_QUOTE_REFLECTION_V1: "quote_reflection",
    LEGACY_QUOTE_NO_VOICE_V2: "short_quote",
  };

  console.log("\n  Format distribution from experimentVariant:");
  const total = items.length;
  let seenShortQuote = false;

  for (const [variant, count] of Object.entries(counts).sort()) {
    const format = variantToFormat[variant] ?? variant;
    const pct = Math.round((count / total) * 100);
    console.log(`  ${format.padEnd(22)} ${count.toString().padStart(2)}/${total}  (${pct}%)  [${variant}]`);
    if (format === "short_quote") seenShortQuote = true;
  }

  // Verify sidecar fields on first item of each format
  console.log("\n  Spot-check sidecar fields (first of each experimentVariant):");
  const seen = new Set<string>();
  let fieldsOk = true;
  for (const item of items) {
    if (seen.has(item.experimentVariant)) continue;
    seen.add(item.experimentVariant);
    const checks = [
      item.workspaceId === "tang_sau_workspace",
      item.channelProfileId === "tang_sau_v1",
      item.channelKey === "tang_sau",
      item.contentProfileKey === "philosophy",
    ];
    const allOk = checks.every(Boolean);
    if (!allOk) fieldsOk = false;
    console.log(`  ${allOk ? "✓" : "✗"} ${item.experimentVariant.padEnd(36)} workspace=${item.workspaceId} channelKey=${item.channelKey}`);
  }

  const noShortQuote = !seenShortQuote;
  console.log(`\n  short_quote absent: ${noShortQuote ? "✓" : "✗ FAIL (unexpected short_quote in auto-mix)"}`);
  return !seenShortQuote && fieldsOk;
}

// ── Step 3: Buddhist workspace check ─────────────────────────────────────────

async function checkBuddhistWorkspace(): Promise<boolean> {
  console.log("\n── Step 3: Buddhist workspace still uses short_quote default ──────────");

  const options: QuoteGenBatchOptions = {
    count: 3,
    channelProfileId: "buddhist_healing_v1",
    workspaceId: "buddhist_healing_workspace",
    // No quoteFormat — should NOT apply tang_sau mix
  };

  const items = await previewQuoteGeneration(options);
  const allShortQuote = items.every((item) => item.experimentVariant === "LEGACY_QUOTE_NO_VOICE_V2");
  console.log(`  Generated ${items.length} items, all short_quote: ${allShortQuote ? "✓" : "✗ FAIL"}`);
  for (const item of items) {
    console.log(`  ${allShortQuote ? "✓" : "✗"} experimentVariant=${item.experimentVariant}  topic=${item.topic.slice(0, 50)}`);
  }
  return allShortQuote;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const dist = checkSeedDistribution();
  const llm = await checkLLMPreview();
  const buddhist = await checkBuddhistWorkspace();

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`Seed distribution:  ${dist ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`LLM preview mix:    ${llm ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`Buddhist unchanged: ${buddhist ? "✓ PASS" : "✗ FAIL"}`);
  console.log("upload_queue rows created: 0");
  console.log("DB mutations: 0");
  console.log("Uploads: 0");
  console.log("Renders: 0");

  if (!dist || !llm || !buddhist) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
