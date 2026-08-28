CREATE TABLE "document_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_id" integer NOT NULL,
  "name" text NOT NULL,
  "is_archived" boolean DEFAULT false NOT NULL,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_template_revisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "template_id" integer NOT NULL,
  "revision" integer NOT NULL,
  "state" text DEFAULT 'draft' NOT NULL,
  "template_path" text NOT NULL,
  "template_name" text NOT NULL,
  "manifest_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "mapping_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "errors_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" integer,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_revision_state_check" CHECK ("state" IN ('draft', 'published'))
);
--> statement-breakpoint
CREATE TABLE "document_generation_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "revision_id" integer NOT NULL,
  "entity_id" integer NOT NULL,
  "record_id" integer NOT NULL,
  "idempotency_key" text,
  "status" text NOT NULL,
  "output_json" jsonb,
  "error" text,
  "actor_user_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "document_generation_run_status_check" CHECK ("status" IN ('running', 'success', 'error'))
);
--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "document_template_revisions" ADD CONSTRAINT "document_template_revisions_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "document_template_revisions" ADD CONSTRAINT "document_template_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "document_generation_runs" ADD CONSTRAINT "document_generation_runs_revision_id_document_template_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."document_template_revisions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "document_generation_runs" ADD CONSTRAINT "document_generation_runs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "document_generation_runs" ADD CONSTRAINT "document_generation_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "document_template_entity_idx" ON "document_templates" ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_revision_number_unique" ON "document_template_revisions" ("template_id","revision");--> statement-breakpoint
CREATE INDEX "document_revision_template_idx" ON "document_template_revisions" ("template_id");--> statement-breakpoint
CREATE INDEX "document_generation_run_revision_idx" ON "document_generation_runs" ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_generation_run_idempotency_unique" ON "document_generation_runs" ("revision_id","record_id","idempotency_key");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_document_revision_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Document template revisions are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "document_revision_immutable" BEFORE UPDATE ON "document_template_revisions"
FOR EACH ROW EXECUTE FUNCTION prevent_document_revision_mutation();--> statement-breakpoint
ALTER TABLE "document_template_revisions" DROP COLUMN IF EXISTS "output_json";--> statement-breakpoint
INSERT INTO "modules" ("module_key", "name_json", "version", "is_enabled", "settings_json")
VALUES ('document_generation', '{"en":"Document generation","ru":"Генерация документов"}'::jsonb, '1.0.0', false, '{}'::jsonb)
ON CONFLICT ("module_key") DO NOTHING;--> statement-breakpoint
UPDATE "roles"
SET "permissions_json" = jsonb_set("permissions_json", '{admin,documentGeneration}', 'false'::jsonb, true)
WHERE NOT ("permissions_json" -> 'admin' ? 'documentGeneration');--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "permissions_json" SET DEFAULT
'{"superAdmin":false,"admin":{"pages":false,"entities":false,"roles":false,"users":false,"translations":false,"events":false,"modules":false,"automations":false,"customFilters":false,"columnGroups":false,"googleDrive":false,"settings":false,"dataImport":false,"inboundIntegrations":false,"documentGeneration":false},"pageIds":[],"records":{}}'::jsonb;