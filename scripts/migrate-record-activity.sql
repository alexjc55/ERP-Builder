-- Run on the external ERP database BEFORE deploying the matching API.
-- Additive and idempotent. Does not alter existing business records or permissions.
BEGIN;
CREATE TABLE IF NOT EXISTS activity_settings (
  entity_id integer PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS activity_tasks (
  id serial PRIMARY KEY,
  entity_id integer NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  record_id integer NOT NULL REFERENCES entity_records(id) ON DELETE CASCADE,
  page_id integer,
  title text NOT NULL, description text NOT NULL DEFAULT '', kind text NOT NULL,
  due_at timestamptz NOT NULL, assignee_id integer NOT NULL REFERENCES users(id),
  creator_id integer REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open', result text NOT NULL DEFAULT '',
  reminder_minutes integer, reminder_at timestamptz, reminder_sent_at timestamptz,
  automation_id integer REFERENCES entity_automations(id) ON DELETE SET NULL,
  action_key text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_tasks_record_idx ON activity_tasks(record_id,status,due_at);
CREATE INDEX IF NOT EXISTS activity_tasks_assignee_idx ON activity_tasks(assignee_id,status,due_at);
CREATE INDEX IF NOT EXISTS activity_tasks_reminder_idx ON activity_tasks(reminder_at) WHERE status='open' AND reminder_sent_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activity_tasks_rule_open_unique ON activity_tasks(automation_id,record_id,assignee_id,action_key) WHERE status='open' AND automation_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS record_activity (
  id serial PRIMARY KEY, entity_id integer NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  record_id integer NOT NULL REFERENCES entity_records(id) ON DELETE CASCADE,
  task_id integer REFERENCES activity_tasks(id) ON DELETE SET NULL,
  actor_id integer REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL, body text NOT NULL, outcome text NOT NULL DEFAULT 'none',
  occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  deleted boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS record_activity_feed_idx ON record_activity(record_id,id);
CREATE INDEX IF NOT EXISTS record_activity_contact_idx ON record_activity(record_id,kind,occurred_at) WHERE NOT deleted;
CREATE TABLE IF NOT EXISTS activity_notifications (
  id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id integer NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  record_id integer NOT NULL REFERENCES entity_records(id) ON DELETE CASCADE,
  page_id integer, message text NOT NULL, dedupe_key text NOT NULL,
  read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS activity_notifications_dedupe_idx ON activity_notifications(user_id,dedupe_key);
CREATE INDEX IF NOT EXISTS activity_notifications_user_idx ON activity_notifications(user_id,id);
CREATE TABLE IF NOT EXISTS activity_rule_schedules (
  automation_id integer PRIMARY KEY REFERENCES entity_automations(id) ON DELETE CASCADE,
  config_hash text NOT NULL, next_check_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_rule_states (
  id serial PRIMARY KEY, automation_id integer NOT NULL REFERENCES entity_automations(id) ON DELETE CASCADE,
  record_id integer NOT NULL REFERENCES entity_records(id) ON DELETE CASCADE,
  subject_key text NOT NULL, anchor text NOT NULL, run_count integer NOT NULL DEFAULT 0,
  last_fired_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS activity_rule_states_unique ON activity_rule_states(automation_id,record_id,subject_key);
COMMIT;
