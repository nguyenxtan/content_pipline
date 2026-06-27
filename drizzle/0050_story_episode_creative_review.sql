ALTER TABLE "story_episodes"
  ADD COLUMN "creative_review_status" varchar(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN "creative_review_notes" text,
  ADD COLUMN "creative_reviewed_at" timestamp with time zone,
  ADD COLUMN "creative_review_hash" text,
  ADD COLUMN "creative_reviewer_label" varchar(120);
