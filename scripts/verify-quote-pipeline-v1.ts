import "dotenv/config";

import assert from "assert";
import fs from "fs";
import { execFileSync } from "child_process";
import { resolveFacebookQuoteArtifact } from "@/lib/quotes/quote-pipeline";
import { resolveQuoteVisualStyle } from "@/lib/quotes/quote-style";
import { getChannelPublishConfig } from "@/lib/config/channel-configs";
import { getTangSauIsolationViolation } from "@/lib/content-profile-isolation";

function ok(message: string) {
  console.log(`  PASS ${message}`);
}

async function main() {
  const baseInput = {
    topic: "Tha thứ",
    shortContent:
      "Có những vết đau không lớn vì người khác làm quá nhiều, mà vì trong ta vẫn giữ mãi một điều chưa chịu lặng xuống để tự hiểu mình.",
    contentProfileKey: "buddhism",
    channelKey: "phat_phap",
    nicheName: "Phật Pháp",
    sourceContentId: "fixture-content-id",
    sourceFormatType: "tts_short",
  } as const;

  const independent = await resolveFacebookQuoteArtifact(baseInput, {
    generateIndependentQuote: async () => ({
      quoteText:
        "Khi thôi đòi người khác trả lại điều mình đã mất, lòng mới đủ yên để nhìn ra phần chấp giữ đang làm nỗi đau ở lại lâu hơn.",
      model: "openai/gpt-4o-mini",
      inputTokens: 12,
      outputTokens: 22,
    }),
  });
  assert.equal(independent.metadata.quoteSourceType, "independent_llm");
  assert.equal(independent.metadata.validationStatus, "passed");
  ok("phat_phap FB quote can resolve from independent LLM output");

  const extracted = await resolveFacebookQuoteArtifact(baseInput, {
    generateIndependentQuote: async () => {
      throw new Error("forced_llm_failure");
    },
  });
  assert.equal(extracted.metadata.quoteSourceType, "extracted_from_short");
  ok("fallback extraction works when LLM generation fails");

  const fallback = await resolveFacebookQuoteArtifact({
    ...baseInput,
    shortContent: "Quá ngắn.",
  }, {
    generateIndependentQuote: async () => {
      throw new Error("forced_llm_failure");
    },
  });
  assert.equal(fallback.metadata.quoteSourceType, "fallback");
  ok("final fallback works when extraction also fails");

  assert.equal(typeof fallback.metadata.quoteSourceType, "string");
  ok("quote metadata includes quoteSourceType");

  const style = resolveQuoteVisualStyle({
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
  });
  assert.equal(style.style, "static_deep_quote");
  ok("quoteStyle resolves to static_deep_quote");

  assert.equal(style.kinetic, false);
  ok("kinetic=false for protected quote channels");

  const tangSauPublishConfig = await getChannelPublishConfig("tang_sau");
  assert.equal((tangSauPublishConfig?.quoteDestinations ?? []).length, 0);
  ok("tang_sau Facebook quote/photo is not enabled without channel/config");

  const tangSauFallbackGuard = getTangSauIsolationViolation({
    channelKey: "tang_sau",
    nicheId: 14,
    contentProfileKey: "philosophy",
    formatType: "legacy_quote_short",
    title: "Nỗi sợ im lặng",
    shortContent: "Đức Phật dạy rằng nhân quả luôn đến khi ta còn chấp niệm.",
  });
  assert.equal(tangSauFallbackGuard?.code, "semantic_profile_mismatch");
  ok("tang_sau semantic guard rejects Buddhist-coded copy even when storage metadata matches");

  const quoteScriptSource = fs.readFileSync("scripts/audit-quote-pipeline.ts", "utf8");
  assert(/select/i.test(quoteScriptSource));
  assert(!/\bupdate\b|\binsert\b|\bdelete\b/i.test(quoteScriptSource));
  ok("audit script is read-only");

  const cronRouteSource = fs.readFileSync("src/app/api/cron/run/route.ts", "utf8");
  const slotOccupancySource = fs.readFileSync("src/lib/publishing/slot-occupancy.ts", "utf8");
  assert(!cronRouteSource.includes("quote-pipeline-v1"));
  assert(!slotOccupancySource.includes("quote-pipeline-v1"));
  ok("scheduler/slot-occupancy files remain isolated from Quote Pipeline V1");

  if (process.env.DATABASE_URL) {
    execFileSync(process.execPath, [
      "./node_modules/tsx/dist/cli.mjs",
      "--env-file=.env.local",
      "--tsconfig",
      "tsconfig.json",
      "scripts/audit-quote-pipeline.ts",
    ], {
      cwd: process.cwd(),
      stdio: "pipe",
      env: process.env,
    });
    ok("audit script can execute without DB writes");
  } else {
    console.log("  SKIP audit script execution (no DATABASE_URL)");
  }

  console.log("\nverify-quote-pipeline-v1: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
