-- Phase 1C: Add nullable topic_family column to content_generations
-- Additive only — no existing rows modified, no default, no backfill
ALTER TABLE "content_generations" ADD COLUMN "topic_family" text;
