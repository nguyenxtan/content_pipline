import fs from "fs";
import path from "path";

export const LEGACY_BATCH_PATH = path.join(process.cwd(), "output", "legacy-quote-short-v1", "experiment-batch.json");
export const LEGACY_BATCH_DIR = path.dirname(LEGACY_BATCH_PATH);

export type ContentTagFields = {
  contentType?: string;
  teachingType?: string;
  seriesName?: string;
  seriesNumber?: number;
  sourceType?: string;
  contentMood?: string;
  audienceIntent?: string;
  retentionDevice?: string;
  openingSceneType?: string;
  visualMotifs?: string[];
  hookStyle?: string;
  profileVerified?: boolean;
};

export type LegacyQuoteSampleManifest = {
  contentId: string;
  topic: string;
  topicFamily: string;
  channelName?: string;
  channelProfileId?: string;
  workspaceId?: string;
  quoteText: string;
  mainQuote?: string;
  reflectionText?: string;
  quoteStyle?: string;
  visualMood?: string;
  musicMood?: string;
  visualMode: string;
  motionStrength: string;
  musicPath: string;
  duration: number;
  outputVideoPath: string;
  meanVolumeDb: number;
  maxVolumeDb: number;
  motionScore: number;
  contactSheet?: string;
  tags?: ContentTagFields;
  visualSearchKeywords?: string[];
  colorPalette?: string;
  visualTemperature?: string;
};

export type LegacyQuoteBatchManifest = {
  generatedAt: string;
  formatType: string;
  experimentId: string;
  experimentVariant: string;
  samples: LegacyQuoteSampleManifest[];
};

type LegacyQuoteSidecarMetadata = {
  contentId: string;
  topic: string;
  topicFamily?: string;
  channelName?: string;
  channelProfileId?: string;
  workspaceId?: string;
  quoteText: string;
  mainQuote?: string;
  reflectionText?: string;
  quoteStyle?: string;
  visualMood?: string;
  musicMood?: string;
  visualMode?: string;
  motionStrength?: string;
  backgroundMusicPath?: string | null;
  musicPath?: string | null;
  durationSec?: number;
  videoPath?: string;
  visualSearchKeywords?: string[];
  colorPalette?: string;
  visualTemperature?: string;
  audioValidation?: {
    musicPath?: string | null;
    meanVolumeDb?: number | null;
    maxVolumeDb?: number | null;
  };
  tags?: ContentTagFields;
  excluded?: boolean;
  excludeReason?: string;
};

export function readLegacyManifest(): LegacyQuoteBatchManifest {
  if (!fs.existsSync(LEGACY_BATCH_PATH)) {
    throw new Error(`Legacy quote manifest not found: ${LEGACY_BATCH_PATH}`);
  }
  return JSON.parse(fs.readFileSync(LEGACY_BATCH_PATH, "utf8")) as LegacyQuoteBatchManifest;
}

export function readLegacySidecarSamples(): LegacyQuoteSampleManifest[] {
  if (!fs.existsSync(LEGACY_BATCH_DIR)) return [];

  const files = fs.readdirSync(LEGACY_BATCH_DIR)
    .filter((file) => file.endsWith("-legacy-quote-short.json"))
    .sort();

  return files.flatMap((file) => {
    const absPath = path.join(LEGACY_BATCH_DIR, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(absPath, "utf8")) as LegacyQuoteSidecarMetadata;
      if (parsed.excluded) return [];
      if (!parsed.contentId || !parsed.topic || !parsed.quoteText || !parsed.videoPath) return [];
      if (!fs.existsSync(parsed.videoPath)) return [];

      const contactSheet = path.join(LEGACY_BATCH_DIR, "contact-sheets", `${parsed.contentId}-contact.jpg`);
      return [{
        contentId: parsed.contentId,
        topic: parsed.topic,
        topicFamily: parsed.topicFamily ?? "unknown",
        channelName: parsed.channelName,
        channelProfileId: parsed.channelProfileId,
        workspaceId: parsed.workspaceId,
        quoteText: parsed.quoteText,
        mainQuote: parsed.mainQuote ?? parsed.quoteText,
        reflectionText: parsed.reflectionText,
        quoteStyle: parsed.quoteStyle,
        visualMood: parsed.visualMood,
        musicMood: parsed.musicMood,
        visualMode: parsed.visualMode ?? "ken_burns_image",
        motionStrength: parsed.motionStrength ?? "medium",
        musicPath: parsed.backgroundMusicPath ?? parsed.musicPath ?? parsed.audioValidation?.musicPath ?? "",
        duration: parsed.durationSec ?? 14,
        outputVideoPath: parsed.videoPath,
        meanVolumeDb: parsed.audioValidation?.meanVolumeDb ?? -99,
        maxVolumeDb: parsed.audioValidation?.maxVolumeDb ?? -99,
        motionScore: 0,
        contactSheet: fs.existsSync(contactSheet) ? contactSheet : undefined,
        tags: parsed.tags,
        visualSearchKeywords: parsed.visualSearchKeywords,
        colorPalette: parsed.colorPalette,
        visualTemperature: parsed.visualTemperature,
      }];
    } catch {
      return [];
    }
  });
}

export function getLegacyQuoteSampleRecords(): {
  manifest: LegacyQuoteBatchManifest;
  samples: LegacyQuoteSampleManifest[];
} {
  const manifest = readLegacyManifest();
  const merged = new Map<string, LegacyQuoteSampleManifest>();

  for (const sample of manifest.samples) {
    merged.set(sample.contentId, sample);
  }
  for (const sample of readLegacySidecarSamples()) {
    const existing = merged.get(sample.contentId);
    merged.set(sample.contentId, existing ? { ...existing, ...sample } : sample);
  }

  return {
    manifest,
    samples: [...merged.values()],
  };
}

export function getLegacyQuoteSampleAssets(): {
  generatedAt: string;
  samples: Array<Pick<LegacyQuoteSampleManifest, "contentId" | "outputVideoPath" | "contactSheet">>;
} {
  const records = getLegacyQuoteSampleRecords();
  return {
    generatedAt: records.manifest.generatedAt,
    samples: records.samples.map((sample) => ({
      contentId: sample.contentId,
      outputVideoPath: sample.outputVideoPath,
      contactSheet: sample.contactSheet,
    })),
  };
}
