ALTER TABLE "content_scheduler_jobs"
  ADD COLUMN "yt_auto_post" boolean DEFAULT false NOT NULL,
  ADD COLUMN "yt_channel_id" integer REFERENCES "social_channels"("id") ON DELETE SET NULL,
  ADD COLUMN "yt_window_start" varchar(5) DEFAULT '06:00',
  ADD COLUMN "yt_window_end" varchar(5) DEFAULT '22:00',
  ADD COLUMN "yt_interval_min" integer DEFAULT 60,
  ADD COLUMN "yt_privacy" varchar(20) DEFAULT 'public';
