-- Translation for the "(Пусто)" option in filter value dropdowns.
INSERT INTO translations (translation_key, translations_json)
VALUES ('records.filterEmptyValue', '{"ru": "(Пусто)", "en": "(Empty)", "he": "(ריק)"}')
ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json;
