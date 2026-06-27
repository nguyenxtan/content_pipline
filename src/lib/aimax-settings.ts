import fs from "fs";
import path from "path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { appConfig, ttsVoices } from "@/lib/db/schema";
import {
  getAiMaxVoiceMetadata,
  type AiMaxVoiceRecommendedUseCase,
} from "@/lib/aimax-voice-metadata";

export const AIMAX_CONFIG_KEYS = {
  apiBaseUrl: "aimax.api_base_url",
  apiKey: "aimax.api_key",
  provider: "aimax.provider",
  model: "aimax.model",
  language: "aimax.language",
  normalize: "aimax.normalize",
  enableSrt: "aimax.enable_srt",
  useChunking: "aimax.use_chunking",
  maxCharsPerJob: "aimax.max_chars_per_job",
  speed: "aimax.speed",
  pitch: "aimax.pitch",
  volume: "aimax.volume",
  phatPhapSpeed: "aimax.phat_phap.speed",
  phatPhapPitch: "aimax.phat_phap.pitch",
  phatPhapVolume: "aimax.phat_phap.volume",
  phatPhapNormalize: "aimax.phat_phap.normalize",
  defaultVoiceId: "aimax.default_voice_id",
  defaultStoryVoiceId: "aimax.default_story_voice_id",
  defaultPhatPhapVoiceId: "aimax.default_phat_phap_voice_id",
  defaultLongformVoiceId: "aimax.default_longform_voice_id",
  balanceLastValue: "aimax.balance_last_value",
  balanceLastCheckedAt: "aimax.balance_last_checked_at",
} as const;

export const AIMAX_DEFAULTS = {
  provider: "minimax",
  model: "speech-2.8-hd",
  language: "Vietnamese",
  normalize: true,
  enableSrt: true,
  useChunking: false,
  maxCharsPerJob: 500_000,
  speed: 1,
  pitch: 0,
  volume: 1,
  phatPhapSpeed: 1,
  phatPhapPitch: 0,
  phatPhapVolume: 1,
  phatPhapNormalize: true,
} as const;

export const AIMAX_TAG_ROUTE_FALLBACKS = {
  phatPhapShort: {
    providerId: "aimax",
    voiceId: "s_sg_male_thientam_ytstable_vc",
  },
  tangSauShort: {
    providerId: "aimax",
    voiceId: "hn_female_ngochuyen_full_24k-st",
  },
  audioStory: {
    providerId: "aimax",
    voiceId: "hn_female_ngochuyen_full_24k-st",
    speed: 1.1,
    pitch: 2,
  },
} as const;

const ALL_AIMAX_CONFIG_KEYS = Object.values(AIMAX_CONFIG_KEYS);

export type AiMaxRuntimeConfig = {
  apiBaseUrl: string;
  apiKey: string;
  provider: string;
  model: string;
  language: string;
  normalize: boolean;
  enableSrt: boolean;
  useChunking: boolean;
  maxCharsPerJob: number;
  speed: number;
  pitch: number;
  volume: number;
  phatPhapSpeed: number;
  phatPhapPitch: number;
  phatPhapVolume: number;
  phatPhapNormalize: boolean;
  defaultVoiceId: string | null;
  defaultStoryVoiceId: string | null;
  defaultPhatPhapVoiceId: string | null;
  defaultLongformVoiceId: string | null;
  sources: {
    provider: "db/admin" | "env" | "default";
    model: "db/admin" | "env" | "default";
    language: "db/admin" | "env" | "default";
    normalize: "db/admin" | "env" | "default";
    enableSrt: "db/admin" | "env" | "default";
    useChunking: "db/admin" | "env" | "default";
    maxCharsPerJob: "db/admin" | "env" | "default";
    speed: "db/admin" | "env" | "default";
    pitch: "db/admin" | "env" | "default";
    volume: "db/admin" | "env" | "default";
    phatPhapSpeed: "db/admin" | "default";
    phatPhapPitch: "db/admin" | "default";
    phatPhapVolume: "db/admin" | "default";
    phatPhapNormalize: "db/admin" | "default";
    defaultVoiceId: "db/admin" | "env" | "default";
    defaultStoryVoiceId: "db/admin" | "default";
    defaultPhatPhapVoiceId: "db/admin" | "default";
    defaultLongformVoiceId: "db/admin" | "default";
  };
};

export type AiMaxRouteContext = {
  contentType: "short" | "long";
  channelKey?: string | null;
  contentProfileKey?: string | null;
  formatType?: string | null;
  nicheTtsVoice?: string | null;
};

export type AiMaxRouteResolution = {
  routeKey: "phat_phap_short" | "tang_sau_short" | "audio_story" | null;
  providerId: "aimax" | null;
  preferredVoiceId: string | null;
  fallbackVoiceId: string | null;
  speed: number | null;
  pitch: number | null;
  volume: number | null;
  normalize: boolean | null;
  model: string | null;
  language: string | null;
  recommendedUseCase: AiMaxVoiceRecommendedUseCase | null;
  settingsSource: {
    voice: "db/admin" | "env" | "default";
    speed: "db/admin" | "env" | "default";
    pitch: "db/admin" | "env" | "default";
    volume: "db/admin" | "env" | "default";
    normalize: "db/admin" | "env" | "default";
    model: "db/admin" | "env" | "default";
    language: "db/admin" | "env" | "default";
  } | null;
};

export type AiMaxSettingsSnapshot = AiMaxRuntimeConfig & {
  hasApiKey: boolean;
  maskedApiKey: string | null;
  balanceLastValue: number | null;
  balanceLastCheckedAt: string | null;
};

export type AiMaxVoiceRowLike = {
  id?: string | null;
  voiceId?: string | null;
  name?: string | null;
  gender?: string | null;
  age?: string | null;
  language?: string | null;
  category?: string | null;
  useCase?: string | null;
  rawJson?: unknown;
};

export type AiMaxEnrichedVoiceRow = {
  displayLabel: string;
  speakerName: string | null;
  accent: string | null;
  localeLabel: string | null;
  quality: string | null;
  voiceFamily: string;
  recommendedUseCase: AiMaxVoiceRecommendedUseCase | null;
  provider: "aimax";
  defaultSpeed: number | null;
  defaultPitch: number | null;
};

type AppConfigMap = Record<string, string | null>;
const AIMAX_VOICE_CACHE_PATH = path.join(process.cwd(), "media", "cache", "tts", "aimax-voices.json");

export function isMissingTtsVoicesSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const record = error as {
    message?: string;
    cause?: { code?: string; message?: string } | null;
  };

  const message = String(record.message ?? "");
  const causeMessage = String(record.cause?.message ?? "");
  const code = record.cause?.code ?? null;

  if (code === "42P01" || code === "42703") return true;

  const haystack = `${message}\n${causeMessage}`.toLowerCase();
  return (
    haystack.includes("tts_voices") &&
    (
      haystack.includes("does not exist") ||
      haystack.includes("relation") ||
      haystack.includes("column") ||
      haystack.includes("unknown column") ||
      haystack.includes("no such table")
    )
  );
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value: string | null | undefined, fallback: boolean): boolean {
  const normalized = cleanString(value)?.toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value: string | null | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (typeof value === "string" && value.trim().length === 0) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampMin(value: number, min: number): number {
  return Number.isFinite(value) ? Math.max(min, value) : min;
}

function normalizeKey(value: string | null | undefined): string {
  return cleanString(value)?.trim().toLowerCase() ?? "";
}

export function normalizeAiMaxLanguage(value: string | null | undefined): string {
  const normalized = cleanString(value)?.toLowerCase();
  if (!normalized) return AIMAX_DEFAULTS.language;
  if (["vi", "vn", "vietnamese", "tiếng việt", "tieng viet"].includes(normalized)) {
    return "Vietnamese";
  }
  return cleanString(value) ?? AIMAX_DEFAULTS.language;
}

export function normalizeVietnameseVoiceFilter(value: string | null | undefined): string {
  const normalized = cleanString(value)?.toLowerCase();
  if (!normalized) return "vi";
  if (["vi", "vn", "vietnamese", "tiếng việt", "tieng viet"].includes(normalized)) {
    return "vi";
  }
  return normalized;
}

export function maskApiKey(apiKey: string | null | undefined): string | null {
  const clean = cleanString(apiKey);
  if (!clean) return null;
  const prefix = clean.startsWith("ak_") ? "ak_" : "";
  const tail = clean.slice(-4);
  return `${prefix}****${tail}`;
}

export function applyAiMaxVoiceMetadataToVoiceRow<T extends AiMaxVoiceRowLike>(
  row: T,
): T & AiMaxEnrichedVoiceRow & { voiceId: string; id: string } {
  const voiceId = cleanString(row.voiceId) ?? cleanString(row.id) ?? "unknown";
  const metadata = getAiMaxVoiceMetadata(voiceId);
  const rawJson = row.rawJson && typeof row.rawJson === "object"
    ? row.rawJson as Record<string, unknown>
    : {};

  return {
    ...row,
    id: cleanString(row.id) ?? voiceId,
    voiceId,
    name: metadata.displayLabel,
    gender: metadata.gender ?? cleanString(row.gender),
    language: cleanString(row.language) ?? "vi",
    category: cleanString(row.category) ?? metadata.voiceFamily,
    useCase: cleanString(row.useCase) ?? metadata.recommendedUseCase,
    rawJson: {
      ...rawJson,
      provider: "aimax",
      local_metadata: metadata,
    },
    displayLabel: metadata.displayLabel,
    speakerName: metadata.speakerName,
    accent: metadata.accent,
    localeLabel: metadata.localeLabel,
    quality: metadata.quality,
    voiceFamily: metadata.voiceFamily,
    recommendedUseCase: metadata.recommendedUseCase,
    provider: metadata.provider,
    defaultSpeed: metadata.defaultSpeed,
    defaultPitch: metadata.defaultPitch,
  };
}

async function readAiMaxConfigMap(): Promise<AppConfigMap> {
  try {
    const rows = await db
      .select({ key: appConfig.key, value: appConfig.value })
      .from(appConfig)
      .where(inArray(appConfig.key, ALL_AIMAX_CONFIG_KEYS));
    return rows.reduce<AppConfigMap>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function resolveValue(
  configMap: AppConfigMap,
  dbKey: string,
  envValue: string | undefined,
  fallback: string,
): string {
  return cleanString(configMap[dbKey]) ?? cleanString(envValue) ?? fallback;
}

function resolveSource(
  configMap: AppConfigMap,
  dbKey: string,
  envValue: string | undefined,
): "db/admin" | "env" | "default" {
  if (cleanString(configMap[dbKey])) return "db/admin";
  if (cleanString(envValue)) return "env";
  return "default";
}

function resolveDbOrDefaultSource(
  configMap: AppConfigMap,
  dbKey: string,
): "db/admin" | "default" {
  return cleanString(configMap[dbKey]) ? "db/admin" : "default";
}

export async function getAiMaxRuntimeConfig(): Promise<AiMaxRuntimeConfig> {
  const configMap = await readAiMaxConfigMap();
  const apiBaseUrl = resolveValue(
    configMap,
    AIMAX_CONFIG_KEYS.apiBaseUrl,
    process.env.AIMAX_BASE_URL,
    "",
  );
  const apiKey = resolveValue(
    configMap,
    AIMAX_CONFIG_KEYS.apiKey,
    process.env.AIMAX_API_KEY,
    "",
  );
  const provider = resolveValue(
    configMap,
    AIMAX_CONFIG_KEYS.provider,
    process.env.AIMAX_PROVIDER,
    AIMAX_DEFAULTS.provider,
  );
  const model = resolveValue(
    configMap,
    AIMAX_CONFIG_KEYS.model,
    process.env.AIMAX_MODEL,
    AIMAX_DEFAULTS.model,
  );
  const language = normalizeAiMaxLanguage(
    cleanString(configMap[AIMAX_CONFIG_KEYS.language]) ?? process.env.AIMAX_LANGUAGE ?? AIMAX_DEFAULTS.language,
  );
  const normalize = parseBoolean(
    cleanString(configMap[AIMAX_CONFIG_KEYS.normalize]) ?? process.env.AIMAX_NORMALIZE,
    AIMAX_DEFAULTS.normalize,
  );
  const enableSrt = parseBoolean(
    cleanString(configMap[AIMAX_CONFIG_KEYS.enableSrt]) ?? process.env.AIMAX_ENABLE_SRT,
    AIMAX_DEFAULTS.enableSrt,
  );
  const useChunking = parseBoolean(
    cleanString(configMap[AIMAX_CONFIG_KEYS.useChunking]) ?? process.env.AIMAX_USE_CHUNKING,
    AIMAX_DEFAULTS.useChunking,
  );
  const maxCharsPerJob = clampMin(
    parseNumber(
      cleanString(configMap[AIMAX_CONFIG_KEYS.maxCharsPerJob]) ?? process.env.AIMAX_MAX_CHARS_PER_JOB,
      AIMAX_DEFAULTS.maxCharsPerJob,
    ),
    1_000,
  );
  const speed = parseNumber(
    cleanString(configMap[AIMAX_CONFIG_KEYS.speed]) ?? process.env.AIMAX_SPEED,
    AIMAX_DEFAULTS.speed,
  );
  const pitch = parseNumber(
    cleanString(configMap[AIMAX_CONFIG_KEYS.pitch]) ?? process.env.AIMAX_PITCH,
    AIMAX_DEFAULTS.pitch,
  );
  const volume = parseNumber(
    cleanString(configMap[AIMAX_CONFIG_KEYS.volume]) ?? process.env.AIMAX_VOLUME,
    AIMAX_DEFAULTS.volume,
  );
  const phatPhapSpeed = parseNumber(
    cleanString(configMap[AIMAX_CONFIG_KEYS.phatPhapSpeed]),
    AIMAX_DEFAULTS.phatPhapSpeed,
  );
  const phatPhapPitch = parseNumber(
    cleanString(configMap[AIMAX_CONFIG_KEYS.phatPhapPitch]),
    AIMAX_DEFAULTS.phatPhapPitch,
  );
  const phatPhapVolume = parseNumber(
    cleanString(configMap[AIMAX_CONFIG_KEYS.phatPhapVolume]),
    AIMAX_DEFAULTS.phatPhapVolume,
  );
  const phatPhapNormalize = parseBoolean(
    cleanString(configMap[AIMAX_CONFIG_KEYS.phatPhapNormalize]),
    AIMAX_DEFAULTS.phatPhapNormalize,
  );

  return {
    apiBaseUrl,
    apiKey,
    provider,
    model,
    language,
    normalize,
    enableSrt,
    useChunking,
    maxCharsPerJob,
    speed,
    pitch,
    volume,
    phatPhapSpeed,
    phatPhapPitch,
    phatPhapVolume,
    phatPhapNormalize,
    defaultVoiceId: cleanString(configMap[AIMAX_CONFIG_KEYS.defaultVoiceId]) ?? cleanString(process.env.AIMAX_VOICE_ID),
    defaultStoryVoiceId: cleanString(configMap[AIMAX_CONFIG_KEYS.defaultStoryVoiceId]),
    defaultPhatPhapVoiceId: cleanString(configMap[AIMAX_CONFIG_KEYS.defaultPhatPhapVoiceId]),
    defaultLongformVoiceId: cleanString(configMap[AIMAX_CONFIG_KEYS.defaultLongformVoiceId]),
    sources: {
      provider: resolveSource(configMap, AIMAX_CONFIG_KEYS.provider, process.env.AIMAX_PROVIDER),
      model: resolveSource(configMap, AIMAX_CONFIG_KEYS.model, process.env.AIMAX_MODEL),
      language: resolveSource(configMap, AIMAX_CONFIG_KEYS.language, process.env.AIMAX_LANGUAGE),
      normalize: resolveSource(configMap, AIMAX_CONFIG_KEYS.normalize, process.env.AIMAX_NORMALIZE),
      enableSrt: resolveSource(configMap, AIMAX_CONFIG_KEYS.enableSrt, process.env.AIMAX_ENABLE_SRT),
      useChunking: resolveSource(configMap, AIMAX_CONFIG_KEYS.useChunking, process.env.AIMAX_USE_CHUNKING),
      maxCharsPerJob: resolveSource(configMap, AIMAX_CONFIG_KEYS.maxCharsPerJob, process.env.AIMAX_MAX_CHARS_PER_JOB),
      speed: resolveSource(configMap, AIMAX_CONFIG_KEYS.speed, process.env.AIMAX_SPEED),
      pitch: resolveSource(configMap, AIMAX_CONFIG_KEYS.pitch, process.env.AIMAX_PITCH),
      volume: resolveSource(configMap, AIMAX_CONFIG_KEYS.volume, process.env.AIMAX_VOLUME),
      phatPhapSpeed: resolveDbOrDefaultSource(configMap, AIMAX_CONFIG_KEYS.phatPhapSpeed),
      phatPhapPitch: resolveDbOrDefaultSource(configMap, AIMAX_CONFIG_KEYS.phatPhapPitch),
      phatPhapVolume: resolveDbOrDefaultSource(configMap, AIMAX_CONFIG_KEYS.phatPhapVolume),
      phatPhapNormalize: resolveDbOrDefaultSource(configMap, AIMAX_CONFIG_KEYS.phatPhapNormalize),
      defaultVoiceId: resolveSource(configMap, AIMAX_CONFIG_KEYS.defaultVoiceId, process.env.AIMAX_VOICE_ID),
      defaultStoryVoiceId: resolveDbOrDefaultSource(configMap, AIMAX_CONFIG_KEYS.defaultStoryVoiceId),
      defaultPhatPhapVoiceId: resolveDbOrDefaultSource(configMap, AIMAX_CONFIG_KEYS.defaultPhatPhapVoiceId),
      defaultLongformVoiceId: resolveDbOrDefaultSource(configMap, AIMAX_CONFIG_KEYS.defaultLongformVoiceId),
    },
  };
}

export async function getAiMaxSettingsSnapshot(): Promise<AiMaxSettingsSnapshot> {
  const config = await getAiMaxRuntimeConfig();
  const configMap = await readAiMaxConfigMap();
  const parsedBalance = parseNumber(configMap[AIMAX_CONFIG_KEYS.balanceLastValue], Number.NaN);
  return {
    ...config,
    hasApiKey: Boolean(cleanString(config.apiKey)),
    maskedApiKey: maskApiKey(config.apiKey),
    balanceLastValue: Number.isFinite(parsedBalance) ? parsedBalance : null,
    balanceLastCheckedAt: cleanString(configMap[AIMAX_CONFIG_KEYS.balanceLastCheckedAt]),
  };
}

export function getAiMaxContextDefaultVoiceId(
  config: AiMaxRuntimeConfig,
  options: {
    contentType: "short" | "long";
    channelKey?: string | null;
  },
): string | null {
  if (options.contentType === "long") {
    return config.defaultLongformVoiceId ?? config.defaultVoiceId ?? null;
  }
  if (options.channelKey === "phat_phap") {
    return config.defaultPhatPhapVoiceId ?? config.defaultStoryVoiceId ?? config.defaultVoiceId ?? null;
  }
  return config.defaultStoryVoiceId ?? config.defaultVoiceId ?? null;
}

export function isAudioStoryContext(context: AiMaxRouteContext): boolean {
  const profileKey = normalizeKey(context.contentProfileKey);
  const formatType = normalizeKey(context.formatType);

  return profileKey === "audio_story" ||
    formatType.includes("audio_story") ||
    formatType.includes("story");
}

function isTangSauShortContext(context: AiMaxRouteContext): boolean {
  const channelKey = normalizeKey(context.channelKey);
  const profileKey = normalizeKey(context.contentProfileKey);
  const formatType = normalizeKey(context.formatType);

  return context.contentType === "short" && (
    channelKey === "tang_sau" ||
    profileKey === "philosophy" ||
    profileKey === "psychology" ||
    (channelKey !== "phat_phap" && formatType === "tts_short" && profileKey === "philosophy")
  );
}

export function resolveAiMaxTaggedRoute(
  config: AiMaxRuntimeConfig,
  context: AiMaxRouteContext,
): AiMaxRouteResolution {
  if (context.contentType === "short" && normalizeKey(context.channelKey) === "phat_phap") {
    return {
      routeKey: "phat_phap_short",
      providerId: "aimax",
      preferredVoiceId: config.defaultPhatPhapVoiceId ?? config.defaultVoiceId ?? null,
      fallbackVoiceId: AIMAX_TAG_ROUTE_FALLBACKS.phatPhapShort.voiceId,
      speed: config.phatPhapSpeed,
      pitch: config.phatPhapPitch,
      volume: config.phatPhapVolume,
      normalize: config.phatPhapNormalize,
      model: config.model,
      language: config.language,
      recommendedUseCase: "phat_phap_short",
      settingsSource: {
        voice: config.sources.defaultPhatPhapVoiceId === "db/admin"
          ? "db/admin"
          : config.sources.defaultVoiceId,
        speed: config.sources.phatPhapSpeed,
        pitch: config.sources.phatPhapPitch,
        volume: config.sources.phatPhapVolume,
        normalize: config.sources.phatPhapNormalize,
        model: config.sources.model,
        language: config.sources.language,
      },
    };
  }

  if (isTangSauShortContext(context)) {
    return {
      routeKey: "tang_sau_short",
      providerId: "aimax",
      preferredVoiceId: config.defaultStoryVoiceId ?? config.defaultVoiceId ?? null,
      fallbackVoiceId: AIMAX_TAG_ROUTE_FALLBACKS.tangSauShort.voiceId,
      speed: null,
      pitch: null,
      volume: config.volume,
      normalize: config.normalize,
      model: config.model,
      language: config.language,
      recommendedUseCase: "tang_sau_short",
      settingsSource: {
        voice: config.sources.defaultStoryVoiceId === "db/admin"
          ? "db/admin"
          : config.sources.defaultVoiceId,
        speed: config.sources.speed,
        pitch: config.sources.pitch,
        volume: config.sources.volume,
        normalize: config.sources.normalize,
        model: config.sources.model,
        language: config.sources.language,
      },
    };
  }

  if (isAudioStoryContext(context)) {
    const preferredVoiceId = context.contentType === "long"
      ? config.defaultLongformVoiceId ?? config.defaultStoryVoiceId ?? config.defaultVoiceId ?? null
      : config.defaultStoryVoiceId ?? config.defaultVoiceId ?? null;
    return {
      routeKey: "audio_story",
      providerId: "aimax",
      preferredVoiceId,
      fallbackVoiceId: AIMAX_TAG_ROUTE_FALLBACKS.audioStory.voiceId,
      speed: AIMAX_TAG_ROUTE_FALLBACKS.audioStory.speed,
      pitch: AIMAX_TAG_ROUTE_FALLBACKS.audioStory.pitch,
      volume: config.volume,
      normalize: config.normalize,
      model: config.model,
      language: config.language,
      recommendedUseCase: "audio_story",
      settingsSource: {
        voice: config.sources.defaultLongformVoiceId === "db/admin" || config.sources.defaultStoryVoiceId === "db/admin"
          ? "db/admin"
          : config.sources.defaultVoiceId,
        speed: "default",
        pitch: "default",
        volume: config.sources.volume,
        normalize: config.sources.normalize,
        model: config.sources.model,
        language: config.sources.language,
      },
    };
  }

  return {
    routeKey: null,
    providerId: null,
    preferredVoiceId: null,
    fallbackVoiceId: null,
    speed: null,
    pitch: null,
    volume: null,
    normalize: null,
    model: null,
    language: null,
    recommendedUseCase: null,
    settingsSource: null,
  };
}

export async function listStoredAiMaxVietnameseVoices() {
  let rows: Awaited<ReturnType<typeof db.select>>;
  try {
    rows = await db
      .select()
      .from(ttsVoices)
      .where(eq(ttsVoices.provider, "aimax"));
  } catch (error) {
    if (isMissingTtsVoicesSchemaError(error)) {
      console.warn("[aimax-settings] tts_voices schema not ready yet; returning empty AiMax voice list.");
      return [];
    }
    throw error;
  }

  return rows;
}

export type CachedAiMaxVoice = {
  id?: string;
  name?: string;
  locale?: string | null;
  gender?: string | null;
  age?: string | null;
  category?: string | null;
  useCase?: string | null;
  displayLabel?: string | null;
  speakerName?: string | null;
  accent?: string | null;
  localeLabel?: string | null;
  quality?: string | null;
  voiceFamily?: string | null;
  recommendedUseCase?: string | null;
  defaultSpeed?: number | null;
  defaultPitch?: number | null;
  rawJson?: unknown;
};

type CachedAiMaxVoiceFile = {
  voices?: CachedAiMaxVoice[];
  source?: string;
  fetchedAt?: string;
};

export function readCachedAiMaxSavedVoices(): {
  source: string | null;
  fetchedAt: string | null;
  voices: CachedAiMaxVoice[];
} {
  if (!fs.existsSync(AIMAX_VOICE_CACHE_PATH)) {
    return { source: null, fetchedAt: null, voices: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(AIMAX_VOICE_CACHE_PATH, "utf8")) as CachedAiMaxVoiceFile;
    return {
      source: cleanString(parsed.source),
      fetchedAt: cleanString(parsed.fetchedAt),
      voices: Array.isArray(parsed.voices) ? parsed.voices : [],
    };
  } catch {
    return { source: null, fetchedAt: null, voices: [] };
  }
}

export async function readAiMaxConfigValue(key: string): Promise<string | null> {
  const map = await readAiMaxConfigMap();
  return cleanString(map[key]);
}

export async function upsertAiMaxConfigEntries(entries: Record<string, string>): Promise<void> {
  const values = Object.entries(entries).map(([key, value]) => ({ key, value }));
  if (values.length === 0) return;
  for (const entry of values) {
    await db
      .insert(appConfig)
      .values(entry)
      .onConflictDoUpdate({
        target: appConfig.key,
        set: {
          value: entry.value,
          updatedAt: new Date(),
        },
      });
  }
}
