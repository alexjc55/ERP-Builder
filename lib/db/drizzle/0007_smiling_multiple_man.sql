ALTER TABLE "entities" ADD COLUMN "status_name_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "status_sort_order" integer;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "status_manual_edit_policy" text DEFAULT 'allowed' NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "status_manual_edit_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;