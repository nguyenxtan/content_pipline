-- Hook Type tracking fields
-- Run: pnpm db:push  OR  psql $DATABASE_URL -f drizzle/0038_hook_type_tracking.sql

ALTER TABLE "content_generations"
  ADD COLUMN IF NOT EXISTS "hook_type" varchar(50),
  ADD COLUMN IF NOT EXISTS "hook_variant" varchar(100),
  ADD COLUMN IF NOT EXISTS "hook_generated_at" timestamptz;
