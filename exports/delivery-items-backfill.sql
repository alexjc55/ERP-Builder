-- ONE-TIME ADMINISTRATIVE BACKFILL. Target: erp_davidov.
-- Take a DB backup and stop the API/background workers before running.
-- Execute the WHOLE file in one DB connection. This file COMMITS changes.
-- Includes archived Deliveries AND Items. No Order => leave Delivery untouched.
-- Keeps existing selections and adds missing Items from the same Order.
-- Does not run application automations, change statuses, or write app audit events.
-- Remove a previous run's TEMP summary before BEGIN: an aborted rerun must
-- never show an old success report. This does not touch application data.
DROP TABLE IF EXISTS pg_temp.delivery_backfill_summary;
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SET LOCAL search_path = public, pg_catalog;
LOCK TABLE entities, entity_fields, relations, entity_records, record_links
  IN SHARE ROW EXCLUSIVE MODE;

DO $guard$
BEGIN
  IF current_database() <> 'erp_davidov' THEN
    RAISE EXCEPTION 'Wrong database: % (expected erp_davidov)', current_database();
  END IF;
  IF (SELECT count(*) FROM entities WHERE
      (id=75 AND entity_key='delivery') OR (id=72 AND entity_key='items') OR
      (id=74 AND entity_key='orders')) <> 3 THEN
    RAISE EXCEPTION 'Entity metadata differs; aborting';
  END IF;
  IF (SELECT count(*) FROM relations WHERE
      (id=35 AND relation_key='delivery_items' AND source_entity_id=75 AND target_entity_id=72 AND relation_type='many_to_many') OR
      (id=28 AND source_entity_id=75 AND target_entity_id=74 AND relation_type='many_to_one') OR
      (id=25 AND source_entity_id=72 AND target_entity_id=74 AND relation_type='many_to_one')) <> 3 THEN
    RAISE EXCEPTION 'Relation metadata differs; aborting';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM entity_fields WHERE id=232 AND entity_id=75
      AND field_key='items_in_delivery' AND field_type='relation' AND is_active AND NOT lock_after_create
      AND relation_config_json @> '{"relationId":35,"selectionMode":"multiple"}'
      AND dependency_config_json @> '{"dependsOnFieldKey":"order","relatedFilterFieldKey":"order_number"}')
    OR (SELECT count(*) FROM entity_fields WHERE is_active AND field_type='relation' AND
      ((id=202 AND entity_id=75 AND field_key='order' AND relation_config_json @> '{"relationId":28}') OR
       (id=153 AND entity_id=72 AND field_key='order_number' AND relation_config_json @> '{"relationId":25}'))) <> 2 THEN
    RAISE EXCEPTION 'Field metadata differs; aborting';
  END IF;
  -- A second field sharing this relation may impose additional invariants.
  IF EXISTS (SELECT 1 FROM entity_fields WHERE is_active AND id<>232
      AND relation_config_json->>'relationId'='35') THEN
    RAISE EXCEPTION 'Another active field uses relation 35; review its constraints first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE
      tgrelid='entity_records'::regclass AND tgname='entity_records_version_bump'
      AND NOT tgisinternal AND tgenabled IN ('O','A')) THEN
    RAISE EXCEPTION 'Record version trigger missing/disabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM record_links l JOIN relations r ON r.id=l.relation_id
    LEFT JOIN entity_records s ON s.id=l.source_record_id
    LEFT JOIN entity_records t ON t.id=l.target_record_id
    WHERE r.id IN (25,28,35) AND (s.id IS NULL OR t.id IS NULL
      OR s.entity_id<>r.source_entity_id OR t.entity_id<>r.target_entity_id
      OR l.relation_type<>r.relation_type)
  ) OR EXISTS (
    SELECT 1 FROM record_links WHERE relation_id IN (25,28)
    GROUP BY relation_id,source_record_id HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Invalid link endpoints/type or multiple Orders; aborting';
  END IF;
  -- Deliveries WITHOUT an Order are deliberately excluded from this check.
  IF EXISTS (
    SELECT 1 FROM record_links selected
    JOIN record_links delivery_order ON delivery_order.relation_id=28
      AND delivery_order.source_record_id=selected.source_record_id
    WHERE selected.relation_id=35 AND NOT EXISTS (
      SELECT 1 FROM record_links item_order WHERE item_order.relation_id=25
        AND item_order.source_record_id=selected.target_record_id
        AND item_order.target_record_id=delivery_order.target_record_id)
  ) THEN
    RAISE EXCEPTION 'Existing selection contains an Item outside its Delivery Order; nothing changed';
  END IF;
END;
$guard$;

DROP TABLE IF EXISTS pg_temp.delivery_backfill_added;
DROP TABLE IF EXISTS pg_temp.delivery_backfill_versions;

CREATE TEMP TABLE delivery_backfill_added ON COMMIT PRESERVE ROWS AS
WITH inserted AS (
  INSERT INTO record_links (relation_id, relation_type, source_record_id, target_record_id)
  SELECT 35, r.relation_type, d.source_record_id, i.source_record_id
  FROM record_links d
  JOIN record_links i ON i.relation_id=25 AND i.target_record_id=d.target_record_id
  JOIN relations r ON r.id=35
  WHERE d.relation_id=28 AND NOT EXISTS (
    SELECT 1 FROM record_links old WHERE old.relation_id=35
      AND old.source_record_id=d.source_record_id AND old.target_record_id=i.source_record_id)
  RETURNING source_record_id, target_record_id
) SELECT * FROM inserted;

CREATE TEMP TABLE delivery_backfill_versions ON COMMIT PRESERVE ROWS AS
SELECT id,version FROM entity_records WHERE id IN (
  SELECT source_record_id FROM delivery_backfill_added
  UNION SELECT target_record_id FROM delivery_backfill_added
);
UPDATE entity_records SET updated_at=clock_timestamp()
WHERE id IN (SELECT id FROM delivery_backfill_versions);
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM delivery_backfill_versions old
    JOIN entity_records current_row USING (id) WHERE current_row.version<>old.version+1) THEN
    RAISE EXCEPTION 'Version trigger did not increment exactly once; transaction aborted';
  END IF;
END;
$verify$;

CREATE TEMP TABLE delivery_backfill_summary ON COMMIT PRESERVE ROWS AS
SELECT
  (SELECT count(*) FROM delivery_backfill_added) AS added_links,
  (SELECT count(DISTINCT source_record_id) FROM delivery_backfill_added) AS changed_deliveries,
  (SELECT count(DISTINCT target_record_id) FROM delivery_backfill_added) AS changed_items,
  (SELECT count(*) FROM entity_records d WHERE d.entity_id=75 AND NOT EXISTS
    (SELECT 1 FROM record_links l WHERE l.relation_id=28 AND l.source_record_id=d.id)) AS skipped_without_order;
COMMIT;
-- This result is returned only after successful COMMIT.
SELECT 'COMMITTED' AS result, * FROM pg_temp.delivery_backfill_summary;