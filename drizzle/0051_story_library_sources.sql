CREATE TABLE IF NOT EXISTS "story_sources" (
  "id" text PRIMARY KEY,
  "source_site" varchar(120) NOT NULL,
  "source_url" text NOT NULL UNIQUE,
  "slug" varchar(255) NOT NULL,
  "title" varchar(500) NOT NULL,
  "author" varchar(255),
  "genres" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(50),
  "intro" text,
  "chapter_count" integer NOT NULL DEFAULT 0,
  "crawled_chapter_count" integer NOT NULL DEFAULT 0,
  "total_word_count" integer NOT NULL DEFAULT 0,
  "crawl_status" varchar(20) NOT NULL DEFAULT 'queued',
  "last_error" text,
  "last_crawled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_story_sources_site" ON "story_sources"("source_site");
CREATE INDEX IF NOT EXISTS "idx_story_sources_slug" ON "story_sources"("slug");
CREATE INDEX IF NOT EXISTS "idx_story_sources_crawl_status" ON "story_sources"("crawl_status");
CREATE INDEX IF NOT EXISTS "idx_story_sources_updated" ON "story_sources"("updated_at");

CREATE TABLE IF NOT EXISTS "story_source_chapters" (
  "id" text PRIMARY KEY,
  "story_id" text NOT NULL REFERENCES "story_sources"("id") ON DELETE CASCADE,
  "chapter_number" integer NOT NULL,
  "chapter_title" varchar(500),
  "chapter_url" text NOT NULL UNIQUE,
  "content_text" text,
  "word_count" integer NOT NULL DEFAULT 0,
  "content_hash" varchar(64),
  "crawl_status" varchar(20) NOT NULL DEFAULT 'queued',
  "last_error" text,
  "crawled_at" timestamp with time zone,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_story_source_chapters_story" ON "story_source_chapters"("story_id");
CREATE INDEX IF NOT EXISTS "idx_story_source_chapters_status" ON "story_source_chapters"("crawl_status");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_story_source_chapter_number" ON "story_source_chapters"("story_id", "chapter_number");
