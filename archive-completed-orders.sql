-- ============================================================
-- Архивация заказов, у которых ВСЕ изделия имеют % выполнения = 100
-- (поле страницы «Монтаж», vypolneniya в page_record_values).
-- В архив уходят: сам заказ, все его изделия и все его доставки.
-- Архив = штатный флаг archived_at (та же «функция в архив», что и вручную).
-- Идемпотентно: уже заархивированные записи не трогаются.
-- ============================================================
BEGIN;

WITH e AS (
  SELECT
    (SELECT id FROM entities WHERE entity_key = 'orders')   AS orders_id,
    (SELECT id FROM entities WHERE entity_key = 'items')    AS items_id,
    (SELECT id FROM entities WHERE entity_key = 'delivery') AS delivery_id
), pg AS (
  SELECT id FROM pages
  WHERE name_json->>'ru' = 'Монтаж'
    AND mirror_entity_id = (SELECT items_id FROM e)
  LIMIT 1
), rel_item_order AS (   -- изделие -> заказ
  SELECT id FROM relations
  WHERE relation_key = 'zakazy'
    AND source_entity_id = (SELECT items_id FROM e)
    AND target_entity_id = (SELECT orders_id FROM e)
), rel_delivery_order AS (   -- доставка -> заказ
  SELECT id FROM relations
  WHERE relation_key = 'zakazy'
    AND source_entity_id = (SELECT delivery_id FROM e)
    AND target_entity_id = (SELECT orders_id FROM e)
), done_orders AS (
  -- заказы, у которых есть хотя бы одно изделие и у КАЖДОГО изделия
  -- на странице «Монтаж» проставлено % выполнения = 100
  SELECT o.id
  FROM entity_records o
  WHERE o.entity_id = (SELECT orders_id FROM e)
    AND EXISTS (
      SELECT 1 FROM record_links l
      WHERE l.relation_id = (SELECT id FROM rel_item_order)
        AND l.target_record_id = o.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM record_links l
      JOIN entity_records it ON it.id = l.source_record_id
      LEFT JOIN page_record_values pv
        ON pv.record_id = it.id AND pv.page_id = (SELECT id FROM pg)
      WHERE l.relation_id = (SELECT id FROM rel_item_order)
        AND l.target_record_id = o.id
        AND COALESCE((pv.values_json->>'vypolneniya')::numeric, -1) <> 100
    )
), arch_items AS (
  UPDATE entity_records it
  SET archived_at = now(), updated_at = now()
  FROM record_links l
  WHERE l.relation_id = (SELECT id FROM rel_item_order)
    AND l.source_record_id = it.id
    AND l.target_record_id IN (SELECT id FROM done_orders)
    AND it.archived_at IS NULL
  RETURNING it.id
), arch_deliveries AS (
  UPDATE entity_records d
  SET archived_at = now(), updated_at = now()
  FROM record_links l
  WHERE l.relation_id = (SELECT id FROM rel_delivery_order)
    AND l.source_record_id = d.id
    AND l.target_record_id IN (SELECT id FROM done_orders)
    AND d.archived_at IS NULL
  RETURNING d.id
), arch_orders AS (
  UPDATE entity_records o
  SET archived_at = now(), updated_at = now()
  WHERE o.id IN (SELECT id FROM done_orders)
    AND o.archived_at IS NULL
  RETURNING o.id
)
SELECT
  (SELECT count(*) FROM done_orders)     AS orders_done_100,
  (SELECT count(*) FROM arch_orders)     AS orders_archived,
  (SELECT count(*) FROM arch_items)      AS items_archived,
  (SELECT count(*) FROM arch_deliveries) AS deliveries_archived;

COMMIT;
