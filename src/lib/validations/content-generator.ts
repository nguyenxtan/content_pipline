import { z } from "zod";

export const generateContentSchema = z.object({
  nicheId: z.number().int().positive(),
  topic: z.string().min(3, "Topic phải có ít nhất 3 ký tự").max(200, "Topic tối đa 200 ký tự"),
});

export type GenerateContentInput = z.infer<typeof generateContentSchema>;

export const schedulerJobSchema = z.object({
  nicheId: z.number().int().positive(),
  topic: z.string().min(3).max(200),
  frequency: z.enum(["hourly", "4hourly", "daily", "custom"]),
  cronExpression: z.string().optional(),
}).refine(
  (data) => data.frequency !== "custom" || (data.cronExpression && data.cronExpression.trim().length > 0),
  { message: "Cron expression là bắt buộc khi chọn Custom", path: ["cronExpression"] }
);

export type SchedulerJobInput = z.infer<typeof schedulerJobSchema>;

export type GeneratedContentResult = {
  generationId: string;
  topic: string;
  nicheName: string;
  script: string;
  shortContent: string;
  longContent: string;
  totalTokens: number;
  totalCost: number;
  generationTime: number;
};

export const updateContentStatusSchema = z.object({
  ttsStatus: z.enum(["pending", "processing", "done", "error"]).optional(),
  ttsOutputUrl: z.string().optional(),
  ttsErrorMessage: z.string().optional(),
  youtubeUploadStatus: z.enum(["pending", "scheduled", "uploading", "done", "error"]).optional(),
  youtubeScheduledAt: z.date().optional(),
  youtubeVideoUrl: z.string().optional(),
  youtubeUploadError: z.string().optional(),
});

export type UpdateContentStatusInput = z.infer<typeof updateContentStatusSchema>;

export type ContentGenerationRow = {
  id: string;
  topic: string;
  nicheName: string;
  nicheId: number;
  script: string;
  shortContent: string;
  longContent: string;
  totalTokens: number;
  totalCost: number;
  generationTime: number;
  status: string;
  createdAt: Date;
  ttsStatus: string | null;
  ttsErrorMessage: string | null;
  ttsOutputUrl: string | null;
  youtubeUploadStatus: string | null;
  youtubeUploadError: string | null;
  youtubeVideoUrl: string | null;
  youtubeScheduledAt: Date | null;
  isLocked: boolean;
  lockedAt: Date | null;
  lockedBy: string | null;
};

export type SchedulerJobRecord = {
  id: string;
  topic: string;
  nicheName: string;
  frequency: string;
  cronExpression: string | null;
  isEnabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
};
