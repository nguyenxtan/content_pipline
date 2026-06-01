import { fal } from "@fal-ai/client";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { contentGenerations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { getImageConfig } from "@/actions/app-config";
import { FAL_IMAGE_MODEL_DEFAULT, IMAGE_PROMPT_MODEL_DEFAULT } from "@/lib/image-config-constants";
import { logApiUsage } from "@/actions/ai-usage";
import { calcCost } from "@/lib/ai-models";

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
const IMAGE_SIZE = "portrait_4_3";

const PROMPT_NO_TEXT =
  ", single unified composition, " +
  "no text, no words, no letters, no captions, no watermarks, no overlays, " +
  "no split screen, no before-after, no collage";

// Buddhist image style presets — mirrors the 3-option menu in the prompt-engineer spec
export const BUDDHIST_IMAGE_STYLES = {
  cinematic:  "cinematic lighting, volumetric fog, moody atmosphere, depth of field, 35mm photograph, muted colors, zen aesthetic, highly detailed",
  watercolor: "traditional East Asian ink wash painting style, watercolor, minimalist composition, soft brush strokes, elegant, ethereal, zen concept art",
  vintage:    "vintage film photo, Kodachrome, grainy texture, warm tones, nostalgic, rustic, wabi-sabi aesthetic, authentic look, 50mm lens",
} as const;

export type BuddhistImageStyle = keyof typeof BUDDHIST_IMAGE_STYLES;

const BUDDHIST_STYLE_KEYS = Object.keys(BUDDHIST_IMAGE_STYLES) as BuddhistImageStyle[];

function randomBuddhistStyle(): string {
  const key = BUDDHIST_STYLE_KEYS[Math.floor(Math.random() * BUDDHIST_STYLE_KEYS.length)];
  return BUDDHIST_IMAGE_STYLES[key];
}

fal.config({ credentials: process.env.FAL_KEY });

async function generateImagePrompts(
  content: string,
  topic: string,
  niche: string,
  n: number,
  model: string,
  styleOverride?: string | null,
): Promise<{ prompts: string[]; inputTokens: number; outputTokens: number }> {
  const client = getOpenRouterClient();
  const systemPrompt = `You are an expert visual director specializing in Buddhist and contemplative photography.
Return valid JSON only, no extra text.

VISUAL LANGUAGE GUIDELINES — apply to every prompt:
- Draw from: monks meditating, ancient temples, lotus ponds, misty mountains, incense smoke, prayer beads, candlelight, autumn leaves, stone Buddha statues, elderly practitioners, forest hermitages, dawn light through bamboo
- Mood: serene, still, introspective, timeless — never dramatic, never chaotic
- Color palette: muted earth tones, soft greens, warm amber, dusty gold, grey mist — avoid saturated or neon colors
- NO religious symbols used as decoration — only as natural elements in the scene

CRITICAL RULES — violations will break the pipeline:
1. Each prompt must describe ONE single, unified scene — absolutely NO split-screen, before/after, dual composition, or contrast panels
2. NEVER include text, quotes, words, letters, signs, labels, book titles, or writing of any kind in the scene
3. NEVER use concepts that imply text overlays (e.g. "inspiring quote", "motivational message", "caption")
4. Focus on concrete visuals: a person doing something, a landscape, an object, a moment — not abstractions
5. Keep each prompt to 15-25 words describing only visual elements`;

  const userPrompt = `Buddhist script (Vietnamese):
---
${content}
---
Topic: ${topic} | Niche: ${niche}

Create exactly ${n} English image prompts for this Buddhist script.
Divide the script into ${n} meaningful segments. For each segment, write 1 prompt describing a concrete, serene Buddhist visual scene matching the emotional content.

Respond with JSON: {"prompts": ["...", "...", ...]}`;

  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    temperature: 0.6,
    max_tokens: 700,
  });

  const inputTokens  = res.usage?.prompt_tokens     ?? 0;
  const outputTokens = res.usage?.completion_tokens ?? 0;

  // Extract JSON robustly — handle markdown code blocks and bare arrays
  const raw = res.choices[0]?.message?.content ?? "";
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let prompts: string[] = [];
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (Array.isArray(parsed)) {
      prompts = parsed.filter((x): x is string => typeof x === "string");
    } else {
      const obj = parsed as { prompts?: unknown };
      if (Array.isArray(obj.prompts)) {
        prompts = obj.prompts.filter((x): x is string => typeof x === "string");
      }
    }
  } catch { /* prompts stays [] */ }
  prompts = prompts.slice(0, n);
  if (prompts.length === 0) throw new Error("LLM không tạo được image prompts");
  const style = styleOverride?.trim()
    ? (BUDDHIST_IMAGE_STYLES[styleOverride.trim() as BuddhistImageStyle] ?? styleOverride.trim())
    : randomBuddhistStyle();
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
    numImages: 3,
    steps: null,
  }));

  const falModel  = config.falModel;
  const numImages = countOverride ?? config.numImages;
  const steps     = config.steps ?? FAL_DEFAULT_STEPS[falModel] ?? 8;
  const costPerImg = FAL_COST[falModel] ?? 0.003;

  const existingDir = path.join(IMAGES_DIR, contentId);
  if (fs.existsSync(existingDir)) {
    try { fs.rmSync(existingDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  await db.update(contentGenerations)
    .set({ imagesStatus: "processing", imagesErrorMessage: null, imagePaths: [] })
    .where(eq(contentGenerations.id, contentId));

  const startMs = Date.now();

  try {
    // Use shortContent if available, else longContent
    const content = item.shortContent || item.longContent;
    const { prompts, inputTokens, outputTokens } = await generateImagePrompts(
      content, item.topic, item.nicheName, numImages, config.llmModel, styleOverride,
    );

    type FalResult = { data: { images: Array<{ url: string }> } };
    const falResults = await Promise.all(
      prompts.map((prompt) =>
        fal.run(falModel, {
          input: {
            prompt,
            image_size: IMAGE_SIZE,
            num_inference_steps: steps,
            num_images: 1,
            enable_safety_checker: false,
          },
        }) as unknown as Promise<FalResult>
      )
    );

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
      .set({ imagesStatus: "done", imagePaths: localPaths, imagesErrorMessage: null, imagesDurationMs: durationMs, imagesCostUsd: totalCostUsd.toFixed(6) })
      .where(eq(contentGenerations.id, contentId));

    await Promise.all([
      logApiUsage({ model: config.llmModel, purpose: "image_prompts", inputTokens, outputTokens, contentGenerationId: contentId, metadata: { falModel, numImages: localPaths.length, falCostUsd, totalCostUsd } }),
      logApiUsage({ model: falModel, purpose: "image_generation", inputTokens: 0, outputTokens: 0, costUsd: falCostUsd, contentGenerationId: contentId, metadata: { numImages: localPaths.length, costPerImg } }),
    ]);

    return { success: true, imagePaths: localPaths, durationMs, costUsd: totalCostUsd };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(contentGenerations)
      .set({ imagesStatus: "error", imagesErrorMessage: message })
      .where(eq(contentGenerations.id, contentId));
    return { success: false, error: message };
  }
}
