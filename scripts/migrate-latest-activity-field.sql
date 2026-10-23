-- Field types are text metadata: no column or enum change is necessary.
-- Index for the latest activity lookup (run after migrate-record-activity.sql).
CREATE INDEX IF NOT EXISTS record_activity_latest_idx
  ON record_activity (record_id, occurred_at, id) WHERE NOT deleted;
