CREATE TABLE "app_config" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_run_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"jobs_ran" integer DEFAULT 0 NOT NULL,
	"jobs_results" jsonb,
	"uploads_processed" integer DEFAULT 0 NOT NULL,
	"has_errors" boolean DEFAULT false NOT NULL,
	"error_summary" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "finance_news_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"rss_url" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"topic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetch_interval_min" integer DEFAULT 30 NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_fetch_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_news_sources_rss_url_unique" UNIQUE("rss_url")
);
--> statement-breakpoint
CREATE TABLE "finance_raw_items" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"url" text NOT NULL,
	"url_hash" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"published_at" timestamp with time zone,
	"source_name" varchar(100),
	"topic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"og_image_url" text,
	"importance_score" numeric(4, 2),
	"status" varchar(20) DEFAULT 'raw' NOT NULL,
	"content_generation_id" text,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_raw_items_url_hash_unique" UNIQUE("url_hash")
);
--> statement-breakpoint
CREATE TABLE "music_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" varchar(300) NOT NULL,
	"youtube_url" text,
	"category" varchar(100) NOT NULL,
	"file_path" text,
	"duration" integer,
	"file_size_bytes" integer,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(20) NOT NULL,
	"platform_account_id" varchar(200) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"handle" varchar(100),
	"thumbnail_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "published_videos" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_queue_id" text,
	"content_id" text,
	"platform" varchar(20) NOT NULL,
	"platform_account_id" integer NOT NULL,
	"credential_channel_id" integer,
	"platform_video_id" varchar(100) NOT NULL,
	"platform_video_url" text,
	"video_type" varchar(10) NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"privacy_status" varchar(20),
	"duration_seconds" integer,
	"published_at" timestamp with time zone,
	"latest_view_count" bigint,
	"latest_like_count" bigint,
	"latest_comment_count" bigint,
	"latest_fetched_at" timestamp with time zone,
	"raw_latest_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(20) NOT NULL,
	"channel_key" varchar(50) DEFAULT 'phat_phap' NOT NULL,
	"name" varchar(200) NOT NULL,
	"platform_channel_id" varchar(200),
	"platform_handle" varchar(100),
	"thumbnail_url" text,
	"platform_account_id" integer,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scope" text,
	"oauth_client_config_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"quota_exceeded_until" timestamp with time zone,
	"last_error" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"content_id" text NOT NULL,
	"channel_id" integer NOT NULL,
	"platform" varchar(20) NOT NULL,
	"video_type" varchar(10) NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"privacy_status" varchar(20) DEFAULT 'public' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"platform_video_id" varchar(100),
	"platform_video_url" text,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_metric_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"published_video_id" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"view_count" bigint,
	"like_count" bigint,
	"comment_count" bigint,
	"favorite_count" bigint,
	"share_count" bigint,
	"ctr" numeric(6, 4),
	"avg_view_duration_sec" integer,
	"retention_pct" numeric(5, 2),
	"privacy_status" varchar(20),
	"duration_seconds" integer,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "youtube_oauth_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"client_id" varchar(300) NOT NULL,
	"client_secret" varchar(300) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "content_profile_key" varchar(50) DEFAULT 'buddhism' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "channel_key" varchar(50) DEFAULT 'phat_phap' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "short_hook_candidates" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "short_selected_hook" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "hook_scored_candidates" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "hook_score" integer;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "hook_pattern" varchar(50);--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "prompt_versions" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "experiment_id" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "experiment_variant" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "thumbnail_text" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "render_time_total_ms" integer;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "main_model_used" varchar(100);--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "audio_path" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "tts_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "images_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "images_error_message" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "image_paths" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "images_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "images_cost_usd" numeric(10, 6);--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "video_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "video_error_message" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "video_path" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_images_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_images_error_message" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_image_paths" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_images_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_images_cost_usd" numeric(10, 6);--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_thumbnail_path" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_youtube_description" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_tts_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_tts_error_message" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_audio_path" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_tts_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_video_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_video_error_message" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_video_path" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_youtube_upload_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_youtube_upload_error" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_youtube_video_url" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "long_youtube_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "facebook_upload_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "facebook_upload_error" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "facebook_video_url" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "facebook_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "media_scheduled_clean_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "media_cleaned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "content_mode" varchar(10) DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "format_type" text;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "job_type" varchar(20) DEFAULT 'content_gen' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "content_mode" varchar(10) DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "batch_size" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "tts_voice" varchar(50);--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "image_count" integer;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "image_style" text;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "long_image_count" integer;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "long_image_style" varchar(50);--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "long_fal_model" varchar(100);--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "long_thumbnail_fal_model" varchar(100);--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "long_thumbnail_llm_model" varchar(100);--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "long_thumbnail_image_style" varchar(50);--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "bg_music" boolean;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "yt_auto_post" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "yt_channel_id" integer;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "yt_window_start" varchar(5) DEFAULT '06:00';--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "yt_window_end" varchar(5) DEFAULT '22:00';--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "yt_interval_min" integer DEFAULT 60;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "yt_privacy" varchar(20) DEFAULT 'public';--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "content_profile_key" varchar(50) DEFAULT 'buddhism' NOT NULL;--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "channel_key" varchar(50) DEFAULT 'phat_phap' NOT NULL;--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "music_folder" varchar(200);--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "video_type" varchar(20) DEFAULT 'both';--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "tts_voice" varchar(50) DEFAULT 'Ly';--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD CONSTRAINT "finance_raw_items_source_id_finance_news_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."finance_news_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD CONSTRAINT "finance_raw_items_content_generation_id_content_generations_id_fk" FOREIGN KEY ("content_generation_id") REFERENCES "public"."content_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_videos" ADD CONSTRAINT "published_videos_upload_queue_id_upload_queue_id_fk" FOREIGN KEY ("upload_queue_id") REFERENCES "public"."upload_queue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_videos" ADD CONSTRAINT "published_videos_content_id_content_generations_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_videos" ADD CONSTRAINT "published_videos_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_videos" ADD CONSTRAINT "published_videos_credential_channel_id_social_channels_id_fk" FOREIGN KEY ("credential_channel_id") REFERENCES "public"."social_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_channels" ADD CONSTRAINT "social_channels_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_channels" ADD CONSTRAINT "social_channels_oauth_client_config_id_youtube_oauth_clients_id_fk" FOREIGN KEY ("oauth_client_config_id") REFERENCES "public"."youtube_oauth_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_queue" ADD CONSTRAINT "upload_queue_content_id_content_generations_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_queue" ADD CONSTRAINT "upload_queue_channel_id_social_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."social_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_metric_snapshots" ADD CONSTRAINT "video_metric_snapshots_published_video_id_published_videos_id_fk" FOREIGN KEY ("published_video_id") REFERENCES "public"."published_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cron_run_logs_ran_at" ON "cron_run_logs" USING btree ("ran_at");--> statement-breakpoint
CREATE INDEX "idx_finance_news_sources_active" ON "finance_news_sources" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_finance_raw_items_source" ON "finance_raw_items" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_finance_raw_items_status" ON "finance_raw_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_finance_raw_items_published" ON "finance_raw_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_finance_raw_items_created" ON "finance_raw_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_music_category" ON "music_tracks" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_music_status" ON "music_tracks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_platform_accounts_platform_account" ON "platform_accounts" USING btree ("platform","platform_account_id");--> statement-breakpoint
CREATE INDEX "idx_platform_accounts_platform" ON "platform_accounts" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_platform_accounts_active" ON "platform_accounts" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_published_videos_platform_video" ON "published_videos" USING btree ("platform","platform_video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_published_videos_upload_queue" ON "published_videos" USING btree ("upload_queue_id");--> statement-breakpoint
CREATE INDEX "idx_published_videos_platform" ON "published_videos" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_published_videos_account" ON "published_videos" USING btree ("platform_account_id");--> statement-breakpoint
CREATE INDEX "idx_published_videos_published_at" ON "published_videos" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_published_videos_content" ON "published_videos" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_social_channels_platform" ON "social_channels" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_social_channels_active" ON "social_channels" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_upload_queue_status" ON "upload_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_upload_queue_scheduled" ON "upload_queue" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_upload_queue_content" ON "upload_queue" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_upload_queue_channel" ON "upload_queue" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_video_metric_snapshots_video" ON "video_metric_snapshots" USING btree ("published_video_id");--> statement-breakpoint
CREATE INDEX "idx_video_metric_snapshots_fetched" ON "video_metric_snapshots" USING btree ("fetched_at");--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD CONSTRAINT "content_scheduler_jobs_yt_channel_id_social_channels_id_fk" FOREIGN KEY ("yt_channel_id") REFERENCES "public"."social_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_gen_experiment" ON "content_generations" USING btree ("experiment_id","experiment_variant");