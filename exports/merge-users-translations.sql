-- Объединение дубликатов пользователей: переводы UI.
-- Выполнять на удалённом сервере после git pull + пересборки. Повторный запуск безопасен.
BEGIN;

INSERT INTO translations (translation_key, translations_json) VALUES
('users.mergeAction', '{"ru":"Объединить","en":"Merge","he":"מזג"}'),
('users.mergeTitle', '{"ru":"Объединить пользователей","en":"Merge users","he":"מיזוג משתמשים"}'),
('users.mergeDesc', '{"ru":"Выберите главную учётную запись. Все упоминания остальных (в полях записей, истории изменений) перейдут к ней, её роли дополнятся ролями дубликатов, после чего дубликаты будут удалены безвозвратно.","en":"Choose the surviving account. All references to the others (record fields, change history) will move to it, its roles will be extended with the duplicates'' roles, and the duplicates will then be permanently deleted.","he":"בחרו את החשבון הראשי. כל האזכורים של השאר (בשדות רשומות, בהיסטוריית שינויים) יעברו אליו, התפקידים שלו יורחבו בתפקידי הכפילויות, ולאחר מכן הכפילויות יימחקו לצמיתות."}'),
('users.mergeConfirm', '{"ru":"Объединить","en":"Merge","he":"מזג"}'),
('users.mergeDone', '{"ru":"Пользователи объединены","en":"Users merged","he":"המשתמשים מוזגו"}'),
('users.mergeUpdatedRefs', '{"ru":"Обновлено упоминаний в записях","en":"References updated in records","he":"אזכורים עודכנו ברשומות"}'),
('users.mergeError', '{"ru":"Ошибка объединения","en":"Merge error","he":"שגיאת מיזוג"}'),
('users.mergePickHint', '{"ru":"Отметьте дубликаты для объединения","en":"Select duplicates to merge","he":"סמנו כפילויות למיזוג"}')
ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json;

COMMIT;
