ALTER TABLE "finance_news_sources" ADD COLUMN "quality_score" numeric(3, 1) DEFAULT '5.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_news_sources" ADD COLUMN "source_type" varchar(20) DEFAULT 'rss' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_news_sources" ADD COLUMN "default_topic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_news_sources" ADD COLUMN "notes" text;