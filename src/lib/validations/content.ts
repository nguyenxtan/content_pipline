import { z } from "zod";

export const generateContentSchema = z.object({
  nicheId: z.number().int().positive(),
  stage: z.string().min(1),
  promptTemplateId: z.number().int().positive(),
  inputVariables: z.record(z.string(), z.string()),
  model: z.string().optional(),
});

export type GenerateContentInput = z.infer<typeof generateContentSchema>;

export type GenerationResult = {
  id: string;
  status: "pending" | "processing" | "done" | "error";
  output?: string | null;
  outputTokens?: number | null;
  totalCost?: number | null;
  generationTime?: number | null;
  errorMessage?: string | null;
};

export type PromptVersionInfo = {
  id: number;
  name: string;
  content: string;
  variables: string[];
  model: string;
  temperature: string;
  maxTokens: number;
  version: number;
  isActive: boolean;
  createdAt: Date;
  testRunCount: number;
  avgCost: number;
};

export type RecentGenerationItem = {
  id: string;
  nicheId: number;
  stage: string;
  status: string;
  output: string | null;
  createdAt: Date;
  niche: { name: string; icon: string | null };
};
