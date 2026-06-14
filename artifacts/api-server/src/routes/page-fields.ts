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
  type DependencyFieldConfig,
  type FieldPermissions,
  type EntityField,
} from "@workspace/db";
import { eq, asc, desc, and, ne, inArray, or, sql, type SQL } from "drizzle-orm";
import { relationLinkLockViolation } from "../lib/relation-lock";
import { requireAuth } from "../middlewares/auth";
import {
  requireAdmin,
  assertRecord,
  canRecord,
  getPermissions,
  getUserRoleIds,
  effectiveScope,
  effectiveScopeFor,
  effectiveStatusVisibility,
  resolveFieldAccess,
  mostPermissiveFieldPerm,
} from "../middlewares/permissions";
import { ownScopeWhere, isRecordOwned } from "./own-scope";
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
  GetPageRelatedCandidatesParams,
  GetPageRelatedCandidatesBody,
  SetPageRelatedLinkParams,
  SetPageRelatedLinkBody,
  GetPageRelationOptionsParams,
  GetEntityRelationOptionsParams,
  GetEntityRelatedValuesParams,
  GetEntityRelatedValuesBody,
  GetEntityRelatedCandidatesParams,
  GetEntityRelatedCandidatesBody,
  SetEntityRelatedLinkParams,
  SetEntityRelatedLinkBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/**
 * Load an entity's active fields. Needed to classify a role's `scopeFieldKeys`
 * (own-row owner fields) as native vs relation/lookup so the shared relation-
 * aware {@link ownScopeWhere}/{@link isRecordOwned} helpers can resolve ownership
 * designated through a one-hop projected user field, not only native `user`
 * fields. Cached per request would be ideal but these paths are low-traffic.
 */
async function loadActiveEntityFields(entityId: number): Promise<EntityField[]> {
  return db
    .select()
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
}

/**
 * WHERE fragment excluding entity_records rows whose status is hidden-for-rows
 * for this role (mirrors the records list/query boundary). Null-status rows are
 * always kept. Returns undefined when nothing is hidden (no-op). The hard row
 * boundary must hold across page record/related read paths too, not just the
 * records endpoints, or hidden-status rows leak through pages.
 */
function hiddenRowStatusWhere(hiddenRowStatusIds: number[]): SQL | undefined {
  if (hiddenRowStatusIds.length === 0) return undefined;
  return sql`(${entityRecordsTable.statusId} IS NULL OR ${entityRecordsTable.statusId} NOT IN (${sql.join(
    hiddenRowStatusIds.map((id) => sql`${id}`),
    sql`, `,
  )}))`;
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
  // page's effective entity (mirrored or bound) may read its column definitions
  // (honoring a mirror-page view override for the page being read).
  if (eff.entityId != null && !(await assertRecord(req, res, eff.entityId, "view", params.data.pageId))) return;
  const fields = await db
    .select()
    .from(pageFieldsTable)
    .where(eq(pageFieldsTable.pageId, params.data.pageId))
    .orderBy(asc(pageFieldsTable.sortOrder));
  // Per-page role visibility is a hard server boundary: a page-field whose
  // permissionsJson marks the viewer's role "hidden" must not be returned at all
  // (not even its metadata/label/config). Admins who can edit pages still receive
  // every field so the column setup mode can configure hidden columns.
  const perms = await getPermissions(req);
  if (perms.superAdmin || perms.admin.pages) {
    res.json(fields);
    return;
  }
  const roleIds = await getUserRoleIds(req);
  const visible = fields.filter(
    (f) => mostPermissiveFieldPerm(f.permissionsJson as FieldPermissions | null, roleIds, "view") !== "hidden",
  );
  res.json(visible);
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
      .values({
        ...parsed.data,
        formulaConfigJson: clampFormulaDecimals(parsed.data.formulaConfigJson),
        fieldKey: key,
        pageId: params.data.pageId,
      })
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
  if (body.formulaConfigJson != null)
    updateData.formulaConfigJson = clampFormulaDecimals(body.formulaConfigJson);
  if ("relationConfigJson" in body) updateData.relationConfigJson = body.relationConfigJson ?? null;
  if ("permissionsJson" in body) updateData.permissionsJson = body.permissionsJson ?? null;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;
  if (body.showInTable != null) updateData.showInTable = body.showInTable;
  if (body.isPinned != null) updateData.isPinned = body.isPinned;
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
  // Record-level view permission on the page's effective entity is required
  // (honoring a mirror-page override when this page mirrors that entity).
  if (!(await assertRecord(req, res, entityId, "view", params.data.pageId))) return;
  // Restrict the returned values to records the caller is actually allowed to
  // see: only rows of that entity, and only own rows under "own" scope.
  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, params.data.pageId);
  const where: SQL[] = [
    eq(pageRecordValuesTable.pageId, params.data.pageId),
    eq(entityRecordsTable.entityId, entityId),
  ];
  if (scope === "own") {
    const entityFields = await loadActiveEntityFields(entityId);
    where.push(await ownScopeWhere(entityId, scopeFieldKeys, req.user!.userId, entityFields));
  }
  const rvHiddenRowWhere = hiddenRowStatusWhere(effectiveStatusVisibility(perms, entityId).hiddenRowStatusIds);
  if (rvHiddenRowWhere) where.push(rvHiddenRowWhere);
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
  // Record-level update permission on the effective entity is required
  // (honoring a mirror-page override when this page mirrors that entity).
  if (!(await assertRecord(req, res, entityId, "update", pageId))) return;
  // Under "own" scope, the caller may only write to records they own.
  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, pageId);
  if (
    scope === "own" &&
    !(await isRecordOwned(
      entityId,
      { id: record.id, valuesJson: record.valuesJson },
      scopeFieldKeys,
      req.user!.userId,
      await loadActiveEntityFields(entityId),
    ))
  ) {
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
  if (!(await assertRecord(req, res, entityId, "view", params.data.pageId))) return;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
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
    const pagePerm = mostPermissiveFieldPerm(pf.permissionsJson as FieldPermissions | null, roleIds, "view");
    return pagePerm !== "hidden";
  });

  if (relationFields.length === 0 || parsed.data.recordIds.length === 0) {
    res.json({ columns: [], values: [] });
    return;
  }

  // Restrict to records of THIS entity the viewer is allowed to see (own scope),
  // honoring a mirror-page override when this page mirrors that entity.
  const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, params.data.pageId);
  const requested = Array.from(new Set(parsed.data.recordIds));
  // Hard boundary: base records sitting in a row-hidden status (for the page's
  // entity) must not be returned even when their ids are passed in explicitly.
  const baseConds: SQL[] = [
    eq(entityRecordsTable.entityId, entityId),
    inArray(entityRecordsTable.id, requested),
  ];
  const baseHiddenRowWhere = hiddenRowStatusWhere(effectiveStatusVisibility(perms, entityId).hiddenRowStatusIds);
  if (baseHiddenRowWhere) baseConds.push(baseHiddenRowWhere);
  // Own-scope (relation-aware): a row is owned when an owner field — native
  // `user` or a one-hop relation/lookup projecting a `user` field — designates
  // the viewer. Filtering in SQL keeps this correct for relation owner fields
  // (whose ownership is not in values_json) without an in-memory under-include.
  if (scope === "own") {
    const entityFields = await loadActiveEntityFields(entityId);
    baseConds.push(await ownScopeWhere(entityId, scopeFieldKeys, userId, entityFields));
  }
  const pageRecords = await db
    .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(...baseConds));
  const allowedIds = pageRecords.map((r) => r.id);

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

    // Re-apply the related entity's RECORD-VIEW boundary first: a viewer with no
    // view permission on the related entity must get nothing from it, even though
    // resolveFieldAccess defaults to "view" when no explicit field perm exists.
    // Treat lack of related-entity view as hidden (no type, no value, no id).
    const canViewRelated = canRecord(perms, relatedEntityId, "view");
    const access = canViewRelated
      ? resolveFieldAccess(relatedField, perms, roleIds, relatedEntityId)
      : "hidden";
    const pagePerm = mostPermissiveFieldPerm(pf.permissionsJson as FieldPermissions | null, roleIds, "edit");
    const relScope = effectiveScope(perms, relatedEntityId);
    // The column now ASSIGNS the link (not edits the related value): a cell is
    // assignable when the viewer may edit this page-field column, can update the
    // base entity's records (links belong to the base record), and the related
    // field is not hidden (so the chosen record's label is meaningful). This is
    // column-wide, independent of whether a link currently exists, so EMPTY cells
    // are assignable too.
    const columnEditable =
      pagePerm === "edit" && access !== "hidden" && canRecord(perms, entityId, "update");

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
      // Hard boundary: a linked record sitting in a row-hidden status (for the
      // related entity) must not surface its value here either.
      const relHiddenRowWhere = hiddenRowStatusWhere(
        effectiveStatusVisibility(perms, relatedEntityId).hiddenRowStatusIds,
      );
      const linkedConds: SQL[] = [
        eq(entityRecordsTable.entityId, relatedEntityId),
        inArray(entityRecordsTable.id, linkedIds),
      ];
      if (relHiddenRowWhere) linkedConds.push(relHiddenRowWhere);
      // Related own-scope (relation-aware): restrict the loaded linked records to
      // those the viewer owns under the related entity's scope. Doing it in SQL
      // covers relation/lookup owner fields too; non-owned linked records simply
      // never enter linkedMap, so their value/id stay hidden below.
      if (relScope.scope === "own") {
        const relatedFields = await loadActiveEntityFields(relatedEntityId);
        linkedConds.push(await ownScopeWhere(relatedEntityId, relScope.scopeFieldKeys, userId, relatedFields));
      }
      const linkedRecords = await db
        .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
        .from(entityRecordsTable)
        .where(and(...linkedConds));
      for (const lr of linkedRecords) linkedMap.set(lr.id, (lr.valuesJson as Record<string, unknown>) ?? {});
    }

    for (const recordId of allowedIds) {
      const rawLinkedId = linkMap.get(recordId) ?? null;
      let value: unknown = null;
      // Assignability is column-wide and applies even when no link exists yet, so
      // empty cells are clickable to assign a link.
      const editable = columnEditable;
      let visible = false;
      if (rawLinkedId != null && access !== "hidden") {
        // linkedMap already excludes non-owned linked records (own-scope applied
        // in the query above), so presence here means the value is viewable.
        const linkedValues = linkedMap.get(rawLinkedId);
        if (linkedValues != null) {
          visible = true;
          value = linkedValues[relatedFieldKey] ?? null;
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

/** Map a record_links unique-constraint violation to a friendly cardinality message. */
function recordLinkUniqueMessage(err: unknown): string | null {
  if (!isUniqueViolation(err)) return null;
  const cause = err && typeof err === "object" && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  const constraint =
    [err, cause]
      .map((e) => (e && typeof e === "object" && "constraint" in e ? (e as { constraint?: string }).constraint : undefined))
      .find((c): c is string => typeof c === "string") ?? "";
  if (constraint === "record_link_source_one" || constraint === "record_link_target_one") {
    return "Эта запись уже связана с другой";
  }
  if (constraint === "record_link_unique") return "Эти записи уже связаны";
  return "Эти записи уже связаны";
}

/**
 * Resolve a relation page-field for assignment endpoints: the page's effective
 * entity, the named active relation page-field, its (qualifying single-link)
 * relation, direction, related entity, and related field key. Centralises the
 * lookups shared by the candidates and link-set endpoints. Returns an http
 * status + error on any failure so callers can respond uniformly.
 */
async function resolveRelationPageField(
  pageId: number,
  fieldKey: string,
): Promise<
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      entityId: number;
      pageField: PageField;
      relation: Relation;
      direction: LinkDirection;
      relatedEntityId: number;
      relatedFieldKey: string;
      relatedField: typeof entityFieldsTable.$inferSelect;
    }
> {
  const eff = await effectiveEntityForPage(pageId);
  if (!eff.found) return { ok: false, status: 404, error: "Page not found" };
  if (eff.entityId == null) return { ok: false, status: 400, error: "Page has no entity" };
  const [pageField] = await db
    .select()
    .from(pageFieldsTable)
    .where(
      and(
        eq(pageFieldsTable.pageId, pageId),
        eq(pageFieldsTable.fieldKey, fieldKey),
        eq(pageFieldsTable.isActive, true),
        eq(pageFieldsTable.fieldType, "relation"),
      ),
    );
  if (!pageField) return { ok: false, status: 404, error: "Relation field not found" };
  const cfg = pageField.relationConfigJson as RelationFieldConfig | null;
  const relationId = cfg?.relationId ?? null;
  const relatedFieldKey = cfg?.relatedFieldKey ?? null;
  if (relationId == null || !relatedFieldKey) return { ok: false, status: 400, error: "Relation field is not configured" };
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
  if (!relation) return { ok: false, status: 400, error: "Relation not found" };
  const direction = relationDirection(relation, eff.entityId);
  if (!direction) return { ok: false, status: 400, error: "Relation does not yield a single linked record" };
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
  if (!relatedField) return { ok: false, status: 400, error: "Related field not found" };
  return {
    ok: true,
    entityId: eff.entityId,
    pageField,
    relation,
    direction,
    relatedEntityId,
    relatedFieldKey,
    relatedField,
  };
}

/**
 * List candidate related-entity records the viewer may link to a relation
 * page-field cell, each labelled by the related field value. RBAC: the viewer
 * must be able to view the page's entity and the related entity (record-level),
 * the page-field column must not be hidden for their role, and the related
 * entity's own-row scope is applied. Supports optional case-insensitive search
 * over the label. Backs the searchable link picker.
 */
router.post("/pages/:pageId/related-candidates", requireAuth, async (req, res): Promise<void> => {
  const params = GetPageRelatedCandidatesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = GetPageRelatedCandidatesBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const resolved = await resolveRelationPageField(params.data.pageId, body.data.fieldKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const { entityId, pageField, relatedEntityId, relatedFieldKey, relatedField } = resolved;
  if (!(await assertRecord(req, res, entityId, "view", params.data.pageId))) return;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user!.userId;
  const pagePerm = mostPermissiveFieldPerm(pageField.permissionsJson as FieldPermissions | null, roleIds, "edit");
  // Mirror the related-values column boundary: the viewer must be able to view
  // the related entity AND the specific related field must not be hidden for
  // their role. The label/search expose that field's value, so a hidden related
  // field must not be enumerable or searchable through this endpoint.
  if (pagePerm === "hidden" || !canRecord(perms, relatedEntityId, "view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (resolveFieldAccess(relatedField, perms, roleIds, relatedEntityId) === "hidden") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const relScope = effectiveScope(perms, relatedEntityId);
  const conds: SQL[] = [eq(entityRecordsTable.entityId, relatedEntityId)];
  if (relScope.scope === "own") {
    const relatedFields = await loadActiveEntityFields(relatedEntityId);
    conds.push(await ownScopeWhere(relatedEntityId, relScope.scopeFieldKeys, userId, relatedFields));
  }
  // Hard boundary: row-hidden-status records of the related entity must not be
  // offered as link candidates (mirrors the records list/query exclusion).
  const candHiddenRowWhere = hiddenRowStatusWhere(
    effectiveStatusVisibility(perms, relatedEntityId).hiddenRowStatusIds,
  );
  if (candHiddenRowWhere) conds.push(candHiddenRowWhere);
  const q = body.data.q?.trim();
  if (q) {
    conds.push(sql`(${entityRecordsTable.valuesJson} ->> ${relatedFieldKey}) ILIKE ${`%${q}%`}`);
  }
  const rows = await db
    .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(...conds))
    .orderBy(desc(entityRecordsTable.id))
    .limit(50);

  const candidates = rows.map((r) => {
    const v = ((r.valuesJson as Record<string, unknown>) ?? {})[relatedFieldKey];
    return { id: r.id, label: v == null ? "" : String(v) };
  });
  res.json({ candidates });
});

/**
 * Assign, change, or clear the single link backing a relation page-field cell.
 * The link belongs to the BASE (page) record, so RBAC requires: the page-field
 * column editable for the viewer's role, update on the base entity + base
 * own-row scope, and (when linking) view on the related entity + related
 * own-row scope. The change is a transactional delete-then-insert of the single
 * link for (relation, base record, direction); a cardinality conflict on the
 * other side maps to 409.
 */
router.put("/pages/:pageId/related-link", requireAuth, async (req, res): Promise<void> => {
  const params = SetPageRelatedLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = SetPageRelatedLinkBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const resolved = await resolveRelationPageField(params.data.pageId, body.data.fieldKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const { entityId, pageField, relation, direction, relatedEntityId, relatedFieldKey, relatedField } = resolved;
  const baseRecordId = body.data.recordId;
  const linkedRecordId = body.data.linkedRecordId ?? null;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user!.userId;
  const pagePerm = mostPermissiveFieldPerm(pageField.permissionsJson as FieldPermissions | null, roleIds, "edit");
  // Mirror the related-values assignability boundary: the column is only
  // assignable when the page-field column is editable for the role, the viewer
  // can update the base entity, AND the related field is not hidden for them.
  // Enforced here too so a direct API call cannot bypass the hidden boundary.
  const relatedAccess = canRecord(perms, relatedEntityId, "view")
    ? resolveFieldAccess(relatedField, perms, roleIds, relatedEntityId)
    : "hidden";
  if (pagePerm !== "edit" || !canRecord(perms, entityId, "update") || relatedAccess === "hidden") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Base record must belong to this entity and pass the viewer's own-row scope
  // (honoring a mirror-page override when this page mirrors that entity).
  const [baseRecord] = await db
    .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(eq(entityRecordsTable.id, baseRecordId), eq(entityRecordsTable.entityId, entityId)));
  if (!baseRecord) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  const baseScope = await effectiveScopeFor(req, perms, entityId, params.data.pageId);
  if (
    baseScope.scope === "own" &&
    !(await isRecordOwned(
      entityId,
      { id: baseRecord.id, valuesJson: baseRecord.valuesJson },
      baseScope.scopeFieldKeys,
      userId,
      await loadActiveEntityFields(entityId),
    ))
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // When linking (not clearing), the related record must exist, belong to the
  // related entity, and be viewable by the viewer (record perm + own-row scope).
  let linkedValues: Record<string, unknown> | null = null;
  if (linkedRecordId != null) {
    if (!canRecord(perms, relatedEntityId, "view")) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // Hard boundary: the linked record must pass the viewer's row-hidden-status
    // filter for the related entity too — mirrors the related-candidates
    // exclusion so a direct PUT with a known id cannot link to (and read the
    // value of) a status-hidden record.
    const linkConds: SQL[] = [
      eq(entityRecordsTable.id, linkedRecordId),
      eq(entityRecordsTable.entityId, relatedEntityId),
    ];
    const linkHiddenRowWhere = hiddenRowStatusWhere(
      effectiveStatusVisibility(perms, relatedEntityId).hiddenRowStatusIds,
    );
    if (linkHiddenRowWhere) linkConds.push(linkHiddenRowWhere);
    const [linked] = await db
      .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
      .from(entityRecordsTable)
      .where(and(...linkConds));
    if (!linked) {
      res.status(400).json({ error: "Linked record not found" });
      return;
    }
    const relScope = effectiveScope(perms, relatedEntityId);
    const lv = (linked.valuesJson as Record<string, unknown>) ?? {};
    if (
      relScope.scope === "own" &&
      !(await isRecordOwned(
        relatedEntityId,
        { id: linked.id, valuesJson: linked.valuesJson },
        relScope.scopeFieldKeys,
        userId,
        await loadActiveEntityFields(relatedEntityId),
      ))
    ) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    linkedValues = lv;
  }

  try {
    const lockMsg = await db.transaction(async (tx) => {
      // Lock the relation so the relationType copied into record_links cannot
      // drift from the parent under a concurrent type change.
      const [locked] = await tx
        .select()
        .from(relationsTable)
        .where(eq(relationsTable.id, relation.id))
        .limit(1)
        .for("update");
      if (!locked) throw new Error("relation_gone");
      // Immutability boundary for lockAfterCreate relation fields, checked under
      // the relation row lock (TOCTOU-free). A relation page-field can target the
      // same relation as a locked entity field, so this path must enforce it too.
      const lockViolation = await relationLinkLockViolation(
        tx,
        entityId,
        relation.id,
        baseRecordId,
        direction,
        linkedRecordId,
      );
      if (lockViolation) return lockViolation;
      // Remove the existing single link on the base record's side, then insert
      // the new one (or leave it cleared when linkedRecordId is null).
      const baseCol = direction === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId;
      await tx.delete(recordLinksTable).where(and(eq(recordLinksTable.relationId, relation.id), eq(baseCol, baseRecordId)));
      if (linkedRecordId != null) {
        await tx.insert(recordLinksTable).values({
          relationId: relation.id,
          relationType: locked.relationType,
          sourceRecordId: direction === "source" ? baseRecordId : linkedRecordId,
          targetRecordId: direction === "source" ? linkedRecordId : baseRecordId,
        });
      }
      return null;
    });
    if (lockMsg) {
      res.status(400).json({ error: lockMsg });
      return;
    }
  } catch (err) {
    const msg = recordLinkUniqueMessage(err);
    if (msg) {
      res.status(409).json({ error: msg });
      return;
    }
    throw err;
  }

  // Report the resulting value. The related field's hidden boundary was already
  // enforced above (relatedAccess !== "hidden" is required to reach this point).
  const value = linkedRecordId != null && linkedValues != null ? (linkedValues[relatedFieldKey] ?? null) : null;
  res.json({ linkedRecordId, value });
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
    direction: LinkDirection;
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
    direction: LinkDirection;
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
      direction,
      relatedEntityId,
      relatedEntityLabel: relatedEntity.nameJson,
      fields: fields.map((f) => ({ key: f.fieldKey, label: f.nameJson, fieldType: f.fieldType })),
    });
  }
  return options;
}

/**
 * Entity-keyed variant of relation-options: used both by the dashboard widget
 * editors (metric related fields, table related columns), gated by the `pages`
 * cap, and by the entity Fields Builder (configuring a `relation` field), gated
 * by the `entities` cap. Either capability suffices, so a role that has one but
 * not the other can still use its own surface.
 */
router.get("/entities/:entityId/relation-options", requireAuth, async (req, res): Promise<void> => {
  const optPerms = await getPermissions(req);
  if (!optPerms.superAdmin && !optPerms.admin.entities && !optPerms.admin.pages) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
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

/**
 * Resolve a relation ENTITY-field for the assignment endpoints: the entity, the
 * named active relation field, its (qualifying single-link) relation, direction,
 * related entity, and related field. Entity analogue of `resolveRelationPageField`,
 * but the relation field's OWN per-role access (`resolveFieldAccess`) governs the
 * column — there is no page-field role-visibility layer here.
 */
async function resolveRelationEntityField(
  entityId: number,
  fieldKey: string,
): Promise<
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      field: typeof entityFieldsTable.$inferSelect;
      relation: Relation;
      direction: LinkDirection;
      relatedEntityId: number;
      relatedFieldKey: string;
      relatedField: typeof entityFieldsTable.$inferSelect;
    }
> {
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  if (!entity) return { ok: false, status: 404, error: "Entity not found" };
  const [field] = await db
    .select()
    .from(entityFieldsTable)
    .where(
      and(
        eq(entityFieldsTable.entityId, entityId),
        eq(entityFieldsTable.fieldKey, fieldKey),
        eq(entityFieldsTable.isActive, true),
        eq(entityFieldsTable.fieldType, "relation"),
      ),
    );
  if (!field) return { ok: false, status: 404, error: "Relation field not found" };
  const cfg = field.relationConfigJson as RelationFieldConfig | null;
  const relationId = cfg?.relationId ?? null;
  const relatedFieldKey = cfg?.relatedFieldKey ?? null;
  if (relationId == null || !relatedFieldKey) return { ok: false, status: 400, error: "Relation field is not configured" };
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
  if (!relation) return { ok: false, status: 400, error: "Relation not found" };
  const direction = relationDirection(relation, entityId);
  if (!direction) return { ok: false, status: 400, error: "Relation does not yield a single linked record" };
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
  if (!relatedField) return { ok: false, status: 400, error: "Related field not found" };
  return { ok: true, field, relation, direction, relatedEntityId, relatedFieldKey, relatedField };
}

/**
 * Hard server boundary for a dependent (cascading) relation field: a link may
 * only be SET when the linked record actually matches the base record's current
 * parent value under `relatedFilterFieldKey`. Mirrors the candidate-list filter
 * so the dependency is enforced on the write path, not merely cosmetic in the UI
 * (a direct PUT with a known id must not bypass it). Clearing a link is handled
 * by the caller and always allowed. Returns `{ ok: true }` when the field is not
 * dependent or the link satisfies the dependency.
 */
async function checkDependentRelationLink(args: {
  field: typeof entityFieldsTable.$inferSelect;
  baseEntityId: number;
  baseRecordId: number;
  baseValues: Record<string, unknown>;
  relatedEntityId: number;
  linkedRecordId: number;
  linkedValues: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const dep = args.field.dependencyConfigJson as DependencyFieldConfig | null;
  const dependsOnFieldKey = dep?.dependsOnFieldKey?.trim();
  const relatedFilterFieldKey = dep?.relatedFilterFieldKey?.trim();
  if (!dependsOnFieldKey || !relatedFilterFieldKey) return { ok: true };

  // Resolve the base record's parent value (relation parent -> linked record id;
  // scalar parent -> stored JSONB value).
  const [parentField] = await db
    .select()
    .from(entityFieldsTable)
    .where(
      and(
        eq(entityFieldsTable.entityId, args.baseEntityId),
        eq(entityFieldsTable.fieldKey, dependsOnFieldKey),
        eq(entityFieldsTable.isActive, true),
      ),
    );
  let parentValue = "";
  if (parentField?.fieldType === "relation") {
    const pr = await resolveRelationEntityField(args.baseEntityId, dependsOnFieldKey);
    if (pr.ok) {
      const baseCol =
        pr.direction === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId;
      const otherCol =
        pr.direction === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId;
      const [pl] = await db
        .select({ id: otherCol })
        .from(recordLinksTable)
        .where(and(eq(recordLinksTable.relationId, pr.relation.id), eq(baseCol, args.baseRecordId)))
        .limit(1);
      parentValue = pl?.id == null ? "" : String(pl.id);
    }
  } else {
    const raw = args.baseValues[dependsOnFieldKey];
    parentValue = raw == null || raw === "" ? "" : String(raw);
  }
  if (!parentValue) return { ok: false, error: "Сначала заполните родительское поле" };

  // Resolve the filter field on the related entity and verify the linked record
  // matches the parent value (relation filter -> match via record_links; scalar
  // filter -> compare the stored value).
  const [filterField] = await db
    .select()
    .from(entityFieldsTable)
    .where(
      and(
        eq(entityFieldsTable.entityId, args.relatedEntityId),
        eq(entityFieldsTable.fieldKey, relatedFilterFieldKey),
        eq(entityFieldsTable.isActive, true),
      ),
    );
  if (!filterField) return { ok: false, error: "Связанная запись не соответствует родителю" };

  if (filterField.fieldType === "relation") {
    const fr = await resolveRelationEntityField(args.relatedEntityId, relatedFilterFieldKey);
    const parentId = Number(parentValue);
    if (!fr.ok || !Number.isFinite(parentId)) {
      return { ok: false, error: "Связанная запись не соответствует родителю" };
    }
    const baseCol =
      fr.direction === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId;
    const otherCol =
      fr.direction === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId;
    const [m] = await db
      .select({ id: baseCol })
      .from(recordLinksTable)
      .where(
        and(
          eq(recordLinksTable.relationId, fr.relation.id),
          eq(baseCol, args.linkedRecordId),
          eq(otherCol, parentId),
        ),
      )
      .limit(1);
    if (!m) return { ok: false, error: "Связанная запись не соответствует родителю" };
  } else {
    const lv = args.linkedValues[relatedFilterFieldKey];
    if ((lv == null ? "" : String(lv)) !== parentValue) {
      return { ok: false, error: "Связанная запись не соответствует родителю" };
    }
  }
  return { ok: true };
}

/**
 * Resolve relation-type ENTITY-field column values for a set of the entity's
 * records. Mirror of the page `related-values` endpoint, but the relation field's
 * own per-role access (not a page-field visibility entry) decides whether the
 * column appears and whether its cells may assign links. The full RBAC boundary
 * (related-entity record view, related field hidden/edit access, own-row scope on
 * both sides, and row-hidden-status exclusion) is re-applied identically.
 */
router.post("/entities/:entityId/related-values", requireAuth, async (req, res): Promise<void> => {
  const params = GetEntityRelatedValuesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = GetEntityRelatedValuesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const entityId = params.data.entityId;
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  // Mirror-page context: when the records are viewed through a mirror page, the
  // viewer's access to this entity may come ONLY from a per-mirror override
  // (entity-level view can be off). Honor that override for both the view gate
  // and own-scope, exactly like the page-keyed record read paths. A spoofed
  // pageId is harmless: assertRecord/effectiveScopeFor only apply the override
  // when the caller is authorized to the page AND the page mirrors this entity.
  const pageId = parsed.data.pageId ?? undefined;
  if (!(await assertRecord(req, res, entityId, "view", pageId))) return;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user!.userId;

  const relationFields = (
    await db
      .select()
      .from(entityFieldsTable)
      .where(
        and(
          eq(entityFieldsTable.entityId, entityId),
          eq(entityFieldsTable.isActive, true),
          inArray(entityFieldsTable.fieldType, ["relation", "lookup"]),
        ),
      )
      .orderBy(asc(entityFieldsTable.sortOrder))
  ).filter((f) => resolveFieldAccess(f, perms, roleIds, entityId) !== "hidden");

  if (relationFields.length === 0 || parsed.data.recordIds.length === 0) {
    res.json({ columns: [], values: [] });
    return;
  }

  const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, pageId);
  const requested = Array.from(new Set(parsed.data.recordIds));
  const baseConds: SQL[] = [
    eq(entityRecordsTable.entityId, entityId),
    inArray(entityRecordsTable.id, requested),
  ];
  const baseHiddenRowWhere = hiddenRowStatusWhere(effectiveStatusVisibility(perms, entityId).hiddenRowStatusIds);
  if (baseHiddenRowWhere) baseConds.push(baseHiddenRowWhere);
  // Own-scope (relation-aware) filtered in SQL — see the page-fields variant for
  // rationale (relation/lookup owner fields have no value in values_json).
  if (scope === "own") {
    const entityFields = await loadActiveEntityFields(entityId);
    baseConds.push(await ownScopeWhere(entityId, scopeFieldKeys, userId, entityFields));
  }
  const baseRecords = await db
    .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(...baseConds));
  const allowedIds = baseRecords.map((r) => r.id);

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
    relatedEntityId?: number;
    writeThrough?: boolean;
  }[] = [];
  const values: {
    recordId: number;
    fieldKey: string;
    value: unknown;
    linkedRecordId: number | null;
    editable: boolean;
  }[] = [];

  for (const f of relationFields) {
    const cfg = f.relationConfigJson as RelationFieldConfig | null;
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

    // Re-apply the related entity's RECORD-VIEW boundary first (resolveFieldAccess
    // defaults to "view" when no explicit perm exists, so treat no related-entity
    // view as hidden). The relation field's OWN access decides assignability.
    const canViewRelated = canRecord(perms, relatedEntityId, "view");
    const access = canViewRelated
      ? resolveFieldAccess(relatedField, perms, roleIds, relatedEntityId)
      : "hidden";
    const ownAccess = resolveFieldAccess(f, perms, roleIds, entityId);
    const relScope = effectiveScope(perms, relatedEntityId);
    // The cell ASSIGNS the link (not edits the related value): assignable when
    // the relation field is editable for the role, the viewer can update the base
    // entity, and the related field is not hidden. Column-wide, so empty cells are
    // assignable too.
    // A lookup field is read-only: it projects another field of the linked record
    // and never assigns the link, so its column is never editable.
    const columnEditable =
      f.fieldType !== "lookup" &&
      ownAccess === "edit" && access !== "hidden" && canRecord(perms, entityId, "update");

    // A write-through lookup is read-only as a VALUE (columnEditable stays false,
    // no inline edit) but its cells act as a gateway: when a link exists the
    // client opens the linked record's full editor in the related entity. We
    // surface the related entity id + flag so the client knows where to navigate;
    // the real write boundary is enforced by that entity's own record PUT.
    const writeThrough =
      f.fieldType === "lookup" && cfg?.writeThrough === true && access !== "hidden";

    columns.push({
      fieldKey: f.fieldKey,
      relatedFieldKey,
      relatedFieldType: access === "hidden" ? null : relatedField.fieldType,
      optionsJson: access === "hidden" ? [] : ((relatedField.optionsJson as string[]) ?? []),
      editableColumn: columnEditable,
      relatedEntityId: access === "hidden" ? undefined : relatedEntityId,
      writeThrough,
    });

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

    const linkedIds = Array.from(new Set(linkRows.map((l) => l.to)));
    const linkedMap = new Map<number, Record<string, unknown>>();
    if (linkedIds.length > 0 && access !== "hidden") {
      const relHiddenRowWhere = hiddenRowStatusWhere(
        effectiveStatusVisibility(perms, relatedEntityId).hiddenRowStatusIds,
      );
      const linkedConds: SQL[] = [
        eq(entityRecordsTable.entityId, relatedEntityId),
        inArray(entityRecordsTable.id, linkedIds),
      ];
      if (relHiddenRowWhere) linkedConds.push(relHiddenRowWhere);
      // Related own-scope (relation-aware) applied in SQL; non-owned linked
      // records never enter linkedMap, so their value/id stay hidden below.
      if (relScope.scope === "own") {
        const relatedFields = await loadActiveEntityFields(relatedEntityId);
        linkedConds.push(await ownScopeWhere(relatedEntityId, relScope.scopeFieldKeys, userId, relatedFields));
      }
      const linkedRecords = await db
        .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
        .from(entityRecordsTable)
        .where(and(...linkedConds));
      for (const lr of linkedRecords) linkedMap.set(lr.id, (lr.valuesJson as Record<string, unknown>) ?? {});
    }

    for (const recordId of allowedIds) {
      const rawLinkedId = linkMap.get(recordId) ?? null;
      let value: unknown = null;
      const editable = columnEditable;
      let visible = false;
      if (rawLinkedId != null && access !== "hidden") {
        // linkedMap already excludes non-owned linked records (own-scope applied
        // in the query above), so presence here means the value is viewable.
        const linkedValues = linkedMap.get(rawLinkedId);
        if (linkedValues != null) {
          visible = true;
          value = linkedValues[relatedFieldKey] ?? null;
        }
      }
      // Do not leak the linked record's id when its content is not visible.
      values.push({ recordId, fieldKey: f.fieldKey, value, linkedRecordId: visible ? rawLinkedId : null, editable });
    }
  }

  res.json({ columns, values });
});

/**
 * List candidate related-entity records the viewer may link to a relation
 * entity-field cell, each labelled by the related field value. RBAC: the viewer
 * must view the entity and the related entity (record-level), the relation field
 * must not be hidden for their role, and the related entity's own-row scope is
 * applied. Optional case-insensitive search over the label. Backs the picker.
 */
router.post("/entities/:entityId/related-candidates", requireAuth, async (req, res): Promise<void> => {
  const params = GetEntityRelatedCandidatesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = GetEntityRelatedCandidatesBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const resolved = await resolveRelationEntityField(params.data.entityId, body.data.fieldKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const { field, relatedEntityId, relatedFieldKey, relatedField } = resolved;
  const entityId = params.data.entityId;
  if (!(await assertRecord(req, res, entityId, "view"))) return;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user!.userId;
  const ownAccess = resolveFieldAccess(field, perms, roleIds, entityId);
  // The relation field must not be hidden for the role, the viewer must be able
  // to view the related entity, and the labelled related field must not be hidden.
  if (ownAccess === "hidden" || !canRecord(perms, relatedEntityId, "view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (resolveFieldAccess(relatedField, perms, roleIds, relatedEntityId) === "hidden") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const relScope = effectiveScope(perms, relatedEntityId);
  const conds: SQL[] = [eq(entityRecordsTable.entityId, relatedEntityId)];
  if (relScope.scope === "own") {
    const relatedFields = await loadActiveEntityFields(relatedEntityId);
    conds.push(await ownScopeWhere(relatedEntityId, relScope.scopeFieldKeys, userId, relatedFields));
  }
  const candHiddenRowWhere = hiddenRowStatusWhere(
    effectiveStatusVisibility(perms, relatedEntityId).hiddenRowStatusIds,
  );
  if (candHiddenRowWhere) conds.push(candHiddenRowWhere);
  const q = body.data.q?.trim();
  if (q) {
    conds.push(sql`(${entityRecordsTable.valuesJson} ->> ${relatedFieldKey}) ILIKE ${`%${q}%`}`);
  }

  // Dependent (cascading) relation field: when configured, narrow the candidate
  // list to related records whose `relatedFilterFieldKey` matches the parent
  // field's value in the row being edited. `parentValue` is supplied by the
  // client (a scalar value, or a linked record id for a relation parent). An
  // empty parent yields no candidates (the picker is also gated client-side).
  const dep = field.dependencyConfigJson as DependencyFieldConfig | null;
  const dependsOnFieldKey = dep?.dependsOnFieldKey?.trim();
  const relatedFilterFieldKey = dep?.relatedFilterFieldKey?.trim();
  if (dependsOnFieldKey && relatedFilterFieldKey) {
    const parentValue = body.data.parentValue?.trim() ?? "";
    if (!parentValue) {
      res.json({ candidates: [] });
      return;
    }
    const [filterField] = await db
      .select()
      .from(entityFieldsTable)
      .where(
        and(
          eq(entityFieldsTable.entityId, relatedEntityId),
          eq(entityFieldsTable.fieldKey, relatedFilterFieldKey),
          eq(entityFieldsTable.isActive, true),
        ),
      );
    if (!filterField) {
      res.json({ candidates: [] });
      return;
    }
    if (filterField.fieldType === "relation") {
      // The filter field on the related entity is itself a relation: match by the
      // linked record id (parentValue) via record_links on that relation.
      const fr = await resolveRelationEntityField(relatedEntityId, relatedFilterFieldKey);
      const parentId = Number(parentValue);
      if (!fr.ok || !Number.isFinite(parentId)) {
        res.json({ candidates: [] });
        return;
      }
      const baseCol =
        fr.direction === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId;
      const otherCol =
        fr.direction === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId;
      const linkRows = await db
        .select({ id: baseCol })
        .from(recordLinksTable)
        .where(and(eq(recordLinksTable.relationId, fr.relation.id), eq(otherCol, parentId)));
      const ids = linkRows.map((r) => r.id);
      if (ids.length === 0) {
        res.json({ candidates: [] });
        return;
      }
      conds.push(inArray(entityRecordsTable.id, ids));
    } else {
      // Scalar filter field: match the stored JSONB value as text.
      conds.push(sql`(${entityRecordsTable.valuesJson} ->> ${relatedFilterFieldKey}) = ${parentValue}`);
    }
  }

  const rows = await db
    .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(...conds))
    .orderBy(desc(entityRecordsTable.id))
    .limit(50);

  const candidates = rows.map((r) => {
    const v = ((r.valuesJson as Record<string, unknown>) ?? {})[relatedFieldKey];
    return { id: r.id, label: v == null ? "" : String(v) };
  });
  // Surface the related entity id + create permission so the client can offer an
  // in-place "add record" affordance (create a record in the related entity and
  // link it without leaving the picker).
  res.json({
    candidates,
    relatedEntityId,
    relatedFieldKey,
    canCreate: canRecord(perms, relatedEntityId, "create"),
  });
});

/**
 * Assign, change, or clear the single link backing a relation entity-field cell.
 * The link belongs to the base record. RBAC: the relation field editable for the
 * viewer's role, update on the base entity + base own-row scope, and (when
 * linking) view on the related entity + related own-row scope. Transactional
 * delete-then-insert of the single link; a cardinality conflict maps to 409.
 */
router.put("/entities/:entityId/related-link", requireAuth, async (req, res): Promise<void> => {
  const params = SetEntityRelatedLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = SetEntityRelatedLinkBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const resolved = await resolveRelationEntityField(params.data.entityId, body.data.fieldKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const { field, relation, direction, relatedEntityId, relatedFieldKey, relatedField } = resolved;
  const entityId = params.data.entityId;
  const baseRecordId = body.data.recordId;
  const linkedRecordId = body.data.linkedRecordId ?? null;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user!.userId;
  const ownAccess = resolveFieldAccess(field, perms, roleIds, entityId);
  const relatedAccess = canRecord(perms, relatedEntityId, "view")
    ? resolveFieldAccess(relatedField, perms, roleIds, relatedEntityId)
    : "hidden";
  if (ownAccess !== "edit" || !canRecord(perms, entityId, "update") || relatedAccess === "hidden") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [baseRecord] = await db
    .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(eq(entityRecordsTable.id, baseRecordId), eq(entityRecordsTable.entityId, entityId)));
  if (!baseRecord) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  const baseScope = effectiveScope(perms, entityId);
  if (
    baseScope.scope === "own" &&
    !(await isRecordOwned(
      entityId,
      { id: baseRecord.id, valuesJson: baseRecord.valuesJson },
      baseScope.scopeFieldKeys,
      userId,
      await loadActiveEntityFields(entityId),
    ))
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  let linkedValues: Record<string, unknown> | null = null;
  if (linkedRecordId != null) {
    if (!canRecord(perms, relatedEntityId, "view")) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // Hard boundary: the linked record must pass the viewer's row-hidden-status
    // filter for the related entity too — mirrors the related-candidates
    // exclusion so a direct PUT with a known id cannot link to (and read the
    // value of) a status-hidden record.
    const linkConds: SQL[] = [
      eq(entityRecordsTable.id, linkedRecordId),
      eq(entityRecordsTable.entityId, relatedEntityId),
    ];
    const linkHiddenRowWhere = hiddenRowStatusWhere(
      effectiveStatusVisibility(perms, relatedEntityId).hiddenRowStatusIds,
    );
    if (linkHiddenRowWhere) linkConds.push(linkHiddenRowWhere);
    const [linked] = await db
      .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
      .from(entityRecordsTable)
      .where(and(...linkConds));
    if (!linked) {
      res.status(400).json({ error: "Linked record not found" });
      return;
    }
    const relScope = effectiveScope(perms, relatedEntityId);
    const lv = (linked.valuesJson as Record<string, unknown>) ?? {};
    if (
      relScope.scope === "own" &&
      !(await isRecordOwned(
        relatedEntityId,
        { id: linked.id, valuesJson: linked.valuesJson },
        relScope.scopeFieldKeys,
        userId,
        await loadActiveEntityFields(relatedEntityId),
      ))
    ) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    linkedValues = lv;

    // Dependent (cascading) relation field: enforce that the chosen record matches
    // the base record's current parent value as a hard server boundary (the UI
    // gating/filtering alone is not authoritative). Clearing a link is exempt.
    const depCheck = await checkDependentRelationLink({
      field,
      baseEntityId: entityId,
      baseRecordId,
      baseValues: (baseRecord.valuesJson as Record<string, unknown>) ?? {},
      relatedEntityId,
      linkedRecordId,
      linkedValues: lv,
    });
    if (!depCheck.ok) {
      res.status(400).json({ error: depCheck.error });
      return;
    }
  }

  try {
    const lockMsg = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(relationsTable)
        .where(eq(relationsTable.id, relation.id))
        .limit(1)
        .for("update");
      if (!locked) throw new Error("relation_gone");
      // Immutability boundary for lockAfterCreate relation fields, checked under
      // the relation row lock so two writers cannot both pass a "no link yet"
      // check and race to set the value (TOCTOU-free).
      const lockViolation = await relationLinkLockViolation(
        tx,
        entityId,
        relation.id,
        baseRecordId,
        direction,
        linkedRecordId,
      );
      if (lockViolation) return lockViolation;
      const baseCol = direction === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId;
      await tx.delete(recordLinksTable).where(and(eq(recordLinksTable.relationId, relation.id), eq(baseCol, baseRecordId)));
      if (linkedRecordId != null) {
        await tx.insert(recordLinksTable).values({
          relationId: relation.id,
          relationType: locked.relationType,
          sourceRecordId: direction === "source" ? baseRecordId : linkedRecordId,
          targetRecordId: direction === "source" ? linkedRecordId : baseRecordId,
        });
      }
      return null;
    });
    if (lockMsg) {
      res.status(400).json({ error: lockMsg });
      return;
    }
  } catch (err) {
    const msg = recordLinkUniqueMessage(err);
    if (msg) {
      res.status(409).json({ error: msg });
      return;
    }
    throw err;
  }

  const value = linkedRecordId != null && linkedValues != null ? (linkedValues[relatedFieldKey] ?? null) : null;
  res.json({ linkedRecordId, value });
});

export default router;
