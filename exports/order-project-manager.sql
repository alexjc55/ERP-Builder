-- Управляющий проектами на уровне заказа.
-- 1) Новое user-поле «Управляющий проектами» в сущности Заказы (74), первым по порядку.
-- 2) Перенос значения из изделий (первое изделие заказа; расхождений по данным нет — проверено).
-- 3) Lookup-поле в Изделиях (72), подтягивающее управляющего из связанного заказа (relation 25).
-- 4) Показ колонки на зеркальных страницах: Логистика (65), Производство (66), Эпоколь (77), Бухгалтерия→Производство (84).
-- Повторный запуск безопасен (все шаги идемпотентны). Старое поле изделий (id 150) НЕ трогается.
BEGIN;

-- 1. Поле в Заказах
INSERT INTO entity_fields (entity_id, field_key, name_json, field_type, sort_order, user_config_json)
SELECT 74, 'project_manager',
       '{"ru": "Управляющий проектами", "en": "Project Manager", "he": "מנהל פרויקטים"}'::jsonb,
       'user', 0,
       '{"allowCreate": false, "allowedRoleIds": [2]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM entity_fields WHERE entity_id = 74 AND field_key = 'project_manager');

-- 2. Перенос значений: для каждого заказа берём управляющего из его изделия
-- (первого по id, у которого поле заполнено). Заполняем только пустые.
WITH src AS (
  SELECT DISTINCT ON (rl.target_record_id)
         rl.target_record_id AS order_id,
         er.values_json ->> 'project_manager' AS manager
  FROM record_links rl
  JOIN entity_records er ON er.id = rl.source_record_id
  WHERE rl.relation_id = 25
    AND er.values_json ->> 'project_manager' IS NOT NULL
  ORDER BY rl.target_record_id, er.id
)
UPDATE entity_records o
SET values_json = o.values_json || jsonb_build_object('project_manager', src.manager),
    updated_at = now()
FROM src
WHERE o.id = src.order_id
  AND o.entity_id = 74
  AND (o.values_json ->> 'project_manager') IS NULL;

-- 3. Lookup-поле в Изделиях (через связь «Номер заказа», relation 25)
INSERT INTO entity_fields (entity_id, field_key, name_json, field_type, sort_order, relation_config_json)
SELECT 72, 'order_project_manager',
       '{"ru": "Управляющий проектами", "en": "Project Manager", "he": "מנהל פרויקטים"}'::jsonb,
       'lookup', 1,
       '{"relationId": 25, "relatedFieldKey": "project_manager"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM entity_fields WHERE entity_id = 72 AND field_key = 'order_project_manager');

-- 3б. Перенос условного форматирования со старого поля изделий на новое lookup-поле
UPDATE entity_fields
SET format_rules_json = (
      SELECT format_rules_json FROM entity_fields
      WHERE entity_id = 72 AND field_key = 'project_manager'
    ),
    updated_at = now()
WHERE entity_id = 72 AND field_key = 'order_project_manager';

-- 4. Колонка на зеркальных страницах Изделий
UPDATE pages
SET mirror_field_keys_json = mirror_field_keys_json || '["order_project_manager"]'::jsonb,
    updated_at = now()
WHERE id IN (65, 66, 77, 84)
  AND mirror_entity_id = 72
  AND mirror_field_keys_json IS NOT NULL
  AND NOT (mirror_field_keys_json @> '["order_project_manager"]'::jsonb);

COMMIT;
