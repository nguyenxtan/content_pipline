ALTER TABLE "finance_raw_items" ADD COLUMN "image_cached_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "local_image_path" text;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "image_height" integer;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "image_downloaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "image_content_type" text;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "image_bytes" integer;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "image_error" text;