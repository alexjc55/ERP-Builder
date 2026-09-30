ALTER TABLE "entity_statuses" ADD COLUMN "show_tags" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_statuses" ADD COLUMN "primary_tag_id" integer;--> statement-breakpoint
INSERT INTO "translations" ("translation_key", "translations_json")
VALUES
  ('statuses.showTags', '{"ru":"Показывать теги","en":"Show tags","he":"הצגת תגיות"}'::jsonb),
  ('statuses.primaryTag', '{"ru":"Основной тег","en":"Primary tag","he":"תגית ראשית"}'::jsonb),
  ('statuses.allTagsDisplay', '{"ru":"Все теги","en":"All tags","he":"כל התגיות"}'::jsonb),
  ('statuses.tagDisplayHint', '{"ru":"Настройка влияет только на отображение. Назначенные теги сохраняются.","en":"This only changes the display. Assigned tags remain unchanged.","he":"ההגדרה משפיעה רק על התצוגה. התגיות המשויכות נשארות ללא שינוי."}'::jsonb)
ON CONFLICT ("translation_key") DO NOTHING;