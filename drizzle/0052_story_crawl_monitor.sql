CREATE TABLE IF NOT EXISTS "story_crawl_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "mode" varchar(40) NOT NULL,
  "source_site" varchar(120),
  "status" varchar(30) NOT NULL DEFAULT 'running',
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone,
  "heartbeat_at" timestamp with time zone NOT NULL DEFAULT now(),
  "current_story_id" text REFERENCES "story_sources"("id") ON DELETE SET NULL,
  "current_story_title" varchar(500),
  "current_chapter_id" text REFERENCES "story_source_chapters"("id") ON DELETE SET NULL,
  "current_chapter_title" varchar(500),
  "current_url" text,
  "attempted_stories" integer NOT NULL DEFAULT 0,
  "attempted_chapters" integer NOT NULL DEFAULT 0,
  "succeeded_chapters" integer NOT NULL DEFAULT 0,
  "failed_chapters" integer NOT NULL DEFAULT 0,
  "skipped_duplicates" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_story_crawl_runs_status" ON "story_crawl_runs"("status");
CREATE INDEX IF NOT EXISTS "idx_story_crawl_runs_mode" ON "story_crawl_runs"("mode");
CREATE INDEX IF NOT EXISTS "idx_story_crawl_runs_started" ON "story_crawl_runs"("started_at");
CREATE INDEX IF NOT EXISTS "idx_story_crawl_runs_heartbeat" ON "story_crawl_runs"("heartbeat_at");

CREATE TABLE IF NOT EXISTS "story_crawl_events" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text REFERENCES "story_crawl_runs"("id") ON DELETE SET NULL,
  "event_type" varchar(100) NOT NULL,
  "level" varchar(20) NOT NULL DEFAULT 'info',
  "message" text NOT NULL,
  "story_id" text REFERENCES "story_sources"("id") ON DELETE SET NULL,
  "chapter_id" text REFERENCES "story_source_chapters"("id") ON DELETE SET NULL,
  "url" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_story_crawl_events_run" ON "story_crawl_events"("run_id");
CREATE INDEX IF NOT EXISTS "idx_story_crawl_events_type" ON "story_crawl_events"("event_type");
CREATE INDEX IF NOT EXISTS "idx_story_crawl_events_level" ON "story_crawl_events"("level");
CREATE INDEX IF NOT EXISTS "idx_story_crawl_events_created" ON "story_crawl_events"("created_at");
