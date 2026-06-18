// Shared pivot (Сводная таблица) cross-tab compute core.
//
// Extracted so BOTH the permission-scoped records pivot endpoint and the
// admin-authoritative dashboard pivot widget run the EXACT same aggregation,
// label resolution, sorting and totals. The ONLY differences live in the
// caller:
//   - which `entityFields` / `pageFields` are passed (the viewer's visible set
//     vs. all active fields for an admin-authoritative widget), and
//   - the `where` boundary (own-row/hidden-status/page-local filters for the
//     records endpoint vs. entity + non-archived + statusIds for the widget).
// The per-field/per-entity `pivotEnabled` opt-in is enforced here in both modes
// so a non-pivot field can never become a dimension or measure.
import {
  db,
  entityRecordsTable,
  entityStatusesTable,
  usersTable,
  type EntityField,
} from "@workspace/db";
import { eq, sql, inArray, type SQL } from "drizzle-orm";
import { evaluateFormula } from "@workspace/formula";
import { relationValueScalar, pageLocalValueExpr, type RelationFilterMeta } from "./record-query";

export const PIVOT_DIM_TYPES = new Set([
  "text",
  "textarea",
  "select",
  "number",
  "date",
  "datetime",
  "boolean",
  "email",
  "url",
  "phone",
  "user",
]);
const PIVOT_DATE_TYPES = new Set(["date", "datetime"]);
const PIVOT_PERIOD_UNITS = new Set(["year", "quarter", "month", "day"]);
const PIVOT_NUMERIC_RE = "^-?[0-9]+(\\.[0-9]+)?$";
export const PIVOT_COL_ALL = "__all__";

export function pivotMLName(nameJson: unknown): string {
  const n = (nameJson ?? {}) as Record<string, string>;
  return n.ru || n.en || n.he || "";
}
export function pivotRound(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

export interface PivotDimInput {
  source: string;
  fieldKey?: string | null;
  datePeriod?: string | null;
}
export interface PivotMeasureInput {
  agg: string;
  source?: string | null;
  fieldKey?: string | null;
  /** For agg=formula: per-record expression (function-field syntax), summed. */
  formula?: string | null;
  /** For agg=formula: optional multilingual display name (single-column header). */
  formulaName?: unknown;
}
export interface PivotConfigInput {
  rows: PivotDimInput;
  cols?: PivotDimInput | null;
  measure: PivotMeasureInput;
}

/** Minimal shape of a page-local field needed for pivot dim/measure resolution. */
export interface PivotPageField {
  fieldKey: string;
  pivotEnabled: boolean | null;
  fieldType: string;
  nameJson: unknown;
}

export interface PivotComputeInput {
  entityId: number;
  pivot: PivotConfigInput;
  /** Entity fields to resolve entity dims/measures against (viewer-visible or all-active). */
  entityFields: EntityField[];
  relationMeta: Map<string, RelationFilterMeta>;
  /** Page-local fields available as dims/measures (empty for admin widget mode). */
  pageFields?: PivotPageField[];
  /** Required when any dim/measure has source = page. */
  pageId?: number;
  /** Fully-built read/scope boundary WHERE for the entity_records query. */
  where: SQL;
}

export interface PivotResultShape {
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  cells: { rowKey: string; colKey: string; value: number }[];
  rowTotals: { key: string; value: number }[];
  colTotals: { key: string; value: number }[];
  grandTotal: number;
  measureLabel: string;
}

export type PivotComputeOutcome =
  | { ok: true; result: PivotResultShape }
  | { ok: false; error: string };

type DimMeta =
  | { kind: "status" }
  | { kind: "plain"; expr: SQL }
  | { kind: "user"; expr: SQL }
  | { kind: "date"; expr: SQL; period: string };

/**
 * Compute a pivot cross-tab over entity_records. Caller is responsible for the
 * entity existence / pivotEnabled check and for building `where` (the read
 * boundary). Returns a discriminated result so callers can map errors to 400.
 */
export async function computePivot(input: PivotComputeInput): Promise<PivotComputeOutcome> {
  const { entityId, pivot, entityFields, relationMeta, pageId, where } = input;
  const entFieldByKey = new Map(entityFields.map((f) => [f.fieldKey, f]));
  const pageFieldByKey = new Map((input.pageFields ?? []).map((pf) => [pf.fieldKey, pf] as const));

  const needPage =
    pivot.rows.source === "page" ||
    pivot.cols?.source === "page" ||
    (pivot.measure.agg === "sum" && pivot.measure.source === "page");
  if (needPage && pageId == null) {
    return { ok: false, error: "pageId is required for page-local pivot dimensions/measures" };
  }

  const resolveDim = (dim: PivotDimInput): DimMeta | { error: string } => {
    if (dim.source === "status") return { kind: "status" };
    const key = dim.fieldKey ?? "";
    if (!key) return { error: "Pivot dimension requires fieldKey" };
    let ftype: string;
    let ve: SQL;
    if (dim.source === "entity") {
      const f = entFieldByKey.get(key);
      if (!f) return { error: `Unknown or hidden pivot field: ${key}` };
      if (!f.pivotEnabled) return { error: `Field is not enabled for pivot: ${key}` };
      // relation/lookup: group by the linked record's projected value. Only
      // single-link relations have a meta entry; multi-link can't be a scalar dim.
      if (f.fieldType === "relation" || f.fieldType === "lookup") {
        const rmeta = relationMeta.get(key);
        if (!rmeta)
          return { error: `Поле «${key}» нельзя использовать как измерение сводной таблицы (множественная связь)` };
        return { kind: "plain", expr: relationValueScalar(rmeta) };
      }
      if (!PIVOT_DIM_TYPES.has(f.fieldType))
        return { error: `Field type cannot be a pivot dimension: ${key}` };
      ftype = f.fieldType;
      ve = sql`(${entityRecordsTable.valuesJson} ->> ${key})`;
    } else if (dim.source === "page") {
      const pf = pageFieldByKey.get(key);
      if (!pf) return { error: `Unknown or hidden page pivot field: ${key}` };
      if (!pf.pivotEnabled) return { error: `Page field is not enabled for pivot: ${key}` };
      // Page-local relation/lookup values aren't stored in page_record_values
      // (they project through links), so they can't be a page pivot dim here.
      if (pf.fieldType === "relation" || pf.fieldType === "lookup")
        return { error: `Связанные поля страницы пока не поддерживаются как измерение сводной таблицы: ${key}` };
      if (!PIVOT_DIM_TYPES.has(pf.fieldType))
        return { error: `Page field type cannot be a pivot dimension: ${key}` };
      ftype = pf.fieldType;
      ve = pageLocalValueExpr(pageId!, key);
    } else {
      return { error: `Invalid pivot dimension source: ${dim.source}` };
    }
    // user dim: value is a scalar user id; labels resolved to names post-query.
    if (ftype === "user") return { kind: "user", expr: ve };
    if (PIVOT_DATE_TYPES.has(ftype) && dim.datePeriod) {
      if (!PIVOT_PERIOD_UNITS.has(dim.datePeriod))
        return { error: `Invalid date period: ${dim.datePeriod}` };
      const period = dim.datePeriod;
      // Guard the cast: only ISO-prefixed values are truncated; anything else
      // (empty/garbage) collapses to NULL instead of throwing on ::timestamptz.
      const expr = sql`CASE WHEN (${ve}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN to_char(date_trunc(${period}, (${ve})::timestamptz), 'YYYY-MM-DD') ELSE NULL END`;
      return { kind: "date", expr, period };
    }
    return { kind: "plain", expr: ve };
  };

  // A measure is either resolved to a SQL aggregate (count / sum-of-field) that
  // GROUP BYs in Postgres, or to a per-record `formula` expression evaluated in
  // JS (SQL can't run the formula language) and summed into each cell.
  type MeasurePlan =
    | { kind: "sql"; expr: SQL; label: string }
    | { kind: "formula"; expr: string; label: string; allowedKeys: string[] };
  const resolveMeasure = (): MeasurePlan | { error: string } => {
    if (pivot.measure.agg === "count") {
      return { kind: "sql", expr: sql`count(*)::float8`, label: "Количество" };
    }
    if (pivot.measure.agg === "formula") {
      const expr = (pivot.measure.formula ?? "").trim();
      if (!expr) return { error: "Formula measure requires a formula expression" };
      // Validate syntax once. Missing field refs resolve to null (they don't
      // throw), so an empty value map only surfaces parse / unknown-function
      // errors here — not "field not provided" false positives.
      try {
        evaluateFormula(expr, {});
      } catch (e) {
        return { error: `Некорректная формула: ${e instanceof Error ? e.message : String(e)}` };
      }
      // Only pivot-enabled, viewer-visible entity fields may feed the formula.
      // `entityFields` is already the viewer's visible set (or all-active for the
      // admin widget); restricting the per-record value map to these keys keeps
      // hidden / non-opted field values out of the expression — a hard field
      // boundary, NOT a cosmetic filter (a crafted formula cannot leak them).
      const allowedKeys = entityFields.filter((f) => f.pivotEnabled).map((f) => f.fieldKey);
      // A formula has no field name of its own, so an admin-supplied multilingual
      // name (if any) becomes the single-column header; else fall back to "Формула".
      const label = pivotMLName(pivot.measure.formulaName) || "Формула";
      return { kind: "formula", expr, label, allowedKeys };
    }
    const src = pivot.measure.source;
    const key = pivot.measure.fieldKey ?? "";
    if ((src !== "entity" && src !== "page") || !key)
      return { error: "Sum measure requires source (entity|page) and fieldKey" };
    let ve: SQL;
    let label: string;
    if (src === "entity") {
      const f = entFieldByKey.get(key);
      if (!f) return { error: `Unknown or hidden measure field: ${key}` };
      if (!f.pivotEnabled) return { error: `Field is not enabled for pivot: ${key}` };
      if (f.fieldType !== "number") return { error: `Measure field must be numeric: ${key}` };
      ve = sql`(${entityRecordsTable.valuesJson} ->> ${key})`;
      label = pivotMLName(f.nameJson);
    } else {
      const pf = pageFieldByKey.get(key);
      if (!pf) return { error: `Unknown or hidden page measure field: ${key}` };
      if (!pf.pivotEnabled) return { error: `Page field is not enabled for pivot: ${key}` };
      if (pf.fieldType !== "number") return { error: `Measure field must be numeric: ${key}` };
      ve = pageLocalValueExpr(pageId!, key);
      label = pivotMLName(pf.nameJson);
    }
    return {
      kind: "sql",
      expr: sql`COALESCE(SUM(CASE WHEN (${ve}) ~ ${PIVOT_NUMERIC_RE} THEN (${ve})::numeric ELSE 0 END), 0)::float8`,
      label,
    };
  };

  const rowMeta = resolveDim(pivot.rows);
  if ("error" in rowMeta) return { ok: false, error: rowMeta.error };
  const colMeta = pivot.cols ? resolveDim(pivot.cols) : null;
  if (colMeta && "error" in colMeta) return { ok: false, error: colMeta.error };
  const measure = resolveMeasure();
  if ("error" in measure) return { ok: false, error: measure.error };

  // ---- Aggregation ----
  const rowKeyExpr = rowMeta.kind === "status" ? sql`${entityRecordsTable.statusId}::text` : rowMeta.expr;
  const colKeyExpr = !colMeta
    ? null
    : colMeta.kind === "status"
      ? sql`${entityRecordsTable.statusId}::text`
      : colMeta.expr;

  let grouped: { rk: string | null; ck: string | null; v: number }[];
  if (measure.kind === "formula") {
    // SQL can't compute the formula language, so pull per-record keys + the raw
    // values map (NO GROUP BY), evaluate in JS against the allowed-key-scoped
    // values, and emit one {rk,ck,v} per record. The shared loop below then
    // sums duplicates per (row,col) exactly like the SQL path.
    const allowed = measure.allowedKeys;
    const raw = await db
      .select({
        rk: sql<string | null>`${rowKeyExpr}`,
        ck: colKeyExpr ? sql<string | null>`${colKeyExpr}` : sql<string>`${PIVOT_COL_ALL}`,
        vals: entityRecordsTable.valuesJson,
      })
      .from(entityRecordsTable)
      .where(where);
    grouped = raw.map((r) => {
      const src = (r.vals ?? {}) as Record<string, unknown>;
      const scoped: Record<string, unknown> = {};
      for (const k of allowed) scoped[k] = src[k];
      let v = 0;
      try {
        const res = evaluateFormula(measure.expr, scoped);
        if (typeof res === "number" && Number.isFinite(res)) v = res;
      } catch {
        v = 0;
      }
      return { rk: r.rk, ck: r.ck, v };
    });
  } else {
    grouped = await db
      .select({
        rk: sql<string | null>`${rowKeyExpr}`,
        ck: colKeyExpr ? sql<string | null>`${colKeyExpr}` : sql<string>`${PIVOT_COL_ALL}`,
        v: sql<number>`${measure.expr}`,
      })
      .from(entityRecordsTable)
      .where(where)
      // Group by SELECT output ordinals (1 = row key, 2 = col key), NOT by
      // re-embedding rowKeyExpr/colKeyExpr. Re-embedding the same sql fragment
      // re-binds its placeholders ($1 in SELECT vs $10 in GROUP BY), so Postgres
      // sees two different expressions and rejects the non-aggregated column.
      .groupBy(...(colKeyExpr ? [sql`1`, sql`2`] : [sql`1`]));
  }

  // ---- Label resolution ----
  const statusName = new Map<number, string>();
  const statusOrder = new Map<number, number>();
  if (rowMeta.kind === "status" || colMeta?.kind === "status") {
    const sts = await db
      .select()
      .from(entityStatusesTable)
      .where(eq(entityStatusesTable.entityId, entityId));
    for (const s of sts) {
      statusName.set(s.id, pivotMLName(s.nameJson) || s.statusKey);
      statusOrder.set(s.id, s.sortOrder);
    }
  }

  const formatPeriod = (iso: string, period: string): string => {
    const [y, m] = iso.split("-");
    if (period === "year") return y;
    if (period === "quarter") return `${y} Q${Math.floor((Number(m) - 1) / 3) + 1}`;
    if (period === "month") return `${y}-${m}`;
    return iso;
  };
  // user dims store a scalar user id; resolve ids → display names (populated
  // after the key sets are known). Falls back to the raw id if not found.
  const userName = new Map<string, string>();
  const labelFor = (meta: DimMeta, key: string): string => {
    if (key === "") return meta.kind === "status" ? "(без статуса)" : "(пусто)";
    if (meta.kind === "status") return statusName.get(Number(key)) ?? key;
    if (meta.kind === "user") return userName.get(key) ?? key;
    if (meta.kind === "date") return formatPeriod(key, meta.period);
    return key;
  };
  const sortKeys = (keys: string[], meta: DimMeta): string[] =>
    keys.sort((a, b) => {
      if (a === "" && b === "") return 0;
      if (a === "") return 1;
      if (b === "") return -1;
      if (meta.kind === "status") return (statusOrder.get(Number(a)) ?? 0) - (statusOrder.get(Number(b)) ?? 0);
      if (meta.kind === "date") return a < b ? -1 : a > b ? 1 : 0;
      if (meta.kind === "user")
        return (userName.get(a) ?? a).localeCompare(userName.get(b) ?? b, undefined, { numeric: true });
      return a.localeCompare(b, undefined, { numeric: true });
    });

  const rowKeySet = new Set<string>();
  const colKeySet = new Set<string>();
  const cellMap = new Map<string, number>();
  for (const g of grouped) {
    const rk = g.rk == null ? "" : String(g.rk);
    const ck = g.ck == null ? "" : String(g.ck);
    rowKeySet.add(rk);
    colKeySet.add(ck);
    const ck2 = rk + "\u0000" + ck;
    cellMap.set(ck2, (cellMap.get(ck2) ?? 0) + Number(g.v ?? 0));
  }

  if (rowMeta.kind === "user" || colMeta?.kind === "user") {
    const ids = new Set<number>();
    const collect = (keys: Iterable<string>) => {
      for (const k of keys) {
        const n = Number(k);
        if (k !== "" && Number.isInteger(n)) ids.add(n);
      }
    };
    if (rowMeta.kind === "user") collect(rowKeySet);
    if (colMeta?.kind === "user") collect(colKeySet);
    if (ids.size > 0) {
      const urows = await db
        .select({
          id: usersTable.id,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          email: usersTable.email,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, [...ids]));
      for (const u of urows) {
        const nm = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
        userName.set(String(u.id), nm);
      }
    }
  }

  const rowKeys = sortKeys([...rowKeySet], rowMeta);
  const colKeys = colMeta ? sortKeys([...colKeySet], colMeta) : [PIVOT_COL_ALL];

  const cells: { rowKey: string; colKey: string; value: number }[] = [];
  const rowTotals: { key: string; value: number }[] = [];
  const colTotal = new Map<string, number>();
  let grandTotal = 0;
  for (const rk of rowKeys) {
    let rt = 0;
    for (const ck of colKeys) {
      const v = cellMap.get(rk + "\u0000" + ck) ?? 0;
      if (v !== 0) cells.push({ rowKey: rk, colKey: ck, value: pivotRound(v) });
      rt += v;
      colTotal.set(ck, (colTotal.get(ck) ?? 0) + v);
    }
    rowTotals.push({ key: rk, value: pivotRound(rt) });
    grandTotal += rt;
  }

  return {
    ok: true,
    result: {
      rows: rowKeys.map((k) => ({ key: k, label: labelFor(rowMeta, k) })),
      cols: colMeta
        ? colKeys.map((k) => ({ key: k, label: labelFor(colMeta, k) }))
        : [{ key: PIVOT_COL_ALL, label: measure.label }],
      cells,
      rowTotals,
      colTotals: colKeys.map((k) => ({ key: k, value: pivotRound(colTotal.get(k) ?? 0) })),
      grandTotal: pivotRound(grandTotal),
      measureLabel: measure.label,
    },
  };
}
