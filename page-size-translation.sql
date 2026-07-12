-- Перевод для нового выпадающего списка «строк на странице» в таблице записей.
-- Запускать на УДАЛЁННОЙ базе (erp.davidov-k.co.il). Повторный запуск безопасен.

INSERT INTO translations (translation_key, translations_json)
VALUES (
  'records.perPage',
  '{"ru": "на стр.", "en": "per page", "he": "בעמוד"}'::jsonb
)
ON CONFLICT (translation_key)
DO UPDATE SET translations_json = EXCLUDED.translations_json,
              updated_at = now();
