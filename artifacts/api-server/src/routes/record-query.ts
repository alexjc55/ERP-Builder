import { sql, and, or, asc, desc, inArray, type SQL } from "drizzle-orm";
import { entityRecordsTable } from "@workspace/db";
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
  | "in";

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

export interface SortSpec {
  field: string;
  direction?: "asc" | "desc";
}

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

function buildCondition(cond: FilterCondition, fieldType: string): { sql: SQL } | { error: string } {
  const expr = textExpr(cond.field);
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
 * Build the WHERE and ORDER BY for a record query, validating every referenced
 * field key against the entity's active fields (whitelist). Field keys are only
 * ever passed to SQL as bound params, never interpolated as raw SQL text.
 */
export function buildRecordQuery(
  fields: EntityField[],
  spec: RecordQuerySpec,
): { where: SQL | undefined; orderBy: SQL[] } | { error: string } {
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));

  const filterChunks: SQL[] = [];
  for (const cond of spec.filters ?? []) {
    const field = fieldByKey.get(cond.field);
    if (!field) return { error: `Unknown filter field: ${cond.field}` };
    const built = buildCondition(cond, field.fieldType);
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
    const searchable = fields.filter((f) => TEXT_SEARCH_TYPES.has(f.fieldType));
    if (searchable.length === 0) {
      searchWhere = sql`false`;
    } else {
      const pattern = "%" + search + "%";
      searchWhere = or(...searchable.map((f) => sql`${textExpr(f.fieldKey)} ILIKE ${pattern}`));
    }
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
