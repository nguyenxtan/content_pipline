import { fal } from "@fal-ai/client";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { callWithRetry } from "@/lib/llm/retry";
import { ShortImagePromptsSchema, formatZodError } from "@/lib/llm/schemas";
import { getImageConfig } from "@/actions/app-config";
import { FAL_IMAGE_MODEL_DEFAULT, FAL_IMAGE_SIZE_DEFAULT, IMAGE_PROMPT_MODEL_DEFAULT } from "@/lib/image-config-constants";
import { logApiUsage } from "@/actions/ai-usage";
import { calcCost } from "@/lib/ai-models";
import { createPromptVersionEntry, mergePromptVersions } from "@/lib/prompt-version-registry";
import {
  findForbiddenProfileTerms,
  getContentProfile,
} from "@/lib/config/content-profiles";
import { getAudienceProfile } from "@/lib/prompt-studio-registry";
import {
  getBuddhistVisualCategory,
  buildBuddhistImagePrompt,
  buildBuddhistVisualMetadata,
  getHeroSubjectForCategory,
  BUDDHIST_NEGATIVE_PROMPT,
  type BuddhistVisualCategoryKey,
  type HeroSubjectKey,
} from "@/lib/config/buddhist-visual-categories";

const FAL_COST: Record<string, number> = {
  "fal-ai/flux/schnell":        0.003,
  "fal-ai/flux/dev":            0.025,
  "fal-ai/flux-pro/v1.1":       0.040,
  "fal-ai/flux-pro/v1.1-ultra": 0.060,
};
const FAL_DEFAULT_STEPS: Record<string, number> = {
  "fal-ai/flux/schnell":        8,
  "fal-ai/flux/dev":            28,
  "fal-ai/flux-pro/v1.1":       28,
  "fal-ai/flux-pro/v1.1-ultra": 28,
};

const IMAGES_DIR = path.join(process.cwd(), "media", "images");

const PROMPT_NO_TEXT =
  ", single unified composition, " +
  "no text, no words, no letters, no captions, no watermarks, no overlays, " +
  "no split screen, no before-after, no collage";

// BUDDHIST_VISUAL_V2 style anchors — cover-safe composition, brand palette, subject 40-70% frame
export const BUDDHIST_IMAGE_STYLES = {
  serene_buddha_light:  "majestic golden Shakyamuni Buddha statue as main subject (60% frame height), centered in lower two-thirds, large clean empty sky in upper third for text, radiant warm halo, soft golden light rays, lotus blossoms, ivory and gold tones, warm gold color grade, amber sunlight, vertical 9:16, bright uplifting, cinematic, highly detailed",
  lotus_temple_sunrise: "peaceful golden Buddha statue in bright temple at sunrise, subject in center-lower frame, large open pastel sky in upper third for title text, warm golden morning light, lotus pond with pink blossoms, jade green accents, warm gold color grade, vertical 9:16, bright healing cinematic, highly detailed",
  warm_monastery_peace: "large golden Buddha statue as main subject in monastery courtyard at dawn, centered lower two-thirds, upper third clean open sky, warm amber sunlight, jade green bamboo grove, white incense smoke, warm gold color grade, vertical 9:16, spiritual premium, highly detailed",
} as const;

export const PSYCHOLOGY_IMAGE_STYLES = {
  cinematic: "soft cinematic lighting, modern urban realism, emotional facial expression, shallow depth of field, 35mm photograph, natural skin tones, subtle color contrast, subject in lower two-thirds, clean upper third, vertical 9:16, highly detailed",
  editorial: "modern editorial photography, Vietnamese or Asian young adult, quiet tension, realistic body language, clean background with open space above subject, contemporary lifestyle magazine, vertical 9:16",
  moody: "night city atmosphere, soft neon reflections, low-key lighting, intimate urban realism, muted blue and amber palette, subject occupying 50-65% of frame, clean upper area, vertical 9:16, emotionally sharp, photorealistic",
} as const;

export type BuddhistImageStyle = keyof typeof BUDDHIST_IMAGE_STYLES;

// Maps each Buddhist visual category to its best-fit style anchor.
// Prevents random style/category mismatches (e.g. mandala getting lotus sunrise).
const BUDDHIST_CATEGORY_STYLE_MAP: Record<BuddhistVisualCategoryKey, BuddhistImageStyle> = {
  BUDDHA_GOLDEN_ENLIGHTENMENT:   "serene_buddha_light",
  GUANYIN_WHITE_JADE_COMPASSION: "lotus_temple_sunrise",
  AMITABHA_PURE_LAND_LIGHT:      "serene_buddha_light",
  BODHISATTVA_BRIGHT_VOW:        "warm_monastery_peace",
  LOTUS_PARADISE_PEACE:          "lotus_temple_sunrise",
  TEMPLE_SUNRISE_SERENITY:       "lotus_temple_sunrise",
  BAMBOO_MEDITATION_GREEN:       "warm_monastery_peace",
  SKY_CLOUD_HEAVENLY_BUDDHA:     "serene_buddha_light",
  DHARMA_CITY_LIGHT:             "warm_monastery_peace",
  SCRIPTURE_CANDLE_GOLD:         "serene_buddha_light",
  MANDALA_BRIGHT_KARMA:          "serene_buddha_light",
  VIETNAMESE_BUDDHIST_TEMPLE:    "lotus_temple_sunrise",
  PRACTICAL_DAILY_LIFE:          "warm_monastery_peace",
};

function resolveBuddhistStyleByCategory(categoryKey: BuddhistVisualCategoryKey | null): string {
  if (categoryKey && BUDDHIST_CATEGORY_STYLE_MAP[categoryKey]) {
    return BUDDHIST_IMAGE_STYLES[BUDDHIST_CATEGORY_STYLE_MAP[categoryKey]];
  }
  // Fallback: random (pre-V1 content or unknown category)
  const keys = Object.keys(BUDDHIST_IMAGE_STYLES) as BuddhistImageStyle[];
  return BUDDHIST_IMAGE_STYLES[keys[Math.floor(Math.random() * keys.length)]!];
}

function randomPsychologyStyle(): string {
  const keys = Object.keys(PSYCHOLOGY_IMAGE_STYLES) as Array<keyof typeof PSYCHOLOGY_IMAGE_STYLES>;
  const key = keys[Math.floor(Math.random() * keys.length)];
  return PSYCHOLOGY_IMAGE_STYLES[key];
}

function resolveImageStyle(
  contentProfileKey: string | null | undefined,
  styleOverride?: string | null,
  buddhistCategoryKey?: BuddhistVisualCategoryKey | null,
): string {
  const profile = getContentProfile(contentProfileKey);
  if (profile.key === "psychology") {
    return styleOverride?.trim()
      ? (PSYCHOLOGY_IMAGE_STYLES[styleOverride.trim() as keyof typeof PSYCHOLOGY_IMAGE_STYLES] ?? styleOverride.trim())
      : randomPsychologyStyle();
  }
  if (styleOverride?.trim()) {
    return BUDDHIST_IMAGE_STYLES[styleOverride.trim() as BuddhistImageStyle] ?? styleOverride.trim();
  }
  return resolveBuddhistStyleByCategory(buddhistCategoryKey ?? null);
}

// Returns true for models that support guidance_scale (Dev / Pro).
// Flux Schnell uses flow-matching without classifier-free guidance.
function modelSupportsGuidanceScale(falModel: string): boolean {
  return falModel !== "fal-ai/flux/schnell";
}

// Derives a short experiment variant tag from model + size for tracking.
function buildVisualVariant(falModel: string, imageSize: string): string {
  const modelSlug = falModel
    .replace("fal-ai/flux-pro/", "pro-")
    .replace("fal-ai/flux/", "");
  return `${modelSlug}/${imageSize}`;
}

function buildImagePromptPair(input: {
  content: string;
  topic: string;
  niche: string;
  n: number;
  contentProfileKey?: string | null;
}): { systemPrompt: string; userPrompt: string } {
  const profile = getContentProfile(input.contentProfileKey);

  if (profile.key === "psychology") {
    const audience = getAudienceProfile("tang_sau_v1");
    const visualPref = audience?.visualPreference.slice(0, 3).join("; ") ?? "";
    const avoidVis = audience?.avoidedVisuals.slice(0, 3).join("; ") ?? "";
    return {
      systemPrompt: `You are an expert visual director specializing in modern psychology and human-emotion photography.
Return valid JSON only, no extra text.

TARGET AUDIENCE: ${audience?.audienceDescription ?? "Young introspective Vietnamese viewers, modern loneliness, books/philosophy/psychology."}
AUDIENCE VISUAL PREFERENCE: ${visualPref || "Kinfolk style, quiet rooms, books, city solitude, soft shadows, modern minimalism."}
AVOID THESE VISUALS (audience will disengage): ${avoidVis || "Buddhist/temple imagery, oversaturated fantasy colors, religious symbols."}

VISUAL LANGUAGE GUIDELINES - apply to every prompt:
- Draw from: lonely young adult in a city, quiet cafe, office stress, emotional distance in relationships, phone or social media anxiety, night street, apartment solitude, train ride, rain on windows, subtle gestures, quiet confidence
- Mood: emotionally sharp, intimate, modern, realistic, reflective - never religious, never mystical
- Color palette: soft cinematic neutrals, blue-grey city tones, warm tungsten practical light, muted amber highlights - avoid oversaturated fantasy colors
- Focus on Vietnamese or Asian urban vibe when a person is present

COMPOSITION RULES — apply to every prompt:
- Vertical 9:16 portrait framing
- Subject anchored in center or lower two-thirds of frame
- Upper third must be clean (wall, sky, blurred background) — safe area for cover text
- Subject occupies 40-65% of frame — avoid tiny subjects and overly wide shots
- Single dominant focal point

CRITICAL RULES - violations will break the pipeline:
1. Each prompt must describe ONE single, unified scene - absolutely NO split-screen, before/after, dual composition, or contrast panels
2. NEVER include text, quotes, words, letters, signs, labels, book titles, or writing of any kind in the scene
3. NEVER use Buddhist, monk, temple, lotus, karma, rebirth, prayer-bead, or shrine imagery
4. Focus on concrete visuals: a person doing something, a room, a street, a gesture, a facial expression - not abstractions
5. Keep each prompt to 20-35 words describing only visual elements`,
      userPrompt: `Psychology script (Vietnamese):
---
${input.content}
---
Topic: ${input.topic} | Niche: ${input.niche}

Create exactly ${input.n} English image prompts for this psychology script.
Divide the script into ${input.n} meaningful segments. For each segment, write 1 prompt describing a modern, symbolic-but-realistic human scene matching the emotional content.

Respond with JSON: {"prompts": ["...", "...", ...]}`,
    };
  }

  const audience = getAudienceProfile("buddhist_healing_v1");
  const visualPref = audience?.visualPreference.slice(0, 3).join("; ") ?? "";
  const avoidVis = audience?.avoidedVisuals.slice(0, 3).join("; ") ?? "";

  // Determine category-based visual direction for this topic
  const visualCategoryKey = getBuddhistVisualCategory(input.topic, input.content);
  const categoryPromptHint = buildBuddhistImagePrompt(visualCategoryKey, input.topic);

  return {
    systemPrompt: `You are an expert visual director for Buddhist content following the BUDDHIST_VISUAL_V2 direction.
Return valid JSON only, no extra text.

TARGET AUDIENCE: ${audience?.audienceDescription ?? "Vietnamese viewers seeking peace, healing, and Buddhist wisdom."}
AUDIENCE VISUAL PREFERENCE: ${visualPref || "Golden Buddha statue, lotus flowers, temple sunrise, peaceful monastery."}
AVOID THESE VISUALS (audience will disengage): ${avoidVis || "Gloomy dark imagery, lonely urban sadness, cold depressive scenes."}

VISUAL DIRECTION V2 — MANDATORY:
Tone: bright, peaceful, sacred, warm, clean, uplifting, hopeful, luminous, elegant, emotionally comforting.
Never: dark, gloomy, depressing, horror, gothic, scary, cold, muddy, generic AI poster.
Brand palette: warm gold, amber sunlight, jade green accents, white incense smoke, soft temple lighting.
Subject rule: main Buddhist subject must occupy 40-70% of the frame — NEVER tiny or cropped.
Composition: vertical 9:16 portrait, subject anchored in center or lower two-thirds, large clean negative space in upper third for cover text overlay, strong clear silhouette, single dominant focal point.
Style: realistic cinematic Buddhist photography, highly detailed, premium spiritual aesthetic.

VISUAL CATEGORY FOR THIS TOPIC: ${visualCategoryKey}
REFERENCE PROMPT DIRECTION: ${categoryPromptHint}

CRITICAL RULES — violations will break the pipeline:
1. Each prompt must describe ONE single, unified scene — absolutely NO split-screen, before/after, dual composition, or contrast panels
2. NEVER include text, quotes, words, letters, signs, labels, book titles, or writing of any kind in the scene
3. Main Buddhist subject must be large, clearly visible, in center or lower two-thirds of frame
4. Upper third of the image must be clean sky, soft background, or open space — no subject heads or objects there
5. Keep each prompt to 20-40 words describing only visual elements
6. Every prompt must feel bright, sacred, and uplifting — never dark or gloomy
7. Negative: ${BUDDHIST_NEGATIVE_PROMPT}`,
    userPrompt: `Buddhist script (Vietnamese):
---
${input.content}
---
Topic: ${input.topic} | Niche: ${input.niche} | Visual Category: ${visualCategoryKey}

Create exactly ${input.n} English image prompts following BUDDHIST_VISUAL_V2 direction.
Each prompt must match the emotional content while staying bright, sacred, and uplifting.
Main subject must be large (40-70% of frame height), clearly Buddhist, warm gold and jade tones.
Subject must be in center or lower two-thirds — leave upper third clean for cover text.

Respond with JSON: {"prompts": ["...", "...", ...]}`,
  };
}

function validateImagePromptsForProfile(
  contentProfileKey: string | null | undefined,
  prompts: string[],
) {
  const violations = prompts.flatMap((prompt) => findForbiddenProfileTerms(contentProfileKey, prompt, "image"));
  if (violations.length > 0) {
    throw new Error(`Image prompt chứa visual bị cấm cho profile: ${Array.from(new Set(violations)).join(", ")}`);
  }
}

fal.config({ credentials: process.env.FAL_KEY });

// Fal.ai ApiError exposes .status and .body with the raw provider response.
// Extracting .body avoids swallowing the real rejection reason into "400 Provider returned error".
function extractFalError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const typed = err as unknown as Record<string, unknown>;
  const status = typeof typed.status === "number" ? typed.status : null;
  const body = typed.body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const detail = typeof b.detail === "string" ? b.detail : null;
    const msg    = typeof b.message === "string" ? b.message : null;
    const safe   = (detail ?? msg ?? JSON.stringify(b)).slice(0, 500);
    return status ? `${status} ${err.message} | ${safe}` : `${err.message} | ${safe}`;
  }
  return err.message;
}

// Safe fallback image prompt for when the real prompt triggers a 400.
// Uses a generic, content-neutral Buddhist scene with no text/faces to minimise rejection.
const FALLBACK_BUDDHIST_PROMPT =
  "serene golden Buddha statue in a bright temple courtyard at dawn, lotus flowers, warm golden light, jade green accents, " +
  "vertical 9:16, no text, no words, no watermarks, cinematic, highly detailed" + PROMPT_NO_TEXT;

async function generateImagePrompts(
  content: string,
  topic: string,
  niche: string,
  n: number,
  model: string,
  contentProfileKey?: string | null,
  styleOverride?: string | null,
  buddhistCategoryKey?: BuddhistVisualCategoryKey | null,
): Promise<{ prompts: string[]; inputTokens: number; outputTokens: number }> {
  const client = getOpenRouterClient();
  const { systemPrompt, userPrompt } = buildImagePromptPair({
    content,
    topic,
    niche,
    n,
    contentProfileKey,
  });

  const res = await callWithRetry(
    () => client.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      temperature: 0.6,
      max_tokens: 700,
    }),
    { label: "short_image_prompts" },
  );

  const inputTokens  = res.usage?.prompt_tokens     ?? 0;
  const outputTokens = res.usage?.completion_tokens ?? 0;

  // Extract JSON robustly — handle markdown code blocks and bare arrays
  const raw = res.choices[0]?.message?.content ?? "";
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let prompts: string[] = [];
  try {
    const parsed = JSON.parse(jsonStr);
    const validated = ShortImagePromptsSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`Image prompts validation thất bại: ${formatZodError(validated.error)}`);
    }
    prompts = Array.isArray(validated.data)
      ? validated.data
      : validated.data.prompts;
  } catch (err) {
    throw err instanceof Error ? err : new Error(`LLM không tạo được image prompts: ${String(err)}`);
  }
  prompts = prompts.slice(0, n);
  if (prompts.length === 0) throw new Error("LLM không tạo được image prompts");
  validateImagePromptsForProfile(contentProfileKey, prompts);
  const style = resolveImageStyle(contentProfileKey, styleOverride, buddhistCategoryKey);
  return { prompts: prompts.map(p => p.replace(/[,.]?\s*$/, "") + `, ${style}` + PROMPT_NO_TEXT), inputTokens, outputTokens };
}

async function downloadImage(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

export type ImagesResult =
  | { success: true; imagePaths: string[]; durationMs: number; costUsd: number }
  | { success: false; error: string };

export async function runImages(
  contentId: string,
  countOverride?: number | null,
  styleOverride?: string | null,
): Promise<ImagesResult> {
  const item = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
  if (!item) return { success: false, error: "Không tìm thấy content" };

  const config = await getImageConfig().catch(() => ({
    llmModel: IMAGE_PROMPT_MODEL_DEFAULT,
    falModel: FAL_IMAGE_MODEL_DEFAULT,
    imageSize: FAL_IMAGE_SIZE_DEFAULT,
    numImages: 3,
    steps: null,
  }));

  const falModel   = config.falModel;
  const imageSize  = config.imageSize;
  const numImages  = countOverride ?? config.numImages;
  const steps      = config.steps ?? FAL_DEFAULT_STEPS[falModel] ?? 8;
  const costPerImg = FAL_COST[falModel] ?? 0.003;
  const guidanceScale = modelSupportsGuidanceScale(falModel) ? 3.5 : undefined;

  const existingDir = path.join(IMAGES_DIR, contentId);
  if (fs.existsSync(existingDir)) {
    try { fs.rmSync(existingDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  await db.update(contentGenerations)
    .set({ imagesStatus: "processing", imagesErrorMessage: null, imagePaths: [] })
    .where(eq(contentGenerations.id, contentId));

  const startMs = Date.now();

  try {
    const content = item.shortContent || item.longContent;
    const profile = getContentProfile(item.contentProfileKey);
    const buddhistCategoryKey =
      profile.key === "buddhism"
        ? getBuddhistVisualCategory(item.topic, content)
        : null;
    const buddhistMeta = buddhistCategoryKey
      ? buildBuddhistVisualMetadata(buddhistCategoryKey)
      : null;
    const heroSubject: HeroSubjectKey | null = buddhistCategoryKey
      ? getHeroSubjectForCategory(buddhistCategoryKey)
      : null;

    const { prompts, inputTokens, outputTokens } = await generateImagePrompts(
      content, item.topic, item.nicheName, numImages, config.llmModel,
      item.contentProfileKey, styleOverride, buddhistCategoryKey,
    );

    type FalResult = { data: { images: Array<{ url: string }> } };
    const runFalWithFallback = async (prompt: string, index: number): Promise<FalResult> => {
      const falInput = (p: string) => ({
        prompt: p,
        image_size: imageSize,
        num_inference_steps: steps,
        num_images: 1,
        enable_safety_checker: false,
        ...(guidanceScale !== undefined ? { guidance_scale: guidanceScale } : {}),
      });
      try {
        return await callWithRetry(
          () => fal.run(falModel, { input: falInput(prompt) }) as unknown as Promise<FalResult>,
          { label: `short_image_fal_${index}`, baseDelayMs: 2_000 },
        );
      } catch (primaryErr) {
        const typed = primaryErr as unknown as Record<string, unknown>;
        const httpStatus = typeof typed.status === "number" ? typed.status : null;
        // Only attempt fallback on 400 (content policy / invalid prompt), not transient errors
        if (httpStatus !== 400) throw primaryErr;
        const detail = extractFalError(primaryErr);
        console.warn(
          `[images] fal 400 on prompt ${index} for ${contentId} — retrying with fallback prompt. detail: ${detail}`,
        );
        const profile = getContentProfile(item.contentProfileKey);
        const fallbackPrompt = profile.key === "psychology"
          ? "a young person sitting quietly by a window at dusk, soft natural light, modern apartment, calm introspective mood, vertical 9:16, no text, no words, photorealistic"
          : FALLBACK_BUDDHIST_PROMPT;
        return await callWithRetry(
          () => fal.run(falModel, { input: falInput(fallbackPrompt) }) as unknown as Promise<FalResult>,
          { label: `short_image_fal_fallback_${index}`, baseDelayMs: 2_000 },
        );
      }
    };
    const falResults = await Promise.all(prompts.map((prompt, i) => runFalWithFallback(prompt, i)));

    const imgDir = path.join(IMAGES_DIR, contentId);
    fs.mkdirSync(imgDir, { recursive: true });

    const localPaths = await Promise.all(
      falResults.map(async (result, i) => {
        const url = result.data?.images?.[0]?.url;
        if (!url) throw new Error(`Ảnh ${i} không có URL`);
        const dest = path.join(imgDir, `${i}.jpg`);
        await downloadImage(url, dest);
        return `media/images/${contentId}/${i}.jpg`;
      })
    );

    const durationMs   = Date.now() - startMs;
    const llmCostUsd   = calcCost(config.llmModel, inputTokens, outputTokens);
    const falCostUsd   = localPaths.length * costPerImg;
    const totalCostUsd = llmCostUsd + falCostUsd;

    await db.update(contentGenerations)
      .set({
        imagesStatus: "done",
        imagePaths: localPaths,
        imagesErrorMessage: null,
        imagesDurationMs: durationMs,
        imagesCostUsd: totalCostUsd.toFixed(6),
        promptVersions: mergePromptVersions(item.promptVersions, {
          image: createPromptVersionEntry("image", {
            model: config.llmModel,
            mode: "short",
            stage: "short_image_prompts",
            details: {
              falModel,
              imageSize,
              inferenceSteps: steps,
              guidanceScale: guidanceScale ?? null,
              visualVariant: buildVisualVariant(falModel, imageSize),
              rawPrompt: prompts[0]?.slice(0, 500) ?? null,
              imageCount: localPaths.length,
              styleOverride: styleOverride ?? null,
              heroSubject: heroSubject ?? null,
              compositionProfile: "cover_safe_v1",
              ...(buddhistMeta ?? {}),
            },
          }),
        }),
      })
      .where(eq(contentGenerations.id, contentId));

    await Promise.all([
      logApiUsage({ model: config.llmModel, purpose: "image_prompts", inputTokens, outputTokens, contentGenerationId: contentId, metadata: { falModel, numImages: localPaths.length, falCostUsd, totalCostUsd } }),
      logApiUsage({ model: falModel, purpose: "image_generation", inputTokens: 0, outputTokens: 0, costUsd: falCostUsd, contentGenerationId: contentId, metadata: { numImages: localPaths.length, costPerImg } }),
    ]);

    return { success: true, imagePaths: localPaths, durationMs, costUsd: totalCostUsd };
  } catch (err) {
    const message = extractFalError(err);
    await db.update(contentGenerations)
      .set({ imagesStatus: "error", imagesErrorMessage: message })
      .where(eq(contentGenerations.id, contentId));
    return { success: false, error: message };
  }
}
