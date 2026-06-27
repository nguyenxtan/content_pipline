-- Short Cover Asset tracking fields
-- Run: pnpm db:push  OR  psql $DATABASE_URL -f drizzle/0037_short_cover_tracking.sql

ALTER TABLE "content_generations"
  ADD COLUMN IF NOT EXISTS "short_cover_asset_path" text,
  ADD COLUMN IF NOT EXISTS "short_cover_text" text,
  ADD COLUMN IF NOT EXISTS "short_cover_generated_at" timestamptz;
