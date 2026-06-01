ALTER TABLE "content_scheduler_jobs" ALTER COLUMN "topic" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "topic_model" varchar(100) DEFAULT 'openai/gpt-4o-mini';--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD COLUMN "script_model" varchar(100) DEFAULT 'openai/gpt-4o-mini';