-- Объединение дубликатов клиента ינושבסקי:
--   оставить: ilan@yanush.co.il  → переименовать в «ינושבסקי א. הנדסה ובנין בע"מ»
--   удалить:  tzvika@yanush.co.il (все ссылки в записях перенаправляются на оставшегося)
-- Скрипт находит пользователей по email, поэтому безопасен даже если id на сервере отличаются.

BEGIN;

DO $$
DECLARE
  keep_id int;
  del_id  int;
BEGIN
  SELECT id INTO keep_id FROM users WHERE email = 'ilan@yanush.co.il';
  SELECT id INTO del_id  FROM users WHERE email = 'tzvika@yanush.co.il';

  IF keep_id IS NULL THEN
    RAISE EXCEPTION 'Не найден пользователь ilan@yanush.co.il — объединение отменено';
  END IF;
  IF del_id IS NULL THEN
    RAISE EXCEPTION 'Не найден пользователь tzvika@yanush.co.il — объединение отменено (возможно, уже выполнено)';
  END IF;

  -- 1. Перенаправить ссылки в значениях записей: только поля типа "user"
  --    (client, project_manager, designer, manufacturer и т.п.).
  --    Числовые поля с совпадающим числом (например, цена = 80) НЕ трогаются.
  UPDATE entity_records r
  SET values_json = (
    SELECT jsonb_object_agg(
      kv.key,
      CASE
        WHEN (kv.value = to_jsonb(del_id) OR kv.value = to_jsonb(del_id::text))
         AND EXISTS (
           SELECT 1 FROM entity_fields f
           WHERE f.entity_id = r.entity_id
             AND f.field_key = kv.key
             AND f.field_type = 'user'
         )
        THEN to_jsonb(keep_id)
        ELSE kv.value
      END
    )
    FROM jsonb_each(r.values_json) kv
  )
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_each(r.values_json) kv
    JOIN entity_fields f
      ON f.entity_id = r.entity_id
     AND f.field_key = kv.key
     AND f.field_type = 'user'
    WHERE kv.value = to_jsonb(del_id) OR kv.value = to_jsonb(del_id::text)
  );

  -- 2. То же для страничных (page-local) полей типа "user"
  UPDATE page_record_values v
  SET values_json = (
    SELECT jsonb_object_agg(
      kv.key,
      CASE
        WHEN (kv.value = to_jsonb(del_id) OR kv.value = to_jsonb(del_id::text))
         AND EXISTS (
           SELECT 1 FROM page_fields pf
           WHERE pf.page_id = v.page_id
             AND pf.field_key = kv.key
             AND pf.field_type = 'user'
         )
        THEN to_jsonb(keep_id)
        ELSE kv.value
      END
    )
    FROM jsonb_each(v.values_json) kv
  )
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_each(v.values_json) kv
    JOIN page_fields pf
      ON pf.page_id = v.page_id
     AND pf.field_key = kv.key
     AND pf.field_type = 'user'
    WHERE kv.value = to_jsonb(del_id) OR kv.value = to_jsonb(del_id::text)
  );

  -- 3. Историю действий и входов перевесить на оставшегося пользователя
  UPDATE audit_log     SET user_id = keep_id WHERE user_id = del_id;
  UPDATE login_history SET user_id = keep_id WHERE user_id = del_id;

  -- 4. Служебные записи удаляемого пользователя
  DELETE FROM user_roles  WHERE user_id = del_id;
  DELETE FROM guest_links WHERE user_id = del_id OR created_by = del_id;

  -- 5. Переименовать оставшегося клиента в правильное название
  UPDATE users
  SET first_name = 'ינושבסקי א. הנדסה ובנין בע"מ',
      last_name  = '',
      updated_at = now()
  WHERE id = keep_id;

  -- 6. Удалить неправильно названного клиента
  DELETE FROM users WHERE id = del_id;

  RAISE NOTICE 'Готово: ссылки перенесены с пользователя % на %', del_id, keep_id;
END $$;

COMMIT;
