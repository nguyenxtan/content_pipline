-- Phase 6: Observability & Data Loop
-- Adds manifest/tracking fields to content_generations
-- Adds analytics fields to video_metric_snapshots

ALTER TABLE "content_generations"
  ADD COLUMN IF NOT EXISTS "thumbnail_text" text,
  ADD COLUMN IF NOT EXISTS "render_time_total_ms" integer,
  ADD COLUMN IF NOT EXISTS "main_model_used" varchar(100);

ALTER TABLE "video_metric_snapshots"
  ADD COLUMN IF NOT EXISTS "share_count" bigint,
  ADD COLUMN IF NOT EXISTS "ctr" numeric(6,4),
  ADD COLUMN IF NOT EXISTS "avg_view_duration_sec" integer,
  ADD COLUMN IF NOT EXISTS "retention_pct" numeric(5,2);
