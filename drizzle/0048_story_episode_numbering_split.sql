-- Separate internal historical episode sequence from public production numbering.
-- Run after 0047_story_manual_upload_validations.sql

ALTER TABLE "story_episodes"
  ADD COLUMN IF NOT EXISTS "episode_kind" varchar(30) NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS "production_episode_number" integer;

CREATE INDEX IF NOT EXISTS "idx_story_episodes_kind"
  ON "story_episodes"("story_id", "episode_kind");

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_story_production_episode_number"
  ON "story_episodes"("story_id", "production_episode_number")
  WHERE "episode_kind" = 'production' AND "production_episode_number" IS NOT NULL;
