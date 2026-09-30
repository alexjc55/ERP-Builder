-- Read-only estimate before running delivery-items-backfill.sql.
-- Confirm database=erp_davidov. The apply script rechecks metadata under locks.
WITH desired AS (
  SELECT d.source_record_id AS delivery_id, i.source_record_id AS item_id
  FROM record_links d JOIN record_links i
    ON i.relation_id=25 AND i.target_record_id=d.target_record_id
  WHERE d.relation_id=28
), missing AS (
  SELECT * FROM desired x WHERE NOT EXISTS (
    SELECT 1 FROM record_links l WHERE l.relation_id=35
      AND l.source_record_id=x.delivery_id AND l.target_record_id=x.item_id)
)
SELECT current_database() AS database,
  (SELECT count(*) FROM entity_records WHERE entity_id=75) AS total_deliveries,
  (SELECT count(*) FROM entity_records WHERE entity_id=75 AND archived_at IS NOT NULL) AS archived_deliveries,
  (SELECT count(*) FROM entity_records d WHERE entity_id=75 AND NOT EXISTS
    (SELECT 1 FROM record_links l WHERE l.relation_id=28 AND l.source_record_id=d.id)) AS without_order,
  (SELECT count(*) FROM missing) AS links_to_add,
  (SELECT count(DISTINCT delivery_id) FROM missing) AS deliveries_to_fill;