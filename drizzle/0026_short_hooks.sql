ALTER TABLE "content_generations"
  ADD COLUMN "short_hook_candidates" jsonb DEFAULT '[]'::jsonb;

ALTER TABLE "content_generations"
  ADD COLUMN "short_selected_hook" text;
