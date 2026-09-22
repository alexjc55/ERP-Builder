ALTER TABLE "column_groups" ADD COLUMN "body_background_color" text;--> statement-breakpoint
ALTER TABLE "column_groups" ADD COLUMN "body_text_color" text;--> statement-breakpoint
INSERT INTO "translations" ("translation_key", "translations_json")
VALUES
  ('colGroups.headerSection', '{"ru":"Заголовок","en":"Header","he":"כותרת"}'::jsonb),
  ('colGroups.bodySection', '{"ru":"Строки таблицы","en":"Table rows","he":"שורות הטבלה"}'::jsonb),
  ('colGroups.bodySectionDesc', '{"ru":"Необязательные цвета ячеек группы. Очистите цвет, чтобы использовать оформление таблицы.","en":"Optional group cell colors. Clear a color to use the table styling.","he":"צבעים אופציונליים לתאי הקבוצה. ניקוי הצבע יחזיר את עיצוב הטבלה."}'::jsonb),
  ('colGroups.bodyBackgroundColor', '{"ru":"Фон ячеек","en":"Cell background","he":"רקע התאים"}'::jsonb),
  ('colGroups.bodyTextColor', '{"ru":"Текст ячеек","en":"Cell text","he":"טקסט התאים"}'::jsonb),
  ('colGroups.bodyPreview', '{"ru":"Строка таблицы","en":"Table row","he":"שורת טבלה"}'::jsonb)
ON CONFLICT ("translation_key") DO NOTHING;