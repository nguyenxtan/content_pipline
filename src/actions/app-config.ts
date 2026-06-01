"use server";

import { db } from "@/lib/db";
import { appConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  IMAGE_PROMPT_MODEL_KEY, IMAGE_PROMPT_MODEL_DEFAULT,
  FAL_IMAGE_MODEL_KEY,   FAL_IMAGE_MODEL_DEFAULT,
  IMAGE_COUNT_KEY,       IMAGE_COUNT_DEFAULT,
  IMAGE_STEPS_KEY,
  LONG_IMAGE_PROMPT_MODEL_KEY, LONG_IMAGE_PROMPT_MODEL_DEFAULT,
  LONG_FAL_IMAGE_MODEL_KEY,   LONG_FAL_IMAGE_MODEL_DEFAULT,
  LONG_IMAGE_COUNT_KEY,       LONG_IMAGE_COUNT_DEFAULT,
  LONG_IMAGE_STEPS_KEY,
  LONG_THUMBNAIL_FAL_MODEL_KEY, LONG_THUMBNAIL_FAL_MODEL_DEFAULT,
  LONG_THUMBNAIL_LLM_MODEL_KEY, LONG_THUMBNAIL_LLM_MODEL_DEFAULT,
} from "@/lib/image-config-constants";

/** Đọc 1 config key, trả về null nếu chưa có */
export async function getAppConfig(key: string): Promise<string | null> {
  const row = await db.query.appConfig.findFirst({
    where: eq(appConfig.key, key),
  });
  return row?.value ?? null;
}

/** Ghi / cập nhật 1 config key */
export async function setAppConfig(key: string, value: string): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

// ── Typed helpers ─────────────────────────────────────────────

export async function getImagePromptModel(): Promise<string> {
  return (await getAppConfig(IMAGE_PROMPT_MODEL_KEY)) ?? IMAGE_PROMPT_MODEL_DEFAULT;
}
export async function setImagePromptModel(model: string): Promise<void> {
  await setAppConfig(IMAGE_PROMPT_MODEL_KEY, model);
}

export async function getFalImageModel(): Promise<string> {
  return (await getAppConfig(FAL_IMAGE_MODEL_KEY)) ?? FAL_IMAGE_MODEL_DEFAULT;
}
export async function setFalImageModel(model: string): Promise<void> {
  await setAppConfig(FAL_IMAGE_MODEL_KEY, model);
}

export async function getImageCount(): Promise<number> {
  const v = await getAppConfig(IMAGE_COUNT_KEY);
  return v ? parseInt(v) : IMAGE_COUNT_DEFAULT;
}
export async function setImageCount(count: number): Promise<void> {
  await setAppConfig(IMAGE_COUNT_KEY, String(count));
}

export async function getImageSteps(): Promise<number | null> {
  const v = await getAppConfig(IMAGE_STEPS_KEY);
  return v ? parseInt(v) : null;
}
export async function setImageSteps(steps: number): Promise<void> {
  await setAppConfig(IMAGE_STEPS_KEY, String(steps));
}

/** Đọc tất cả image config một lần */
export async function getImageConfig(): Promise<{
  llmModel: string;
  falModel: string;
  numImages: number;
  steps: number | null;
}> {
  const [llmModel, falModel, numImages, steps] = await Promise.all([
    getImagePromptModel(),
    getFalImageModel(),
    getImageCount(),
    getImageSteps(),
  ]);
  return { llmModel, falModel, numImages, steps };
}

// ── Long video image config ────────────────────────────────────

export async function getLongImagePromptModel(): Promise<string> {
  return (await getAppConfig(LONG_IMAGE_PROMPT_MODEL_KEY)) ?? LONG_IMAGE_PROMPT_MODEL_DEFAULT;
}
export async function setLongImagePromptModel(model: string): Promise<void> {
  await setAppConfig(LONG_IMAGE_PROMPT_MODEL_KEY, model);
}

export async function getLongFalImageModel(): Promise<string> {
  return (await getAppConfig(LONG_FAL_IMAGE_MODEL_KEY)) ?? LONG_FAL_IMAGE_MODEL_DEFAULT;
}
export async function setLongFalImageModel(model: string): Promise<void> {
  await setAppConfig(LONG_FAL_IMAGE_MODEL_KEY, model);
}

export async function getLongImageCount(): Promise<number> {
  const v = await getAppConfig(LONG_IMAGE_COUNT_KEY);
  return v ? parseInt(v) : LONG_IMAGE_COUNT_DEFAULT;
}
export async function setLongImageCount(count: number): Promise<void> {
  await setAppConfig(LONG_IMAGE_COUNT_KEY, String(count));
}

export async function getLongImageSteps(): Promise<number | null> {
  const v = await getAppConfig(LONG_IMAGE_STEPS_KEY);
  return v ? parseInt(v) : null;
}
export async function setLongImageSteps(steps: number): Promise<void> {
  await setAppConfig(LONG_IMAGE_STEPS_KEY, String(steps));
}

// ── Long video thumbnail config ────────────────────────────────

export async function getLongThumbnailFalModel(): Promise<string> {
  return (await getAppConfig(LONG_THUMBNAIL_FAL_MODEL_KEY)) ?? LONG_THUMBNAIL_FAL_MODEL_DEFAULT;
}
export async function setLongThumbnailFalModel(model: string): Promise<void> {
  await setAppConfig(LONG_THUMBNAIL_FAL_MODEL_KEY, model);
}

export async function getLongThumbnailLlmModel(): Promise<string> {
  return (await getAppConfig(LONG_THUMBNAIL_LLM_MODEL_KEY)) ?? LONG_THUMBNAIL_LLM_MODEL_DEFAULT;
}
export async function setLongThumbnailLlmModel(model: string): Promise<void> {
  await setAppConfig(LONG_THUMBNAIL_LLM_MODEL_KEY, model);
}

export async function getLongImageConfig(): Promise<{
  llmModel: string;
  falModel: string;
  numImages: number;
  steps: number | null;
  thumbnailFalModel: string;
  thumbnailLlmModel: string;
}> {
  const [llmModel, falModel, numImages, steps, thumbnailFalModel, thumbnailLlmModel] = await Promise.all([
    getLongImagePromptModel(),
    getLongFalImageModel(),
    getLongImageCount(),
    getLongImageSteps(),
    getLongThumbnailFalModel(),
    getLongThumbnailLlmModel(),
  ]);
  return { llmModel, falModel, numImages, steps, thumbnailFalModel, thumbnailLlmModel };
}
