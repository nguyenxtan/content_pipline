ALTER TABLE "social_channels"
ADD COLUMN IF NOT EXISTS "channel_key" varchar(50) NOT NULL DEFAULT 'phat_phap';

UPDATE "social_channels"
SET "channel_key" = 'phat_phap'
WHERE "channel_key" IS NULL;
