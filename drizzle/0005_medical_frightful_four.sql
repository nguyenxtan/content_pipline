ALTER TABLE "content_generations" ADD COLUMN "tts_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "tts_error_message" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "tts_output_url" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "youtube_upload_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "youtube_upload_error" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "youtube_video_url" text;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "youtube_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "is_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_generations" ADD COLUMN "locked_by" text;--> statement-breakpoint
CREATE INDEX "idx_content_gen_topic" ON "content_generations" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "idx_content_gen_locked" ON "content_generations" USING btree ("is_locked");