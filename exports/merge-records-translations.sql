-- Объединение дубликатов записей: переводы UI.
-- Выполнять на удалённом сервере после git pull + пересборки. Повторный запуск безопасен.
BEGIN;

INSERT INTO translations (translation_key, translations_json) VALUES
('records.mergeAction', '{"ru":"Объединить записи","en":"Merge records","he":"מיזוג רשומות"}'),
('records.mergeTitle', '{"ru":"Объединить записи","en":"Merge records","he":"מיזוג רשומות"}'),
('records.mergeDesc', '{"ru":"Выберите главную запись. Все связи остальных записей перейдут к ней, её пустые поля дозаполнятся из дубликатов, после чего дубликаты будут удалены безвозвратно.","en":"Choose the surviving record. All links of the other records will move to it, its empty fields will be filled from the duplicates, and the duplicates will then be permanently deleted.","he":"בחרו את הרשומה הראשית. כל הקישורים של שאר הרשומות יעברו אליה, שדות ריקים יושלמו מהכפילויות, ולאחר מכן הכפילויות יימחקו לצמיתות."}'),
('records.mergeConfirm', '{"ru":"Объединить","en":"Merge","he":"מזג"}'),
('records.mergeDone', '{"ru":"Записи объединены","en":"Records merged","he":"הרשומות מוזגו"}'),
('records.mergeMovedLinks', '{"ru":"Перенесено связей","en":"Links moved","he":"קישורים הועברו"}'),
('records.mergeFilledFields', '{"ru":"заполнено полей","en":"fields filled","he":"שדות הושלמו"}'),
('records.mergeError', '{"ru":"Ошибка объединения","en":"Merge error","he":"שגיאת מיזוג"}')
ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json;

COMMIT;
