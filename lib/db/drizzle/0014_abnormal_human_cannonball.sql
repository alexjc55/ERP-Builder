ALTER TABLE "page_fields" ADD COLUMN "allow_formula_export" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "page_fields"
SET "allow_formula_export" = true
WHERE cardinality("formula_export_role_ids") > 0;