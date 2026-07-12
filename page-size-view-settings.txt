-- Количество записей на странице (50/100/200) теперь настраивается в настройках
-- вида и в «Настройках по умолчанию» сущности.
-- Запускать на УДАЛЁННОЙ базе (erp.davidov-k.co.il). Повторный запуск безопасен.

-- 1) Новая колонка: размер страницы по умолчанию для сущности (NULL = 50).
ALTER TABLE entities ADD COLUMN IF NOT EXISTS default_page_size integer;

-- 2) Переводы для новых надписей в настройках вида.
INSERT INTO translations (translation_key, translations_json)
VALUES
  ('views.pageSize', '{"ru": "Записей на странице", "en": "Records per page", "he": "רשומות בעמוד"}'::jsonb),
  ('views.pageSizeInherit', '{"ru": "Как по умолчанию", "en": "Same as default", "he": "כברירת מחדל"}'::jsonb),
  ('views.pageSizeStandard', '{"ru": "Стандартно (50)", "en": "Standard (50)", "he": "רגיל (50)"}'::jsonb)
ON CONFLICT (translation_key)
DO UPDATE SET translations_json = EXCLUDED.translations_json,
              updated_at = now();

-- 3) Старый ключ от прежнего варианта (выпадающий список в подвале таблицы)
--    больше не используется — удаляем, если он был добавлен.
DELETE FROM translations WHERE translation_key = 'records.perPage';
