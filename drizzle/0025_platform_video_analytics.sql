ALTER TABLE "social_channels"
ADD COLUMN IF NOT EXISTS "platform_account_id" integer;

CREATE TABLE IF NOT EXISTS "platform_accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "platform" varchar(20) NOT NULL,
  "platform_account_id" varchar(200) NOT NULL,
  "display_name" varchar(200) NOT NULL,
  "handle" varchar(100),
  "thumbnail_url" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_platform_accounts_platform_account"
ON "platform_accounts" ("platform", "platform_account_id");
CREATE INDEX IF NOT EXISTS "idx_platform_accounts_platform"
ON "platform_accounts" ("platform");
CREATE INDEX IF NOT EXISTS "idx_platform_accounts_active"
ON "platform_accounts" ("is_active");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'social_channels_platform_account_id_platform_accounts_id_fk'
      AND table_name = 'social_channels'
  ) THEN
    ALTER TABLE "social_channels"
    ADD CONSTRAINT "social_channels_platform_account_id_platform_accounts_id_fk"
    FOREIGN KEY ("platform_account_id")
    REFERENCES "public"."platform_accounts"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

INSERT INTO "platform_accounts" (
  "platform",
  "platform_account_id",
  "display_name",
  "handle",
  "thumbnail_url",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (sc."platform", sc."platform_channel_id")
  sc."platform",
  sc."platform_channel_id",
  sc."name",
  sc."platform_handle",
  sc."thumbnail_url",
  sc."is_active",
  now(),
  now()
FROM "social_channels" sc
WHERE sc."platform_channel_id" IS NOT NULL
  AND sc."platform_channel_id" <> ''
ON CONFLICT ("platform", "platform_account_id")
DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "handle" = EXCLUDED."handle",
  "thumbnail_url" = EXCLUDED."thumbnail_url",
  "is_active" = EXCLUDED."is_active",
  "updated_at" = now();

UPDATE "social_channels" sc
SET "platform_account_id" = pa."id"
FROM "platform_accounts" pa
WHERE pa."platform" = sc."platform"
  AND pa."platform_account_id" = sc."platform_channel_id"
  AND sc."platform_channel_id" IS NOT NULL
  AND (sc."platform_account_id" IS NULL OR sc."platform_account_id" <> pa."id");

CREATE TABLE IF NOT EXISTS "published_videos" (
  "id" text PRIMARY KEY NOT NULL,
  "upload_queue_id" text,
  "content_id" text,
  "platform" varchar(20) NOT NULL,
  "platform_account_id" integer NOT NULL,
  "credential_channel_id" integer,
  "platform_video_id" varchar(100) NOT NULL,
  "platform_video_url" text,
  "video_type" varchar(10) NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "privacy_status" varchar(20),
  "duration_seconds" integer,
  "published_at" timestamp with time zone,
  "latest_view_count" bigint,
  "latest_like_count" bigint,
  "latest_comment_count" bigint,
  "latest_fetched_at" timestamp with time zone,
  "raw_latest_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_published_videos_platform_video"
ON "published_videos" ("platform", "platform_video_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_published_videos_upload_queue"
ON "published_videos" ("upload_queue_id");
CREATE INDEX IF NOT EXISTS "idx_published_videos_platform"
ON "published_videos" ("platform");
CREATE INDEX IF NOT EXISTS "idx_published_videos_account"
ON "published_videos" ("platform_account_id");
CREATE INDEX IF NOT EXISTS "idx_published_videos_published_at"
ON "published_videos" ("published_at");
CREATE INDEX IF NOT EXISTS "idx_published_videos_content"
ON "published_videos" ("content_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'published_videos_upload_queue_id_upload_queue_id_fk'
      AND table_name = 'published_videos'
  ) THEN
    ALTER TABLE "published_videos"
    ADD CONSTRAINT "published_videos_upload_queue_id_upload_queue_id_fk"
    FOREIGN KEY ("upload_queue_id")
    REFERENCES "public"."upload_queue"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'published_videos_content_id_content_generations_id_fk'
      AND table_name = 'published_videos'
  ) THEN
    ALTER TABLE "published_videos"
    ADD CONSTRAINT "published_videos_content_id_content_generations_id_fk"
    FOREIGN KEY ("content_id")
    REFERENCES "public"."content_generations"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'published_videos_platform_account_id_platform_accounts_id_fk'
      AND table_name = 'published_videos'
  ) THEN
    ALTER TABLE "published_videos"
    ADD CONSTRAINT "published_videos_platform_account_id_platform_accounts_id_fk"
    FOREIGN KEY ("platform_account_id")
    REFERENCES "public"."platform_accounts"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'published_videos_credential_channel_id_social_channels_id_fk'
      AND table_name = 'published_videos'
  ) THEN
    ALTER TABLE "published_videos"
    ADD CONSTRAINT "published_videos_credential_channel_id_social_channels_id_fk"
    FOREIGN KEY ("credential_channel_id")
    REFERENCES "public"."social_channels"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "video_metric_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "published_video_id" text NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "view_count" bigint,
  "like_count" bigint,
  "comment_count" bigint,
  "favorite_count" bigint,
  "privacy_status" varchar(20),
  "duration_seconds" integer,
  "raw_json" jsonb
);

CREATE INDEX IF NOT EXISTS "idx_video_metric_snapshots_video"
ON "video_metric_snapshots" ("published_video_id");
CREATE INDEX IF NOT EXISTS "idx_video_metric_snapshots_fetched"
ON "video_metric_snapshots" ("fetched_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'video_metric_snapshots_published_video_id_published_videos_id_fk'
      AND table_name = 'video_metric_snapshots'
  ) THEN
    ALTER TABLE "video_metric_snapshots"
    ADD CONSTRAINT "video_metric_snapshots_published_video_id_published_videos_id_fk"
    FOREIGN KEY ("published_video_id")
    REFERENCES "public"."published_videos"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

INSERT INTO "published_videos" (
  "id",
  "upload_queue_id",
  "content_id",
  "platform",
  "platform_account_id",
  "credential_channel_id",
  "platform_video_id",
  "platform_video_url",
  "video_type",
  "title",
  "description",
  "tags",
  "privacy_status",
  "published_at",
  "created_at",
  "updated_at"
)
SELECT
  md5(random()::text || clock_timestamp()::text || uq."id"),
  uq."id",
  uq."content_id",
  uq."platform",
  sc."platform_account_id",
  uq."channel_id",
  uq."platform_video_id",
  uq."platform_video_url",
  uq."video_type",
  uq."title",
  uq."description",
  COALESCE(uq."tags", '[]'::jsonb),
  uq."privacy_status",
  COALESCE(uq."uploaded_at", uq."scheduled_at"),
  now(),
  now()
FROM "upload_queue" uq
INNER JOIN "social_channels" sc ON sc."id" = uq."channel_id"
WHERE uq."status" = 'done'
  AND uq."platform_video_id" IS NOT NULL
  AND sc."platform_account_id" IS NOT NULL
ON CONFLICT ("platform", "platform_video_id")
DO UPDATE SET
  "upload_queue_id" = EXCLUDED."upload_queue_id",
  "content_id" = EXCLUDED."content_id",
  "platform_account_id" = EXCLUDED."platform_account_id",
  "credential_channel_id" = EXCLUDED."credential_channel_id",
  "platform_video_url" = EXCLUDED."platform_video_url",
  "video_type" = EXCLUDED."video_type",
  "title" = EXCLUDED."title",
  "description" = EXCLUDED."description",
  "tags" = EXCLUDED."tags",
  "privacy_status" = EXCLUDED."privacy_status",
  "published_at" = EXCLUDED."published_at",
  "updated_at" = now();
