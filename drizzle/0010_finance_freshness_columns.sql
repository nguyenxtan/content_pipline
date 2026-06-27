ALTER TABLE "finance_raw_items" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "collected_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_raw_items" ADD COLUMN "freshness_bucket" varchar(20);--> statement-breakpoint
CREATE INDEX "idx_finance_raw_items_first_seen" ON "finance_raw_items" USING btree ("first_seen_at");