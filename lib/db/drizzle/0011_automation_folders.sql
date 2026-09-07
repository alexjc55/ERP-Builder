CREATE TABLE "automation_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_automations" ADD COLUMN "folder_id" integer;--> statement-breakpoint
ALTER TABLE "automation_folders" ADD CONSTRAINT "automation_folders_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_folder_entity_idx" ON "automation_folders" USING btree ("entity_id");--> statement-breakpoint
ALTER TABLE "entity_automations" ADD CONSTRAINT "entity_automations_folder_id_automation_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."automation_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_automation_folder_idx" ON "entity_automations" USING btree ("folder_id");