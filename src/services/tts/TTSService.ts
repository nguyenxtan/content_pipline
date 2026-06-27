import {
  AIMAX_TAG_ROUTE_FALLBACKS,
  getAiMaxRuntimeConfig,
  resolveAiMaxTaggedRoute,
  type AiMaxRouteContext,
  type AiMaxRouteResolution,
} from "@/lib/aimax-settings";
import { getAiMaxVoiceMetadata } from "@/lib/aimax-voice-metadata";
import {
  getTTSProvider,
  resolveVoiceForProvider,
} from "@/lib/pipeline/tts-providers/registry";
import type { TTSProvider, TTSProviderVoice } from "@/lib/pipeline/tts-providers/types";

export type PipelineTTSContentType = "short" | "long";

export function getConfiguredTTSProviderId(contentType: PipelineTTSContentType): string {
  if (contentType === "long") {
    return process.env.LONGFORM_TTS_PROVIDER ?? process.env.TTS_PROVIDER ?? "aimax";
  }
  return process.env.TTS_PROVIDER ?? "aimax";
}

export async function getConfiguredTTSProvider(contentType: PipelineTTSContentType): Promise<TTSProvider> {
  return getTTSProvider(getConfiguredTTSProviderId(contentType));
}

export type ResolvedPipelineTTSConfig = {
  provider: TTSProvider;
  providerId: string;
  preferredVoiceCandidates: string[];
  route: AiMaxRouteResolution | null;
  speed: number | null;
  pitch: number | null;
  volume: number | null;
  normalize: boolean | null;
  model: string | null;
  language: string | null;
  settingsSource: AiMaxRouteResolution["settingsSource"];
};

export type EffectiveTTSMetadata = {
  ttsProvider: string;
  ttsProviderEngine: string;
  ttsProviderModel: string | null;
  ttsVoiceId: string;
  ttsVoiceLabel: string;
  ttsVoiceFamily: string;
  ttsSpeakerName: string | null;
  ttsGender: string | null;
  ttsAccent: string | null;
  ttsLocaleLabel: string | null;
  ttsQuality: string | null;
  ttsRecommendedUseCase: string | null;
  ttsRoute: string | null;
  ttsEffectiveSpeed: number | null;
  ttsEffectivePitch: number | null;
  ttsEffectiveVolume: number | null;
  ttsEffectiveNormalize: boolean | null;
  ttsEffectiveLanguage: string | null;
  ttsSettingsSource: AiMaxRouteResolution["settingsSource"] | null;
  ttsCacheIdentity: string | null;
};

export function getShortTtsProfileRoutingError(input: {
  channelKey: string | null | undefined;
  behaviorProfileKey: string | null | undefined;
  routeKey: string | null | undefined;
  preferredVoiceCandidateCount: number;
  selectedVoiceId: string | null | undefined;
  selectedVoiceRecommendedUseCase: string | null | undefined;
  effectiveRecommendedUseCase: string | null | undefined;
}): "tts_profile_route_missing" | "tts_profile_mismatch" | null {
  const isTangSauBehavior = input.channelKey === "tang_sau" || input.behaviorProfileKey === "psychology";
  if (!isTangSauBehavior) return null;

  if (input.routeKey === "tang_sau_short" && input.preferredVoiceCandidateCount <= 0) {
    return "tts_profile_route_missing";
  }

  if (
    input.routeKey === "phat_phap_short" ||
    input.selectedVoiceRecommendedUseCase === "phat_phap_short" ||
    input.effectiveRecommendedUseCase === "phat_phap_short"
  ) {
    return "tts_profile_mismatch";
  }

  return null;
}

export async function resolvePipelineTTSConfig(
  contentType: PipelineTTSContentType,
  context: AiMaxRouteContext,
  options?: {
    voiceOverride?: string | null;
    itemVoice?: string | null;
    nicheVoice?: string | null;
  },
): Promise<ResolvedPipelineTTSConfig> {
  const aiMaxConfig = await getAiMaxRuntimeConfig();
  const route = resolveAiMaxTaggedRoute(aiMaxConfig, context);
  const providerId = route.providerId ?? getConfiguredTTSProviderId(contentType);
  const provider = await getTTSProvider(providerId);

  if (provider.providerId === "aimax" && route.routeKey) {
    const preferredVoiceCandidates = [
      options?.voiceOverride ?? null,
      route.preferredVoiceId,
      route.fallbackVoiceId,
      options?.itemVoice ?? null,
      context.contentType === "short" && context.channelKey === "phat_phap"
        ? AIMAX_TAG_ROUTE_FALLBACKS.phatPhapShort.voiceId
        : null,
      route.routeKey === "audio_story"
        ? AIMAX_TAG_ROUTE_FALLBACKS.audioStory.voiceId
        : null,
      options?.nicheVoice ?? null,
    ].filter((value): value is string => Boolean(value));

    return {
      provider,
      providerId,
      preferredVoiceCandidates,
      route,
      speed: route.speed,
      pitch: route.pitch,
      volume: route.volume,
      normalize: route.normalize,
      model: route.model,
      language: route.language,
      settingsSource: route.settingsSource,
    };
  }

  return {
    provider,
    providerId,
    preferredVoiceCandidates: [
      options?.itemVoice ?? null,
      options?.voiceOverride ?? null,
      options?.nicheVoice ?? null,
    ].filter((value): value is string => Boolean(value)),
    route: route.routeKey ? route : null,
    speed: null,
    pitch: null,
    volume: null,
    normalize: null,
    model: null,
    language: null,
    settingsSource: route.settingsSource,
  };
}

export async function resolveConfiguredTTSVoice(
  provider: TTSProvider,
  preferredVoiceId: string | string[] | null | undefined,
): Promise<TTSProviderVoice> {
  return resolveVoiceForProvider(provider, preferredVoiceId);
}

export function buildEffectiveTTSMetadata(params: {
  provider: TTSProvider;
  voiceId: string;
  route: AiMaxRouteResolution | null;
  speed: number | null;
  pitch: number | null;
  volume: number | null;
  normalize: boolean | null;
  model?: string | null;
  language?: string | null;
  cacheIdentity?: string | null;
  recommendedUseCaseOverride?: string | null;
  settingsSource?: AiMaxRouteResolution["settingsSource"] | null;
}): EffectiveTTSMetadata {
  if (params.provider.providerId === "aimax") {
    const voiceMetadata = getAiMaxVoiceMetadata(params.voiceId);
    return {
      ttsProvider: "aimax",
      ttsProviderEngine: params.provider.engine,
      ttsProviderModel: params.model ?? params.provider.model ?? null,
      ttsVoiceId: params.voiceId,
      ttsVoiceLabel: voiceMetadata.displayLabel,
      ttsVoiceFamily: voiceMetadata.voiceFamily,
      ttsSpeakerName: voiceMetadata.speakerName,
      ttsGender: voiceMetadata.gender,
      ttsAccent: voiceMetadata.accent,
      ttsLocaleLabel: voiceMetadata.localeLabel,
      ttsQuality: voiceMetadata.quality,
      ttsRecommendedUseCase: params.recommendedUseCaseOverride ?? voiceMetadata.recommendedUseCase,
      ttsRoute: params.route?.routeKey ?? null,
      ttsEffectiveSpeed: params.speed,
      ttsEffectivePitch: params.pitch,
      ttsEffectiveVolume: params.volume,
      ttsEffectiveNormalize: params.normalize,
      ttsEffectiveLanguage: params.language ?? null,
      ttsSettingsSource: params.settingsSource ?? null,
      ttsCacheIdentity: params.cacheIdentity ?? null,
    };
  }

  return {
    ttsProvider: params.provider.providerId,
    ttsProviderEngine: params.provider.engine,
    ttsProviderModel: params.provider.model ?? null,
    ttsVoiceId: params.voiceId,
    ttsVoiceLabel: params.voiceId,
    ttsVoiceFamily: "unknown",
    ttsSpeakerName: params.voiceId,
    ttsGender: null,
    ttsAccent: null,
    ttsLocaleLabel: null,
    ttsQuality: null,
    ttsRecommendedUseCase: null,
    ttsRoute: params.route?.routeKey ?? null,
    ttsEffectiveSpeed: params.speed,
    ttsEffectivePitch: params.pitch,
    ttsEffectiveVolume: params.volume,
    ttsEffectiveNormalize: params.normalize,
    ttsEffectiveLanguage: params.language ?? null,
    ttsSettingsSource: params.settingsSource ?? null,
    ttsCacheIdentity: params.cacheIdentity ?? null,
  };
}
