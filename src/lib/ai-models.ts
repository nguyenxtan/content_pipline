/**
 * Danh sách model AI trên OpenRouter — cập nhật tháng 5/2025
 * Giá: USD per 1 triệu token
 */

export type ModelProvider = "openai" | "google" | "anthropic" | "deepseek";

export interface AIModel {
  id: string;           // OpenRouter model ID
  name: string;         // Tên hiển thị
  provider: ModelProvider;
  releaseDate: string;  // YYYY-MM
  contextK: number;     // Context window (nghìn token)
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
  tags?: string[];      // "reasoning", "vision", "fast", "latest"
  description?: string;
}

export const AI_MODELS: AIModel[] = [
  // ── OpenAI / ChatGPT ──────────────────────────────────────────────────────
  {
    id: "openai/gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    releaseDate: "2025-04",
    contextK: 1047,
    inputPer1M: 2.0,
    outputPer1M: 8.0,
    tags: ["latest", "vision"],
    description: "Mạnh nhất dòng GPT-4.1, context 1M token",
  },
  {
    id: "openai/gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    provider: "openai",
    releaseDate: "2025-04",
    contextK: 1047,
    inputPer1M: 0.4,
    outputPer1M: 1.6,
    tags: ["latest", "fast"],
    description: "Nhanh, rẻ, chất lượng cao trong dòng 4.1",
  },
  {
    id: "openai/gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    provider: "openai",
    releaseDate: "2025-04",
    contextK: 1047,
    inputPer1M: 0.1,
    outputPer1M: 0.4,
    tags: ["latest", "fast"],
    description: "Siêu rẻ, phù hợp tác vụ đơn giản",
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    releaseDate: "2024-05",
    contextK: 128,
    inputPer1M: 2.5,
    outputPer1M: 10.0,
    tags: ["vision"],
    description: "Đa năng, tốt cho creative writing",
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    releaseDate: "2024-07",
    contextK: 128,
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    tags: ["fast"],
    description: "Nhanh, rẻ nhất dòng GPT-4o",
  },
  {
    id: "openai/o4-mini",
    name: "o4-mini",
    provider: "openai",
    releaseDate: "2025-04",
    contextK: 200,
    inputPer1M: 1.1,
    outputPer1M: 4.4,
    tags: ["latest", "reasoning"],
    description: "Reasoning model mới nhất, giỏi logic/toán",
  },
  {
    id: "openai/o3-mini",
    name: "o3-mini",
    provider: "openai",
    releaseDate: "2025-01",
    contextK: 200,
    inputPer1M: 1.1,
    outputPer1M: 4.4,
    tags: ["reasoning"],
    description: "Reasoning nhỏ, nhanh hơn o3",
  },

  // ── Google / Gemini ───────────────────────────────────────────────────────
  {
    id: "google/gemini-2.5-pro-preview",
    name: "Gemini 2.5 Pro",
    provider: "google",
    releaseDate: "2025-03",
    contextK: 1048,
    inputPer1M: 1.25,
    outputPer1M: 10.0,
    tags: ["latest", "reasoning", "vision"],
    description: "Mạnh nhất Gemini, context 1M, tích hợp reasoning",
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    releaseDate: "2025-06",
    contextK: 1048,
    inputPer1M: 1.25,
    outputPer1M: 10.0,
    tags: ["latest", "reasoning", "vision"],
    description: "Mạnh nhất Gemini 2.5, stable alias",
  },
  {
    id: "google/gemini-2.5-flash-preview",
    name: "Gemini 2.5 Flash (Preview)",
    provider: "google",
    releaseDate: "2025-04",
    contextK: 1048,
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    tags: ["latest", "fast", "vision"],
    description: "Nhanh, rẻ, context 1M token (preview alias)",
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    releaseDate: "2025-06",
    contextK: 1048,
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    tags: ["latest", "fast", "vision"],
    description: "Nhanh, rẻ, context 1M token — stable alias, default model cho Audio Story",
  },
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    provider: "google",
    releaseDate: "2025-06",
    contextK: 1048,
    inputPer1M: 0.075,
    outputPer1M: 0.30,
    tags: ["fast"],
    description: "Siêu rẻ — dùng cho QC/continuity check trong Audio Story",
  },
  {
    id: "google/gemini-2.0-flash-001",
    name: "Gemini 2.0 Flash",
    provider: "google",
    releaseDate: "2025-02",
    contextK: 1048,
    inputPer1M: 0.1,
    outputPer1M: 0.4,
    tags: ["fast", "vision"],
    description: "Siêu nhanh, đa phương thức",
  },
  {
    id: "google/gemini-2.0-flash-lite-001",
    name: "Gemini 2.0 Flash Lite",
    provider: "google",
    releaseDate: "2025-02",
    contextK: 1048,
    inputPer1M: 0.075,
    outputPer1M: 0.3,
    tags: ["fast"],
    description: "Siêu rẻ, nhẹ nhất Gemini 2.0",
  },
  {
    id: "google/gemini-flash-1.5",
    name: "Gemini Flash 1.5",
    provider: "google",
    releaseDate: "2024-05",
    contextK: 1000,
    inputPer1M: 0.075,
    outputPer1M: 0.3,
    tags: [],
    description: "Ổn định, giá rẻ",
  },
  {
    id: "google/gemini-pro-1.5",
    name: "Gemini Pro 1.5",
    provider: "google",
    releaseDate: "2024-02",
    contextK: 2000,
    inputPer1M: 1.25,
    outputPer1M: 5.0,
    tags: [],
    description: "Context dài nhất 1.5 series",
  },

  // ── Anthropic / Claude ────────────────────────────────────────────────────
  {
    id: "anthropic/claude-opus-4",
    name: "Claude Opus 4",
    provider: "anthropic",
    releaseDate: "2025-05",
    contextK: 200,
    inputPer1M: 15.0,
    outputPer1M: 75.0,
    tags: ["latest"],
    description: "Mạnh nhất Claude, viết văn xuất sắc",
  },
  {
    id: "anthropic/claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
    releaseDate: "2025-05",
    contextK: 200,
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    tags: ["latest"],
    description: "Cân bằng giữa chất lượng và giá",
  },
  {
    id: "anthropic/claude-3-5-haiku",
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    releaseDate: "2024-11",
    contextK: 200,
    inputPer1M: 0.8,
    outputPer1M: 4.0,
    tags: ["fast"],
    description: "Nhanh và rẻ nhất dòng Claude",
  },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  {
    id: "deepseek/deepseek-chat-v3-0324",
    name: "DeepSeek V3 (Mar 2025)",
    provider: "deepseek",
    releaseDate: "2025-03",
    contextK: 64,
    inputPer1M: 0.27,
    outputPer1M: 1.1,
    tags: ["latest"],
    description: "V3 cập nhật mới nhất, rất tốt giá/chất lượng",
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    provider: "deepseek",
    releaseDate: "2025-01",
    contextK: 64,
    inputPer1M: 0.55,
    outputPer1M: 2.19,
    tags: ["reasoning"],
    description: "Reasoning model mạnh, open source",
  },
  {
    id: "deepseek/deepseek-r1-distill-qwen-32b",
    name: "DeepSeek R1 Distill 32B",
    provider: "deepseek",
    releaseDate: "2025-01",
    contextK: 64,
    inputPer1M: 0.12,
    outputPer1M: 0.18,
    tags: ["reasoning", "fast"],
    description: "R1 distilled, rẻ hơn nhiều",
  },
];

export const PROVIDER_META: Record<ModelProvider, { label: string; color: string; border: string; bg: string }> = {
  openai:    { label: "ChatGPT / OpenAI",  color: "text-green-400",  border: "border-green-800/40",  bg: "bg-green-950/20" },
  google:    { label: "Gemini / Google",   color: "text-blue-400",   border: "border-blue-800/40",   bg: "bg-blue-950/20" },
  anthropic: { label: "Claude / Anthropic",color: "text-amber-400",  border: "border-amber-800/40",  bg: "bg-amber-950/20" },
  deepseek:  { label: "DeepSeek",          color: "text-violet-400", border: "border-violet-800/40", bg: "bg-violet-950/20" },
};

/** Tính cost từ token counts */
export function calcCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const m = AI_MODELS.find((m) => m.id === modelId);
  if (!m) {
    // fallback: search pricing.ts for backward compat
    return 0;
  }
  return (inputTokens * m.inputPer1M + outputTokens * m.outputPer1M) / 1_000_000;
}

/** Lấy pricing info cho 1 model */
export function getModelInfo(modelId: string): AIModel | undefined {
  return AI_MODELS.find((m) => m.id === modelId);
}

/** Group models by provider */
export function getModelsByProvider(): Record<ModelProvider, AIModel[]> {
  return AI_MODELS.reduce((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {} as Record<ModelProvider, AIModel[]>);
}
