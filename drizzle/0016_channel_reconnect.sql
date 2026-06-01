-- Thêm trạng thái reconnect vào social_channels
ALTER TABLE "social_channels"
  ADD COLUMN IF NOT EXISTS "needs_reconnect" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "last_error"       text;
