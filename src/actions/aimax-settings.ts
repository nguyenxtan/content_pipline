"use server";

import path from "path";
import {
  AIMAX_CONFIG_KEYS,
  AIMAX_DEFAULTS,
  applyAiMaxVoiceMetadataToVoiceRow,
  getAiMaxRuntimeConfig,
  getAiMaxSettingsSnapshot,
  listStoredAiMaxVietnameseVoices,
  maskApiKey,
  normalizeAiMaxLanguage,
  readCachedAiMaxSavedVoices,
  upsertAiMaxConfigEntries,
} from "@/lib/aimax-settings";
import {
  aiMaxProvider,
  getAiMaxBalance,
  syncAiMaxVoicesToDatabase,
} from "@/services/tts/providers/AiMaxProvider";

const AUDIO_DIR = path.join(process.cwd(), "media", "audio");
const DEFAULT_TEST_TEXT = "Xin chào, đây là bản kiểm tra giọng đọc tiếng Việt cho hệ thống truyện audio.";

export type SaveAiMaxSettingsInput = {
  apiBaseUrl: string;
  apiKey?: string;
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
};

type VoiceCatalogRow = {
  id: string;
  voiceId: string;
  name: string;
  displayLabel: string;
  speakerName: string | null;
  gender: string | null;
  age: string | null;
  language: string | null;
  category: string | null;
  useCase: string | null;
  accent: string | null;
  localeLabel: string | null;
  quality: string | null;
  voiceFamily: string;
  recommendedUseCase: string | null;
  provider: "aimax";
  defaultSpeed: number | null;
  defaultPitch: number | null;
  previewUrl: string | null;
  sourceProvider: string | null;
  rawJson: unknown;
  updatedAt: string;
  source: "stored" | "cache";
};

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function rawObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function extractStringField(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = cleanString(typeof record[key] === "string" ? record[key] : null);
    if (value) return value;
  }
  return null;
}

function mapStoredVoiceRow(voice: Awaited<ReturnType<typeof listStoredAiMaxVietnameseVoices>>[number]): VoiceCatalogRow {
  const enriched = applyAiMaxVoiceMetadataToVoiceRow({
    id: voice.id,
    voiceId: voice.voiceId,
    name: voice.name,
    gender: voice.gender,
    age: voice.age,
    language: voice.language,
    category: voice.category,
    useCase: voice.useCase,
    rawJson: voice.rawJson,
  });
  const record = rawObject(enriched.rawJson);
  return {
    ...enriched,
    accent: enriched.accent ?? extractStringField(record, ["accent", "region"]),
    previewUrl: extractStringField(record, ["preview_url", "previewUrl", "sample_url", "sampleUrl"]),
    sourceProvider: extractStringField(record, ["provider", "source_provider", "vendor"]),
    rawJson: enriched.rawJson,
    updatedAt: voice.updatedAt.toISOString(),
    source: "stored",
  } satisfies VoiceCatalogRow;
}

function mapCachedVoiceRow(voice: {
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
}): VoiceCatalogRow | null {
  const voiceId = cleanString(voice.id);
  if (!voiceId) return null;
  const enriched = applyAiMaxVoiceMetadataToVoiceRow({
    id: voiceId,
    voiceId,
    name: cleanString(voice.name) ?? cleanString(voice.displayLabel) ?? voiceId,
    gender: cleanString(voice.gender),
    age: cleanString(voice.age),
    language: cleanString(voice.locale) ?? "vi",
    category: cleanString(voice.category) ?? cleanString(voice.voiceFamily),
    useCase: cleanString(voice.useCase) ?? cleanString(voice.recommendedUseCase),
    rawJson: voice.rawJson ?? null,
  });
  const record = rawObject(enriched.rawJson);
  return {
    ...enriched,
    accent: cleanString(voice.accent) ?? enriched.accent ?? extractStringField(record, ["accent", "region"]),
    previewUrl: extractStringField(record, ["preview_url", "previewUrl", "sample_url", "sampleUrl"]),
    sourceProvider: extractStringField(record, ["provider", "source_provider", "vendor"]),
    rawJson: enriched.rawJson,
    updatedAt: new Date(0).toISOString(),
    source: "cache",
  } satisfies VoiceCatalogRow;
}

async function loadAiMaxVoiceCatalogLocal(): Promise<{ voices: VoiceCatalogRow[]; source: "stored" | "cache"; origin: "db" | "cache" | "empty" }> {
  const storedVoices = await listStoredAiMaxVietnameseVoices();
  if (storedVoices.length > 0) {
    return {
      voices: storedVoices.map(mapStoredVoiceRow).sort((left, right) => left.name.localeCompare(right.name, "vi")),
      source: "stored",
      origin: "db",
    };
  }

  const cached = readCachedAiMaxSavedVoices();
  const mappedCachedVoices = cached.voices
    .map(mapCachedVoiceRow)
    .filter((voice): voice is VoiceCatalogRow => Boolean(voice))
    .sort((left, right) => left.name.localeCompare(right.name, "vi"));

  if (mappedCachedVoices.length > 0) {
    return {
      voices: mappedCachedVoices,
      source: "cache",
      origin: "cache",
    };
  }

  return {
    voices: [],
    source: "cache",
    origin: "empty",
  };
}

export async function getAiMaxSettingsPageDataAction() {
  const startedAt = Date.now();
  const [settings, catalog] = await Promise.all([
    getAiMaxSettingsSnapshot(),
    loadAiMaxVoiceCatalogLocal(),
  ]);

  if (process.env.NODE_ENV !== "production") {
    console.info("[aimax-settings] getAiMaxSettingsPageDataAction", {
      durationMs: Date.now() - startedAt,
      origin: catalog.origin,
      voiceCount: catalog.voices.length,
    });
  }

  return {
    settings: {
      ...settings,
      apiKey: "",
    },
    voiceCatalogSource: catalog.source,
    voices: catalog.voices,
  };
}

export async function saveAiMaxSettingsAction(input: SaveAiMaxSettingsInput) {
  const current = await getAiMaxRuntimeConfig();
  const nextApiKey = input.apiKey?.trim() ? input.apiKey.trim() : current.apiKey;
  await upsertAiMaxConfigEntries({
    [AIMAX_CONFIG_KEYS.apiBaseUrl]: input.apiBaseUrl.trim(),
    [AIMAX_CONFIG_KEYS.apiKey]: nextApiKey,
    [AIMAX_CONFIG_KEYS.provider]: input.provider.trim() || AIMAX_DEFAULTS.provider,
    [AIMAX_CONFIG_KEYS.model]: input.model.trim() || AIMAX_DEFAULTS.model,
    [AIMAX_CONFIG_KEYS.language]: normalizeAiMaxLanguage(input.language),
    [AIMAX_CONFIG_KEYS.normalize]: String(input.normalize),
    [AIMAX_CONFIG_KEYS.enableSrt]: String(input.enableSrt),
    [AIMAX_CONFIG_KEYS.useChunking]: String(input.useChunking),
    [AIMAX_CONFIG_KEYS.maxCharsPerJob]: String(Math.max(1000, Math.floor(input.maxCharsPerJob))),
    [AIMAX_CONFIG_KEYS.speed]: String(input.speed),
    [AIMAX_CONFIG_KEYS.pitch]: String(input.pitch),
    [AIMAX_CONFIG_KEYS.volume]: String(input.volume),
    [AIMAX_CONFIG_KEYS.phatPhapSpeed]: String(input.phatPhapSpeed),
    [AIMAX_CONFIG_KEYS.phatPhapPitch]: String(input.phatPhapPitch),
    [AIMAX_CONFIG_KEYS.phatPhapVolume]: String(input.phatPhapVolume),
    [AIMAX_CONFIG_KEYS.phatPhapNormalize]: String(input.phatPhapNormalize),
  });

  return {
    success: true,
    maskedApiKey: maskApiKey(nextApiKey),
  };
}

export async function checkAiMaxBalanceAction() {
  const balance = await getAiMaxBalance();
  const checkedAt = new Date().toISOString();
  await upsertAiMaxConfigEntries({
    [AIMAX_CONFIG_KEYS.balanceLastValue]: String(balance.balance ?? ""),
    [AIMAX_CONFIG_KEYS.balanceLastCheckedAt]: checkedAt,
  });

  return {
    success: true,
    balance: balance.balance,
    checkedAt,
  };
}

export async function syncAiMaxVietnameseVoicesAction() {
  const voices = await syncAiMaxVoicesToDatabase({ forceRefresh: true });
  return {
    success: true,
    count: voices.length,
  };
}

type VoiceRole = "default" | "story" | "phat_phap" | "longform";

function configKeyForVoiceRole(role: VoiceRole): string {
  switch (role) {
    case "story":
      return AIMAX_CONFIG_KEYS.defaultStoryVoiceId;
    case "phat_phap":
      return AIMAX_CONFIG_KEYS.defaultPhatPhapVoiceId;
    case "longform":
      return AIMAX_CONFIG_KEYS.defaultLongformVoiceId;
    default:
      return AIMAX_CONFIG_KEYS.defaultVoiceId;
  }
}

export async function saveAiMaxVoiceRoleAction(params: {
  role: VoiceRole;
  voiceId: string | null;
}) {
  const normalizedVoiceId = cleanString(params.voiceId) ?? "";
  await upsertAiMaxConfigEntries({
    [configKeyForVoiceRole(params.role)]: normalizedVoiceId,
  });
  return { success: true, role: params.role, voiceId: normalizedVoiceId || null };
}

function toStreamPathFromAbsolute(audioPath: string): string | null {
  const rel = path.relative(AUDIO_DIR, audioPath);
  if (!rel || rel.startsWith("..")) return null;
  return `/api/tts/stream?path=${encodeURIComponent(rel.replace(/\\/g, "/"))}&v=${Date.now()}`;
}

export async function testAiMaxVoiceAction(params: {
  voiceId: string;
  text?: string;
}) {
  const config = await getAiMaxRuntimeConfig();
  const text = params.text?.trim() || DEFAULT_TEST_TEXT;
  const outputPath = path.join(
    AUDIO_DIR,
    "aimax-tests",
    `${params.voiceId.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}-${Date.now()}.wav`,
  );

  const result = await aiMaxProvider.synthesize({
    text,
    voiceId: params.voiceId,
    outputPath,
    contentId: `aimax-test-${Date.now()}`,
    chapterId: `aimax-settings-test-${Date.now()}`,
    language: config.language,
    normalize: config.normalize,
    enableSrt: config.enableSrt,
    speed: config.speed,
    pitch: config.pitch,
    volume: config.volume,
  });

  return {
    success: true,
    audioPath: outputPath,
    audioStreamUrl: toStreamPathFromAbsolute(outputPath),
    durationSec: result.durationSec,
    srtPath: result.srtPath ?? null,
    voiceId: result.voiceId,
    providerId: result.providerId,
  };
}

export async function getAiMaxVoiceCatalogAction() {
  const catalog = await loadAiMaxVoiceCatalogLocal();
  return {
    source: catalog.source,
    voices: catalog.voices,
  };
}
