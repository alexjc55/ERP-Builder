-- Register the global Tags admin screen in the database-backed Pages menu.
-- Keep this idempotent for external installs and reuse an existing
-- Administration parent instead of creating a second one.
WITH existing_admin AS (
  SELECT p.id
  FROM "pages" AS p
  WHERE p.path IS NULL
    AND (
      p.name_json->>'en' = 'Administration'
      OR p.name_json->>'ru' = 'Администрирование'
      OR EXISTS (
        SELECT 1
        FROM "pages" AS child
        WHERE child.parent_page_id = p.id
          AND child.path IN (
            '/admin/pages',
            '/admin/entities',
            '/admin/users',
            '/admin/roles',
            '/admin/translations',
            '/admin/events',
            '/admin/modules',
            '/admin/column-groups',
            '/admin/import',
            '/admin/file-trash',
            '/admin/tags'
          )
      )
    )
  ORDER BY p.id
  LIMIT 1
),
inserted_admin AS (
  INSERT INTO "pages" (
    "name_json",
    "icon",
    "path",
    "sort_order",
    "is_active"
  )
  SELECT
    '{"ru":"Администрирование","en":"Administration","he":"ניהול"}'::jsonb,
    'settings',
    NULL,
    100,
    true
  WHERE NOT EXISTS (SELECT 1 FROM existing_admin)
  RETURNING id
),
admin AS (
  SELECT id FROM inserted_admin
  UNION ALL
  SELECT id FROM existing_admin
  LIMIT 1
)
UPDATE "pages" AS tags_page
SET "parent_page_id" = admin.id
FROM admin
WHERE tags_page.path = '/admin/tags';
--> statement-breakpoint
WITH existing_admin AS (
  SELECT p.id
  FROM "pages" AS p
  WHERE p.path IS NULL
    AND (
      p.name_json->>'en' = 'Administration'
      OR p.name_json->>'ru' = 'Администрирование'
      OR EXISTS (
        SELECT 1
        FROM "pages" AS child
        WHERE child.parent_page_id = p.id
          AND child.path IN (
            '/admin/pages',
            '/admin/entities',
            '/admin/users',
            '/admin/roles',
            '/admin/translations',
            '/admin/events',
            '/admin/modules',
            '/admin/column-groups',
            '/admin/import',
            '/admin/file-trash',
            '/admin/tags'
          )
      )
    )
  ORDER BY p.id
  LIMIT 1
),
inserted_admin AS (
  INSERT INTO "pages" (
    "name_json",
    "icon",
    "path",
    "sort_order",
    "is_active"
  )
  SELECT
    '{"ru":"Администрирование","en":"Administration","he":"ניהול"}'::jsonb,
    'settings',
    NULL,
    100,
    true
  WHERE NOT EXISTS (SELECT 1 FROM existing_admin)
  RETURNING id
),
admin AS (
  SELECT id FROM inserted_admin
  UNION ALL
  SELECT id FROM existing_admin
  LIMIT 1
)
INSERT INTO "pages" (
  "name_json",
  "icon",
  "path",
  "parent_page_id",
  "sort_order",
  "is_active"
)
SELECT
  '{"ru":"Глобальные теги","en":"Global Tags","he":"תגיות גלובליות"}'::jsonb,
  'tags',
  '/admin/tags',
  admin.id,
  COALESCE((
    SELECT MAX(child.sort_order) + 1
    FROM "pages" AS child
    WHERE child.parent_page_id = admin.id
  ), 101),
  true
FROM admin
WHERE NOT EXISTS (
  SELECT 1 FROM "pages" WHERE path = '/admin/tags'
);
