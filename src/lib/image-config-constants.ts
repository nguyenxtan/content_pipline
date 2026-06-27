// ── Short video images ──────────────────────────────────────────────────────
export const IMAGE_PROMPT_MODEL_KEY     = "image_prompt_model";
export const IMAGE_PROMPT_MODEL_DEFAULT = "openai/gpt-4o-mini";

export const FAL_IMAGE_MODEL_KEY     = "fal_image_model";
export const FAL_IMAGE_MODEL_DEFAULT = "fal-ai/flux/schnell";

export const FAL_IMAGE_SIZE_KEY     = "fal_image_size";
export const FAL_IMAGE_SIZE_DEFAULT = "portrait_16_9";

export const IMAGE_COUNT_KEY     = "image_count";
export const IMAGE_COUNT_DEFAULT = 1;

export const IMAGE_STEPS_KEY = "image_steps";

// ── Long video images (riêng, model xịn hơn) ──────────────────────────────
export const LONG_IMAGE_PROMPT_MODEL_KEY     = "long_image_prompt_model";
export const LONG_IMAGE_PROMPT_MODEL_DEFAULT = "openai/gpt-4o-mini";

export const LONG_FAL_IMAGE_MODEL_KEY     = "long_fal_image_model";
export const LONG_FAL_IMAGE_MODEL_DEFAULT = "fal-ai/flux/dev";

export const LONG_IMAGE_COUNT_KEY     = "long_image_count";
export const LONG_IMAGE_COUNT_DEFAULT = 5;

export const LONG_IMAGE_STEPS_KEY = "long_image_steps";

// ── Long video thumbnail (riêng, model VIP nhất) ───────────────────────────
export const LONG_THUMBNAIL_FAL_MODEL_KEY     = "long_thumbnail_fal_model";
export const LONG_THUMBNAIL_FAL_MODEL_DEFAULT = "fal-ai/flux-pro/v1.1-ultra";

export const LONG_THUMBNAIL_LLM_MODEL_KEY     = "long_thumbnail_llm_model";
export const LONG_THUMBNAIL_LLM_MODEL_DEFAULT = "openai/gpt-4o-mini";

// ── Premium longform single master image (never reuses short visual settings) ──
export const LONGFORM_MASTER_IMAGE_FAL_MODEL_KEY     = "longform_master_image_fal_model";
export const LONGFORM_MASTER_IMAGE_FAL_MODEL_DEFAULT = "fal-ai/flux-pro/v1.1-ultra";

export const LONGFORM_MASTER_IMAGE_LLM_MODEL_KEY     = "longform_master_image_llm_model";
export const LONGFORM_MASTER_IMAGE_LLM_MODEL_DEFAULT = "anthropic/claude-sonnet-4-6";
