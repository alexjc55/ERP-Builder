import { Router, type IRouter } from "express";
import { db, columnGroupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import {
  CreateColumnGroupBody,
  UpdateColumnGroupBody,
  GetColumnGroupParams,
  UpdateColumnGroupParams,
  DeleteColumnGroupParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Column Groups — a GLOBAL, page-independent list of column groups.
 *
 * A group carries a multilingual name, a color, and a `displayMode` that drives
 * how grouped columns render on the records-table header ("bar" = thin colored
 * top-border + tooltip; "fill" = filled header cell + configurable text color).
 *
 * Columns point at a group by id: the base lives on the field
 * (`entity_fields.columnGroupId` / `page_fields.columnGroupId`) and may be
 * overridden per mirror page via `pages.columnGroupsJson`. Deleting a group is
 * "soft" from the columns' perspective — dangling pointers just stop rendering.
 *
 * READS are auth-only: group definitions are pure display metadata (name/color/
 * mode) used to paint the records-table header bar/fill for EVERY viewer, so any
 * authenticated user (incl. non-admins and guests) must be able to fetch them —
 * they are not a security boundary. MUTATIONS stay gated by the `columnGroups`
 * admin capability (superAdmin bypasses).
 */
router.get("/column-groups", requireAuth, async (_req, res): Promise<void> => {
  const groups = await db
    .select()
    .from(columnGroupsTable)
    .orderBy(columnGroupsTable.sortOrder, columnGroupsTable.id);
  res.json(groups);
});

router.post("/column-groups", requireAuth, requireAdmin("columnGroups"), async (req, res): Promise<void> => {
  const parsed = CreateColumnGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [group] = await db
    .insert(columnGroupsTable)
    .values({
      nameJson: parsed.data.nameJson,
      color: parsed.data.color,
      displayMode: parsed.data.displayMode,
      textColor: parsed.data.textColor ?? null,
      ...(parsed.data.sortOrder != null ? { sortOrder: parsed.data.sortOrder } : {}),
    })
    .returning();
  res.status(201).json(group);
});

router.get("/column-groups/:id", requireAuth, requireAdmin("columnGroups"), async (req, res): Promise<void> => {
  const params = GetColumnGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [group] = await db
    .select()
    .from(columnGroupsTable)
    .where(eq(columnGroupsTable.id, params.data.id));

  if (!group) {
    res.status(404).json({ error: "Column group not found" });
    return;
  }

  res.json(group);
});

router.put("/column-groups/:id", requireAuth, requireAdmin("columnGroups"), async (req, res): Promise<void> => {
  const params = UpdateColumnGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateColumnGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.nameJson != null) updateData.nameJson = parsed.data.nameJson;
  if (parsed.data.color != null) updateData.color = parsed.data.color;
  if (parsed.data.displayMode != null) updateData.displayMode = parsed.data.displayMode;
  if ("textColor" in parsed.data) updateData.textColor = parsed.data.textColor ?? null;
  if (parsed.data.sortOrder != null) updateData.sortOrder = parsed.data.sortOrder;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [group] = await db
    .update(columnGroupsTable)
    .set(updateData)
    .where(eq(columnGroupsTable.id, params.data.id))
    .returning();

  if (!group) {
    res.status(404).json({ error: "Column group not found" });
    return;
  }

  res.json(group);
});

router.delete("/column-groups/:id", requireAuth, requireAdmin("columnGroups"), async (req, res): Promise<void> => {
  const params = DeleteColumnGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(columnGroupsTable)
    .where(eq(columnGroupsTable.id, params.data.id))
    .returning({ id: columnGroupsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Column group not found" });
    return;
  }

  res.json({ success: true, message: "Column group deleted" });
});

export default router;
