import { Router, type IRouter } from "express";
import { db, entityRecordsTable, entityFieldsTable, entityStatusesTable, entitiesTable, usersTable } from "@workspace/db";
import { eq, asc, desc, and, or, sql, inArray, type SQL } from "drizzle-orm";
import type { Request } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  requireRecordParam,
  assertRecord,
  getPermissions,
  effectiveScope,
  recordOwnedBy,
  resolveFieldAccess,
} from "../middlewares/permissions";
import {
  ListEntityRecordsParams,
  CreateEntityRecordParams,
  CreateEntityRecordBody,
  GetRecordParams,
  UpdateRecordParams,
  UpdateRecordBody,
  DeleteRecordParams,
  QueryEntityRecordsParams,
  QueryEntityRecordsBody,
} from "@workspace/api-zod";
import type { EntityField } from "@workspace/db";
import { buildRecordQuery, type RecordQuerySpec } from "./record-query";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9().\s-]{3,}$/;

async function entityExists(entityId: number): Promise<boolean> {
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  return Boolean(entity);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Validate a record's values against the entity's active field definitions.
 * Returns the cleaned values object, or an error message string.
 */
function validateValues(fields: EntityField[], values: Record<string, unknown>): { values: Record<string, unknown> } | { error: string } {
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));

  // Reject unknown keys (metadata-driven integrity: no junk columns).
  for (const key of Object.keys(values)) {
    if (!fieldByKey.has(key)) {
      return { error: `Unknown field: ${key}` };
    }
  }

  const cleaned: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = values[field.fieldKey];

    if (isEmpty(raw)) {
      if (field.isRequired) {
        return { error: `Field "${field.fieldKey}" is required` };
      }
      continue;
    }

    switch (field.fieldType) {
      case "text":
      case "textarea": {
        if (typeof raw !== "string") return { error: `Field "${field.fieldKey}" must be a string` };
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
      case "phone": {
        if (typeof raw !== "string" || !PHONE_RE.test(raw)) return { error: `Field "${field.fieldKey}" must be a valid phone number` };
        cleaned[field.fieldKey] = raw;
        break;
      }
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
      case "date": {
        if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) return { error: `Field "${field.fieldKey}" must be a valid date` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "datetime": {
        if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) return { error: `Field "${field.fieldKey}" must be a valid datetime` };
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
      case "user": {
        const num = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isInteger(num) || num <= 0) return { error: `Field "${field.fieldKey}" must be a valid user id` };
        cleaned[field.fieldKey] = num;
        break;
      }
      default: {
        // Unknown field type: store as-is to avoid blocking on future types.
        cleaned[field.fieldKey] = raw;
      }
    }
  }

  return { values: cleaned };
}

async function loadActiveFields(entityId: number): Promise<EntityField[]> {
  return db
    .select()
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)))
    .orderBy(asc(entityFieldsTable.sortOrder));
}

/** Verify that every value for a `user`-type field references an existing user. */
async function validateUserRefs(fields: EntityField[], values: Record<string, unknown>): Promise<string | null> {
  const userKeys = fields.filter((f) => f.fieldType === "user").map((f) => f.fieldKey);
  const ids = userKeys
    .map((k) => values[k])
    .filter((v): v is number => typeof v === "number");
  const unique = [...new Set(ids)];
  if (unique.length === 0) return null;
  const rows = await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.id, unique));
  const found = new Set(rows.map((r) => r.id));
  const missing = unique.find((id) => !found.has(id));
  return missing === undefined ? null : `Referenced user ${missing} does not exist`;
}

/**
 * Resolve the requester's field-access context for an entity: which field keys
 * are hidden (stripped from responses) and which are editable (writable).
 */
async function fieldAccessContext(
  req: Request,
  entityId: number,
  fields: EntityField[],
): Promise<{ hidden: Set<string>; editable: Set<string> }> {
  const perms = await getPermissions(req);
  const roleId = req.user!.roleId;
  const hidden = new Set<string>();
  const editable = new Set<string>();
  for (const f of fields) {
    const access = resolveFieldAccess(f, perms, roleId, entityId);
    if (access === "hidden") hidden.add(f.fieldKey);
    if (access === "edit") editable.add(f.fieldKey);
  }
  return { hidden, editable };
}

/** Remove hidden field keys from a record's valuesJson before returning it. */
function stripHidden<T extends { valuesJson: unknown }>(record: T, hidden: Set<string>): T {
  if (hidden.size === 0) return record;
  const values = { ...((record.valuesJson as Record<string, unknown>) ?? {}) };
  for (const k of hidden) delete values[k];
  return { ...record, valuesJson: values };
}

/** SQL predicate restricting rows to those owned by `userId` via scope field keys. */
function ownScopeWhere(scopeFieldKeys: string[], userId: number): SQL {
  if (scopeFieldKeys.length === 0) return sql`false`;
  const clauses = scopeFieldKeys.map(
    (k) => sql`(${entityRecordsTable.valuesJson} ->> ${k}) = ${String(userId)}`,
  );
  return or(...clauses)!;
}

/** Returns true if the status belongs to the given entity. */
async function statusBelongsToEntity(statusId: number, entityId: number): Promise<boolean> {
  const [status] = await db
    .select({ id: entityStatusesTable.id })
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.id, statusId), eq(entityStatusesTable.entityId, entityId)))
    .limit(1);
  return Boolean(status);
}

async function defaultStatusId(entityId: number): Promise<number | null> {
  const [status] = await db
    .select({ id: entityStatusesTable.id })
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.entityId, entityId), eq(entityStatusesTable.isDefault, true)))
    .limit(1);
  return status ? status.id : null;
}

router.get("/entities/:entityId/records", requireAuth, requireRecordParam("view"), async (req, res): Promise<void> => {
  const params = ListEntityRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { entityId } = params.data;
  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const fields = await loadActiveFields(entityId);
  const { hidden } = await fieldAccessContext(req, entityId, fields);
  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, entityId);

  let where: SQL = eq(entityRecordsTable.entityId, entityId);
  if (scope === "own") {
    where = and(where, ownScopeWhere(scopeFieldKeys, req.user!.userId))!;
  }

  const records = await db
    .select()
    .from(entityRecordsTable)
    .where(where)
    .orderBy(desc(entityRecordsTable.createdAt));
  res.json(records.map((r) => stripHidden(r, hidden)));
});

router.post("/entities/:entityId/records/query", requireAuth, requireRecordParam("view"), async (req, res): Promise<void> => {
  const params = QueryEntityRecordsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = QueryEntityRecordsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { entityId } = params.data;
  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const fields = await loadActiveFields(entityId);
  const { hidden } = await fieldAccessContext(req, entityId, fields);
  // Hidden fields must not be observable, including via filter/sort/search inference.
  // Restrict the query whitelist to visible fields so any reference to a hidden field
  // is rejected as an unknown field and search never touches hidden values.
  const visibleFields = fields.filter((f) => !hidden.has(f.fieldKey));
  const built = buildRecordQuery(visibleFields, body.data as RecordQuerySpec);
  if ("error" in built) {
    res.status(400).json({ error: built.error });
    return;
  }

  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, entityId);

  const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
  if (built.where) clauses.push(built.where);
  if (scope === "own") clauses.push(ownScopeWhere(scopeFieldKeys, req.user!.userId));
  const where = and(...clauses)!;

  const { page, pageSize } = body.data;
  const offset = (page - 1) * pageSize;

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entityRecordsTable)
    .where(where);

  const data = await db
    .select()
    .from(entityRecordsTable)
    .where(where)
    .orderBy(...built.orderBy)
    .limit(pageSize)
    .offset(offset);

  res.json({ data: data.map((r) => stripHidden(r, hidden)), total: countRow?.count ?? 0 });
});

router.post("/entities/:entityId/records", requireAuth, requireRecordParam("create"), async (req, res): Promise<void> => {
  const params = CreateEntityRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = CreateEntityRecordBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { entityId } = params.data;
  if (!(await entityExists(entityId))) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const fields = await loadActiveFields(entityId);
  const { editable, hidden } = await fieldAccessContext(req, entityId, fields);
  const activeKeys = new Set(fields.map((f) => f.fieldKey));
  const rawValues = body.data.valuesJson;
  for (const k of Object.keys(rawValues)) {
    if (!activeKeys.has(k)) {
      res.status(400).json({ error: `Unknown field: ${k}` });
      return;
    }
  }
  // Hard boundary: only fields the role may edit are accepted on create.
  const incoming: Record<string, unknown> = {};
  for (const f of fields) {
    if (editable.has(f.fieldKey) && f.fieldKey in rawValues) incoming[f.fieldKey] = rawValues[f.fieldKey];
  }
  const result = validateValues(fields, incoming);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  const userRefError = await validateUserRefs(fields, result.values);
  if (userRefError) {
    res.status(400).json({ error: userRefError });
    return;
  }

  let statusId: number | null;
  if (body.data.statusId === undefined) {
    statusId = await defaultStatusId(entityId);
  } else if (body.data.statusId === null) {
    statusId = null;
  } else {
    if (!(await statusBelongsToEntity(body.data.statusId, entityId))) {
      res.status(400).json({ error: "Status does not belong to this entity" });
      return;
    }
    statusId = body.data.statusId;
  }

  const [record] = await db
    .insert(entityRecordsTable)
    .values({ entityId, valuesJson: result.values, statusId })
    .returning();
  res.status(201).json(stripHidden(record, hidden));
});

router.get("/records/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .select()
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, params.data.id))
    .limit(1);
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!(await assertRecord(req, res, record.entityId, "view"))) return;

  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, record.entityId);
  const values = (record.valuesJson as Record<string, unknown>) ?? {};
  if (scope === "own" && !recordOwnedBy(values, scopeFieldKeys, req.user!.userId)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  const fields = await loadActiveFields(record.entityId);
  const { hidden } = await fieldAccessContext(req, record.entityId, fields);
  res.json(stripHidden(record, hidden));
});

router.put("/records/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateRecordBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!(await assertRecord(req, res, existing.entityId, "update"))) return;

  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, existing.entityId);
  const existingValues = (existing.valuesJson as Record<string, unknown>) ?? {};
  if (scope === "own" && !recordOwnedBy(existingValues, scopeFieldKeys, req.user!.userId)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  const hasValues = body.data.valuesJson !== undefined;
  const hasStatus = body.data.statusId !== undefined;
  if (!hasValues && !hasStatus) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const update: { valuesJson?: Record<string, unknown>; statusId?: number | null } = {};

  const fields = await loadActiveFields(existing.entityId);
  const { editable, hidden } = await fieldAccessContext(req, existing.entityId, fields);

  if (hasValues) {
    const activeKeys = new Set(fields.map((f) => f.fieldKey));
    const rawValues = body.data.valuesJson as Record<string, unknown>;
    for (const k of Object.keys(rawValues)) {
      if (!activeKeys.has(k)) {
        res.status(400).json({ error: `Unknown field: ${k}` });
        return;
      }
    }
    // Merge-on-write: only editable fields are taken from the request; all other
    // fields (view-only, hidden, or unchanged editable) keep their stored value.
    const candidate: Record<string, unknown> = {};
    for (const f of fields) {
      const key = f.fieldKey;
      if (editable.has(key)) {
        candidate[key] = key in rawValues ? rawValues[key] : existingValues[key];
      } else {
        candidate[key] = existingValues[key];
      }
    }
    const result = validateValues(fields, candidate);
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    const userRefError = await validateUserRefs(fields, result.values);
    if (userRefError) {
      res.status(400).json({ error: userRefError });
      return;
    }
    update.valuesJson = result.values;
  }

  if (hasStatus) {
    if (body.data.statusId === null) {
      update.statusId = null;
    } else {
      if (!(await statusBelongsToEntity(body.data.statusId as number, existing.entityId))) {
        res.status(400).json({ error: "Status does not belong to this entity" });
        return;
      }
      update.statusId = body.data.statusId as number;
    }
  }

  const [record] = await db
    .update(entityRecordsTable)
    .set(update)
    .where(eq(entityRecordsTable.id, params.data.id))
    .returning();
  res.json(stripHidden(record, hidden));
});

router.delete("/records/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db
    .select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!(await assertRecord(req, res, existing.entityId, "delete"))) return;

  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, existing.entityId);
  const values = (existing.valuesJson as Record<string, unknown>) ?? {};
  if (scope === "own" && !recordOwnedBy(values, scopeFieldKeys, req.user!.userId)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  await db.delete(entityRecordsTable).where(eq(entityRecordsTable.id, params.data.id));
  res.json({ success: true });
});

export default router;
