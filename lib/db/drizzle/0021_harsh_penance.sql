CREATE TYPE "public"."text_direction" AS ENUM('ltr', 'rtl');--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "text_direction" text_direction;--> statement-breakpoint
ALTER TABLE "page_fields" ADD COLUMN "text_direction" text_direction;--> statement-breakpoint
ALTER TABLE "entity_fields" ADD COLUMN "text_direction" text_direction;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "text_direction" text_direction;