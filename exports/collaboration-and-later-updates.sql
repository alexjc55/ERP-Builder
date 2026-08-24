-- Production SQL handover: collaborative editing and later database changes
-- Generated: 2026-08-24
--
-- Scope
--   1. Database changes introduced after baseline commit 59098e0 for the
--      collaborative record/page editing system.
--   2. Database-backed configuration changes made after that implementation:
--      the "Дней производства" page formula.
--
-- No SQL changes were required by the later two-session E2E and release-gate
-- tasks. Their API/frontend/test code must still be deployed separately.
--
-- Safety
--   * Back up the production database first.
--   * Run during a maintenance window: ALTER TABLE and trigger replacement take
--     table locks.
--   * The script is transactional and idempotent.
--   * It does not copy or replace user records.
--   * If a partial earlier migration left version=NULL, only that technical
--     concurrency metadata is backfilled to 1; business field values are not
--     changed.

BEGIN;

-- Fail before making changes when this is not the expected ERP database.
DO $preflight$
BEGIN
  IF to_regclass('public.entity_records') IS NULL THEN
    RAISE EXCEPTION 'Required table public.entity_records does not exist';
  END IF;
  IF to_regclass('public.page_record_values') IS NULL THEN
    RAISE EXCEPTION 'Required table public.page_record_values does not exist';
  END IF;
  IF to_regclass('public.pages') IS NULL THEN
    RAISE EXCEPTION 'Required table public.pages does not exist';
  END IF;
  IF to_regclass('public.page_fields') IS NULL THEN
    RAISE EXCEPTION 'Required table public.page_fields does not exist';
  END IF;
END;
$preflight$ LANGUAGE plpgsql;

-- If a legacy database already has a column named version with an incompatible
-- type, abort instead of coercing or damaging its contents.
DO $type_check$
DECLARE
  entity_version_type text;
  page_version_type text;
BEGIN
  SELECT data_type
    INTO entity_version_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'entity_records'
     AND column_name = 'version';

  SELECT data_type
    INTO page_version_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'page_record_values'
     AND column_name = 'version';

  IF entity_version_type IS NOT NULL AND entity_version_type <> 'integer' THEN
    RAISE EXCEPTION
      'public.entity_records.version has incompatible type: %',
      entity_version_type;
  END IF;

  IF page_version_type IS NOT NULL AND page_version_type <> 'integer' THEN
    RAISE EXCEPTION
      'public.page_record_values.version has incompatible type: %',
      page_version_type;
  END IF;
END;
$type_check$ LANGUAGE plpgsql;

-- Optimistic-concurrency versions. The nullable-add/backfill/constraint order
-- also repairs a partially applied earlier migration.
ALTER TABLE public.entity_records
  ADD COLUMN IF NOT EXISTS version integer;

UPDATE public.entity_records
   SET version = 1
 WHERE version IS NULL;

ALTER TABLE public.entity_records
  ALTER COLUMN version SET DEFAULT 1,
  ALTER COLUMN version SET NOT NULL;

ALTER TABLE public.page_record_values
  ADD COLUMN IF NOT EXISTS version integer;

UPDATE public.page_record_values
   SET version = 1
 WHERE version IS NULL;

ALTER TABLE public.page_record_values
  ALTER COLUMN version SET DEFAULT 1,
  ALTER COLUMN version SET NOT NULL;

-- Ordinary UPDATE statements advance the version once. API writes that already
-- assign an explicit next version are preserved and are not incremented twice.
CREATE OR REPLACE FUNCTION public.bump_collaboration_version()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.version = OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS entity_records_version_bump
  ON public.entity_records;

CREATE TRIGGER entity_records_version_bump
BEFORE UPDATE ON public.entity_records
FOR EACH ROW
EXECUTE FUNCTION public.bump_collaboration_version();

DROP TRIGGER IF EXISTS page_record_values_version_bump
  ON public.page_record_values;

CREATE TRIGGER page_record_values_version_bump
BEFORE UPDATE ON public.page_record_values
FOR EACH ROW
EXECUTE FUNCTION public.bump_collaboration_version();

-- Later database-backed configuration change:
-- Отчеты -> Основной -> Дней производства.
--   * entry_date empty: show nothing
--   * release date empty: days from entry_date through today
--   * both dates filled: days between the two dates
--
-- Prefer the known IDs from the transferred database, while also allowing the
-- same field to be found by its page hierarchy if IDs differ. More than one
-- matching field aborts the transaction instead of updating an arbitrary row.
DO $formula_update$
DECLARE
  target_field_id integer;
  target_expression text :=
    $expression$if({entry_date} == '', '', if({material_release_date} == '', daysSince({entry_date}), daysBetween({entry_date},{material_release_date})))$expression$;
BEGIN
  SELECT pf.id
    INTO STRICT target_field_id
    FROM public.page_fields AS pf
    JOIN public.pages AS page
      ON page.id = pf.page_id
    LEFT JOIN public.pages AS parent
      ON parent.id = page.parent_page_id
   WHERE pf.field_key = 'dney_proizvodstva'
     AND pf.field_type = 'function'
     AND (
       (pf.id = 94 AND pf.page_id = 119)
       OR (
         page.name_json ->> 'ru' = 'Основной'
         AND parent.name_json ->> 'ru' = 'Отчеты'
       )
     );

  UPDATE public.page_fields
     SET formula_config_json = jsonb_set(
           COALESCE(formula_config_json, '{}'::jsonb),
           '{expression}',
           to_jsonb(target_expression),
           true
         ),
         updated_at = now()
   WHERE id = target_field_id
     AND (
       formula_config_json ->> 'expression'
     ) IS DISTINCT FROM target_expression;
END;
$formula_update$ LANGUAGE plpgsql;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (read-only)
-- ---------------------------------------------------------------------------

SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('entity_records', 'page_record_values')
  AND column_name = 'version'
ORDER BY table_name;

SELECT
  event_object_table,
  trigger_name,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN (
    'entity_records_version_bump',
    'page_record_values_version_bump'
  )
ORDER BY trigger_name;

SELECT
  page.id AS page_id,
  pf.id AS field_id,
  pf.field_key,
  pf.formula_config_json ->> 'expression' AS expression
FROM public.page_fields AS pf
JOIN public.pages AS page
  ON page.id = pf.page_id
LEFT JOIN public.pages AS parent
  ON parent.id = page.parent_page_id
WHERE pf.field_key = 'dney_proizvodstva'
  AND (
    (pf.id = 94 AND pf.page_id = 119)
    OR (
      page.name_json ->> 'ru' = 'Основной'
      AND parent.name_json ->> 'ru' = 'Отчеты'
    )
  );

-- Expected verification:
--   * both version columns are integer, NOT NULL, default 1;
--   * both BEFORE UPDATE triggers execute bump_collaboration_version();
--   * the formula SELECT returns exactly one row with the expression above.
--
-- After deploying the matching application code, run:
--   pnpm run validate:deployment:collaboration