-- Область видимости «По значению поля» (filter row scope): переводы UI.
-- Выполнять на удалённом сервере после git pull + пересборки. Повторный запуск безопасен.
BEGIN;

INSERT INTO translations (translation_key, translations_json) VALUES
('roles.scopeFilter', '{"ru":"По значению поля","en":"By field value","he":"לפי ערך שדה"}'),
('roles.scopeFilterDesc', '{"ru":"Роль видит только записи, где выбранное поле имеет одно из указанных значений. Это жёсткое ограничение: его нельзя сбросить фильтрами, оно действует и на изменение записей.","en":"The role sees only records where the chosen field has one of the listed values. This is a hard boundary: it cannot be reset by filters and also applies to record edits.","he":"התפקיד רואה רק רשומות שבהן לשדה הנבחר יש אחד מהערכים שצוינו. זו הגבלה קשיחה: לא ניתן לאפס אותה במסננים והיא חלה גם על עריכת רשומות."}'),
('roles.scopeFilterField', '{"ru":"Выберите поле","en":"Choose a field","he":"בחרו שדה"}'),
('roles.scopeFilterValues', '{"ru":"Значения через запятую, напр.: цева бэпоколь","en":"Comma-separated values","he":"ערכים מופרדים בפסיקים"}'),
('roles.scopeFilterEmpty', '{"ru":"Поле или значения не выбраны — записи не будут видны вовсе.","en":"No field or values selected — no records will be visible at all.","he":"לא נבחרו שדה או ערכים — לא יוצגו רשומות כלל."}'),
('roles.scopeFilterNoFields', '{"ru":"Нет подходящих полей для ограничения по значению.","en":"No suitable fields for a value-based restriction.","he":"אין שדות מתאימים להגבלה לפי ערך."}')
ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json;

COMMIT;
