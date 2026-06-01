export const PURPOSE_LABELS: Record<string, string> = {
  content_script:   "Script outline",
  content_short:    "Short video",
  content_long:     "Long video",
  topic_suggest:    "Gợi ý chủ đề",
  niche_prompt:     "Tạo prompt từ phân mục",
  niche_create:     "Tạo phân mục (AI)",
  image_prompts:    "Sinh image prompts (LLM)",
  image_generation: "Tạo ảnh (fal.ai)",
};

export function getPurposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose] ?? purpose;
}
