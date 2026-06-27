import { fal } from "@fal-ai/client";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { getLongImageConfig } from "@/actions/app-config";
import { LONG_THUMBNAIL_FAL_MODEL_DEFAULT, LONG_THUMBNAIL_LLM_MODEL_DEFAULT } from "@/lib/image-config-constants";
import { logApiUsage } from "@/actions/ai-usage";
import { calcCost } from "@/lib/ai-models";

const FAL_COST: Record<string, number> = {
  "fal-ai/flux/schnell":         0.003,
  "fal-ai/flux/dev":             0.025,
  "fal-ai/flux-pro/v1.1":        0.040,
  "fal-ai/flux-pro/v1.1-ultra":  0.060,
};
const FAL_DEFAULT_STEPS: Record<string, number> = {
  "fal-ai/flux/schnell":         8,
  "fal-ai/flux/dev":             28,
  "fal-ai/flux-pro/v1.1":        28,
  "fal-ai/flux-pro/v1.1-ultra":  28,
};

const IMAGES_DIR     = path.join(process.cwd(), "media", "images");
const LANDSCAPE_SIZE = "landscape_16_9";
const THUMB_SIZE     = { width: 1280, height: 720 } as const;

const PROMPT_NO_TEXT =
  ", single unified composition, " +
  "no text, no words, no letters, no captions, no watermarks, no overlays, " +
  "no split screen, no before-after, no collage";

export const BUDDHIST_LANDSCAPE_STYLES: Record<string, string> = {
  cinematic:  "cinematic widescreen, golden hour light, volumetric fog, depth of field, 35mm anamorphic lens, muted earth tones, zen landscape",
  watercolor: "East Asian landscape painting, ink wash, panoramic, minimalist horizon, mist-covered mountains, ethereal and meditative",
  vintage:    "vintage travel photograph, Kodachrome film, wide angle, warm nostalgic tones, grainy texture, wabi-sabi, 50s aesthetic",
};

export const THUMBNAIL_STYLES: Record<string, string> = {
  dramatic:   "dramatic cinematic lighting, extreme contrast, vivid warm saturated colors, heroic epic scale, photorealistic, ultra-detailed, 8K HDR",
  mystical:   "ethereal divine golden glow, celestial light rays, mystical spiritual atmosphere, radiant heavenly luminescence, dreamlike, hyper-detailed",
  painterly:  "classical oil painting style, rich textured brushwork, warm amber gold tones, museum masterpiece quality, Renaissance composition, lush colors",
  vivid:      "hyperreal vivid colors, ultra-sharp crystal clarity, maximum saturation, modern digital art, 8K HDR, jewel-toned, striking bold palette",
};

const STYLE_KEYS = Object.keys(BUDDHIST_LANDSCAPE_STYLES) as (keyof typeof BUDDHIST_LANDSCAPE_STYLES)[];

fal.config({ credentials: process.env.FAL_KEY });

// ── 1. Generate landscape image prompts + SEO description ─────────────────

interface LandscapePrompts {
  imagePrompts: string[];
  seoDescription: string;
  inputTokens: number;
  outputTokens: number;
}

async function generateLandscapePrompts(
  content: string,
  topic: string,
  niche: string,
  n: number,
  style: string,
  model: string,
): Promise<LandscapePrompts> {
  const client = getOpenRouterClient();

  const systemPrompt = `You are a visual director for Buddhist/spiritual YouTube long-form videos.
Return valid JSON only, no extra text.

VISUAL LANGUAGE (style: ${style}):
- Sweeping mountain landscapes, misty forests, ancient temples at dawn, lotus fields,
  river reflections, monastery courtyards, candle-lit altars, pilgrimage paths, monks in panoramic scenes
- Mood: contemplative, serene, majestic, timeless
- Color palette: warm amber, dusty gold, misty grey-blue, soft emerald

RULES:
1. Each prompt = ONE unified widescreen scene (16:9 landscape orientation)
2. NEVER include text, signs, writing, or captions
3. Vary the scenes to match the arc of the video (opening → middle → closing)

SEO DESCRIPTION format (Vietnamese):
- Line 1: Compelling hook (1 sentence)
- Paragraph 1: Summary of video content (2-3 sentences)
- Paragraph 2: What viewers will learn/gain (2-3 sentences)
- Hashtags line: 8-12 relevant Vietnamese Buddhist hashtags`;

  const userPrompt = `Video script (Vietnamese, first 3000 chars):
---
${content.slice(0, 3000)}
---
Topic: ${topic} | Niche: ${niche}

JSON response:
{
  "imagePrompts": ["scene 1", ...],  (exactly ${n} prompts, 15-25 words each)
  "seoDescription": "..."  (Vietnamese SEO, ~400-600 chars)
}`;

  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
    temperature: 0.7,
    max_tokens: 1200,
  });

  const inputTokens  = res.usage?.prompt_tokens     ?? 0;
  const outputTokens = res.usage?.completion_tokens ?? 0;
  const raw = res.choices[0]?.message?.content ?? "";
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: { imagePrompts?: unknown; seoDescription?: unknown };
  try { parsed = JSON.parse(jsonStr) as typeof parsed; }
  catch { throw new Error("LLM không trả về JSON hợp lệ cho landscape prompts"); }

  const rawPrompts = Array.isArray(parsed.imagePrompts)
    ? (parsed.imagePrompts as unknown[]).filter((x): x is string => typeof x === "string").slice(0, n)
    : [];
  if (rawPrompts.length === 0) throw new Error("LLM không tạo được image prompts");

  const imagePrompts = rawPrompts.map(
    p => p.replace(/[,.]?\s*$/, "") + `, ${style}` + PROMPT_NO_TEXT
  );
  const seoDescription = typeof parsed.seoDescription === "string" ? parsed.seoDescription.trim() : "";

  return { imagePrompts, seoDescription, inputTokens, outputTokens };
}

// ── 2. Generate thumbnail prompt — VIP LLM, eye-catching composition ───────

interface ThumbnailPromptResult {
  prompt: string;
  inputTokens: number;
  outputTokens: number;
}

async function generateThumbnailPrompt(
  content: string,
  topic: string,
  niche: string,
  model: string,
): Promise<ThumbnailPromptResult> {
  const client = getOpenRouterClient();

  const systemPrompt = `You are an expert YouTube thumbnail art director specializing in Buddhist/spiritual content.
Your thumbnails stop scrollers mid-swipe and compel clicks. Return ONE thumbnail prompt only — no JSON wrapper, just the prompt text.

THUMBNAIL PSYCHOLOGY:
- Strong emotional resonance: awe, peace, curiosity, wonder
- Dramatic lighting: golden rays breaking through clouds, candlelight in darkness, dawn over misty mountains
- Bold focal point: a single breathtaking element that reads clearly at 120×90px
- Rich, saturated but harmonious colors — warm golds, deep teals, glowing ambers
- Cinematic depth: foreground detail + epic background scale
- The image must FEEL sacred and cinematic simultaneously

COMPOSITION RULES:
- Rule of thirds with a dominant subject
- One strong light source creating dramatic shadows
- Foreground element + epic background (e.g. lotus flower with mountain vista behind)
- Atmosphere: mist, light rays, golden hour, or moonlight
- Style: photorealistic, ultra-detailed, 8K, HDR, shot on Phase One medium format camera

ABSOLUTELY NO: text, words, people's faces, modern objects, clutter`;

  const userPrompt = `Create ONE highly detailed thumbnail prompt for this Buddhist YouTube video.

Topic: ${topic}
Niche: ${niche}
Video opening (first 500 chars): ${content.slice(0, 500)}

Write a single detailed English prompt (30-50 words) describing the perfect thumbnail image.
Only output the prompt text, nothing else.`;

  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
    temperature: 0.8,
    max_tokens: 300,
  });

  const inputTokens  = res.usage?.prompt_tokens     ?? 0;
  const outputTokens = res.usage?.completion_tokens ?? 0;
  const raw = (res.choices[0]?.message?.content ?? "").trim();
  if (!raw) throw new Error("LLM không tạo được thumbnail prompt");

  const prompt = raw + PROMPT_NO_TEXT;
  return { prompt, inputTokens, outputTokens };
}

// ── 3. Download helper ─────────────────────────────────────────────────────

async function downloadImage(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// ── 4. Main export ─────────────────────────────────────────────────────────

export type LongImagesOverrides = {
  numImages?:            number;
  falModel?:             string;
  imageStyle?:           string;  // "" | "cinematic" | "watercolor" | "vintage"
  thumbnailFalModel?:    string;
  thumbnailLlmModel?:    string;
  thumbnailImageStyle?:  string;  // "" | "dramatic" | "mystical" | "painterly" | "vivid"
};

export type LongImagesResult =
  | { success: true; imagePaths: string[]; thumbnailPath: string; seoDescription: string; durationMs: number; costUsd: number }
  | { success: false; error: string };

export async function runLongImages(
  contentId: string,
  overrides?: LongImagesOverrides,
): Promise<LongImagesResult> {
  const item = await db.query.contentGenerations.findFirst({
    where: eq(contentGenerations.id, contentId),
  });
  if (!item) return { success: false, error: "Không tìm thấy content" };

  const content = item.longContent || item.shortContent;
  if (!content?.trim()) return { success: false, error: "Chưa có long content" };

  const config = await getLongImageConfig().catch(() => ({
    llmModel: "openai/gpt-4o-mini",
    falModel: "fal-ai/flux/dev",
    numImages: 5,
    steps: null,
    thumbnailFalModel: LONG_THUMBNAIL_FAL_MODEL_DEFAULT,
    thumbnailLlmModel: LONG_THUMBNAIL_LLM_MODEL_DEFAULT,
  }));

  // Per-job overrides take priority over global config
  const falModel          = overrides?.falModel          ?? config.falModel;
  const numImages         = overrides?.numImages         ?? config.numImages;
  const thumbnailFalModel = overrides?.thumbnailFalModel ?? config.thumbnailFalModel;
  const thumbnailLlmModel = overrides?.thumbnailLlmModel ?? config.thumbnailLlmModel;

  // Video image style: explicit override → random pick
  const styleKey = (overrides?.imageStyle && BUDDHIST_LANDSCAPE_STYLES[overrides.imageStyle])
    ? overrides.imageStyle
    : STYLE_KEYS[Math.floor(Math.random() * STYLE_KEYS.length)];
  const style = BUDDHIST_LANDSCAPE_STYLES[styleKey];

  // Thumbnail style: explicit override → random pick from THUMBNAIL_STYLES
  const thumbStyleKeys = Object.keys(THUMBNAIL_STYLES);
  const thumbStyleKey = (overrides?.thumbnailImageStyle && THUMBNAIL_STYLES[overrides.thumbnailImageStyle])
    ? overrides.thumbnailImageStyle
    : thumbStyleKeys[Math.floor(Math.random() * thumbStyleKeys.length)];
  const thumbnailStyle = THUMBNAIL_STYLES[thumbStyleKey];

  const steps            = config.steps ?? FAL_DEFAULT_STEPS[falModel]          ?? 28;
  const thumbSteps       =                 FAL_DEFAULT_STEPS[thumbnailFalModel] ?? 28;
  const costPerImg       = FAL_COST[falModel]          ?? 0.025;
  const costPerThumb     = FAL_COST[thumbnailFalModel] ?? 0.060;

  // Clear old images dir
  const existingDir = path.join(IMAGES_DIR, `${contentId}-long`);
  if (fs.existsSync(existingDir)) {
    try { fs.rmSync(existingDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  await db.update(contentGenerations)
    .set({ longImagesStatus: "processing", longImagesErrorMessage: null, longImagePaths: [] })
    .where(eq(contentGenerations.id, contentId));

  const startMs = Date.now();

  try {
    // Generate landscape prompts + SEO (regular LLM) and thumbnail prompt (VIP LLM) in parallel
    const [landscapeResult, thumbResult] = await Promise.all([
      generateLandscapePrompts(content, item.topic, item.nicheName, numImages, style, config.llmModel),
      generateThumbnailPrompt(content, item.topic, item.nicheName, thumbnailLlmModel),
    ]);

    type FalResult = { data: { images: Array<{ url: string }> } };

    // Generate all images in parallel: landscape images + thumbnail (different models)
    const landscapeFalPromises = landscapeResult.imagePrompts.map(p =>
      fal.run(falModel, {
        input: {
          prompt: p,
          image_size: LANDSCAPE_SIZE,
          num_inference_steps: steps,
          num_images: 1,
          enable_safety_checker: false,
        },
      }) as unknown as Promise<FalResult>
    );

    const thumbnailFalPromise = fal.run(thumbnailFalModel, {
      input: {
        prompt: thumbResult.prompt + `, ${thumbnailStyle}`,
        image_size: THUMB_SIZE,
        num_inference_steps: thumbSteps,
        num_images: 1,
        enable_safety_checker: false,
      },
    }) as unknown as Promise<FalResult>;

    const [landscapeFalResults, thumbFalResult] = await Promise.all([
      Promise.all(landscapeFalPromises),
      thumbnailFalPromise,
    ]);

    const imgDir = path.join(IMAGES_DIR, `${contentId}-long`);
    fs.mkdirSync(imgDir, { recursive: true });

    // Download landscape images
    const localPaths: string[] = new Array(landscapeFalResults.length);
    await Promise.all(
      landscapeFalResults.map(async (result, i) => {
        const url = result.data?.images?.[0]?.url;
        if (!url) throw new Error(`Ảnh landscape ${i} không có URL`);
        const dest = path.join(imgDir, `${i}.jpg`);
        await downloadImage(url, dest);
        localPaths[i] = `media/images/${contentId}-long/${i}.jpg`;
      })
    );

    // Download thumbnail
    const thumbUrl = thumbFalResult.data?.images?.[0]?.url;
    if (!thumbUrl) throw new Error("Thumbnail không có URL");
    await downloadImage(thumbUrl, path.join(imgDir, "thumbnail.jpg"));
    const thumbnailPath = `media/images/${contentId}-long/thumbnail.jpg`;

    const durationMs       = Date.now() - startMs;
    const llmCostLandscape = calcCost(config.llmModel,    landscapeResult.inputTokens, landscapeResult.outputTokens);
    const llmCostThumb     = calcCost(thumbnailLlmModel,  thumbResult.inputTokens,     thumbResult.outputTokens);
    const falCostLandscape = localPaths.length * costPerImg;
    const falCostThumb     = costPerThumb;
    const totalCostUsd     = llmCostLandscape + llmCostThumb + falCostLandscape + falCostThumb;

    await db.update(contentGenerations)
      .set({
        longImagesStatus:       "done",
        longImagePaths:         localPaths,
        longThumbnailPath:      thumbnailPath,
        longYoutubeDescription: landscapeResult.seoDescription || null,
        longImagesErrorMessage: null,
        longImagesDurationMs:   durationMs,
        longImagesCostUsd:      totalCostUsd.toFixed(6),
      })
      .where(eq(contentGenerations.id, contentId));

    await Promise.all([
      logApiUsage({ model: config.llmModel,   purpose: "long_image_prompts",    inputTokens: landscapeResult.inputTokens, outputTokens: landscapeResult.outputTokens, contentGenerationId: contentId }),
      logApiUsage({ model: thumbnailLlmModel,  purpose: "long_thumbnail_prompt", inputTokens: thumbResult.inputTokens,     outputTokens: thumbResult.outputTokens,     contentGenerationId: contentId }),
      logApiUsage({ model: falModel,           purpose: "long_image_generation", inputTokens: 0, outputTokens: 0, costUsd: falCostLandscape, contentGenerationId: contentId }),
      logApiUsage({ model: thumbnailFalModel,  purpose: "long_thumbnail_gen",    inputTokens: 0, outputTokens: 0, costUsd: falCostThumb,     contentGenerationId: contentId }),
    ]);

    return {
      success: true,
      imagePaths: localPaths,
      thumbnailPath,
      seoDescription: landscapeResult.seoDescription,
      durationMs,
      costUsd: totalCostUsd,
    };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 600);
    await db.update(contentGenerations)
      .set({ longImagesStatus: "error", longImagesErrorMessage: message })
      .where(eq(contentGenerations.id, contentId));
    return { success: false, error: message };
  }
}
