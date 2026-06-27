-- Phase F1: story_video_assets table
-- Tracks rendered episode MP4 files (not stored in content_generations).
-- Subtitle mode: sidecar — SRT copied alongside MP4, not burned into video.

CREATE TABLE IF NOT EXISTS story_video_assets (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES story_episodes(id) ON DELETE CASCADE,
  audio_asset_id TEXT REFERENCES story_audio_assets(id) ON DELETE SET NULL,
  video_path TEXT,
  thumbnail_path TEXT,
  cover_image_path TEXT,
  sidecar_srt_path TEXT,
  render_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  render_error TEXT,
  duration_sec NUMERIC(10,2),
  width INTEGER,
  height INTEGER,
  fps INTEGER,
  codec VARCHAR(50),
  audio_codec VARCHAR(50),
  file_size_bytes BIGINT,
  subtitle_mode VARCHAR(50) DEFAULT 'sidecar',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_video_assets_story ON story_video_assets(story_id);
CREATE INDEX IF NOT EXISTS idx_story_video_assets_episode ON story_video_assets(episode_id);
