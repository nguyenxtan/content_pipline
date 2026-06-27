ALTER TABLE "niches"
ADD COLUMN IF NOT EXISTS "content_profile_key" varchar(50) NOT NULL DEFAULT 'buddhism';

ALTER TABLE "niches"
ADD COLUMN IF NOT EXISTS "channel_key" varchar(50) NOT NULL DEFAULT 'phat_phap';

ALTER TABLE "content_generations"
ADD COLUMN IF NOT EXISTS "content_profile_key" varchar(50) NOT NULL DEFAULT 'buddhism';

ALTER TABLE "content_generations"
ADD COLUMN IF NOT EXISTS "channel_key" varchar(50) NOT NULL DEFAULT 'phat_phap';

UPDATE "niches"
SET
  "content_profile_key" = 'buddhism',
  "channel_key" = 'phat_phap'
WHERE
  "content_profile_key" IS NULL
  OR "channel_key" IS NULL;

UPDATE "content_generations"
SET
  "content_profile_key" = 'buddhism',
  "channel_key" = 'phat_phap'
WHERE
  "content_profile_key" IS NULL
  OR "channel_key" IS NULL;
