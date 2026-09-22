ALTER TABLE "google_drive_connection" ADD COLUMN "health_state" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "google_drive_connection" ADD COLUMN "health_reason" text;--> statement-breakpoint
ALTER TABLE "google_drive_connection" ADD COLUMN "health_last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "google_drive_connection" ADD COLUMN "health_last_success_at" timestamp with time zone;