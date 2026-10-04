ALTER TABLE "roles" ALTER COLUMN "permissions_json" SET DEFAULT '{"superAdmin":false,"admin":{"pages":false,"entities":false,"roles":false,"users":false,"translations":false,"events":false,"modules":false,"automations":false,"customFilters":false,"columnGroups":false,"googleDrive":false,"settings":false,"dataImport":false,"inboundIntegrations":false,"documentGeneration":false,"tags":false,"cardTemplates":false},"pageIds":[],"records":{}}'::jsonb;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "menu_default_expanded" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "status_scope_json" jsonb;--> statement-breakpoint
WITH RECURSIVE system_pages AS (
  SELECT id, parent_page_id FROM pages WHERE path = '/admin' OR path LIKE '/admin/%'
  UNION
  SELECT p.id, p.parent_page_id FROM pages p JOIN system_pages s ON p.id = s.parent_page_id
)
UPDATE pages SET is_system = true, is_active = true
WHERE id IN (SELECT id FROM system_pages);