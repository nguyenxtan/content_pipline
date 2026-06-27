-- Audio Story Phase D: Episode Packaging
-- Run: psql $DATABASE_URL -f drizzle/0042_story_episodes.sql

CREATE TABLE IF NOT EXISTS "story_episodes" (
  "id" text PRIMARY KEY,
  "story_id" text NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
  "episode_number" integer NOT NULL,
  "title" varchar(500) NOT NULL,
  "chapter_start" integer NOT NULL,
  "chapter_end" integer NOT NULL,
  "chapter_ids_json" jsonb NOT NULL DEFAULT '[]',
  "script_text" text,
  "word_count" integer NOT NULL DEFAULT 0,
  "estimated_duration_min" integer NOT NULL DEFAULT 0,
  "status" varchar(50) NOT NULL DEFAULT 'draft',
  "approved" boolean NOT NULL DEFAULT false,
  "locked" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("story_id", "episode_number")
);

CREATE INDEX IF NOT EXISTS "idx_story_episodes_story" ON "story_episodes"("story_id");
