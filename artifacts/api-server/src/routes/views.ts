import { Router, type IRouter } from "express";
import { db, viewsTable, entitiesTable } from "@workspace/db";
import { eq, asc, and, ne, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin, getPermissions, getUserRoleIds } from "../middlewares/permissions";
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
  if (constraint === "view_one_default") {
    res.status(409).json({ error: "This entity already has a default view" });
  } else {
    res.status(409).json({ error: "A view with this key already exists on this entity" });
  }
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

router.get("/entities/:entityId/views", requireAuth, async (req, res): Promise<void> => {
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
  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  res.json(views.filter((v) => viewVisibleToRole(v, roleIds, perms.superAdmin)).map(serializeView));
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

  try {
    const view = await db.transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.update(viewsTable).set({ isDefault: false }).where(eq(viewsTable.entityId, entityId));
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

router.get("/views/:id", requireAuth, async (req, res): Promise<void> => {
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
  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  if (!viewVisibleToRole(view, roleIds, perms.superAdmin)) {
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
      if (body.isDefault === true) {
        await tx
          .update(viewsTable)
          .set({ isDefault: false })
          .where(and(eq(viewsTable.entityId, current.entityId), ne(viewsTable.id, current.id)));
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
