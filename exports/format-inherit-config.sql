-- Настройка источников наследования форматирования для «Общего статуса»
-- (Заказы и Изделия): цвета статусов Изделий + правила полей
-- «Статус производства», «Статус покраски» + поле страницы «Монтаж»
-- «Статус монтажа».
-- Выполнять ПОСЛЕ exports/format-inherit-migration.sql (колонка должна существовать).
-- Ищет всё по именам, id не зашиты. Повторный запуск безопасен.

BEGIN;

DO $$
DECLARE
  v_izdeliya_id integer;
  v_montazh_page_id integer;
  v_updated integer;
BEGIN
  SELECT id INTO v_izdeliya_id FROM entities WHERE name_json->>'ru' = 'Изделия';
  IF v_izdeliya_id IS NULL THEN
    RAISE EXCEPTION 'Сущность «Изделия» не найдена';
  END IF;

  SELECT id INTO v_montazh_page_id FROM pages WHERE name_json->>'ru' = 'Монтаж' AND mirror_entity_id IS NOT NULL;
  IF v_montazh_page_id IS NULL THEN
    RAISE EXCEPTION 'Зеркальная страница «Монтаж» не найдена';
  END IF;

  UPDATE entity_fields ef
  SET format_inherit_json = jsonb_build_array(
    jsonb_build_object('kind', 'status', 'entityId', v_izdeliya_id),
    jsonb_build_object('kind', 'field', 'entityId', v_izdeliya_id, 'fieldKey', 'production_status'),
    jsonb_build_object('kind', 'field', 'entityId', v_izdeliya_id, 'fieldKey', 'paint_status'),
    jsonb_build_object('kind', 'pageField', 'pageId', v_montazh_page_id, 'fieldKey', 'status_montazha')
  )
  WHERE ef.field_key IN ('obshchiy_status', 'obschiy_status')
    AND ef.entity_id IN (SELECT id FROM entities WHERE name_json->>'ru' IN ('Заказы', 'Изделия'));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Поля «Общий статус» не найдены — ничего не обновлено';
  END IF;
  RAISE NOTICE 'Обновлено полей: %', v_updated;
END $$;

COMMIT;
