ALTER TABLE "content_generations"
ADD COLUMN IF NOT EXISTS "hook_scored_candidates" jsonb DEFAULT '[]'::jsonb;

ALTER TABLE "content_generations"
ADD COLUMN IF NOT EXISTS "hook_score" integer;

ALTER TABLE "content_generations"
ADD COLUMN IF NOT EXISTS "hook_pattern" varchar(50);
