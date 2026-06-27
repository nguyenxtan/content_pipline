import assert from "assert";
import {
  AIMAX_DEFAULTS,
  AIMAX_TAG_ROUTE_FALLBACKS,
  type AiMaxRuntimeConfig,
  resolveAiMaxTaggedRoute,
} from "@/lib/aimax-settings";
import { getTangSauIsolationViolation } from "@/lib/content-profile-isolation";
import { aiMaxProvider } from "@/services/tts/providers/AiMaxProvider";
import {
  buildEffectiveTTSMetadata,
  getShortTtsProfileRoutingError,
} from "@/services/tts/TTSService";

function ok(message: string) {
  console.log(`  PASS ${message}`);
}

const TEST_CONFIG: AiMaxRuntimeConfig = {
  apiBaseUrl: "http://aimax.test",
  apiKey: "test",
  provider: AIMAX_DEFAULTS.provider,
  model: AIMAX_DEFAULTS.model,
  language: AIMAX_DEFAULTS.language,
  normalize: AIMAX_DEFAULTS.normalize,
  enableSrt: AIMAX_DEFAULTS.enableSrt,
  useChunking: AIMAX_DEFAULTS.useChunking,
  maxCharsPerJob: AIMAX_DEFAULTS.maxCharsPerJob,
  speed: 1.1,
  pitch: 2,
  volume: 1,
  defaultVoiceId: "hn_female_ngochuyen_full_24k-st",
  defaultStoryVoiceId: "hn_female_ngochuyen_full_24k-st",
  defaultPhatPhapVoiceId: "s_sg_male_thientam_ytstable_vc",
  defaultLongformVoiceId: null,
};

async function main() {
  const tangSauRoute = resolveAiMaxTaggedRoute(TEST_CONFIG, {
    contentType: "short",
    channelKey: "tang_sau",
    contentProfileKey: "philosophy",
    formatType: "tts_short",
  });
  assert.equal(tangSauRoute.routeKey, "tang_sau_short");
  assert.equal(tangSauRoute.recommendedUseCase, "tang_sau_short");
  assert.equal(tangSauRoute.providerId, "aimax");
  assert.equal(tangSauRoute.fallbackVoiceId, AIMAX_TAG_ROUTE_FALLBACKS.tangSauShort.voiceId);
  ok("tang_sau philosophy short resolves to tang_sau_short AiMax route");

  const tangSauMetadata = buildEffectiveTTSMetadata({
    provider: aiMaxProvider,
    voiceId: "hn_female_ngochuyen_full_24k-st",
    route: tangSauRoute,
    speed: 1.1,
    pitch: 2,
    recommendedUseCaseOverride: tangSauRoute.recommendedUseCase,
  });
  assert.equal(tangSauMetadata.ttsRecommendedUseCase, "tang_sau_short");
  assert.equal(tangSauMetadata.ttsRoute, "tang_sau_short");
  ok("tang_sau route stamps non-Buddhist tang_sau_short metadata even when reusing an existing AiMax voice");

  const missingRouteError = getShortTtsProfileRoutingError({
    channelKey: "tang_sau",
    behaviorProfileKey: "psychology",
    routeKey: "tang_sau_short",
    preferredVoiceCandidateCount: 0,
    selectedVoiceId: null,
    selectedVoiceRecommendedUseCase: null,
    effectiveRecommendedUseCase: null,
  });
  assert.equal(missingRouteError, "tts_profile_route_missing");
  ok("tang_sau short route fails closed when no configured voice candidates exist");

  const mismatchError = getShortTtsProfileRoutingError({
    channelKey: "tang_sau",
    behaviorProfileKey: "psychology",
    routeKey: null,
    preferredVoiceCandidateCount: 1,
    selectedVoiceId: "s_sg_male_thientam_ytstable_vc",
    selectedVoiceRecommendedUseCase: "phat_phap_short",
    effectiveRecommendedUseCase: "phat_phap_short",
  });
  assert.equal(mismatchError, "tts_profile_mismatch");
  ok("tang_sau short route rejects Buddhist voice/use-case lineage");

  const tangSauGuard = getTangSauIsolationViolation({
    channelKey: "tang_sau",
    nicheId: 14,
    contentProfileKey: "philosophy",
    formatType: "tts_short",
    title: "Sợ đánh mất mình",
    promptVersions: {
      tts: {
        details: {
          ttsRecommendedUseCase: "phat_phap_short",
          ttsRoute: "phat_phap_short",
        },
      },
    },
  });
  assert.equal(tangSauGuard?.code, "prompt_profile_mismatch");
  ok("tang_sau guard rejects phat_phap short TTS metadata");

  const phatPhapRoute = resolveAiMaxTaggedRoute(TEST_CONFIG, {
    contentType: "short",
    channelKey: "phat_phap",
    contentProfileKey: "buddhism",
    formatType: "tts_short",
  });
  assert.equal(phatPhapRoute.routeKey, "phat_phap_short");
  assert.equal(phatPhapRoute.recommendedUseCase, "phat_phap_short");
  ok("phat_phap short route still resolves to phat_phap_short");

  const phatPhapMetadata = buildEffectiveTTSMetadata({
    provider: aiMaxProvider,
    voiceId: "s_sg_male_thientam_ytstable_vc",
    route: phatPhapRoute,
    speed: null,
    pitch: null,
    recommendedUseCaseOverride: phatPhapRoute.recommendedUseCase,
  });
  assert.equal(phatPhapMetadata.ttsRecommendedUseCase, "phat_phap_short");
  ok("phat_phap short metadata remains unchanged");

  const neutralError = getShortTtsProfileRoutingError({
    channelKey: "phat_phap",
    behaviorProfileKey: "buddhism",
    routeKey: "phat_phap_short",
    preferredVoiceCandidateCount: 1,
    selectedVoiceId: "s_sg_male_thientam_ytstable_vc",
    selectedVoiceRecommendedUseCase: "phat_phap_short",
    effectiveRecommendedUseCase: "phat_phap_short",
  });
  assert.equal(neutralError, null);
  ok("phat_phap Buddhist route is not blocked by tang_sau protection");

  console.log("\nverify-tts-profile-routing: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
