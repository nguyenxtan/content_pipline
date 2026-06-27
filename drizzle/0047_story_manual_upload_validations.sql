-- Phase F3: Manual YouTube Upload Validation Tracking
-- Records the result of a manual YouTube upload for a story episode.
-- No YouTube API calls — user fills this in after uploading manually.

CREATE TABLE IF NOT EXISTS story_manual_upload_validations (
  id                  TEXT PRIMARY KEY,
  story_id            TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  episode_id          TEXT NOT NULL REFERENCES story_episodes(id) ON DELETE CASCADE,
  upload_package_id   TEXT REFERENCES story_upload_packages(id) ON DELETE SET NULL,
  youtube_video_url   TEXT,
  youtube_video_id    TEXT,
  youtube_playlist_url TEXT,
  youtube_playlist_id TEXT,
  -- not_uploaded | uploaded_private | uploaded_unlisted | uploaded_public | failed | needs_fix
  upload_status       VARCHAR(50) NOT NULL DEFAULT 'not_uploaded',
  -- private | unlisted | public
  visibility          VARCHAR(50),
  title_ok            BOOLEAN NOT NULL DEFAULT FALSE,
  thumbnail_ok        BOOLEAN NOT NULL DEFAULT FALSE,
  srt_ok              BOOLEAN NOT NULL DEFAULT FALSE,
  audio_ok            BOOLEAN NOT NULL DEFAULT FALSE,
  description_ok      BOOLEAN NOT NULL DEFAULT FALSE,
  -- clean | no_claim | claimed | blocked
  copyright_status    VARCHAR(50),
  -- none | age_restricted | country_blocked | other
  restriction_status  VARCHAR(50),
  validation_notes    TEXT,
  uploaded_at         TIMESTAMPTZ,
  validated_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_manual_upload_validations_story   ON story_manual_upload_validations(story_id);
CREATE INDEX IF NOT EXISTS idx_story_manual_upload_validations_episode ON story_manual_upload_validations(episode_id);
