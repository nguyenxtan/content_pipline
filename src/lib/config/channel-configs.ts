import { db } from "@/lib/db";
import { appConfig, socialChannels } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export const DEFAULT_CHANNEL_KEY = "phat_phap" as const;
export const CHANNEL_PUBLISH_CONFIGS_KEY = "channel_publish_configs_v1";
const LEGACY_AUTO_SCHEDULE_SETTINGS_KEY = "auto_schedule_settings";

export const CHANNEL_KEYS = [
  DEFAULT_CHANNEL_KEY,
  "tang_sau",
] as const;

export type ChannelKey = (typeof CHANNEL_KEYS)[number];
export type PublishQueueType = "short" | "long" | "quote";
export type PublishPrivacyStatus = "public" | "unlisted" | "private";
export type ChannelConfigStatus = "active" | "draft";

export type ChannelDestinationConfig = {
  enabled: boolean;
  channelId: number;
  windowStart: string;
  windowEnd: string;
  intervalMin: number;
  privacyStatus: PublishPrivacyStatus;
};

export type ChannelDefinition = {
  key: ChannelKey;
  label: string;
  description: string;
  status: ChannelConfigStatus;
  publishingEnabled: boolean;
  autoScheduleEnabled: boolean;
  allowLegacyEnvFallback: boolean;
};

export type ChannelPublishConfig = ChannelDefinition & {
  shortDestinations: ChannelDestinationConfig[];
  longDestinations: ChannelDestinationConfig[];
  quoteDestinations: ChannelDestinationConfig[];
  source: "code_default" | "legacy_auto_schedule" | "channel_publish_configs_v1";
};

const DEFAULT_SHORT_DESTINATION: ChannelDestinationConfig = {
  enabled: false,
  channelId: 0,
  windowStart: "06:00",
  windowEnd: "22:00",
  intervalMin: 60,
  privacyStatus: "public",
};

const DEFAULT_LONG_DESTINATION: ChannelDestinationConfig = {
  enabled: false,
  channelId: 0,
  windowStart: "06:00",
  windowEnd: "22:00",
  intervalMin: 120,
  privacyStatus: "public",
};

const DEFAULT_QUOTE_DESTINATION: ChannelDestinationConfig = {
  enabled: false,
  channelId: 0,
  windowStart: "06:00",
  windowEnd: "22:00",
  intervalMin: 60,
  privacyStatus: "public",
};

export const CHANNEL_DEFINITIONS: Record<ChannelKey, ChannelDefinition> = {
  phat_phap: {
    key: "phat_phap",
    label: "Phat Phap",
    description: "Kênh sản xuất hiện tại cho nội dung Phật pháp",
    status: "active",
    publishingEnabled: true,
    autoScheduleEnabled: true,
    allowLegacyEnvFallback: true,
  },
  tang_sau: {
    key: "tang_sau",
    label: "Tang Sau",
    description: "Kênh Psychology cho Tầng Sâu, chỉ cho phép kết nối và đăng thủ công",
    status: "draft",
    publishingEnabled: true,
    autoScheduleEnabled: false,
    allowLegacyEnvFallback: false,
  },
};

function normalizeTimeValue(value: unknown, fallback: string): string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value)
    ? value
    : fallback;
}

function normalizeIntervalMin(value: unknown, min: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.round(parsed));
}

function normalizeDestination(
  value: unknown,
  fallback: ChannelDestinationConfig,
  minInterval: number,
): ChannelDestinationConfig {
  const data = value && typeof value === "object"
    ? value as Partial<ChannelDestinationConfig>
    : {};
  const privacyStatus = data.privacyStatus === "private" || data.privacyStatus === "unlisted"
    ? data.privacyStatus
    : "public";
  return {
    enabled: Boolean(data.enabled),
    channelId: Number(data.channelId ?? 0),
    windowStart: normalizeTimeValue(data.windowStart, fallback.windowStart),
    windowEnd: normalizeTimeValue(data.windowEnd, fallback.windowEnd),
    intervalMin: normalizeIntervalMin(data.intervalMin, minInterval),
    privacyStatus,
  };
}

function normalizeDestinationList(
  value: unknown,
  fallback: ChannelDestinationConfig,
  minInterval: number,
): ChannelDestinationConfig[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeDestination(item, fallback, minInterval));
}

function normalizeChannelPublishConfig(
  definition: ChannelDefinition,
  raw: unknown,
): ChannelPublishConfig {
  const data = raw && typeof raw === "object"
    ? raw as Partial<ChannelPublishConfig> & {
        short?: unknown;
        long?: unknown;
      }
    : {};

  const legacyShort = normalizeDestination(data.short, DEFAULT_SHORT_DESTINATION, 60);
  const legacyLong = normalizeDestination(data.long, DEFAULT_LONG_DESTINATION, 120);
  const shortDestinations = normalizeDestinationList(
    data.shortDestinations,
    DEFAULT_SHORT_DESTINATION,
    60,
  );
  const longDestinations = normalizeDestinationList(
    data.longDestinations,
    DEFAULT_LONG_DESTINATION,
    120,
  );
  const quoteDestinations = normalizeDestinationList(
    data.quoteDestinations,
    DEFAULT_QUOTE_DESTINATION,
    60,
  );

  return {
    ...definition,
    publishingEnabled: data.publishingEnabled ?? definition.publishingEnabled,
    autoScheduleEnabled: data.autoScheduleEnabled ?? definition.autoScheduleEnabled,
    allowLegacyEnvFallback: data.allowLegacyEnvFallback ?? definition.allowLegacyEnvFallback,
    shortDestinations: shortDestinations.length > 0
      ? shortDestinations
      : (legacyShort.channelId || legacyShort.enabled ? [legacyShort] : []),
    longDestinations: longDestinations.length > 0
      ? longDestinations
      : (legacyLong.channelId || legacyLong.enabled ? [legacyLong] : []),
    quoteDestinations,
    source: "channel_publish_configs_v1",
  };
}

function mapLegacyAutoScheduleSettings(raw: unknown): ChannelPublishConfig {
  const definition = CHANNEL_DEFINITIONS[DEFAULT_CHANNEL_KEY];
  const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};

  const shortLegacy = normalizeDestination(data.short, DEFAULT_SHORT_DESTINATION, 60);
  const longLegacy = normalizeDestination(data.long, DEFAULT_LONG_DESTINATION, 120);
  const shortDestinations = normalizeDestinationList(data.shortDestinations, DEFAULT_SHORT_DESTINATION, 60);
  const longDestinations = normalizeDestinationList(data.longDestinations, DEFAULT_LONG_DESTINATION, 120);
  const quoteDestinations = normalizeDestinationList(data.quoteDestinations, DEFAULT_QUOTE_DESTINATION, 60);

  return {
    ...definition,
    shortDestinations: shortDestinations.length > 0
      ? shortDestinations
      : (shortLegacy.channelId || shortLegacy.enabled ? [shortLegacy] : []),
    longDestinations: longDestinations.length > 0
      ? longDestinations
      : (longLegacy.channelId || longLegacy.enabled ? [longLegacy] : []),
    quoteDestinations,
    source: "legacy_auto_schedule",
  };
}

async function mapLegacyAutoScheduleSettingsForChannel(
  channelKey: ChannelKey,
  raw: unknown,
): Promise<ChannelPublishConfig> {
  const definition = CHANNEL_DEFINITIONS[channelKey];
  const legacy = mapLegacyAutoScheduleSettings(raw);
  const destinationIds = [
    ...legacy.shortDestinations.map((destination) => destination.channelId),
    ...legacy.longDestinations.map((destination) => destination.channelId),
    ...legacy.quoteDestinations.map((destination) => destination.channelId),
  ].filter((id) => id > 0);

  if (destinationIds.length === 0) {
    return {
      ...definition,
      shortDestinations: [],
      longDestinations: [],
      quoteDestinations: [],
      autoScheduleEnabled: false,
      source: "legacy_auto_schedule",
    };
  }

  const channels = await db.query.socialChannels.findMany({
    where: inArray(socialChannels.id, destinationIds),
    columns: { id: true, channelKey: true },
  });
  const channelKeyById = new Map(
    channels.map((row) => [row.id, normalizeChannelKey(row.channelKey)]),
  );
  const shortDestinations = legacy.shortDestinations.filter(
    (destination) => channelKeyById.get(destination.channelId) === channelKey,
  );
  const longDestinations = legacy.longDestinations.filter(
    (destination) => channelKeyById.get(destination.channelId) === channelKey,
  );
  const quoteDestinations = legacy.quoteDestinations.filter(
    (destination) => channelKeyById.get(destination.channelId) === channelKey,
  );
  const hasEnabledDestination = [
    ...shortDestinations,
    ...longDestinations,
    ...quoteDestinations,
  ].some((destination) => destination.enabled && destination.channelId > 0);

  return {
    ...definition,
    shortDestinations,
    longDestinations,
    quoteDestinations,
    autoScheduleEnabled: hasEnabledDestination,
    source: "legacy_auto_schedule",
  };
}

export function normalizeChannelKey(
  value: string | null | undefined,
): ChannelKey | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return null;
  return CHANNEL_KEYS.find((key) => key === normalized) ?? null;
}

export function resolveChannelKey(
  value: string | null | undefined,
): ChannelKey {
  return normalizeChannelKey(value) ?? DEFAULT_CHANNEL_KEY;
}

export function getChannelDefinition(
  value: string | null | undefined,
): ChannelDefinition {
  return CHANNEL_DEFINITIONS[resolveChannelKey(value)];
}

export function getChannelDestinations(
  config: ChannelPublishConfig,
  videoType: PublishQueueType,
): ChannelDestinationConfig[] {
  if (videoType === "long") return config.longDestinations;
  if (videoType === "quote") return config.quoteDestinations;
  return config.shortDestinations;
}

export async function getChannelPublishConfig(
  value: string | null | undefined,
): Promise<ChannelPublishConfig | null> {
  const channelKey = normalizeChannelKey(value);
  if (!channelKey) return null;

  const definition = CHANNEL_DEFINITIONS[channelKey];
  const channelConfigsRow = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, CHANNEL_PUBLISH_CONFIGS_KEY),
  });

  if (channelConfigsRow?.value) {
    try {
      const parsed = JSON.parse(channelConfigsRow.value) as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(parsed, channelKey)) {
        return normalizeChannelPublishConfig(definition, parsed[channelKey]);
      }
    } catch {
      // fall through to legacy / code defaults
    }
  }

  const legacyRow = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, LEGACY_AUTO_SCHEDULE_SETTINGS_KEY),
  });
  if (legacyRow?.value) {
    try {
      if (channelKey === DEFAULT_CHANNEL_KEY) {
        return mapLegacyAutoScheduleSettings(JSON.parse(legacyRow.value));
      }
      return await mapLegacyAutoScheduleSettingsForChannel(
        channelKey,
        JSON.parse(legacyRow.value),
      );
    } catch {
      // fall through to code defaults
    }
  }

  return {
    ...definition,
    shortDestinations: [],
    longDestinations: [],
    quoteDestinations: [],
    source: "code_default",
  };
}
