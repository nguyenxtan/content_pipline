-- Tee Audio SEO metadata storage for production Audio Story episodes.

CREATE TABLE IF NOT EXISTS "story_episode_metadata" (
  "id" text PRIMARY KEY,
  "story_id" text NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
  "episode_id" text NOT NULL REFERENCES "story_episodes"("id") ON DELETE CASCADE,
  "seo_title" text NOT NULL,
  "youtube_title" text NOT NULL,
  "title_candidates_json" jsonb NOT NULL DEFAULT '[]',
  "description" text NOT NULL,
  "tags_json" jsonb NOT NULL DEFAULT '[]',
  "hashtags_json" jsonb NOT NULL DEFAULT '[]',
  "pinned_comment" text NOT NULL,
  "playlist_title" text NOT NULL,
  "playlist_position" integer NOT NULL,
  "author_name" text NOT NULL,
  "genre_text" text NOT NULL,
  "episode_label" text NOT NULL,
  "chapter_range_text" text NOT NULL,
  "target_channel_id" text,
  "target_channel_name" text,
  "target_channel_handle" text,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "approved_at" timestamptz,
  "approved" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("episode_id")
);

CREATE INDEX IF NOT EXISTS "idx_story_episode_metadata_story"
  ON "story_episode_metadata"("story_id");
