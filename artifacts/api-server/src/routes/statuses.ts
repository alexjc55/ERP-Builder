import { Router, type IRouter } from "express";
import { db, entityStatusesTable, entitiesTable } from "@workspace/db";
import { eq, asc, and, ne, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  ListEntityStatusesParams,
  CreateEntityStatusParams,
  CreateEntityStatusBody,
  GetStatusParams,
  UpdateStatusParams,
  UpdateStatusBody,
  DeleteStatusParams,
  ReorderStatusesBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const STATUS_KEY_RE = /^[a-z][a-z0-9_]*$/;

function uniqueViolationConstraint(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505") {
    return (err as { constraint?: string }).constraint ?? "";
  }
  return null;
}

async function entityExists(entityId: number): Promise<boolean> {
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId));
  return Boolean(entity);
}

async function statusKeyTaken(
  entityId: number,
  statusKey: string,
  excludeStatusId: number | null,
): Promise<boolean> {
  const where =
    excludeStatusId != null
      ? and(
          eq(entityStatusesTable.entityId, entityId),
          eq(entityStatusesTable.statusKey, statusKey),
          ne(entityStatusesTable.id, excludeStatusId),
        )
      : and(eq(entityStatusesTable.entityId, entityId), eq(entityStatusesTable.statusKey, statusKey));
  const [taken] = await db
    .select({ id: entityStatusesTable.id })
    .from(entityStatusesTable)
    .where(where);
  return Boolean(taken);
}

router.get("/entities/:entityId/statuses", requireAuth, async (req, res): Promise<void> => {
  const params = ListEntityStatusesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (!(await entityExists(params.data.entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const statuses = await db
    .select()
    .from(entityStatusesTable)
    .where(eq(entityStatusesTable.entityId, params.data.entityId))
    .orderBy(asc(entityStatusesTable.sortOrder));

  res.json(statuses);
});

router.post("/entities/:entityId/statuses", requireAuth, async (req, res): Promise<void> => {
  const params = CreateEntityStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateEntityStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const entityId = params.data.entityId;
  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const key = parsed.data.statusKey.trim();
  if (!STATUS_KEY_RE.test(key)) {
    res.status(400).json({
      error: "Status key must be lowercase and contain only letters, digits and underscores, starting with a letter",
    });
    return;
  }

  if (await statusKeyTaken(entityId, key, null)) {
    res.status(409).json({ error: "A status with this key already exists on this entity" });
    return;
  }

  try {
    const status = await db.transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx
          .update(entityStatusesTable)
          .set({ isDefault: false })
          .where(eq(entityStatusesTable.entityId, entityId));
      }
      const [created] = await tx
        .insert(entityStatusesTable)
        .values({ ...parsed.data, statusKey: key, entityId })
        .returning();
      return created;
    });
    res.status(201).json(status);
  } catch (err) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint !== null) {
      if (constraint === "entity_status_one_default") {
        res.status(409).json({ error: "This entity already has a default status" });
      } else {
        res.status(409).json({ error: "A status with this key already exists on this entity" });
      }
      return;
    }
    throw err;
  }
});

router.post("/statuses/reorder", requireAuth, async (req, res): Promise<void> => {
  const parsed = ReorderStatusesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { entityId, items } = parsed.data;

  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  if (items.length === 0) {
    res.json({ success: true, message: "Reordered" });
    return;
  }

  const ids = items.map((i) => i.id);
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ error: "Duplicate status ids in reorder payload" });
    return;
  }
  const owned = await db
    .select({ id: entityStatusesTable.id })
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.entityId, entityId), inArray(entityStatusesTable.id, ids)));
  const ownedIds = new Set(owned.map((s) => s.id));

  const foreign = ids.filter((id) => !ownedIds.has(id));
  if (foreign.length > 0) {
    res.status(400).json({ error: `Some statuses do not belong to this entity: ${foreign.join(", ")}` });
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(entityStatusesTable)
        .set({ sortOrder: item.sortOrder })
        .where(and(eq(entityStatusesTable.id, item.id), eq(entityStatusesTable.entityId, entityId)));
    }
  });

  res.json({ success: true, message: "Reordered" });
});

router.get("/statuses/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [status] = await db
    .select()
    .from(entityStatusesTable)
    .where(eq(entityStatusesTable.id, params.data.id));

  if (!status) {
    res.status(404).json({ error: "Status not found" });
    return;
  }

  res.json(status);
});

router.put("/statuses/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [current] = await db
    .select()
    .from(entityStatusesTable)
    .where(eq(entityStatusesTable.id, params.data.id));

  if (!current) {
    res.status(404).json({ error: "Status not found" });
    return;
  }

  const body = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (body.statusKey != null) {
    const key = body.statusKey.trim();
    if (!STATUS_KEY_RE.test(key)) {
      res.status(400).json({
        error: "Status key must be lowercase and contain only letters, digits and underscores, starting with a letter",
      });
      return;
    }
    if (await statusKeyTaken(current.entityId, key, current.id)) {
      res.status(409).json({ error: "A status with this key already exists on this entity" });
      return;
    }
    updateData.statusKey = key;
  }

  if (body.nameJson != null) updateData.nameJson = body.nameJson;
  if (body.color != null) updateData.color = body.color;
  if (body.isDefault != null) updateData.isDefault = body.isDefault;
  if (body.isFinal != null) updateData.isFinal = body.isFinal;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    const status = await db.transaction(async (tx) => {
      if (body.isDefault === true) {
        await tx
          .update(entityStatusesTable)
          .set({ isDefault: false })
          .where(and(eq(entityStatusesTable.entityId, current.entityId), ne(entityStatusesTable.id, current.id)));
      }
      const [updated] = await tx
        .update(entityStatusesTable)
        .set(updateData)
        .where(eq(entityStatusesTable.id, params.data.id))
        .returning();
      return updated;
    });
    res.json(status);
  } catch (err) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint !== null) {
      if (constraint === "entity_status_one_default") {
        res.status(409).json({ error: "This entity already has a default status" });
      } else {
        res.status(409).json({ error: "A status with this key already exists on this entity" });
      }
      return;
    }
    throw err;
  }
});

router.delete("/statuses/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(entityStatusesTable)
    .where(eq(entityStatusesTable.id, params.data.id))
    .returning({ id: entityStatusesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Status not found" });
    return;
  }

  res.json({ success: true, message: "Status deleted" });
});

export default router;
