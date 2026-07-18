-- Панель фильтров над таблицей записей: настройка «свёрнута/развёрнута по умолчанию»
-- (задаётся в режиме настройки страницы, как у блока «Аналитика»).
-- Запускать на УДАЛЁННОЙ базе (erp.davidov-k.co.il). Повторный запуск безопасен.

-- 1) Новая колонка страницы: по умолчанию панель фильтров свёрнута?
ALTER TABLE pages ADD COLUMN IF NOT EXISTS filters_collapsed_default boolean NOT NULL DEFAULT false;

-- 2) Переводы для новых надписей.
INSERT INTO translations (translation_key, translations_json)
VALUES
  ('records.filtersShow', '{"ru": "Показать фильтры", "en": "Show filters", "he": "הצג מסננים"}'::jsonb),
  ('records.filtersHide', '{"ru": "Свернуть фильтры", "en": "Collapse filters", "he": "כווץ מסננים"}'::jsonb),
  ('records.filtersDefaultStateTitle', '{"ru": "Панель фильтров по умолчанию", "en": "Default filter bar state", "he": "מצב ברירת מחדל של סרגל המסננים"}'::jsonb),
  ('records.filtersDefaultStateHint', '{"ru": "Как панель фильтров будет показана при открытии этой страницы. Пользователь сможет свернуть или развернуть её вручную.", "en": "How the filter bar appears when this page opens. Users can collapse or expand it manually.", "he": "כיצד סרגל המסננים יוצג בפתיחת עמוד זה. המשתמש יכול לכווץ או להרחיב ידנית."}'::jsonb),
  ('records.filtersDefaultExpanded', '{"ru": "Развёрнута (показывать фильтры)", "en": "Expanded (show filters)", "he": "מורחב (הצג מסננים)"}'::jsonb),
  ('records.filtersDefaultCollapsed', '{"ru": "Свёрнута (скрывать фильтры)", "en": "Collapsed (hide filters)", "he": "מכווץ (הסתר מסננים)"}'::jsonb),
  ('records.filtersDefaultCollapsedSaved', '{"ru": "По умолчанию: фильтры свёрнуты", "en": "Default: filters collapsed", "he": "ברירת מחדל: המסננים מכווצים"}'::jsonb),
  ('records.filtersDefaultExpandedSaved', '{"ru": "По умолчанию: фильтры развёрнуты", "en": "Default: filters expanded", "he": "ברירת מחדל: המסננים מורחבים"}'::jsonb)
ON CONFLICT (translation_key)
DO UPDATE SET translations_json = EXCLUDED.translations_json,
              updated_at = now();
