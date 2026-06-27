import { elevenLabsProvider } from "@/lib/pipeline/tts-providers/elevenlabs-provider";
import { openaiTTSProvider } from "@/lib/pipeline/tts-providers/openai-provider";
import { macosSayProvider } from "@/lib/pipeline/tts-providers/macos-say-provider";
import { TTSProvider, TTSProviderVoice } from "@/lib/pipeline/tts-providers/types";
import { aiMaxProvider } from "@/services/tts/providers/AiMaxProvider";
import { vieneuProvider } from "@/lib/pipeline/tts-providers/vieneu-provider";

const PROVIDERS: TTSProvider[] = [
  vieneuProvider,
  aiMaxProvider,
  macosSayProvider,
  openaiTTSProvider,
  elevenLabsProvider,
];

function normalizeProviderId(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "vietneu") return "vieneu";
  if (normalized === "ai-max") return "aimax";
  return normalized;
}

export function listRegisteredTTSProviders(): TTSProvider[] {
  return [...PROVIDERS];
}

export async function listAvailableTTSProviders(): Promise<Array<TTSProvider & { availabilityReason?: string }>> {
  const results: Array<TTSProvider & { availabilityReason?: string }> = [];
  for (const provider of PROVIDERS) {
    const availability = await provider.checkAvailability();
    if (availability.available) {
      results.push(provider);
    } else {
      results.push({ ...provider, availabilityReason: availability.reason });
    }
  }
  return results;
}

export async function getTTSProvider(providerId: string): Promise<TTSProvider> {
  const normalizedId = normalizeProviderId(providerId);
  const provider = PROVIDERS.find((entry) => entry.providerId === normalizedId);
  if (!provider) {
    throw new Error(`Unknown TTS provider: ${providerId}`);
  }
  const availability = await provider.checkAvailability();
  if (!availability.available) {
    throw new Error(`TTS provider '${providerId}' unavailable: ${availability.reason ?? "unknown reason"}`);
  }
  return provider;
}

export async function resolveVoiceForProvider(
  provider: TTSProvider,
  preferredVoiceId: string | string[] | null | undefined,
): Promise<TTSProviderVoice> {
  const voices = await provider.listVoices();
  if (voices.length === 0) {
    throw new Error(`TTS provider '${provider.providerId}' returned 0 voices.`);
  }

  const preferredIds = Array.isArray(preferredVoiceId)
    ? preferredVoiceId.filter(Boolean)
    : preferredVoiceId
      ? [preferredVoiceId]
      : [];

  for (const preferredId of preferredIds) {
    const direct = voices.find((voice) => voice.id === preferredId);
    if (direct) return direct;
  }

  if (provider.defaultVoiceId) {
    const fallback = voices.find((voice) => voice.id === provider.defaultVoiceId);
    if (fallback) return fallback;
  }

  return voices[0];
}

export async function getPreferredLongformTTSProvider(): Promise<TTSProvider> {
  return getTTSProvider(process.env.LONGFORM_TTS_PROVIDER ?? process.env.TTS_PROVIDER ?? "aimax");
}
