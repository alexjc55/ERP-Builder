import { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  rolesTable,
  pagesTable,
  loginHistoryTable,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  entityStatusesTable,
  dashboardWidgetsTable,
  relationsTable,
  recordLinksTable,
  type DashboardWidget,
  type Relation,
} from "@workspace/db";
import { eq, sql, gte, and, isNull, inArray, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin, getPermissions } from "../middlewares/permissions";
import {
  ListDashboardWidgetsParams,
  CreateDashboardWidgetParams,
  CreateDashboardWidgetBody,
  GetDashboardDataParams,
  UpdateDashboardWidgetParams,
  UpdateDashboardWidgetBody,
  DeleteDashboardWidgetParams,
  ReorderDashboardWidgetsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/stats", requireAuth, async (_req, res): Promise<void> => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    usersResult,
    activeResult,
    blockedResult,
    rolesResult,
    pagesResult,
    recentLoginsResult,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable),
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.isActive, true)),
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.isActive, false)),
    db.select({ count: sql<number>`count(*)::int` }).from(rolesTable),
    db.select({ count: sql<number>`count(*)::int` }).from(pagesTable).where(eq(pagesTable.isActive, true)),
    db.select({ count: sql<number>`count(*)::int` }).from(loginHistoryTable).where(gte(loginHistoryTable.createdAt, oneDayAgo)),
  ]);

  res.json({
    totalUsers: usersResult[0]?.count ?? 0,
    activeUsers: activeResult[0]?.count ?? 0,
    blockedUsers: blockedResult[0]?.count ?? 0,
    totalRoles: rolesResult[0]?.count ?? 0,
    totalPages: pagesResult[0]?.count ?? 0,
    recentLogins: recentLoginsResult[0]?.count ?? 0,
  });
});

// ---- Dashboard widgets ----------------------------------------------------

// Postgres regex matching a plain decimal number, used to skip non-numeric
// JSONB text values before casting (an unguarded ::numeric cast would error).
const NUMERIC_RE = "^-?[0-9]+(\\.[0-9]+)?$";

interface WidgetMetricSpec {
  key: string;
  entityId: number;
  aggregation: "count" | "sum";
  fieldKey?: string | null;
  relationId?: number | null;
  statusIds?: number[] | null;
}

interface TableRelatedColumnSpec {
  relationId: number;
  relatedFieldKey: string;
}

interface ChartSpec {
  type: "bar" | "line" | "area" | "pie" | "donut";
  entityId: number;
  groupBy: { kind: "status" | "field"; fieldKey?: string | null };
  aggregation: "count" | "sum";
  fieldKey?: string | null;
  statusIds?: number[] | null;
  showValues?: boolean | null;
}

interface TableSpec {
  entityId: number;
  fieldKeys: string[];
  relatedColumns?: TableRelatedColumnSpec[] | null;
  statusIds?: number[] | null;
  limit?: number | null;
}

interface WidgetConfigShape {
  widgetType?: "metric" | "chart" | "table" | null;
  metrics?: WidgetMetricSpec[];
  formula?: string | null;
  format?: string | null;
  chart?: ChartSpec | null;
  table?: TableSpec | null;
  colorStyle?: "icon" | "border" | "fill" | null;
  textColor?: "light" | "dark" | null;
}

// Synthetic table-widget column key for the record's lifecycle status. It is not
// a stored field; computeTableData resolves a {name,color} value per row for it.
const STATUS_COLUMN_KEY = "__status";

// Bounds for a table widget's row count (admin-supplied limit is clamped here).
const TABLE_DEFAULT_LIMIT = 10;
const TABLE_MAX_LIMIT = 100;

function clampTableLimit(limit: number | null | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return TABLE_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), TABLE_MAX_LIMIT);
}

/** Resolve a multilingual JSON value with the platform ru → en → he fallback. */
function resolveML(j: unknown): string {
  const m = (j ?? {}) as Record<string, string>;
  return m.ru || m.en || m.he || "";
}

/**
 * Direction of a qualifying *single-link* relation relative to an entity (mirrors
 * the page-fields rule): "source" means the entity's record is the relation
 * source and the single linked record is its target (1:1 or N:1); "target" is
 * the inverse (1:1 or 1:N). Any other shape (N:N, or the many side) yields null.
 */
type LinkDirection = "source" | "target";
function relationDirection(relation: Relation, entityId: number): LinkDirection | null {
  const t = relation.relationType;
  if (relation.sourceEntityId === entityId && (t === "one_to_one" || t === "many_to_one")) return "source";
  if (relation.targetEntityId === entityId && (t === "one_to_one" || t === "one_to_many")) return "target";
  return null;
}
function relatedEntityIdFor(relation: Relation, direction: LinkDirection): number {
  return direction === "source" ? relation.targetEntityId : relation.sourceEntityId;
}

/**
 * Resolve a qualifying single-link relation for an entity and a related field,
 * returning the relation, its direction, and the related entity id. Returns an
 * error string if the relation is missing, not single-link for this entity, or
 * the related field does not exist / is inactive on the other side.
 */
async function resolveRelationField(
  entityId: number,
  relationId: number,
  relatedFieldKey: string,
): Promise<
  | { ok: true; relation: Relation; direction: LinkDirection; relatedEntityId: number; relatedFieldType: string }
  | { error: string }
> {
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
  if (!relation) return { error: `Relation ${relationId} not found` };
  const direction = relationDirection(relation, entityId);
  if (!direction) return { error: `Relation ${relationId} does not yield a single linked record for entity ${entityId}` };
  const relatedEntityId = relatedEntityIdFor(relation, direction);
  const [rf] = await db
    .select({ fieldType: entityFieldsTable.fieldType })
    .from(entityFieldsTable)
    .where(
      and(
        eq(entityFieldsTable.entityId, relatedEntityId),
        eq(entityFieldsTable.fieldKey, relatedFieldKey),
        eq(entityFieldsTable.isActive, true),
      ),
    )
    .limit(1);
  if (!rf) return { error: `Related field "${relatedFieldKey}" not found on entity ${relatedEntityId}` };
  return { ok: true, relation, direction, relatedEntityId, relatedFieldType: rf.fieldType };
}

/**
 * Map a set of an entity's record ids to their single linked record id through a
 * qualifying single-link relation (direction relative to that entity).
 */
async function linkedRecordMap(
  relationId: number,
  direction: LinkDirection,
  recordIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (recordIds.length === 0) return map;
  const rows =
    direction === "source"
      ? await db
          .select({ from: recordLinksTable.sourceRecordId, to: recordLinksTable.targetRecordId })
          .from(recordLinksTable)
          .where(and(eq(recordLinksTable.relationId, relationId), inArray(recordLinksTable.sourceRecordId, recordIds)))
      : await db
          .select({ from: recordLinksTable.targetRecordId, to: recordLinksTable.sourceRecordId })
          .from(recordLinksTable)
          .where(and(eq(recordLinksTable.relationId, relationId), inArray(recordLinksTable.targetRecordId, recordIds)));
  for (const r of rows) map.set(r.from, r.to);
  return map;
}

/** Serialize a stored widget row into the API shape (config/visibleRoleIds). */
function serializeWidget(w: DashboardWidget) {
  return {
    id: w.id,
    pageId: w.pageId,
    titleJson: w.titleJson,
    config: w.configJson,
    visibleRoleIds: w.visibleRoleIdsJson ?? null,
    icon: w.icon,
    color: w.color,
    gridW: w.gridW,
    gridH: w.gridH,
    sortOrder: w.sortOrder,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

/**
 * Validate a widget config against live metadata: each metric must reference an
 * existing entity, sum metrics need an existing numeric field, and metric keys
 * must be unique within the widget. Returns an error message or null.
 */
async function validateChartConfig(chart: ChartSpec | null | undefined): Promise<string | null> {
  if (!chart) return "Chart config is required";
  const validTypes = ["bar", "line", "area", "pie", "donut"];
  if (!validTypes.includes(chart.type)) return `Invalid chart type: ${chart.type}`;

  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, chart.entityId))
    .limit(1);
  if (!entity) return `Entity ${chart.entityId} not found`;

  const kind = chart.groupBy?.kind;
  if (kind === "field") {
    if (!chart.groupBy.fieldKey) return "Group-by field is required";
    const [f] = await db
      .select({ id: entityFieldsTable.id })
      .from(entityFieldsTable)
      .where(and(eq(entityFieldsTable.entityId, chart.entityId), eq(entityFieldsTable.fieldKey, chart.groupBy.fieldKey)))
      .limit(1);
    if (!f) return `Group-by field "${chart.groupBy.fieldKey}" not found`;
  } else if (kind !== "status") {
    return "Invalid groupBy.kind";
  }

  if (chart.aggregation === "sum") {
    if (!chart.fieldKey) return "Sum aggregation requires a numeric field";
    const [field] = await db
      .select({ fieldType: entityFieldsTable.fieldType })
      .from(entityFieldsTable)
      .where(and(eq(entityFieldsTable.entityId, chart.entityId), eq(entityFieldsTable.fieldKey, chart.fieldKey)))
      .limit(1);
    if (!field) return `Field "${chart.fieldKey}" not found on entity ${chart.entityId}`;
    if (field.fieldType !== "number") return `Field "${chart.fieldKey}" is not numeric`;
  } else if (chart.aggregation !== "count") {
    return "Invalid aggregation";
  }
  return null;
}

/**
 * Validate a table widget config: the entity must exist and every chosen column
 * must be a real field of that entity. fieldKeys must be non-empty.
 */
async function validateTableConfig(table: TableSpec | null | undefined): Promise<string | null> {
  if (!table) return "Table config is required";
  const fieldKeys = Array.isArray(table.fieldKeys) ? table.fieldKeys : [];
  const relatedColumns = table.relatedColumns ?? [];
  // A table widget needs at least one column overall — direct OR related.
  if (fieldKeys.length === 0 && relatedColumns.length === 0) {
    return "At least one column is required";
  }

  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, table.entityId))
    .limit(1);
  if (!entity) return `Entity ${table.entityId} not found`;

  const fields = await db
    .select({ fieldKey: entityFieldsTable.fieldKey })
    .from(entityFieldsTable)
    .where(eq(entityFieldsTable.entityId, table.entityId));
  const known = new Set(fields.map((f) => f.fieldKey));
  for (const key of fieldKeys) {
    // STATUS_COLUMN_KEY is a synthetic column (the record's lifecycle status),
    // not a stored field, so it is exempt from the field-existence check.
    if (key === STATUS_COLUMN_KEY) continue;
    if (!known.has(key)) return `Field "${key}" not found on entity ${table.entityId}`;
  }

  for (const rc of relatedColumns) {
    if (!rc || typeof rc.relationId !== "number" || !rc.relatedFieldKey) {
      return "Related column requires relationId and relatedFieldKey";
    }
    const resolved = await resolveRelationField(table.entityId, rc.relationId, rc.relatedFieldKey);
    if ("error" in resolved) return resolved.error;
  }

  const statusIds = Array.from(new Set((table.statusIds ?? []).filter((n) => Number.isInteger(n))));
  if (statusIds.length > 0) {
    const rows = await db
      .select({ id: entityStatusesTable.id })
      .from(entityStatusesTable)
      .where(and(eq(entityStatusesTable.entityId, table.entityId), inArray(entityStatusesTable.id, statusIds)));
    const valid = new Set(rows.map((r) => r.id));
    for (const sid of statusIds) {
      if (!valid.has(sid)) return `Status ${sid} not found on entity ${table.entityId}`;
    }
  }
  return null;
}

async function validateConfig(config: WidgetConfigShape | undefined): Promise<string | null> {
  if (config?.widgetType === "chart") {
    return validateChartConfig(config.chart);
  }
  if (config?.widgetType === "table") {
    return validateTableConfig(config.table);
  }
  const metrics = config?.metrics ?? [];
  if (metrics.length === 0) return "At least one metric is required";
  const seen = new Set<string>();
  for (const m of metrics) {
    if (!m.key || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(m.key)) {
      return `Invalid metric key: ${m.key}`;
    }
    if (seen.has(m.key)) return `Duplicate metric key: ${m.key}`;
    seen.add(m.key);

    const [entity] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(eq(entitiesTable.id, m.entityId))
      .limit(1);
    if (!entity) return `Entity ${m.entityId} not found`;

    // Related metric: aggregate over a single-link related entity. count = number
    // of linked records; sum = sum of the related (numeric) field over them.
    if (m.relationId != null) {
      if (m.aggregation === "sum" && !m.fieldKey) return "Sum metric requires a related numeric field";
      const resolved = await resolveRelationField(m.entityId, m.relationId, m.fieldKey ?? "");
      if (m.aggregation === "sum") {
        if ("error" in resolved) return resolved.error;
        if (resolved.relatedFieldType !== "number") return `Related field "${m.fieldKey}" is not numeric`;
      } else if (m.fieldKey) {
        // count over links: a related field is optional, but if given it must exist.
        if ("error" in resolved) return resolved.error;
      } else {
        // count with no related field still needs a valid single-link relation.
        const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, m.relationId)).limit(1);
        if (!relation) return `Relation ${m.relationId} not found`;
        if (!relationDirection(relation, m.entityId)) {
          return `Relation ${m.relationId} does not yield a single linked record for entity ${m.entityId}`;
        }
      }
      continue;
    }

    if (m.aggregation === "sum") {
      if (!m.fieldKey) return "Sum metric requires a numeric field";
      const [field] = await db
        .select({ fieldType: entityFieldsTable.fieldType })
        .from(entityFieldsTable)
        .where(and(eq(entityFieldsTable.entityId, m.entityId), eq(entityFieldsTable.fieldKey, m.fieldKey)))
        .limit(1);
      if (!field) return `Field "${m.fieldKey}" not found on entity ${m.entityId}`;
      if (field.fieldType !== "number") return `Field "${m.fieldKey}" is not numeric`;
    }
  }
  return null;
}

/**
 * Compute a single metric's value. ADMIN-AUTHORITATIVE: the count/sum is the real
 * total over the entity's non-archived records, independent of the viewing role's
 * row/field data permissions. Access to the metric is governed solely by which
 * roles the admin made the widget visible to.
 */
async function computeMetric(m: WidgetMetricSpec): Promise<number> {
  const conds = [eq(entityRecordsTable.entityId, m.entityId), isNull(entityRecordsTable.archivedAt)];
  const statusIds = (m.statusIds ?? []).filter((n) => Number.isInteger(n));
  if (statusIds.length > 0) conds.push(inArray(entityRecordsTable.statusId, statusIds));

  // Related metric: walk single-link relation from each (filtered) base record to
  // its linked record, then count those linked records or sum the related field.
  if (m.relationId != null) {
    // Sum needs the related field (and its entity); count only needs a valid
    // single-link direction — for count m.fieldKey is null, so do NOT resolve a
    // related field (that would error and yield 0). Resolve direction directly.
    let direction: LinkDirection;
    let relatedEntityId: number;
    if (m.aggregation === "sum" && m.fieldKey) {
      const resolved = await resolveRelationField(m.entityId, m.relationId, m.fieldKey);
      if ("error" in resolved) return 0;
      direction = resolved.direction;
      relatedEntityId = resolved.relatedEntityId;
    } else {
      const [relation] = await db
        .select()
        .from(relationsTable)
        .where(eq(relationsTable.id, m.relationId))
        .limit(1);
      if (!relation) return 0;
      const dir = relationDirection(relation, m.entityId);
      if (!dir) return 0;
      direction = dir;
      relatedEntityId = relatedEntityIdFor(relation, dir);
    }
    const baseRows = await db
      .select({ id: entityRecordsTable.id })
      .from(entityRecordsTable)
      .where(and(...conds));
    const baseIds = baseRows.map((r) => r.id);
    // map: baseRecordId -> linkedRecordId (only base records that have a link).
    // Aggregate PER LINK (per base record), not per unique linked record: under
    // many-to-one / one-to-many several base records can point to the same linked
    // record and each link must contribute. count = number of links; sum = the
    // linked field summed once per linking base record.
    const map = await linkedRecordMap(m.relationId, direction, baseIds);
    if (m.aggregation === "sum" && m.fieldKey) {
      const uniqueLinkedIds = Array.from(new Set(map.values()));
      if (uniqueLinkedIds.length === 0) return 0;
      const key = m.fieldKey;
      const rows = await db
        .select({
          id: entityRecordsTable.id,
          v: sql<number>`CASE WHEN (${entityRecordsTable.valuesJson} ->> ${key}) ~ ${NUMERIC_RE} THEN (${entityRecordsTable.valuesJson} ->> ${key})::numeric ELSE 0 END`,
        })
        .from(entityRecordsTable)
        .where(and(eq(entityRecordsTable.entityId, relatedEntityId), inArray(entityRecordsTable.id, uniqueLinkedIds)));
      const valueById = new Map<number, number>();
      for (const r of rows) valueById.set(r.id, Number(r.v ?? 0));
      let total = 0;
      for (const linkedId of map.values()) total += valueById.get(linkedId) ?? 0;
      return total;
    }
    return map.size;
  }

  if (m.aggregation === "sum" && m.fieldKey) {
    const key = m.fieldKey;
    const [row] = await db
      .select({
        v: sql<number>`COALESCE(SUM(CASE WHEN (${entityRecordsTable.valuesJson} ->> ${key}) ~ ${NUMERIC_RE} THEN (${entityRecordsTable.valuesJson} ->> ${key})::numeric ELSE 0 END), 0)::float8`,
      })
      .from(entityRecordsTable)
      .where(and(...conds));
    return Number(row?.v ?? 0);
  }

  const [row] = await db
    .select({ v: sql<number>`count(*)::int` })
    .from(entityRecordsTable)
    .where(and(...conds));
  return Number(row?.v ?? 0);
}

/**
 * Compute a chart widget's grouped buckets. ADMIN-AUTHORITATIVE like computeMetric:
 * real totals over the entity's non-archived records, independent of the viewing
 * role's data permissions (access is governed by per-widget role visibility).
 * Group either by record status (colored, ordered by status order) or by the raw
 * value of a chosen field.
 */
async function computeChartSeries(
  c: ChartSpec,
): Promise<Array<{ label: string; value: number; color?: string | null }>> {
  const conds = [eq(entityRecordsTable.entityId, c.entityId), isNull(entityRecordsTable.archivedAt)];
  const statusIds = (c.statusIds ?? []).filter((n) => Number.isInteger(n));
  if (statusIds.length > 0) conds.push(inArray(entityRecordsTable.statusId, statusIds));

  const valueExpr =
    c.aggregation === "sum" && c.fieldKey
      ? sql<number>`COALESCE(SUM(CASE WHEN (${entityRecordsTable.valuesJson} ->> ${c.fieldKey}) ~ ${NUMERIC_RE} THEN (${entityRecordsTable.valuesJson} ->> ${c.fieldKey})::numeric ELSE 0 END), 0)::float8`
      : sql<number>`count(*)::int`;

  if (c.groupBy?.kind === "status") {
    const rows = await db
      .select({
        statusId: entityStatusesTable.id,
        nameJson: entityStatusesTable.nameJson,
        color: entityStatusesTable.color,
        sortOrder: entityStatusesTable.sortOrder,
        v: valueExpr,
      })
      .from(entityRecordsTable)
      .leftJoin(entityStatusesTable, eq(entityStatusesTable.id, entityRecordsTable.statusId))
      .where(and(...conds))
      .groupBy(
        entityStatusesTable.id,
        entityStatusesTable.nameJson,
        entityStatusesTable.color,
        entityStatusesTable.sortOrder,
      )
      .orderBy(asc(entityStatusesTable.sortOrder));
    return rows.map((r) => ({
      label: r.statusId ? resolveML(r.nameJson) || "—" : "—",
      value: Number(r.v ?? 0),
      color: r.color ?? null,
    }));
  }

  // Group by raw field value. Empty/null values bucket under "—". Order by value
  // descending using the ordinal position (re-using a sql fragment re-binds params).
  const key = c.groupBy.fieldKey as string;
  const labelExpr = sql<string>`COALESCE(NULLIF(${entityRecordsTable.valuesJson} ->> ${key}, ''), '—')`;
  const rows = await db
    .select({ label: labelExpr, v: valueExpr })
    .from(entityRecordsTable)
    .where(and(...conds))
    .groupBy(labelExpr)
    .orderBy(sql`2 desc`)
    .limit(50);
  return rows.map((r) => ({ label: String(r.label ?? "—"), value: Number(r.v ?? 0), color: null }));
}

/**
 * Compute a table widget's columns + rows. ADMIN-AUTHORITATIVE like computeMetric/
 * computeChartSeries: real rows over the entity's non-archived records, independent
 * of the viewing role's row/field data permissions (access is governed by per-widget
 * role visibility). Columns are the admin-chosen fields (in their configured order);
 * each row carries only those fields' stored values, newest records first.
 */
async function computeTableData(
  t: TableSpec,
): Promise<{
  columns: Array<{ fieldKey: string; label: string; fieldType: string }>;
  rows: Array<{ id: number; values: Record<string, unknown> }>;
}> {
  const fields = await db
    .select({
      fieldKey: entityFieldsTable.fieldKey,
      nameJson: entityFieldsTable.nameJson,
      fieldType: entityFieldsTable.fieldType,
    })
    .from(entityFieldsTable)
    .where(eq(entityFieldsTable.entityId, t.entityId));
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));

  // Keep only valid keys (incl. the synthetic status column), preserving the
  // admin's configured column order. The status column carries fieldType
  // "status"; the client renders it as a colored badge with a localized header.
  const wantsStatus = t.fieldKeys.includes(STATUS_COLUMN_KEY);
  const columns = t.fieldKeys
    .filter((k) => k === STATUS_COLUMN_KEY || byKey.has(k))
    .map((k) => {
      if (k === STATUS_COLUMN_KEY) {
        return { fieldKey: STATUS_COLUMN_KEY, label: "Status", fieldType: "status" };
      }
      const f = byKey.get(k)!;
      return { fieldKey: f.fieldKey, label: resolveML(f.nameJson) || f.fieldKey, fieldType: f.fieldType };
    });

  const conds = [eq(entityRecordsTable.entityId, t.entityId), isNull(entityRecordsTable.archivedAt)];
  const statusIds = (t.statusIds ?? []).filter((n) => Number.isInteger(n));
  if (statusIds.length > 0) conds.push(inArray(entityRecordsTable.statusId, statusIds));

  const records = await db
    .select({
      id: entityRecordsTable.id,
      valuesJson: entityRecordsTable.valuesJson,
      statusId: entityRecordsTable.statusId,
    })
    .from(entityRecordsTable)
    .where(and(...conds))
    .orderBy(sql`${entityRecordsTable.createdAt} desc`)
    .limit(clampTableLimit(t.limit));

  // Resolve status name/color only when the status column is requested.
  const statusById = new Map<number, { name: string; color: string }>();
  if (wantsStatus) {
    const sts = await db
      .select({ id: entityStatusesTable.id, nameJson: entityStatusesTable.nameJson, color: entityStatusesTable.color })
      .from(entityStatusesTable)
      .where(eq(entityStatusesTable.entityId, t.entityId));
    for (const s of sts) statusById.set(s.id, { name: resolveML(s.nameJson) || "—", color: s.color });
  }

  // Related columns: each surfaces one field of the single linked record through a
  // qualifying relation. Synthetic column key avoids collisions with real fields.
  // ADMIN-AUTHORITATIVE: linked values are the real stored values, like the rest.
  const baseIds = records.map((r) => r.id);
  const relCols: Array<{
    fieldKey: string;
    label: string;
    fieldType: string;
    linkMap: Map<number, number>;
    relatedFieldKey: string;
    linkedValues: Map<number, Record<string, unknown>>;
  }> = [];
  for (const rc of t.relatedColumns ?? []) {
    const resolved = await resolveRelationField(t.entityId, rc.relationId, rc.relatedFieldKey);
    if ("error" in resolved) continue;
    const [relName] = await db
      .select({ nameJson: entityFieldsTable.nameJson })
      .from(entityFieldsTable)
      .where(
        and(
          eq(entityFieldsTable.entityId, resolved.relatedEntityId),
          eq(entityFieldsTable.fieldKey, rc.relatedFieldKey),
        ),
      )
      .limit(1);
    const linkMap = await linkedRecordMap(rc.relationId, resolved.direction, baseIds);
    const linkedIds = Array.from(new Set(linkMap.values()));
    const linkedValues = new Map<number, Record<string, unknown>>();
    if (linkedIds.length > 0) {
      const lrs = await db
        .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
        .from(entityRecordsTable)
        .where(and(eq(entityRecordsTable.entityId, resolved.relatedEntityId), inArray(entityRecordsTable.id, linkedIds)));
      for (const lr of lrs) linkedValues.set(lr.id, (lr.valuesJson as Record<string, unknown>) ?? {});
    }
    relCols.push({
      fieldKey: `__rel_${rc.relationId}_${rc.relatedFieldKey}`,
      label: resolveML(relName?.nameJson) || rc.relatedFieldKey,
      fieldType: resolved.relatedFieldType,
      linkMap,
      relatedFieldKey: rc.relatedFieldKey,
      linkedValues,
    });
  }

  const allColumns = [...columns, ...relCols.map((rc) => ({ fieldKey: rc.fieldKey, label: rc.label, fieldType: rc.fieldType }))];

  const rows = records.map((r) => {
    const all = (r.valuesJson ?? {}) as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    for (const c of columns) {
      if (c.fieldKey === STATUS_COLUMN_KEY) {
        values[STATUS_COLUMN_KEY] = r.statusId != null ? statusById.get(r.statusId) ?? null : null;
      } else {
        values[c.fieldKey] = all[c.fieldKey] ?? null;
      }
    }
    for (const rc of relCols) {
      const linkedId = rc.linkMap.get(r.id);
      const lv = linkedId != null ? rc.linkedValues.get(linkedId) : undefined;
      values[rc.fieldKey] = lv ? lv[rc.relatedFieldKey] ?? null : null;
    }
    return { id: r.id, values };
  });

  return { columns: allColumns, rows };
}

/** True if the role may access (see) the given content page. */
function canAccessPage(perms: { superAdmin: boolean; pageIds: number[] }, pageId: number): boolean {
  return perms.superAdmin || perms.pageIds.includes(pageId);
}

/** True if a widget is visible to the role (null/empty visibility = all roles on the page). */
function widgetVisibleToRole(visibleRoleIds: number[] | null, roleId: number, superAdmin: boolean): boolean {
  if (superAdmin) return true;
  if (!visibleRoleIds || visibleRoleIds.length === 0) return true;
  return visibleRoleIds.includes(roleId);
}

// Widgets may live on ANY page (dashboard pages render them as the whole body;
// normal entity-bound and mirror pages render them as an analytics strip above
// the records table). We only require that the target page exists so we never
// create orphan widgets.
async function pageExists(pageId: number): Promise<boolean> {
  const [p] = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId))
    .limit(1);
  return Boolean(p);
}

// GET full widget configs for editing (admin "pages").
router.get("/pages/:id/dashboard/widgets", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = ListDashboardWidgetsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const widgets = await db
    .select()
    .from(dashboardWidgetsTable)
    .where(eq(dashboardWidgetsTable.pageId, params.data.id))
    .orderBy(asc(dashboardWidgetsTable.sortOrder));
  res.json(widgets.map(serializeWidget));
});

router.post("/pages/:id/dashboard/widgets", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = CreateDashboardWidgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateDashboardWidgetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await pageExists(params.data.id))) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  const configError = await validateConfig(parsed.data.config as WidgetConfigShape);
  if (configError) {
    res.status(400).json({ error: configError });
    return;
  }
  const body = parsed.data;
  const [widget] = await db
    .insert(dashboardWidgetsTable)
    .values({
      pageId: params.data.id,
      titleJson: body.titleJson,
      configJson: body.config,
      visibleRoleIdsJson: body.visibleRoleIds ?? null,
      ...(body.icon != null ? { icon: body.icon } : {}),
      ...(body.color != null ? { color: body.color } : {}),
      ...(body.gridW != null ? { gridW: body.gridW } : {}),
      ...(body.gridH != null ? { gridH: body.gridH } : {}),
      ...(body.sortOrder != null ? { sortOrder: body.sortOrder } : {}),
    })
    .returning();
  res.status(201).json(serializeWidget(widget));
});

router.put("/dashboard/widgets/:wid", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = UpdateDashboardWidgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDashboardWidgetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const configError = await validateConfig(parsed.data.config as WidgetConfigShape);
  if (configError) {
    res.status(400).json({ error: configError });
    return;
  }
  const body = parsed.data;
  const updateData: Record<string, unknown> = {
    titleJson: body.titleJson,
    configJson: body.config,
    visibleRoleIdsJson: body.visibleRoleIds ?? null,
  };
  if (body.icon != null) updateData.icon = body.icon;
  if (body.color != null) updateData.color = body.color;
  if (body.gridW != null) updateData.gridW = body.gridW;
  if (body.gridH != null) updateData.gridH = body.gridH;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;

  const [widget] = await db
    .update(dashboardWidgetsTable)
    .set(updateData)
    .where(eq(dashboardWidgetsTable.id, params.data.wid))
    .returning();
  if (!widget) {
    res.status(404).json({ error: "Widget not found" });
    return;
  }
  res.json(serializeWidget(widget));
});

router.delete("/dashboard/widgets/:wid", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = DeleteDashboardWidgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(dashboardWidgetsTable)
    .where(eq(dashboardWidgetsTable.id, params.data.wid))
    .returning({ id: dashboardWidgetsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Widget not found" });
    return;
  }
  res.json({ success: true, message: "Widget deleted" });
});

router.post("/dashboard/widgets/reorder", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const parsed = ReorderDashboardWidgetsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.transaction(async (tx) => {
    for (const item of parsed.data.items) {
      await tx
        .update(dashboardWidgetsTable)
        .set({ sortOrder: item.sortOrder })
        .where(eq(dashboardWidgetsTable.id, item.id));
    }
  });
  res.json({ success: true, message: "Reordered" });
});

// GET computed data for the widgets the caller's role may see.
router.get("/pages/:id/dashboard/data", requireAuth, async (req, res): Promise<void> => {
  const params = GetDashboardDataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const perms = await getPermissions(req);
  if (!canAccessPage(perms, params.data.id)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const roleId = req.user!.roleId;

  const widgets = await db
    .select()
    .from(dashboardWidgetsTable)
    .where(eq(dashboardWidgetsTable.pageId, params.data.id))
    .orderBy(asc(dashboardWidgetsTable.sortOrder));

  const visible = widgets.filter((w) =>
    widgetVisibleToRole(w.visibleRoleIdsJson ?? null, roleId, perms.superAdmin),
  );

  const data = await Promise.all(
    visible.map(async (w) => {
      const config = (w.configJson ?? {}) as WidgetConfigShape;
      const base = {
        id: w.id,
        titleJson: w.titleJson,
        icon: w.icon,
        color: w.color,
        // Coerce to the contract enums so the response stays valid even if a value
        // was written directly to the DB outside the (Zod-validated) write path.
        colorStyle: (["icon", "border", "fill"] as const).find((s) => s === config.colorStyle) ?? null,
        textColor: (["light", "dark"] as const).find((c) => c === config.textColor) ?? null,
        gridW: w.gridW,
        gridH: w.gridH,
        sortOrder: w.sortOrder,
      };
      if (config.widgetType === "chart" && config.chart) {
        const series = await computeChartSeries(config.chart);
        return {
          ...base,
          widgetType: "chart" as const,
          chartType: config.chart.type,
          showValues: config.chart.showValues ?? false,
          series,
          formula: null,
          format: config.format ?? null,
          metrics: {},
        };
      }
      if (config.widgetType === "table" && config.table) {
        const { columns, rows } = await computeTableData(config.table);
        return {
          ...base,
          widgetType: "table" as const,
          tableColumns: columns,
          tableRows: rows,
          tableEntityId: config.table.entityId,
          formula: null,
          format: config.format ?? null,
          metrics: {},
        };
      }
      const metrics: Record<string, number> = {};
      for (const m of config.metrics ?? []) {
        metrics[m.key] = await computeMetric(m);
      }
      return {
        ...base,
        widgetType: "metric" as const,
        formula: config.formula ?? null,
        format: config.format ?? null,
        metrics,
      };
    }),
  );

  res.json(data);
});

export default router;
