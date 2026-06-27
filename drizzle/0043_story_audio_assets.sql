-- Audio Story Phase E1: Story Audio Assets
-- Run: psql $DATABASE_URL -f drizzle/0043_story_audio_assets.sql

CREATE TABLE IF NOT EXISTS "story_audio_assets" (
  "id" text PRIMARY KEY,
  "story_id" text NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
  "episode_id" text REFERENCES "story_episodes"("id") ON DELETE CASCADE,
  "provider" varchar(50) NOT NULL,
  "model" varchar(100),
  "voice_id" varchar(200) NOT NULL,
  "voice_label" varchar(200),
  "sample_rate" integer,
  "language" varchar(50),
  "speed" numeric(5,3),
  "pitch" numeric(5,2),
  "volume" numeric(5,3),
  "audio_path" text,
  "srt_path" text,
  "duration_sec" numeric(10,2),
  "word_count" integer,
  "tts_job_id" text,
  "cache_key" text,
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "error_message" text,
  "is_dry_run" boolean NOT NULL DEFAULT false,
  "generated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_story_audio_assets_story" ON "story_audio_assets"("story_id");
CREATE INDEX IF NOT EXISTS "idx_story_audio_assets_episode" ON "story_audio_assets"("episode_id");
