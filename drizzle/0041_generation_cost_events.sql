-- Generic cost ledger: one row per cost event, linked to content by content_id.
-- All cost amounts in VND. source_table/source_id link back to origin records.
-- All columns nullable so entries can be created before cost is known.

CREATE TABLE IF NOT EXISTS "generation_cost_events" (
  "id"                  text        PRIMARY KEY,
  "content_id"          text,
  "provider"            varchar(50) NOT NULL,
  "cost_type"           varchar(30) NOT NULL,
  "pipeline_route"      varchar(80),
  "content_profile_key" text,
  "niche_name"          text,
  "format_type"         text,
  "source_table"        varchar(60),
  "source_id"           text,
  "status"              varchar(20) NOT NULL DEFAULT 'done',
  "usage_unit"          varchar(20),
  "usage_amount"        numeric(18,4),
  "unit_cost_vnd"       numeric(14,6),
  "cost_vnd"            numeric(14,4),
  "cost_source"         varchar(30) NOT NULL DEFAULT 'unknown',
  "currency"            varchar(10) NOT NULL DEFAULT 'VND',
  "metadata"            jsonb,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_cost_events_source"
  ON "generation_cost_events" ("source_table", "source_id")
  WHERE "source_table" IS NOT NULL AND "source_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_cost_events_content_id"
  ON "generation_cost_events" ("content_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_cost_events_provider_created"
  ON "generation_cost_events" ("provider", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_cost_events_cost_type_created"
  ON "generation_cost_events" ("cost_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_cost_events_pipeline_route"
  ON "generation_cost_events" ("pipeline_route", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_cost_events_niche_name"
  ON "generation_cost_events" ("niche_name", "created_at" DESC);
