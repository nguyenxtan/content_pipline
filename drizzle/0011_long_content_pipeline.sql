-- Long content pipeline fields
-- Short content dùng các field hiện tại (tts_status, audio_path, video_status, video_path)
-- Long content có pipeline riêng hoàn toàn độc lập

ALTER TABLE content_generations
  ADD COLUMN IF NOT EXISTS long_tts_status       VARCHAR(20)  DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS long_tts_error_message TEXT,
  ADD COLUMN IF NOT EXISTS long_audio_path        TEXT,
  ADD COLUMN IF NOT EXISTS long_video_status      VARCHAR(20)  DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS long_video_error_message TEXT,
  ADD COLUMN IF NOT EXISTS long_video_path        TEXT;
