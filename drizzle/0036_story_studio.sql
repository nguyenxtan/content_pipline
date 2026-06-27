-- Story Studio isolated tables
-- Run: pnpm db:push  OR  psql $DATABASE_URL -f drizzle/0036_story_studio.sql

CREATE TABLE IF NOT EXISTS "story_taxonomy" (
  "id" serial PRIMARY KEY,
  "slug" varchar(100) NOT NULL UNIQUE,
  "name" varchar(200) NOT NULL,
  "parent_id" integer,
  "level" integer NOT NULL DEFAULT 0,
  "description" text,
  "hook_strength" integer DEFAULT 5,
  "retention_potential" integer DEFAULT 5,
  "series_potential" integer DEFAULT 5,
  "default_tropes" jsonb DEFAULT '[]',
  "sample_hooks" jsonb DEFAULT '[]',
  "sample_cover_texts" jsonb DEFAULT '[]',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "stories" (
  "id" text PRIMARY KEY,
  "title" varchar(500) NOT NULL DEFAULT 'Untitled Story',
  "status" varchar(50) NOT NULL DEFAULT 'idea',
  "genre_path" jsonb NOT NULL DEFAULT '[]',
  "trope_tags" jsonb NOT NULL DEFAULT '[]',
  "selected_premise" jsonb,
  "premise_candidates" jsonb DEFAULT '[]',
  "story_bible" text,
  "character_bible" text,
  "system_rules" text,
  "world_rules" text,
  "forbidden_directions" text,
  "ending_promise" text,
  "core_mysteries" jsonb DEFAULT '[]',
  "emotional_arc" text,
  "chapter_outlines" jsonb DEFAULT '[]',
  "outline_approved" boolean NOT NULL DEFAULT false,
  "total_chapters" integer NOT NULL DEFAULT 0,
  "approved_chapters" integer NOT NULL DEFAULT 0,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "story_characters" (
  "id" serial PRIMARY KEY,
  "story_id" text NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
  "name" varchar(200) NOT NULL,
  "role" varchar(50) NOT NULL DEFAULT 'supporting',
  "setup" text,
  "personality" text,
  "backstory" text,
  "goals" jsonb DEFAULT '[]',
  "secrets" jsonb DEFAULT '[]',
  "relationships" jsonb DEFAULT '{}',
  "arc" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "story_chapters" (
  "id" serial PRIMARY KEY,
  "story_id" text NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
  "chapter_number" integer NOT NULL,
  "title" varchar(500),
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "outline" jsonb,
  "chapter_text" text,
  "chapter_summary" text,
  "new_facts" jsonb DEFAULT '[]',
  "relationship_changes" jsonb DEFAULT '[]',
  "open_threads_updated" jsonb DEFAULT '[]',
  "cliffhanger" text,
  "quality_notes" jsonb DEFAULT '[]',
  "quality_check" jsonb,
  "word_count" integer DEFAULT 0,
  "approved" boolean NOT NULL DEFAULT false,
  "locked" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("story_id", "chapter_number")
);

CREATE TABLE IF NOT EXISTS "story_memories" (
  "id" serial PRIMARY KEY,
  "story_id" text NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
  "chapter_id" integer REFERENCES "story_chapters"("id") ON DELETE SET NULL,
  "memory_type" varchar(50) NOT NULL DEFAULT 'fact',
  "content" text NOT NULL,
  "tags" jsonb DEFAULT '[]',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "story_quality_checks" (
  "id" serial PRIMARY KEY,
  "story_id" text NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
  "chapter_id" integer NOT NULL REFERENCES "story_chapters"("id") ON DELETE CASCADE,
  "passed" boolean NOT NULL DEFAULT false,
  "scores" jsonb,
  "issues" jsonb DEFAULT '[]',
  "repair_prompt" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_story_taxonomy_parent" ON "story_taxonomy"("parent_id");
CREATE INDEX IF NOT EXISTS "idx_story_taxonomy_level" ON "story_taxonomy"("level");
CREATE INDEX IF NOT EXISTS "idx_stories_status" ON "stories"("status");
CREATE INDEX IF NOT EXISTS "idx_stories_created" ON "stories"("created_at");
CREATE INDEX IF NOT EXISTS "idx_story_characters_story" ON "story_characters"("story_id");
CREATE INDEX IF NOT EXISTS "idx_story_chapters_story" ON "story_chapters"("story_id");
CREATE INDEX IF NOT EXISTS "idx_story_memories_story" ON "story_memories"("story_id");
CREATE INDEX IF NOT EXISTS "idx_story_quality_checks_chapter" ON "story_quality_checks"("chapter_id");
