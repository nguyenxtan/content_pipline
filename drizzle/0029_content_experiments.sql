ALTER TABLE "content_generations"
ADD COLUMN IF NOT EXISTS "experiment_id" text;

ALTER TABLE "content_generations"
ADD COLUMN IF NOT EXISTS "experiment_variant" text;

CREATE INDEX IF NOT EXISTS "idx_content_gen_experiment"
ON "content_generations" ("experiment_id", "experiment_variant");
