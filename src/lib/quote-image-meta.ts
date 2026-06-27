import type { HeroSubjectKey } from "@/lib/config/buddhist-visual-categories";

export type QuoteImageMeta = {
  rawPrompt: string;
  imageModel: string;
  imageSize: string;
  inferenceSteps: number;
  guidanceScale: number | null;
  visualVariant: string;
  heroSubject: HeroSubjectKey | null;
  compositionProfile: "cover_safe_v1";
  buddhistVisualCategory: string | null;
};
