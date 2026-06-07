import { Router, type IRouter } from "express";
import { db, pagesTable, entitiesTable } from "@workspace/db";
import { eq, isNull, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import {
  CreatePageBody,
  UpdatePageBody,
  GetPageParams,
  UpdatePageParams,
  DeletePageParams,
  ReorderPagesBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function buildTree(pages: typeof pagesTable.$inferSelect[]): unknown[] {
  const map = new Map<number, unknown>();
  const roots: unknown[] = [];

  for (const page of pages) {
    map.set(page.id, { ...page, children: [] });
  }

  for (const page of pages) {
    const node = map.get(page.id) as { children: unknown[] };
    if (page.parentPageId && map.has(page.parentPageId)) {
      const parent = map.get(page.parentPageId) as { children: unknown[] };
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

router.get("/pages", requireAuth, async (_req, res): Promise<void> => {
  const pages = await db
    .select()
    .from(pagesTable)
    .orderBy(asc(pagesTable.sortOrder));

  res.json(pages);
});

router.post("/pages/reorder", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const parsed = ReorderPagesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of parsed.data.items) {
      await tx
        .update(pagesTable)
        .set({ sortOrder: item.sortOrder })
        .where(eq(pagesTable.id, item.id));
    }
  });

  res.json({ success: true, message: "Reordered" });
});

/** True if the entity exists (used to validate a page's mirror target). */
async function entityExists(entityId: number): Promise<boolean> {
  const [e] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  return Boolean(e);
}

/** True if some entity is bound to this page (entities.page_id === pageId). */
async function pageHasBoundEntity(pageId: number): Promise<boolean> {
  const [e] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.pageId, pageId))
    .limit(1);
  return Boolean(e);
}

router.post("/pages", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const parsed = CreatePageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.mirrorEntityId != null && !(await entityExists(parsed.data.mirrorEntityId))) {
    res.status(400).json({ error: "Mirror entity not found" });
    return;
  }

  const [page] = await db.insert(pagesTable).values(parsed.data).returning();
  res.status(201).json({ ...page, children: [] });
});

router.get("/pages/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetPageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [page] = await db
    .select()
    .from(pagesTable)
    .where(eq(pagesTable.id, params.data.id));

  if (!page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  res.json({ ...page, children: [] });
});

router.put("/pages/:id", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = UpdatePageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  const body = parsed.data;
  if (body.nameJson != null) updateData.nameJson = body.nameJson;
  if (body.descriptionJson != null) updateData.descriptionJson = body.descriptionJson;
  if (body.icon != null) updateData.icon = body.icon;
  if ("path" in body) updateData.path = body.path ?? null;
  if ("parentPageId" in body) updateData.parentPageId = body.parentPageId ?? null;
  if ("mirrorEntityId" in body) updateData.mirrorEntityId = body.mirrorEntityId ?? null;
  if ("mirrorFieldKeysJson" in body) updateData.mirrorFieldKeysJson = body.mirrorFieldKeysJson ?? null;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;

  if (body.parentPageId != null && body.parentPageId === params.data.id) {
    res.status(400).json({ error: "A page cannot be its own parent" });
    return;
  }

  if (body.mirrorEntityId != null && !(await entityExists(body.mirrorEntityId))) {
    res.status(400).json({ error: "Mirror entity not found" });
    return;
  }

  if (body.mirrorEntityId != null && (await pageHasBoundEntity(params.data.id))) {
    res.status(409).json({
      error: "This page already has a bound entity; it cannot also mirror an entity",
    });
    return;
  }

  const [page] = await db
    .update(pagesTable)
    .set(updateData)
    .where(eq(pagesTable.id, params.data.id))
    .returning();

  if (!page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  res.json({ ...page, children: [] });
});

router.delete("/pages/:id", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = DeletePageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const children = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.parentPageId, params.data.id));

  if (children.length > 0) {
    res.status(409).json({ error: "Cannot delete a page that has sub-pages" });
    return;
  }

  const [deleted] = await db
    .delete(pagesTable)
    .where(eq(pagesTable.id, params.data.id))
    .returning({ id: pagesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Page not found" });
    return;
  }

  res.json({ success: true, message: "Page deleted" });
});

export default router;
