-- Фильтры и области видимости по полям страницы: переводы UI.
-- Выполнять на удалённом сервере после git pull + пересборки. Повторный запуск безопасен.
BEGIN;

INSERT INTO translations (translation_key, translations_json) VALUES
('records.pageLocalFieldTag', '{"ru":"поле страницы","en":"page field","he":"שדה עמוד"}'),
('roles.scopeFilterPageField', '{"ru":"поле страницы","en":"page field","he":"שדה עמוד"}')
ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json;

COMMIT;
