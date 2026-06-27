ALTER TABLE "story_source_chapters"
  ADD COLUMN IF NOT EXISTS "audio_text_source" varchar(20);
