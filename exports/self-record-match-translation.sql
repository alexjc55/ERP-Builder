-- Translation for the new «Эта запись» match option in automations (update_records_where).
INSERT INTO translations (translation_key, translations_json)
VALUES ('auto.selfRecord', '{"ru": "Эта запись (вызвавшая)", "en": "This record (triggering)", "he": "רשומה זו (המפעילה)"}')
ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json;
