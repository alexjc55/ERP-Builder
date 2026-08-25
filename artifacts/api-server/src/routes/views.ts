import { Router, type IRouter } from "express";
import { db, viewsTable, entitiesTable, pagesTable, entityFieldsTable, pageFieldsTable } from "@workspace/db";
import { eq, asc, and, ne, inArray, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin, requireRecordParam, getPermissions, getUserRoleIds } from "../middlewares/permissions";
import {
  ListEntityViewsParams,
  CreateEntityViewParams,
  CreateEntityViewBody,
  GetViewParams,
  UpdateViewParams,
  UpdateViewBody,
  DeleteViewParams,
  ReorderViewsParams,
  ReorderViewsBody,
  ListMainEntityViewsParams,
  ListPageViewsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const VIEW_KEY_RE = /^[a-z][a-z0-9_]*$/;

type ViewRow = typeof viewsTable.$inferSelect;

/** Serialize a stored view row into the API shape (visibleRoleIdsJson → visibleRoleIds). */
function serializeView(v: ViewRow) {
  const { visibleRoleIdsJson, ...rest } = v;
  return { ...rest, visibleRoleIds: visibleRoleIdsJson ?? null };
}

/**
 * View role visibility (NOT a data boundary — record/field/row perms still apply):
 * null/empty visibleRoleIds = visible to every role; otherwise only the listed
 * roles. superAdmin always sees every view so it can be managed/edited.
 */
function viewVisibleToRole(v: ViewRow, roleIds: number[], superAdmin: boolean): boolean {
  if (superAdmin) return true;
  const ids = v.visibleRoleIdsJson;
  if (!ids || ids.length === 0) return true;
  return ids.some((id) => roleIds.includes(id));
}

// Drizzle wraps the pg driver error, so the original code/constraint can live on
// err.cause rather than the top-level error. Walk the cause chain to find it.
function uniqueViolationConstraint(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const obj = e as { code?: string; constraint?: string; cause?: unknown };
    if (obj.code === "23505") {
      return obj.constraint ?? "";
    }
    e = obj.cause;
  }
  return null;
}

function mapViewConflict(constraint: string, res: import("express").Response): void {
  if (constraint === "view_one_default_entity" || constraint === "view_one_default_page") {
    res.status(409).json({ error: "This page already has a default view" });
  } else {
    res.status(409).json({ error: "A view with this key already exists on this entity" });
  }
}

const PAGE_FILTER_TYPES = new Set([
  "text", "textarea", "email", "url", "phone", "select", "number", "percent",
  "boolean", "date", "datetime", "user",
]);

type StoredViewConfig = {
  filters?: Array<{ source?: "entity" | "page"; field: string; operator: string; value?: unknown }>;
  filterConjunction?: "and" | "or";
  [key: string]: unknown;
};

async function validateTargetAndConfig(
  entityId: number,
  targetPageId: number | null,
  config: StoredViewConfig,
): Promise<string | null> {
  if (targetPageId != null) {
    const [page] = await db.select({ mirrorEntityId: pagesTable.mirrorEntityId }).from(pagesTable)
      .where(eq(pagesTable.id, targetPageId)).limit(1);
    if (!page || page.mirrorEntityId !== entityId) {
      return "targetPageId must identify a mirror page of this entity";
    }
  }
  const filters = config.filters ?? [];
  const entityKeys = new Set((await db.select({ key: entityFieldsTable.fieldKey }).from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)))).map((f) => f.key));
  const pageFields = targetPageId == null ? [] : await db.select({
    key: pageFieldsTable.fieldKey,
    type: pageFieldsTable.fieldType,
  }).from(pageFieldsTable).where(and(eq(pageFieldsTable.pageId, targetPageId), eq(pageFieldsTable.isActive, true)));
  const pageByKey = new Map(pageFields.map((f) => [f.key, f.type]));
  for (const condition of filters) {
    const source = condition.source ?? "entity";
    if (source === "entity") {
      if (!entityKeys.has(condition.field)) return `Unknown or inactive entity field "${condition.field}"`;
    } else {
      if (targetPageId == null) return "Page-source filters require a targeted mirror page";
      const type = pageByKey.get(condition.field);
      if (!type || !PAGE_FILTER_TYPES.has(type)) {
        return `Unknown, inactive, or unsupported page field "${condition.field}"`;
      }
    }
    if (condition.operator !== "is_empty" && condition.operator !== "is_not_empty" && condition.value == null) {
      return `Operator "${condition.operator}" requires a value for field "${condition.field}"`;
    }
  }
  return null;
}

async function visibleViewsForTarget(
  req: import("express").Request,
  entityId: number,
  targetPageId: number | null,
) {
  const target = targetPageId == null ? isNull(viewsTable.targetPageId) : eq(viewsTable.targetPageId, targetPageId);
  const rows = await db.select().from(viewsTable)
    .where(and(eq(viewsTable.entityId, entityId), target, eq(viewsTable.isActive, true)))
    .orderBy(asc(viewsTable.sortOrder));
  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  return rows.filter((v) => viewVisibleToRole(v, roleIds, perms.superAdmin)).map(serializeView);
}

async function entityExists(entityId: number): Promise<boolean> {
  const [entity] = await db.select({ id: entitiesTable.id }).from(entitiesTable).where(eq(entitiesTable.id, entityId)).limit(1);
  return Boolean(entity);
}

async function viewKeyTaken(entityId: number, viewKey: string, excludeId: number | null): Promise<boolean> {
  const where =
    excludeId != null
      ? and(eq(viewsTable.entityId, entityId), eq(viewsTable.viewKey, viewKey), ne(viewsTable.id, excludeId))
      : and(eq(viewsTable.entityId, entityId), eq(viewsTable.viewKey, viewKey));
  const [taken] = await db.select({ id: viewsTable.id }).from(viewsTable).where(where).limit(1);
  return Boolean(taken);
}

router.get("/entities/:entityId/views", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = ListEntityViewsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await entityExists(params.data.entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const views = await db
    .select()
    .from(viewsTable)
    .where(eq(viewsTable.entityId, params.data.entityId))
    .orderBy(asc(viewsTable.sortOrder));
  res.json(views.map(serializeView));
});

router.get("/entities/:entityId/main-views", requireAuth, requireRecordParam("view", { entityOnly: true }), async (req, res): Promise<void> => {
  const params = ListMainEntityViewsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!(await entityExists(params.data.entityId))) { res.status(404).json({ error: "Entity not found" }); return; }
  res.json(await visibleViewsForTarget(req, params.data.entityId, null));
});

router.get("/pages/:pageId/views", requireAuth, async (req, res): Promise<void> => {
  const params = ListPageViewsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [page] = await db.select({ mirrorEntityId: pagesTable.mirrorEntityId }).from(pagesTable)
    .where(eq(pagesTable.id, params.data.pageId)).limit(1);
  if (!page || page.mirrorEntityId == null) { res.status(404).json({ error: "Mirror page not found" }); return; }
  const perms = await getPermissions(req);
  if (!perms.superAdmin && !perms.pageIds.includes(params.data.pageId)) {
    res.status(403).json({ error: "Page access denied" });
    return;
  }
  res.json(await visibleViewsForTarget(req, page.mirrorEntityId, params.data.pageId));
});

router.post("/entities/:entityId/views", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = CreateEntityViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateEntityViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const entityId = params.data.entityId;
  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const key = parsed.data.viewKey.trim();
  if (!VIEW_KEY_RE.test(key)) {
    res.status(400).json({
      error: "View key must be lowercase and contain only letters, digits and underscores, starting with a letter",
    });
    return;
  }
  if (await viewKeyTaken(entityId, key, null)) {
    res.status(409).json({ error: "A view with this key already exists on this entity" });
    return;
  }
  const targetPageId = parsed.data.targetPageId ?? null;
  const configError = await validateTargetAndConfig(entityId, targetPageId, (parsed.data.configJson ?? {}) as StoredViewConfig);
  if (configError) { res.status(400).json({ error: configError }); return; }

  try {
    const view = await db.transaction(async (tx) => {
      if (parsed.data.isDefault) {
        const target = targetPageId == null ? isNull(viewsTable.targetPageId) : eq(viewsTable.targetPageId, targetPageId);
        await tx.update(viewsTable).set({ isDefault: false }).where(and(eq(viewsTable.entityId, entityId), target));
      }
      const { visibleRoleIds, ...rest } = parsed.data;
      const [created] = await tx
        .insert(viewsTable)
        .values({ ...rest, viewKey: key, entityId, visibleRoleIdsJson: visibleRoleIds ?? null })
        .returning();
      return created;
    });
    res.status(201).json(serializeView(view));
  } catch (err) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint !== null) {
      mapViewConflict(constraint, res);
      return;
    }
    throw err;
  }
});

router.post("/entities/:entityId/views/reorder", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = ReorderViewsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ReorderViewsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const entityId = params.data.entityId;
  if (parsed.data.entityId !== entityId) {
    res.status(400).json({ error: "entityId in body must match the path" });
    return;
  }
  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const { items } = parsed.data;
  if (items.length === 0) {
    res.json({ success: true, message: "Reordered" });
    return;
  }

  const ids = items.map((i) => i.id);
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ error: "Duplicate view ids in reorder payload" });
    return;
  }
  const owned = await db
    .select({ id: viewsTable.id })
    .from(viewsTable)
    .where(and(eq(viewsTable.entityId, entityId), inArray(viewsTable.id, ids)));
  const ownedIds = new Set(owned.map((v) => v.id));
  const foreign = ids.filter((id) => !ownedIds.has(id));
  if (foreign.length > 0) {
    res.status(400).json({ error: `Some views do not belong to this entity: ${foreign.join(", ")}` });
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(viewsTable)
        .set({ sortOrder: item.sortOrder })
        .where(and(eq(viewsTable.id, item.id), eq(viewsTable.entityId, entityId)));
    }
  });

  res.json({ success: true, message: "Reordered" });
});

router.get("/views/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = GetViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [view] = await db.select().from(viewsTable).where(eq(viewsTable.id, params.data.id)).limit(1);
  if (!view) {
    res.status(404).json({ error: "View not found" });
    return;
  }
  res.json(serializeView(view));
});

router.put("/views/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = UpdateViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateViewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [current] = await db.select().from(viewsTable).where(eq(viewsTable.id, params.data.id)).limit(1);
  if (!current) {
    res.status(404).json({ error: "View not found" });
    return;
  }

  const body = parsed.data;
  const updateData: Record<string, unknown> = {};
  const finalTargetPageId = body.targetPageId !== undefined ? body.targetPageId : current.targetPageId;
  const finalConfig = (body.configJson ?? current.configJson ?? {}) as StoredViewConfig;
  const configError = await validateTargetAndConfig(current.entityId, finalTargetPageId, finalConfig);
  if (configError) { res.status(400).json({ error: configError }); return; }

  if (body.viewKey != null) {
    const key = body.viewKey.trim();
    if (!VIEW_KEY_RE.test(key)) {
      res.status(400).json({
        error: "View key must be lowercase and contain only letters, digits and underscores, starting with a letter",
      });
      return;
    }
    if (await viewKeyTaken(current.entityId, key, current.id)) {
      res.status(409).json({ error: "A view with this key already exists on this entity" });
      return;
    }
    updateData.viewKey = key;
  }

  if (body.nameJson != null) updateData.nameJson = body.nameJson;
  if (body.targetPageId !== undefined) updateData.targetPageId = body.targetPageId;
  if (body.configJson != null) updateData.configJson = body.configJson;
  if (body.visibleRoleIds !== undefined) updateData.visibleRoleIdsJson = body.visibleRoleIds ?? null;
  if (body.isDefault != null) updateData.isDefault = body.isDefault;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    const view = await db.transaction(async (tx) => {
      if ((body.isDefault ?? current.isDefault) === true) {
        const target = finalTargetPageId == null ? isNull(viewsTable.targetPageId) : eq(viewsTable.targetPageId, finalTargetPageId);
        await tx
          .update(viewsTable)
          .set({ isDefault: false })
          .where(and(eq(viewsTable.entityId, current.entityId), target, ne(viewsTable.id, current.id)));
      }
      const [updated] = await tx
        .update(viewsTable)
        .set(updateData)
        .where(eq(viewsTable.id, params.data.id))
        .returning();
      return updated;
    });
    res.json(serializeView(view));
  } catch (err) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint !== null) {
      mapViewConflict(constraint, res);
      return;
    }
    throw err;
  }
});

router.delete("/views/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = DeleteViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(viewsTable)
    .where(eq(viewsTable.id, params.data.id))
    .returning({ id: viewsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "View not found" });
    return;
  }
  res.json({ success: true, message: "View deleted" });
});

export default router;
