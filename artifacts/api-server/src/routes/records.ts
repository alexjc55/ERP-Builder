import { Router, type IRouter } from "express";
import { db, entityRecordsTable, entityFieldsTable, entityStatusesTable, entitiesTable, usersTable, entityTransitionsTable } from "@workspace/db";
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
  ArchiveRecordParams,
  UnarchiveRecordParams,
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

type ArchiveFilterValue = "active" | "archived" | "all";

/**
 * WHERE fragment for the archive display rule. Default ("active") hides archived
 * records from normal lists/views; "archived" shows only archived; "all" no filter.
 */
function archivedWhere(filter: ArchiveFilterValue): SQL | undefined {
  if (filter === "archived") return sql`${entityRecordsTable.archivedAt} IS NOT NULL`;
  if (filter === "all") return undefined;
  return sql`${entityRecordsTable.archivedAt} IS NULL`;
}

/**
 * Auto-archive (metadata-driven): any record sitting in an archive-trigger status
 * past that status's day threshold gets `archivedAt` stamped. Records are never
 * moved — only flagged — so "archive is not a separate table". Runs lazily before
 * reads so old data hides automatically without a background scheduler. Idempotent
 * (guarded on archivedAt IS NULL); no-op when the entity has no archive triggers.
 */
async function runAutoArchiveSweep(entityId: number): Promise<void> {
  const triggers = await db
    .select({ id: entityStatusesTable.id, days: entityStatusesTable.archiveAfterDays })
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.entityId, entityId), eq(entityStatusesTable.isArchiveTrigger, true)));
  if (triggers.length === 0) return;
  for (const t of triggers) {
    const days = Math.max(0, t.days ?? 0);
    await db
      .update(entityRecordsTable)
      .set({ archivedAt: sql`now()` })
      .where(
        and(
          eq(entityRecordsTable.entityId, entityId),
          eq(entityRecordsTable.statusId, t.id),
          sql`${entityRecordsTable.archivedAt} IS NULL`,
          eq(entityRecordsTable.archiveExempt, false),
          sql`COALESCE(${entityRecordsTable.statusChangedAt}, ${entityRecordsTable.createdAt}) + (${days} * interval '1 day') <= now()`,
        ),
      );
  }
}

/** Returns the archive-trigger config of a status, or null if not found. */
async function statusArchiveInfo(
  statusId: number,
): Promise<{ isArchiveTrigger: boolean; archiveAfterDays: number } | null> {
  const [s] = await db
    .select({ isArchiveTrigger: entityStatusesTable.isArchiveTrigger, archiveAfterDays: entityStatusesTable.archiveAfterDays })
    .from(entityStatusesTable)
    .where(eq(entityStatusesTable.id, statusId))
    .limit(1);
  return s ?? null;
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

  // Apply auto-archival, then hide archived rows from this normal list (display rule).
  await runAutoArchiveSweep(entityId);
  let where: SQL = and(eq(entityRecordsTable.entityId, entityId), archivedWhere("active")!)!;
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

  await runAutoArchiveSweep(entityId);
  const archived = (body.data.archived ?? "active") as ArchiveFilterValue;

  const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
  if (built.where) clauses.push(built.where);
  const archWhere = archivedWhere(archived);
  if (archWhere) clauses.push(archWhere);
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

  // Stamp when the record entered its status so the N-day auto-archive rule has a baseline.
  const [record] = await db
    .insert(entityRecordsTable)
    .values({ entityId, valuesJson: result.values, statusId, statusChangedAt: new Date() })
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

  const update: {
    valuesJson?: Record<string, unknown>;
    statusId?: number | null;
    statusChangedAt?: Date;
    archivedAt?: Date;
    archiveExempt?: boolean;
  } = {};

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

  // Workflow enforcement: when an entity defines transitions, status changes on
  // its records are restricted to the defined transitions (the server is the
  // hard boundary; the client only mirrors this cosmetically). superAdmin
  // bypasses the workflow entirely, consistent with RBAC. A record whose current
  // status is null is not workflow-governed (no transition can originate from a
  // null status), so it changes freely; entities with NO transitions are also
  // free (backward compatible).
  // When a workflow transition is enforced, the final UPDATE is guarded on the
  // record's status still being the one we validated against (compare-and-set),
  // so concurrent status-changing writes cannot bypass the transition graph.
  let guardFromStatusId: number | null = null;
  const statusChanging = hasStatus && (update.statusId ?? null) !== (existing.statusId ?? null);
  if (statusChanging && existing.statusId != null && !perms.superAdmin) {
    const transitions = await db
      .select()
      .from(entityTransitionsTable)
      .where(eq(entityTransitionsTable.entityId, existing.entityId));
    if (transitions.length > 0) {
      guardFromStatusId = existing.statusId;
      const match = transitions.find(
        (t) => t.fromStatusId === existing.statusId && t.toStatusId === update.statusId,
      );
      if (!match) {
        res.status(422).json({ error: "This status change is not an allowed transition" });
        return;
      }
      const allowedRoleIds = (match.allowedRoleIds as number[]) ?? [];
      if (allowedRoleIds.length > 0 && !allowedRoleIds.includes(req.user!.roleId)) {
        res.status(403).json({ error: "Your role is not allowed to perform this transition" });
        return;
      }
      const actions = (match.actionsJson as { type: string; fieldKey: string; value?: unknown }[]) ?? [];
      const requiredKeys = (match.requiredFieldKeys as string[]) ?? [];
      if (actions.length > 0 || requiredKeys.length > 0) {
        const base: Record<string, unknown> =
          update.valuesJson !== undefined ? { ...update.valuesJson } : { ...existingValues };
        for (const a of actions) {
          if (a.type === "set_field") base[a.fieldKey] = a.value;
        }
        if (actions.length > 0) {
          const result = validateValues(fields, base);
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
        const finalValues = update.valuesJson ?? base;
        const missing = requiredKeys.filter((k) => isEmpty(finalValues[k]));
        if (missing.length > 0) {
          res.status(422).json({ error: `Fields required for this transition: ${missing.join(", ")}` });
          return;
        }
      }
    }
  }

  // When the status actually changes, reset the auto-archive baseline and clear any
  // manual-unarchive exemption (a new status dwell re-enables auto-archival). If the
  // new status is an archive-trigger with zero delay, archive immediately; otherwise
  // the lazy sweep on reads will pick it up once the N-day threshold passes.
  if (statusChanging) {
    update.statusChangedAt = new Date();
    update.archiveExempt = false;
    if (update.statusId != null) {
      const info = await statusArchiveInfo(update.statusId);
      if (info?.isArchiveTrigger && (info.archiveAfterDays ?? 0) === 0) {
        update.archivedAt = new Date();
      }
    }
  }

  const whereClause =
    guardFromStatusId != null
      ? and(
          eq(entityRecordsTable.id, params.data.id),
          eq(entityRecordsTable.statusId, guardFromStatusId),
        )
      : eq(entityRecordsTable.id, params.data.id);
  const [record] = await db
    .update(entityRecordsTable)
    .set(update)
    .where(whereClause)
    .returning();
  if (!record) {
    res.status(409).json({ error: "Record status changed concurrently; please retry" });
    return;
  }
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

/**
 * Manual archive/unarchive. Gated exactly like a record update (record `update`
 * permission + row-level ownership scope), since archiving is a state change on
 * the row. Unarchive is always explicit — changing status never auto-unarchives.
 */
async function setArchived(
  req: import("express").Request,
  res: import("express").Response,
  recordId: number,
  archived: boolean,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, recordId))
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

  // Unarchive sets the exemption so the auto-archive sweep won't immediately
  // re-archive a record still sitting in a (delay=0) archive-trigger status; the
  // exemption is cleared on the next status change. Archiving clears it (an
  // explicit archive needs no exemption). Guard: only an actual archived→active
  // transition grants the exemption — unarchiving an already-active record is a
  // no-op for exemption, so the endpoint can't be used to opt records out of
  // auto-archival.
  const wasArchived = existing.archivedAt != null;
  const set: { archivedAt: Date | null; archiveExempt?: boolean } = {
    archivedAt: archived ? new Date() : null,
  };
  if (archived) {
    set.archiveExempt = false;
  } else if (wasArchived) {
    set.archiveExempt = true;
  }
  const [record] = await db
    .update(entityRecordsTable)
    .set(set)
    .where(eq(entityRecordsTable.id, recordId))
    .returning();

  const fields = await loadActiveFields(existing.entityId);
  const { hidden } = await fieldAccessContext(req, existing.entityId, fields);
  res.json(stripHidden(record, hidden));
}

router.post("/records/:id/archive", requireAuth, async (req, res): Promise<void> => {
  const params = ArchiveRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await setArchived(req, res, params.data.id, true);
});

router.post("/records/:id/unarchive", requireAuth, async (req, res): Promise<void> => {
  const params = UnarchiveRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await setArchived(req, res, params.data.id, false);
});

export default router;
