"use server";

import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { runLongformEngine, type LongformEngineResult } from "@/lib/longform-engine";

const DEFAULT_MODEL = process.env.LONGFORM_MODEL ?? "google/gemini-2.0-flash";

export async function generateLongformPackage(params: {
  topic: string;
  script: string;
  audioDurationSec?: number;
  scriptPath?: string;
  videoPath?: string;
  thumbnailPath?: string;
}): Promise<LongformEngineResult> {
  const client = getOpenRouterClient();
  return runLongformEngine({
    client,
    model: DEFAULT_MODEL,
    ...params,
  });
}
