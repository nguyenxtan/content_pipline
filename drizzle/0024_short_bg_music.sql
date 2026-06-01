-- Add background music override to short pipeline scheduler jobs
-- NULL = use niche default (musicFolder), TRUE = force enable, FALSE = force disable
ALTER TABLE "content_scheduler_jobs" ADD COLUMN IF NOT EXISTS "bg_music" boolean DEFAULT NULL;
