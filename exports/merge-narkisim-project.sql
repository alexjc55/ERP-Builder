-- Объединение дубликатов проекта:
--   оставить: «בית ספר נרקיסים»
--   удалить:  «בית ספר נרקיסים ראשון לציון» (все его заказы/изделия/доставки переносятся в оставшийся)
-- Скрипт находит проекты по точному названию, поэтому безопасен даже если id на сервере отличаются.
-- Повторный запуск безопасен: если дубликат уже удалён, скрипт прервётся, ничего не изменив.

BEGIN;

DO $$
DECLARE
  keep_id int;
  del_id  int;
  moved   int;
  dropped int;
BEGIN
  SELECT r.id INTO keep_id FROM entity_records r
   JOIN entities e ON e.id = r.entity_id AND e.name_json->>'ru' = 'Проекты'
   WHERE r.values_json->>'name' = 'בית ספר נרקיסים'
   ORDER BY r.id LIMIT 1;
  SELECT r.id INTO del_id FROM entity_records r
   JOIN entities e ON e.id = r.entity_id AND e.name_json->>'ru' = 'Проекты'
   WHERE r.values_json->>'name' = 'בית ספר נרקיסים ראשון לציון'
   ORDER BY r.id LIMIT 1;

  IF keep_id IS NULL THEN
    RAISE EXCEPTION 'Не найден проект «בית ספר נרקיסים» — объединение отменено';
  END IF;
  IF del_id IS NULL THEN
    RAISE EXCEPTION 'Не найден проект «בית ספר נרקיסים ראשון לציון» — объединение отменено (возможно, уже выполнено)';
  END IF;
  IF keep_id = del_id THEN
    RAISE EXCEPTION 'Найдена одна и та же запись — объединение отменено';
  END IF;

  -- Проект всегда стоит на стороне TARGET связей (заказы/изделия/доставки -> проект).
  -- 1. Если какая-то запись уже связана с ОБОИМИ проектами, её связь с дубликатом
  --    просто удаляется (иначе перенос нарушил бы правило «одна связь на запись»).
  DELETE FROM record_links dup
  WHERE dup.target_record_id = del_id
    AND EXISTS (
      SELECT 1 FROM record_links k
      WHERE k.relation_id = dup.relation_id
        AND k.source_record_id = dup.source_record_id
        AND k.target_record_id = keep_id
    );
  GET DIAGNOSTICS dropped = ROW_COUNT;

  -- 2. Остальные связи переносятся на оставшийся проект.
  UPDATE record_links
  SET target_record_id = keep_id
  WHERE target_record_id = del_id;
  GET DIAGNOSTICS moved = ROW_COUNT;

  -- 3. Значения страничных полей дубликата (если были) удаляются вместе с ним.
  DELETE FROM page_record_values WHERE record_id = del_id;

  -- 4. Удалить дубликат проекта.
  DELETE FROM entity_records WHERE id = del_id;

  RAISE NOTICE 'Готово: перенесено связей — %, удалено дублирующих связей — % (проект % -> %)',
    moved, dropped, del_id, keep_id;
END $$;

COMMIT;
