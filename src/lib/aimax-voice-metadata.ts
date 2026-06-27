export type AiMaxVoiceRecommendedUseCase =
  | "test_or_short"
  | "audio_story"
  | "tang_sau_short"
  | "phat_phap_short";

export type AiMaxVoiceMetadata = {
  voiceId: string;
  displayLabel: string;
  speakerName: string | null;
  gender: string | null;
  accent: string | null;
  localeLabel: string | null;
  quality: string | null;
  voiceFamily: string;
  recommendedUseCase: AiMaxVoiceRecommendedUseCase | null;
  defaultSpeed: number | null;
  defaultPitch: number | null;
  provider: "aimax";
};

export const AIMAX_SAVED_VOICE_METADATA: Record<string, AiMaxVoiceMetadata> = {
  "hn_female_ngochuyen_full_24k-st": {
    voiceId: "hn_female_ngochuyen_full_24k-st",
    displayLabel: "Ngọc Huyền 24k",
    speakerName: "Ngọc Huyền",
    gender: "female",
    accent: "hn",
    localeLabel: "Hà Nội",
    quality: "24k",
    voiceFamily: "ngoc_huyen",
    recommendedUseCase: "audio_story",
    defaultSpeed: 1.1,
    defaultPitch: 2,
    provider: "aimax",
  },
  "hn_female_ngochuyen_full_48k-fhg": {
    voiceId: "hn_female_ngochuyen_full_48k-fhg",
    displayLabel: "Ngọc Huyền 48k",
    speakerName: "Ngọc Huyền",
    gender: "female",
    accent: "hn",
    localeLabel: "Hà Nội",
    quality: "48k",
    voiceFamily: "ngoc_huyen",
    recommendedUseCase: null,
    defaultSpeed: 1.05,
    defaultPitch: 2,
    provider: "aimax",
  },
  "s_sg_male_thientam_ytstable_vc": {
    voiceId: "s_sg_male_thientam_ytstable_vc",
    displayLabel: "Thiện Tâm",
    speakerName: "Thiện Tâm",
    gender: "male",
    accent: "sg",
    localeLabel: "Sài Gòn",
    quality: "ytstable",
    voiceFamily: "thien_tam",
    recommendedUseCase: "phat_phap_short",
    defaultSpeed: null,
    defaultPitch: null,
    provider: "aimax",
  },
} as const;

function cleanVoiceId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getAiMaxVoiceMetadata(voiceId: string | null | undefined): AiMaxVoiceMetadata {
  const normalizedVoiceId = cleanVoiceId(voiceId);
  const mapped = normalizedVoiceId ? AIMAX_SAVED_VOICE_METADATA[normalizedVoiceId] : null;
  if (mapped) return mapped;

  return {
    voiceId: normalizedVoiceId || "unknown",
    displayLabel: normalizedVoiceId || "unknown",
    speakerName: null,
    gender: null,
    accent: null,
    localeLabel: null,
    quality: null,
    voiceFamily: "unknown",
    recommendedUseCase: null,
    defaultSpeed: null,
    defaultPitch: null,
    provider: "aimax",
  };
}

export function getAiMaxVoiceDisplayLabel(voiceId: string | null | undefined): string {
  return getAiMaxVoiceMetadata(voiceId).displayLabel;
}

export function getAiMaxVoiceSampleRate(voiceId: string | null | undefined): number | null {
  const metadata = getAiMaxVoiceMetadata(voiceId);
  if (metadata.quality === "24k") return 24_000;
  if (metadata.quality === "48k") return 48_000;
  return null;
}
