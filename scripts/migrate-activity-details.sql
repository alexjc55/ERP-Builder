-- Run before deploying the updated API. Existing history remains unchanged.
ALTER TABLE record_activity ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
