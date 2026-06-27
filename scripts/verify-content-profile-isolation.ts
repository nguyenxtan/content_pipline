import assert from "assert";
import { getContentProfile } from "@/lib/config/content-profiles";
import {
  classifyTangSauSemanticProfile,
  getTangSauIsolationViolation,
} from "@/lib/content-profile-isolation";

function ok(message: string) {
  console.log(`  PASS ${message}`);
}

async function main() {
  assert.equal(getContentProfile("philosophy").key, "psychology");
  ok("philosophy maps to psychology behavior rules without changing the stored profile key");

  const promptMismatch = getTangSauIsolationViolation({
    channelKey: "tang_sau",
    nicheId: 14,
    contentProfileKey: "philosophy",
    formatType: "legacy_quote_short",
    title: "Có những ngày rất dài",
    promptVersions: {
      tts: { details: { ttsRecommendedUseCase: "phat_phap_short" } },
      script: { source: "buddhist_healing_v1" },
    },
  });
  assert.equal(promptMismatch?.code, "prompt_profile_mismatch");
  ok("tang_sau guard rejects phat_phap prompt identifiers");

  const routeMismatch = getTangSauIsolationViolation({
    channelKey: "tang_sau",
    nicheId: 14,
    contentProfileKey: "philosophy",
    formatType: "tts_short",
    title: "Sợ đánh mất mình",
    promptVersions: {
      tts: { details: { ttsRoute: "phat_phap_short" } },
    },
  });
  assert.equal(routeMismatch?.code, "prompt_profile_mismatch");
  ok("tang_sau guard rejects phat_phap tts route identifiers");

  const semanticMismatch = getTangSauIsolationViolation({
    channelKey: "tang_sau",
    nicheId: 14,
    contentProfileKey: "philosophy",
    formatType: "tts_short",
    title: "Sợ mất kiểm soát",
    shortContent: "Quý vị càng cố buông bỏ, lòng càng học được nhân quả và bình an trong tâm.",
  });
  assert.equal(semanticMismatch?.code, "semantic_profile_mismatch");
  ok("tang_sau guard rejects strong Buddhist-only vocabulary");

  const cleanTangSau = getTangSauIsolationViolation({
    channelKey: "tang_sau",
    nicheId: 14,
    contentProfileKey: "philosophy",
    formatType: "legacy_quote_short",
    title: "Có những ngày rất dài",
    shortContent: "Có những người không rời đi, họ chỉ im lặng dần khi biết nói thêm nữa cũng không làm mình được hiểu hơn.",
  });
  assert.equal(cleanTangSau, null);
  ok("clean tang_sau copy passes the isolation guard");

  const classification = classifyTangSauSemanticProfile({
    channelKey: "tang_sau",
    nicheId: 14,
    contentProfileKey: "philosophy",
    formatType: "tts_short",
    title: "Sợ mất kiểm soát",
    shortContent: "Quý vị càng cố buông bỏ, lòng càng học được nhân quả và bình an trong tâm.",
    promptVersions: {
      tts: { details: { ttsRecommendedUseCase: "phat_phap_short" } },
    },
    topicFamily: "buong_bo_chua_lanh",
  });
  assert.equal(classification.classification, "D_mixed_or_contaminated");
  ok("semantic classifier flags mixed tang_sau/phat_phap contamination");

  console.log("\nverify-content-profile-isolation: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
