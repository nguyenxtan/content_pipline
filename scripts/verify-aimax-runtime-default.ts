/**
 * verify-aimax-runtime-default.ts
 *
 * Confirms AiMax is the default TTS provider for all production pipeline paths
 * when no TTS_PROVIDER / LONGFORM_TTS_PROVIDER env override is supplied.
 *
 * Does NOT generate audio, touch the DB, or enqueue anything.
 *
 * Run:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/verify-aimax-runtime-default.ts
 */

import { getConfiguredTTSProviderId } from "@/services/tts/TTSService";
import { AIMAX_TAG_ROUTE_FALLBACKS, getAiMaxRuntimeConfig, resolveAiMaxTaggedRoute } from "@/lib/aimax-settings";

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function run() {
  console.log("\n" + "═".repeat(64));
  console.log("  VERIFY: AiMax runtime default — no env overrides");
  console.log("═".repeat(64));

  // ── 1. getConfiguredTTSProviderId defaults ─────────────────────────────────
  console.log("\n## 1 — getConfiguredTTSProviderId (no env override)");

  const shortDefault = withEnv({ TTS_PROVIDER: undefined, LONGFORM_TTS_PROVIDER: undefined }, () =>
    getConfiguredTTSProviderId("short"),
  );
  check("short content defaults to 'aimax'", shortDefault === "aimax", `got: ${shortDefault}`);

  const longDefault = withEnv({ TTS_PROVIDER: undefined, LONGFORM_TTS_PROVIDER: undefined }, () =>
    getConfiguredTTSProviderId("long"),
  );
  check("long content defaults to 'aimax'", longDefault === "aimax", `got: ${longDefault}`);

  // ── 2. Env override still works ────────────────────────────────────────────
  console.log("\n## 2 — Env override respected");

  const shortFromEnv = withEnv({ TTS_PROVIDER: "openai" }, () =>
    getConfiguredTTSProviderId("short"),
  );
  check("TTS_PROVIDER=openai override respected for short", shortFromEnv === "openai", `got: ${shortFromEnv}`);

  const longFromLongformEnv = withEnv({ LONGFORM_TTS_PROVIDER: "openai", TTS_PROVIDER: "aimax" }, () =>
    getConfiguredTTSProviderId("long"),
  );
  check("LONGFORM_TTS_PROVIDER takes precedence over TTS_PROVIDER for long", longFromLongformEnv === "openai", `got: ${longFromLongformEnv}`);

  // ── 3. Route resolution: phat_phap_short ──────────────────────────────────
  console.log("\n## 3 — phat_phap short route");
  const aiMaxConfig = await getAiMaxRuntimeConfig();

  const phatPhapRoute = resolveAiMaxTaggedRoute(aiMaxConfig, {
    contentType: "short",
    channelKey: "phat_phap",
    contentProfileKey: null,
    formatType: null,
    nicheTtsVoice: null,
  });
  check("phat_phap short → routeKey='phat_phap_short'", phatPhapRoute.routeKey === "phat_phap_short",
    `got: ${phatPhapRoute.routeKey}`);
  check("phat_phap short → providerId='aimax'", phatPhapRoute.providerId === "aimax",
    `got: ${phatPhapRoute.providerId}`);
  check("phat_phap short → fallback voiceId=Thiện Tâm",
    phatPhapRoute.fallbackVoiceId === AIMAX_TAG_ROUTE_FALLBACKS.phatPhapShort.voiceId,
    `got: ${phatPhapRoute.fallbackVoiceId}`);
  check("phat_phap short → speed=null (default)", phatPhapRoute.speed === null,
    `got: ${phatPhapRoute.speed}`);
  check("phat_phap short → pitch=null (default)", phatPhapRoute.pitch === null,
    `got: ${phatPhapRoute.pitch}`);

  // ── 4. Route resolution: audio_story ──────────────────────────────────────
  console.log("\n## 4 — audio_story route");
  const audioStoryRoute = resolveAiMaxTaggedRoute(aiMaxConfig, {
    contentType: "long",
    channelKey: null,
    contentProfileKey: "audio_story",
    formatType: "audio_story",
    nicheTtsVoice: null,
  });
  check("audio_story → routeKey='audio_story'", audioStoryRoute.routeKey === "audio_story",
    `got: ${audioStoryRoute.routeKey}`);
  check("audio_story → providerId='aimax'", audioStoryRoute.providerId === "aimax",
    `got: ${audioStoryRoute.providerId}`);
  check("audio_story → fallback voiceId='hn_female_ngochuyen_full_48k-fhg'",
    audioStoryRoute.fallbackVoiceId === "hn_female_ngochuyen_full_48k-fhg",
    `got: ${audioStoryRoute.fallbackVoiceId}`);
  check("audio_story → speed=1.05", audioStoryRoute.speed === 1.05,
    `got: ${audioStoryRoute.speed}`);
  check("audio_story → pitch=2", audioStoryRoute.pitch === 2,
    `got: ${audioStoryRoute.pitch}`);

  // ── 5. Vieneu is no longer the hardcoded default ──────────────────────────
  console.log("\n## 5 — VieNeu is not the default");
  const noVieneuShort = withEnv({ TTS_PROVIDER: undefined }, () => getConfiguredTTSProviderId("short"));
  check("short without TTS_PROVIDER does NOT select 'vieneu'", noVieneuShort !== "vieneu",
    `got: ${noVieneuShort}`);

  const noVieneuLong = withEnv({ TTS_PROVIDER: undefined, LONGFORM_TTS_PROVIDER: undefined }, () =>
    getConfiguredTTSProviderId("long"),
  );
  check("long without env vars does NOT select 'vieneu'", noVieneuLong !== "vieneu",
    `got: ${noVieneuLong}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(64));
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) {
    console.error(`\n  ✗ ${failed} check(s) FAILED`);
    console.log("═".repeat(64) + "\n");
    process.exit(1);
  } else {
    console.log(`\n  ✓ All ${passed} checks passed`);
    console.log("═".repeat(64) + "\n");
  }
}

run().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
