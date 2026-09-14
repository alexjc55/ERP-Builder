import { Router, type IRouter } from "express";
import { db, entityStatusesTable, entitiesTable, tagsTable, statusTagsTable, type EntityStatus } from "@workspace/db";
import { eq, asc, and, ne, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
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

const intIds = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : [];

/** Tags are global, but this first release deliberately permits only status tags. */
async function validateStatusTagIds(value: unknown): Promise<{ tagIds: number[] } | { error: string }> {
  const tagIds = [...new Set(intIds(value))];
  if (tagIds.length === 0) return { tagIds };
  const tags = await db.select({ id: tagsTable.id, applicableTo: tagsTable.applicableTo })
    .from(tagsTable).where(inArray(tagsTable.id, tagIds));
  if (tags.length !== tagIds.length || tags.some((tag) => !tag.applicableTo.includes("statuses"))) {
    return { error: "One or more tags do not exist or cannot be applied to statuses" };
  }
  return { tagIds };
}

async function withTagIds(statuses: EntityStatus[]): Promise<Array<EntityStatus & { tagIds: number[] }>> {
  if (statuses.length === 0) return [];
  const ids = statuses.map((status) => status.id);
  const links = await db.select().from(statusTagsTable).where(inArray(statusTagsTable.statusId, ids));
  const byStatus = new Map<number, number[]>();
  for (const link of links) {
    const tagIds = byStatus.get(link.statusId) ?? [];
    tagIds.push(link.tagId);
    byStatus.set(link.statusId, tagIds);
  }
  return statuses.map((status) => ({ ...status, tagIds: byStatus.get(status.id) ?? [] }));
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

  res.json(await withTagIds(statuses));
});

router.post("/entities/:entityId/statuses", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
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
  const tagCheck = await validateStatusTagIds(parsed.data.tagIds);
  if ("error" in tagCheck) {
    res.status(400).json({ error: tagCheck.error });
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
      const { tagIds: _tagIds, ...statusInput } = parsed.data;
      const [created] = await tx
        .insert(entityStatusesTable)
        .values({ ...statusInput, statusKey: key, entityId })
        .returning();
      if (tagCheck.tagIds.length > 0) {
        await tx.insert(statusTagsTable).values(tagCheck.tagIds.map((tagId) => ({ statusId: created.id, tagId })));
      }
      return { ...created, tagIds: tagCheck.tagIds };
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

router.post("/statuses/reorder", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
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

  res.json((await withTagIds([status]))[0]);
});

router.put("/statuses/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
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
  if (body.isArchiveTrigger != null) updateData.isArchiveTrigger = body.isArchiveTrigger;
  if (body.archiveAfterDays != null) {
    if (!Number.isInteger(body.archiveAfterDays) || body.archiveAfterDays < 0) {
      res.status(400).json({ error: "archiveAfterDays must be a non-negative integer" });
      return;
    }
    updateData.archiveAfterDays = body.archiveAfterDays;
  }
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;
  let tagIds: number[] | undefined;
  if (body.tagIds != null) {
    const tagCheck = await validateStatusTagIds(body.tagIds);
    if ("error" in tagCheck) {
      res.status(400).json({ error: tagCheck.error });
      return;
    }
    tagIds = tagCheck.tagIds;
  }

  if (Object.keys(updateData).length === 0 && tagIds === undefined) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const existingTagIds = tagIds === undefined ? (await withTagIds([current]))[0].tagIds : tagIds;

  try {
    const status = await db.transaction(async (tx) => {
      if (body.isDefault === true) {
        await tx
          .update(entityStatusesTable)
          .set({ isDefault: false })
          .where(and(eq(entityStatusesTable.entityId, current.entityId), ne(entityStatusesTable.id, current.id)));
      }
      const updated = Object.keys(updateData).length > 0
        ? (await tx
            .update(entityStatusesTable)
            .set(updateData)
            .where(eq(entityStatusesTable.id, params.data.id))
            .returning())[0]!
        : current;
      if (tagIds !== undefined) {
        await tx.delete(statusTagsTable).where(eq(statusTagsTable.statusId, current.id));
        if (tagIds.length > 0) {
          await tx.insert(statusTagsTable).values(tagIds.map((tagId) => ({ statusId: current.id, tagId })));
        }
      }
      return { ...updated, tagIds: existingTagIds };
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

router.delete("/statuses/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
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
