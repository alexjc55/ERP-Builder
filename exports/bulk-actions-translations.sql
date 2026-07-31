-- Массовые действия над записями: переводы UI.
-- Выполнять на удалённом сервере после git pull + пересборки. Повторный запуск безопасен.
BEGIN;

INSERT INTO translations (translation_key, translations_json) VALUES
('records.bulkToggle', '{"ru":"Выбрать","en":"Select","he":"בחירה"}'),
('records.bulkActions', '{"ru":"Действия","en":"Actions","he":"פעולות"}'),
('records.bulkSelectAll', '{"ru":"Выбрать все","en":"Select all","he":"בחר הכל"}'),
('records.bulkArchiveTitle', '{"ru":"Отправить выбранные записи в архив?","en":"Archive the selected records?","he":"להעביר את הרשומות שנבחרו לארכיון?"}'),
('records.bulkArchiveConfirm', '{"ru":"Записи ({n} шт.) будут отправлены в архив.","en":"{n} records will be archived.","he":"{n} רשומות יועברו לארכיון."}'),
('records.bulkUnarchiveTitle', '{"ru":"Восстановить выбранные записи из архива?","en":"Restore the selected records from the archive?","he":"לשחזר את הרשומות שנבחרו מהארכיון?"}'),
('records.bulkUnarchiveConfirm', '{"ru":"Записи ({n} шт.) будут восстановлены из архива.","en":"{n} records will be restored from the archive.","he":"{n} רשומות ישוחזרו מהארכיון."}'),
('records.bulkDeleteTitle', '{"ru":"Удалить выбранные записи?","en":"Delete the selected records?","he":"למחוק את הרשומות שנבחרו?"}'),
('records.bulkDeleteConfirm', '{"ru":"Записи ({n} шт.) будут удалены безвозвратно.","en":"{n} records will be permanently deleted.","he":"{n} רשומות יימחקו לצמיתות."}'),
('records.bulkDone', '{"ru":"Обработано записей","en":"Records processed","he":"רשומות טופלו"}'),
('records.bulkFailed', '{"ru":"Не удалось (нет прав или запись не найдена)","en":"Failed (no permission or record not found)","he":"נכשל (אין הרשאה או שהרשומה לא נמצאה)"}'),
('records.bulkError', '{"ru":"Ошибка массового действия","en":"Bulk action failed","he":"פעולה קבוצתית נכשלה"}')
ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json;

COMMIT;
