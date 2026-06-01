ALTER TABLE "niches" ADD COLUMN "icon" varchar(10);--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "stages" jsonb DEFAULT '["ideation","script","short","long"]'::jsonb NOT NULL;