-- Run before restarting the updated API. Existing entities remain ungrouped.
BEGIN;
CREATE TABLE IF NOT EXISTS entity_folders (
  id serial PRIMARY KEY,
  name_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE entities ADD COLUMN IF NOT EXISTS folder_id integer;
DO $$ BEGIN
  ALTER TABLE entities ADD CONSTRAINT entities_folder_id_entity_folders_id_fk
    FOREIGN KEY (folder_id) REFERENCES entity_folders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMIT;
