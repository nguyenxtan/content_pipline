import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export type RunPromptParams = {
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
};

export type RunPromptResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export async function runPrompt(
  params: RunPromptParams
): Promise<RunPromptResult> {
  const client = getAnthropicClient();
  const start = Date.now();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: params.userPrompt },
  ];

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens ?? 4000,
    temperature: params.temperature ?? 0.7,
    ...(params.systemPrompt ? { system: params.systemPrompt } : {}),
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : "";

  return {
    content,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    durationMs: Date.now() - start,
  };
}
