import { Router, type IRouter } from "express";
import {
  db,
  pageFieldsTable,
  pageRecordValuesTable,
  pagesTable,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  relationsTable,
  recordLinksTable,
  type PageField,
  type Relation,
  type RelationFieldConfig,
  type FieldPermissions,
} from "@workspace/db";
import { eq, asc, and, ne, inArray, or, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  requireAdmin,
  assertRecord,
  getPermissions,
  effectiveScope,
  recordOwnedBy,
  resolveFieldAccess,
} from "../middlewares/permissions";
import {
  ListPageFieldsParams,
  CreatePageFieldParams,
  CreatePageFieldBody,
  UpdatePageFieldParams,
  UpdatePageFieldBody,
  DeletePageFieldParams,
  ReorderPageFieldsBody,
  ListPageRecordValuesParams,
  SetPageRecordValuesParams,
  SetPageRecordValuesBody,
  GetPageRelatedValuesParams,
  GetPageRelatedValuesBody,
  GetPageRelationOptionsParams,
  GetEntityRelationOptionsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505");
}

async function pageExists(pageId: number): Promise<boolean> {
  const [p] = await db.select({ id: pagesTable.id }).from(pagesTable).where(eq(pagesTable.id, pageId));
  return Boolean(p);
}

/**
 * Resolve a page's *effective* entity: the entity whose records this page shows.
 * For a mirror page that is the mirrored entity; for a regular page it is the
 * entity bound to the page (`entities.page_id`). `entityId === null` means the
 * page shows no records (neither mirror nor bound), so page-record values and
 * relation columns do not apply.
 */
async function effectiveEntityForPage(
  pageId: number,
): Promise<{ found: boolean; entityId: number | null; isMirror: boolean }> {
  const [p] = await db
    .select({ id: pagesTable.id, mirrorEntityId: pagesTable.mirrorEntityId })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId));
  if (!p) return { found: false, entityId: null, isMirror: false };
  if (p.mirrorEntityId != null) return { found: true, entityId: p.mirrorEntityId, isMirror: true };
  const [e] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.pageId, pageId));
  return { found: true, entityId: e ? e.id : null, isMirror: false };
}

/**
 * Direction of a qualifying *single-link* relation relative to a page's entity.
 * "source" means the page record is the relation's source and the single linked
 * record is its target (cardinality 1:1 or N:1). "target" is the inverse side
 * (1:1 or 1:N). Any other shape (N:N, or the many side) is not single-link and
 * returns null — those cannot back a single derived column value.
 */
type LinkDirection = "source" | "target";
function relationDirection(relation: Relation, entityId: number): LinkDirection | null {
  const t = relation.relationType;
  if (relation.sourceEntityId === entityId && (t === "one_to_one" || t === "many_to_one")) return "source";
  if (relation.targetEntityId === entityId && (t === "one_to_one" || t === "one_to_many")) return "target";
  return null;
}
function relatedEntityIdFor(relation: Relation, direction: LinkDirection): number {
  return direction === "source" ? relation.targetEntityId : relation.sourceEntityId;
}

/**
 * Validate a relation page-field's config against the page's effective entity:
 * the relation must exist, qualify as single-link for this entity, and the
 * related field must exist and be active on the other side.
 */
async function validateRelationFieldConfig(
  pageId: number,
  cfg: RelationFieldConfig | undefined | null,
): Promise<{ ok: true } | { error: string }> {
  const eff = await effectiveEntityForPage(pageId);
  if (!eff.found) return { error: "Page not found" };
  if (eff.entityId == null) return { error: "Relation fields require the page to be bound to an entity" };
  const relationId = cfg?.relationId ?? null;
  const relatedFieldKey = cfg?.relatedFieldKey ?? null;
  if (relationId == null || !relatedFieldKey) return { error: "Relation field requires relationId and relatedFieldKey" };
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
  if (!relation) return { error: "Relation not found" };
  const direction = relationDirection(relation, eff.entityId);
  if (!direction) return { error: "Relation does not yield a single linked record for this page's entity" };
  const relatedEntityId = relatedEntityIdFor(relation, direction);
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
  if (!rf) return { error: "Related field not found on the related entity" };
  return { ok: true };
}

/** SQL predicate restricting entity_records rows to those owned by `userId`. */
function ownScopeWhere(scopeFieldKeys: string[], userId: number): SQL {
  if (scopeFieldKeys.length === 0) return sql`false`;
  const clauses = scopeFieldKeys.map(
    (k) => sql`(${entityRecordsTable.valuesJson} ->> ${k}) = ${String(userId)}`,
  );
  return or(...clauses)!;
}

async function pageFieldKeyTaken(pageId: number, fieldKey: string, excludeId: number | null): Promise<boolean> {
  const where =
    excludeId != null
      ? and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.fieldKey, fieldKey), ne(pageFieldsTable.id, excludeId))
      : and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.fieldKey, fieldKey));
  const [taken] = await db.select({ id: pageFieldsTable.id }).from(pageFieldsTable).where(where);
  return Boolean(taken);
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * Validate a page-local values object against the page's active page-fields.
 * `function`-type fields are computed at read time and are never stored, so any
 * incoming value for them is ignored. Unknown keys are rejected.
 */
function validatePageValues(
  fields: PageField[],
  values: Record<string, unknown>,
): { values: Record<string, unknown> } | { error: string } {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
  for (const key of Object.keys(values)) {
    if (!byKey.has(key)) return { error: `Unknown page field: ${key}` };
  }
  const cleaned: Record<string, unknown> = {};
  for (const field of fields) {
    // `function` (computed) and `relation` (derived from a linked record and
    // written back to that record, never stored here) are never persisted.
    if (field.fieldType === "function" || field.fieldType === "relation") continue;
    const raw = values[field.fieldKey];
    if (isEmpty(raw)) {
      if (field.isRequired) return { error: `Field "${field.fieldKey}" is required` };
      continue;
    }
    switch (field.fieldType) {
      case "number": {
        if (typeof raw !== "number" || !Number.isFinite(raw)) return { error: `Field "${field.fieldKey}" must be a number` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "boolean": {
        if (typeof raw !== "boolean") return { error: `Field "${field.fieldKey}" must be a boolean` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "email": {
        if (typeof raw !== "string" || !EMAIL_RE.test(raw)) return { error: `Field "${field.fieldKey}" must be a valid email` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "url": {
        if (typeof raw !== "string") return { error: `Field "${field.fieldKey}" must be a valid URL` };
        let parsed: URL;
        try {
          parsed = new URL(raw);
        } catch {
          return { error: `Field "${field.fieldKey}" must be a valid URL` };
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { error: `Field "${field.fieldKey}" must be an http or https URL` };
        }
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "select": {
        if (typeof raw !== "string") return { error: `Field "${field.fieldKey}" must be a string` };
        const options = Array.isArray(field.optionsJson) ? (field.optionsJson as unknown[]) : [];
        if (!options.includes(raw)) return { error: `Field "${field.fieldKey}" must be one of the allowed options` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "date":
      case "datetime": {
        if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) return { error: `Field "${field.fieldKey}" must be a valid date` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      default: {
        // text/textarea/phone and any other: store the string as-is.
        cleaned[field.fieldKey] = typeof raw === "string" ? raw : String(raw);
      }
    }
  }
  return { values: cleaned };
}

router.get("/pages/:pageId/fields", requireAuth, async (req, res): Promise<void> => {
  const params = ListPageFieldsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const eff = await effectiveEntityForPage(params.data.pageId);
  if (!eff.found) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  // Page-field metadata mirrors record visibility: only callers who can view the
  // page's effective entity (mirrored or bound) may read its column definitions.
  if (eff.entityId != null && !(await assertRecord(req, res, eff.entityId, "view"))) return;
  const fields = await db
    .select()
    .from(pageFieldsTable)
    .where(eq(pageFieldsTable.pageId, params.data.pageId))
    .orderBy(asc(pageFieldsTable.sortOrder));
  res.json(fields);
});

router.post("/pages/:pageId/fields", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = CreatePageFieldParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreatePageFieldBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await pageExists(params.data.pageId))) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  const key = parsed.data.fieldKey.trim();
  if (!FIELD_KEY_RE.test(key)) {
    res.status(400).json({ error: "Field key must be lowercase letters, digits and underscores, starting with a letter" });
    return;
  }
  if (parsed.data.fieldType === "select" && (!parsed.data.optionsJson || parsed.data.optionsJson.length === 0)) {
    res.status(400).json({ error: "Select fields require at least one option" });
    return;
  }
  if (parsed.data.fieldType === "relation") {
    const check = await validateRelationFieldConfig(params.data.pageId, parsed.data.relationConfigJson);
    if ("error" in check) {
      res.status(400).json({ error: check.error });
      return;
    }
  }
  if (await pageFieldKeyTaken(params.data.pageId, key, null)) {
    res.status(409).json({ error: "A page field with this key already exists on this page" });
    return;
  }
  try {
    const [field] = await db
      .insert(pageFieldsTable)
      .values({ ...parsed.data, fieldKey: key, pageId: params.data.pageId })
      .returning();
    res.status(201).json(field);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "A page field with this key already exists on this page" });
      return;
    }
    throw err;
  }
});

router.post("/page-fields/reorder", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const parsed = ReorderPageFieldsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { pageId, items } = parsed.data;
  if (!(await pageExists(pageId))) {
    res.status(404).json({ error: "Page not found" });
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
    .select({ id: pageFieldsTable.id })
    .from(pageFieldsTable)
    .where(and(eq(pageFieldsTable.pageId, pageId), inArray(pageFieldsTable.id, ids)));
  const ownedIds = new Set(owned.map((f) => f.id));
  const foreign = ids.filter((id) => !ownedIds.has(id));
  if (foreign.length > 0) {
    res.status(400).json({ error: `Some fields do not belong to this page: ${foreign.join(", ")}` });
    return;
  }
  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(pageFieldsTable)
        .set({ sortOrder: item.sortOrder })
        .where(and(eq(pageFieldsTable.id, item.id), eq(pageFieldsTable.pageId, pageId)));
    }
  });
  res.json({ success: true, message: "Reordered" });
});

router.put("/page-fields/:id", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = UpdatePageFieldParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePageFieldBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [current] = await db.select().from(pageFieldsTable).where(eq(pageFieldsTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "Page field not found" });
    return;
  }
  const body = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (body.fieldKey != null) {
    const key = body.fieldKey.trim();
    if (!FIELD_KEY_RE.test(key)) {
      res.status(400).json({ error: "Field key must be lowercase letters, digits and underscores, starting with a letter" });
      return;
    }
    if (await pageFieldKeyTaken(current.pageId, key, current.id)) {
      res.status(409).json({ error: "A page field with this key already exists on this page" });
      return;
    }
    updateData.fieldKey = key;
  }
  const nextType = body.fieldType ?? current.fieldType;
  if ("optionsJson" in body || body.fieldType != null) {
    const nextOptions = body.optionsJson ?? (current.optionsJson as string[]);
    if (nextType === "select" && (!nextOptions || nextOptions.length === 0)) {
      res.status(400).json({ error: "Select fields require at least one option" });
      return;
    }
  }
  if (nextType === "relation") {
    const nextCfg =
      "relationConfigJson" in body
        ? body.relationConfigJson
        : (current.relationConfigJson as RelationFieldConfig | null);
    const check = await validateRelationFieldConfig(current.pageId, nextCfg);
    if ("error" in check) {
      res.status(400).json({ error: check.error });
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
  if (body.formulaConfigJson != null) updateData.formulaConfigJson = body.formulaConfigJson;
  if ("relationConfigJson" in body) updateData.relationConfigJson = body.relationConfigJson ?? null;
  if ("permissionsJson" in body) updateData.permissionsJson = body.permissionsJson ?? null;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;
  if (body.showInTable != null) updateData.showInTable = body.showInTable;
  if (body.showColumnTotal != null) updateData.showColumnTotal = body.showColumnTotal;
  if ("totalFillColor" in body) updateData.totalFillColor = body.totalFillColor ?? null;
  if ("totalTextColor" in body) updateData.totalTextColor = body.totalTextColor ?? null;
  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  try {
    const [field] = await db
      .update(pageFieldsTable)
      .set(updateData)
      .where(eq(pageFieldsTable.id, params.data.id))
      .returning();
    res.json(field);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "A page field with this key already exists on this page" });
      return;
    }
    throw err;
  }
});

router.delete("/page-fields/:id", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = DeletePageFieldParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(pageFieldsTable)
    .where(eq(pageFieldsTable.id, params.data.id))
    .returning({ id: pageFieldsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Page field not found" });
    return;
  }
  res.json({ success: true, message: "Page field deleted" });
});

router.get("/pages/:pageId/record-values", requireAuth, async (req, res): Promise<void> => {
  const params = ListPageRecordValuesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const eff = await effectiveEntityForPage(params.data.pageId);
  if (!eff.found) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  if (eff.entityId == null) {
    res.status(400).json({ error: "Page has no entity" });
    return;
  }
  const entityId = eff.entityId;
  // Record-level view permission on the page's effective entity is required.
  if (!(await assertRecord(req, res, entityId, "view"))) return;
  // Restrict the returned values to records the caller is actually allowed to
  // see: only rows of that entity, and only own rows under "own" scope.
  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, entityId);
  const where: SQL[] = [
    eq(pageRecordValuesTable.pageId, params.data.pageId),
    eq(entityRecordsTable.entityId, entityId),
  ];
  if (scope === "own") where.push(ownScopeWhere(scopeFieldKeys, req.user!.userId));
  const rows = await db
    .select({ recordId: pageRecordValuesTable.recordId, valuesJson: pageRecordValuesTable.valuesJson })
    .from(pageRecordValuesTable)
    .innerJoin(entityRecordsTable, eq(entityRecordsTable.id, pageRecordValuesTable.recordId))
    .where(and(...where));
  res.json(rows);
});

router.put("/pages/:pageId/records/:recordId/values", requireAuth, async (req, res): Promise<void> => {
  const params = SetPageRecordValuesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SetPageRecordValuesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { pageId, recordId } = params.data;
  const eff = await effectiveEntityForPage(pageId);
  if (!eff.found) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  if (eff.entityId == null) {
    res.status(400).json({ error: "Page has no entity" });
    return;
  }
  const entityId = eff.entityId;
  const [record] = await db
    .select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, recordId));
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  // The record must belong to this page's effective entity (no cross-entity writes).
  if (record.entityId !== entityId) {
    res.status(400).json({ error: "Record does not belong to this page" });
    return;
  }
  // Record-level update permission on the effective entity is required.
  if (!(await assertRecord(req, res, entityId, "update"))) return;
  // Under "own" scope, the caller may only write to records they own.
  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, entityId);
  if (scope === "own" && !recordOwnedBy((record.valuesJson as Record<string, unknown>) ?? {}, scopeFieldKeys, req.user!.userId)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  const fields = await db
    .select()
    .from(pageFieldsTable)
    .where(and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.isActive, true)));
  const incoming = (parsed.data.valuesJson ?? {}) as Record<string, unknown>;
  const result = validatePageValues(fields, incoming);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  const [existing] = await db
    .select({ id: pageRecordValuesTable.id, valuesJson: pageRecordValuesTable.valuesJson })
    .from(pageRecordValuesTable)
    .where(and(eq(pageRecordValuesTable.pageId, pageId), eq(pageRecordValuesTable.recordId, recordId)));
  if (existing) {
    await db
      .update(pageRecordValuesTable)
      .set({ valuesJson: result.values })
      .where(eq(pageRecordValuesTable.id, existing.id));
  } else {
    await db.insert(pageRecordValuesTable).values({ pageId, recordId, valuesJson: result.values });
  }
  res.json({ recordId, valuesJson: result.values });
});

/**
 * Resolve relation-type page-field values for a set of the page's records.
 *
 * Each relation page-field surfaces one field of a single linked record (via a
 * qualifying single-link relation). Values are RBAC-filtered for the viewer on
 * BOTH sides:
 *  - the page's effective entity (record-level view + own-row scope on the rows
 *    we read links from), and
 *  - the *related* entity (the linked field's hidden/edit access and the related
 *    entity's own-row scope), plus the per-page-field role visibility.
 * Editing is reported per-cell but the actual write goes through the normal
 * records update path on the linked record, which re-enforces every boundary.
 */
router.post("/pages/:pageId/related-values", requireAuth, async (req, res): Promise<void> => {
  const params = GetPageRelatedValuesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = GetPageRelatedValuesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const eff = await effectiveEntityForPage(params.data.pageId);
  if (!eff.found) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  if (eff.entityId == null) {
    res.status(400).json({ error: "Page has no entity" });
    return;
  }
  const entityId = eff.entityId;
  if (!(await assertRecord(req, res, entityId, "view"))) return;

  const perms = await getPermissions(req);
  const roleId = req.user!.roleId;
  const userId = req.user!.userId;

  const relationFields = (
    await db
      .select()
      .from(pageFieldsTable)
      .where(
        and(
          eq(pageFieldsTable.pageId, params.data.pageId),
          eq(pageFieldsTable.isActive, true),
          eq(pageFieldsTable.fieldType, "relation"),
        ),
      )
      .orderBy(asc(pageFieldsTable.sortOrder))
  ).filter((pf) => {
    // Per-page role visibility: a "hidden" page-field is dropped entirely.
    const pagePerm = (pf.permissionsJson as FieldPermissions | null)?.[String(roleId)];
    return pagePerm !== "hidden";
  });

  if (relationFields.length === 0 || parsed.data.recordIds.length === 0) {
    res.json({ columns: [], values: [] });
    return;
  }

  // Restrict to records of THIS entity the viewer is allowed to see (own scope).
  const { scope, scopeFieldKeys } = effectiveScope(perms, entityId);
  const requested = Array.from(new Set(parsed.data.recordIds));
  const pageRecords = await db
    .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(eq(entityRecordsTable.entityId, entityId), inArray(entityRecordsTable.id, requested)));
  const allowedIds = pageRecords
    .filter((r) => scope !== "own" || recordOwnedBy((r.valuesJson as Record<string, unknown>) ?? {}, scopeFieldKeys, userId))
    .map((r) => r.id);

  if (allowedIds.length === 0) {
    res.json({ columns: [], values: [] });
    return;
  }

  const columns: {
    fieldKey: string;
    relatedFieldKey: string;
    relatedFieldType: string | null;
    optionsJson: string[];
    editableColumn: boolean;
  }[] = [];
  const values: {
    recordId: number;
    fieldKey: string;
    value: unknown;
    linkedRecordId: number | null;
    editable: boolean;
  }[] = [];

  for (const pf of relationFields) {
    const cfg = pf.relationConfigJson as RelationFieldConfig | null;
    const relationId = cfg?.relationId ?? null;
    const relatedFieldKey = cfg?.relatedFieldKey ?? null;
    if (relationId == null || !relatedFieldKey) continue;

    const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
    if (!relation) continue;
    const direction = relationDirection(relation, entityId);
    if (!direction) continue;
    const relatedEntityId = relatedEntityIdFor(relation, direction);

    const [relatedField] = await db
      .select()
      .from(entityFieldsTable)
      .where(
        and(
          eq(entityFieldsTable.entityId, relatedEntityId),
          eq(entityFieldsTable.fieldKey, relatedFieldKey),
          eq(entityFieldsTable.isActive, true),
        ),
      );
    if (!relatedField) continue;

    const access = resolveFieldAccess(relatedField, perms, roleId, relatedEntityId);
    const pagePerm = (pf.permissionsJson as FieldPermissions | null)?.[String(roleId)] ?? "edit";
    const relScope = effectiveScope(perms, relatedEntityId);
    const columnEditable = pagePerm === "edit" && access === "edit";

    columns.push({
      fieldKey: pf.fieldKey,
      relatedFieldKey,
      relatedFieldType: access === "hidden" ? null : relatedField.fieldType,
      optionsJson: access === "hidden" ? [] : ((relatedField.optionsJson as string[]) ?? []),
      editableColumn: columnEditable,
    });

    // Map each allowed page record to its single linked record id.
    const linkRows =
      direction === "source"
        ? await db
            .select({ from: recordLinksTable.sourceRecordId, to: recordLinksTable.targetRecordId })
            .from(recordLinksTable)
            .where(and(eq(recordLinksTable.relationId, relationId), inArray(recordLinksTable.sourceRecordId, allowedIds)))
        : await db
            .select({ from: recordLinksTable.targetRecordId, to: recordLinksTable.sourceRecordId })
            .from(recordLinksTable)
            .where(and(eq(recordLinksTable.relationId, relationId), inArray(recordLinksTable.targetRecordId, allowedIds)));
    const linkMap = new Map<number, number>();
    for (const l of linkRows) linkMap.set(l.from, l.to);

    // Load the linked records once for value + related own-scope checks.
    const linkedIds = Array.from(new Set(linkRows.map((l) => l.to)));
    const linkedMap = new Map<number, Record<string, unknown>>();
    if (linkedIds.length > 0 && access !== "hidden") {
      const linkedRecords = await db
        .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
        .from(entityRecordsTable)
        .where(and(eq(entityRecordsTable.entityId, relatedEntityId), inArray(entityRecordsTable.id, linkedIds)));
      for (const lr of linkedRecords) linkedMap.set(lr.id, (lr.valuesJson as Record<string, unknown>) ?? {});
    }

    for (const recordId of allowedIds) {
      const rawLinkedId = linkMap.get(recordId) ?? null;
      let value: unknown = null;
      let editable = false;
      let visible = false;
      if (rawLinkedId != null && access !== "hidden") {
        const linkedValues = linkedMap.get(rawLinkedId);
        if (
          linkedValues != null &&
          (relScope.scope !== "own" || recordOwnedBy(linkedValues, relScope.scopeFieldKeys, userId))
        ) {
          visible = true;
          value = linkedValues[relatedFieldKey] ?? null;
          editable = columnEditable;
        }
      }
      // Do not leak the linked record's identifier when its content is not
      // visible (hidden field access or related own-scope): the id is only
      // exposed for cells the viewer can actually read (and, when editable,
      // write back through). Existence of restricted related rows stays hidden.
      values.push({ recordId, fieldKey: pf.fieldKey, value, linkedRecordId: visible ? rawLinkedId : null, editable });
    }
  }

  res.json({ columns, values });
});

/**
 * List the relations whose cardinality yields a single linked record for this
 * page's effective entity (source side 1:1/N:1, or target side 1:1/1:N), along
 * with the candidate related-entity fields a relation page-field can surface.
 * Admin-only (it backs the page-field config dialog). Both directions are
 * considered, so relations where the page entity is the relation *target* are
 * included too (these are not returned by the source-only entity-relations list).
 */
router.get("/pages/:pageId/relation-options", requireAuth, requireAdmin("pages"), async (req, res): Promise<void> => {
  const params = GetPageRelationOptionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const eff = await effectiveEntityForPage(params.data.pageId);
  if (!eff.found) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  if (eff.entityId == null) {
    res.json({ options: [] });
    return;
  }
  res.json({ options: await buildRelationOptions(eff.entityId) });
});

/**
 * Build the qualifying single-link relation options for an entity (both
 * directions), each with its related entity's active fields. Shared by the
 * page- and entity-keyed relation-options endpoints.
 */
async function buildRelationOptions(entityId: number): Promise<
  {
    relationId: number;
    label: unknown;
    relatedEntityId: number;
    relatedEntityLabel: unknown;
    fields: { key: string; label: unknown; fieldType: string }[];
  }[]
> {
  const relations = await db
    .select()
    .from(relationsTable)
    .where(or(eq(relationsTable.sourceEntityId, entityId), eq(relationsTable.targetEntityId, entityId)));

  const options: {
    relationId: number;
    label: unknown;
    relatedEntityId: number;
    relatedEntityLabel: unknown;
    fields: { key: string; label: unknown; fieldType: string }[];
  }[] = [];

  for (const relation of relations) {
    const direction = relationDirection(relation, entityId);
    if (!direction) continue;
    const relatedEntityId = relatedEntityIdFor(relation, direction);
    const [relatedEntity] = await db
      .select({ id: entitiesTable.id, nameJson: entitiesTable.nameJson })
      .from(entitiesTable)
      .where(eq(entitiesTable.id, relatedEntityId));
    if (!relatedEntity) continue;
    const fields = await db
      .select({ fieldKey: entityFieldsTable.fieldKey, nameJson: entityFieldsTable.nameJson, fieldType: entityFieldsTable.fieldType })
      .from(entityFieldsTable)
      .where(and(eq(entityFieldsTable.entityId, relatedEntityId), eq(entityFieldsTable.isActive, true)))
      .orderBy(asc(entityFieldsTable.sortOrder));
    options.push({
      relationId: relation.id,
      // For the target side show the inverse name so the label reads from the
      // referencing entity's perspective.
      label: direction === "target" ? relation.inverseNameJson : relation.nameJson,
      relatedEntityId,
      relatedEntityLabel: relatedEntity.nameJson,
      fields: fields.map((f) => ({ key: f.fieldKey, label: f.nameJson, fieldType: f.fieldType })),
    });
  }
  return options;
}

/**
 * Entity-keyed variant of relation-options: used by the dashboard widget editors
 * (metric related fields, table related columns) where the entity is chosen
 * freely rather than derived from a page. Admin-only (backs admin config UIs).
 */
router.get("/entities/:entityId/relation-options", requireAuth, requireAdmin("entities"), async (req, res): Promise<void> => {
  const params = GetEntityRelationOptionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, params.data.entityId))
    .limit(1);
  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  res.json({ options: await buildRelationOptions(params.data.entityId) });
});

export default router;
