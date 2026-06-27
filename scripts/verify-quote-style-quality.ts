import "dotenv/config";

import fs from "fs";
import path from "path";
import assert from "assert";
import { buildFallbackQuote, validateQuoteText } from "@/lib/quotes/quote-quality";
import { resolveQuoteShortFormat, resolveQuoteVisualStyle } from "@/lib/quotes/quote-style";

function ok(message: string) {
  console.log(`  PASS ${message}`);
}

function main() {
  const phatPhapStyle = resolveQuoteVisualStyle({
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
  });
  assert.equal(phatPhapStyle.style, "static_deep_quote");
  assert.equal(phatPhapStyle.kinetic, false);
  ok("phat_phap resolves to static_deep_quote and kinetic=false");

  const tangSauStyle = resolveQuoteVisualStyle({
    channelKey: "tang_sau",
    contentProfileKey: "psychology",
  });
  assert.equal(tangSauStyle.style, "static_deep_quote");
  assert.equal(tangSauStyle.kinetic, false);
  ok("tang_sau resolves to static_deep_quote and kinetic=false");

  const defaultStyle = resolveQuoteVisualStyle({
    channelKey: "healing_lab",
    contentProfileKey: "default",
  });
  assert.equal(defaultStyle.kinetic, true);
  ok("unrelated channel keeps default kinetic-capable behavior");

  const phatPhapQuote = buildFallbackQuote({
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
  }, "phat_phap");
  assert.equal(validateQuoteText(phatPhapQuote, {
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
  }).ok, true);
  ok("phat_phap fallback quote passes validation");

  const tangSauQuote = buildFallbackQuote({
    channelKey: "tang_sau",
    contentProfileKey: "psychology",
  }, "tang_sau");
  assert.equal(validateQuoteText(tangSauQuote, {
    channelKey: "tang_sau",
    contentProfileKey: "psychology",
  }).ok, true);
  ok("tang_sau fallback quote passes validation");

  const clicheFail = validateQuoteText("Tâm an vạn sự an, mọi chuyện rồi sẽ qua.", {
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
  });
  assert.equal(clicheFail.ok, false);
  ok("cliche quote fails validation");

  const listFail = validateQuoteText("1. Im lặng\n2. Buông bỏ\n3. Bình an", {
    channelKey: "tang_sau",
    contentProfileKey: "psychology",
  });
  assert.equal(listFail.ok, false);
  ok("list or multi-option output fails validation");

  const shortFail = validateQuoteText("Có lúc ta mệt.", {
    channelKey: "tang_sau",
    contentProfileKey: "psychology",
  });
  assert.equal(shortFail.ok, false);
  ok("length outside allowed range fails validation");

  const forcedFormat = resolveQuoteShortFormat({
    channelKey: "tang_sau",
    contentProfileKey: "psychology",
  }, "kinetic_text");
  assert.equal(forcedFormat, "quote_reflection");
  assert.equal(tangSauStyle.motionIntensity, "minimal");
  ok("static_deep_quote config removes kinetic format for protected channels");

  const helperPath = path.join(process.cwd(), "src/lib/quotes/quote-style.ts");
  const helperSource = fs.readFileSync(helperPath, "utf8");
  assert(!/upload_queue|processUploadQueueAction|repair-upload-queue-pileup|ensure-tang-sau-scheduler-jobs/.test(helperSource));
  ok("quote style helper is isolated from scheduler and upload queue logic");

  console.log("\nverify-quote-style-quality: PASS");
}

main();
