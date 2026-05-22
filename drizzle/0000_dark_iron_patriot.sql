CREATE TABLE "agent_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"niche_id" integer,
	"user_input" jsonb NOT NULL,
	"suggested_prompts" jsonb NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_outputs" (
	"id" serial PRIMARY KEY NOT NULL,
	"piece_id" integer NOT NULL,
	"stage" varchar(50) NOT NULL,
	"prompt_template_id" integer,
	"prompt_rendered" text,
	"output_raw" text,
	"output_json" jsonb,
	"model" varchar(50),
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"duration_ms" integer,
	"status" varchar(20) DEFAULT 'success' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pieces" (
	"id" serial PRIMARY KEY NOT NULL,
	"niche_id" integer NOT NULL,
	"title" text,
	"status" varchar(50) DEFAULT 'idea_pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"target_audience" text,
	"tone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "niches_name_unique" UNIQUE("name"),
	CONSTRAINT "niches_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"niche_id" integer NOT NULL,
	"stage" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" varchar(50) DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"temperature" numeric(3, 2) DEFAULT '0.7' NOT NULL,
	"max_tokens" integer DEFAULT 4000 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"parent_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_suggestions" ADD CONSTRAINT "agent_suggestions_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_outputs" ADD CONSTRAINT "content_outputs_piece_id_content_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."content_pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_outputs" ADD CONSTRAINT "content_outputs_prompt_template_id_prompt_templates_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_niche_id_niches_id_fk" FOREIGN KEY ("niche_id") REFERENCES "public"."niches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outputs_piece_stage" ON "content_outputs" USING btree ("piece_id","stage");--> statement-breakpoint
CREATE INDEX "idx_pieces_status" ON "content_pieces" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pieces_niche" ON "content_pieces" USING btree ("niche_id");--> statement-breakpoint
CREATE INDEX "idx_templates_niche_stage" ON "prompt_templates" USING btree ("niche_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_niche_stage_version" ON "prompt_templates" USING btree ("niche_id","stage","version");