import { Router, type IRouter } from "express";
import {
  db,
  customFiltersTable,
  entitiesTable,
  entityFieldsTable,
  pagesTable,
  pageFieldsTable,
  customFilterGroupSchema,
  customFilterInputSchema,
  type CustomFilterGroup,
  type CustomFilterInput,
} from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import {
  ListEntityCustomFiltersParams,
  CreateEntityCustomFilterParams,
  CreateEntityCustomFilterBody,
  GetCustomFilterParams,
  UpdateCustomFilterParams,
  UpdateCustomFilterBody,
  DeleteCustomFilterParams,
  ReorderCustomFiltersBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function entityExists(entityId: number): Promise<boolean> {
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  return Boolean(entity);
}

/**
 * Deep-validate a custom-filter spec against the entity's real fields and its
 * mirror pages' page-fields. The Orval body schema only checks SHAPE; this
 * enforces referential integrity: every condition's field must exist (any type,
 * incl. formula — isFilterable is intentionally ignored), page conditions must
 * point at a mirror page of this entity and name an active page-field, and every
 * input-sourced condition must reference a declared input. Returns an error or null.
 */
async function validateSpec(
  entityId: number,
  conjunction: "and" | "or",
  groups: CustomFilterGroup[],
  inputs: CustomFilterInput[],
): Promise<string | null> {
  if (conjunction !== "and" && conjunction !== "or") return "Некорректный тип объединения";
  const fieldRows = await db
    .select({ fieldKey: entityFieldsTable.fieldKey })
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const keys = new Set(fieldRows.map((r) => r.fieldKey));

  const mirrorPageIds = new Set(
    (
      await db
        .select({ id: pagesTable.id })
        .from(pagesTable)
        .where(eq(pagesTable.mirrorEntityId, entityId))
    ).map((r) => r.id),
  );
  const pageFieldCache = new Map<number, Set<string>>();
  const pageFieldsOf = async (pageId: number): Promise<Set<string>> => {
    const cached = pageFieldCache.get(pageId);
    if (cached) return cached;
    const rows = await db
      .select({ fieldKey: pageFieldsTable.fieldKey })
      .from(pageFieldsTable)
      .where(and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.isActive, true)));
    const s = new Set(rows.map((r) => r.fieldKey));
    pageFieldCache.set(pageId, s);
    return s;
  };

  const inputIds = new Set(inputs.map((i) => i.id));
  if (inputIds.size !== inputs.length) return "Дублирующиеся идентификаторы вводимых значений";

  for (const g of groups) {
    for (const c of g.conditions) {
      const src = c.fieldSource ?? "entity";
      if (src === "page") {
        if (c.pageId == null) return "Не указана страница для условия по полю страницы";
        if (!mirrorPageIds.has(c.pageId)) return "Условие ссылается на страницу, не являющуюся зеркальной для этой сущности";
        const pf = await pageFieldsOf(c.pageId);
        if (!pf.has(c.fieldKey)) return `Неизвестное поле страницы: ${c.fieldKey}`;
      } else {
        if (!keys.has(c.fieldKey)) return `Неизвестное поле: ${c.fieldKey}`;
      }
      const needsValue = c.operator !== "empty" && c.operator !== "notEmpty";
      if (needsValue && (c.valueSource ?? "static") === "input") {
        if (!c.inputId) return "Не указан ввод для условия со значением из ввода";
        if (!inputIds.has(c.inputId)) return `Неизвестный ввод: ${c.inputId}`;
      }
    }
  }
  return null;
}

// Auth-only (NOT customFilters-gated): the records filter bar renders one chip
// per custom filter for EVERY viewer of the entity, so any authenticated user
// must be able to list the definitions (mirrors the column-groups read-endpoint
// precedent). The predicate is admin-authored and applied server-side; returned
// rows still obey the viewer's row/field boundary, so exposing the chip metadata
// (and its condition structure, like a saved view's filters) is not a leak.
// Only CREATE/UPDATE/DELETE/REORDER stay behind the `customFilters` cap.
router.get(
  "/entities/:entityId/custom-filters",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListEntityCustomFiltersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await entityExists(params.data.entityId))) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    const rows = await db
      .select()
      .from(customFiltersTable)
      .where(eq(customFiltersTable.entityId, params.data.entityId))
      .orderBy(asc(customFiltersTable.sortOrder));
    res.json(rows);
  },
);

router.post(
  "/entities/:entityId/custom-filters",
  requireAuth,
  requireAdmin("customFilters"),
  async (req, res): Promise<void> => {
    const params = CreateEntityCustomFilterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CreateEntityCustomFilterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const entityId = params.data.entityId;
    if (!(await entityExists(entityId))) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    const groups = customFilterGroupSchema.array().safeParse(parsed.data.groupsJson ?? []);
    if (!groups.success) {
      res.status(400).json({ error: `Invalid groups: ${groups.error.message}` });
      return;
    }
    const inputs = customFilterInputSchema.array().safeParse(parsed.data.inputsJson ?? []);
    if (!inputs.success) {
      res.status(400).json({ error: `Invalid inputs: ${inputs.error.message}` });
      return;
    }
    const conjunction = parsed.data.conjunction ?? "and";
    const refErr = await validateSpec(entityId, conjunction, groups.data, inputs.data);
    if (refErr) {
      res.status(400).json({ error: refErr });
      return;
    }
    const [created] = await db
      .insert(customFiltersTable)
      .values({
        entityId,
        nameJson: parsed.data.nameJson ?? {},
        isActive: parsed.data.isActive ?? true,
        conjunction,
        groupsJson: groups.data,
        inputsJson: inputs.data,
        sortOrder: parsed.data.sortOrder ?? 0,
      })
      .returning();
    res.status(201).json(created);
  },
);

router.post(
  "/custom-filters/reorder",
  requireAuth,
  requireAdmin("customFilters"),
  async (req, res): Promise<void> => {
    const parsed = ReorderCustomFiltersBody.safeParse(req.body);
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
      res.status(400).json({ error: "Duplicate custom filter ids in reorder payload" });
      return;
    }
    const owned = await db
      .select({ id: customFiltersTable.id })
      .from(customFiltersTable)
      .where(and(eq(customFiltersTable.entityId, entityId), inArray(customFiltersTable.id, ids)));
    const ownedIds = new Set(owned.map((t) => t.id));
    const foreign = ids.filter((id) => !ownedIds.has(id));
    if (foreign.length > 0) {
      res.status(400).json({ error: `Some custom filters do not belong to this entity: ${foreign.join(", ")}` });
      return;
    }
    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .update(customFiltersTable)
          .set({ sortOrder: item.sortOrder })
          .where(and(eq(customFiltersTable.id, item.id), eq(customFiltersTable.entityId, entityId)));
      }
    });
    res.json({ success: true, message: "Reordered" });
  },
);

router.get(
  "/custom-filters/:id",
  requireAuth,
  requireAdmin("customFilters"),
  async (req, res): Promise<void> => {
    const params = GetCustomFilterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db.select().from(customFiltersTable).where(eq(customFiltersTable.id, params.data.id));
    if (!row) {
      res.status(404).json({ error: "Custom filter not found" });
      return;
    }
    res.json(row);
  },
);

router.put(
  "/custom-filters/:id",
  requireAuth,
  requireAdmin("customFilters"),
  async (req, res): Promise<void> => {
    const params = UpdateCustomFilterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateCustomFilterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [current] = await db.select().from(customFiltersTable).where(eq(customFiltersTable.id, params.data.id));
    if (!current) {
      res.status(404).json({ error: "Custom filter not found" });
      return;
    }
    const entityId = current.entityId;
    const body = parsed.data;

    const groups = body.groupsJson !== undefined ? customFilterGroupSchema.array().safeParse(body.groupsJson) : null;
    if (groups && !groups.success) {
      res.status(400).json({ error: `Invalid groups: ${groups.error.message}` });
      return;
    }
    const inputs = body.inputsJson !== undefined ? customFilterInputSchema.array().safeParse(body.inputsJson) : null;
    if (inputs && !inputs.success) {
      res.status(400).json({ error: `Invalid inputs: ${inputs.error.message}` });
      return;
    }

    // Validate the EFFECTIVE final spec (new values where provided, else current).
    if (groups || inputs || body.conjunction != null) {
      const effConjunction = (body.conjunction ?? current.conjunction) as "and" | "or";
      const effGroups = groups ? groups.data : (current.groupsJson as CustomFilterGroup[]);
      const effInputs = inputs ? inputs.data : (current.inputsJson as CustomFilterInput[]);
      const refErr = await validateSpec(entityId, effConjunction, effGroups, effInputs);
      if (refErr) {
        res.status(400).json({ error: refErr });
        return;
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.nameJson != null) updateData.nameJson = body.nameJson;
    if (body.isActive != null) updateData.isActive = body.isActive;
    if (body.conjunction != null) updateData.conjunction = body.conjunction;
    if (groups) updateData.groupsJson = groups.data;
    if (inputs) updateData.inputsJson = inputs.data;
    if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db
      .update(customFiltersTable)
      .set(updateData)
      .where(eq(customFiltersTable.id, params.data.id))
      .returning();
    res.json(updated);
  },
);

router.delete(
  "/custom-filters/:id",
  requireAuth,
  requireAdmin("customFilters"),
  async (req, res): Promise<void> => {
    const params = DeleteCustomFilterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [deleted] = await db
      .delete(customFiltersTable)
      .where(eq(customFiltersTable.id, params.data.id))
      .returning({ id: customFiltersTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Custom filter not found" });
      return;
    }
    res.json({ success: true, message: "Custom filter deleted" });
  },
);

export default router;
