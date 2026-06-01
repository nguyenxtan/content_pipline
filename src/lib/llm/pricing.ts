// Per 1M tokens, USD — updated May 2026
export const MODEL_PRICING: Record<string, { input: number; output: number }> =
  {
    // OpenRouter — OpenAI
    "openai/gpt-4o": { input: 2.5, output: 10.0 },
    "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
    "openai/o1": { input: 15.0, output: 60.0 },
    "openai/o3-mini": { input: 1.1, output: 4.4 },
    // OpenRouter — Anthropic
    "anthropic/claude-3-5-sonnet": { input: 3.0, output: 15.0 },
    "anthropic/claude-3-5-haiku": { input: 0.8, output: 4.0 },
    "anthropic/claude-opus-4": { input: 15.0, output: 75.0 },
    // OpenRouter — Google
    "google/gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "google/gemini-2.5-pro": { input: 1.25, output: 5.0 },
    // OpenRouter — Meta
    "meta-llama/llama-3.3-70b-instruct": { input: 0.12, output: 0.3 },
    // Legacy direct model IDs (kept for DB records written before migration)
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-5": { input: 10.0, output: 40.0 },
    o1: { input: 15.0, output: 60.0 },
  };

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export const OPENROUTER_MODELS = [
  {
    value: "openai/gpt-4o",
    label: "GPT-4o",
    description: "High quality, higher cost",
    input: 2.5,
    output: 10.0,
  },
  {
    value: "openai/gpt-4o-mini",
    label: "GPT-4o mini",
    description: "Low cost, good quality",
    input: 0.15,
    output: 0.6,
  },
  {
    value: "anthropic/claude-3-5-sonnet",
    label: "Claude 3.5 Sonnet",
    description: "Best quality, mid cost",
    input: 3.0,
    output: 15.0,
  },
  {
    value: "anthropic/claude-3-5-haiku",
    label: "Claude 3.5 Haiku",
    description: "Fast, affordable",
    input: 0.8,
    output: 4.0,
  },
  {
    value: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    description: "Very fast, very cheap",
    input: 0.1,
    output: 0.4,
  },
  {
    value: "meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B",
    description: "Open source, very cheap",
    input: 0.12,
    output: 0.3,
  },
] as const;

export type OpenRouterModel = (typeof OPENROUTER_MODELS)[number]["value"];
