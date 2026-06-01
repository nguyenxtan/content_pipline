-- Migration: separate content_gen / short_pipeline / long_pipeline scheduler types

ALTER TABLE "content_generations"
  ADD COLUMN IF NOT EXISTS "content_mode" varchar(10) NOT NULL DEFAULT 'both';

ALTER TABLE "content_scheduler_jobs"
  ADD COLUMN IF NOT EXISTS "job_type"     varchar(20) NOT NULL DEFAULT 'content_gen',
  ADD COLUMN IF NOT EXISTS "content_mode" varchar(10) NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS "batch_size"   integer     NOT NULL DEFAULT 3;
