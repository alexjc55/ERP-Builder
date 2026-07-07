// Per-entity CUSTOM FILTERS — apply engine (shared by records/query, which also
// backs the calendar, and the pivot compute route).
//
// A custom filter is an ADMIN-AUTHORED two-level boolean tree over ANY field of
// the entity (or a mirror page's page-local field), INCLUDING formula fields.
// The client only picks WHICH filters are active and supplies any runtime input
// values; the field keys / operators / structure live authoritatively in the
// `custom_filters` row. Because the predicate is admin-authored it may reference
// fields hidden for the viewer — the returned ROWS still obey the viewer's
// row/field boundary via the OTHER query clauses; a custom filter only ever
// NARROWS the visible set.
//
// Two evaluation strategies keep pagination/grouping/totals untouched:
//   - SQL path (default): the whole filter compiles to ONE nested SQL predicate
//     that is AND-ed into the caller's WHERE.
//   - JS path (only when a filter references a FORMULA field, whose value is
//     never stored): the filter is evaluated in JS over every entity record to
//     produce a matching record-id set, added as `id IN (...)`. This is the only
//     way to compare a computed formula result, and it still composes with the
//     surrounding SQL boundary.
import {
  db,
  entityRecordsTable,
  customFiltersTable,
  pageRecordValuesTable,
  entityFieldsTable,
  pageFieldsTable,
  type EntityField,
  type CustomFilter,
  type CustomFilterGroup,
  type CustomFilterCondition,
  type CustomFilterOperator,
  type CustomFilterInput,
  type CustomFilterInputType,
} from "@workspace/db";
import { and, or, eq, inArray, sql, type SQL } from "drizzle-orm";
import { buildFormulaScope, evaluateFormula, type FormulaFieldDef } from "@workspace/formula";
import {
  buildCondition,
  buildPageLocalCondition,
  buildRelationCondition,
  relationValueScalar,
  type FilterCondition,
  type FilterOperator,
  type RelationFilterMeta,
} from "./record-query";
import { buildRelationMeta } from "./own-scope";

/** Runtime pick sent by the client: which filter + any user-supplied input values. */
export interface CustomFilterPick {
  id: number;
  inputs?: { inputId: string; value: unknown }[];
}

const NUMERIC_TYPES = new Set(["number", "percent"]);
const DATE_TYPES = new Set(["date", "datetime"]);

/** custom operator → the FilterOperator the SQL/JS comparators understand. */
const OP_MAP: Record<CustomFilterOperator, FilterOperator> = {
  eq: "eq",
  neq: "neq",
  contains: "contains",
  notContains: "not_contains",
  gt: "gt",
  lt: "lt",
  gte: "gte",
  lte: "lte",
  between: "between",
  empty: "is_empty",
  notEmpty: "is_not_empty",
};

const NEEDS_NO_VALUE = new Set<CustomFilterOperator>(["empty", "notEmpty"]);

interface ApplyOpts {
  entityId: number;
  /** ALL active entity fields (admin-authoritative — includes fields hidden for the viewer). */
  allFields: EntityField[];
  /** Relation meta for the viewer's visible relation fields (extended internally to all). */
  relationMeta: Map<string, RelationFilterMeta>;
  picks: CustomFilterPick[];
  /** Page context — required only when a condition targets a page-local field. */
  pageId?: number;
}

const toFormulaDef = (f: { fieldKey: string; formulaConfigJson: unknown }): FormulaFieldDef => {
  const cfg = f.formulaConfigJson as { expression?: string; decimals?: number | null } | null;
  return { key: f.fieldKey, expression: cfg?.expression ?? "", decimals: cfg?.decimals ?? null };
};

/**
 * Resolve the picked custom filters into SQL clauses to AND into the caller's
 * query WHERE. Returns `{ clauses }` (possibly empty) or `{ error }` for a 400.
 */
export async function resolveCustomFilterClauses(
  opts: ApplyOpts,
): Promise<{ clauses: SQL[] } | { error: string }> {
  const { entityId, allFields, picks, pageId } = opts;
  if (!picks || picks.length === 0) return { clauses: [] };

  const ids = [...new Set(picks.map((p) => p.id))];
  const defs = await db
    .select()
    .from(customFiltersTable)
    .where(and(eq(customFiltersTable.entityId, entityId), inArray(customFiltersTable.id, ids)));
  const defById = new Map(defs.map((d) => [d.id, d] as const));

  const entFieldByKey = new Map(allFields.map((f) => [f.fieldKey, f] as const));
  const entityFormulaDefs = allFields.filter((f) => f.fieldType === "function").map(toFormulaDef);
  // Relation meta over ALL fields (not just the viewer's visible set), so an
  // admin-authored condition on a hidden relation field still resolves.
  const relationMeta = await buildRelationMeta(entityId, allFields);

  // Lazily-loaded page-field type maps + page value maps, keyed by pageId.
  const pageFieldsByPage = new Map<number, Map<string, { fieldType: string; formulaConfigJson: unknown }>>();
  const loadPageFields = async (pid: number) => {
    if (pageFieldsByPage.has(pid)) return pageFieldsByPage.get(pid)!;
    const rows = await db
      .select()
      .from(pageFieldsTable)
      .where(and(eq(pageFieldsTable.pageId, pid), eq(pageFieldsTable.isActive, true)));
    const m = new Map(rows.map((r) => [r.fieldKey, { fieldType: r.fieldType, formulaConfigJson: r.formulaConfigJson }] as const));
    pageFieldsByPage.set(pid, m);
    return m;
  };

  const clauses: SQL[] = [];

  for (const pick of picks) {
    const def = defById.get(pick.id);
    if (!def) return { error: `Неизвестный кастомный фильтр: ${pick.id}` };
    if (!def.isActive) continue;
    const groups = (def.groupsJson ?? []) as CustomFilterGroup[];
    if (groups.length === 0) continue;

    // Runtime input values keyed by inputId. A referenced input with no value
    // means the chip has not been filled in yet → the whole filter is inactive.
    const inputValues = new Map<string, unknown>();
    for (const inp of pick.inputs ?? []) inputValues.set(inp.inputId, inp.value);

    // Declared input types (source of truth on the filter row), used to decide
    // whether a supplied runtime value is USABLE. A missing/partial/malformed
    // value deterministically deactivates the filter instead of reaching SQL.
    const inputTypeById = new Map<string, CustomFilterInputType>();
    for (const inp of (def.inputsJson ?? []) as CustomFilterInput[]) inputTypeById.set(inp.id, inp.type);

    // Does this filter reference any formula field (entity or page)? If so it
    // must be evaluated in JS (a formula value is never stored in SQL).
    let usesFormula = false;
    let inputMissing = false;
    // Pre-flight: validate every condition can be resolved, detect formula use
    // and missing runtime inputs BEFORE building anything.
    for (const g of groups) {
      for (const c of g.conditions) {
        const src = c.fieldSource ?? "entity";
        let ftype: string | undefined;
        if (src === "entity") {
          ftype = entFieldByKey.get(c.fieldKey)?.fieldType;
        } else {
          if (pageId == null) return { error: "Кастомный фильтр по полю страницы требует контекст страницы" };
          const pm = await loadPageFields(c.pageId ?? pageId);
          ftype = pm.get(c.fieldKey)?.fieldType;
        }
        if (ftype === "function") usesFormula = true;
        // Resolve the effective value; skip whole filter if an input is unfilled
        // OR the supplied value is malformed/partial for its declared type.
        if (!NEEDS_NO_VALUE.has(c.operator) && (c.valueSource ?? "static") === "input") {
          const v = c.inputId != null ? inputValues.get(c.inputId) : undefined;
          const t = c.inputId != null ? inputTypeById.get(c.inputId) : undefined;
          if (!inputValueUsable(t, v)) inputMissing = true;
        }
      }
    }
    if (inputMissing) continue;

    const resolveValue = (c: CustomFilterCondition): unknown => {
      if ((c.valueSource ?? "static") === "input") {
        return c.inputId != null ? inputValues.get(c.inputId) : undefined;
      }
      return c.value;
    };

    if (!usesFormula) {
      // ---- SQL path: compile the whole tree to one nested predicate ----
      const built = buildSqlTree(def, groups, resolveValue, {
        entFieldByKey,
        relationMeta,
        loadPageFields,
        pageId,
      });
      const r = await built;
      if ("error" in r) return { error: r.error };
      if (r.sql) clauses.push(r.sql);
    } else {
      // ---- JS path: compute matching record ids over all entity records ----
      const r = await buildFormulaIdSet(def, groups, resolveValue, {
        entityId,
        allFields,
        entFieldByKey,
        entityFormulaDefs,
        relationMeta,
        loadPageFields,
        pageId,
      });
      if ("error" in r) return { error: r.error };
      clauses.push(r.ids.length > 0 ? inArray(entityRecordsTable.id, r.ids) : sql`false`);
    }
  }

  return { clauses };
}

// ── SQL path ────────────────────────────────────────────────────────────────

interface SqlCtx {
  entFieldByKey: Map<string, EntityField>;
  relationMeta: Map<string, RelationFilterMeta>;
  loadPageFields: (pid: number) => Promise<Map<string, { fieldType: string; formulaConfigJson: unknown }>>;
  pageId?: number;
}

/** Normalize a resolved value into the FilterCondition shape buildCondition expects. */
function toFilterCondition(c: CustomFilterCondition, value: unknown): FilterCondition {
  const operator = OP_MAP[c.operator];
  let v: unknown = value;
  if (operator === "between") {
    // Accept {from,to} or [from,to]; produce [from,to].
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as { from?: unknown; to?: unknown };
      v = [o.from, o.to];
    }
  }
  return { field: c.fieldKey, operator, value: v };
}

async function buildSqlCondition(
  c: CustomFilterCondition,
  value: unknown,
  ctx: SqlCtx,
): Promise<{ sql: SQL } | { error: string }> {
  const src = c.fieldSource ?? "entity";
  const fc = toFilterCondition(c, value);
  if (src === "page") {
    const pid = c.pageId ?? ctx.pageId;
    if (pid == null) return { error: "Кастомный фильтр по полю страницы требует контекст страницы" };
    const pm = await ctx.loadPageFields(pid);
    const pf = pm.get(c.fieldKey);
    if (!pf) return { error: `Неизвестное поле страницы: ${c.fieldKey}` };
    return buildPageLocalCondition(fc, pf.fieldType, pid);
  }
  const f = ctx.entFieldByKey.get(c.fieldKey);
  if (!f) return { error: `Неизвестное поле: ${c.fieldKey}` };
  const rmeta = ctx.relationMeta.get(c.fieldKey);
  if (rmeta) return buildRelationCondition(fc, rmeta);
  return buildCondition(fc, f.fieldType);
}

async function buildSqlTree(
  def: CustomFilter,
  groups: CustomFilterGroup[],
  resolveValue: (c: CustomFilterCondition) => unknown,
  ctx: SqlCtx,
): Promise<{ sql: SQL | null } | { error: string }> {
  const groupSqls: SQL[] = [];
  for (const g of groups) {
    const parts: SQL[] = [];
    for (const c of g.conditions) {
      const r = await buildSqlCondition(c, resolveValue(c), ctx);
      if ("error" in r) return { error: r.error };
      parts.push(r.sql);
    }
    if (parts.length === 0) continue;
    const combined = (g.conjunction ?? "and") === "or" ? or(...parts) : and(...parts);
    if (combined) groupSqls.push(combined);
  }
  if (groupSqls.length === 0) return { sql: null };
  const top = (def.conjunction ?? "and") === "or" ? or(...groupSqls) : and(...groupSqls);
  return { sql: top ?? null };
}

// ── JS (formula) path ─────────────────────────────────────────────────────────

interface JsCtx {
  entityId: number;
  allFields: EntityField[];
  entFieldByKey: Map<string, EntityField>;
  entityFormulaDefs: FormulaFieldDef[];
  relationMeta: Map<string, RelationFilterMeta>;
  loadPageFields: (pid: number) => Promise<Map<string, { fieldType: string; formulaConfigJson: unknown }>>;
  pageId?: number;
}

/** Compute the set of record ids matching a (formula-referencing) filter tree. */
async function buildFormulaIdSet(
  def: CustomFilter,
  groups: CustomFilterGroup[],
  resolveValue: (c: CustomFilterCondition) => unknown,
  ctx: JsCtx,
): Promise<{ ids: number[] } | { error: string }> {
  const rows = await db
    .select({ id: entityRecordsTable.id, vals: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.entityId, ctx.entityId));

  // Pre-load relation-projected values per referenced relation field: recordId → value.
  const relValsByField = new Map<string, Map<number, string | null>>();
  // Pre-load page-local value maps per referenced pageId: recordId → valuesJson.
  const pageValsByPage = new Map<number, Map<number, Record<string, unknown>>>();

  // Per-page field-type meta + page-local formula defs, so a page-local condition
  // resolves its comparison kind and computes page-local FORMULA values in JS.
  const pageMetaByPage = new Map<number, Map<string, { fieldType: string; formulaConfigJson: unknown }>>();
  const pageFormulaDefsByPage = new Map<number, FormulaFieldDef[]>();

  const refRelationKeys = new Set<string>();
  const refPageIds = new Set<number>();
  for (const g of groups) {
    for (const c of g.conditions) {
      const src = c.fieldSource ?? "entity";
      if (src === "page") refPageIds.add(c.pageId ?? ctx.pageId!);
      else if (ctx.relationMeta.has(c.fieldKey)) refRelationKeys.add(c.fieldKey);
    }
  }

  for (const key of refRelationKeys) {
    const meta = ctx.relationMeta.get(key)!;
    const vrows = await db
      .select({ id: entityRecordsTable.id, v: sql<string | null>`${relationValueScalar(meta)}` })
      .from(entityRecordsTable)
      .where(eq(entityRecordsTable.entityId, ctx.entityId));
    relValsByField.set(key, new Map(vrows.map((r) => [r.id, r.v] as const)));
  }
  for (const pid of refPageIds) {
    const prows = await db
      .select({ recordId: pageRecordValuesTable.recordId, vals: pageRecordValuesTable.valuesJson })
      .from(pageRecordValuesTable)
      .where(eq(pageRecordValuesTable.pageId, pid));
    pageValsByPage.set(pid, new Map(prows.map((r) => [r.recordId, (r.vals ?? {}) as Record<string, unknown>] as const)));

    const pm = await ctx.loadPageFields(pid);
    pageMetaByPage.set(pid, pm);
    const fdefs: FormulaFieldDef[] = [];
    for (const [key, meta] of pm) {
      if (meta.fieldType === "function") fdefs.push(toFormulaDef({ fieldKey: key, formulaConfigJson: meta.formulaConfigJson }));
    }
    pageFormulaDefsByPage.set(pid, fdefs);
  }

  const ids: number[] = [];
  for (const row of rows) {
    const vals = (row.vals ?? {}) as Record<string, unknown>;
    const scope = buildFormulaScope(vals, ctx.entityFormulaDefs);
    const groupResults: boolean[] = [];
    for (const g of groups) {
      const parts: boolean[] = [];
      for (const c of g.conditions) {
        parts.push(evalConditionJs(c, resolveValue(c), row.id, vals, scope, relValsByField, pageValsByPage, pageMetaByPage, pageFormulaDefsByPage, ctx));
      }
      const gres =
        parts.length === 0
          ? true
          : (g.conjunction ?? "and") === "or"
            ? parts.some(Boolean)
            : parts.every(Boolean);
      groupResults.push(gres);
    }
    const match =
      groupResults.length === 0
        ? false
        : (def.conjunction ?? "and") === "or"
          ? groupResults.some(Boolean)
          : groupResults.every(Boolean);
    if (match) ids.push(row.id);
  }
  return { ids };
}

/** Evaluate one condition for one record in JS, mirroring buildCondition semantics. */
function evalConditionJs(
  c: CustomFilterCondition,
  rawValue: unknown,
  recordId: number,
  vals: Record<string, unknown>,
  scope: Record<string, unknown>,
  relValsByField: Map<string, Map<number, string | null>>,
  pageValsByPage: Map<number, Map<number, Record<string, unknown>>>,
  pageMetaByPage: Map<number, Map<string, { fieldType: string; formulaConfigJson: unknown }>>,
  pageFormulaDefsByPage: Map<number, FormulaFieldDef[]>,
  ctx: JsCtx,
): boolean {
  const src = c.fieldSource ?? "entity";
  // Resolve the cell value + its comparison kind.
  let cell: unknown;
  let kind: "numeric" | "date" | "text";
  if (src === "page") {
    const pid = c.pageId ?? ctx.pageId!;
    const pv = pageValsByPage.get(pid)?.get(recordId) ?? {};
    const pf = pageMetaByPage.get(pid)?.get(c.fieldKey);
    if (pf?.fieldType === "function") {
      // Page-local FORMULA: compute the value from the page-local scope.
      const pscope = buildFormulaScope(pv, pageFormulaDefsByPage.get(pid) ?? []);
      cell = pscope[c.fieldKey];
      kind = typeof cell === "number" ? "numeric" : "text";
    } else {
      cell = pv[c.fieldKey];
      kind = pf && NUMERIC_TYPES.has(pf.fieldType) ? "numeric" : pf && DATE_TYPES.has(pf.fieldType) ? "date" : "text";
    }
  } else {
    const f = ctx.entFieldByKey.get(c.fieldKey);
    if (f?.fieldType === "function") {
      try {
        cell = scope[c.fieldKey];
      } catch {
        cell = null;
      }
      kind = typeof cell === "number" ? "numeric" : "text";
    } else if (ctx.relationMeta.has(c.fieldKey)) {
      cell = relValsByField.get(c.fieldKey)?.get(recordId) ?? null;
      kind = "text";
    } else {
      cell = vals[c.fieldKey];
      kind = f && NUMERIC_TYPES.has(f.fieldType) ? "numeric" : f && DATE_TYPES.has(f.fieldType) ? "date" : "text";
    }
  }
  return applyOperatorJs(c.operator, kind, cell, rawValue);
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Coerce a range-ish value into {from,to}, accepting {from,to} objects or [from,to] pairs. */
function asRange(v: unknown): { from: unknown; to: unknown } | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as { from?: unknown; to?: unknown };
    return { from: o.from, to: o.to };
  }
  if (Array.isArray(v)) return { from: v[0], to: v[1] };
  return null;
}

/**
 * Whether a supplied runtime input value is USABLE for its declared type.
 * Unfilled, partial (one side of a range) or malformed values return false so
 * the caller deactivates the whole filter deterministically — never letting a
 * bad value reach a SQL cast (which would 500).
 */
function inputValueUsable(type: CustomFilterInputType | undefined, v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  switch (type) {
    case "number":
      return !Number.isNaN(Number(v));
    case "date":
    case "datetime":
      return !Number.isNaN(Date.parse(String(v)));
    case "numberRange": {
      const o = asRange(v);
      return !!o && !isEmpty(o.from) && !isEmpty(o.to) && !Number.isNaN(Number(o.from)) && !Number.isNaN(Number(o.to));
    }
    case "dateRange": {
      const o = asRange(v);
      return (
        !!o &&
        !isEmpty(o.from) &&
        !isEmpty(o.to) &&
        !Number.isNaN(Date.parse(String(o.from))) &&
        !Number.isNaN(Date.parse(String(o.to)))
      );
    }
    case "boolean":
      return typeof v === "boolean" || v === "true" || v === "false";
    default:
      // text / select / unknown → any non-empty scalar is compared as a string.
      return true;
  }
}

function applyOperatorJs(
  op: CustomFilterOperator,
  kind: "numeric" | "date" | "text",
  cell: unknown,
  value: unknown,
): boolean {
  if (op === "empty") return isEmpty(cell);
  if (op === "notEmpty") return !isEmpty(cell);
  if (op === "between") {
    let from: unknown;
    let to: unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      from = (value as { from?: unknown }).from;
      to = (value as { to?: unknown }).to;
    } else if (Array.isArray(value)) {
      from = value[0];
      to = value[1];
    }
    if (isEmpty(from) || isEmpty(to) || isEmpty(cell)) return false;
    if (kind === "numeric") {
      const c = Number(cell);
      return !Number.isNaN(c) && c >= Number(from) && c < Number(to);
    }
    const c = Date.parse(String(cell));
    const lo = Date.parse(String(from));
    const hi = Date.parse(String(to));
    if (Number.isNaN(c) || Number.isNaN(lo) || Number.isNaN(hi)) return false;
    return c >= lo && c < hi;
  }
  if (op === "contains") return !isEmpty(cell) && String(cell).toLowerCase().includes(String(value ?? "").toLowerCase());
  if (op === "notContains") return isEmpty(cell) || !String(cell).toLowerCase().includes(String(value ?? "").toLowerCase());

  if (isEmpty(value)) return false;
  const cmp = (a: number, b: number): boolean => {
    switch (op) {
      case "eq":
        return a === b;
      case "neq":
        return a !== b;
      case "gt":
        return a > b;
      case "gte":
        return a >= b;
      case "lt":
        return a < b;
      case "lte":
        return a <= b;
      default:
        return false;
    }
  };
  if (kind === "numeric") {
    const a = Number(cell);
    const b = Number(value);
    if (Number.isNaN(a) || Number.isNaN(b)) return op === "neq" ? String(cell) !== String(value) : false;
    return cmp(a, b);
  }
  if (kind === "date") {
    const a = Date.parse(String(cell));
    const b = Date.parse(String(value));
    if (Number.isNaN(a) || Number.isNaN(b)) return op === "neq" ? String(cell) !== String(value) : false;
    return cmp(a, b);
  }
  // text: eq/neq by string; ordering by locale compare.
  const as = String(cell ?? "");
  const bs = String(value);
  switch (op) {
    case "eq":
      return as === bs;
    case "neq":
      return as !== bs;
    case "gt":
      return as > bs;
    case "gte":
      return as >= bs;
    case "lt":
      return as < bs;
    case "lte":
      return as <= bs;
    default:
      return false;
  }
}
