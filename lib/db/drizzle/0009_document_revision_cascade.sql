DROP TRIGGER IF EXISTS "document_revision_immutable" ON "document_template_revisions";--> statement-breakpoint
CREATE TRIGGER "document_revision_immutable"
BEFORE UPDATE ON "document_template_revisions"
FOR EACH ROW EXECUTE FUNCTION prevent_document_revision_mutation();