ALTER TABLE "content_scheduler_jobs"
  ADD COLUMN IF NOT EXISTS "long_thumbnail_image_style" varchar(50) DEFAULT NULL;
