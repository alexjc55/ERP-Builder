CREATE TABLE "card_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"entity_id" integer NOT NULL,
	"page_id" integer,
	"state" text DEFAULT 'draft' NOT NULL,
	"layout" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_templates_one_published_entity" ON "card_templates" USING btree ("entity_id") WHERE "card_templates"."state" = 'published' AND "card_templates"."page_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "card_templates_one_published_page" ON "card_templates" USING btree ("page_id") WHERE "card_templates"."state" = 'published' AND "card_templates"."page_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO pages (name_json, icon, path, parent_page_id, sort_order, is_active)
SELECT '{"ru":"Конструктор карточек","en":"Card builder","he":"בונה כרטיסים"}'::jsonb,
  'layout-template', '/admin/card-templates',
  (SELECT parent_page_id FROM pages WHERE path = '/admin/entities' LIMIT 1), 95, true
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE path = '/admin/card-templates');