CREATE TABLE "prompt_test_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"niche_id" integer NOT NULL,
	"stage" varchar(50) NOT NULL,
	"prompt_template_id" integer,
	"model" varchar(100) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"output" text,
	"input_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'success' NOT NULL,
	"error_message" text,
	"openrouter_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_test_runs" ADD CONSTRAINT "prompt_test_runs_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_test_runs" ADD CONSTRAINT "prompt_test_runs_prompt_template_id_prompt_templates_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_test_runs_niche_stage" ON "prompt_test_runs" USING btree ("niche_id","stage");--> statement-breakpoint
CREATE INDEX "idx_test_runs_template" ON "prompt_test_runs" USING btree ("prompt_template_id");