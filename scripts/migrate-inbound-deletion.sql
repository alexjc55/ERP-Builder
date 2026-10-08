-- Apply before deploying the API update. Does not delete history or accounts.
BEGIN;
ALTER TABLE inbound_integrations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
COMMIT;
