CREATE TABLE "cron_run_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "ran_at" timestamp with time zone DEFAULT now() NOT NULL,
  "jobs_ran" integer DEFAULT 0 NOT NULL,
  "jobs_results" jsonb,
  "uploads_processed" integer DEFAULT 0 NOT NULL,
  "has_errors" boolean DEFAULT false NOT NULL,
  "error_summary" text,
  "duration_ms" integer
);

CREATE INDEX "idx_cron_run_logs_ran_at" ON "cron_run_logs" ("ran_at");
