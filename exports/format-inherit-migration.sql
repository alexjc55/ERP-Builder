-- Наследование условного форматирования (formatInheritJson):
--   1) новая колонка entity_fields.format_inherit_json
--   2) переводы для новой секции в редакторе поля
-- Выполнять на удалённом сервере ПОСЛЕ git pull + сборки (код уже её ждёт).
-- Повторный запуск безопасен.

BEGIN;

ALTER TABLE entity_fields
  ADD COLUMN IF NOT EXISTS format_inherit_json jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO translations (translation_key, translations_json) VALUES
('fields.formatInheritTitle', '{"ru":"Наследовать форматирование","en":"Inherit formatting","he":"ירושת עיצוב"}'),
('fields.formatInheritHint', '{"ru":"Если значение этого поля копируется автоматизацией из другого места, укажите источник — цвета (условное форматирование поля, поля страницы или цвета статусов) будут применяться к значению автоматически. Нет совпадения — без форматирования.","en":"If this field''s value is copied by an automation from elsewhere, pick the source — its colors (the field''s or page field''s conditional formatting or status colors) will follow the value automatically. No match — no formatting.","he":"אם ערך השדה מועתק על ידי אוטומציה ממקום אחר, בחרו מקור — הצבעים (עיצוב מותנה של שדה, שדה עמוד או צבעי סטטוסים) יוחלו על הערך אוטומטית. אין התאמה — ללא עיצוב."}'),
('fields.formatInheritAdd', '{"ru":"Добавить источник","en":"Add source","he":"הוספת מקור"}'),
('fields.inheritSelectEntity', '{"ru":"Сущность или страница","en":"Entity or page","he":"ישות או עמוד"}'),
('fields.inheritEntitiesGroup', '{"ru":"Сущности","en":"Entities","he":"ישויות"}'),
('fields.inheritPagesGroup', '{"ru":"Страницы","en":"Pages","he":"עמודים"}'),
('fields.inheritSelectSource', '{"ru":"Источник","en":"Source","he":"מקור"}'),
('fields.inheritStatusSource', '{"ru":"Статус записи (цвета статусов)","en":"Record status (status colors)","he":"סטטוס רשומה (צבעי סטטוסים)"}')
ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json;

COMMIT;
