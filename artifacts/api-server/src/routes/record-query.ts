import { sql, and, or, asc, desc, inArray, type SQL } from "drizzle-orm";
import { entityRecordsTable, recordLinksTable, pageRecordValuesTable } from "@workspace/db";
import type { EntityField } from "@workspace/db";

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty"
  | "in"
  | "between";

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

export interface SortSpec {
  field: string;
  direction?: "asc" | "desc";
}

/**
 * Reserved sort keys that map to the record's system columns instead of an
 * entity field. They are never rendered as table columns; they exist only so a
 * view/default sort can order by the row's system creation date or its id
 * (useful as a stable tie-breaker, e.g. two rows with the same business date
 * keep their insertion order). Kept in lockstep with the web sort UI.
 */
export const SYSTEM_SORT_CREATED_AT = "__created_at__";
export const SYSTEM_SORT_RECORD_ID = "__record_id__";

export interface RecordQuerySpec {
  filters?: FilterCondition[];
  filterConjunction?: "and" | "or";
  statusIds?: number[];
  sorts?: SortSpec[];
  search?: string;
}

const NUMERIC_TYPES = new Set(["number"]);
const DATE_TYPES = new Set(["date", "datetime"]);
// Field types whose values are free text we can run a substring search against.
const TEXT_SEARCH_TYPES = new Set(["text", "textarea", "email", "url", "phone", "select"]);

/** Text expression for a JSONB field value: (values_json ->> 'key'). Key is a bound param. */
function textExpr(key: string): SQL {
  return sql`(${entityRecordsTable.valuesJson} ->> ${key})`;
}

/**
 * Metadata needed to filter/search a `relation` or `lookup` field. Unlike stored
 * field types, these have no value in `values_json` — the displayed value is the
 * projected `relatedFieldKey` of the single linked record (reached through
 * `record_links`). `direction` says which side of the relation the base row sits
 * on, so we know which link column points at the base record vs. the linked one.
 */
export interface RelationFilterMeta {
  relationId: number;
  relatedFieldKey: string;
  direction: "source" | "target";
}

/**
 * Which side of a single-link relation the base entity sits on (or null when the
 * relation isn't single-link for that entity). Kept here so both the records
 * query and the filter-values endpoint resolve direction identically to the
 * page-fields resolver. "source" → base is source, single linked record is the
 * target; "target" → the inverse.
 */
export function relationDirection(
  relation: { sourceEntityId: number; targetEntityId: number; relationType: string },
  entityId: number,
): "source" | "target" | null {
  const t = relation.relationType;
  if (relation.sourceEntityId === entityId && (t === "one_to_one" || t === "many_to_one")) return "source";
  if (relation.targetEntityId === entityId && (t === "one_to_one" || t === "one_to_many")) return "target";
  return null;
}

/**
 * Correlated EXISTS subquery: the base row (outer `entity_records`) has a single
 * linked record via `record_links` whose projected value satisfies `valueCond`.
 * The linked value is `lt.values_json ->> relatedFieldKey`. All identifiers are
 * literal table/column names; only the relationId, relatedFieldKey and any
 * filter values are bound params.
 */
function relationValueExists(meta: RelationFilterMeta, valueCond: (linkedVal: SQL) => SQL): SQL {
  const baseCol = meta.direction === "source" ? sql`rl.source_record_id` : sql`rl.target_record_id`;
  const linkedCol = meta.direction === "source" ? sql`rl.target_record_id` : sql`rl.source_record_id`;
  const linkedVal = sql`(lt.values_json ->> ${meta.relatedFieldKey})`;
  return sql`EXISTS (SELECT 1 FROM ${recordLinksTable} rl JOIN ${entityRecordsTable} lt ON lt.id = ${linkedCol} WHERE rl.relation_id = ${meta.relationId} AND ${baseCol} = ${entityRecordsTable.id} AND ${valueCond(linkedVal)})`;
}

/**
 * Row-ownership EXISTS for a `relation`/`lookup` owner field: the base row has a
 * single linked record whose projected (user-type) `relatedFieldKey` equals
 * `userId`. Used by the own-scope ("Только свои") boundary so ownership can be
 * designated by a projected user field, not only a native `user` field. The
 * projected value is text in `values_json`, so the user id is compared as a
 * string. Reuses {@link relationValueExists} so it matches the relation-filter
 * direction/join logic exactly.
 */
export function ownRelationExists(meta: RelationFilterMeta, userId: number): SQL {
  return relationValueExists(meta, (v) => sql`${v} = ${String(userId)}`);
}

/**
 * A filter condition on a `relation`/`lookup` field, expressed as an EXISTS over
 * the linked record's projected value. Mirrors the operators `buildCondition`
 * supports for text, but always wrapped so it matches by the LINKED value, not a
 * (non-existent) `values_json` entry. `is_empty` = no link with a non-empty value.
 */
function buildRelationCondition(cond: FilterCondition, meta: RelationFilterMeta): { sql: SQL } | { error: string } {
  const op = cond.operator;
  const nonEmpty = (v: SQL): SQL => sql`${v} IS NOT NULL AND ${v} <> ''`;

  if (op === "is_empty") return { sql: sql`NOT ${relationValueExists(meta, nonEmpty)}` };
  if (op === "is_not_empty") return { sql: relationValueExists(meta, nonEmpty) };

  if (op === "in") {
    if (!Array.isArray(cond.value)) {
      return { error: `Operator "in" requires an array value for field "${cond.field}"` };
    }
    if (cond.value.length === 0) return { sql: sql`false` };
    const parts = cond.value.map((v) => sql`${String(v)}`);
    return { sql: relationValueExists(meta, (v) => sql`${v} IN (${sql.join(parts, sql`, `)})`) };
  }

  const value = cond.value;
  if (value === undefined || value === null) {
    return { error: `Operator "${op}" requires a value for field "${cond.field}"` };
  }
  switch (op) {
    case "eq":
      return { sql: relationValueExists(meta, (v) => sql`${v} = ${String(value)}`) };
    case "neq":
      return { sql: sql`NOT ${relationValueExists(meta, (v) => sql`${v} = ${String(value)}`)}` };
    case "contains":
      return { sql: relationValueExists(meta, (v) => sql`${v} ILIKE ${"%" + String(value) + "%"}`) };
    case "not_contains":
      return { sql: sql`NOT ${relationValueExists(meta, (v) => sql`${v} ILIKE ${"%" + String(value) + "%"}`)}` };
    case "starts_with":
      return { sql: relationValueExists(meta, (v) => sql`${v} ILIKE ${String(value) + "%"}`) };
    case "ends_with":
      return { sql: relationValueExists(meta, (v) => sql`${v} ILIKE ${"%" + String(value)}`) };
  }
  return { error: `Unsupported operator "${op}" for relation field "${cond.field}"` };
}

function buildCondition(
  cond: FilterCondition,
  fieldType: string,
  exprOverride?: SQL,
): { sql: SQL } | { error: string } {
  const expr = exprOverride ?? textExpr(cond.field);
  const op = cond.operator;

  if (op === "is_empty") {
    return { sql: sql`(${expr} IS NULL OR ${expr} = '')` };
  }
  if (op === "is_not_empty") {
    return { sql: sql`(${expr} IS NOT NULL AND ${expr} <> '')` };
  }

  if (op === "in") {
    if (!Array.isArray(cond.value)) {
      return { error: `Operator "in" requires an array value for field "${cond.field}"` };
    }
    if (cond.value.length === 0) return { sql: sql`false` };
    const parts = cond.value.map((v) => sql`${String(v)}`);
    return { sql: sql`${expr} IN (${sql.join(parts, sql`, `)})` };
  }

  // Half-open range [from, to): a single condition that is internally AND, so it stays correct
  // regardless of the surrounding filterConjunction (used by the date-range filter UI).
  if (op === "between") {
    if (!Array.isArray(cond.value) || cond.value.length !== 2) {
      return { error: `Operator "between" requires a [from, to] array for field "${cond.field}"` };
    }
    const [from, to] = cond.value;
    if (from === undefined || from === null || to === undefined || to === null) {
      return { error: `Operator "between" requires both bounds for field "${cond.field}"` };
    }
    if (DATE_TYPES.has(fieldType)) {
      const e = sql`(${expr})::timestamptz`;
      return { sql: sql`(${e} >= ${String(from)}::timestamptz AND ${e} < ${String(to)}::timestamptz)` };
    }
    if (NUMERIC_TYPES.has(fieldType)) {
      const lo = Number(from);
      const hi = Number(to);
      if (Number.isNaN(lo) || Number.isNaN(hi)) {
        return { error: `Field "${cond.field}" expects numeric range bounds` };
      }
      const e = sql`(${expr})::numeric`;
      return { sql: sql`(${e} >= ${lo} AND ${e} < ${hi})` };
    }
    return { sql: sql`(${expr} >= ${String(from)} AND ${expr} < ${String(to)})` };
  }

  const value = cond.value;
  if (value === undefined || value === null) {
    return { error: `Operator "${op}" requires a value for field "${cond.field}"` };
  }

  switch (op) {
    case "contains":
      return { sql: sql`${expr} ILIKE ${"%" + String(value) + "%"}` };
    case "not_contains":
      return { sql: sql`(${expr} IS NULL OR ${expr} NOT ILIKE ${"%" + String(value) + "%"})` };
    case "starts_with":
      return { sql: sql`${expr} ILIKE ${String(value) + "%"}` };
    case "ends_with":
      return { sql: sql`${expr} ILIKE ${"%" + String(value)}` };
  }

  // eq / neq / gt / gte / lt / lte — comparison is type-aware.
  if (NUMERIC_TYPES.has(fieldType)) {
    const num = Number(value);
    if (Number.isNaN(num)) return { error: `Field "${cond.field}" expects a numeric value` };
    const e = sql`(${expr})::numeric`;
    switch (op) {
      case "eq":
        return { sql: sql`${e} = ${num}` };
      case "neq":
        return { sql: sql`${e} IS DISTINCT FROM ${num}` };
      case "gt":
        return { sql: sql`${e} > ${num}` };
      case "gte":
        return { sql: sql`${e} >= ${num}` };
      case "lt":
        return { sql: sql`${e} < ${num}` };
      case "lte":
        return { sql: sql`${e} <= ${num}` };
    }
  }

  if (DATE_TYPES.has(fieldType)) {
    const e = sql`(${expr})::timestamptz`;
    const dv = sql`${String(value)}::timestamptz`;
    switch (op) {
      case "eq":
        return { sql: sql`${e} = ${dv}` };
      case "neq":
        return { sql: sql`${e} IS DISTINCT FROM ${dv}` };
      case "gt":
        return { sql: sql`${e} > ${dv}` };
      case "gte":
        return { sql: sql`${e} >= ${dv}` };
      case "lt":
        return { sql: sql`${e} < ${dv}` };
      case "lte":
        return { sql: sql`${e} <= ${dv}` };
    }
  }

  // Fallback: lexical text comparison (covers text/boolean/select/etc.).
  switch (op) {
    case "eq":
      return { sql: sql`${expr} = ${String(value)}` };
    case "neq":
      return { sql: sql`${expr} IS DISTINCT FROM ${String(value)}` };
    case "gt":
      return { sql: sql`${expr} > ${String(value)}` };
    case "gte":
      return { sql: sql`${expr} >= ${String(value)}` };
    case "lt":
      return { sql: sql`${expr} < ${String(value)}` };
    case "lte":
      return { sql: sql`${expr} <= ${String(value)}` };
  }

  return { error: `Unsupported operator "${op}"` };
}

/**
 * Correlated scalar subquery for a PAGE-LOCAL field's stored value on the outer
 * `entity_records` row: the value lives in `page_record_values`, keyed by
 * (pageId, recordId), as `prv.values_json ->> key`. Both pageId and key are
 * bound params (never interpolated), so the page-field key is safe to pass
 * straight from the client. Returns NULL when the row has no stored value for
 * that field — so the same `is_empty` / comparison semantics as a missing
 * entity-field value apply.
 */
export function pageLocalValueExpr(pageId: number, key: string): SQL {
  return sql`(SELECT prv.values_json ->> ${key} FROM ${pageRecordValuesTable} prv WHERE prv.page_id = ${pageId} AND prv.record_id = ${entityRecordsTable.id})`;
}

/**
 * Build a single filter condition against a PAGE-LOCAL field. Reuses the exact
 * operator/type semantics of {@link buildCondition} by overriding the value
 * expression with the page_record_values correlated subquery, so date/numeric
 * casts, `in`, `between`, and empties all behave identically to entity fields.
 */
export function buildPageLocalCondition(
  cond: FilterCondition,
  fieldType: string,
  pageId: number,
): { sql: SQL } | { error: string } {
  return buildCondition(cond, fieldType, pageLocalValueExpr(pageId, cond.field));
}

/**
 * Build the WHERE and ORDER BY for a record query, validating every referenced
 * field key against the entity's active fields (whitelist). Field keys are only
 * ever passed to SQL as bound params, never interpolated as raw SQL text.
 */
export function buildRecordQuery(
  fields: EntityField[],
  spec: RecordQuerySpec,
  relationMeta: Map<string, RelationFilterMeta> = new Map(),
): { where: SQL | undefined; orderBy: SQL[] } | { error: string } {
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));

  const filterChunks: SQL[] = [];
  for (const cond of spec.filters ?? []) {
    const field = fieldByKey.get(cond.field);
    if (!field) return { error: `Unknown filter field: ${cond.field}` };
    // relation/lookup fields have no value in values_json — filter via the linked
    // record's projected value (EXISTS subquery) instead of the text expression.
    const relMeta = relationMeta.get(cond.field);
    const built = relMeta ? buildRelationCondition(cond, relMeta) : buildCondition(cond, field.fieldType);
    if ("error" in built) return { error: built.error };
    filterChunks.push(built.sql);
  }

  let filterWhere: SQL | undefined;
  if (filterChunks.length > 0) {
    filterWhere = spec.filterConjunction === "or" ? or(...filterChunks) : and(...filterChunks);
  }

  let searchWhere: SQL | undefined;
  const search = spec.search?.trim();
  if (search) {
    const pattern = "%" + search + "%";
    const searchChunks: SQL[] = [];
    for (const f of fields) {
      if (TEXT_SEARCH_TYPES.has(f.fieldType)) {
        searchChunks.push(sql`${textExpr(f.fieldKey)} ILIKE ${pattern}`);
      } else if (f.fieldType === "relation" || f.fieldType === "lookup") {
        // Search the LINKED record's projected value (e.g. "Номер заказа",
        // "Проект"). Only fields with resolved relation metadata participate —
        // a hidden relation field is never in the map, so it stays unsearchable.
        const m = relationMeta.get(f.fieldKey);
        if (m) searchChunks.push(relationValueExists(m, (v) => sql`${v} ILIKE ${pattern}`));
      }
    }
    searchWhere = searchChunks.length === 0 ? sql`false` : or(...searchChunks);
  }

  let statusWhere: SQL | undefined;
  const statusIds = (spec.statusIds ?? []).filter((n) => Number.isInteger(n));
  if (statusIds.length > 0) {
    statusWhere = inArray(entityRecordsTable.statusId, statusIds);
  }

  const whereParts = [filterWhere, searchWhere, statusWhere].filter((p): p is SQL => p !== undefined);
  const where = whereParts.length > 0 ? and(...whereParts) : undefined;

  const orderBy: SQL[] = [];
  for (const s of spec.sorts ?? []) {
    if (s.field === SYSTEM_SORT_CREATED_AT) {
      orderBy.push(s.direction === "desc" ? desc(entityRecordsTable.createdAt) : asc(entityRecordsTable.createdAt));
      continue;
    }
    if (s.field === SYSTEM_SORT_RECORD_ID) {
      orderBy.push(s.direction === "desc" ? desc(entityRecordsTable.id) : asc(entityRecordsTable.id));
      continue;
    }
    const field = fieldByKey.get(s.field);
    if (!field) return { error: `Unknown sort field: ${s.field}` };
    let expr: SQL = textExpr(s.field);
    if (NUMERIC_TYPES.has(field.fieldType)) expr = sql`(${textExpr(s.field)})::numeric`;
    else if (DATE_TYPES.has(field.fieldType)) expr = sql`(${textExpr(s.field)})::timestamptz`;
    orderBy.push(s.direction === "desc" ? desc(expr) : asc(expr));
  }
  if (orderBy.length === 0) {
    orderBy.push(desc(entityRecordsTable.createdAt));
  }

  return { where, orderBy };
}
