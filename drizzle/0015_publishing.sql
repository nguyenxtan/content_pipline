-- Social channels: kênh YouTube, trang Facebook đã kết nối OAuth
CREATE TABLE IF NOT EXISTS "social_channels" (
  "id"                   serial PRIMARY KEY,
  "platform"             varchar(20)  NOT NULL,
  "name"                 varchar(200) NOT NULL,
  "platform_channel_id"  varchar(200),
  "platform_handle"      varchar(100),
  "thumbnail_url"        text,
  "access_token"         text,
  "refresh_token"        text,
  "token_expires_at"     timestamptz,
  "scope"                text,
  "is_active"            boolean NOT NULL DEFAULT true,
  "notes"                text,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_social_channels_platform" ON "social_channels" ("platform");
CREATE INDEX IF NOT EXISTS "idx_social_channels_active"   ON "social_channels" ("is_active");

-- Upload queue: hàng chờ đăng video lên YouTube / Facebook
CREATE TABLE IF NOT EXISTS "upload_queue" (
  "id"                  text PRIMARY KEY,
  "content_id"          text        NOT NULL REFERENCES "content_generations"("id") ON DELETE CASCADE,
  "channel_id"          integer     NOT NULL REFERENCES "social_channels"("id")     ON DELETE CASCADE,
  "platform"            varchar(20) NOT NULL,
  "video_type"          varchar(10) NOT NULL,
  "title"               text        NOT NULL,
  "description"         text        NOT NULL DEFAULT '',
  "tags"                jsonb                DEFAULT '[]',
  "privacy_status"      varchar(20) NOT NULL DEFAULT 'public',
  "scheduled_at"        timestamptz NOT NULL,
  "status"              varchar(20) NOT NULL DEFAULT 'queued',
  "error_message"       text,
  "platform_video_id"   varchar(100),
  "platform_video_url"  text,
  "uploaded_at"         timestamptz,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_upload_queue_status"    ON "upload_queue" ("status");
CREATE INDEX IF NOT EXISTS "idx_upload_queue_scheduled" ON "upload_queue" ("scheduled_at");
CREATE INDEX IF NOT EXISTS "idx_upload_queue_content"   ON "upload_queue" ("content_id");
CREATE INDEX IF NOT EXISTS "idx_upload_queue_channel"   ON "upload_queue" ("channel_id");
