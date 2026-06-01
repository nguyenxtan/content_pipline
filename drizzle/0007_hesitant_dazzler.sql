CREATE TABLE "api_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" varchar(100) NOT NULL,
	"provider" varchar(50) DEFAULT 'openai' NOT NULL,
	"purpose" varchar(60) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 8) DEFAULT '0' NOT NULL,
	"niche_id" integer,
	"content_generation_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX "idx_usage_created" ON "api_usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_usage_model" ON "api_usage_logs" USING btree ("model");--> statement-breakpoint
CREATE INDEX "idx_usage_purpose" ON "api_usage_logs" USING btree ("purpose");