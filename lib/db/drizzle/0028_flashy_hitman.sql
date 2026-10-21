CREATE TABLE IF NOT EXISTS "login_throttle" (
	"bucket" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_integrations" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "folder_id" integer;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "entities" ADD CONSTRAINT "entities_folder_id_entity_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."entity_folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;