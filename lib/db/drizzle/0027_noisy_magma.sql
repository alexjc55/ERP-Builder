CREATE TABLE "security_retention" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"ordinary_days" integer DEFAULT 30 NOT NULL,
	"important_days" integer DEFAULT 180 NOT NULL,
	"warning_size_mb" integer DEFAULT 256 NOT NULL,
	"cleanup_enabled" boolean DEFAULT true NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_cleanup_at" timestamp with time zone,
	"last_deleted_count" integer DEFAULT 0 NOT NULL,
	"last_cleanup_error" text
);
--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "security_events" SET "last_seen_at" = "created_at";--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "occurrence_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "security_events" ADD COLUMN "aggregation_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "security_events_aggregation_idx" ON "security_events" USING btree ("aggregation_key");--> statement-breakpoint
CREATE INDEX "security_events_retention_idx" ON "security_events" USING btree ("last_seen_at");