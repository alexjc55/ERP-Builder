import { Router, type IRouter } from "express";
import {
  db,
  pageFieldsTable,
  pageRecordValuesTable,
  pagesTable,
  entityRecordsTable,
  type PageField,
} from "@workspace/db";
import { eq, asc, and, ne, inArray, or, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  requireAdmin,
  assertRecord,
  getPermissions,
  effectiveScope,
  recordOwnedBy,
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
 * Resolve a page's mirrored entity id. Page-local record values only exist on
 * mirror pages, so a null result means the caller targeted a non-mirror page.
 */
async function mirrorEntityIdForPage(pageId: number): Promise<{ found: boolean; mirrorEntityId: number | null }> {
  const [p] = await db
    .select({ id: pagesTable.id, mirrorEntityId: pagesTable.mirrorEntityId })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId));
  if (!p) return { found: false, mirrorEntityId: null };
  return { found: true, mirrorEntityId: p.mirrorEntityId };
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
    if (field.fieldType === "function") continue;
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
  const { found, mirrorEntityId } = await mirrorEntityIdForPage(params.data.pageId);
  if (!found) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  // Page-local field metadata mirrors record visibility: only callers who can
  // view the mirrored entity may read its page-local column definitions.
  if (mirrorEntityId != null && !(await assertRecord(req, res, mirrorEntityId, "view"))) return;
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
  if (body.nameJson != null) updateData.nameJson = body.nameJson;
  if (body.descriptionJson != null) updateData.descriptionJson = body.descriptionJson;
  if (body.fieldType != null) updateData.fieldType = body.fieldType;
  if (body.isRequired != null) updateData.isRequired = body.isRequired;
  if ("defaultValue" in body) updateData.defaultValue = body.defaultValue ?? null;
  if (body.optionsJson != null) updateData.optionsJson = body.optionsJson;
  if (body.formatRulesJson != null) updateData.formatRulesJson = body.formatRulesJson;
  if (body.formulaConfigJson != null) updateData.formulaConfigJson = body.formulaConfigJson;
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;
  if (body.showInTable != null) updateData.showInTable = body.showInTable;
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
  const { found, mirrorEntityId } = await mirrorEntityIdForPage(params.data.pageId);
  if (!found) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  if (mirrorEntityId == null) {
    res.status(400).json({ error: "Page is not a mirror page" });
    return;
  }
  // Record-level view permission on the mirrored entity is required.
  if (!(await assertRecord(req, res, mirrorEntityId, "view"))) return;
  // Restrict the returned values to records the caller is actually allowed to
  // see: only rows of the mirrored entity, and only own rows under "own" scope.
  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, mirrorEntityId);
  const where: SQL[] = [
    eq(pageRecordValuesTable.pageId, params.data.pageId),
    eq(entityRecordsTable.entityId, mirrorEntityId),
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
  const { found, mirrorEntityId } = await mirrorEntityIdForPage(pageId);
  if (!found) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  if (mirrorEntityId == null) {
    res.status(400).json({ error: "Page is not a mirror page" });
    return;
  }
  const [record] = await db
    .select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, recordId));
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  // The record must belong to this page's mirrored entity (no cross-entity writes).
  if (record.entityId !== mirrorEntityId) {
    res.status(400).json({ error: "Record does not belong to this page" });
    return;
  }
  // Record-level update permission on the mirrored entity is required.
  if (!(await assertRecord(req, res, mirrorEntityId, "update"))) return;
  // Under "own" scope, the caller may only write to records they own.
  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, mirrorEntityId);
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

export default router;
