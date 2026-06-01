CREATE TABLE IF NOT EXISTS "youtube_oauth_clients" (
  "id"            serial        PRIMARY KEY,
  "name"          varchar(100)  NOT NULL,
  "client_id"     varchar(300)  NOT NULL,
  "client_secret" varchar(300)  NOT NULL,
  "is_active"     boolean       NOT NULL DEFAULT true,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "social_channels"
  ADD COLUMN IF NOT EXISTS "oauth_client_config_id" integer REFERENCES "youtube_oauth_clients"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "quota_exceeded_until"   timestamp with time zone;
