ALTER TABLE "content_scheduler_jobs"
  ADD COLUMN IF NOT EXISTS "long_image_style"        varchar(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "long_thumbnail_fal_model" varchar(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "long_thumbnail_llm_model" varchar(100) DEFAULT NULL;
