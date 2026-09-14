import { Router, type IRouter } from "express";
import { db, tagsTable, statusTagsTable, rolesTable, dashboardWidgetsTable } from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import { lockStatusTagReferences } from "../lib/status-tag-lock";
import {
  CreateTagBody,
  UpdateTagParams,
  UpdateTagBody,
  DeleteTagParams,
  ReorderTagsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const intIds = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : [];

function configReferencesTag(value: unknown, tagId: number): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => configReferencesTag(item, tagId));
  const object = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(object)) {
    if (
      (key === "hiddenStatusTagIds" || key === "hiddenRowStatusTagIds" || key === "statusTagIds") &&
      intIds(child).includes(tagId)
    ) return true;
    if (configReferencesTag(child, tagId)) return true;
  }
  return false;
}

type TagReferenceReader = Pick<typeof db, "select">;

async function tagIsReferenced(tagId: number, reader: TagReferenceReader = db): Promise<boolean> {
  const [assignment] = await reader.select({ tagId: statusTagsTable.tagId }).from(statusTagsTable)
    .where(eq(statusTagsTable.tagId, tagId)).limit(1);
  if (assignment) return true;
  const roles = await reader.select({ permissionsJson: rolesTable.permissionsJson }).from(rolesTable);
  if (roles.some((role) => configReferencesTag(role.permissionsJson, tagId))) return true;
  const widgets = await reader.select({ configJson: dashboardWidgetsTable.configJson }).from(dashboardWidgetsTable);
  return widgets.some((widget) => configReferencesTag(widget.configJson, tagId));
}

router.get("/tags", requireAuth, async (_req, res): Promise<void> => {
  res.json(await db.select().from(tagsTable).orderBy(asc(tagsTable.sortOrder), asc(tagsTable.id)));
});

router.post("/tags", requireAuth, requireAdmin("tags"), async (req, res): Promise<void> => {
  const body = CreateTagBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const applicableTo = body.data.applicableTo ?? ["statuses"];
  if (!applicableTo.includes("statuses")) {
    res.status(400).json({ error: "A global tag must be applicable to statuses" });
    return;
  }
  const [tag] = await db.insert(tagsTable).values({ ...body.data, applicableTo: ["statuses"] }).returning();
  res.status(201).json(tag);
});

router.put("/tags/:id", requireAuth, requireAdmin("tags"), async (req, res): Promise<void> => {
  const params = UpdateTagParams.safeParse(req.params);
  const body = UpdateTagBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const update: Record<string, unknown> = {};
  if (body.data.nameJson != null) update.nameJson = body.data.nameJson;
  if (body.data.color != null) update.color = body.data.color;
  if (body.data.sortOrder != null) update.sortOrder = body.data.sortOrder;
  if (body.data.applicableTo != null) {
    if (!body.data.applicableTo.includes("statuses")) {
      res.status(400).json({ error: "A global tag must be applicable to statuses" });
      return;
    }
    update.applicableTo = ["statuses"];
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [tag] = await db.update(tagsTable).set(update).where(eq(tagsTable.id, params.data.id)).returning();
  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }
  res.json(tag);
});

router.post("/tags/reorder", requireAuth, requireAdmin("tags"), async (req, res): Promise<void> => {
  const body = ReorderTagsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const ids = body.data.items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ error: "Duplicate tag ids in reorder payload" });
    return;
  }
  const existing = ids.length === 0 ? [] : await db.select({ id: tagsTable.id }).from(tagsTable).where(inArray(tagsTable.id, ids));
  if (existing.length !== ids.length) {
    res.status(400).json({ error: "Some tags do not exist" });
    return;
  }
  await db.transaction(async (tx) => {
    for (const item of body.data.items) {
      await tx.update(tagsTable).set({ sortOrder: item.sortOrder }).where(eq(tagsTable.id, item.id));
    }
  });
  res.json({ success: true, message: "Reordered" });
});

router.delete("/tags/:id", requireAuth, requireAdmin("tags"), async (req, res): Promise<void> => {
  const params = DeleteTagParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const outcome = await db.transaction(async (tx) => {
    await lockStatusTagReferences(tx);
    const [tag] = await tx.select({ id: tagsTable.id }).from(tagsTable).where(eq(tagsTable.id, params.data.id)).limit(1);
    if (!tag) return "missing" as const;
    if (await tagIsReferenced(tag.id, tx)) return "referenced" as const;
    await tx.delete(tagsTable).where(eq(tagsTable.id, tag.id));
    return "deleted" as const;
  });
  if (outcome === "missing") {
    res.status(404).json({ error: "Tag not found" });
    return;
  }
  if (outcome === "referenced") {
    res.status(409).json({ error: "Tag is assigned or referenced and cannot be deleted" });
    return;
  }
  res.json({ success: true, message: "Tag deleted" });
});

export default router;