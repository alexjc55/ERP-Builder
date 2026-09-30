-- READ ONLY. Run on the remote database and return the result.
-- This is NOT the backfill: no records, links, statuses or versions are changed.
-- Remote relation/field IDs cannot be copied from the development database.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_catalog;

WITH delivery_entities AS (
  SELECT id FROM entities
  WHERE lower(entity_key) = 'delivery'
     OR lower(name_json ->> 'en') = 'delivery'
     OR lower(name_json ->> 'ru') = 'доставка'
), scope_entities AS (
  SELECT id FROM delivery_entities
  UNION
  SELECT target_entity_id FROM relations
  WHERE source_entity_id IN (SELECT id FROM delivery_entities)
  UNION
  SELECT source_entity_id FROM relations
  WHERE target_entity_id IN (SELECT id FROM delivery_entities)
), entity_info AS (
  SELECT e.id, e.entity_key, e.name_json,
    count(rec.id) AS total_records,
    count(rec.id) FILTER (WHERE rec.archived_at IS NOT NULL) AS archived_records
  FROM entities e
  LEFT JOIN entity_records rec ON rec.entity_id = e.id
  WHERE e.id IN (SELECT id FROM scope_entities)
  GROUP BY e.id
), relation_info AS (
  SELECT r.id, r.relation_key, r.relation_type,
    r.source_entity_id, r.target_entity_id, r.name_json,
    r.settings_json,
    (SELECT count(*) FROM record_links l WHERE l.relation_id = r.id) AS existing_links
  FROM relations r
  WHERE r.source_entity_id IN (SELECT id FROM scope_entities)
    AND r.target_entity_id IN (SELECT id FROM scope_entities)
), field_info AS (
  SELECT f.id, f.entity_id, f.field_key, f.name_json, f.field_type,
    f.is_active, f.lock_after_create, f.relation_config_json, f.dependency_config_json
  FROM entity_fields f
  WHERE f.entity_id IN (SELECT id FROM scope_entities)
    AND f.field_type IN ('relation', 'lookup')
), page_field_info AS (
  SELECT f.id, f.page_id, p.name_json AS page_name,
    p.mirror_entity_id, e.id AS direct_entity_id,
    f.field_key, f.name_json, f.field_type, f.is_active, f.relation_config_json
  FROM page_fields f
  JOIN pages p ON p.id = f.page_id
  LEFT JOIN entities e ON e.page_id = p.id
  WHERE (p.mirror_entity_id IN (SELECT id FROM scope_entities)
      OR e.id IN (SELECT id FROM scope_entities))
    AND f.field_type IN ('relation', 'lookup')
)
SELECT jsonb_pretty(jsonb_build_object(
  'database', current_database(),
  'delivery_entity_ids', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM delivery_entities), '[]'::jsonb),
  'entities', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM entity_info e), '[]'::jsonb),
  'relations', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM relation_info r), '[]'::jsonb),
  'entity_relation_fields', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.entity_id, f.id) FROM field_info f), '[]'::jsonb),
  'page_relation_fields', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.page_id, f.id) FROM page_field_info f), '[]'::jsonb),
  'record_version_triggers', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', t.tgname, 'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid),
      'function_definition', pg_get_functiondef(t.tgfoid)
    ) ORDER BY t.tgname)
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.entity_records'::regclass AND NOT t.tgisinternal
  ), '[]'::jsonb)
)) AS delivery_backfill_metadata;

ROLLBACK;