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

// Extract `{ref}` measure references from a calc formula. The formula language
// references other measures by their colKey via `{colKey}` syntax (same `{...}`
// field-ref token the evaluator uses), so a simple scan is sufficient to check
// a calc only points at keys that exist.
const PIVOT_FORMULA_REF_RE = /\{([^}]*)\}/g;
export function pivotFormulaRefs(expr: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PIVOT_FORMULA_REF_RE.lastIndex = 0;
  while ((m = PIVOT_FORMULA_REF_RE.exec(expr)) !== null) {
    const ref = m[1].trim();
    if (ref) out.push(ref);
  }
  return out;
}

export interface PivotDimInput {
  source: string;
  fieldKey?: string | null;
  datePeriod?: string | null;
}
export interface PivotMeasureInput {
  agg: string;
  /** Stable id within a multi-measure pivot (column key + calc ref target). */
  key?: string | null;
  source?: string | null;
  fieldKey?: string | null;
  /** agg=formula: per-record expr (summed). agg=calc: per-row expr over measures. */
  formula?: string | null;
  /** Multilingual column-header override for any agg. */
  nameJson?: unknown;
  /** Deprecated alias of nameJson for a single formula measure. */
  formulaName?: unknown;
}
export interface PivotConfigInput {
  rows: PivotDimInput;
  cols?: PivotDimInput | null;
  /** Single-measure mode. Absent in multi-measure mode (see `measures`). */
  measure?: PivotMeasureInput | null;
  /** Multi-measure mode: each measure becomes a column. Takes precedence over `measure`. */
  measures?: PivotMeasureInput[] | null;
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
  /** True when each column is a distinct measure (multi-measure mode). */
  multiMeasure?: boolean;
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

  // In multi-measure mode any sum measure may target a page-local field; in
  // single mode only `pivot.measure` matters. Check both shapes safely.
  const anyMeasureNeedsPage =
    (pivot.measures && pivot.measures.length > 0
      ? pivot.measures
      : pivot.measure
        ? [pivot.measure]
        : []
    ).some((m) => m.agg === "sum" && m.source === "page");
  const needPage =
    pivot.rows.source === "page" ||
    pivot.cols?.source === "page" ||
    anyMeasureNeedsPage;
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
  // GROUP BYs in Postgres, a per-record `formula` expression evaluated in JS (SQL
  // can't run the formula language) and summed into each cell, or a `calc`
  // expression evaluated PER ROW over the OTHER measures' aggregated values
  // (multi-measure mode only).
  type MeasurePlan =
    | { kind: "sql"; expr: SQL; label: string }
    | { kind: "formula"; expr: string; label: string; allowedKeys: string[] }
    | { kind: "calc"; expr: string; label: string };
  // Only pivot-enabled, viewer-visible entity fields may feed a formula measure.
  // `entityFields` is already the viewer's visible set (or all-active for the
  // admin widget); restricting the per-record value map to these keys keeps
  // hidden / non-opted field values out of the expression — a hard field
  // boundary, NOT a cosmetic filter (a crafted formula cannot leak them).
  const allowedKeysAll = entityFields.filter((f) => f.pivotEnabled).map((f) => f.fieldKey);
  // Column-header label: explicit nameJson override, then the deprecated
  // formulaName alias (back-compat), then a per-agg default.
  const measureLabel = (m: PivotMeasureInput, dflt: string): string =>
    pivotMLName(m.nameJson) || pivotMLName(m.formulaName) || dflt;
  const resolveMeasure = (m: PivotMeasureInput, allowCalc: boolean): MeasurePlan | { error: string } => {
    if (m.agg === "count") {
      return { kind: "sql", expr: sql`count(*)::float8`, label: measureLabel(m, "Количество") };
    }
    if (m.agg === "formula") {
      const expr = (m.formula ?? "").trim();
      if (!expr) return { error: "Formula measure requires a formula expression" };
      // Validate syntax once. Missing field refs resolve to null (they don't
      // throw), so an empty value map only surfaces parse / unknown-function
      // errors here — not "field not provided" false positives.
      try {
        evaluateFormula(expr, {});
      } catch (e) {
        return { error: `Некорректная формула: ${e instanceof Error ? e.message : String(e)}` };
      }
      return { kind: "formula", expr, label: measureLabel(m, "Формула"), allowedKeys: allowedKeysAll };
    }
    if (m.agg === "calc") {
      if (!allowCalc) return { error: "Вычисляемая мера доступна только при нескольких мерах" };
      const expr = (m.formula ?? "").trim();
      if (!expr) return { error: "Calc measure requires a formula expression" };
      try {
        evaluateFormula(expr, {});
      } catch (e) {
        return { error: `Некорректная формула: ${e instanceof Error ? e.message : String(e)}` };
      }
      return { kind: "calc", expr, label: measureLabel(m, "Формула") };
    }
    const src = m.source;
    const key = m.fieldKey ?? "";
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
      label = measureLabel(m, pivotMLName(f.nameJson));
    } else {
      const pf = pageFieldByKey.get(key);
      if (!pf) return { error: `Unknown or hidden page measure field: ${key}` };
      if (!pf.pivotEnabled) return { error: `Page field is not enabled for pivot: ${key}` };
      if (pf.fieldType !== "number") return { error: `Measure field must be numeric: ${key}` };
      ve = pageLocalValueExpr(pageId!, key);
      label = measureLabel(m, pivotMLName(pf.nameJson));
    }
    return {
      kind: "sql",
      expr: sql`COALESCE(SUM(CASE WHEN (${ve}) ~ ${PIVOT_NUMERIC_RE} THEN (${ve})::numeric ELSE 0 END), 0)::float8`,
      label,
    };
  };

  const rowMeta = resolveDim(pivot.rows);
  if ("error" in rowMeta) return { ok: false, error: rowMeta.error };

  const rowKeyExpr = rowMeta.kind === "status" ? sql`${entityRecordsTable.statusId}::text` : rowMeta.expr;

  // Multi-measure mode (each measure is a column) takes precedence over the
  // single `measure` + optional `cols` dimension. The two are mutually exclusive
  // by design, so any `cols` dimension is ignored when `measures` is present.
  const measuresInput = pivot.measures && pivot.measures.length > 0 ? pivot.measures : null;

  // ---- Aggregation ----
  // Shared output: `grouped` is a flat list of {rk, ck, v} the assembly loop sums
  // per (row, col). In single mode ck = the column dimension key (or __all__); in
  // multi mode ck = the measure's column key.
  let grouped: { rk: string | null; ck: string | null; v: number }[];
  let colMeta: DimMeta | null = null;
  let multiMeasure = false;
  let measureLabelSingle = "";
  // Multi mode: fixed column order (measure keys) + per-column labels + the calc
  // plans to inject after the SQL/formula cells are assembled.
  let colKeysFixed: string[] | null = null;
  const colLabel = new Map<string, string>();
  const calcPlans: { colKey: string; expr: string }[] = [];
  const valueColKeys: string[] = [];

  if (measuresInput) {
    multiMeasure = true;
    const sqlPlans: { colKey: string; expr: SQL }[] = [];
    const formulaPlans: { colKey: string; expr: string; allowedKeys: string[] }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < measuresInput.length; i++) {
      const m = measuresInput[i];
      const plan = resolveMeasure(m, true);
      if ("error" in plan) return { ok: false, error: plan.error };
      const colKey = (m.key && m.key.trim()) || `m${i}`;
      if (seen.has(colKey)) return { ok: false, error: `Дублирующийся ключ меры: ${colKey}` };
      seen.add(colKey);
      colKeysFixed = colKeysFixed ?? [];
      colKeysFixed.push(colKey);
      colLabel.set(colKey, plan.label);
      if (plan.kind === "sql") {
        sqlPlans.push({ colKey, expr: plan.expr });
        valueColKeys.push(colKey);
      } else if (plan.kind === "formula") {
        formulaPlans.push({ colKey, expr: plan.expr, allowedKeys: plan.allowedKeys });
        valueColKeys.push(colKey);
      } else {
        calcPlans.push({ colKey, expr: plan.expr });
      }
    }

    // Validate calc references fail-fast. This is the single boundary for BOTH
    // the records pivot route (no save-time validator) and the dashboard widget.
    // A calc may reference any value measure (count/sum/formula) plus any calc
    // defined EARLIER in config order — exactly the per-row eval order below.
    // Self / unknown / forward refs would silently collapse missing vars to 0
    // and produce wrong totals, so reject them here instead.
    if (calcPlans.length > 0) {
      if (valueColKeys.length === 0)
        return { ok: false, error: "Вычисляемая мера требует хотя бы одну обычную меру" };
      const availableForCalc = new Set(valueColKeys);
      for (const cp of calcPlans) {
        for (const ref of pivotFormulaRefs(cp.expr)) {
          if (ref === cp.colKey)
            return { ok: false, error: `Вычисляемая мера не может ссылаться на саму себя: ${cp.colKey}` };
          if (!availableForCalc.has(ref))
            return { ok: false, error: `Вычисляемая мера ссылается на неизвестную меру: ${ref}` };
        }
        availableForCalc.add(cp.colKey);
      }
    }

    grouped = [];
    // One grouped query for all SQL measures (count / sum), aggregated per row.
    if (sqlPlans.length > 0) {
      const sel: Record<string, SQL> = { __rk: sql`${rowKeyExpr}` };
      for (const p of sqlPlans) sel[p.colKey] = p.expr;
      const sqlRows = (await db
        .select(sel)
        .from(entityRecordsTable)
        .where(where)
        .groupBy(sql`1`)) as Record<string, unknown>[];
      for (const r of sqlRows) {
        const rk = r.__rk == null ? null : String(r.__rk);
        for (const p of sqlPlans) grouped.push({ rk, ck: p.colKey, v: Number(r[p.colKey] ?? 0) });
      }
    }
    // One per-record pull for all formula measures, evaluated in JS and summed.
    if (formulaPlans.length > 0) {
      const raw = await db
        .select({ rk: sql<string | null>`${rowKeyExpr}`, vals: entityRecordsTable.valuesJson })
        .from(entityRecordsTable)
        .where(where);
      for (const r of raw) {
        const srcVals = (r.vals ?? {}) as Record<string, unknown>;
        for (const p of formulaPlans) {
          const scoped: Record<string, unknown> = {};
          for (const k of p.allowedKeys) scoped[k] = srcVals[k];
          let v = 0;
          try {
            const res = evaluateFormula(p.expr, scoped);
            if (typeof res === "number" && Number.isFinite(res)) v = res;
          } catch {
            v = 0;
          }
          grouped.push({ rk: r.rk, ck: p.colKey, v });
        }
      }
    }
  } else {
    const resolvedCol = pivot.cols ? resolveDim(pivot.cols) : null;
    if (resolvedCol && "error" in resolvedCol) return { ok: false, error: resolvedCol.error };
    colMeta = resolvedCol;
    // Single-measure path: `measure` is guaranteed present by validation; default
    // to count defensively so an empty config never throws here.
    const measure = resolveMeasure(pivot.measure ?? { agg: "count" }, false);
    if ("error" in measure) return { ok: false, error: measure.error };
    measureLabelSingle = measure.label;
    const colKeyExpr = !colMeta
      ? null
      : colMeta.kind === "status"
        ? sql`${entityRecordsTable.statusId}::text`
        : colMeta.expr;

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
        const srcVals = (r.vals ?? {}) as Record<string, unknown>;
        const scoped: Record<string, unknown> = {};
        for (const k of allowed) scoped[k] = srcVals[k];
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

  // Multi mode: inject calc measures. Each calc is evaluated PER ROW over the
  // other measures' already-aggregated per-row values (referenced by their colKey
  // via {colKey}), in config order so a later calc can reference an earlier one.
  if (multiMeasure && calcPlans.length > 0) {
    for (const cp of calcPlans) {
      for (const rk of rowKeys) {
        const scoped: Record<string, unknown> = {};
        for (const vk of valueColKeys) scoped[vk] = cellMap.get(rk + "\u0000" + vk) ?? 0;
        let v = 0;
        try {
          const res = evaluateFormula(cp.expr, scoped);
          if (typeof res === "number" && Number.isFinite(res)) v = res;
        } catch {
          v = 0;
        }
        cellMap.set(rk + "\u0000" + cp.colKey, v);
      }
      valueColKeys.push(cp.colKey);
    }
  }

  // Column order: multi mode uses the fixed measure order (incl. calc); single
  // mode sorts the col-dimension keys (or the synthetic __all__ column).
  const colKeys = multiMeasure
    ? (colKeysFixed ?? [])
    : colMeta
      ? sortKeys([...colKeySet], colMeta)
      : [PIVOT_COL_ALL];

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
    // In multi mode columns are heterogeneous measures, so a row total (sum
    // across measures) is meaningless — omit it. colTotals (per measure) stay.
    if (!multiMeasure) {
      rowTotals.push({ key: rk, value: pivotRound(rt) });
      grandTotal += rt;
    }
  }

  return {
    ok: true,
    result: {
      rows: rowKeys.map((k) => ({ key: k, label: labelFor(rowMeta, k) })),
      cols: multiMeasure
        ? colKeys.map((k) => ({ key: k, label: colLabel.get(k) ?? k }))
        : colMeta
          ? colKeys.map((k) => ({ key: k, label: labelFor(colMeta, k) }))
          : [{ key: PIVOT_COL_ALL, label: measureLabelSingle }],
      cells,
      rowTotals,
      colTotals: colKeys.map((k) => ({ key: k, value: pivotRound(colTotal.get(k) ?? 0) })),
      grandTotal: pivotRound(grandTotal),
      measureLabel: measureLabelSingle,
      multiMeasure,
    },
  };
}
