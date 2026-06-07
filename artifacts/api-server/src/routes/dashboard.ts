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
async function validateConfig(config: { metrics?: WidgetMetricSpec[] } | undefined): Promise<string | null> {
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
  const configError = await validateConfig(parsed.data.config as { metrics?: WidgetMetricSpec[] });
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
  const configError = await validateConfig(parsed.data.config as { metrics?: WidgetMetricSpec[] });
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
      const config = (w.configJson ?? {}) as {
        metrics?: WidgetMetricSpec[];
        formula?: string | null;
        format?: string | null;
      };
      const metrics: Record<string, number> = {};
      for (const m of config.metrics ?? []) {
        metrics[m.key] = await computeMetric(m);
      }
      return {
        id: w.id,
        titleJson: w.titleJson,
        icon: w.icon,
        color: w.color,
        sortOrder: w.sortOrder,
        formula: config.formula ?? null,
        format: config.format ?? null,
        metrics,
      };
    }),
  );

  res.json(data);
});

export default router;
