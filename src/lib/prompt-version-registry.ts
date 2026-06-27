export const PROMPT_VERSION_REGISTRY = {
  hook: {
    key: "hook",
    version: "hook-engine-v1",
    source: "src/lib/hook-engine.ts",
  },
  script: {
    key: "script",
    version: "script-engine-v1",
    source: "src/lib/script-engine.ts + prompt_templates",
  },
  image: {
    key: "image",
    version: "image-prompts-v3",
    source: "src/lib/pipeline/images.ts + src/lib/pipeline/long-images.ts",
  },
  titleMetadata: {
    key: "titleMetadata",
    version: "metadata-builder-v1",
    source: "src/lib/social/youtube-metadata.ts + src/lib/longform-engine.ts",
  },
  thumbnailIntent: {
    key: "thumbnailIntent",
    version: "thumbnail-intent-v1",
    source: "src/lib/longform-engine.ts",
  },
  tts: {
    key: "tts",
    version: "tts-routing-v1",
    source: "src/lib/pipeline/tts.ts + src/lib/pipeline/longform-narration.ts",
  },
  quote: {
    key: "quote",
    version: "quote-pipeline-v1",
    source: "src/lib/quotes/quote-pipeline.ts",
  },
  cover: {
    key: "cover",
    version: "short-cover-v1",
    source: "src/lib/short-cover-engine.ts + src/lib/image/short-cover-asset-generator.ts",
  },
} as const;

export type PromptVersionKey = keyof typeof PROMPT_VERSION_REGISTRY;

export type PromptVersionEntry = {
  key: PromptVersionKey;
  version: string;
  source: string;
  model?: string | null;
  templateId?: number | null;
  templateVersion?: number | null;
  stage?: string | null;
  mode?: string | null;
  details?: Record<string, unknown> | null;
  updatedAt: string;
};

export type PromptVersionSnapshot = Partial<Record<PromptVersionKey, PromptVersionEntry>>;

export function createPromptVersionEntry(
  key: PromptVersionKey,
  metadata: Partial<Omit<PromptVersionEntry, "key" | "version" | "source" | "updatedAt">> = {},
): PromptVersionEntry {
  const base = PROMPT_VERSION_REGISTRY[key];
  return {
    key,
    version: base.version,
    source: base.source,
    ...metadata,
    updatedAt: new Date().toISOString(),
  };
}

export function mergePromptVersions(
  existing: unknown,
  patch: PromptVersionSnapshot,
): PromptVersionSnapshot {
  const current = existing && typeof existing === "object"
    ? existing as PromptVersionSnapshot
    : {};
  return {
    ...current,
    ...patch,
  };
}
