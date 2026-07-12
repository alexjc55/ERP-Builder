-- Исправление порядка "Дата добавления" для импортированных записей (сущность Изделия, id=72).
-- Проблема: импорт выполнялся одной транзакцией, поэтому у всех записей
-- одинаковая дата добавления, и сортировка по ней давала случайный порядок.
-- Этот скрипт раздвигает даты на миллисекунды в порядке вставки (порядок строк Excel),
-- не меняя саму дату/время по сути. Затрагивает ТОЛЬКО группы записей
-- с полностью одинаковой датой добавления; записи, созданные вручную, не трогает.
-- Скрипт безопасно запускать повторно.

BEGIN;

WITH dupes AS (
  SELECT id,
         created_at,
         row_number() OVER (PARTITION BY created_at ORDER BY id) - 1 AS rn,
         count(*) OVER (PARTITION BY created_at) AS cnt
  FROM entity_records
  WHERE entity_id = 72
)
UPDATE entity_records er
SET created_at = d.created_at + (d.rn * interval '1 millisecond')
FROM dupes d
WHERE er.id = d.id
  AND d.cnt > 1;

COMMIT;
