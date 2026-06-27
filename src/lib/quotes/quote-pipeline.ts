import { getContentProfile } from "@/lib/config/content-profiles";
import { getOpenRouterClient } from "@/lib/llm/openai-client";
import { buildFallbackQuote, validateQuoteText } from "@/lib/quotes/quote-quality";
import { resolveQuoteVisualStyle } from "@/lib/quotes/quote-style";
import type { PromptVersionSnapshot } from "@/lib/prompt-version-registry";

export type QuoteSourceType =
  | "independent_llm"
  | "extracted_from_short"
  | "fallback"
  | "manual";

export type QuoteValidationStatus = "passed" | "fallback_passed";

export type QuoteArtifactMetadata = {
  quoteText: string;
  quoteSourceType: QuoteSourceType;
  quoteStyle: "static_deep_quote" | "default";
  kinetic: boolean;
  sourceContentId: string | null;
  sourceFormatType: string | null;
  channelKey: string | null;
  nicheName: string | null;
  validationStatus: QuoteValidationStatus;
  validationReasons: string[];
  generatedAt: string;
  generatorVersion: "quote-pipeline-v1";
  model: string | null;
};

export type QuoteArtifactResolution = {
  quoteText: string;
  metadata: QuoteArtifactMetadata;
  usage:
    | {
        model: string;
        inputTokens: number;
        outputTokens: number;
      }
    | null;
};

type QuoteResolverInput = {
  topic: string;
  shortContent?: string | null;
  contentProfileKey?: string | null;
  channelKey?: string | null;
  nicheName?: string | null;
  sourceContentId?: string | null;
  sourceFormatType?: string | null;
};

type IndependentQuoteAttempt = {
  quoteText: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

type QuoteResolverDeps = {
  generateIndependentQuote?: (input: QuoteResolverInput) => Promise<IndependentQuoteAttempt>;
};

const QUOTE_PIPELINE_VERSION = "quote-pipeline-v1" as const;
const DEFAULT_QUOTE_MODEL =
  process.env.QUOTE_GEN_MODEL ??
  process.env.CONTENT_GEN_MODEL ??
  process.env.NEXT_PUBLIC_LLM_TEST_MODEL ??
  "openai/gpt-4o-mini";

function normalizeQuoteWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFacebookQuoteCandidate(shortContent?: string | null): string | null {
  const normalized = normalizeQuoteWhitespace(shortContent ?? "");
  if (!normalized) return null;
  const sentence = normalized
    .split(/(?<=[.!?…])\s+/)
    .map((part) => part.trim())
    .find((part) => part.length >= 40);
  return sentence && sentence.length > 0 ? sentence : null;
}

export function readStoredQuoteArtifactMetadata(
  promptVersions: unknown,
): QuoteArtifactMetadata | null {
  const snapshot = promptVersions && typeof promptVersions === "object"
    ? promptVersions as PromptVersionSnapshot
    : null;
  const details = snapshot?.quote?.details;
  if (!details || typeof details !== "object") return null;

  const candidate = details as Partial<QuoteArtifactMetadata>;
  if (typeof candidate.quoteText !== "string" || typeof candidate.quoteSourceType !== "string") {
    return null;
  }

  return {
    quoteText: candidate.quoteText,
    quoteSourceType: candidate.quoteSourceType as QuoteSourceType,
    quoteStyle: candidate.quoteStyle === "static_deep_quote" ? "static_deep_quote" : "default",
    kinetic: candidate.kinetic === true,
    sourceContentId: typeof candidate.sourceContentId === "string" ? candidate.sourceContentId : null,
    sourceFormatType: typeof candidate.sourceFormatType === "string" ? candidate.sourceFormatType : null,
    channelKey: typeof candidate.channelKey === "string" ? candidate.channelKey : null,
    nicheName: typeof candidate.nicheName === "string" ? candidate.nicheName : null,
    validationStatus: candidate.validationStatus === "passed" ? "passed" : "fallback_passed",
    validationReasons: Array.isArray(candidate.validationReasons)
      ? candidate.validationReasons.filter((item): item is string => typeof item === "string")
      : [],
    generatedAt: typeof candidate.generatedAt === "string" ? candidate.generatedAt : new Date(0).toISOString(),
    generatorVersion: QUOTE_PIPELINE_VERSION,
    model: typeof candidate.model === "string" ? candidate.model : null,
  };
}

async function generateIndependentQuoteDefault(
  input: QuoteResolverInput,
): Promise<IndependentQuoteAttempt> {
  const client = getOpenRouterClient();
  const model = DEFAULT_QUOTE_MODEL;
  const shortExcerpt = normalizeQuoteWhitespace(input.shortContent ?? "").slice(0, 700);
  const response = await client.chat.completions.create({
    model,
    temperature: 0.7,
    max_tokens: 140,
    messages: [
      {
        role: "system",
        content:
          "Bạn viết một câu quote tiếng Việt ngắn cho ảnh Facebook. Chỉ trả về đúng 1 quote, không tiêu đề, không gạch đầu dòng, không giải thích.",
      },
      {
        role: "user",
        content: [
          `Chủ đề: ${input.topic}`,
          shortExcerpt ? `Nguồn shortContent: ${shortExcerpt}` : "",
          "Yêu cầu:",
          "- Viết 1-2 câu, tổng 18-36 từ.",
          "- Giọng chiêm nghiệm Phật pháp, sâu nhưng không lên lớp, không hô hào.",
          "- Không dùng các cliché như 'tâm an vạn sự an', 'mọi chuyện rồi sẽ qua', 'hãy sống chậm lại'.",
          "- Không thêm hashtag, emoji, ngoặc kép, danh sách, tiêu đề, hay lời dẫn.",
          "- Chỉ trả về duy nhất câu quote hoàn chỉnh.",
        ].filter(Boolean).join("\n"),
      },
    ],
  });

  const quoteText = normalizeQuoteWhitespace(response.choices[0]?.message?.content ?? "");
  return {
    quoteText,
    model,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}

function buildResolvedMetadata(
  input: QuoteResolverInput,
  quoteText: string,
  sourceType: QuoteSourceType,
  validationReasons: string[],
  model: string | null,
): QuoteArtifactMetadata {
  const style = resolveQuoteVisualStyle({
    channelKey: input.channelKey,
    contentProfileKey: input.contentProfileKey,
    nicheName: input.nicheName,
    platform: "facebook",
    videoType: "quote",
  });
  return {
    quoteText,
    quoteSourceType: sourceType,
    quoteStyle: style.style,
    kinetic: style.kinetic,
    sourceContentId: input.sourceContentId ?? null,
    sourceFormatType: input.sourceFormatType ?? null,
    channelKey: input.channelKey ?? null,
    nicheName: input.nicheName ?? null,
    validationStatus: sourceType === "independent_llm" ? "passed" : "fallback_passed",
    validationReasons,
    generatedAt: new Date().toISOString(),
    generatorVersion: QUOTE_PIPELINE_VERSION,
    model,
  };
}

export function buildQuoteArtifactMetadata(input: {
  quoteText: string;
  quoteSourceType: QuoteSourceType;
  validationReasons?: string[];
  model?: string | null;
  contentProfileKey?: string | null;
  channelKey?: string | null;
  nicheName?: string | null;
  sourceContentId?: string | null;
  sourceFormatType?: string | null;
}): QuoteArtifactMetadata {
  return buildResolvedMetadata(
    {
      topic: "",
      shortContent: null,
      contentProfileKey: input.contentProfileKey,
      channelKey: input.channelKey,
      nicheName: input.nicheName,
      sourceContentId: input.sourceContentId,
      sourceFormatType: input.sourceFormatType,
    },
    input.quoteText,
    input.quoteSourceType,
    input.validationReasons ?? [],
    input.model ?? null,
  );
}

export async function resolveFacebookQuoteArtifact(
  input: QuoteResolverInput,
  deps?: QuoteResolverDeps,
): Promise<QuoteArtifactResolution> {
  const styleInput = {
    channelKey: input.channelKey,
    contentProfileKey: input.contentProfileKey,
    nicheName: input.nicheName,
  };
  const independentGenerator = deps?.generateIndependentQuote ?? generateIndependentQuoteDefault;
  const validationReasons: string[] = [];

  try {
    const llmAttempt = await independentGenerator(input);
    const validation = validateQuoteText(llmAttempt.quoteText, styleInput);
    if (validation.ok) {
      const quoteText = validation.normalized;
      return {
        quoteText,
        metadata: buildResolvedMetadata(
          input,
          quoteText,
          "independent_llm",
          [],
          llmAttempt.model,
        ),
        usage: {
          model: llmAttempt.model,
          inputTokens: llmAttempt.inputTokens,
          outputTokens: llmAttempt.outputTokens,
        },
      };
    }
    validationReasons.push(...validation.issues.map((issue) => `independent:${issue}`));
  } catch (error) {
    validationReasons.push(
      `independent_error:${error instanceof Error ? error.message : String(error)}`.slice(0, 240),
    );
  }

  const extracted = extractFacebookQuoteCandidate(input.shortContent);
  if (extracted) {
    const validation = validateQuoteText(extracted, styleInput);
    if (validation.ok) {
      const quoteText = validation.normalized;
      return {
        quoteText,
        metadata: buildResolvedMetadata(
          input,
          quoteText,
          "extracted_from_short",
          validationReasons,
          null,
        ),
        usage: null,
      };
    }
    validationReasons.push(...validation.issues.map((issue) => `extracted:${issue}`));
  } else {
    validationReasons.push("extracted:no_sentence");
  }

  const profile = getContentProfile(input.contentProfileKey);
  const seededFallback = profile.defaultQuoteFallback.replace("{{topic}}", input.topic.trim());
  const seededValidation = validateQuoteText(seededFallback, styleInput);
  const fallbackQuote = seededValidation.ok
    ? seededValidation.normalized
    : buildFallbackQuote(styleInput, input.topic);
  const finalValidation = validateQuoteText(fallbackQuote, styleInput);
  const quoteText = finalValidation.normalized;
  return {
    quoteText,
    metadata: buildResolvedMetadata(
      input,
      quoteText,
      "fallback",
      validationReasons,
      null,
    ),
    usage: null,
  };
}
