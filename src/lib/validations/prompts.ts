import { z } from "zod";

export const savePromptSchema = z.object({
  nicheId: z.number().int().positive(),
  stage: z.string().min(1),
  name: z.string().min(2, "Tên phải có ít nhất 2 ký tự").max(200),
  content: z.string().min(1, "Nội dung không được để trống"),
  model: z.string().min(1),
  temperature: z.number().min(0).max(1),
  maxTokens: z.number().int().min(500).max(8000),
});

export type SavePromptValues = z.infer<typeof savePromptSchema>;

export type SavePromptState = {
  success?: boolean;
  templateId?: number;
  version?: number;
  error?: string;
  fieldErrors?: Partial<Record<keyof SavePromptValues, string[]>>;
} | null;

export const testPromptSchema = z.object({
  content: z.string().min(1),
  variables: z.record(z.string(), z.string()),
  model: z.string().min(1),
  temperature: z.number().min(0).max(1),
  maxTokens: z.number().int().min(100).max(8000),
});

export type TestPromptValues = z.infer<typeof testPromptSchema>;

export type TestPromptResult = {
  success: boolean;
  output?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs?: number;
  error?: string;
  runId?: string;
};
