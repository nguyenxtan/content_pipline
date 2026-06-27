import { z } from "zod";
import type { PromptVersionSnapshot } from "@/lib/prompt-version-registry";
import type { ContentFormatType } from "@/lib/content-format-type";

export const generateContentSchema = z.object({
  nicheId: z.number().int().positive(),
  topic: z.string().min(3, "Topic phải có ít nhất 3 ký tự").max(200, "Topic tối đa 200 ký tự"),
});

export type GenerateContentInput = z.infer<typeof generateContentSchema>;

export const schedulerJobSchema = z.object({
  nicheId: z.number().int().positive(),
  jobType: z.enum(["content_gen", "short_pipeline", "long_pipeline", "quote_pipeline"]).default("content_gen"),
  contentMode: z.enum(["short", "long", "both"]).default("both"),
  batchSize: z.number().int().min(1).max(20).default(3),
  topic: z.string().max(200).default(""),
  frequency: z.enum(["15min","30min","45min","hourly","90min","2hourly","3hourly","4hourly","6hourly","12hourly","daily","custom"]),
  cronExpression: z.string().optional(),
  topicModel: z.string().default("openai/gpt-4o-mini"),
  scriptModel: z.string().default("openai/gpt-4o-mini"),
  ttsVoice:       z.string().optional(),
  imageCount:     z.number().int().min(1).max(20).optional(),
  imageStyle:     z.string().max(500).optional(),
  longImageCount:        z.number().int().min(1).max(20).optional(),
  longImageStyle:        z.string().max(50).optional(),
  longFalModel:          z.string().max(100).optional(),
  longThumbnailFalModel:      z.string().max(100).optional(),
  longThumbnailLlmModel:      z.string().max(100).optional(),
  longThumbnailImageStyle:    z.string().max(50).optional(),
  bgMusic: z.boolean().optional(),
}).refine(
  (data) => data.frequency !== "custom" || (data.cronExpression && data.cronExpression.trim().length > 0),
  { message: "Cron expression là bắt buộc khi chọn Custom", path: ["cronExpression"] }
);

export type SchedulerJobInput = z.infer<typeof schedulerJobSchema>;

export type GeneratedContentResult = {
  generationId: string;
  topic: string;
  nicheName: string;
  contentProfileKey: string;
  channelKey: string;
  script: string;
  shortContent: string;
  shortHookCandidates: string[];
  shortSelectedHook: string | null;
  hookPattern: string | null;
  hookType: string | null;
  longContent: string;
  promptVersions: PromptVersionSnapshot | null;
  experimentId: string | null;
  experimentVariant: string | null;
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
  formatType: ContentFormatType;
  contentMode: string;
  topic: string;
  nicheName: string;
  nicheId: number;
  contentProfileKey: string;
  channelKey: string;
  script: string;
  shortContent: string;
  shortHookCandidates: string[];
  shortSelectedHook: string | null;
  longContent: string;
  promptVersions: PromptVersionSnapshot | null;
  experimentId: string | null;
  experimentVariant: string | null;
  totalTokens: number;
  totalCost: number;
  generationTime: number;
  status: string;
  createdAt: Date;
  // Short pipeline
  ttsStatus: string | null;
  ttsErrorMessage: string | null;
  ttsOutputUrl: string | null;
  audioPath: string | null;
  ttsDurationMs: number | null;        // thời gian gen TTS short (ms)
  imagesStatus: string | null;
  imagesErrorMessage: string | null;
  imagePaths: string[] | null;
  imagesDurationMs: number | null;      // thời gian gen ảnh (ms)
  imagesCostUsd: string | null;         // tổng chi phí tạo ảnh (USD, string vì numeric)
  videoStatus: string | null;
  videoErrorMessage: string | null;
  videoPath: string | null;
  shortCoverText: string | null;
  shortCoverAssetPath: string | null;
  shortCoverGeneratedAt: Date | null;
  // Long pipeline
  longTtsStatus: string | null;
  longTtsErrorMessage: string | null;
  longAudioPath: string | null;
  longTtsDurationMs: number | null;
  longImagesStatus: string | null;
  longImagesErrorMessage: string | null;
  longImagePaths: string[] | null;
  longImagesDurationMs: number | null;
  longImagesCostUsd: string | null;
  longThumbnailPath: string | null;
  longYoutubeDescription: string | null;
  longVideoStatus: string | null;
  longVideoErrorMessage: string | null;
  longVideoPath: string | null;
  // YouTube (short)
  youtubeUploadStatus: string | null;
  youtubeUploadError: string | null;
  youtubeVideoUrl: string | null;
  youtubeScheduledAt: Date | null;
  // YouTube (long)
  longYoutubeUploadStatus: string | null;
  longYoutubeUploadError: string | null;
  longYoutubeVideoUrl: string | null;
  longYoutubeScheduledAt: Date | null;
  // Facebook
  facebookUploadStatus: string | null;
  facebookUploadError: string | null;
  facebookVideoUrl: string | null;
  // Cleanup
  completedAt: Date | null;
  mediaCleanedAt: Date | null;
  // Lock
  isLocked: boolean;
  lockedAt: Date | null;
  lockedBy: string | null;
};

export type SchedulerJobRecord = {
  id: string;
  jobType: "content_gen" | "short_pipeline" | "long_pipeline" | "quote_pipeline";
  contentMode: "short" | "long" | "both";
  batchSize: number;
  topic: string;
  nicheName: string;
  nicheId: number;
  frequency: string;
  cronExpression: string | null;
  isEnabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  topicModel: string | null;
  scriptModel: string | null;
  ttsVoice:       string | null;
  imageCount:     number | null;
  imageStyle:     string | null;
  longImageCount:        number | null;
  longImageStyle:        string | null;
  longFalModel:          string | null;
  longThumbnailFalModel:      string | null;
  longThumbnailLlmModel:      string | null;
  longThumbnailImageStyle:    string | null;
  bgMusic:                    boolean | null;
};
