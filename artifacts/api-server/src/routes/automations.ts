import { Router, type IRouter } from "express";
import {
  db,
  entityAutomationsTable,
  entityAutomationRunsTable,
  entitiesTable,
  entityFieldsTable,
  entityStatusesTable,
  automationTriggerSchema,
  automationConditionSchema,
  automationActionSchema,
  CONDITION_STATUS_KEY,
  type AutomationTrigger,
  type AutomationCondition,
  type AutomationAction,
} from "@workspace/db";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import {
  ListEntityAutomationsParams,
  CreateEntityAutomationParams,
  CreateEntityAutomationBody,
  ListEntityAutomationRunsParams,
  GetAutomationParams,
  UpdateAutomationParams,
  UpdateAutomationBody,
  DeleteAutomationParams,
  ReorderAutomationsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function entityExists(entityId: number): Promise<boolean> {
  const [entity] = await db.select({ id: entitiesTable.id }).from(entitiesTable).where(eq(entitiesTable.id, entityId)).limit(1);
  return Boolean(entity);
}

async function activeFieldKeys(entityId: number): Promise<Set<string>> {
  const rows = await db
    .select({ fieldKey: entityFieldsTable.fieldKey })
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  return new Set(rows.map((r) => r.fieldKey));
}

async function statusIdsOf(entityId: number): Promise<Set<number>> {
  const rows = await db.select({ id: entityStatusesTable.id }).from(entityStatusesTable).where(eq(entityStatusesTable.entityId, entityId));
  return new Set(rows.map((r) => r.id));
}

/**
 * Deep-validate a trigger/conditions/actions payload against the entity's real
 * fields, statuses, and target entities. The OpenAPI/Orval body schema only
 * checks shape; this enforces referential integrity. Returns an error or null.
 */
async function validateSpec(
  entityId: number,
  trigger: AutomationTrigger,
  conditions: AutomationCondition[],
  actions: AutomationAction[],
): Promise<string | null> {
  const keys = await activeFieldKeys(entityId);
  const statusIds = await statusIdsOf(entityId);

  // Trigger field/status references.
  if (trigger.type === "field_changed" && !keys.has(trigger.fieldKey)) return `Unknown trigger field: ${trigger.fieldKey}`;
  if (trigger.type === "date_reached" && !keys.has(trigger.fieldKey)) return `Unknown trigger field: ${trigger.fieldKey}`;
  if (trigger.type === "status_changed") {
    if (trigger.fromStatusId != null && !statusIds.has(trigger.fromStatusId)) return "Unknown trigger fromStatus";
    if (trigger.toStatusId != null && !statusIds.has(trigger.toStatusId)) return "Unknown trigger toStatus";
  }

  const checkCondition = (c: AutomationCondition, validKeys: Set<string>): string | null => {
    if (c.fieldKey === CONDITION_STATUS_KEY) return null;
    if (!validKeys.has(c.fieldKey)) return `Unknown condition field: ${c.fieldKey}`;
    return null;
  };
  for (const c of conditions) {
    const err = checkCondition(c, keys);
    if (err) return err;
  }

  // Cache target-entity field sets so cross-entity actions are validated too.
  const targetKeysCache = new Map<number, Set<string>>();
  const targetKeysFor = async (id: number): Promise<Set<string> | null> => {
    if (targetKeysCache.has(id)) return targetKeysCache.get(id)!;
    if (!(await entityExists(id))) return null;
    const k = await activeFieldKeys(id);
    targetKeysCache.set(id, k);
    return k;
  };
  const targetStatusCache = new Map<number, Set<number>>();
  const targetStatusFor = async (id: number): Promise<Set<number>> => {
    if (targetStatusCache.has(id)) return targetStatusCache.get(id)!;
    const s = await statusIdsOf(id);
    targetStatusCache.set(id, s);
    return s;
  };

  for (const a of actions) {
    if (a.type === "set_field") {
      if (!keys.has(a.fieldKey)) return `Unknown field in set_field action: ${a.fieldKey}`;
    } else if (a.type === "change_status") {
      if (!statusIds.has(a.statusId)) return "Unknown status in change_status action";
    } else if (a.type === "create_record" || a.type === "update_records_where") {
      const tk = await targetKeysFor(a.targetEntityId);
      if (!tk) return `Unknown target entity: ${a.targetEntityId}`;
      for (const m of a.mapping ?? []) {
        if (!tk.has(m.targetFieldKey)) return `Unknown target field in mapping: ${m.targetFieldKey}`;
        if (m.sourceType === "field" && (!m.sourceFieldKey || !keys.has(m.sourceFieldKey)))
          return `Unknown source field in mapping: ${m.sourceFieldKey ?? "(none)"}`;
      }
      if (a.type === "create_record" && a.statusId != null) {
        const ts = await targetStatusFor(a.targetEntityId);
        if (!ts.has(a.statusId)) return "Unknown status in create_record action";
      }
      if (a.type === "update_records_where") {
        for (const c of a.match ?? []) {
          const err = checkCondition(c, tk);
          if (err) return err.replace("condition field", "match field");
        }
      }
    }
    // webhook needs no entity validation (URL checked at run time).
  }
  return null;
}

router.get("/entities/:entityId/automations", requireAuth, requireAdmin("automations"), async (req, res): Promise<void> => {
  const params = ListEntityAutomationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await entityExists(params.data.entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const automations = await db
    .select()
    .from(entityAutomationsTable)
    .where(eq(entityAutomationsTable.entityId, params.data.entityId))
    .orderBy(asc(entityAutomationsTable.sortOrder));
  res.json(automations);
});

router.post("/entities/:entityId/automations", requireAuth, requireAdmin("automations"), async (req, res): Promise<void> => {
  const params = CreateEntityAutomationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateEntityAutomationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const entityId = params.data.entityId;
  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const trigger = automationTriggerSchema.safeParse(parsed.data.triggerJson);
  if (!trigger.success) {
    res.status(400).json({ error: `Invalid trigger: ${trigger.error.message}` });
    return;
  }
  const conditions = automationConditionSchema.array().safeParse(parsed.data.conditionsJson ?? []);
  if (!conditions.success) {
    res.status(400).json({ error: `Invalid conditions: ${conditions.error.message}` });
    return;
  }
  const actions = automationActionSchema.array().safeParse(parsed.data.actionsJson ?? []);
  if (!actions.success) {
    res.status(400).json({ error: `Invalid actions: ${actions.error.message}` });
    return;
  }
  const refErr = await validateSpec(entityId, trigger.data, conditions.data, actions.data);
  if (refErr) {
    res.status(400).json({ error: refErr });
    return;
  }

  const [created] = await db
    .insert(entityAutomationsTable)
    .values({
      entityId,
      nameJson: parsed.data.nameJson ?? {},
      isActive: parsed.data.isActive ?? true,
      triggerJson: trigger.data,
      conditionsJson: conditions.data,
      actionsJson: actions.data,
      sortOrder: parsed.data.sortOrder ?? 0,
    })
    .returning();
  res.status(201).json(created);
});

router.post("/automations/reorder", requireAuth, requireAdmin("automations"), async (req, res): Promise<void> => {
  const parsed = ReorderAutomationsBody.safeParse(req.body);
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
    res.status(400).json({ error: "Duplicate automation ids in reorder payload" });
    return;
  }
  const owned = await db
    .select({ id: entityAutomationsTable.id })
    .from(entityAutomationsTable)
    .where(and(eq(entityAutomationsTable.entityId, entityId), inArray(entityAutomationsTable.id, ids)));
  const ownedIds = new Set(owned.map((t) => t.id));
  const foreign = ids.filter((id) => !ownedIds.has(id));
  if (foreign.length > 0) {
    res.status(400).json({ error: `Some automations do not belong to this entity: ${foreign.join(", ")}` });
    return;
  }
  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(entityAutomationsTable)
        .set({ sortOrder: item.sortOrder })
        .where(and(eq(entityAutomationsTable.id, item.id), eq(entityAutomationsTable.entityId, entityId)));
    }
  });
  res.json({ success: true, message: "Reordered" });
});

router.get("/entities/:entityId/automation-runs", requireAuth, requireAdmin("automations"), async (req, res): Promise<void> => {
  const params = ListEntityAutomationRunsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await entityExists(params.data.entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const runs = await db
    .select()
    .from(entityAutomationRunsTable)
    .where(eq(entityAutomationRunsTable.entityId, params.data.entityId))
    .orderBy(desc(entityAutomationRunsTable.createdAt))
    .limit(200);
  res.json(runs);
});

router.get("/automations/:id", requireAuth, requireAdmin("automations"), async (req, res): Promise<void> => {
  const params = GetAutomationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [automation] = await db.select().from(entityAutomationsTable).where(eq(entityAutomationsTable.id, params.data.id));
  if (!automation) {
    res.status(404).json({ error: "Automation not found" });
    return;
  }
  res.json(automation);
});

router.put("/automations/:id", requireAuth, requireAdmin("automations"), async (req, res): Promise<void> => {
  const params = UpdateAutomationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAutomationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [current] = await db.select().from(entityAutomationsTable).where(eq(entityAutomationsTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "Automation not found" });
    return;
  }
  const entityId = current.entityId;
  const body = parsed.data;

  const trigger = body.triggerJson !== undefined ? automationTriggerSchema.safeParse(body.triggerJson) : null;
  if (trigger && !trigger.success) {
    res.status(400).json({ error: `Invalid trigger: ${trigger.error.message}` });
    return;
  }
  const conditions = body.conditionsJson !== undefined ? automationConditionSchema.array().safeParse(body.conditionsJson) : null;
  if (conditions && !conditions.success) {
    res.status(400).json({ error: `Invalid conditions: ${conditions.error.message}` });
    return;
  }
  const actions = body.actionsJson !== undefined ? automationActionSchema.array().safeParse(body.actionsJson) : null;
  if (actions && !actions.success) {
    res.status(400).json({ error: `Invalid actions: ${actions.error.message}` });
    return;
  }

  // Validate the EFFECTIVE final spec (new values where provided, else current).
  if (trigger || conditions || actions) {
    const effTrigger = trigger ? trigger.data : (current.triggerJson as AutomationTrigger);
    const effConditions = conditions ? conditions.data : (current.conditionsJson as AutomationCondition[]);
    const effActions = actions ? actions.data : (current.actionsJson as AutomationAction[]);
    const refErr = await validateSpec(entityId, effTrigger, effConditions, effActions);
    if (refErr) {
      res.status(400).json({ error: refErr });
      return;
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.nameJson != null) updateData.nameJson = body.nameJson;
  if (body.isActive != null) updateData.isActive = body.isActive;
  if (trigger) updateData.triggerJson = trigger.data;
  if (conditions) updateData.conditionsJson = conditions.data;
  if (actions) updateData.actionsJson = actions.data;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db.update(entityAutomationsTable).set(updateData).where(eq(entityAutomationsTable.id, params.data.id)).returning();
  res.json(updated);
});

router.delete("/automations/:id", requireAuth, requireAdmin("automations"), async (req, res): Promise<void> => {
  const params = DeleteAutomationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(entityAutomationsTable).where(eq(entityAutomationsTable.id, params.data.id)).returning({ id: entityAutomationsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Automation not found" });
    return;
  }
  res.json({ success: true, message: "Automation deleted" });
});

export default router;
