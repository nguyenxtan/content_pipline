import { z } from "zod";

// ─── Long Script Outline ──────────────────────────────────────────────────────

export const LongOutlineSectionSchema = z.object({
  title:         z.string().min(1, "section title required"),
  purpose:       z.string().min(1, "section purpose required"),
  emotionalShift: z.string().min(1, "emotionalShift required"),
});

export const LongOutlineSchema = z.object({
  titleAngle:   z.string().min(5, "titleAngle too short"),
  openingAngle: z.string().min(5, "openingAngle too short"),
  closingAngle: z.string().min(5, "closingAngle too short"),
  sections:     z.array(LongOutlineSectionSchema).min(3, "at least 3 sections required").max(6),
  chapters:     z.array(z.string().min(1)).default([]),
});

export type LongOutlineFromSchema = z.infer<typeof LongOutlineSchema>;

// ─── Title Generation ─────────────────────────────────────────────────────────

export const TitleArraySchema = z.array(
  z.object({ title: z.string().min(1) }),
).min(1, "at least 1 title required");

export const TitleScoreItemSchema = z.object({
  curiosity:       z.number(),
  clarity:         z.number(),
  emotion:         z.number(),
  search_potential: z.number(),
  not_clickbait:   z.number(),
});

export const TitleScoreArraySchema = z.array(TitleScoreItemSchema);

// ─── Tags ─────────────────────────────────────────────────────────────────────

export const TagsArraySchema = z.array(z.string().min(1));

// ─── Thumbnail Intent ─────────────────────────────────────────────────────────
// Intentionally partial — each field falls back to a hardcoded default if absent.

export const ThumbnailIntentSchema = z.object({
  emotion:    z.string().min(1),
  mainVisual: z.string().min(1),
  text:       z.string().min(1),
  colorMood:  z.string().min(1),
}).partial();

// ─── Short Video Image Prompts ────────────────────────────────────────────────
// LLM may return either a bare array or {"prompts": [...]}

const PromptStringArray = z.array(z.string().min(3));

export const ShortImagePromptsSchema = z.union([
  PromptStringArray,
  z.object({ prompts: PromptStringArray }),
]);

// ─── Long Video Landscape Prompts ─────────────────────────────────────────────

export const LandscapePromptsSchema = z.object({
  imagePrompts:   z.array(z.string().min(3)).min(1, "at least 1 image prompt required"),
  seoDescription: z.string().default(""),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Format a ZodError into a concise, actionable string.
 * Example:  "sections: Array must contain at least 3; sections.0.title: Required"
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
