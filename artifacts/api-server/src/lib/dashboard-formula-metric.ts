import {
  db, entitiesTable, entityFieldsTable, entityRecordsTable, pageFieldsTable, pageRecordValuesTable,
} from "@workspace/db";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { cleanFpNoise, normalizeDecimals, FormulaComputationError } from "@workspace/formula";
import {
  loadFormulaOptions, materializeVisibleEntityFormulas, materializeVisiblePageFormulas,
  mergeLinkedFormulaInputsBatched, systemFormulaPermissions,
  localFormulaDependencyClosure,
} from "./formula-runtime";
import { applyFormulaGroupResults, formulaGroupResultWinners, secureFormulaGroupConfigs } from "./formula-group-result";

export class DashboardFormulaMetricError extends Error {}

/** Formula fields are dynamically typed: metadata has no declared resultType. */
export function isMetricSumField(field: { fieldType: string; formulaConfigJson?: unknown }): boolean {
  return field.fieldType === "number" || (
    field.fieldType === "function" &&
    typeof (field.formulaConfigJson as { expression?: unknown } | null)?.expression === "string" &&
    Boolean((field.formulaConfigJson as { expression: string }).expression.trim())
  );
}

/** Explicit SUM means summing rounded row results, not formula-over-column-totals. */
export function sumFormulaMetricValues(
  values: Iterable<unknown>, fieldKey: string, decimals: unknown,
): number {
  const digits = normalizeDecimals(decimals);
  let total = 0;
  for (const value of values) {
    // Strict materialization has already surfaced evaluation errors; null here
    // means a legitimate empty result. Text, booleans and dates must not become zero.
    if (value == null || value === "") continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new DashboardFormulaMetricError(`Cannot sum formula "${fieldKey}": every non-empty result must be a finite number.`);
    }
    total += digits == null ? cleanFpNoise(value) : Number(value.toFixed(digits));
  }
  if (!Number.isFinite(total)) throw new DashboardFormulaMetricError(`Formula sum "${fieldKey}" exceeds the numeric range.`);
  return digits == null ? cleanFpNoise(total) : Number(total.toFixed(digits));
}

/**
 * SYSTEM dashboard boundary: the caller supplies the same nonarchived/status/tag
 * predicate as the SQL metric path. Never paginate before group-result winners.
 * Read-time formulas use the shared dependency resolver, calendar and evaluator.
 */
export async function computeFormulaMetricSum(options: {
  entityId: number; pageId?: number; fieldKey: string; where: SQL;
}): Promise<number> {
  const result = await materializeFormulaMetricValues(options);
  return sumFormulaMetricValues(result.values.values(), options.fieldKey, result.decimals);
}

/** SYSTEM only. Materialize the full filtered universe once, BEFORE bucketing
 * or repeating contributions for multiple tags/links. Group winners stay global. */
export async function materializeFormulaMetricValues(options: {
  entityId: number; pageId?: number; fieldKey: string; where: SQL;
}): Promise<{ values: Map<number, number>; decimals: number | null }> {
  try {
    return await materializeMetricValues(options);
  } catch (error) {
    if (error instanceof FormulaComputationError) {
      throw new DashboardFormulaMetricError(`Cannot sum formula "${options.fieldKey}": ${error.message}`);
    }
    throw error;
  }
}

async function materializeMetricValues(options: {
  entityId: number; pageId?: number; fieldKey: string; where: SQL;
}): Promise<{ values: Map<number, number>; decimals: number | null }> {
  const { entityId, fieldKey } = options;
  const [entity] = await db.select({ pageId: entitiesTable.pageId }).from(entitiesTable).where(eq(entitiesTable.id, entityId));
  const pageId = options.pageId ?? entity?.pageId ?? undefined;
  const pageSource = options.pageId != null;
  const fields = await db.select().from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const pageFields = pageId == null ? [] : await db.select().from(pageFieldsTable)
    .where(and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.isActive, true)));
  const field = (pageSource ? pageFields : fields).find(f => f.fieldKey === fieldKey);
  if (!field || field.fieldType !== "function" || !isMetricSumField(field)) {
    throw new DashboardFormulaMetricError(`Formula field "${fieldKey}" is missing, inactive or has no expression.`);
  }
  const records = await db.select({
    id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson, createdAt: entityRecordsTable.createdAt,
  }).from(entityRecordsTable).where(options.where);
  const pageValues = new Map<number, Record<string, unknown>>();
  if (pageId != null) {
    for (let offset = 0; offset < records.length; offset += 5000) {
      const values = await db.select().from(pageRecordValuesTable).where(and(
        eq(pageRecordValuesTable.pageId, pageId),
        inArray(pageRecordValuesTable.recordId, records.slice(offset, offset + 5000).map(r => r.id)),
      ));
      for (const row of values) {
        const stored = { ...(row.valuesJson as Record<string, unknown> ?? {}) };
        for (const f of pageFields) if (f.fieldType === "function") delete stored[f.fieldKey];
        pageValues.set(row.recordId, stored);
      }
    }
  }
  const rows = records.map(record => {
    const values = { ...(record.valuesJson as Record<string, unknown> ?? {}) };
    for (const f of fields) {
      // Old stored data must not shadow a field converted to a formula.
      if (f.fieldType === "function") delete values[f.fieldKey];
      if (f.fieldType === "created_at") values[f.fieldKey] = record.createdAt.toISOString();
    }
    return { id: record.id, createdAt: record.createdAt, values };
  });
  const formulaOptions = { ...await loadFormulaOptions(), now: new Date(), throwOnError: true, ignoreStoredFormulaValues: true };
  const linkedInputs = await mergeLinkedFormulaInputsBatched({
    entityId, pageId, rows,
    fields: localFormulaDependencyClosure(field, entityId, pageId, fields, pageFields, pageSource ? "page" : "entity"),
    permissions: systemFormulaPermissions, formulaOptions,
  });
  const groupConfigs = secureFormulaGroupConfigs({ fields: [field], entityFields: fields, pageFields, pageId });
  const entityKeys = new Set<string>(pageSource ? [] : [fieldKey]);
  const pageKeys = new Set<string>(pageSource ? [fieldKey] : []);
  for (const group of groupConfigs) for (const ref of group.fields) {
    (ref.scope === "entity" ? entityKeys : pageKeys).add(ref.fieldKey);
  }
  const hidden = new Set<string>();
  const entityResults = materializeVisibleEntityFormulas({
    entityId, pageId, rows, fields, hidden, pageFields, pageValues, hiddenPage: hidden, linkedInputs, formulaOptions,
    materializeKeys: entityKeys,
  });
  const pageResults = pageId == null ? new Map<number, Record<string, unknown>>() : materializeVisiblePageFormulas({
    entityId, pageId, rows: rows.map(row => ({
      id: row.id, entityValues: row.values, pageValues: pageValues.get(row.id) ?? {},
    })),
    entityFields: fields, pageFields, hiddenEntity: hidden, hiddenPage: hidden, linkedInputs, formulaOptions,
    materializeKeys: pageKeys,
  });
  const results = pageSource ? pageResults : entityResults;
  const groupingRows = rows.map(row => ({
    id: row.id, createdAt: row.createdAt,
    entityValues: { ...(linkedInputs.get(row.id) ?? {}), ...(entityResults.get(row.id) ?? row.values) },
    pageValues: pageId == null ? undefined : new Map([[pageId, {
      ...(linkedInputs.get(row.id) ?? {}), ...(pageResults.get(row.id) ?? {}),
    }]]),
  }));
  const suppressed = applyFormulaGroupResults(results, formulaGroupResultWinners(groupingRows, groupConfigs));
  const decimals = normalizeDecimals(field.formulaConfigJson.decimals);
  const values = new Map<number, number>();
  for (const row of rows) {
    values.set(row.id, sumFormulaMetricValues([suppressed.get(row.id)?.[fieldKey]], fieldKey, decimals));
  }
  return { values, decimals };
}