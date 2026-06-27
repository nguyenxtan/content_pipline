import type { getPromptStudioSnapshot } from "@/lib/prompt-studio-registry";

export type ActiveDbPromptTemplate = {
  id: number;
  nicheName: string;
  stage: string;
  name: string;
  model: string;
  version: number;
  isActive: boolean;
};

export type PromptStudioSnapshot = ReturnType<typeof getPromptStudioSnapshot> & {
  activeDbTemplates: ActiveDbPromptTemplate[];
};

export type SuggestPromptOptionsInput = {
  channelProfileId?: string;
  contentFormatId?: string;
  topicFamilyId?: string;
  topic?: string;
};

export type SuggestPromptOptionsResult = {
  ok: boolean;
  source: "ai" | "fallback";
  suggestions: {
    topicFamilies: string[];
    quoteStyles: string[];
    visualMoods: string[];
    hookAngles: string[];
  };
  note: string;
  error?: string;
};
