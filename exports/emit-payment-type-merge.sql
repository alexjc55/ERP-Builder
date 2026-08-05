-- Страница «Монтаж», поле «Тип оплаты» (tip_oplaty):
--  1) вариант «Емит 2000» переименовывается в «Емит»;
--  2) варианты «Емит 1000», «Емит 1800», «Емит 750», «Емит 900» удаляются из списка;
--  3) во всех записях значения «Емит 2000/1000/1800/750/900» заменяются на «Емит».
-- Итоговый список: Кабланут, Емит, По часам, Договор.
-- Скрипт идемпотентен — повторный запуск ничего не ломает.

BEGIN;

UPDATE page_fields
SET options_json = (
  SELECT jsonb_agg(
    CASE WHEN opt->>'value' = 'Емит 2000'
      THEN jsonb_build_object('value', 'Емит', 'labelJson', jsonb_build_object('ru', 'Емит'))
      ELSE opt END
    ORDER BY ord)
  FROM jsonb_array_elements(options_json) WITH ORDINALITY AS t(opt, ord)
  WHERE opt->>'value' NOT IN ('Емит 1000', 'Емит 1800', 'Емит 750', 'Емит 900')
)
WHERE field_key = 'tip_oplaty' AND field_type = 'select';

UPDATE page_record_values prv
SET values_json = jsonb_set(values_json, '{tip_oplaty}', '"Емит"'),
    updated_at = now()
WHERE prv.page_id IN (SELECT page_id FROM page_fields WHERE field_key = 'tip_oplaty' AND field_type = 'select')
  AND prv.values_json->>'tip_oplaty' IN ('Емит 2000', 'Емит 1000', 'Емит 1800', 'Емит 750', 'Емит 900');

COMMIT;
