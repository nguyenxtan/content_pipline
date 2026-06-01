-- Phase 4-7: Full media pipeline columns
-- niches: music folder + video type config
ALTER TABLE "niches"
  ADD COLUMN IF NOT EXISTS "music_folder" varchar(200),
  ADD COLUMN IF NOT EXISTS "video_type" varchar(20) DEFAULT 'both';

-- content_generations: TTS audio path
ALTER TABLE "content_generations"
  ADD COLUMN IF NOT EXISTS "audio_path" text;

-- content_generations: images pipeline
ALTER TABLE "content_generations"
  ADD COLUMN IF NOT EXISTS "images_status" varchar(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "images_error_message" text,
  ADD COLUMN IF NOT EXISTS "image_paths" jsonb DEFAULT '[]';

-- content_generations: video pipeline
ALTER TABLE "content_generations"
  ADD COLUMN IF NOT EXISTS "video_status" varchar(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "video_error_message" text,
  ADD COLUMN IF NOT EXISTS "video_path" text;

-- content_generations: facebook
ALTER TABLE "content_generations"
  ADD COLUMN IF NOT EXISTS "facebook_upload_status" varchar(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "facebook_upload_error" text,
  ADD COLUMN IF NOT EXISTS "facebook_video_url" text,
  ADD COLUMN IF NOT EXISTS "facebook_scheduled_at" timestamptz;

-- content_generations: cleanup tracking
ALTER TABLE "content_generations"
  ADD COLUMN IF NOT EXISTS "completed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "media_cleaned_at" timestamptz;
