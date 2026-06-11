import { Router, type IRouter } from "express";
import { db, entityFieldsTable, entitiesTable, entityRecordsTable } from "@workspace/db";
import { eq, asc, and, ne, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import {
  ListEntityFieldsParams,
  CreateEntityFieldParams,
  CreateEntityFieldBody,
  GetFieldParams,
  UpdateFieldParams,
  UpdateFieldBody,
  DeleteFieldParams,
  ReorderFieldsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505");
}

/**
 * Coerce a formula config's `decimals` into a bounded integer (0–10) or null.
 * The generated Zod only enforces min/max (not integer-ness), so this is the
 * server-side guard that keeps direct API callers from persisting fractions.
 */
function clampFormulaDecimals<T>(cfg: T): T {
  if (cfg && typeof cfg === "object" && "decimals" in cfg) {
    const raw = (cfg as { decimals?: unknown }).decimals;
    if (raw == null) return cfg;
    const n = Number(raw);
    const d = Number.isFinite(n) ? Math.min(10, Math.max(0, Math.round(n))) : null;
    return { ...(cfg as object), decimals: d } as T;
  }
  return cfg;
}

async function entityExists(entityId: number): Promise<boolean> {
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId));
  return Boolean(entity);
}

async function fieldKeyTaken(
  entityId: number,
  fieldKey: string,
  excludeFieldId: number | null,
): Promise<boolean> {
  const where =
    excludeFieldId != null
      ? and(
          eq(entityFieldsTable.entityId, entityId),
          eq(entityFieldsTable.fieldKey, fieldKey),
          ne(entityFieldsTable.id, excludeFieldId),
        )
      : and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.fieldKey, fieldKey));
  const [taken] = await db
    .select({ id: entityFieldsTable.id })
    .from(entityFieldsTable)
    .where(where);
  return Boolean(taken);
}

router.get("/entities/:entityId/fields", requireAuth, async (req, res): Promise<void> => {
  const params = ListEntityFieldsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (!(await entityExists(params.data.entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const fields = await db
    .select()
    .from(entityFieldsTable)
    .where(eq(entityFieldsTable.entityId, params.data.entityId))
    .orderBy(asc(entityFieldsTable.sortOrder));

  res.json(fields);
});

router.post("/entities/:entityId/fields", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = CreateEntityFieldParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateEntityFieldBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!(await entityExists(params.data.entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const key = parsed.data.fieldKey.trim();
  if (!FIELD_KEY_RE.test(key)) {
    res.status(400).json({
      error: "Field key must be lowercase and contain only letters, digits and underscores, starting with a letter",
    });
    return;
  }

  // "relation" is a PAGE-FIELD-only type (it derives values from a linked record
  // via relationConfigJson). Entity fields share the FieldType enum but must not
  // accept it — reject so the shared contract cannot create an invalid column.
  if (parsed.data.fieldType === "relation") {
    res.status(400).json({ error: 'Field type "relation" is not valid for entity fields' });
    return;
  }

  if (parsed.data.fieldType === "select" && (!parsed.data.optionsJson || parsed.data.optionsJson.length === 0)) {
    res.status(400).json({ error: "Select fields require at least one option" });
    return;
  }

  // isKey/lockAfterCreate operate on the stored scalar value; they are meaningless
  // for file (object) and function (computed, never stored) fields.
  if ((parsed.data.isKey || parsed.data.lockAfterCreate) && (parsed.data.fieldType === "file" || parsed.data.fieldType === "function")) {
    res.status(400).json({ error: "Ключевое поле и запрет изменения недоступны для полей типа «файл» и «функция»" });
    return;
  }

  if (await fieldKeyTaken(params.data.entityId, key, null)) {
    res.status(409).json({ error: "A field with this key already exists on this entity" });
    return;
  }

  try {
    const [field] = await db
      .insert(entityFieldsTable)
      .values({
        ...parsed.data,
        formulaConfigJson: clampFormulaDecimals(parsed.data.formulaConfigJson),
        fieldKey: key,
        entityId: params.data.entityId,
      })
      .returning();
    res.status(201).json(field);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "A field with this key already exists on this entity" });
      return;
    }
    throw err;
  }
});

router.post("/fields/reorder", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const parsed = ReorderFieldsBody.safeParse(req.body);
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
    res.status(400).json({ error: "Duplicate field ids in reorder payload" });
    return;
  }
  const owned = await db
    .select({ id: entityFieldsTable.id })
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), inArray(entityFieldsTable.id, ids)));
  const ownedIds = new Set(owned.map((f) => f.id));

  const foreign = ids.filter((id) => !ownedIds.has(id));
  if (foreign.length > 0) {
    res.status(400).json({ error: `Some fields do not belong to this entity: ${foreign.join(", ")}` });
    return;
  }

  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(entityFieldsTable)
        .set({ sortOrder: item.sortOrder })
        .where(and(eq(entityFieldsTable.id, item.id), eq(entityFieldsTable.entityId, entityId)));
    }
  });

  res.json({ success: true, message: "Reordered" });
});

router.get("/fields/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetFieldParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [field] = await db
    .select()
    .from(entityFieldsTable)
    .where(eq(entityFieldsTable.id, params.data.id));

  if (!field) {
    res.status(404).json({ error: "Field not found" });
    return;
  }

  res.json(field);
});

router.put("/fields/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = UpdateFieldParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateFieldBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [current] = await db
    .select()
    .from(entityFieldsTable)
    .where(eq(entityFieldsTable.id, params.data.id));

  if (!current) {
    res.status(404).json({ error: "Field not found" });
    return;
  }

  const body = parsed.data;
  const updateData: Record<string, unknown> = {};

  if (body.fieldKey != null) {
    const key = body.fieldKey.trim();
    if (!FIELD_KEY_RE.test(key)) {
      res.status(400).json({
        error: "Field key must be lowercase and contain only letters, digits and underscores, starting with a letter",
      });
      return;
    }
    if (await fieldKeyTaken(current.entityId, key, current.id)) {
      res.status(409).json({ error: "A field with this key already exists on this entity" });
      return;
    }
    updateData.fieldKey = key;
  }

  if (body.fieldType === "relation") {
    res.status(400).json({ error: 'Field type "relation" is not valid for entity fields' });
    return;
  }

  const nextType = body.fieldType ?? current.fieldType;
  if ("optionsJson" in body || body.fieldType != null) {
    const nextOptions = body.optionsJson ?? (current.optionsJson as string[]);
    if (nextType === "select" && (!nextOptions || nextOptions.length === 0)) {
      res.status(400).json({ error: "Select fields require at least one option" });
      return;
    }
  }

  // isKey/lockAfterCreate are only valid for stored-scalar field types.
  const nextIsKey = body.isKey ?? current.isKey;
  const nextLock = body.lockAfterCreate ?? current.lockAfterCreate;
  if ((nextIsKey || nextLock) && (nextType === "file" || nextType === "function")) {
    res.status(400).json({ error: "Ключевое поле и запрет изменения недоступны для полей типа «файл» и «функция»" });
    return;
  }

  // Renaming the fieldKey and enabling uniqueness in one request is ambiguous:
  // existing record values are still stored under the OLD key, so a scan can't
  // unambiguously reflect the effective final state. Require these as two steps.
  if (
    body.isKey === true &&
    !current.isKey &&
    body.fieldKey != null &&
    body.fieldKey.trim() !== current.fieldKey
  ) {
    res.status(400).json({
      error: "Нельзя одновременно переименовать ключ поля и включить уникальность — выполните это в два отдельных действия",
    });
    return;
  }

  // Turning uniqueness ON requires the existing data to already be unique;
  // otherwise we'd be unable to honor the constraint for current rows.
  if (body.isKey === true && !current.isKey) {
    const dups = await db
      .select({ c: sql<number>`count(*)` })
      .from(entityRecordsTable)
      .where(
        and(
          eq(entityRecordsTable.entityId, current.entityId),
          sql`length(trim(coalesce(${entityRecordsTable.valuesJson} ->> ${current.fieldKey}, ''))) > 0`,
        ),
      )
      .groupBy(sql`lower(trim(${entityRecordsTable.valuesJson} ->> ${current.fieldKey}))`)
      .having(sql`count(*) > 1`)
      .limit(1);
    if (dups.length > 0) {
      res.status(409).json({ error: "Нельзя включить уникальность: уже есть записи с повторяющимися значениями этого поля" });
      return;
    }
  }

  if (body.nameJson != null) updateData.nameJson = body.nameJson;
  if (body.descriptionJson != null) updateData.descriptionJson = body.descriptionJson;
  if (body.fieldType != null) updateData.fieldType = body.fieldType;
  if (body.isRequired != null) updateData.isRequired = body.isRequired;
  if ("defaultValue" in body) updateData.defaultValue = body.defaultValue ?? null;
  if (body.optionsJson != null) updateData.optionsJson = body.optionsJson;
  if (body.formatRulesJson != null) updateData.formatRulesJson = body.formatRulesJson;
  if (body.formulaConfigJson != null)
    updateData.formulaConfigJson = clampFormulaDecimals(body.formulaConfigJson);
  if ("dependencyConfigJson" in body) updateData.dependencyConfigJson = body.dependencyConfigJson ?? {};
  if (body.isKey != null) updateData.isKey = body.isKey;
  if (body.lockAfterCreate != null) updateData.lockAfterCreate = body.lockAfterCreate;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;
  if (body.permissionsJson != null) updateData.permissionsJson = body.permissionsJson;
  if (body.isFilterable != null) updateData.isFilterable = body.isFilterable;
  if (body.showInTable != null) updateData.showInTable = body.showInTable;
  if (body.isPinned != null) updateData.isPinned = body.isPinned;
  if (body.showColumnTotal != null) updateData.showColumnTotal = body.showColumnTotal;
  if ("totalFillColor" in body) updateData.totalFillColor = body.totalFillColor ?? null;
  if ("totalTextColor" in body) updateData.totalTextColor = body.totalTextColor ?? null;
  if ("fileConfigJson" in body) updateData.fileConfigJson = body.fileConfigJson ?? null;
  if ("userConfigJson" in body) updateData.userConfigJson = body.userConfigJson ?? {};

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    const [field] = await db
      .update(entityFieldsTable)
      .set(updateData)
      .where(eq(entityFieldsTable.id, params.data.id))
      .returning();
    res.json(field);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "A field with this key already exists on this entity" });
      return;
    }
    throw err;
  }
});

router.delete("/fields/:id", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = DeleteFieldParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(entityFieldsTable)
    .where(eq(entityFieldsTable.id, params.data.id))
    .returning({ id: entityFieldsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Field not found" });
    return;
  }

  res.json({ success: true, message: "Field deleted" });
});

export default router;
