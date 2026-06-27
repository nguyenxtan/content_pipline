export const CONTENT_EXPERIMENT_VARIANTS = [
  "HOOK_V1",
  "HOOK_V2",
  "TITLE_V1",
  "TITLE_V2",
  "THUMBNAIL_V1",
  "THUMBNAIL_V2",
] as const;

export type ContentExperimentAssignment = {
  experimentId: string;
  experimentVariant: string;
};

const DEFAULT_EXPERIMENT_VARIANT = "HOOK_V1";

function normalizeExperimentValue(value: string | undefined | null): string | null {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, "_");
  return normalized ? normalized : null;
}

function inferExperimentId(variant: string): string {
  const versionMarker = variant.lastIndexOf("_V");
  return versionMarker > 0 ? variant.slice(0, versionMarker) : "BASELINE";
}

export function getContentExperimentAssignment(
  overrides?: Partial<ContentExperimentAssignment>,
): ContentExperimentAssignment {
  const experimentVariant =
    normalizeExperimentValue(overrides?.experimentVariant) ??
    normalizeExperimentValue(process.env.CONTENT_EXPERIMENT_VARIANT) ??
    DEFAULT_EXPERIMENT_VARIANT;

  const experimentId =
    normalizeExperimentValue(overrides?.experimentId) ??
    normalizeExperimentValue(process.env.CONTENT_EXPERIMENT_ID) ??
    inferExperimentId(experimentVariant);

  return { experimentId, experimentVariant };
}
