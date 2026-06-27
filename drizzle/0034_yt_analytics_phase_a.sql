-- YouTube Analytics Phase A: share_count write, estimatedMinutesWatched, subscribersGained/Lost, engagedViews (schema-only)
ALTER TABLE "video_metric_snapshots"
  ADD COLUMN IF NOT EXISTS "estimated_minutes_watched" integer,
  ADD COLUMN IF NOT EXISTS "subscribers_gained" integer,
  ADD COLUMN IF NOT EXISTS "subscribers_lost" integer,
  ADD COLUMN IF NOT EXISTS "engaged_views" bigint;
