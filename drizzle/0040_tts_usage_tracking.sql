-- Extend tts_jobs with usage tracking fields for the AiMax Usage Monitor.
-- All columns are nullable so existing rows (created before this migration) remain valid.

ALTER TABLE "tts_jobs"
  ADD COLUMN IF NOT EXISTS "pipeline_route"      varchar(80),
  ADD COLUMN IF NOT EXISTS "content_id"          text,
  ADD COLUMN IF NOT EXISTS "content_profile_key" text,
  ADD COLUMN IF NOT EXISTS "niche_name"          text,
  ADD COLUMN IF NOT EXISTS "format_type"         text,
  ADD COLUMN IF NOT EXISTS "voice_label"         text,
  ADD COLUMN IF NOT EXISTS "voice_family"        varchar(80),
  ADD COLUMN IF NOT EXISTS "speed"               numeric(6,3),
  ADD COLUMN IF NOT EXISTS "pitch"               numeric(6,3),
  ADD COLUMN IF NOT EXISTS "text_hash"           text,
  ADD COLUMN IF NOT EXISTS "text_char_count"     integer,
  ADD COLUMN IF NOT EXISTS "cache_identity"      text,
  ADD COLUMN IF NOT EXISTS "cache_hit"           boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "started_at"          timestamptz,
  ADD COLUMN IF NOT EXISTS "completed_at"        timestamptz,
  ADD COLUMN IF NOT EXISTS "duration_ms"         integer,
  ADD COLUMN IF NOT EXISTS "error_message"       text,
  ADD COLUMN IF NOT EXISTS "usage_source"        varchar(30),
  ADD COLUMN IF NOT EXISTS "estimated_credits"   numeric(12,4),
  ADD COLUMN IF NOT EXISTS "balance_before"      numeric(14,4),
  ADD COLUMN IF NOT EXISTS "balance_after"       numeric(14,4);

CREATE INDEX IF NOT EXISTS "idx_tts_jobs_content_id"             ON "tts_jobs" ("content_id");
CREATE INDEX IF NOT EXISTS "idx_tts_jobs_pipeline_route_created" ON "tts_jobs" ("pipeline_route", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_tts_jobs_provider_created_at"    ON "tts_jobs" ("provider", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_tts_jobs_voice_family_created"   ON "tts_jobs" ("voice_family", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_tts_jobs_status_created"         ON "tts_jobs" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_tts_jobs_cache_hit"              ON "tts_jobs" ("cache_hit");
