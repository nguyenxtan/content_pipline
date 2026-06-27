CREATE TABLE IF NOT EXISTS "tts_voices" (
  "id" text PRIMARY KEY,
  "provider" varchar(50) NOT NULL,
  "voice_id" text NOT NULL,
  "name" text NOT NULL,
  "gender" varchar(50),
  "age" varchar(50),
  "language" varchar(100),
  "category" text,
  "use_case" text,
  "raw_json" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_tts_voices_provider_voice"
  ON "tts_voices" ("provider", "voice_id");
CREATE INDEX IF NOT EXISTS "idx_tts_voices_provider"
  ON "tts_voices" ("provider");
CREATE INDEX IF NOT EXISTS "idx_tts_voices_language"
  ON "tts_voices" ("language");

CREATE TABLE IF NOT EXISTS "tts_jobs" (
  "id" text PRIMARY KEY,
  "provider" varchar(50) NOT NULL,
  "external_job_id" text NOT NULL,
  "voice_id" text,
  "chapter_id" text,
  "status" varchar(40) DEFAULT 'queued' NOT NULL,
  "credit_used" numeric(12,4),
  "audio_url" text,
  "srt_url" text,
  "raw_json" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_tts_jobs_provider_external"
  ON "tts_jobs" ("provider", "external_job_id");
CREATE INDEX IF NOT EXISTS "idx_tts_jobs_provider_status"
  ON "tts_jobs" ("provider", "status");
CREATE INDEX IF NOT EXISTS "idx_tts_jobs_chapter"
  ON "tts_jobs" ("chapter_id");
