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
  type DashboardWidget,
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
  statusIds?: number[] | null;
}

interface ChartSpec {
  type: "bar" | "line" | "area" | "pie" | "donut";
  entityId: number;
  groupBy: { kind: "status" | "field"; fieldKey?: string | null };
  aggregation: "count" | "sum";
  fieldKey?: string | null;
  statusIds?: number[] | null;
}

interface WidgetConfigShape {
  widgetType?: "metric" | "chart" | null;
  metrics?: WidgetMetricSpec[];
  formula?: string | null;
  format?: string | null;
  chart?: ChartSpec | null;
}

/** Resolve a multilingual JSON value with the platform ru → en → he fallback. */
function resolveML(j: unknown): string {
  const m = (j ?? {}) as Record<string, string>;
  return m.ru || m.en || m.he || "";
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

async function validateConfig(config: WidgetConfigShape | undefined): Promise<string | null> {
  if (config?.widgetType === "chart") {
    return validateChartConfig(config.chart);
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

async function isDashboardPage(pageId: number): Promise<boolean> {
  const [p] = await db
    .select({ isDashboard: pagesTable.isDashboard })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId))
    .limit(1);
  return Boolean(p?.isDashboard);
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
  if (!(await isDashboardPage(params.data.id))) {
    res.status(404).json({ error: "Dashboard page not found" });
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
          series,
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
