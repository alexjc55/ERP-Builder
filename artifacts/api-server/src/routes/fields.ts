import { Router, type IRouter } from "express";
import {
  db,
  entityFieldsTable,
  entitiesTable,
  entityRecordsTable,
  relationsTable,
  pagesTable,
  pageFieldsTable,
  type Relation,
  type RelationFieldConfig,
} from "@workspace/db";
import { eq, asc, and, ne, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import { sanitizeOptionsInput, normalizeOptions } from "../lib/selectOptions";
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

/**
 * Eligibility of a relation as an entity `relation` field on `entityId`.
 * Scoped (task contract) to the SOURCE side of a to-one relation: this entity is
 * the relation's source and the single linked record is its target (1:1 / N:1) →
 * "source". Target-side, the many side, 1:N and N:N are all out of scope → null.
 * Note: page-fields keeps its own broader helper (it also allows the target side
 * of 1:1 / 1:N); entity relation fields are intentionally narrower.
 */
function relationDirection(relation: Relation, entityId: number): "source" | null {
  const t = relation.relationType;
  if (relation.sourceEntityId === entityId && (t === "one_to_one" || t === "many_to_one")) return "source";
  return null;
}

/**
 * Validate a relation entity-field's config against its entity: the relation must
 * exist, qualify as single-link with this entity on the SOURCE side, and the named
 * related field must exist and be active on the other side. Returns the cleaned
 * config (only relationId + relatedFieldKey) to persist.
 */
async function validateEntityRelationConfig(
  entityId: number,
  cfg: RelationFieldConfig | undefined | null,
  allowWriteThrough = false,
  // Both relation and lookup fields may project a PAGE-LOCAL field of the linked
  // record instead of one of its entity fields (relatedPageId). For relation
  // fields this only changes the DISPLAYED/labelled value (the link stays
  // assignable); for lookup fields the whole cell is read-only. writeThrough is
  // still lookup-only and is mutually exclusive with relatedPageId.
  allowPageSource = false,
): Promise<{ ok: true; cleaned: RelationFieldConfig } | { error: string }> {
  const relationId = cfg?.relationId ?? null;
  const relatedFieldKey = cfg?.relatedFieldKey ?? null;
  if (relationId == null || !relatedFieldKey) {
    return { error: "Связанное поле требует выбора связи и связанного поля" };
  }
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
  if (!relation) return { error: "Связь не найдена" };
  if (relation.sourceEntityId !== entityId && relation.targetEntityId !== entityId) {
    return { error: "Связь не относится к этой сущности" };
  }
  const direction = relationDirection(relation, entityId);
  if (!direction) return { error: "Связь не даёт одну связанную запись для этой сущности" };
  const relatedEntityId = direction === "source" ? relation.targetEntityId : relation.sourceEntityId;

  // Page-source lookup: the projected value comes from a page of the related
  // entity (page_record_values), not the linked entity record's own fields.
  const relatedPageId = allowPageSource ? cfg?.relatedPageId ?? null : null;
  if (relatedPageId != null) {
    const pageCheck = await validateRelatedPageSource(relatedPageId, relatedEntityId, relatedFieldKey);
    if ("error" in pageCheck) return pageCheck;
    // Page-source lookups are always read-only — never carry writeThrough.
    return { ok: true, cleaned: { relationId, relatedFieldKey, relatedPageId } };
  }

  const [rf] = await db
    .select({ id: entityFieldsTable.id })
    .from(entityFieldsTable)
    .where(
      and(
        eq(entityFieldsTable.entityId, relatedEntityId),
        eq(entityFieldsTable.fieldKey, relatedFieldKey),
        eq(entityFieldsTable.isActive, true),
      ),
    );
  if (!rf) return { error: "Связанное поле не найдено в связанной сущности" };
  const cleaned: RelationFieldConfig = { relationId, relatedFieldKey };
  // writeThrough is a lookup-only flag: when set, the (read-only) lookup cell
  // becomes a gateway that opens the linked record's full editor in the related
  // entity. It is meaningless for relation fields, so callers gate it via
  // allowWriteThrough and we never persist it otherwise.
  if (allowWriteThrough && cfg?.writeThrough === true) cleaned.writeThrough = true;
  return { ok: true, cleaned };
}

/**
 * Effective entity behind a page (mirror entity, else the entity bound to the
 * page). Local copy of the page-fields helper so the Fields Builder can validate
 * a lookup field's page-source projection without importing the page router.
 */
async function effectiveEntityForPage(pageId: number): Promise<number | null> {
  const [p] = await db
    .select({ id: pagesTable.id, mirrorEntityId: pagesTable.mirrorEntityId })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId));
  if (!p) return null;
  if (p.mirrorEntityId != null) return p.mirrorEntityId;
  const [e] = await db.select({ id: entitiesTable.id }).from(entitiesTable).where(eq(entitiesTable.pageId, pageId));
  return e ? e.id : null;
}

/**
 * Validate that a lookup's `relatedPageId` page belongs to the relation's
 * related entity and that `relatedFieldKey` is an active value-backed page
 * field of that page (function/relation/lookup page fields cannot be projected).
 */
async function validateRelatedPageSource(
  relatedPageId: number,
  relatedEntityId: number,
  relatedFieldKey: string,
): Promise<{ ok: true } | { error: string }> {
  const pageEntityId = await effectiveEntityForPage(relatedPageId);
  if (pageEntityId == null) return { error: "Страница подстановки не найдена" };
  if (pageEntityId !== relatedEntityId) {
    return { error: "Страница подстановки не относится к связанной сущности" };
  }
  const [pf] = await db
    .select({ fieldType: pageFieldsTable.fieldType })
    .from(pageFieldsTable)
    .where(
      and(
        eq(pageFieldsTable.pageId, relatedPageId),
        eq(pageFieldsTable.fieldKey, relatedFieldKey),
        eq(pageFieldsTable.isActive, true),
      ),
    );
  if (!pf) return { error: "Поле страницы для подстановки не найдено" };
  if (pf.fieldType === "function" || pf.fieldType === "relation" || pf.fieldType === "lookup") {
    return { error: "Это поле страницы нельзя использовать для подстановки" };
  }
  return { ok: true };
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

  const createName = parsed.data.nameJson as Record<string, unknown> | null | undefined;
  if (!createName || !Object.values(createName).some((v) => typeof v === "string" && v.trim() !== "")) {
    res.status(400).json({ error: "Укажите название хотя бы на одном языке" });
    return;
  }

  // A "relation" entity field derives its value from a single linked record (via
  // relationConfigJson + a qualifying single-link relation); validate the config
  // against this entity before accepting it. A "lookup" field reuses the same
  // config to project ANOTHER field of that linked record (read-only), so it is
  // validated identically. Cleaned config is persisted below.
  let relationConfig: RelationFieldConfig | undefined;
  if (parsed.data.fieldType === "relation" || parsed.data.fieldType === "lookup") {
    const check = await validateEntityRelationConfig(
      params.data.entityId,
      parsed.data.relationConfigJson,
      parsed.data.fieldType === "lookup",
      true,
    );
    if (!("ok" in check)) {
      res.status(400).json({ error: check.error });
      return;
    }
    relationConfig = check.cleaned;
  }

  const createOptions = sanitizeOptionsInput(parsed.data.optionsJson);
  if (parsed.data.fieldType === "select" && createOptions.length === 0) {
    res.status(400).json({ error: "Select fields require at least one option" });
    return;
  }

  // isKey enforces uniqueness over a stored scalar value, so it is meaningless
  // for file (object), function (computed) and relation (derived) fields.
  if (
    parsed.data.isKey &&
    (parsed.data.fieldType === "file" ||
      parsed.data.fieldType === "function" ||
      parsed.data.fieldType === "relation" ||
      parsed.data.fieldType === "lookup")
  ) {
    res.status(400).json({ error: "Ключевое поле недоступно для полей типа «файл», «функция», «связанное поле» и «поле подстановки»" });
    return;
  }
  // lockAfterCreate is enforced on the stored value. file (object) and function
  // (computed) have no immutable scalar, and lookup is a derived read-only mirror —
  // so immutability is meaningless for those three and stays disallowed. relation
  // IS allowed: its immutability is enforced on the record_link in relations.ts
  // (not via the JSONB scalar), so locking a relation field is a real feature.
  if (
    parsed.data.lockAfterCreate &&
    (parsed.data.fieldType === "file" ||
      parsed.data.fieldType === "function" ||
      parsed.data.fieldType === "lookup")
  ) {
    res.status(400).json({ error: "Запрет изменения недоступен для полей типа «файл», «функция» и «поле подстановки»" });
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
        optionsJson: createOptions,
        formulaConfigJson: clampFormulaDecimals(parsed.data.formulaConfigJson),
        relationConfigJson: relationConfig ?? {},
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

  const nextType = body.fieldType ?? current.fieldType;

  // Validate relation config whenever the field is (or is becoming) a relation
  // field. The config comes from the body when present, else the stored value.
  let relationConfigToPersist: RelationFieldConfig | undefined;
  if (nextType === "relation" || nextType === "lookup") {
    const incoming =
      "relationConfigJson" in body
        ? (body.relationConfigJson as RelationFieldConfig | null | undefined)
        : (current.relationConfigJson as RelationFieldConfig | null);
    const check = await validateEntityRelationConfig(
      current.entityId,
      incoming,
      nextType === "lookup",
      true,
    );
    if (!("ok" in check)) {
      res.status(400).json({ error: check.error });
      return;
    }
    relationConfigToPersist = check.cleaned;
  }

  const sanitizedOptions = body.optionsJson != null ? sanitizeOptionsInput(body.optionsJson) : null;
  if ("optionsJson" in body || body.fieldType != null) {
    const nextOptions = sanitizedOptions ?? normalizeOptions(current.optionsJson);
    if (nextType === "select" && nextOptions.length === 0) {
      res.status(400).json({ error: "Select fields require at least one option" });
      return;
    }
  }

  // isKey operates on a stored JSONB scalar value, which file/function (no stored
  // value), lookup (derived mirror) and relation (value is a derived record_link,
  // not a JSONB scalar) do not have — so isKey stays disallowed for all four types.
  // lockAfterCreate, however, IS allowed for relation: its immutability is enforced
  // on the record_link in relations.ts, not via the JSONB scalar. So lockAfterCreate
  // stays disallowed only for file/function/lookup.
  // NOTE: nextLock/nextIsKey inherit the CURRENT value when the request doesn't
  // touch the flag, so an unrelated update (e.g. toggling pivotEnabled) on an
  // already-locked relation field must NOT trip this guard — hence relation is
  // excluded from the lockAfterCreate check.
  const nextIsKey = body.isKey ?? current.isKey;
  const nextLock = body.lockAfterCreate ?? current.lockAfterCreate;
  if (
    nextIsKey &&
    (nextType === "file" || nextType === "function" || nextType === "relation" || nextType === "lookup")
  ) {
    res.status(400).json({ error: "Ключевое поле недоступно для полей типа «файл», «функция», «связанное поле» и «поле подстановки»" });
    return;
  }
  if (
    nextLock &&
    (nextType === "file" || nextType === "function" || nextType === "lookup")
  ) {
    res.status(400).json({ error: "Запрет изменения недоступен для полей типа «файл», «функция» и «поле подстановки»" });
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

  if (body.nameJson != null) {
    if (!Object.values(body.nameJson).some((v) => typeof v === "string" && v.trim() !== "")) {
      res.status(400).json({ error: "Укажите название хотя бы на одном языке" });
      return;
    }
    updateData.nameJson = body.nameJson;
  }
  if (body.descriptionJson != null) updateData.descriptionJson = body.descriptionJson;
  if (body.fieldType != null) updateData.fieldType = body.fieldType;
  if (body.isRequired != null) updateData.isRequired = body.isRequired;
  if ("defaultValue" in body) updateData.defaultValue = body.defaultValue ?? null;
  if (body.defaultToToday != null) updateData.defaultToToday = body.defaultToToday;
  if (sanitizedOptions != null) updateData.optionsJson = sanitizedOptions;
  if (body.formatRulesJson != null) updateData.formatRulesJson = body.formatRulesJson;
  if (body.validationRulesJson != null) updateData.validationRulesJson = body.validationRulesJson;
  if (body.formulaConfigJson != null)
    updateData.formulaConfigJson = clampFormulaDecimals(body.formulaConfigJson);
  if ("dependencyConfigJson" in body) updateData.dependencyConfigJson = body.dependencyConfigJson ?? {};
  // Persist the validated relation config when this is/becomes a relation field;
  // reset it to {} when switching a former relation field away from that type.
  if (relationConfigToPersist !== undefined) {
    updateData.relationConfigJson = relationConfigToPersist;
  } else if (
    nextType !== "relation" &&
    nextType !== "lookup" &&
    (current.fieldType === "relation" || current.fieldType === "lookup")
  ) {
    updateData.relationConfigJson = {};
  }
  if (body.isKey != null) updateData.isKey = body.isKey;
  if (body.lockAfterCreate != null) updateData.lockAfterCreate = body.lockAfterCreate;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;
  if (body.permissionsJson != null) updateData.permissionsJson = body.permissionsJson;
  if (body.isFilterable != null) updateData.isFilterable = body.isFilterable;
  if (body.pivotEnabled != null) updateData.pivotEnabled = body.pivotEnabled;
  if (body.showInTable != null) updateData.showInTable = body.showInTable;
  if (body.isPinned != null) updateData.isPinned = body.isPinned;
  if (body.showColumnTotal != null) updateData.showColumnTotal = body.showColumnTotal;
  if (body.wrapText != null) updateData.wrapText = body.wrapText;
  if ("totalFillColor" in body) updateData.totalFillColor = body.totalFillColor ?? null;
  if ("totalTextColor" in body) updateData.totalTextColor = body.totalTextColor ?? null;
  if ("columnGroupId" in body) updateData.columnGroupId = body.columnGroupId ?? null;
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
