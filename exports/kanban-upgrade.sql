-- Kanban additions for an existing ERP database (PostgreSQL).
-- Back up production first. Run using psql -v ON_ERROR_STOP=1 -f this-file.sql.
-- Does not copy development records, page settings, or view configurations.
-- Existing translations are preserved. Earlier ERP migrations are prerequisites.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public;

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(r.t || '.' || r.c, ', ') INTO missing
  FROM (VALUES
    ('views','config_json'), ('views','target_page_id'),
    ('entity_records','version'), ('page_record_values','version'),
    ('entity_statuses','show_tags'), ('entity_statuses','primary_tag_id'),
    ('pages','text_direction'), ('entity_fields','text_direction'),
    ('page_fields','text_direction'), ('app_settings','text_direction'),
    ('translations','translation_key'), ('translations','translations_json')
  ) AS r(t,c)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = r.t AND c.column_name = r.c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Earlier ERP migrations are missing: %', missing;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.entity_records'::regclass AND tgname = 'entity_records_version_bump' AND tgenabled IN ('O','A') AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.page_record_values'::regclass AND tgname = 'page_record_values_version_bump' AND tgenabled IN ('O','A') AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Collaboration version triggers are missing or disabled; apply the earlier collaboration migration first.';
  END IF;
END $$;

ALTER TABLE public.entity_statuses
  ADD COLUMN IF NOT EXISTS hide_by_default boolean NOT NULL DEFAULT false;
ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS status_scope_json jsonb;

INSERT INTO public.translations (translation_key, translations_json)
VALUES
  ('pages.statusScope', '{"ru":"Статусы страницы","en":"Page statuses","he":"סטטוסים בעמוד"}'::jsonb),
  ('pages.statusScopeAll', '{"ru":"Все статусы","en":"All statuses","he":"כל הסטטוסים"}'::jsonb),
  ('pages.statusScopeSelected', '{"ru":"Только выбранные","en":"Selected statuses only","he":"סטטוסים נבחרים בלבד"}'::jsonb),
  ('pages.statusScopeAllChanges', '{"ru":"Показывать все доступные статусы в меню смены статуса","en":"Show all available statuses in the status-change menu","he":"הצגת כל הסטטוסים הזמינים בתפריט שינוי הסטטוס"}'::jsonb),
  ('pages.statusScopeHint', '{"ru":"Таблица, канбан и фильтр показывают только выбранные статусы. «Показать скрытые» не расширяет этот набор.","en":"The table, board and filter show only selected statuses. “Show hidden” does not expand this selection.","he":"הטבלה, לוח הקנבן והמסנן מציגים רק סטטוסים שנבחרו. ״הצג מוסתרים״ אינו מרחיב בחירה זו."}'::jsonb),
  ('kanban.modeKanban', '{"ru":"Канбан","en":"Kanban","he":"קנבן"}'::jsonb),
  ('kanban.configTitle', '{"ru":"Конфигурация канбана","en":"Kanban configuration","he":"הגדרות קנבן"}'::jsonb),
  ('kanban.configHint', '{"ru":"Колонки сгруппированы по статусу записи. Настройте содержимое карточек ниже.","en":"Columns are grouped by record status. Configure card contents below.","he":"העמודות מקובצות לפי סטטוס הרשומה. הגדירו את תוכן הכרטיסים למטה."}'::jsonb),
  ('kanban.titleField', '{"ru":"Поле заголовка","en":"Title field","he":"שדה הכותרת"}'::jsonb),
  ('kanban.titleAuto', '{"ru":"Автоматически (первое текстовое поле)","en":"Automatic (first text field)","he":"אוטומטי (שדה הטקסט הראשון)"}'::jsonb),
  ('kanban.statusLabel', '{"ru":"Статус","en":"Status","he":"סטטוס"}'::jsonb),
  ('kanban.pageFieldSuffix', '{"ru":"поле страницы","en":"page field","he":"שדה עמוד"}'::jsonb),
  ('kanban.cardFields', '{"ru":"Поля карточки","en":"Card fields","he":"שדות הכרטיס"}'::jsonb),
  ('kanban.addField', '{"ru":"Добавить поле","en":"Add field","he":"הוספת שדה"}'::jsonb),
  ('kanban.cardFieldsHint', '{"ru":"Поля отображаются под заголовком в указанном порядке. Используйте стрелки для изменения порядка.","en":"Fields appear below the title in the specified order. Use the arrows to reorder them.","he":"השדות מוצגים מתחת לכותרת לפי הסדר שנקבע. השתמשו בחצים לשינוי הסדר."}'::jsonb),
  ('kanban.cardFieldsNone', '{"ru":"Только заголовок","en":"Title only","he":"כותרת בלבד"}'::jsonb),
  ('kanban.moveFieldUp', '{"ru":"Переместить поле выше","en":"Move field up","he":"העברת שדה למעלה"}'::jsonb),
  ('kanban.moveFieldDown', '{"ru":"Переместить поле ниже","en":"Move field down","he":"העברת שדה למטה"}'::jsonb),
  ('kanban.removeField', '{"ru":"Удалить поле","en":"Remove field","he":"הסרת שדה"}'::jsonb),
  ('kanban.showLabels', '{"ru":"Показывать названия полей","en":"Show field labels","he":"הצגת שמות השדות"}'::jsonb),
  ('kanban.hideEmptyFields', '{"ru":"Скрывать пустые поля","en":"Hide empty fields","he":"הסתרת שדות ריקים"}'::jsonb),
  ('kanban.tintColumns', '{"ru":"Подкрашивать колонки по цвету статуса","en":"Tint columns with status colors","he":"צביעת עמודות לפי צבע הסטטוס"}'::jsonb),
  ('kanban.statusTitleHover', '{"ru":"Цвет заголовка при наведении — по статусу","en":"Use status color on title hover","he":"צבע הכותרת בריחוף לפי הסטטוס"}'::jsonb),
  ('statuses.hideByDefault', '{"ru":"Скрывать по умолчанию","en":"Hide by default","he":"הסתרה כברירת מחדל"}'::jsonb),
  ('statuses.hideByDefaultHint', '{"ru":"Скрывает колонку этого статуса в канбане и записи с этим статусом в таблице по умолчанию. Пользователь может включить их отображение. Это не архивирование и не ограничение доступа.","en":"Hides this status column in Kanban and records with this status in the table by default. Users can choose to show them. This does not archive records or restrict access.","he":"מסתיר כברירת מחדל את עמודת הסטטוס בקנבן ואת הרשומות בסטטוס זה בטבלה. המשתמשים יכולים לבחור להציג אותן. פעולה זו אינה מעבירה רשומות לארכיון ואינה מגבילה גישה."}'::jsonb),
  ('kanban.actions', '{"ru":"Действия","en":"Actions","he":"פעולות"}'::jsonb),
  ('kanban.archivedBadge', '{"ru":"В архиве","en":"Archived","he":"בארכיון"}'::jsonb),
  ('kanban.archived', '{"ru":"Запись архивирована","en":"Record archived","he":"הרשומה הועברה לארכיון"}'::jsonb),
  ('kanban.archiveFailed', '{"ru":"Не удалось архивировать","en":"Failed to archive","he":"ההעברה לארכיון נכשלה"}'::jsonb),
  ('kanban.archive', '{"ru":"В архив","en":"Archive","he":"לארכיון"}'::jsonb),
  ('kanban.conflict', '{"ru":"Запись изменена другим пользователем","en":"Record was changed by another user","he":"הרשומה שונתה על ידי משתמש אחר"}'::jsonb),
  ('kanban.detailError', '{"ru":"Не удалось загрузить запись","en":"Failed to load record","he":"טעינת הרשומה נכשלה"}'::jsonb),
  ('kanban.edit', '{"ru":"Редактировать","en":"Edit","he":"עריכה"}'::jsonb),
  ('kanban.emptyLane', '{"ru":"Пусто","en":"Empty","he":"ריק"}'::jsonb),
  ('kanban.error', '{"ru":"Не удалось загрузить колонку","en":"Failed to load column","he":"טעינת העמודה נכשלה"}'::jsonb),
  ('kanban.hydrateError', '{"ru":"Не удалось загрузить связанные значения","en":"Failed to load related values","he":"טעינת הערכים המקושרים נכשלה"}'::jsonb),
  ('kanban.movedHidden', '{"ru":"Перемещено в скрытую колонку","en":"Moved to a hidden column","he":"הועבר לעמודה מוסתרת"}'::jsonb),
  ('kanban.moveFailed', '{"ru":"Не удалось изменить статус","en":"Failed to change status","he":"שינוי הסטטוס נכשל"}'::jsonb),
  ('kanban.moveTo', '{"ru":"Переместить в","en":"Move to","he":"העבר אל"}'::jsonb),
  ('kanban.nextPage', '{"ru":"Следующие","en":"Next","he":"הבאים"}'::jsonb),
  ('kanban.noLanes', '{"ru":"Нет колонок для выбранных фильтров","en":"No columns for the selected filters","he":"אין עמודות עבור הסינון שנבחר"}'::jsonb),
  ('kanban.noStatus', '{"ru":"Без статуса","en":"No status","he":"ללא סטטוס"}'::jsonb),
  ('kanban.notConfigured', '{"ru":"Канбан не настроен","en":"Kanban is not configured","he":"הקנבן לא הוגדר"}'::jsonb),
  ('kanban.of', '{"ru":"из","en":"of","he":"מתוך"}'::jsonb),
  ('kanban.prevPage', '{"ru":"Предыдущие","en":"Previous","he":"הקודמים"}'::jsonb),
  ('kanban.record', '{"ru":"Запись","en":"Record","he":"רשומה"}'::jsonb),
  ('kanban.refresh', '{"ru":"Обновить","en":"Refresh","he":"רענון"}'::jsonb),
  ('kanban.retry', '{"ru":"Повторить","en":"Retry","he":"נסה שוב"}'::jsonb),
  ('kanban.view', '{"ru":"Просмотр","en":"View","he":"צפייה"}'::jsonb),
  ('kanban.showBoard', '{"ru":"Показать доску целиком","en":"Show full board","he":"הצג את כל הלוח"}'::jsonb)
ON CONFLICT (translation_key) DO NOTHING;

COMMIT;
