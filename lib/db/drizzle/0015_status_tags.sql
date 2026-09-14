CREATE TABLE "status_tags" (
	"status_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "status_tags_status_id_tag_id_pk" PRIMARY KEY("status_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"applicable_to" text[] DEFAULT '{"statuses"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "permissions_json" SET DEFAULT '{"superAdmin":false,"admin":{"pages":false,"entities":false,"roles":false,"users":false,"translations":false,"events":false,"modules":false,"automations":false,"customFilters":false,"columnGroups":false,"googleDrive":false,"settings":false,"dataImport":false,"inboundIntegrations":false,"documentGeneration":false,"tags":false},"pageIds":[],"records":{}}'::jsonb;--> statement-breakpoint
ALTER TABLE "status_tags" ADD CONSTRAINT "status_tags_status_id_entity_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."entity_statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_tags" ADD CONSTRAINT "status_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;