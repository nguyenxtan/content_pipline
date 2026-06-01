ALTER TABLE "content_generations"
  ADD COLUMN "long_youtube_upload_status" varchar(20) DEFAULT 'pending',
  ADD COLUMN "long_youtube_upload_error" text,
  ADD COLUMN "long_youtube_video_url" text,
  ADD COLUMN "long_youtube_scheduled_at" timestamp with time zone;
