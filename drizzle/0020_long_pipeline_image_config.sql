ALTER TABLE "content_scheduler_jobs"
  ADD COLUMN IF NOT EXISTS "long_image_count" integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "long_fal_model"   varchar(100) DEFAULT NULL;
