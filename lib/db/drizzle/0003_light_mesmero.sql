ALTER TABLE "page_record_values" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_records" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION bump_collaboration_version() RETURNS trigger AS $$
BEGIN
  -- Explicit version assignments are left intact, preventing a route that
  -- already increments from being incremented twice. Ordinary updates get one.
  IF NEW.version = OLD.version THEN NEW.version := OLD.version + 1; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS entity_records_version_bump ON "entity_records";--> statement-breakpoint
CREATE TRIGGER entity_records_version_bump BEFORE UPDATE ON "entity_records"
FOR EACH ROW EXECUTE FUNCTION bump_collaboration_version();--> statement-breakpoint
DROP TRIGGER IF EXISTS page_record_values_version_bump ON "page_record_values";--> statement-breakpoint
CREATE TRIGGER page_record_values_version_bump BEFORE UPDATE ON "page_record_values"
FOR EACH ROW EXECUTE FUNCTION bump_collaboration_version();