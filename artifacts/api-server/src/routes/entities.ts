import { Router, type IRouter } from "express";
import { db, entitiesTable, pagesTable } from "@workspace/db";
import { eq, asc, and, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import {
  CreateEntityBody,
  UpdateEntityBody,
  GetEntityParams,
  UpdateEntityParams,
  DeleteEntityParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const ENTITY_KEY_RE = /^[a-z][a-z0-9_]*$/;

async function validatePageBinding(
  pageId: number,
  excludeEntityId: number | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [page] = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId));
  if (!page) {
    return { ok: false, status: 400, error: "Selected page does not exist" };
  }

  const conflictWhere =
    excludeEntityId != null
      ? and(eq(entitiesTable.pageId, pageId), ne(entitiesTable.id, excludeEntityId))
      : eq(entitiesTable.pageId, pageId);
  const [taken] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(conflictWhere);
  if (taken) {
    return { ok: false, status: 409, error: "This page is already bound to another entity" };
  }

  return { ok: true };
}

router.get("/entities", requireAuth, async (_req, res): Promise<void> => {
  const entities = await db
    .select()
    .from(entitiesTable)
    .orderBy(asc(entitiesTable.sortOrder));

  res.json(entities);
});

router.post("/entities", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const parsed = CreateEntityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const key = parsed.data.entityKey.trim();
  if (!ENTITY_KEY_RE.test(key)) {
    res.status(400).json({
      error: "Entity key must be lowercase and contain only letters, digits and underscores, starting with a letter",
    });
    return;
  }

  const [existing] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.entityKey, key));

  if (existing) {
    res.status(409).json({ error: "An entity with this key already exists" });
    return;
  }

  if (parsed.data.pageId != null) {
    const binding = await validatePageBinding(parsed.data.pageId, null);
    if (!binding.ok) {
      res.status(binding.status).json({ error: binding.error });
      return;
    }
  }

  const [entity] = await db
    .insert(entitiesTable)
    .values({ ...parsed.data, entityKey: key })
    .returning();
  res.status(201).json(entity);
});

router.get("/entities/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetEntityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, params.data.id));

  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  res.json(entity);
});

router.put("/entities/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = UpdateEntityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateEntityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const body = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (body.entityKey != null) {
    const key = body.entityKey.trim();
    if (!ENTITY_KEY_RE.test(key)) {
      res.status(400).json({
        error: "Entity key must be lowercase and contain only letters, digits and underscores, starting with a letter",
      });
      return;
    }
    const [conflict] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(and(eq(entitiesTable.entityKey, key), ne(entitiesTable.id, params.data.id)));
    if (conflict) {
      res.status(409).json({ error: "An entity with this key already exists" });
      return;
    }
    updateData.entityKey = key;
  }

  if (body.nameJson != null) updateData.nameJson = body.nameJson;
  if (body.descriptionJson != null) updateData.descriptionJson = body.descriptionJson;
  if (body.icon != null) updateData.icon = body.icon;
  if ("pageId" in body) {
    const newPageId = body.pageId ?? null;
    if (newPageId != null) {
      const binding = await validatePageBinding(newPageId, params.data.id);
      if (!binding.ok) {
        res.status(binding.status).json({ error: binding.error });
        return;
      }
    }
    updateData.pageId = newPageId;
  }
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [entity] = await db
    .update(entitiesTable)
    .set(updateData)
    .where(eq(entitiesTable.id, params.data.id))
    .returning();

  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  res.json(entity);
});

router.delete("/entities/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = DeleteEntityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(entitiesTable)
    .where(eq(entitiesTable.id, params.data.id))
    .returning({ id: entitiesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  res.json({ success: true, message: "Entity deleted" });
});

export default router;
