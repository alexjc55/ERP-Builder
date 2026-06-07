import { Router, type IRouter } from "express";
import {
  db,
  entityTransitionsTable,
  entityStatusesTable,
  entityFieldsTable,
  entitiesTable,
  rolesTable,
} from "@workspace/db";
import { eq, asc, and, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import {
  ListEntityTransitionsParams,
  CreateEntityTransitionParams,
  CreateEntityTransitionBody,
  GetTransitionParams,
  UpdateTransitionParams,
  UpdateTransitionBody,
  DeleteTransitionParams,
  ReorderTransitionsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

/** Unwrap drizzle's query-error wrapper to find the underlying pg error. */
function pgError(err: unknown): { code?: string; constraint?: string } | null {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    if ("code" in e && typeof (e as { code?: unknown }).code === "string") {
      return e as { code?: string; constraint?: string };
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

function uniqueViolationConstraint(err: unknown): string | null {
  const e = pgError(err);
  if (e && e.code === "23505") return e.constraint ?? "";
  return null;
}

async function entityExists(entityId: number): Promise<boolean> {
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  return Boolean(entity);
}

/** True if all given status ids belong to the entity. */
async function statusesBelongToEntity(entityId: number, statusIds: number[]): Promise<boolean> {
  const ids = [...new Set(statusIds)];
  if (ids.length === 0) return true;
  const rows = await db
    .select({ id: entityStatusesTable.id })
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.entityId, entityId), inArray(entityStatusesTable.id, ids)));
  return rows.length === ids.length;
}

/** True if all given role ids exist. */
async function rolesExist(roleIds: number[]): Promise<boolean> {
  const ids = [...new Set(roleIds)];
  if (ids.length === 0) return true;
  const rows = await db.select({ id: rolesTable.id }).from(rolesTable).where(inArray(rolesTable.id, ids));
  return rows.length === ids.length;
}

/** The set of active field keys for an entity. */
async function activeFieldKeys(entityId: number): Promise<Set<string>> {
  const rows = await db
    .select({ fieldKey: entityFieldsTable.fieldKey })
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  return new Set(rows.map((r) => r.fieldKey));
}

type ActionInput = { type: "set_field"; fieldKey: string; value?: unknown };

/**
 * Validate that the transition's field references (required keys + set_field
 * action keys) all point at active fields of the entity. Returns an error
 * message or null.
 */
async function validateFieldRefs(
  entityId: number,
  requiredFieldKeys: string[] | undefined,
  actionsJson: ActionInput[] | undefined,
): Promise<string | null> {
  const required = requiredFieldKeys ?? [];
  const actions = actionsJson ?? [];
  if (required.length === 0 && actions.length === 0) return null;
  const keys = await activeFieldKeys(entityId);
  for (const k of required) {
    if (!keys.has(k)) return `Unknown field in requiredFieldKeys: ${k}`;
  }
  for (const a of actions) {
    if (!keys.has(a.fieldKey)) return `Unknown field in action: ${a.fieldKey}`;
  }
  return null;
}

router.get("/entities/:entityId/transitions", requireAuth, async (req, res): Promise<void> => {
  const params = ListEntityTransitionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await entityExists(params.data.entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const transitions = await db
    .select()
    .from(entityTransitionsTable)
    .where(eq(entityTransitionsTable.entityId, params.data.entityId))
    .orderBy(asc(entityTransitionsTable.sortOrder));
  res.json(transitions);
});

router.post(
  "/entities/:entityId/transitions",
  requireAuth,
  requireAdmin("entities"),
  async (req, res): Promise<void> => {
    const params = CreateEntityTransitionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CreateEntityTransitionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const entityId = params.data.entityId;
    if (!(await entityExists(entityId))) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    const body = parsed.data;

    // fromStatusId may be null ("from any status"); only check non-null ids.
    const statusIdsToCheck = [body.toStatusId, ...(body.fromStatusId != null ? [body.fromStatusId] : [])];
    if (!(await statusesBelongToEntity(entityId, statusIdsToCheck))) {
      res.status(400).json({ error: "from/to status does not belong to this entity" });
      return;
    }
    if (!(await rolesExist(body.allowedRoleIds ?? []))) {
      res.status(400).json({ error: "Some allowed roles do not exist" });
      return;
    }
    const fieldErr = await validateFieldRefs(entityId, body.requiredFieldKeys, body.actionsJson as ActionInput[]);
    if (fieldErr) {
      res.status(400).json({ error: fieldErr });
      return;
    }

    try {
      const [created] = await db
        .insert(entityTransitionsTable)
        .values({
          entityId,
          fromStatusId: body.fromStatusId ?? null,
          toStatusId: body.toStatusId,
          nameJson: body.nameJson ?? {},
          allowedRoleIds: body.allowedRoleIds ?? [],
          requiredFieldKeys: body.requiredFieldKeys ?? [],
          actionsJson: (body.actionsJson ?? []) as ActionInput[],
          sortOrder: body.sortOrder ?? 0,
        })
        .returning();
      res.status(201).json(created);
    } catch (err) {
      if (uniqueViolationConstraint(err) !== null) {
        res.status(409).json({ error: "A transition between these statuses already exists" });
        return;
      }
      throw err;
    }
  },
);

router.post("/transitions/reorder", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const parsed = ReorderTransitionsBody.safeParse(req.body);
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
    res.status(400).json({ error: "Duplicate transition ids in reorder payload" });
    return;
  }
  const owned = await db
    .select({ id: entityTransitionsTable.id })
    .from(entityTransitionsTable)
    .where(and(eq(entityTransitionsTable.entityId, entityId), inArray(entityTransitionsTable.id, ids)));
  const ownedIds = new Set(owned.map((t) => t.id));

  const foreign = ids.filter((id) => !ownedIds.has(id));
  if (foreign.length > 0) {
    res.status(400).json({ error: `Some transitions do not belong to this entity: ${foreign.join(", ")}` });
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(entityTransitionsTable)
        .set({ sortOrder: item.sortOrder })
        .where(and(eq(entityTransitionsTable.id, item.id), eq(entityTransitionsTable.entityId, entityId)));
    }
  });

  res.json({ success: true, message: "Reordered" });
});

router.get("/transitions/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetTransitionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [transition] = await db
    .select()
    .from(entityTransitionsTable)
    .where(eq(entityTransitionsTable.id, params.data.id));
  if (!transition) {
    res.status(404).json({ error: "Transition not found" });
    return;
  }
  res.json(transition);
});

router.put("/transitions/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = UpdateTransitionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTransitionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [current] = await db
    .select()
    .from(entityTransitionsTable)
    .where(eq(entityTransitionsTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "Transition not found" });
    return;
  }
  const body = parsed.data;
  const entityId = current.entityId;

  // Distinguish "field omitted" (keep current) from "field set to null" (any status).
  const fromProvided = "fromStatusId" in body;
  const fromStatusId = fromProvided ? (body.fromStatusId ?? null) : current.fromStatusId;
  const toStatusId = body.toStatusId ?? current.toStatusId;
  if (fromProvided || body.toStatusId != null) {
    const statusIdsToCheck = [toStatusId, ...(fromStatusId != null ? [fromStatusId] : [])];
    if (!(await statusesBelongToEntity(entityId, statusIdsToCheck))) {
      res.status(400).json({ error: "from/to status does not belong to this entity" });
      return;
    }
  }
  if (body.allowedRoleIds != null && !(await rolesExist(body.allowedRoleIds))) {
    res.status(400).json({ error: "Some allowed roles do not exist" });
    return;
  }
  if (body.requiredFieldKeys != null || body.actionsJson != null) {
    const fieldErr = await validateFieldRefs(
      entityId,
      body.requiredFieldKeys ?? (current.requiredFieldKeys as string[]),
      (body.actionsJson ?? current.actionsJson) as ActionInput[],
    );
    if (fieldErr) {
      res.status(400).json({ error: fieldErr });
      return;
    }
  }

  const updateData: Record<string, unknown> = {};
  if (fromProvided) updateData.fromStatusId = body.fromStatusId ?? null;
  if (body.toStatusId != null) updateData.toStatusId = body.toStatusId;
  if (body.nameJson != null) updateData.nameJson = body.nameJson;
  if (body.allowedRoleIds != null) updateData.allowedRoleIds = body.allowedRoleIds;
  if (body.requiredFieldKeys != null) updateData.requiredFieldKeys = body.requiredFieldKeys;
  if (body.actionsJson != null) updateData.actionsJson = body.actionsJson;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    const [updated] = await db
      .update(entityTransitionsTable)
      .set(updateData)
      .where(eq(entityTransitionsTable.id, params.data.id))
      .returning();
    res.json(updated);
  } catch (err) {
    if (uniqueViolationConstraint(err) !== null) {
      res.status(409).json({ error: "A transition between these statuses already exists" });
      return;
    }
    throw err;
  }
});

router.delete("/transitions/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = DeleteTransitionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(entityTransitionsTable)
    .where(eq(entityTransitionsTable.id, params.data.id))
    .returning({ id: entityTransitionsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Transition not found" });
    return;
  }
  res.json({ success: true, message: "Transition deleted" });
});

export default router;
