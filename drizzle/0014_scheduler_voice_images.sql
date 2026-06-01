ALTER TABLE "content_scheduler_jobs"
  ADD COLUMN IF NOT EXISTS "tts_voice"    varchar(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "image_count"  integer      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "image_style"  text         DEFAULT NULL;
