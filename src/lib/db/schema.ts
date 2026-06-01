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

export const niches = pgTable("niches", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
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
    script: text("script").notNull(),
    shortContent: text("short_content").notNull(),
    shortHookCandidates: jsonb("short_hook_candidates").$type<string[]>().default([]),
    shortSelectedHook: text("short_selected_hook"),
    longContent: text("long_content").notNull(),
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
