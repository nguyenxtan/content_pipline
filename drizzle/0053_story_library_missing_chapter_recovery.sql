ALTER TABLE "story_source_chapters"
  ADD COLUMN IF NOT EXISTS "fallback_url" text,
  ADD COLUMN IF NOT EXISTS "fallback_source_site" varchar(120),
  ADD COLUMN IF NOT EXISTS "fallback_content_length" integer,
  ADD COLUMN IF NOT EXISTS "fallback_last_checked_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "recovery_status" varchar(40),
  ADD COLUMN IF NOT EXISTS "recovery_method" varchar(40),
  ADD COLUMN IF NOT EXISTS "recovery_note" text,
  ADD COLUMN IF NOT EXISTS "recovered_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "recovered_from_source_site" varchar(120),
  ADD COLUMN IF NOT EXISTS "recovered_from_url" text;

CREATE INDEX IF NOT EXISTS "idx_story_source_chapters_recovery_status"
  ON "story_source_chapters"("recovery_status");
