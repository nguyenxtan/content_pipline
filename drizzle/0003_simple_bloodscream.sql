CREATE TABLE "generated_contents" (
	"id" text PRIMARY KEY NOT NULL,
	"niche_id" integer NOT NULL,
	"stage" varchar(50) NOT NULL,
	"prompt_template_id" integer NOT NULL,
	"prompt_version" integer NOT NULL,
	"input_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" text,
	"generation_time" integer,
	"output_tokens" integer,
	"total_cost" numeric(10, 6),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"n8n_workflow_id" varchar(200),
	"n8n_execution_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_prompt_template_id_prompt_templates_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contents_niche_stage" ON "generated_contents" USING btree ("niche_id","stage");--> statement-breakpoint
CREATE INDEX "idx_contents_status" ON "generated_contents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_contents_created_at" ON "generated_contents" USING btree ("created_at");