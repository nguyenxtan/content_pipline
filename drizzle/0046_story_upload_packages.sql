-- Phase F2: story_upload_packages table
-- Tracks manual upload packages for story episodes.
-- One package per episode; contains MP4, SRT, thumbnail, metadata files.
-- No upload_queue usage. No content_generations usage.

CREATE TABLE IF NOT EXISTS story_upload_packages (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES story_episodes(id) ON DELETE CASCADE,
  video_asset_id TEXT REFERENCES story_video_assets(id) ON DELETE SET NULL,
  package_dir TEXT,
  package_zip_path TEXT,
  title TEXT,
  description TEXT,
  tags_json JSONB DEFAULT '[]',
  playlist_title TEXT,
  playlist_position INTEGER,
  pinned_comment TEXT,
  video_path TEXT,
  subtitle_path TEXT,
  thumbnail_path TEXT,
  metadata_path TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_upload_packages_story ON story_upload_packages(story_id);
CREATE INDEX IF NOT EXISTS idx_story_upload_packages_episode ON story_upload_packages(episode_id);
