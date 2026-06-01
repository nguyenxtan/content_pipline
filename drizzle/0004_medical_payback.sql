CREATE TABLE "content_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"niche_id" integer NOT NULL,
	"niche_name" varchar(100) NOT NULL,
	"script" text NOT NULL,
	"short_content" text NOT NULL,
	"long_content" text NOT NULL,
	"total_tokens" integer,
	"total_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"generation_time" integer,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_scheduler_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"niche_id" integer NOT NULL,
	"niche_name" varchar(100) NOT NULL,
	"topic" text NOT NULL,
	"frequency" varchar(20) NOT NULL,
	"cron_expression" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_generations" ADD CONSTRAINT "content_generations_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_scheduler_jobs" ADD CONSTRAINT "content_scheduler_jobs_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_gen_niche" ON "content_generations" USING btree ("niche_id");--> statement-breakpoint
CREATE INDEX "idx_content_gen_created" ON "content_generations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_scheduler_niche" ON "content_scheduler_jobs" USING btree ("niche_id");--> statement-breakpoint
CREATE INDEX "idx_scheduler_enabled" ON "content_scheduler_jobs" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "idx_scheduler_next_run" ON "content_scheduler_jobs" USING btree ("next_run_at");