-- Register personal tasks in the configurable system-page menu.
-- Safe to run again: never overwrite names, icons or ordering.
BEGIN;
LOCK TABLE pages IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO pages (name_json, icon, path, sort_order, is_active, is_system)
SELECT '{"ru":"Мои задачи","en":"My tasks","he":"המשימות שלי"}'::jsonb,
       'list-checks', '/my-tasks', 0, true, true
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE path = '/my-tasks');
UPDATE pages SET is_system = true WHERE path = '/my-tasks' AND NOT is_system;
COMMIT;
