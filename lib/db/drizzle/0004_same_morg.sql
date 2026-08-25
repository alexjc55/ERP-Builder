DROP INDEX "view_one_default";--> statement-breakpoint
ALTER TABLE "views" ADD COLUMN "target_page_id" integer;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_target_page_id_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "view_one_default_entity" ON "views" USING btree ("entity_id") WHERE "views"."is_default" = true AND "views"."target_page_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "view_one_default_page" ON "views" USING btree ("entity_id","target_page_id") WHERE "views"."is_default" = true AND "views"."target_page_id" IS NOT NULL;