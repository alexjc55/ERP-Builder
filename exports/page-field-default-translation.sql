-- Translation for the "— без значения —" option in the page-field default-value editor.
INSERT INTO translations (translation_key, translations_json)
VALUES ('fields.noDefault', '{"ru": "— без значения —", "en": "— no value —", "he": "— ללא ערך —"}')
ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json;
