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
  pageRecordValuesTable,
  pageFieldsTable,
  type DashboardWidget,
  type Relation,
  type RolePermissions,
} from "@workspace/db";
import { eq, sql, gte, and, isNull, inArray, asc } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin, getPermissions, getUserRoleIds } from "../middlewares/permissions";
import {
  ListDashboardWidgetsParams,
  CreateDashboardWidgetParams,
  CreateDashboardWidgetBody,
  GetDashboardDataParams,
  UpdateDashboardWidgetParams,
  UpdateDashboardWidgetBody,
  DeleteDashboardWidgetParams,
  ReorderDashboardWidgetsBody,
  UpdateNotesContentParams,
  UpdateNotesContentBody,
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
  // Value source: "entity" (default) aggregates entity records; "page" aggregates
  // page-local field values stored in page_record_values for `pageId`. For page
  // source, `fieldKey` is a page-local field key and `relationId` is ignored.
  source?: "entity" | "page" | null;
  pageId?: number | null;
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
  // Value source: "entity" (default) or "page" (page-local field values from
  // page_record_values for `pageId`). For page source, groupBy.fieldKey / fieldKey
  // are page-local field keys; group-by status still uses the record's status.
  source?: "entity" | "page" | null;
  pageId?: number | null;
}

interface TableSpec {
  entityId: number;
  fieldKeys: string[];
  relatedColumns?: TableRelatedColumnSpec[] | null;
  statusIds?: number[] | null;
  limit?: number | null;
}

interface NoteCellSourceSpec {
  key: string;
  sourceKind: "metric" | "record";
  entityId: number;
  aggregation?: "count" | "sum" | null;
  fieldKey?: string | null;
  relationId?: number | null;
  statusIds?: number[] | null;
  recordId?: number | null;
}

interface NoteCellSpec {
  kind: "static" | "dynamic";
  text?: string | null;
  sources?: NoteCellSourceSpec[] | null;
  formula?: string | null;
  format?: string | null;
}

interface NotesSpec {
  kind: "richtext" | "table";
  html?: string | null;
  cols?: number | null;
  cells?: NoteCellSpec[][] | null;
  editableRoleIds?: number[] | null;
}

interface WidgetConfigShape {
  widgetType?: "metric" | "formula" | "chart" | "table" | "notes" | null;
  metrics?: WidgetMetricSpec[];
  formula?: string | null;
  format?: string | null;
  chart?: ChartSpec | null;
  table?: TableSpec | null;
  notes?: NotesSpec | null;
  colorStyle?: "icon" | "border" | "fill" | null;
  textColor?: "light" | "dark" | null;
}

// Synthetic table-widget column key for the record's lifecycle status. It is not
// a stored field; computeTableData resolves a {name,color} value per row for it.
const STATUS_COLUMN_KEY = "__status";

// Bounds for a notes table widget grid (server-enforced so an admin can't submit
// an arbitrarily large grid that drives heavy per-cell compute / oversized output).
const NOTES_MAX_ROWS = 50;
const NOTES_MAX_COLS = 20;
const NOTES_MAX_CELLS = 400;

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

/**
 * Sanitize notes rich-text HTML before it is stored. Whitelists only the tags and
 * inline styles the editor produces (text formatting, headings, lists, links,
 * color, text-align), stripping scripts/handlers/unknown markup so a viewer never
 * renders attacker-controlled HTML. Links are forced to safe schemes + noopener.
 */
function sanitizeNotesHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "span", "strong", "b", "em", "i", "u", "s", "strike", "del",
      "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      span: ["style"],
      p: ["style"],
      h1: ["style"], h2: ["style"], h3: ["style"],
      h4: ["style"], h5: ["style"], h6: ["style"],
      li: ["style"], ul: ["style"], ol: ["style"], blockquote: ["style"],
    },
    allowedStyles: {
      "*": {
        color: [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/],
        "background-color": [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/],
        "text-align": [/^(left|right|center|justify)$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
    },
  });
}

/**
 * Return a copy of the widget config with any notes rich-text HTML sanitized.
 * Applied on every write so stored HTML is always safe to render.
 */
function sanitizeWidgetConfig(config: WidgetConfigShape): WidgetConfigShape {
  if (config?.widgetType === "notes" && config.notes?.kind === "richtext") {
    return {
      ...config,
      notes: { ...config.notes, html: sanitizeNotesHtml(config.notes.html ?? "") },
    };
  }
  return config;
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

  // Page-local field source: group/aggregate over a page's page-local field values.
  // Group-by status still uses the record status, so only field keys are page-local.
  if (chart.source === "page") {
    if (chart.pageId == null) return "Page chart requires a pageId";
    const entityId = await resolvePageEntityId(chart.pageId);
    if (entityId == null) return `Page ${chart.pageId} has no resolvable entity`;
    const kind = chart.groupBy?.kind;
    if (kind === "field") {
      if (!chart.groupBy.fieldKey) return "Group-by field is required";
      const pf = await resolvePageLocalField(chart.pageId, chart.groupBy.fieldKey);
      if (!pf) return `Group-by page field "${chart.groupBy.fieldKey}" not found`;
    } else if (kind !== "status") {
      return "Invalid groupBy.kind";
    }
    if (chart.aggregation !== "sum" && chart.aggregation !== "count") {
      return "Invalid aggregation";
    }
    // Page source always aggregates a specific page-local field: sum needs a
    // numeric field; count counts records whose value for that field is non-empty
    // (mirrors page-source metric semantics, never a bare record count).
    if (!chart.fieldKey) return "Page chart requires a field";
    const vpf = await resolvePageLocalField(chart.pageId, chart.fieldKey);
    if (!vpf) return `Page field "${chart.fieldKey}" not found`;
    if (chart.aggregation === "sum" && vpf.fieldType !== "number") {
      return `Page field "${chart.fieldKey}" is not numeric`;
    }
    return null;
  }

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

/**
 * Validate a single live-value source of a notes-table cell. A "metric" source
 * mirrors the WidgetMetric rules (entity/relation/numeric-field); a "record"
 * source must reference an existing record of the entity and an existing field.
 */
async function validateNoteCellSource(s: NoteCellSourceSpec): Promise<string | null> {
  if (!s.key || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s.key)) return `Invalid source key: ${s.key}`;
  if (s.sourceKind !== "metric" && s.sourceKind !== "record") return "Invalid source kind";

  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, s.entityId))
    .limit(1);
  if (!entity) return `Entity ${s.entityId} not found`;

  if (s.sourceKind === "record") {
    if (s.recordId == null) return "Record source requires a record";
    if (!s.fieldKey) return "Record source requires a field";
    const [rec] = await db
      .select({ id: entityRecordsTable.id })
      .from(entityRecordsTable)
      .where(and(eq(entityRecordsTable.id, s.recordId), eq(entityRecordsTable.entityId, s.entityId)))
      .limit(1);
    if (!rec) return `Record ${s.recordId} not found on entity ${s.entityId}`;
    const [field] = await db
      .select({ id: entityFieldsTable.id })
      .from(entityFieldsTable)
      .where(and(eq(entityFieldsTable.entityId, s.entityId), eq(entityFieldsTable.fieldKey, s.fieldKey)))
      .limit(1);
    if (!field) return `Field "${s.fieldKey}" not found on entity ${s.entityId}`;
    return null;
  }

  // metric source
  const aggregation = s.aggregation ?? "count";
  if (aggregation !== "count" && aggregation !== "sum") return "Invalid aggregation";
  const metricErr = await validateMetricLike({
    entityId: s.entityId,
    aggregation,
    fieldKey: s.fieldKey ?? null,
    relationId: s.relationId ?? null,
  });
  if (metricErr) return metricErr;

  // statusIds (optional restriction) must belong to the source entity — mirrors
  // table-widget status validation so a metric source can't reference foreign
  // or non-existent statuses.
  const statusIds = Array.from(new Set((s.statusIds ?? []).filter((n) => Number.isInteger(n))));
  if (statusIds.length > 0) {
    const rows = await db
      .select({ id: entityStatusesTable.id })
      .from(entityStatusesTable)
      .where(and(eq(entityStatusesTable.entityId, s.entityId), inArray(entityStatusesTable.id, statusIds)));
    const valid = new Set(rows.map((r) => r.id));
    for (const sid of statusIds) {
      if (!valid.has(sid)) return `Status ${sid} not found on entity ${s.entityId}`;
    }
  }
  return null;
}

/**
 * Validate a notes widget config. richtext needs nothing beyond the kind; table
 * validates the cell grid: every dynamic cell's sources must resolve and source
 * keys must be unique within the cell (so the cell formula can reference them).
 */
async function validateNotesConfig(notes: NotesSpec | null | undefined): Promise<string | null> {
  if (!notes) return "Notes config is required";
  if (notes.kind === "richtext") return null;
  if (notes.kind !== "table") return "Invalid notes kind";

  const cells = notes.cells ?? [];
  if (!Array.isArray(cells)) return "Notes table cells must be a grid";
  // Bound the grid so an admin can't submit an arbitrarily large payload that
  // would drive heavy per-cell compute loops and oversized responses.
  if (cells.length > NOTES_MAX_ROWS) return `Notes table exceeds ${NOTES_MAX_ROWS} rows`;
  let totalCells = 0;
  for (const row of cells) {
    if (!Array.isArray(row)) return "Notes table row must be an array";
    if (row.length > NOTES_MAX_COLS) return `Notes table exceeds ${NOTES_MAX_COLS} columns`;
    totalCells += row.length;
    if (totalCells > NOTES_MAX_CELLS) return `Notes table exceeds ${NOTES_MAX_CELLS} cells`;
    for (const cell of row) {
      if (cell.kind !== "static" && cell.kind !== "dynamic") return "Invalid cell kind";
      if (cell.kind !== "dynamic") continue;
      const sources = cell.sources ?? [];
      if (sources.length === 0) return "Dynamic cell requires at least one source";
      const seen = new Set<string>();
      for (const s of sources) {
        if (seen.has(s.key)) return `Duplicate source key in cell: ${s.key}`;
        seen.add(s.key);
        const err = await validateNoteCellSource(s);
        if (err) return err;
      }
    }
  }
  return null;
}

/**
 * Resolve the entity whose records a page shows: a bound entity (entities.pageId =
 * pageId) or, failing that, a mirror page's mirrorEntityId. page_record_values rows
 * are keyed by (pageId, recordId) where recordId is an entity_records id of this
 * entity, so this is the entity to aggregate page-local field values over.
 */
async function resolvePageEntityId(pageId: number): Promise<number | null> {
  const [bound] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.pageId, pageId))
    .limit(1);
  if (bound) return bound.id;
  const [page] = await db
    .select({ mirrorEntityId: pagesTable.mirrorEntityId })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId))
    .limit(1);
  return page?.mirrorEntityId ?? null;
}

/** Resolve a page-local field's type, or null if it does not exist / is inactive. */
async function resolvePageLocalField(
  pageId: number,
  fieldKey: string,
): Promise<{ fieldType: string } | null> {
  const [f] = await db
    .select({ fieldType: pageFieldsTable.fieldType, isActive: pageFieldsTable.isActive })
    .from(pageFieldsTable)
    .where(and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.fieldKey, fieldKey)))
    .limit(1);
  if (!f || !f.isActive) return null;
  return { fieldType: f.fieldType };
}

/**
 * Validate the metric-shaped part of a spec (entity existence, related single-link
 * relation, numeric sum field). Shared by widget metrics and notes metric sources;
 * key validity/uniqueness is the caller's responsibility.
 */
async function validateMetricLike(m: {
  entityId: number;
  aggregation: "count" | "sum";
  fieldKey?: string | null;
  relationId?: number | null;
  source?: "entity" | "page" | null;
  pageId?: number | null;
}): Promise<string | null> {
  // Page-local field source: aggregate a page's page-local field, not entity data.
  // Related metrics are entity-only and cannot combine with a page source.
  if (m.source === "page") {
    if (m.relationId != null) return "Related metrics cannot use a page field source";
    if (m.pageId == null) return "Page metric requires a pageId";
    const entityId = await resolvePageEntityId(m.pageId);
    if (entityId == null) return `Page ${m.pageId} has no resolvable entity`;
    if (!m.fieldKey) return "Page metric requires a page field";
    const pf = await resolvePageLocalField(m.pageId, m.fieldKey);
    if (!pf) return `Page field "${m.fieldKey}" not found on page ${m.pageId}`;
    if (m.aggregation === "sum" && pf.fieldType !== "number") {
      return `Page field "${m.fieldKey}" is not numeric`;
    }
    return null;
  }

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
    return null;
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
  return null;
}

async function validateConfig(config: WidgetConfigShape | undefined): Promise<string | null> {
  if (config?.widgetType === "chart") {
    return validateChartConfig(config.chart);
  }
  if (config?.widgetType === "table") {
    return validateTableConfig(config.table);
  }
  if (config?.widgetType === "notes") {
    return validateNotesConfig(config.notes);
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
    const err = await validateMetricLike(m);
    if (err) return err;
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
  // Page-local field source: aggregate the page's page-local field value over the
  // page's (resolved) entity records via a LEFT JOIN on page_record_values. count =
  // records whose page-local value is non-empty; sum = numeric page-local values.
  if (m.source === "page" && m.pageId != null && m.fieldKey) {
    const entityId = await resolvePageEntityId(m.pageId);
    if (entityId == null) return 0;
    const key = m.fieldKey;
    const pageId = m.pageId;
    const conds = [eq(entityRecordsTable.entityId, entityId), isNull(entityRecordsTable.archivedAt)];
    const statusIds = (m.statusIds ?? []).filter((n) => Number.isInteger(n));
    if (statusIds.length > 0) conds.push(inArray(entityRecordsTable.statusId, statusIds));
    const join = and(
      eq(pageRecordValuesTable.recordId, entityRecordsTable.id),
      eq(pageRecordValuesTable.pageId, pageId),
    );
    if (m.aggregation === "sum") {
      const [row] = await db
        .select({
          v: sql<number>`COALESCE(SUM(CASE WHEN (${pageRecordValuesTable.valuesJson} ->> ${key}) ~ ${NUMERIC_RE} THEN (${pageRecordValuesTable.valuesJson} ->> ${key})::numeric ELSE 0 END), 0)::float8`,
        })
        .from(entityRecordsTable)
        .leftJoin(pageRecordValuesTable, join)
        .where(and(...conds));
      return Number(row?.v ?? 0);
    }
    const [row] = await db
      .select({
        v: sql<number>`COUNT(*) FILTER (WHERE NULLIF(${pageRecordValuesTable.valuesJson} ->> ${key}, '') IS NOT NULL)::int`,
      })
      .from(entityRecordsTable)
      .leftJoin(pageRecordValuesTable, join)
      .where(and(...conds));
    return Number(row?.v ?? 0);
  }

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
  // Page-local field source: group/aggregate the page's page-local field values over
  // the page's (resolved) entity records via a LEFT JOIN on page_record_values.
  // Group-by status still uses the record status; group-by field / sum use the
  // page-local value.
  if (c.source === "page" && c.pageId != null) {
    const entityId = await resolvePageEntityId(c.pageId);
    if (entityId == null) return [];
    const pageId = c.pageId;
    const conds = [eq(entityRecordsTable.entityId, entityId), isNull(entityRecordsTable.archivedAt)];
    const statusIds = (c.statusIds ?? []).filter((n) => Number.isInteger(n));
    if (statusIds.length > 0) conds.push(inArray(entityRecordsTable.statusId, statusIds));
    const join = and(
      eq(pageRecordValuesTable.recordId, entityRecordsTable.id),
      eq(pageRecordValuesTable.pageId, pageId),
    );
    const valueExpr =
      c.aggregation === "sum" && c.fieldKey
        ? sql<number>`COALESCE(SUM(CASE WHEN (${pageRecordValuesTable.valuesJson} ->> ${c.fieldKey}) ~ ${NUMERIC_RE} THEN (${pageRecordValuesTable.valuesJson} ->> ${c.fieldKey})::numeric ELSE 0 END), 0)::float8`
        : c.fieldKey
          ? sql<number>`count(*) FILTER (WHERE NULLIF(${pageRecordValuesTable.valuesJson} ->> ${c.fieldKey}, '') IS NOT NULL)::int`
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
        .leftJoin(pageRecordValuesTable, join)
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

    const key = c.groupBy.fieldKey as string;
    const labelExpr = sql<string>`COALESCE(NULLIF(${pageRecordValuesTable.valuesJson} ->> ${key}, ''), '—')`;
    const rows = await db
      .select({ label: labelExpr, v: valueExpr })
      .from(entityRecordsTable)
      .leftJoin(pageRecordValuesTable, join)
      .where(and(...conds))
      .groupBy(labelExpr)
      .orderBy(sql`2 desc`)
      .limit(50);
    return rows.map((r) => ({ label: String(r.label ?? "—"), value: Number(r.v ?? 0), color: null }));
  }

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

/**
 * Resolve a specific record's stored field value for a notes "record" source.
 * ADMIN-AUTHORITATIVE: returns the raw stored value regardless of the viewing
 * role's data permissions (access is governed by per-widget role visibility).
 * Objects (e.g. file/link fields) collapse to their name; missing → null.
 */
async function computeRecordField(
  entityId: number,
  recordId: number,
  fieldKey: string,
): Promise<number | string | null> {
  const [rec] = await db
    .select({ valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(eq(entityRecordsTable.id, recordId), eq(entityRecordsTable.entityId, entityId)))
    .limit(1);
  if (!rec) return null;
  const v = ((rec.valuesJson ?? {}) as Record<string, unknown>)[fieldKey];
  if (v == null) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    return JSON.stringify(v);
  }
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

type NoteCellData =
  | { kind: "static"; text: string; values: null; formula: null; format: null }
  | {
      kind: "dynamic";
      text: null;
      values: Record<string, number | string>;
      formula: string | null;
      format: string | null;
    };

/**
 * Compute a notes widget's viewer-facing data. richtext passes the sanitized HTML
 * through; table computes each dynamic cell's source values (metric aggregates or
 * a record's field value) — admin-authoritative — and ships them with the cell's
 * formula/format for client-side evaluation (consistent with metric widgets).
 */
async function computeNotesData(notes: NotesSpec): Promise<{
  kind: "richtext" | "table";
  html: string | null;
  cols: number | null;
  cells: NoteCellData[][] | null;
}> {
  if (notes.kind === "richtext") {
    return { kind: "richtext", html: notes.html ?? "", cols: null, cells: null };
  }
  const cells = notes.cells ?? [];
  const computed: NoteCellData[][] = await Promise.all(
    cells.map((row) =>
      Promise.all(
        row.map(async (cell): Promise<NoteCellData> => {
          if (cell.kind === "static") {
            return { kind: "static", text: cell.text ?? "", values: null, formula: null, format: null };
          }
          const values: Record<string, number | string> = {};
          for (const s of cell.sources ?? []) {
            if (s.sourceKind === "record" && s.recordId != null && s.fieldKey) {
              const v = await computeRecordField(s.entityId, s.recordId, s.fieldKey);
              values[s.key] = v == null ? "" : v;
            } else {
              values[s.key] = await computeMetric({
                key: s.key,
                entityId: s.entityId,
                aggregation: s.aggregation ?? "count",
                fieldKey: s.fieldKey ?? null,
                relationId: s.relationId ?? null,
                statusIds: s.statusIds ?? null,
              });
            }
          }
          return { kind: "dynamic", text: null, values, formula: cell.formula ?? null, format: cell.format ?? null };
        }),
      ),
    ),
  );
  return {
    kind: "table",
    html: null,
    cols: notes.cols ?? (cells[0]?.length ?? 0),
    cells: computed,
  };
}

/** True if the role may access (see) the given content page. */
function canAccessPage(perms: { superAdmin: boolean; pageIds: number[] }, pageId: number): boolean {
  return perms.superAdmin || perms.pageIds.includes(pageId);
}

/**
 * True if a widget is visible to the user (null/empty visibility = all roles on
 * the page). With multiple roles, visibility is granted if ANY role qualifies.
 */
function widgetVisibleToRole(visibleRoleIds: number[] | null, roleIds: number[], superAdmin: boolean): boolean {
  if (superAdmin) return true;
  if (!visibleRoleIds || visibleRoleIds.length === 0) return true;
  return visibleRoleIds.some((id) => roleIds.includes(id));
}

/**
 * True if the requester may inline-edit a notes widget's content. Page-admins
 * (superAdmin or the "pages" admin cap) always may. Otherwise the role must be
 * able to access the page, the widget must be visible to it, AND its role id must
 * be explicitly listed in the notes config's editableRoleIds (opt-in per widget).
 */
function canEditNotesContent(
  perms: RolePermissions,
  roleIds: number[],
  pageId: number,
  visibleRoleIds: number[] | null,
  notes: NotesSpec,
): boolean {
  if (perms.superAdmin || perms.admin.pages) return true;
  if (!canAccessPage(perms, pageId)) return false;
  if (!widgetVisibleToRole(visibleRoleIds, roleIds, perms.superAdmin)) return false;
  const editable = notes.editableRoleIds ?? [];
  return roleIds.some((id) => editable.includes(id));
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
      configJson: sanitizeWidgetConfig(body.config as WidgetConfigShape),
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
    configJson: sanitizeWidgetConfig(body.config as WidgetConfigShape),
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

// Inline content edit for a notes widget. NOT gated by requireAdmin: any authed
// user whose role is allowed (page-admin or listed in editableRoleIds) may edit.
// The server stays the source of truth for STRUCTURE — richtext is re-sanitized
// and a table edit can only change the text of EXISTING STATIC cells (it can never
// add/remove cells, change the grid, or repoint a computed/dynamic cell at data).
router.put("/dashboard/widgets/:wid/notes-content", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateNotesContentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateNotesContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [widget] = await db
    .select()
    .from(dashboardWidgetsTable)
    .where(eq(dashboardWidgetsTable.id, params.data.wid))
    .limit(1);
  if (!widget) {
    res.status(404).json({ error: "Widget not found" });
    return;
  }
  const config = (widget.configJson ?? {}) as WidgetConfigShape;
  if (config.widgetType !== "notes" || !config.notes) {
    res.status(400).json({ error: "Not a notes widget" });
    return;
  }
  const notes = config.notes;
  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  if (!canEditNotesContent(perms, roleIds, widget.pageId, widget.visibleRoleIdsJson ?? null, notes)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = parsed.data;
  if (body.kind !== notes.kind) {
    res.status(400).json({ error: "Edit kind does not match the widget's notes kind" });
    return;
  }

  let nextNotes: NotesSpec;
  if (body.kind === "richtext") {
    nextNotes = { ...notes, html: sanitizeNotesHtml(body.html ?? "") };
  } else {
    const grid = (notes.cells ?? []).map((row) => row.map((c) => ({ ...c })));
    for (const edit of body.cells ?? []) {
      const cell = grid[edit.row]?.[edit.col];
      if (!cell) {
        res.status(400).json({ error: `Cell ${edit.row},${edit.col} does not exist` });
        return;
      }
      if (cell.kind !== "static") {
        res.status(400).json({ error: `Cell ${edit.row},${edit.col} is computed and cannot be edited` });
        return;
      }
      cell.text = edit.text;
    }
    nextNotes = { ...notes, cells: grid };
  }

  await db
    .update(dashboardWidgetsTable)
    .set({ configJson: { ...config, notes: nextNotes } })
    .where(eq(dashboardWidgetsTable.id, widget.id));
  res.json({ success: true, message: "Notes content updated" });
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
  const roleIds = await getUserRoleIds(req);

  const widgets = await db
    .select()
    .from(dashboardWidgetsTable)
    .where(eq(dashboardWidgetsTable.pageId, params.data.id))
    .orderBy(asc(dashboardWidgetsTable.sortOrder));

  const visible = widgets.filter((w) =>
    widgetVisibleToRole(w.visibleRoleIdsJson ?? null, roleIds, perms.superAdmin),
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
      if (config.widgetType === "notes" && config.notes) {
        const notes = await computeNotesData(config.notes);
        return {
          ...base,
          widgetType: "notes" as const,
          notes,
          canEditNotes: canEditNotesContent(perms, roleIds, w.pageId, w.visibleRoleIdsJson ?? null, config.notes),
          formula: null,
          format: config.format ?? null,
          metrics: {},
        };
      }
      // Metric and formula widgets share the same compute model (field-terms +
      // optional formula + format). They differ only as distinct widget types so
      // the client can render a formula-first editor; both produce a number card.
      const metrics: Record<string, number> = {};
      for (const m of config.metrics ?? []) {
        metrics[m.key] = await computeMetric(m);
      }
      return {
        ...base,
        widgetType: config.widgetType === "formula" ? ("formula" as const) : ("metric" as const),
        formula: config.formula ?? null,
        format: config.format ?? null,
        metrics,
      };
    }),
  );

  res.json(data);
});

export default router;
