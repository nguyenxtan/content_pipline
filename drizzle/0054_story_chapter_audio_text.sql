ALTER TABLE "story_source_chapters"
  ADD COLUMN IF NOT EXISTS "audio_text" text,
  ADD COLUMN IF NOT EXISTS "audio_text_status" varchar(20) NOT NULL DEFAULT 'raw',
  ADD COLUMN IF NOT EXISTS "audio_text_issue_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "audio_text_normalization_version" varchar(20),
  ADD COLUMN IF NOT EXISTS "audio_text_updated_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "audio_text_reviewed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "audio_text_review_note" text;

CREATE INDEX IF NOT EXISTS "idx_story_source_chapters_audio_text_status"
  ON "story_source_chapters"("audio_text_status");
