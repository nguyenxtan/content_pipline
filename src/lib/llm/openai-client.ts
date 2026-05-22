import OpenAI from "openai";

let routerClient: OpenAI | null = null;

export function getOpenRouterClient(): OpenAI {
  if (!routerClient) {
    routerClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-Title": "Content Pipeline",
      },
    });
  }
  return routerClient;
}

// Kept for backward compatibility
export const getOpenAIClient = getOpenRouterClient;
