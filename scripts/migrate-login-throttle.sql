-- Apply BEFORE deploying the login-throttling API update.
-- Does not change accounts, passwords, roles or sessions.
BEGIN;
CREATE TABLE IF NOT EXISTS login_throttle (
  bucket text PRIMARY KEY,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
COMMIT;
