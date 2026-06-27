import {
  pgTable,
  serial,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { PromptVersionSnapshot } from "@/lib/prompt-version-registry";

export const niches = pgTable("niches", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  contentProfileKey: varchar("content_profile_key", { length: 50 })
    .default("buddhism")
    .notNull(),
  channelKey: varchar("channel_key", { length: 50 })
    .default("phat_phap")
    .notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 10 }),
  category: varchar("category", { length: 100 }),
  targetAudience: text("target_audience"),
  tone: text("tone"),
  stages: jsonb("stages")
    .$type<string[]>()
    .notNull()
    .default(["ideation", "script", "short", "long"]),
  // Media config
  musicFolder: varchar("music_folder", { length: 200 }), // relative path inside media/music/
  videoType: varchar("video_type", { length: 20 }).default("both"), // 'short' | 'long' | 'both'
  ttsVoice: varchar("tts_voice", { length: 50 }).default("Ly"), // VieNeu-TTS voice ID
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: serial("id").primaryKey(),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 50 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    content: text("content").notNull(),
    variables: jsonb("variables").$type<string[]>().default([]).notNull(),
    model: varchar("model", { length: 50 })
      .default("claude-sonnet-4-6")
      .notNull(),
    temperature: numeric("temperature", { precision: 3, scale: 2 })
      .default("0.7")
      .notNull(),
    maxTokens: integer("max_tokens").default(4000).notNull(),
    version: integer("version").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    parentId: integer("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_templates_niche_stage").on(table.nicheId, table.stage),
    uniqueIndex("uniq_niche_stage_version").on(
      table.nicheId,
      table.stage,
      table.version
    ),
  ]
);

export const contentPieces = pgTable(
  "content_pieces",
  {
    id: serial("id").primaryKey(),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id),
    title: text("title"),
    status: varchar("status", { length: 50 })
      .default("idea_pending")
      .notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_pieces_status").on(table.status),
    index("idx_pieces_niche").on(table.nicheId),
  ]
);

export const contentOutputs = pgTable(
  "content_outputs",
  {
    id: serial("id").primaryKey(),
    pieceId: integer("piece_id")
      .notNull()
      .references(() => contentPieces.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 50 }).notNull(),
    promptTemplateId: integer("prompt_template_id").references(
      () => promptTemplates.id
    ),
    promptRendered: text("prompt_rendered"),
    outputRaw: text("output_raw"),
    outputJson: jsonb("output_json"),
    model: varchar("model", { length: 50 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    durationMs: integer("duration_ms"),
    status: varchar("status", { length: 20 }).default("success").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_outputs_piece_stage").on(table.pieceId, table.stage)]
);

export const agentSuggestions = pgTable("agent_suggestions", {
  id: serial("id").primaryKey(),
  nicheId: integer("niche_id").references(() => niches.id),
  userInput: jsonb("user_input").notNull(),
  suggestedPrompts: jsonb("suggested_prompts").notNull(),
  accepted: boolean("accepted").default(false).notNull(),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const ttsVoices = pgTable(
  "tts_voices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    provider: varchar("provider", { length: 50 }).notNull(),
    voiceId: text("voice_id").notNull(),
    name: text("name").notNull(),
    gender: varchar("gender", { length: 50 }),
    age: varchar("age", { length: 50 }),
    language: varchar("language", { length: 100 }),
    category: text("category"),
    useCase: text("use_case"),
    rawJson: jsonb("raw_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uniq_tts_voices_provider_voice").on(table.provider, table.voiceId),
    index("idx_tts_voices_provider").on(table.provider),
    index("idx_tts_voices_language").on(table.language),
  ]
);

export const ttsJobs = pgTable(
  "tts_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    provider: varchar("provider", { length: 50 }).notNull(),
    externalJobId: text("external_job_id").notNull(),
    voiceId: text("voice_id"),
    chapterId: text("chapter_id"),
    status: varchar("status", { length: 40 }).notNull().default("queued"),
    creditUsed: numeric("credit_used", { precision: 12, scale: 4 }),
    audioUrl: text("audio_url"),
    srtUrl: text("srt_url"),
    rawJson: jsonb("raw_json"),
    // Usage tracking fields (added in 0040_tts_usage_tracking)
    pipelineRoute: varchar("pipeline_route", { length: 80 }),
    contentId: text("content_id"),
    contentProfileKey: text("content_profile_key"),
    nicheName: text("niche_name"),
    formatType: text("format_type"),
    voiceLabel: text("voice_label"),
    voiceFamily: varchar("voice_family", { length: 80 }),
    speed: numeric("speed", { precision: 6, scale: 3 }),
    pitch: numeric("pitch", { precision: 6, scale: 3 }),
    textHash: text("text_hash"),
    textCharCount: integer("text_char_count"),
    cacheIdentity: text("cache_identity"),
    cacheHit: boolean("cache_hit").default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    usageSource: varchar("usage_source", { length: 30 }),
    estimatedCredits: numeric("estimated_credits", { precision: 12, scale: 4 }),
    balanceBefore: numeric("balance_before", { precision: 14, scale: 4 }),
    balanceAfter: numeric("balance_after", { precision: 14, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uniq_tts_jobs_provider_external").on(table.provider, table.externalJobId),
    index("idx_tts_jobs_provider_status").on(table.provider, table.status),
    index("idx_tts_jobs_chapter").on(table.chapterId),
    index("idx_tts_jobs_content_id").on(table.contentId),
    index("idx_tts_jobs_pipeline_route_created").on(table.pipelineRoute, table.createdAt),
    index("idx_tts_jobs_provider_created_at").on(table.provider, table.createdAt),
    index("idx_tts_jobs_voice_family_created").on(table.voiceFamily, table.createdAt),
    index("idx_tts_jobs_status_created").on(table.status, table.createdAt),
    index("idx_tts_jobs_cache_hit").on(table.cacheHit),
  ]
);

export const generatedContents = pgTable(
  "generated_contents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 50 }).notNull(),
    promptTemplateId: integer("prompt_template_id")
      .notNull()
      .references(() => promptTemplates.id),
    promptVersion: integer("prompt_version").notNull(),
    inputVariables: jsonb("input_variables")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    output: text("output"),
    generationTime: integer("generation_time"),
    outputTokens: integer("output_tokens"),
    totalCost: numeric("total_cost", { precision: 10, scale: 6 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    errorMessage: text("error_message"),
    n8nWorkflowId: varchar("n8n_workflow_id", { length: 200 }),
    n8nExecutionId: varchar("n8n_execution_id", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_contents_niche_stage").on(table.nicheId, table.stage),
    index("idx_contents_status").on(table.status),
    index("idx_contents_created_at").on(table.createdAt),
  ]
);

export const promptTestRuns = pgTable(
  "prompt_test_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 50 }).notNull(),
    promptTemplateId: integer("prompt_template_id").references(
      () => promptTemplates.id,
      { onDelete: "set null" }
    ),
    model: varchar("model", { length: 100 }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalCost: numeric("total_cost", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    output: text("output"),
    inputVariables: jsonb("input_variables")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    status: varchar("status", { length: 20 }).notNull().default("success"),
    errorMessage: text("error_message"),
    openrouterId: varchar("openrouter_id", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_test_runs_niche_stage").on(table.nicheId, table.stage),
    index("idx_test_runs_template").on(table.promptTemplateId),
  ]
);

export const contentGenerations = pgTable(
  "content_generations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    topic: text("topic").notNull(),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    nicheName: varchar("niche_name", { length: 100 }).notNull(),
    contentProfileKey: varchar("content_profile_key", { length: 50 })
      .default("buddhism")
      .notNull(),
    channelKey: varchar("channel_key", { length: 50 })
      .default("phat_phap")
      .notNull(),
    script: text("script").notNull(),
    shortContent: text("short_content").notNull(),
    shortHookCandidates: jsonb("short_hook_candidates").$type<string[]>().default([]),
    shortSelectedHook: text("short_selected_hook"),
    hookScoredCandidates: jsonb("hook_scored_candidates").$type<Array<{
      index: number;
      hook: string;
      scores: { curiosity: number; emotion: number; relatability: number; retention: number; total: number };
    }>>().default([]),
    hookScore: integer("hook_score"),
    hookPattern: varchar("hook_pattern", { length: 50 }),
    hookType: varchar("hook_type", { length: 50 }),          // English type: question|shock|contradiction|...
    hookVariant: varchar("hook_variant", { length: 100 }),   // experiment variant or selection strategy
    hookGeneratedAt: timestamp("hook_generated_at", { withTimezone: true }),
    longContent: text("long_content").notNull(),
    promptVersions: jsonb("prompt_versions").$type<PromptVersionSnapshot>().default({}),
    experimentId: text("experiment_id"),
    experimentVariant: text("experiment_variant"),
    // ── Phase 6: Observability ─────────────────────────────────
    thumbnailText: text("thumbnail_text"),          // text rendered on thumbnail
    renderTimeTotalMs: integer("render_time_total_ms"), // wall-clock pipeline time
    mainModelUsed: varchar("main_model_used", { length: 100 }), // model for hook+script
    totalTokens: integer("total_tokens"),
    totalCost: numeric("total_cost", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    generationTime: integer("generation_time"),
    status: varchar("status", { length: 20 }).notNull().default("completed"),
    errorMessage: text("error_message"),
    // ── Short content pipeline ─────────────────────────────────
    ttsStatus: varchar("tts_status", { length: 20 }).default("pending"),
    ttsErrorMessage: text("tts_error_message"),
    ttsOutputUrl: text("tts_output_url"),   // legacy
    audioPath: text("audio_path"),          // media/audio/{id}.wav
    ttsDurationMs: integer("tts_duration_ms"),  // thời gian gen TTS (ms)
    imagesStatus: varchar("images_status", { length: 20 }).default("pending"),
    imagesErrorMessage: text("images_error_message"),
    imagePaths: jsonb("image_paths").$type<string[]>().default([]),
    imagesDurationMs: integer("images_duration_ms"),   // tổng thời gian gen ảnh (ms)
    imagesCostUsd: numeric("images_cost_usd", { precision: 10, scale: 6 }), // tổng chi phí (LLM + fal.ai)
    videoStatus: varchar("video_status", { length: 20 }).default("pending"),
    videoErrorMessage: text("video_error_message"),
    videoPath: text("video_path"),          // media/videos/{id}-short.mp4
    // ── Long content pipeline ──────────────────────────────────
    longImagesStatus: varchar("long_images_status", { length: 20 }).default("pending"),
    longImagesErrorMessage: text("long_images_error_message"),
    longImagePaths: jsonb("long_image_paths").$type<string[]>().default([]),
    longImagesDurationMs: integer("long_images_duration_ms"),
    longImagesCostUsd: numeric("long_images_cost_usd", { precision: 10, scale: 6 }),
    longThumbnailPath: text("long_thumbnail_path"),
    longYoutubeDescription: text("long_youtube_description"),
    longTtsStatus: varchar("long_tts_status", { length: 20 }).default("pending"),
    longTtsErrorMessage: text("long_tts_error_message"),
    longAudioPath: text("long_audio_path"), // media/audio/{id}-long.wav
    longTtsDurationMs: integer("long_tts_duration_ms"),  // thời gian gen TTS long (ms)
    longVideoStatus: varchar("long_video_status", { length: 20 }).default("pending"),
    longVideoErrorMessage: text("long_video_error_message"),
    longVideoPath: text("long_video_path"), // media/videos/{id}-long.mp4
    // ── YouTube (short) ────────────────────────────────────────
    youtubeUploadStatus: varchar("youtube_upload_status", { length: 20 }).default("pending"),
    youtubeUploadError: text("youtube_upload_error"),
    youtubeVideoUrl: text("youtube_video_url"),
    youtubeScheduledAt: timestamp("youtube_scheduled_at", { withTimezone: true }),
    // ── YouTube (long) ─────────────────────────────────────────
    longYoutubeUploadStatus: varchar("long_youtube_upload_status", { length: 20 }).default("pending"),
    longYoutubeUploadError: text("long_youtube_upload_error"),
    longYoutubeVideoUrl: text("long_youtube_video_url"),
    longYoutubeScheduledAt: timestamp("long_youtube_scheduled_at", { withTimezone: true }),
    // ── Facebook ───────────────────────────────────────────────
    facebookUploadStatus: varchar("facebook_upload_status", { length: 20 }).default("pending"),
    facebookUploadError: text("facebook_upload_error"),
    facebookVideoUrl: text("facebook_video_url"),
    facebookScheduledAt: timestamp("facebook_scheduled_at", { withTimezone: true }),
    // ── Cleanup ────────────────────────────────────────────────
    // completedAt: set khi cả YT + FB đều done
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // mediaScheduledCleanAt: set sau khi upload xong, xoá file sau 3 ngày
    mediaScheduledCleanAt: timestamp("media_scheduled_clean_at", { withTimezone: true }),
    // mediaCleanedAt: set khi đã xoá file audio/images/video
    mediaCleanedAt: timestamp("media_cleaned_at", { withTimezone: true }),
    contentMode: varchar("content_mode", { length: 10 }).default("both").notNull(),
    formatType: text("format_type"),
    topicFamily: text("topic_family"),
    // Voice Rotation V1: voice locked at INSERT time by voice-rotation.ts.
    // NULL = use niche default (Ly). Non-null = never changed after audio generated.
    ttsVoice: varchar("tts_voice", { length: 50 }),
    // ── Short Cover Asset ──────────────────────────────────────────────────────
    shortCoverAssetPath: text("short_cover_asset_path"),      // media/covers/{id}-short-cover.jpg
    shortCoverText: text("short_cover_text"),                  // coverText used for rendering
    shortCoverGeneratedAt: timestamp("short_cover_generated_at", { withTimezone: true }),
    isLocked: boolean("is_locked").default(false).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_content_gen_niche").on(table.nicheId),
    index("idx_content_gen_created").on(table.createdAt),
    index("idx_content_gen_topic").on(table.topic),
    index("idx_content_gen_experiment").on(table.experimentId, table.experimentVariant),
    index("idx_content_gen_locked").on(table.isLocked),
  ]
);

export const contentSchedulerJobs = pgTable(
  "content_scheduler_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    nicheId: integer("niche_id")
      .notNull()
      .references(() => niches.id, { onDelete: "cascade" }),
    nicheName: varchar("niche_name", { length: 100 }).notNull(),
    // topic rỗng = auto-suggest mỗi lần chạy
    topic: text("topic").notNull().default(""),
    frequency: varchar("frequency", { length: 20 }).notNull(),
    cronExpression: text("cron_expression"),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    // 'content_gen' | 'short_pipeline' | 'long_pipeline'
    jobType: varchar("job_type", { length: 20 }).default("content_gen").notNull(),
    // for content_gen: 'short' | 'long' | 'both'
    contentMode: varchar("content_mode", { length: 10 }).default("both").notNull(),
    // for pipeline jobs: số item xử lý mỗi lần chạy
    batchSize: integer("batch_size").default(3).notNull(),
    // model cho topic suggestion (khi topic = "")
    topicModel: varchar("topic_model", { length: 100 }).default("openai/gpt-4o-mini"),
    // model cho script step
    scriptModel: varchar("script_model", { length: 100 }).default("openai/gpt-4o-mini"),
    // pipeline overrides (null = dùng default từ niche/cài đặt)
    ttsVoice:       varchar("tts_voice",       { length: 50 }),
    imageCount:     integer("image_count"),
    imageStyle:     text("image_style"),
    longImageCount:        integer("long_image_count"),
    longImageStyle:        varchar("long_image_style",        { length: 50  }),
    longFalModel:          varchar("long_fal_model",          { length: 100 }),
    longThumbnailFalModel:      varchar("long_thumbnail_fal_model",       { length: 100 }),
    longThumbnailLlmModel:      varchar("long_thumbnail_llm_model",       { length: 100 }),
    longThumbnailImageStyle:    varchar("long_thumbnail_image_style",     { length: 50  }),
    // short pipeline: null = use niche musicFolder, true = force enable, false = force disable
    bgMusic: boolean("bg_music"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    // YouTube auto-post settings (only for short_pipeline / long_pipeline)
    ytAutoPost:    boolean("yt_auto_post").default(false).notNull(),
    ytChannelId:   integer("yt_channel_id").references(() => socialChannels.id, { onDelete: "set null" }),
    ytWindowStart: varchar("yt_window_start", { length: 5 }).default("06:00"), // HH:MM
    ytWindowEnd:   varchar("yt_window_end",   { length: 5 }).default("22:00"), // HH:MM
    ytIntervalMin: integer("yt_interval_min").default(60),
    ytPrivacy:     varchar("yt_privacy", { length: 20 }).default("public"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_scheduler_niche").on(table.nicheId),
    index("idx_scheduler_enabled").on(table.isEnabled),
    index("idx_scheduler_next_run").on(table.nextRunAt),
  ]
);

/**
 * API Usage Logs — tách biệt khỏi content, không bị xóa khi xóa content
 * Ghi nhận mọi lần gọi LLM API
 */
export const apiUsageLogs = pgTable(
  "api_usage_logs",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull().default("openai"),
    // Mục đích: content_script / content_short / content_long / topic_suggest / niche_prompt / niche_create
    purpose: varchar("purpose", { length: 60 }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 8 }).notNull().default("0"),
    // Liên kết lỏng — không FK để log tồn tại ngay cả khi content bị xóa
    nicheId: integer("niche_id"),
    contentGenerationId: text("content_generation_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (table) => [
    index("idx_usage_created").on(table.createdAt),
    index("idx_usage_model").on(table.model),
    index("idx_usage_purpose").on(table.purpose),
  ]
);

export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;
export type NewApiUsageLog = typeof apiUsageLogs.$inferInsert;

/**
 * Music Tracks — nhạc nền, tải từ YouTube về local
 */
export const musicTracks = pgTable(
  "music_tracks",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    title: varchar("title", { length: 300 }).notNull(),
    youtubeUrl: text("youtube_url"),
    // category = tên thư mục trong media/music/ (ví dụ: "phat-phap", "truyen-audio")
    category: varchar("category", { length: 100 }).notNull(),
    filePath: text("file_path"),         // đường dẫn local
    duration: integer("duration"),        // giây
    fileSizeBytes: integer("file_size_bytes"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    // pending | downloading | done | error
    errorMessage: text("error_message"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_music_category").on(t.category),
    index("idx_music_status").on(t.status),
  ]
);

export type MusicTrack = typeof musicTracks.$inferSelect;
export type NewMusicTrack = typeof musicTracks.$inferInsert;

/**
 * YouTube OAuth Clients — lưu credential của nhiều GCP project để tránh quota limit
 */
export const youtubeOauthClients = pgTable("youtube_oauth_clients", {
  id:           serial("id").primaryKey(),
  name:         varchar("name",          { length: 100 }).notNull(),
  clientId:     varchar("client_id",     { length: 300 }).notNull(),
  clientSecret: varchar("client_secret", { length: 300 }).notNull(),
  isActive:     boolean("is_active").default(true).notNull(),
  createdAt:    timestamp("created_at",  { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at",  { withTimezone: true }).defaultNow().notNull(),
});

export type YoutubeOauthClient     = typeof youtubeOauthClients.$inferSelect;
export type NewYoutubeOauthClient  = typeof youtubeOauthClients.$inferInsert;

/**
 * Platform Accounts — kênh/page/account thật trên từng nền tảng.
 * Một account thật có thể có nhiều credential/OAuth client.
 */
export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: serial("id").primaryKey(),
    platform: varchar("platform", { length: 20 }).notNull(), // 'youtube' | 'facebook' | 'tiktok'
    platformAccountId: varchar("platform_account_id", { length: 200 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    handle: varchar("handle", { length: 100 }),
    thumbnailUrl: text("thumbnail_url"),
    isActive: boolean("is_active").default(true).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uniq_platform_accounts_platform_account").on(t.platform, t.platformAccountId),
    index("idx_platform_accounts_platform").on(t.platform),
    index("idx_platform_accounts_active").on(t.isActive),
  ]
);

export type PlatformAccount = typeof platformAccounts.$inferSelect;
export type NewPlatformAccount = typeof platformAccounts.$inferInsert;

/**
 * Social Channels — quản lý kênh YouTube, trang Facebook đã kết nối
 */
export const socialChannels = pgTable(
  "social_channels",
  {
    id: serial("id").primaryKey(),
    platform: varchar("platform", { length: 20 }).notNull(), // 'youtube' | 'facebook'
    channelKey: varchar("channel_key", { length: 50 })
      .default("phat_phap")
      .notNull(),
    name: varchar("name", { length: 200 }).notNull(),          // tên hiển thị
    platformChannelId: varchar("platform_channel_id", { length: 200 }), // YT channel ID / FB page ID
    platformHandle: varchar("platform_handle", { length: 100 }), // @handle
    thumbnailUrl: text("thumbnail_url"),
    platformAccountId: integer("platform_account_id").references(() => platformAccounts.id, { onDelete: "set null" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    oauthClientConfigId:  integer("oauth_client_config_id").references(() => youtubeOauthClients.id, { onDelete: "set null" }),
    isActive: boolean("is_active").default(true).notNull(),
    needsReconnect: boolean("needs_reconnect").default(false).notNull(),
    quotaExceededUntil: timestamp("quota_exceeded_until", { withTimezone: true }),
    lastError: text("last_error"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_social_channels_platform").on(t.platform),
    index("idx_social_channels_active").on(t.isActive),
  ]
);

export type SocialChannel = typeof socialChannels.$inferSelect;
export type NewSocialChannel = typeof socialChannels.$inferInsert;

/**
 * Upload Queue — hàng chờ đăng video lên YouTube / Facebook
 */
export const uploadQueue = pgTable(
  "upload_queue",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    contentId: text("content_id")
      .notNull()
      .references(() => contentGenerations.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => socialChannels.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 20 }).notNull(), // 'youtube' | 'facebook'
    videoType: varchar("video_type", { length: 10 }).notNull(), // 'short' | 'long'
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().default([]),
    privacyStatus: varchar("privacy_status", { length: 20 }).notNull().default("public"), // 'public' | 'private' | 'unlisted'
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"), // 'queued' | 'uploading' | 'done' | 'error' | 'cancelled'
    errorMessage: text("error_message"),
    platformVideoId: varchar("platform_video_id", { length: 100 }),  // YouTube video ID
    platformVideoUrl: text("platform_video_url"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_upload_queue_status").on(t.status),
    index("idx_upload_queue_scheduled").on(t.scheduledAt),
    index("idx_upload_queue_content").on(t.contentId),
    index("idx_upload_queue_channel").on(t.channelId),
  ]
);

export type UploadQueueItem = typeof uploadQueue.$inferSelect;
export type NewUploadQueueItem = typeof uploadQueue.$inferInsert;

/**
 * Published Videos — video đã đăng thành công trên một nền tảng/kênh thật.
 * Analytics luôn gắn vào account thật, không gắn vào OAuth credential.
 */
export const publishedVideos = pgTable(
  "published_videos",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    uploadQueueId: text("upload_queue_id").references(() => uploadQueue.id, { onDelete: "set null" }),
    contentId: text("content_id").references(() => contentGenerations.id, { onDelete: "set null" }),
    platform: varchar("platform", { length: 20 }).notNull(),
    platformAccountId: integer("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    credentialChannelId: integer("credential_channel_id").references(() => socialChannels.id, { onDelete: "set null" }),
    platformVideoId: varchar("platform_video_id", { length: 100 }).notNull(),
    platformVideoUrl: text("platform_video_url"),
    videoType: varchar("video_type", { length: 10 }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    privacyStatus: varchar("privacy_status", { length: 20 }),
    durationSeconds: integer("duration_seconds"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    latestViewCount: bigint("latest_view_count", { mode: "number" }),
    latestLikeCount: bigint("latest_like_count", { mode: "number" }),
    latestCommentCount: bigint("latest_comment_count", { mode: "number" }),
    latestFetchedAt: timestamp("latest_fetched_at", { withTimezone: true }),
    rawLatestJson: jsonb("raw_latest_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uniq_published_videos_platform_video").on(t.platform, t.platformVideoId),
    uniqueIndex("uniq_published_videos_upload_queue").on(t.uploadQueueId),
    index("idx_published_videos_platform").on(t.platform),
    index("idx_published_videos_account").on(t.platformAccountId),
    index("idx_published_videos_published_at").on(t.publishedAt),
    index("idx_published_videos_content").on(t.contentId),
  ]
);

export type PublishedVideo = typeof publishedVideos.$inferSelect;
export type NewPublishedVideo = typeof publishedVideos.$inferInsert;

/**
 * Video Metric Snapshots — snapshot theo thời điểm để theo dõi tăng trưởng.
 */
export const videoMetricSnapshots = pgTable(
  "video_metric_snapshots",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    publishedVideoId: text("published_video_id")
      .notNull()
      .references(() => publishedVideos.id, { onDelete: "cascade" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    viewCount: bigint("view_count", { mode: "number" }),
    likeCount: bigint("like_count", { mode: "number" }),
    commentCount: bigint("comment_count", { mode: "number" }),
    favoriteCount: bigint("favorite_count", { mode: "number" }),
    shareCount: bigint("share_count", { mode: "number" }),
    // YouTube Analytics API fields (Phase 6 — populated when Analytics API is connected)
    ctr: numeric("ctr", { precision: 6, scale: 4 }),                      // click-through rate 0.0000–1.0000
    avgViewDurationSec: integer("avg_view_duration_sec"),                  // average view duration
    retentionPct: numeric("retention_pct", { precision: 5, scale: 2 }),   // average % viewed
    // YouTube Analytics Phase A fields
    estimatedMinutesWatched: integer("estimated_minutes_watched"),         // total minutes watched (Analytics API)
    subscribersGained: integer("subscribers_gained"),                      // subscribers gained from this video
    subscribersLost: integer("subscribers_lost"),                          // subscribers lost from this video
    engagedViews: bigint("engaged_views", { mode: "number" }),             // schema-only; not available at per-video level in current API scope
    privacyStatus: varchar("privacy_status", { length: 20 }),
    durationSeconds: integer("duration_seconds"),
    rawJson: jsonb("raw_json"),
  },
  (t) => [
    index("idx_video_metric_snapshots_video").on(t.publishedVideoId),
    index("idx_video_metric_snapshots_fetched").on(t.fetchedAt),
  ]
);

export type VideoMetricSnapshot = typeof videoMetricSnapshots.$inferSelect;
export type NewVideoMetricSnapshot = typeof videoMetricSnapshots.$inferInsert;

/**
 * App Config — key-value store cho cài đặt toàn app
 * VD: image_prompt_model, tts_voice, v.v.
 */
export const appConfig = pgTable("app_config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AppConfig = typeof appConfig.$inferSelect;

/**
 * Cron Run Logs — ghi lại mỗi lần cron chạy để theo dõi và debug
 */
export const cronRunLogs = pgTable(
  "cron_run_logs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    ranAt: timestamp("ran_at", { withTimezone: true }).defaultNow().notNull(),
    jobsRan: integer("jobs_ran").notNull().default(0),
    jobsResults: jsonb("jobs_results").$type<object[]>(),
    uploadsProcessed: integer("uploads_processed").notNull().default(0),
    hasErrors: boolean("has_errors").notNull().default(false),
    errorSummary: text("error_summary"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("idx_cron_run_logs_ran_at").on(t.ranAt),
  ]
);

export type CronRunLog = typeof cronRunLogs.$inferSelect;

// Relations
export const nichesRelations = relations(niches, ({ many }) => ({
  promptTemplates: many(promptTemplates),
  contentPieces: many(contentPieces),
  agentSuggestions: many(agentSuggestions),
  testRuns: many(promptTestRuns),
  generatedContents: many(generatedContents),
  contentGenerations: many(contentGenerations),
  schedulerJobs: many(contentSchedulerJobs),
}));

export const promptTemplatesRelations = relations(
  promptTemplates,
  ({ one, many }) => ({
    niche: one(niches, {
      fields: [promptTemplates.nicheId],
      references: [niches.id],
    }),
    contentOutputs: many(contentOutputs),
    testRuns: many(promptTestRuns),
  })
);

export const generatedContentsRelations = relations(
  generatedContents,
  ({ one }) => ({
    niche: one(niches, {
      fields: [generatedContents.nicheId],
      references: [niches.id],
    }),
    promptTemplate: one(promptTemplates, {
      fields: [generatedContents.promptTemplateId],
      references: [promptTemplates.id],
    }),
  })
);

export const promptTestRunsRelations = relations(promptTestRuns, ({ one }) => ({
  niche: one(niches, {
    fields: [promptTestRuns.nicheId],
    references: [niches.id],
  }),
  promptTemplate: one(promptTemplates, {
    fields: [promptTestRuns.promptTemplateId],
    references: [promptTemplates.id],
  }),
}));

export const contentPiecesRelations = relations(
  contentPieces,
  ({ one, many }) => ({
    niche: one(niches, {
      fields: [contentPieces.nicheId],
      references: [niches.id],
    }),
    outputs: many(contentOutputs),
  })
);

export const contentOutputsRelations = relations(contentOutputs, ({ one }) => ({
  piece: one(contentPieces, {
    fields: [contentOutputs.pieceId],
    references: [contentPieces.id],
  }),
  promptTemplate: one(promptTemplates, {
    fields: [contentOutputs.promptTemplateId],
    references: [promptTemplates.id],
  }),
}));

export const agentSuggestionsRelations = relations(
  agentSuggestions,
  ({ one }) => ({
    niche: one(niches, {
      fields: [agentSuggestions.nicheId],
      references: [niches.id],
    }),
  })
);

export const contentGenerationsRelations = relations(
  contentGenerations,
  ({ one, many }) => ({
    niche: one(niches, {
      fields: [contentGenerations.nicheId],
      references: [niches.id],
    }),
    publishedVideos: many(publishedVideos),
  })
);

export const contentSchedulerJobsRelations = relations(
  contentSchedulerJobs,
  ({ one }) => ({
    niche: one(niches, {
      fields: [contentSchedulerJobs.nicheId],
      references: [niches.id],
    }),
  })
);

export const platformAccountsRelations = relations(platformAccounts, ({ many }) => ({
  credentials: many(socialChannels),
  publishedVideos: many(publishedVideos),
}));

export const socialChannelsRelations = relations(socialChannels, ({ one, many }) => ({
  oauthClient: one(youtubeOauthClients, {
    fields: [socialChannels.oauthClientConfigId],
    references: [youtubeOauthClients.id],
  }),
  platformAccount: one(platformAccounts, {
    fields: [socialChannels.platformAccountId],
    references: [platformAccounts.id],
  }),
  publishedVideos: many(publishedVideos),
}));

export const uploadQueueRelations = relations(uploadQueue, ({ one }) => ({
  content: one(contentGenerations, {
    fields: [uploadQueue.contentId],
    references: [contentGenerations.id],
  }),
  channel: one(socialChannels, {
    fields: [uploadQueue.channelId],
    references: [socialChannels.id],
  }),
}));

export const publishedVideosRelations = relations(publishedVideos, ({ one, many }) => ({
  uploadQueue: one(uploadQueue, {
    fields: [publishedVideos.uploadQueueId],
    references: [uploadQueue.id],
  }),
  content: one(contentGenerations, {
    fields: [publishedVideos.contentId],
    references: [contentGenerations.id],
  }),
  platformAccount: one(platformAccounts, {
    fields: [publishedVideos.platformAccountId],
    references: [platformAccounts.id],
  }),
  credentialChannel: one(socialChannels, {
    fields: [publishedVideos.credentialChannelId],
    references: [socialChannels.id],
  }),
  snapshots: many(videoMetricSnapshots),
}));

export const videoMetricSnapshotsRelations = relations(videoMetricSnapshots, ({ one }) => ({
  publishedVideo: one(publishedVideos, {
    fields: [videoMetricSnapshots.publishedVideoId],
    references: [publishedVideos.id],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// 1 Phút Tài Chính — Finance News Branch (experimental, isolated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RSS feed registry for the finance news collector.
 * Each row is one feed. The collector only processes is_active = true rows.
 */
export const financeNewsSources = pgTable(
  "finance_news_sources",
  {
    id:              serial("id").primaryKey(),
    name:            varchar("name",     { length: 100 }).notNull(),
    rssUrl:          text("rss_url").notNull().unique(),
    isActive:        boolean("is_active").notNull().default(true),
    language:        varchar("language", { length: 10  }).notNull().default("en"),
    topicTags:       jsonb("topic_tags").$type<string[]>().notNull().default([]),
    fetchIntervalMin: integer("fetch_interval_min").notNull().default(30),
    lastFetchedAt:   timestamp("last_fetched_at",  { withTimezone: true }),
    lastFetchError:  text("last_fetch_error"),
    // ── Source quality metadata (Phase C) ──────────────────────────────────
    qualityScore:    numeric("quality_score",   { precision: 3, scale: 1 }).notNull().default("5.0"),
    sourceType:      varchar("source_type",     { length: 20  }).notNull().default("rss"),
    defaultTopicTags: jsonb("default_topic_tags").$type<string[]>().notNull().default([]),
    notes:           text("notes"),
    createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_finance_news_sources_active").on(t.isActive),
  ]
);

export type FinanceNewsSource    = typeof financeNewsSources.$inferSelect;
export type NewFinanceNewsSource = typeof financeNewsSources.$inferInsert;

/**
 * Raw ingest table for finance news items.
 * Deduplication key: url_hash (SHA-256 of canonical URL).
 * Items stay in status='raw' until a Phase D scorer promotes them.
 */
export const financeRawItems = pgTable(
  "finance_raw_items",
  {
    id:            text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sourceId:      integer("source_id").notNull().references(() => financeNewsSources.id, { onDelete: "cascade" }),
    url:           text("url").notNull(),
    urlHash:       varchar("url_hash", { length: 64 }).notNull().unique(), // SHA-256(url)
    title:         text("title").notNull(),
    summary:       text("summary"),
    publishedAt:   timestamp("published_at", { withTimezone: true }),
    sourceName:    varchar("source_name", { length: 100 }),
    topicTags:     jsonb("topic_tags").$type<string[]>().notNull().default([]),
    // Article image from RSS enclosure / media:content — not yet downloaded (Phase C)
    ogImageUrl:    text("og_image_url"),
    // ── Freshness tracking (Phase C-lite) ─────────────────────────────────
    // firstSeenAt: set once at insert, never overwritten — use for freshness ranking
    firstSeenAt:  timestamp("first_seen_at",  { withTimezone: true }).defaultNow().notNull(),
    // lastSeenAt: updated each time the same URL appears in a later RSS fetch
    lastSeenAt:   timestamp("last_seen_at",   { withTimezone: true }),
    // collectedAt: the clock time of the most recent fetch that touched this row
    collectedAt:  timestamp("collected_at",   { withTimezone: true }).defaultNow().notNull(),
    // freshnessBucket: classified from best available reference time (published_at if valid, else first_seen_at)
    // values: last_1h | last_3h | last_6h | last_24h | older | unknown
    freshnessBucket: varchar("freshness_bucket", { length: 20 }),
    // ── Image cache (Phase C) ──────────────────────────────────────────────
    // pending | cached | failed | skipped
    imageCachedStatus: varchar("image_cached_status", { length: 20 }).default("pending"),
    localImagePath:    text("local_image_path"),
    imageWidth:        integer("image_width"),
    imageHeight:       integer("image_height"),
    imageDownloadedAt: timestamp("image_downloaded_at", { withTimezone: true }),
    imageContentType:  text("image_content_type"),
    imageBytes:        integer("image_bytes"),
    imageError:        text("image_error"),
    // ── Phase D+: scoring and promotion ───────────────────────────────────
    importanceScore: numeric("importance_score", { precision: 4, scale: 2 }),
    status:        varchar("status", { length: 20 }).notNull().default("raw"),
    // raw | scored | promoted | skipped
    // Set when this item is promoted to a contentGenerations row (Phase F)
    contentGenerationId: text("content_generation_id")
      .references(() => contentGenerations.id, { onDelete: "set null" }),
    // Full RSS entry JSON for debugging
    rawPayload:    jsonb("raw_payload").$type<Record<string, unknown>>(),
    createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_finance_raw_items_source").on(t.sourceId),
    index("idx_finance_raw_items_status").on(t.status),
    index("idx_finance_raw_items_published").on(t.publishedAt),
    index("idx_finance_raw_items_first_seen").on(t.firstSeenAt),
    index("idx_finance_raw_items_created").on(t.createdAt),
  ]
);

export type FinanceRawItem    = typeof financeRawItems.$inferSelect;
export type NewFinanceRawItem = typeof financeRawItems.$inferInsert;

export const financeNewsSourcesRelations = relations(financeNewsSources, ({ many }) => ({
  items: many(financeRawItems),
}));

export const financeRawItemsRelations = relations(financeRawItems, ({ one }) => ({
  source: one(financeNewsSources, {
    fields: [financeRawItems.sourceId],
    references: [financeNewsSources.id],
  }),
}));

// ─── Story Library Source Tables ────────────────────────────────────────────

export const storySources = pgTable(
  "story_sources",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sourceSite: varchar("source_site", { length: 120 }).notNull(),
    sourceUrl: text("source_url").notNull().unique(),
    slug: varchar("slug", { length: 255 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    author: varchar("author", { length: 255 }),
    genres: jsonb("genres").$type<string[]>().default([]).notNull(),
    status: varchar("status", { length: 50 }),
    intro: text("intro"),
    chapterCount: integer("chapter_count").default(0).notNull(),
    crawledChapterCount: integer("crawled_chapter_count").default(0).notNull(),
    totalWordCount: integer("total_word_count").default(0).notNull(),
    crawlStatus: varchar("crawl_status", { length: 20 }).notNull().default("queued"),
    lastError: text("last_error"),
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_sources_site").on(t.sourceSite),
    index("idx_story_sources_slug").on(t.slug),
    index("idx_story_sources_crawl_status").on(t.crawlStatus),
    index("idx_story_sources_updated").on(t.updatedAt),
  ]
);

export const storySourceChapters = pgTable(
  "story_source_chapters",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    storyId: text("story_id").notNull().references(() => storySources.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    chapterTitle: varchar("chapter_title", { length: 500 }),
    chapterUrl: text("chapter_url").notNull().unique(),
    contentText: text("content_text"),
    wordCount: integer("word_count").default(0).notNull(),
    contentHash: varchar("content_hash", { length: 64 }),
    crawlStatus: varchar("crawl_status", { length: 20 }).notNull().default("queued"),
    lastError: text("last_error"),
    fallbackUrl: text("fallback_url"),
    fallbackSourceSite: varchar("fallback_source_site", { length: 120 }),
    fallbackContentLength: integer("fallback_content_length"),
    fallbackLastCheckedAt: timestamp("fallback_last_checked_at", { withTimezone: true }),
    recoveryStatus: varchar("recovery_status", { length: 40 }),
    recoveryMethod: varchar("recovery_method", { length: 40 }),
    recoveryNote: text("recovery_note"),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    recoveredFromSourceSite: varchar("recovered_from_source_site", { length: 120 }),
    recoveredFromUrl: text("recovered_from_url"),
    crawledAt: timestamp("crawled_at", { withTimezone: true }),
    // "Đã kiểm tra" — a manual human read-through flag only. Deliberately separate
    // from audio_text_status below: a chapter can be reviewedAt-checked by a human
    // and still contain unresolved obfuscation that must block TTS.
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // Pre-TTS audio text layer. Always derived from contentText; never overwrites it.
    // audioTextStatus: raw | normalized | needs_review | approved | blocked
    audioText: text("audio_text"),
    audioTextStatus: varchar("audio_text_status", { length: 20 }).notNull().default("raw"),
    audioTextIssueCount: integer("audio_text_issue_count").default(0).notNull(),
    audioTextNormalizationVersion: varchar("audio_text_normalization_version", { length: 20 }),
    // null = derived from raw content_text by the automated normalizer; "manual_import"
    // = an admin pasted clean text directly (see audio_text_review_note for provenance:
    // source URL/site/note are appended there rather than adding more columns).
    audioTextSource: varchar("audio_text_source", { length: 20 }),
    audioTextUpdatedAt: timestamp("audio_text_updated_at", { withTimezone: true }),
    audioTextReviewedAt: timestamp("audio_text_reviewed_at", { withTimezone: true }),
    audioTextReviewNote: text("audio_text_review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_source_chapters_story").on(t.storyId),
    index("idx_story_source_chapters_status").on(t.crawlStatus),
    index("idx_story_source_chapters_recovery_status").on(t.recoveryStatus),
    index("idx_story_source_chapters_audio_text_status").on(t.audioTextStatus),
    uniqueIndex("uniq_story_source_chapter_number").on(t.storyId, t.chapterNumber),
  ]
);

export const storySourcesRelations = relations(storySources, ({ many }) => ({
  chapters: many(storySourceChapters),
}));

export const storySourceChaptersRelations = relations(storySourceChapters, ({ one }) => ({
  story: one(storySources, { fields: [storySourceChapters.storyId], references: [storySources.id] }),
}));

export const storyCrawlRuns = pgTable(
  "story_crawl_runs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    mode: varchar("mode", { length: 40 }).notNull(),
    sourceSite: varchar("source_site", { length: 120 }),
    status: varchar("status", { length: 30 }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).defaultNow().notNull(),
    currentStoryId: text("current_story_id").references(() => storySources.id, { onDelete: "set null" }),
    currentStoryTitle: varchar("current_story_title", { length: 500 }),
    currentChapterId: text("current_chapter_id").references(() => storySourceChapters.id, { onDelete: "set null" }),
    currentChapterTitle: varchar("current_chapter_title", { length: 500 }),
    currentUrl: text("current_url"),
    attemptedStories: integer("attempted_stories").default(0).notNull(),
    attemptedChapters: integer("attempted_chapters").default(0).notNull(),
    succeededChapters: integer("succeeded_chapters").default(0).notNull(),
    failedChapters: integer("failed_chapters").default(0).notNull(),
    skippedDuplicates: integer("skipped_duplicates").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_crawl_runs_status").on(t.status),
    index("idx_story_crawl_runs_mode").on(t.mode),
    index("idx_story_crawl_runs_started").on(t.startedAt),
    index("idx_story_crawl_runs_heartbeat").on(t.heartbeatAt),
  ]
);

export const storyCrawlEvents = pgTable(
  "story_crawl_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id").references(() => storyCrawlRuns.id, { onDelete: "set null" }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    level: varchar("level", { length: 20 }).notNull().default("info"),
    message: text("message").notNull(),
    storyId: text("story_id").references(() => storySources.id, { onDelete: "set null" }),
    chapterId: text("chapter_id").references(() => storySourceChapters.id, { onDelete: "set null" }),
    url: text("url"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_crawl_events_run").on(t.runId),
    index("idx_story_crawl_events_type").on(t.eventType),
    index("idx_story_crawl_events_level").on(t.level),
    index("idx_story_crawl_events_created").on(t.createdAt),
  ]
);

export const storyCrawlRunsRelations = relations(storyCrawlRuns, ({ many, one }) => ({
  events: many(storyCrawlEvents),
  currentStory: one(storySources, { fields: [storyCrawlRuns.currentStoryId], references: [storySources.id] }),
  currentChapter: one(storySourceChapters, { fields: [storyCrawlRuns.currentChapterId], references: [storySourceChapters.id] }),
}));

export const storyCrawlEventsRelations = relations(storyCrawlEvents, ({ one }) => ({
  run: one(storyCrawlRuns, { fields: [storyCrawlEvents.runId], references: [storyCrawlRuns.id] }),
  story: one(storySources, { fields: [storyCrawlEvents.storyId], references: [storySources.id] }),
  chapter: one(storySourceChapters, { fields: [storyCrawlEvents.chapterId], references: [storySourceChapters.id] }),
}));

// ─── Story Studio Tables ────────────────────────────────────────────────────

export const storyTaxonomy = pgTable(
  "story_taxonomy",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    name: varchar("name", { length: 200 }).notNull(),
    parentId: integer("parent_id"),
    level: integer("level").notNull().default(0),
    description: text("description"),
    hookStrength: integer("hook_strength").default(5),
    retentionPotential: integer("retention_potential").default(5),
    seriesPotential: integer("series_potential").default(5),
    defaultTropes: jsonb("default_tropes").$type<string[]>().default([]),
    sampleHooks: jsonb("sample_hooks").$type<string[]>().default([]),
    sampleCoverTexts: jsonb("sample_cover_texts").$type<string[]>().default([]),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_story_taxonomy_parent").on(t.parentId), index("idx_story_taxonomy_level").on(t.level)]
);

export const stories = pgTable(
  "stories",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    title: varchar("title", { length: 500 }).notNull().default("Untitled Story"),
    status: varchar("status", { length: 50 }).notNull().default("idea"),
    // Genre path & tropes
    genrePath: jsonb("genre_path").$type<string[]>().default([]).notNull(),
    tropeTags: jsonb("trope_tags").$type<string[]>().default([]).notNull(),
    // Selected premise
    selectedPremise: jsonb("selected_premise"),
    premiseCandidates: jsonb("premise_candidates").$type<unknown[]>().default([]),
    // Bible
    storyBible: text("story_bible"),
    characterBible: text("character_bible"),
    systemRules: text("system_rules"),
    worldRules: text("world_rules"),
    forbiddenDirections: text("forbidden_directions"),
    endingPromise: text("ending_promise"),
    coreMysteries: jsonb("core_mysteries").$type<string[]>().default([]),
    emotionalArc: text("emotional_arc"),
    // Outline
    chapterOutlines: jsonb("chapter_outlines").$type<unknown[]>().default([]),
    outlineApproved: boolean("outline_approved").default(false).notNull(),
    // Meta
    totalChapters: integer("total_chapters").default(0).notNull(),
    approvedChapters: integer("approved_chapters").default(0).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_stories_status").on(t.status), index("idx_stories_created").on(t.createdAt)]
);

export const storyCharacters = pgTable(
  "story_characters",
  {
    id: serial("id").primaryKey(),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    role: varchar("role", { length: 50 }).notNull().default("supporting"),
    setup: text("setup"),
    personality: text("personality"),
    backstory: text("backstory"),
    goals: jsonb("goals").$type<string[]>().default([]),
    secrets: jsonb("secrets").$type<string[]>().default([]),
    relationships: jsonb("relationships").$type<Record<string, string>>().default({}),
    arc: text("arc"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_story_characters_story").on(t.storyId)]
);

export const storyChapters = pgTable(
  "story_chapters",
  {
    id: serial("id").primaryKey(),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    title: varchar("title", { length: 500 }),
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    // Outline
    outline: jsonb("outline"),
    // Draft
    chapterText: text("chapter_text"),
    chapterSummary: text("chapter_summary"),
    newFacts: jsonb("new_facts").$type<string[]>().default([]),
    relationshipChanges: jsonb("relationship_changes").$type<string[]>().default([]),
    openThreadsUpdated: jsonb("open_threads_updated").$type<string[]>().default([]),
    cliffhanger: text("cliffhanger"),
    qualityNotes: jsonb("quality_notes").$type<string[]>().default([]),
    // Quality check
    qualityCheck: jsonb("quality_check"),
    wordCount: integer("word_count").default(0),
    approved: boolean("approved").default(false).notNull(),
    locked: boolean("locked").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_chapters_story").on(t.storyId),
    uniqueIndex("uniq_story_chapter_number").on(t.storyId, t.chapterNumber),
  ]
);

export const storyMemories = pgTable(
  "story_memories",
  {
    id: serial("id").primaryKey(),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id").references(() => storyChapters.id, { onDelete: "set null" }),
    memoryType: varchar("memory_type", { length: 50 }).notNull().default("fact"),
    content: text("content").notNull(),
    tags: jsonb("tags").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_story_memories_story").on(t.storyId)]
);

export const storyEpisodes = pgTable(
  "story_episodes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    // Internal historical sequence number. Keep stable so existing asset paths and references remain valid.
    episodeNumber: integer("episode_number").notNull(),
    // production | short_pilot | smoke_test
    episodeKind: varchar("episode_kind", { length: 30 }).notNull().default("production"),
    // Separate public-facing production numbering that excludes smoke tests / pilots.
    productionEpisodeNumber: integer("production_episode_number"),
    title: varchar("title", { length: 500 }).notNull(),
    chapterStart: integer("chapter_start").notNull(),
    chapterEnd: integer("chapter_end").notNull(),
    chapterIdsJson: jsonb("chapter_ids_json").$type<number[]>().default([]).notNull(),
    scriptText: text("script_text"),
    wordCount: integer("word_count").default(0).notNull(),
    estimatedDurationMin: integer("estimated_duration_min").default(0).notNull(),
    // status lifecycle: draft → ready_for_review → approved → locked → ready_for_tts
    status: varchar("status", { length: 50 }).notNull().default("draft"),
    approved: boolean("approved").default(false).notNull(),
    locked: boolean("locked").default(false).notNull(),
    creativeReviewStatus: varchar("creative_review_status", { length: 20 }).notNull().default("pending"),
    creativeReviewNotes: text("creative_review_notes"),
    creativeReviewedAt: timestamp("creative_reviewed_at", { withTimezone: true }),
    creativeReviewHash: text("creative_review_hash"),
    creativeReviewerLabel: varchar("creative_reviewer_label", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_episodes_story").on(t.storyId),
    index("idx_story_episodes_kind").on(t.storyId, t.episodeKind),
    uniqueIndex("uniq_story_episode_number").on(t.storyId, t.episodeNumber),
  ]
);

export const storyQualityChecks = pgTable(
  "story_quality_checks",
  {
    id: serial("id").primaryKey(),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    chapterId: integer("chapter_id").notNull().references(() => storyChapters.id, { onDelete: "cascade" }),
    passed: boolean("passed").notNull().default(false),
    scores: jsonb("scores"),
    issues: jsonb("issues").$type<Array<{ type: string; problem: string; fix: string }>>().default([]),
    repairPrompt: text("repair_prompt"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_story_quality_checks_chapter").on(t.chapterId)]
);

// Relations for story tables
export const storiesRelations = relations(stories, ({ many }) => ({
  characters: many(storyCharacters),
  chapters: many(storyChapters),
  memories: many(storyMemories),
  episodes: many(storyEpisodes),
  audioAssets: many(storyAudioAssets),
  videoAssets: many(storyVideoAssets),
  uploadPackages: many(storyUploadPackages),
  uploadValidations: many(storyManualUploadValidations),
}));

export const storyChaptersRelations = relations(storyChapters, ({ one, many }) => ({
  story: one(stories, { fields: [storyChapters.storyId], references: [stories.id] }),
  qualityChecks: many(storyQualityChecks),
  memories: many(storyMemories),
}));

export const storyCharactersRelations = relations(storyCharacters, ({ one }) => ({
  story: one(stories, { fields: [storyCharacters.storyId], references: [stories.id] }),
}));

export const storyMemoriesRelations = relations(storyMemories, ({ one }) => ({
  story: one(stories, { fields: [storyMemories.storyId], references: [stories.id] }),
  chapter: one(storyChapters, { fields: [storyMemories.chapterId], references: [storyChapters.id] }),
}));

export const storyQualityChecksRelations = relations(storyQualityChecks, ({ one }) => ({
  story: one(stories, { fields: [storyQualityChecks.storyId], references: [stories.id] }),
  chapter: one(storyChapters, { fields: [storyQualityChecks.chapterId], references: [storyChapters.id] }),
}));

export const storyEpisodesRelations = relations(storyEpisodes, ({ one, many }) => ({
  story: one(stories, { fields: [storyEpisodes.storyId], references: [stories.id] }),
  audioAssets: many(storyAudioAssets),
}));

export const storyEpisodeMetadata = pgTable(
  "story_episode_metadata",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    episodeId: text("episode_id").notNull().references(() => storyEpisodes.id, { onDelete: "cascade" }),
    seoTitle: text("seo_title").notNull(),
    youtubeTitle: text("youtube_title").notNull(),
    titleCandidatesJson: jsonb("title_candidates_json")
      .$type<Array<{ type: "emotional" | "genre_search" | "curiosity_hook"; title: string }>>()
      .default([])
      .notNull(),
    description: text("description").notNull(),
    tagsJson: jsonb("tags_json").$type<string[]>().default([]).notNull(),
    hashtagsJson: jsonb("hashtags_json").$type<string[]>().default([]).notNull(),
    pinnedComment: text("pinned_comment").notNull(),
    playlistTitle: text("playlist_title").notNull(),
    playlistPosition: integer("playlist_position").notNull(),
    authorName: text("author_name").notNull(),
    genreText: text("genre_text").notNull(),
    episodeLabel: text("episode_label").notNull(),
    chapterRangeText: text("chapter_range_text").notNull(),
    targetChannelId: text("target_channel_id"),
    targetChannelName: text("target_channel_name"),
    targetChannelHandle: text("target_channel_handle"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approved: boolean("approved").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_episode_metadata_story").on(t.storyId),
    uniqueIndex("uniq_story_episode_metadata_episode").on(t.episodeId),
  ]
);

export const storyEpisodeMetadataRelations = relations(storyEpisodeMetadata, ({ one }) => ({
  story: one(stories, { fields: [storyEpisodeMetadata.storyId], references: [stories.id] }),
  episode: one(storyEpisodes, { fields: [storyEpisodeMetadata.episodeId], references: [storyEpisodes.id] }),
}));

export const storyAudioAssets = pgTable(
  "story_audio_assets",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    episodeId: text("episode_id").references(() => storyEpisodes.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(),
    model: varchar("model", { length: 100 }),
    voiceId: varchar("voice_id", { length: 200 }).notNull(),
    voiceLabel: varchar("voice_label", { length: 200 }),
    sampleRate: integer("sample_rate"),
    language: varchar("language", { length: 50 }),
    speed: numeric("speed", { precision: 5, scale: 3 }),
    pitch: numeric("pitch", { precision: 5, scale: 2 }),
    volume: numeric("volume", { precision: 5, scale: 3 }),
    audioPath: text("audio_path"),
    srtPath: text("srt_path"),
    durationSec: numeric("duration_sec", { precision: 10, scale: 2 }),
    wordCount: integer("word_count"),
    ttsJobId: text("tts_job_id"),
    cacheKey: text("cache_key"),
    // status: pending | generating | ready | failed
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    errorMessage: text("error_message"),
    isDryRun: boolean("is_dry_run").default(false).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_audio_assets_story").on(t.storyId),
    index("idx_story_audio_assets_episode").on(t.episodeId),
  ]
);

export const storyAudioAssetsRelations = relations(storyAudioAssets, ({ one }) => ({
  story: one(stories, { fields: [storyAudioAssets.storyId], references: [stories.id] }),
  episode: one(storyEpisodes, { fields: [storyAudioAssets.episodeId], references: [storyEpisodes.id] }),
}));

export const storyVideoAssets = pgTable(
  "story_video_assets",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    episodeId: text("episode_id").notNull().references(() => storyEpisodes.id, { onDelete: "cascade" }),
    audioAssetId: text("audio_asset_id").references(() => storyAudioAssets.id, { onDelete: "set null" }),
    videoPath: text("video_path"),
    thumbnailPath: text("thumbnail_path"),
    coverImagePath: text("cover_image_path"),
    sidecarSrtPath: text("sidecar_srt_path"),
    // status: pending | rendering | ready | failed
    renderStatus: varchar("render_status", { length: 50 }).notNull().default("pending"),
    renderError: text("render_error"),
    durationSec: numeric("duration_sec", { precision: 10, scale: 2 }),
    width: integer("width"),
    height: integer("height"),
    fps: integer("fps"),
    codec: varchar("codec", { length: 50 }),
    audioCodec: varchar("audio_codec", { length: 50 }),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    // subtitle_mode: sidecar (SRT copied next to MP4, no burn-in)
    subtitleMode: varchar("subtitle_mode", { length: 50 }).default("sidecar"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_video_assets_story").on(t.storyId),
    index("idx_story_video_assets_episode").on(t.episodeId),
  ]
);

export const storyVideoAssetsRelations = relations(storyVideoAssets, ({ one }) => ({
  story: one(stories, { fields: [storyVideoAssets.storyId], references: [stories.id] }),
  episode: one(storyEpisodes, { fields: [storyVideoAssets.episodeId], references: [storyEpisodes.id] }),
  audioAsset: one(storyAudioAssets, { fields: [storyVideoAssets.audioAssetId], references: [storyAudioAssets.id] }),
}));

export const storyUploadPackages = pgTable(
  "story_upload_packages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    episodeId: text("episode_id").notNull().references(() => storyEpisodes.id, { onDelete: "cascade" }),
    videoAssetId: text("video_asset_id").references(() => storyVideoAssets.id, { onDelete: "set null" }),
    packageDir: text("package_dir"),
    packageZipPath: text("package_zip_path"),
    title: text("title"),
    description: text("description"),
    tagsJson: jsonb("tags_json").$type<string[]>().default([]),
    playlistTitle: text("playlist_title"),
    playlistPosition: integer("playlist_position"),
    pinnedComment: text("pinned_comment"),
    videoPath: text("video_path"),
    subtitlePath: text("subtitle_path"),
    thumbnailPath: text("thumbnail_path"),
    metadataPath: text("metadata_path"),
    // status: draft | ready | failed
    status: varchar("status", { length: 50 }).notNull().default("draft"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_upload_packages_story").on(t.storyId),
    index("idx_story_upload_packages_episode").on(t.episodeId),
  ]
);

export const storyUploadPackagesRelations = relations(storyUploadPackages, ({ one }) => ({
  story: one(stories, { fields: [storyUploadPackages.storyId], references: [stories.id] }),
  episode: one(storyEpisodes, { fields: [storyUploadPackages.episodeId], references: [storyEpisodes.id] }),
  videoAsset: one(storyVideoAssets, { fields: [storyUploadPackages.videoAssetId], references: [storyVideoAssets.id] }),
}));

export const storyManualUploadValidations = pgTable(
  "story_manual_upload_validations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    storyId: text("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    episodeId: text("episode_id").notNull().references(() => storyEpisodes.id, { onDelete: "cascade" }),
    uploadPackageId: text("upload_package_id").references(() => storyUploadPackages.id, { onDelete: "set null" }),
    youtubeVideoUrl: text("youtube_video_url"),
    youtubeVideoId: text("youtube_video_id"),
    youtubePlaylistUrl: text("youtube_playlist_url"),
    youtubePlaylistId: text("youtube_playlist_id"),
    // not_uploaded | uploaded_private | uploaded_unlisted | uploaded_public | failed | needs_fix
    uploadStatus: varchar("upload_status", { length: 50 }).notNull().default("not_uploaded"),
    // private | unlisted | public
    visibility: varchar("visibility", { length: 50 }),
    titleOk: boolean("title_ok").notNull().default(false),
    thumbnailOk: boolean("thumbnail_ok").notNull().default(false),
    srtOk: boolean("srt_ok").notNull().default(false),
    audioOk: boolean("audio_ok").notNull().default(false),
    descriptionOk: boolean("description_ok").notNull().default(false),
    // clean | no_claim | claimed | blocked
    copyrightStatus: varchar("copyright_status", { length: 50 }),
    // none | age_restricted | country_blocked | other
    restrictionStatus: varchar("restriction_status", { length: 50 }),
    validationNotes: text("validation_notes"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_story_manual_upload_validations_story").on(t.storyId),
    index("idx_story_manual_upload_validations_episode").on(t.episodeId),
  ]
);

export const storyManualUploadValidationsRelations = relations(storyManualUploadValidations, ({ one }) => ({
  story: one(stories, { fields: [storyManualUploadValidations.storyId], references: [stories.id] }),
  episode: one(storyEpisodes, { fields: [storyManualUploadValidations.episodeId], references: [storyEpisodes.id] }),
  uploadPackage: one(storyUploadPackages, { fields: [storyManualUploadValidations.uploadPackageId], references: [storyUploadPackages.id] }),
}));

// Type exports for story tables
export type StorySource = typeof storySources.$inferSelect;
export type NewStorySource = typeof storySources.$inferInsert;
export type StorySourceChapter = typeof storySourceChapters.$inferSelect;
export type NewStorySourceChapter = typeof storySourceChapters.$inferInsert;
export type StoryCrawlRun = typeof storyCrawlRuns.$inferSelect;
export type NewStoryCrawlRun = typeof storyCrawlRuns.$inferInsert;
export type StoryCrawlEvent = typeof storyCrawlEvents.$inferSelect;
export type NewStoryCrawlEvent = typeof storyCrawlEvents.$inferInsert;
export type StoryTaxonomy = typeof storyTaxonomy.$inferSelect;
export type NewStoryTaxonomy = typeof storyTaxonomy.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type StoryCharacter = typeof storyCharacters.$inferSelect;
export type NewStoryCharacter = typeof storyCharacters.$inferInsert;
export type StoryChapter = typeof storyChapters.$inferSelect;
export type NewStoryChapter = typeof storyChapters.$inferInsert;
export type StoryMemory = typeof storyMemories.$inferSelect;
export type NewStoryMemory = typeof storyMemories.$inferInsert;
export type StoryQualityCheck = typeof storyQualityChecks.$inferSelect;
export type NewStoryQualityCheck = typeof storyQualityChecks.$inferInsert;
export type StoryEpisode = typeof storyEpisodes.$inferSelect;
export type NewStoryEpisode = typeof storyEpisodes.$inferInsert;
export type StoryEpisodeMetadata = typeof storyEpisodeMetadata.$inferSelect;
export type NewStoryEpisodeMetadata = typeof storyEpisodeMetadata.$inferInsert;
export type StoryAudioAsset = typeof storyAudioAssets.$inferSelect;
export type NewStoryAudioAsset = typeof storyAudioAssets.$inferInsert;
export type StoryVideoAsset = typeof storyVideoAssets.$inferSelect;
export type NewStoryVideoAsset = typeof storyVideoAssets.$inferInsert;
export type StoryUploadPackage = typeof storyUploadPackages.$inferSelect;
export type NewStoryUploadPackage = typeof storyUploadPackages.$inferInsert;
export type StoryManualUploadValidation = typeof storyManualUploadValidations.$inferSelect;
export type NewStoryManualUploadValidation = typeof storyManualUploadValidations.$inferInsert;

/**
 * Generation Cost Events — generic cost ledger for all pipeline providers.
 * One row per cost event (TTS request, image generation, LLM call, etc.).
 * All amounts in VND. source_table + source_id link back to origin rows.
 */
export const generationCostEvents = pgTable(
  "generation_cost_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    contentId: text("content_id"),
    provider: varchar("provider", { length: 50 }).notNull(),
    costType: varchar("cost_type", { length: 30 }).notNull(),
    pipelineRoute: varchar("pipeline_route", { length: 80 }),
    contentProfileKey: text("content_profile_key"),
    nicheName: text("niche_name"),
    formatType: text("format_type"),
    sourceTable: varchar("source_table", { length: 60 }),
    sourceId: text("source_id"),
    status: varchar("status", { length: 20 }).notNull().default("done"),
    usageUnit: varchar("usage_unit", { length: 20 }),
    usageAmount: numeric("usage_amount", { precision: 18, scale: 4 }),
    unitCostVnd: numeric("unit_cost_vnd", { precision: 14, scale: 6 }),
    costVnd: numeric("cost_vnd", { precision: 14, scale: 4 }),
    costSource: varchar("cost_source", { length: 30 }).notNull().default("unknown"),
    currency: varchar("currency", { length: 10 }).notNull().default("VND"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uniq_cost_events_source").on(table.sourceTable, table.sourceId),
    index("idx_cost_events_content_id").on(table.contentId, table.createdAt),
    index("idx_cost_events_provider_created").on(table.provider, table.createdAt),
    index("idx_cost_events_cost_type_created").on(table.costType, table.createdAt),
    index("idx_cost_events_pipeline_route").on(table.pipelineRoute, table.createdAt),
    index("idx_cost_events_niche_name").on(table.nicheName, table.createdAt),
  ]
);

export type GenerationCostEvent = typeof generationCostEvents.$inferSelect;
export type NewGenerationCostEvent = typeof generationCostEvents.$inferInsert;

// Type exports
export type GeneratedContent = typeof generatedContents.$inferSelect;
export type NewGeneratedContent = typeof generatedContents.$inferInsert;
export type PromptTestRun = typeof promptTestRuns.$inferSelect;
export type NewPromptTestRun = typeof promptTestRuns.$inferInsert;
export type Niche = typeof niches.$inferSelect;
export type NewNiche = typeof niches.$inferInsert;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type NewPromptTemplate = typeof promptTemplates.$inferInsert;
export type ContentPiece = typeof contentPieces.$inferSelect;
export type NewContentPiece = typeof contentPieces.$inferInsert;
export type ContentOutput = typeof contentOutputs.$inferSelect;
export type NewContentOutput = typeof contentOutputs.$inferInsert;
export type AgentSuggestion = typeof agentSuggestions.$inferSelect;
export type ContentGeneration = typeof contentGenerations.$inferSelect;
export type NewContentGeneration = typeof contentGenerations.$inferInsert;
export type ContentSchedulerJob = typeof contentSchedulerJobs.$inferSelect;
export type NewContentSchedulerJob = typeof contentSchedulerJobs.$inferInsert;
export type NewAgentSuggestion = typeof agentSuggestions.$inferInsert;
