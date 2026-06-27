ALTER TABLE "content_generations"
ADD COLUMN IF NOT EXISTS "prompt_versions" jsonb DEFAULT '{}'::jsonb;
