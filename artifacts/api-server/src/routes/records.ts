import { Router, type IRouter } from "express";
import { db, entityRecordsTable, entityFieldsTable, entityStatusesTable, entitiesTable, usersTable, entityTransitionsTable, deletedFilesTable } from "@workspace/db";
import { eq, asc, desc, and, or, sql, inArray, type SQL } from "drizzle-orm";
import { evaluateFormula, normalizeDecimals } from "@workspace/formula";
import type { Request } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  requireRecordParam,
  assertRecord,
  getPermissions,
  getUserRoleIds,
  effectiveScope,
  effectiveStatusVisibility,
  effectiveRecordPerm,
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
  DeleteRecordBody,
  QueryEntityRecordsParams,
  QueryEntityRecordsBody,
  GetEntityFilterValuesParams,
  GetEntityFilterValuesBody,
  GetFieldDependentValuesParams,
  GetFieldDependentValuesBody,
  RenameFieldValueParams,
  RenameFieldValueBody,
  ArchiveRecordParams,
  UnarchiveRecordParams,
} from "@workspace/api-zod";
import type { EntityField, InsertAuditLog, FileSource, FileFieldConfig } from "@workspace/db";
import { buildRecordQuery, type RecordQuerySpec } from "./record-query";
import { isGoogleDriveModuleEnabled } from "../lib/googleDrive";
import {
  writeAudit,
  auditStr,
  diffValues,
  AUDIT_STATUS,
  AUDIT_ARCHIVED,
  AUDIT_CREATED,
  AUDIT_DELETED,
} from "./audit-log";
import {
  emitEvent,
  EVENT_RECORD_CREATED,
  EVENT_RECORD_UPDATED,
  EVENT_RECORD_DELETED,
  EVENT_STATUS_CHANGED,
} from "../lib/events";

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
/**
 * Resolve the file sources a field accepts. Empty/unset config means the legacy
 * default: server upload only. This is the hard server boundary for which kinds
 * of file value may be stored, regardless of what the client offers.
 */
function allowedFileSources(field: EntityField): FileSource[] {
  const cfg = field.fileConfigJson as FileFieldConfig | null | undefined;
  const list = cfg?.allowedSources;
  return Array.isArray(list) && list.length > 0 ? list : ["server"];
}

/**
 * Validate & normalize a single `file` field value. Returns the cleaned object
 * on success or an error message string on failure. Handles the polymorphic
 * server/gdrive/link union and treats legacy (kind-less, path-bearing) values
 * as server. The value's source must be within the field's allowedSources.
 */
function validateFileValue(field: EntityField, raw: unknown, gdriveModuleEnabled: boolean, prevValue?: unknown): Record<string, unknown> | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return `Field "${field.fieldKey}" must be a file`;
  }
  const obj = raw as Record<string, unknown>;
  const rawKind = obj.kind;
  // Legacy values have no `kind` but carry a server path → treat as server.
  const kind: FileSource =
    rawKind === "gdrive" || rawKind === "link" || rawKind === "server"
      ? rawKind
      : "server";

  const allowed = allowedFileSources(field);
  if (!allowed.includes(kind)) {
    return `Field "${field.fieldKey}" does not allow this file source`;
  }

  if (kind === "server") {
    const path = obj.path;
    const name = obj.name;
    if (typeof path !== "string" || !path.startsWith("/objects/")) {
      return `Field "${field.fieldKey}" has an invalid file path`;
    }
    if (typeof name !== "string" || name.trim() === "") {
      return `Field "${field.fieldKey}" file must have a name`;
    }
    const out: Record<string, unknown> = { kind: "server", path, name: name.trim() };
    if (typeof obj.contentType === "string" && obj.contentType.length > 0) out.contentType = obj.contentType;
    if (typeof obj.size === "number" && Number.isFinite(obj.size)) out.size = obj.size;
    return out;
  }

  if (kind === "gdrive") {
    const fileId = obj.fileId;
    const name = obj.name;
    if (typeof fileId !== "string" || fileId.trim() === "") {
      return `Field "${field.fieldKey}" has an invalid Google Drive file id`;
    }
    if (typeof name !== "string" || name.trim() === "") {
      return `Field "${field.fieldKey}" file must have a name`;
    }
    // Hard boundary: when the Google Drive module is off, no *new* gdrive value
    // may be written. An unchanged previously-stored gdrive value (same fileId)
    // is allowed through so existing values stay usable and unrelated edits to
    // the same record still succeed.
    if (!gdriveModuleEnabled) {
      const prev =
        prevValue && typeof prevValue === "object" && !Array.isArray(prevValue)
          ? (prevValue as Record<string, unknown>)
          : null;
      const unchanged = prev?.kind === "gdrive" && prev.fileId === fileId.trim();
      if (!unchanged) {
        return `Field "${field.fieldKey}" does not allow this file source`;
      }
    }
    const out: Record<string, unknown> = { kind: "gdrive", fileId: fileId.trim(), name: name.trim() };
    if (typeof obj.contentType === "string" && obj.contentType.length > 0) out.contentType = obj.contentType;
    if (typeof obj.size === "number" && Number.isFinite(obj.size)) out.size = obj.size;
    if (typeof obj.webViewLink === "string" && obj.webViewLink.length > 0) out.webViewLink = obj.webViewLink;
    return out;
  }

  // kind === "link"
  const url = obj.url;
  if (typeof url !== "string") {
    return `Field "${field.fieldKey}" must be a valid URL`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Field "${field.fieldKey}" must be a valid URL`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Field "${field.fieldKey}" link must be an http or https URL`;
  }
  const out: Record<string, unknown> = { kind: "link", url };
  if (typeof obj.name === "string" && obj.name.trim() !== "") out.name = obj.name.trim();
  return out;
}

function validateValues(fields: EntityField[], values: Record<string, unknown>, gdriveModuleEnabled: boolean, prevValues: Record<string, unknown> = {}): { values: Record<string, unknown> } | { error: string } {
  const fieldByKey = new Map(fields.map((f) => [f.fieldKey, f]));

  // Reject unknown keys (metadata-driven integrity: no junk columns).
  for (const key of Object.keys(values)) {
    if (!fieldByKey.has(key)) {
      return { error: `Unknown field: ${key}` };
    }
  }

  const cleaned: Record<string, unknown> = {};

  for (const field of fields) {
    // Function/formula fields are computed at read time and never stored.
    if (field.fieldType === "function") continue;
    const raw = values[field.fieldKey];

    if (isEmpty(raw)) {
      if (field.isRequired) {
        return { error: `Поле «${fieldRuName(field)}» обязательно для заполнения` };
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
      case "file": {
        // A file value is a polymorphic object discriminated by `kind`:
        //   server: { kind:"server", path:"/objects/…", name, contentType?, size? }
        //   gdrive: { kind:"gdrive", fileId, name, contentType?, size?, webViewLink? }
        //   link:   { kind:"link", url:"http(s)://…", name? }
        // Legacy values have no `kind` but a server `path` and are treated as
        // server. The chosen source must be permitted by the field config
        // (allowedSources); empty/unset config means server-only (legacy).
        const cleanedFile = validateFileValue(field, raw, gdriveModuleEnabled, prevValues[field.fieldKey]);
        if (typeof cleanedFile === "string") {
          return { error: cleanedFile };
        }
        cleaned[field.fieldKey] = cleanedFile;
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
  pageId?: number,
): Promise<{ hidden: Set<string>; editable: Set<string> }> {
  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  // Resolve the effective record perm once (honoring a mirror-page override) so
  // write-derived field access matches the action gate for this page context.
  const rp = await effectiveRecordPerm(req, perms, entityId, pageId);
  const hidden = new Set<string>();
  const editable = new Set<string>();
  for (const f of fields) {
    const access = resolveFieldAccess(f, perms, roleIds, entityId, rp);
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

/** Russian label for a field, falling back to its key (server-side getML-lite). */
function fieldRuName(field: EntityField): string {
  const name = field.nameJson as { ru?: string; en?: string; he?: string } | null;
  return name?.ru || name?.en || name?.he || field.fieldKey;
}

/**
 * Walk a dependent field's parent chain and return its ancestor field keys
 * (closest parent first). Cycle-guarded. Used to scope a dependent field's
 * option list / rename / dedupe to the matching parent values.
 */
function dependencyAncestorKeys(field: EntityField, fields: EntityField[]): string[] {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f] as const));
  const out: string[] = [];
  const seen = new Set<string>([field.fieldKey]);
  let cur = field.dependencyConfigJson?.dependsOnFieldKey;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = byKey.get(cur)?.dependencyConfigJson?.dependsOnFieldKey;
  }
  return out;
}

/**
 * Dedupe guard for dependent fields, run on create/update before persisting.
 * For each dependent field with a non-empty value V (scoped to the row's
 * parent-chain values): the parent must be set; an exact existing value is
 * reused (OK); a value that only matches case-insensitively is rejected (the
 * user must pick the existing one or use rename); a genuinely new value is OK.
 * Checks across ALL records in scope (not row-scoped) so values stay unique per
 * parent. `excludeRecordId` skips the record being updated so it never collides
 * with its own stored value.
 */
async function checkDependentValues(
  entityId: number,
  fields: EntityField[],
  values: Record<string, unknown>,
  excludeRecordId?: number,
): Promise<string | null> {
  const norm = (s: string) => s.trim().toLowerCase();
  for (const f of fields) {
    const parentKey = f.dependencyConfigJson?.dependsOnFieldKey;
    if (!parentKey) continue;
    const raw = values[f.fieldKey];
    if (isEmpty(raw)) continue;
    const v = typeof raw === "string" ? raw.trim() : String(raw);
    if (isEmpty(values[parentKey])) {
      return `Поле "${fieldRuName(f)}" нельзя заполнить, пока не выбрано родительское поле`;
    }
    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
    for (const key of dependencyAncestorKeys(f, fields)) {
      const av = values[key];
      if (isEmpty(av)) continue;
      const avStr = typeof av === "string" ? av.trim() : String(av);
      clauses.push(sql`(${entityRecordsTable.valuesJson} ->> ${key}) = ${avStr}`);
    }
    if (excludeRecordId != null) clauses.push(sql`${entityRecordsTable.id} <> ${excludeRecordId}`);
    const valueExpr = sql<string | null>`(${entityRecordsTable.valuesJson} ->> ${f.fieldKey})`;
    clauses.push(sql`${valueExpr} IS NOT NULL AND ${valueExpr} <> ''`);
    const rows = await db
      .selectDistinct({ v: valueExpr })
      .from(entityRecordsTable)
      .where(and(...clauses)!);
    const existing = rows.map((r) => r.v).filter((x): x is string => x != null);
    if (existing.some((e) => e === v)) continue; // exact match → reuse
    if (existing.some((e) => norm(e) === norm(v))) {
      return `Значение "${v}" уже существует в другом написании. Используйте существующее значение.`;
    }
  }
  return null;
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
 * WHERE fragment excluding rows whose status is hidden-for-rows for this role.
 * Null-status rows are always kept (a status visibility rule cannot target the
 * absence of a status). Returns undefined when nothing is hidden (no-op).
 */
function hiddenRowStatusWhere(hiddenRowStatusIds: number[]): SQL | undefined {
  if (hiddenRowStatusIds.length === 0) return undefined;
  return sql`(${entityRecordsTable.statusId} IS NULL OR ${entityRecordsTable.statusId} NOT IN (${sql.join(
    hiddenRowStatusIds.map((id) => sql`${id}`),
    sql`, `,
  )}))`;
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
  const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);

  // Apply auto-archival, then hide archived rows from this normal list (display rule).
  // Guests are strictly read-only: never let a guest read trigger the archival write
  // sweep. Non-guest reads still keep archival up to date.
  if (!req.user?.guest) await runAutoArchiveSweep(entityId);
  let where: SQL = and(eq(entityRecordsTable.entityId, entityId), archivedWhere("active")!)!;
  if (scope === "own") {
    where = and(where, ownScopeWhere(scopeFieldKeys, req.user!.userId))!;
  }
  const listHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
  if (listHiddenRowWhere) where = and(where, listHiddenRowWhere)!;

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
  const { hidden } = await fieldAccessContext(req, entityId, fields, body.data.pageId);
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
  const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);

  // Guests are strictly read-only: skip the archival write sweep for guest sessions.
  if (!req.user?.guest) await runAutoArchiveSweep(entityId);
  const archived = (body.data.archived ?? "active") as ArchiveFilterValue;

  const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
  if (built.where) clauses.push(built.where);
  const archWhere = archivedWhere(archived);
  if (archWhere) clauses.push(archWhere);
  if (scope === "own") clauses.push(ownScopeWhere(scopeFieldKeys, req.user!.userId));
  // Hard boundary: rows in a status hidden-for-rows for this role are never
  // returned, so the role cannot surface them via any filter/status pick either.
  const queryHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
  if (queryHiddenRowWhere) clauses.push(queryHiddenRowWhere);
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

  // Column totals: sum each visible numeric field flagged showColumnTotal over the
  // FULL filtered set (every page), not just the current page. Non-numeric stored
  // text is skipped so an unguarded ::numeric cast can never error.
  const NUMERIC_RE = "^-?[0-9]+(\\.[0-9]+)?$";
  const totalFields = visibleFields.filter((f) => f.fieldType === "number" && f.showColumnTotal);
  // Function (formula) fields can also opt into a column total. Their value is not
  // stored, so we evaluate the formula per row over the FULL filtered set and sum
  // the finite numeric results (non-numeric/error rows contribute nothing).
  const formulaTotalFields = visibleFields.filter(
    (f) => f.fieldType === "function" && f.showColumnTotal,
  );
  let numericTotals: Record<string, number> | undefined;
  if (totalFields.length > 0) {
    const sel: Record<string, SQL<number>> = {};
    for (const f of totalFields) {
      const k = f.fieldKey;
      sel[k] = sql<number>`COALESCE(SUM(CASE WHEN (${entityRecordsTable.valuesJson} ->> ${k}) ~ ${NUMERIC_RE} THEN (${entityRecordsTable.valuesJson} ->> ${k})::numeric ELSE 0 END), 0)::float8`;
    }
    const [row] = await db.select(sel).from(entityRecordsTable).where(where);
    numericTotals = {};
    for (const f of totalFields) {
      numericTotals[f.fieldKey] = Number((row as Record<string, unknown> | undefined)?.[f.fieldKey] ?? 0);
    }
  }
  if (formulaTotalFields.length > 0) {
    const allRows = await db
      .select({ values: entityRecordsTable.valuesJson })
      .from(entityRecordsTable)
      .where(where);
    numericTotals = numericTotals ?? {};
    for (const f of formulaTotalFields) {
      const cfg = f.formulaConfigJson as { expression?: string; decimals?: number | null } | null;
      const expr = (cfg?.expression ?? "").trim();
      if (!expr) continue;
      let sum = 0;
      for (const r of allRows) {
        // Strip hidden field keys before evaluating so the aggregate can never
        // leak (even indirectly) values the caller is not allowed to see, and so
        // the total stays consistent with the per-row results the client computes
        // over the already hidden-stripped records.
        const vals = stripHidden({ valuesJson: r.values ?? {} }, hidden).valuesJson as Record<
          string,
          unknown
        >;
        try {
          const out = evaluateFormula(expr, vals);
          if (typeof out === "number" && Number.isFinite(out)) sum += out;
        } catch {
          // Skip rows whose formula fails to parse/evaluate.
        }
      }
      const d = normalizeDecimals(cfg?.decimals);
      numericTotals[f.fieldKey] = d != null ? Number(sum.toFixed(d)) : sum;
    }
  }

  res.json({
    data: data.map((r) => stripHidden(r, hidden)),
    total: countRow?.count ?? 0,
    ...(numericTotals ? { numericTotals } : {}),
  });
});

router.post(
  "/entities/:entityId/records/filter-values",
  requireAuth,
  requireRecordParam("view"),
  async (req, res): Promise<void> => {
    const params = GetEntityFilterValuesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = GetEntityFilterValuesBody.safeParse(req.body);
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
    const visibleFields = fields.filter((f) => !hidden.has(f.fieldKey));

    const target = visibleFields.find((f) => f.fieldKey === body.data.field);
    // Only fields opted-in to filtering and visible to this role can have their values listed.
    if (!target || !target.isFilterable) {
      res.status(400).json({ error: `Field is not filterable: ${body.data.field}` });
      return;
    }

    // Dependent filters: options come from records matching the OTHER active filters.
    // Strip any filter on the target field itself so its own picks don't narrow its option list.
    const spec: RecordQuerySpec = {
      filters: (body.data.filters ?? []).filter((c) => c.field !== body.data.field),
      filterConjunction: body.data.filterConjunction ?? "and",
      statusIds: body.data.statusIds ?? undefined,
      search: body.data.search ?? undefined,
    };
    const built = buildRecordQuery(visibleFields, spec);
    if ("error" in built) {
      res.status(400).json({ error: built.error });
      return;
    }

    const perms = await getPermissions(req);
    const { scope, scopeFieldKeys } = effectiveScope(perms, entityId);
    const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);
    const archived = (body.data.archived ?? "active") as ArchiveFilterValue;

    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
    if (built.where) clauses.push(built.where);
    const archWhere = archivedWhere(archived);
    if (archWhere) clauses.push(archWhere);
    if (scope === "own") clauses.push(ownScopeWhere(scopeFieldKeys, req.user!.userId));
    // Same hard boundary as the records query: dependent-filter options must not
    // leak values that only exist on rows hidden-for-rows for this role.
    const fvHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
    if (fvHiddenRowWhere) clauses.push(fvHiddenRowWhere);
    const valueExpr = sql<string | null>`(${entityRecordsTable.valuesJson} ->> ${body.data.field})`;
    clauses.push(sql`${valueExpr} IS NOT NULL AND ${valueExpr} <> ''`);
    const where = and(...clauses)!;

    // ORDER BY ordinal (1) — for SELECT DISTINCT the order-by expression must match the
    // selected column; re-emitting valueExpr would bind a fresh param and Postgres would
    // reject it as not in the select list.
    const rows = await db
      .selectDistinct({ v: valueExpr })
      .from(entityRecordsTable)
      .where(where)
      .orderBy(sql`1`)
      .limit(500);

    const values = rows.map((r) => r.v).filter((v): v is string => v != null && v !== "");
    res.json({ values });
  },
);

// Distinct existing values of a dependent ("cascading") field, scoped to the
// supplied parent-chain values. Mirrors filter-values' access boundary (view
// perm + field-hidden + own-row + hidden-row-status). Returns an empty list
// unless the field's immediate parent has a value (no parent → no choices).
router.post(
  "/entities/:entityId/fields/:fieldId/dependent-values",
  requireAuth,
  requireRecordParam("view"),
  async (req, res): Promise<void> => {
    const params = GetFieldDependentValuesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = GetFieldDependentValuesBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const { entityId, fieldId } = params.data;
    if (!(await entityExists(entityId))) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }

    const fields = await loadActiveFields(entityId);
    const { hidden } = await fieldAccessContext(req, entityId, fields, body.data.pageId ?? undefined);
    const visibleFields = fields.filter((f) => !hidden.has(f.fieldKey));

    const target = visibleFields.find((f) => f.id === fieldId);
    const immediateParent = target?.dependencyConfigJson?.dependsOnFieldKey;
    if (!target || !immediateParent) {
      res.status(400).json({ error: "Field is not a dependent field" });
      return;
    }

    // Only ancestor keys that are visible to this role may scope the option list.
    const allowedParents = new Set(dependencyAncestorKeys(target, fields));
    const parentVals = (body.data.parentValues ?? []).filter(
      (p) =>
        allowedParents.has(p.field) &&
        visibleFields.some((f) => f.fieldKey === p.field) &&
        p.value !== "",
    );
    // No options without the immediate parent set (and don't leak the global list).
    if (!parentVals.some((p) => p.field === immediateParent)) {
      res.json({ values: [] });
      return;
    }

    const spec: RecordQuerySpec = {
      filters: parentVals.map((p) => ({ field: p.field, operator: "eq" as const, value: p.value })),
      filterConjunction: "and",
    };
    const built = buildRecordQuery(visibleFields, spec);
    if ("error" in built) {
      res.status(400).json({ error: built.error });
      return;
    }

    const perms = await getPermissions(req);
    const { scope, scopeFieldKeys } = effectiveScope(perms, entityId);
    const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);

    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
    if (built.where) clauses.push(built.where);
    const archWhere = archivedWhere("active");
    if (archWhere) clauses.push(archWhere);
    if (scope === "own") clauses.push(ownScopeWhere(scopeFieldKeys, req.user!.userId));
    const depHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
    if (depHiddenRowWhere) clauses.push(depHiddenRowWhere);
    const valueExpr = sql<string | null>`(${entityRecordsTable.valuesJson} ->> ${target.fieldKey})`;
    clauses.push(sql`${valueExpr} IS NOT NULL AND ${valueExpr} <> ''`);
    const where = and(...clauses)!;

    // ORDER BY ordinal (1) — same SELECT DISTINCT constraint as filter-values.
    const rows = await db
      .selectDistinct({ v: valueExpr })
      .from(entityRecordsTable)
      .where(where)
      .orderBy(sql`1`)
      .limit(500);

    const values = rows.map((r) => r.v).filter((v): v is string => v != null && v !== "");
    res.json({ values });
  },
);

// Rename (merge) a dependent field's value across all records matching the
// supplied parent scope. Requires update perm + edit access on the field; row
// scope ("own") is honored so a restricted user only renames their own rows.
// Best-effort per-row audit; merge confirmation is handled client-side.
router.post(
  "/entities/:entityId/fields/:fieldId/rename-value",
  requireAuth,
  requireRecordParam("update"),
  async (req, res): Promise<void> => {
    const params = RenameFieldValueParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = RenameFieldValueBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const { entityId, fieldId } = params.data;
    if (!(await entityExists(entityId))) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    const oldValue = body.data.oldValue;
    const newValue = body.data.newValue.trim();
    if (newValue === "") {
      res.status(400).json({ error: "Новое значение не может быть пустым" });
      return;
    }

    const fields = await loadActiveFields(entityId);
    const { hidden, editable } = await fieldAccessContext(
      req,
      entityId,
      fields,
      body.data.pageId ?? undefined,
    );
    const target = fields.find((f) => f.id === fieldId);
    if (!target || hidden.has(target.fieldKey)) {
      res.status(404).json({ error: "Field not found" });
      return;
    }
    if (!target.dependencyConfigJson?.dependsOnFieldKey) {
      res.status(400).json({ error: "Field is not a dependent field" });
      return;
    }
    if (!editable.has(target.fieldKey)) {
      res.status(403).json({ error: "Нет прав на изменение этого поля" });
      return;
    }

    const visibleFields = fields.filter((f) => !hidden.has(f.fieldKey));
    const allowedParents = new Set(dependencyAncestorKeys(target, fields));
    const parentVals = (body.data.parentValues ?? []).filter(
      (p) =>
        allowedParents.has(p.field) &&
        visibleFields.some((f) => f.fieldKey === p.field) &&
        p.value !== "",
    );
    const immediateParent = target.dependencyConfigJson.dependsOnFieldKey;
    if (!parentVals.some((p) => p.field === immediateParent)) {
      res.status(400).json({ error: "Не выбрано родительское значение" });
      return;
    }
    const built = buildRecordQuery(visibleFields, {
      filters: parentVals.map((p) => ({ field: p.field, operator: "eq" as const, value: p.value })),
      filterConjunction: "and",
    });
    if ("error" in built) {
      res.status(400).json({ error: built.error });
      return;
    }

    const perms = await getPermissions(req);
    const { scope, scopeFieldKeys } = effectiveScope(perms, entityId);
    const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);

    // Only rename within the rows this role can actually see — mirror the
    // dependent-values read boundary (active rows, no hidden-status rows, own
    // scope) so a direct API call cannot silently rewrite archived/hidden rows.
    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
    if (built.where) clauses.push(built.where);
    const renameArchWhere = archivedWhere("active");
    if (renameArchWhere) clauses.push(renameArchWhere);
    if (scope === "own") clauses.push(ownScopeWhere(scopeFieldKeys, req.user!.userId));
    const renameHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
    if (renameHiddenRowWhere) clauses.push(renameHiddenRowWhere);
    const valueExpr = sql<string | null>`(${entityRecordsTable.valuesJson} ->> ${target.fieldKey})`;
    clauses.push(sql`${valueExpr} = ${oldValue}`);
    const where = and(...clauses)!;

    const matches = await db
      .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
      .from(entityRecordsTable)
      .where(where);
    if (matches.length === 0) {
      res.json({ updated: 0 });
      return;
    }

    await db.transaction(async (tx) => {
      for (const m of matches) {
        const next = { ...((m.valuesJson as Record<string, unknown>) ?? {}), [target.fieldKey]: newValue };
        await tx
          .update(entityRecordsTable)
          .set({ valuesJson: next })
          .where(eq(entityRecordsTable.id, m.id));
      }
    });

    const userId = req.user!.userId;
    await writeAudit(
      matches.map((m) => ({
        entityId,
        recordId: m.id,
        userId,
        fieldKey: target.fieldKey,
        oldValue: auditStr(oldValue),
        newValue: auditStr(newValue),
      })),
      req.log,
    );

    res.json({ updated: matches.length });
  },
);

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
  const { editable, hidden } = await fieldAccessContext(req, entityId, fields, body.data.pageId);
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
  const gdriveModuleEnabled = await isGoogleDriveModuleEnabled();
  const result = validateValues(fields, incoming, gdriveModuleEnabled);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  const userRefError = await validateUserRefs(fields, result.values);
  if (userRefError) {
    res.status(400).json({ error: userRefError });
    return;
  }
  const depError = await checkDependentValues(entityId, fields, result.values);
  if (depError) {
    res.status(400).json({ error: depError });
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
    // Hard boundary: the role may not explicitly assign a status hidden from its
    // picker. (A hidden DEFAULT is still allowed — that's a system assignment, not
    // a user choice — so creation never breaks.)
    const createPerms = await getPermissions(req);
    const { hiddenStatusIds } = effectiveStatusVisibility(createPerms, entityId);
    if (hiddenStatusIds.includes(body.data.statusId)) {
      res.status(403).json({ error: "This status is not available to your role" });
      return;
    }
    statusId = body.data.statusId;
  }

  // Stamp when the record entered its status so the N-day auto-archive rule has a baseline.
  const [record] = await db
    .insert(entityRecordsTable)
    .values({ entityId, valuesJson: result.values, statusId, statusChangedAt: new Date() })
    .returning();

  // Audit: record the initial value of every set field (old = null) plus the
  // initial status; if nothing was set, leave a creation marker so the row's
  // existence is always traceable.
  const userId = req.user!.userId;
  const createEntries: InsertAuditLog[] = [];
  for (const f of fields) {
    const v = auditStr(result.values[f.fieldKey]);
    if (v !== null) createEntries.push({ entityId, recordId: record.id, fieldKey: f.fieldKey, oldValue: null, newValue: v, userId });
  }
  if (statusId != null) {
    createEntries.push({ entityId, recordId: record.id, fieldKey: AUDIT_STATUS, oldValue: null, newValue: String(statusId), userId });
  }
  if (createEntries.length === 0) {
    createEntries.push({ entityId, recordId: record.id, fieldKey: AUDIT_CREATED, oldValue: null, newValue: null, userId });
  }
  await writeAudit(createEntries, req.log);

  await emitEvent(
    {
      eventName: EVENT_RECORD_CREATED,
      entityId,
      recordId: record.id,
      payload: { actorUserId: userId, statusId: record.statusId },
    },
    req.log,
  );

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
  // Hard boundary: rows sitting in a row-hidden status must not be reachable by
  // ID either (NULL status is always visible). Mirror the list/query exclusion.
  const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, record.entityId);
  if (record.statusId != null && hiddenRowStatusIds.includes(record.statusId)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  const fields = await loadActiveFields(record.entityId);
  const { hidden } = await fieldAccessContext(req, record.entityId, fields);
  res.json(stripHidden(record, hidden));
});

type TrashReason = "record_deleted" | "field_cleared" | "field_replaced";

/**
 * Recognize a LOCAL (object-storage) file value. Server files are the only kind
 * we ever physically delete; Google Drive (`fileId`) and link (`url`) values are
 * deliberately ignored. Legacy values without a `kind` but with an `/objects/`
 * path are treated as server files.
 */
function asServerFile(
  v: unknown,
): { path: string; name: string; size: number | null; contentType: string | null } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const isServer = o.kind === "server" || (o.kind == null && o.url == null && o.fileId == null);
  if (!isServer) return null;
  const path = o.path;
  if (typeof path !== "string" || !path.startsWith("/objects/")) return null;
  const name =
    typeof o.name === "string" && o.name.trim() ? o.name.trim() : path.split("/").pop() || "file";
  return {
    path,
    name,
    size: typeof o.size === "number" && Number.isFinite(o.size) ? o.size : null,
    contentType: typeof o.contentType === "string" && o.contentType ? o.contentType : null,
  };
}

/**
 * Move LOCAL files that were removed from a record into the file trash (recycle
 * bin). The physical objects are kept until the trash is purged, so an accidental
 * delete is recoverable. `newValues === null` means the whole record was deleted.
 * Best-effort: a failure here never blocks the record op. Drive/link values are
 * left untouched.
 */
async function trashRemovedServerFiles(
  req: Request,
  entityId: number,
  recordId: number,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown> | null,
): Promise<void> {
  const toTrash: {
    fieldKey: string;
    file: NonNullable<ReturnType<typeof asServerFile>>;
    reason: TrashReason;
  }[] = [];
  for (const [key, oldVal] of Object.entries(oldValues)) {
    const oldFile = asServerFile(oldVal);
    if (!oldFile) continue;
    if (newValues === null) {
      toTrash.push({ fieldKey: key, file: oldFile, reason: "record_deleted" });
      continue;
    }
    const newRaw = newValues[key];
    const newFile = asServerFile(newRaw);
    if (newFile && newFile.path === oldFile.path) continue; // unchanged
    const hasNew = newRaw != null && newRaw !== "";
    toTrash.push({ fieldKey: key, file: oldFile, reason: hasNew ? "field_replaced" : "field_cleared" });
  }
  if (toTrash.length === 0) return;

  try {
    const [entity] = await db
      .select({ nameJson: entitiesTable.nameJson })
      .from(entitiesTable)
      .where(eq(entitiesTable.id, entityId))
      .limit(1);
    const fieldRows = await db
      .select({ fieldKey: entityFieldsTable.fieldKey, nameJson: entityFieldsTable.nameJson })
      .from(entityFieldsTable)
      .where(eq(entityFieldsTable.entityId, entityId));
    const fieldName = new Map(fieldRows.map((f) => [f.fieldKey, f.nameJson]));

    await db.insert(deletedFilesTable).values(
      toTrash.map((t) => ({
        entityId,
        entityNameJson: entity?.nameJson ?? null,
        recordId,
        fieldKey: t.fieldKey,
        fieldNameJson: fieldName.get(t.fieldKey) ?? null,
        fileName: t.file.name,
        filePath: t.file.path,
        fileSize: t.file.size,
        contentType: t.file.contentType,
        reason: t.reason,
        deletedBy: req.user!.userId,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to record removed files in the file trash");
  }
}

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
  if (!(await assertRecord(req, res, existing.entityId, "update", body.data.pageId))) return;

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
  const { editable, hidden } = await fieldAccessContext(req, existing.entityId, fields, body.data.pageId);

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
    const gdriveModuleEnabled = await isGoogleDriveModuleEnabled();
    const result = validateValues(fields, candidate, gdriveModuleEnabled, existingValues);
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    const userRefError = await validateUserRefs(fields, result.values);
    if (userRefError) {
      res.status(400).json({ error: userRefError });
      return;
    }
    const depError = await checkDependentValues(existing.entityId, fields, result.values, params.data.id);
    if (depError) {
      res.status(400).json({ error: depError });
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
  // Hard boundary: the role may not move a record INTO a status hidden from its
  // picker. A record already sitting in a hidden status (status unchanged) is left
  // alone so unrelated value edits never break.
  if (statusChanging && update.statusId != null && !perms.superAdmin) {
    const { hiddenStatusIds } = effectiveStatusVisibility(perms, existing.entityId);
    if (hiddenStatusIds.includes(update.statusId)) {
      res.status(403).json({ error: "This status is not available to your role" });
      return;
    }
  }
  if (statusChanging && existing.statusId != null && !perms.superAdmin) {
    const transitions = await db
      .select()
      .from(entityTransitionsTable)
      .where(eq(entityTransitionsTable.entityId, existing.entityId));
    if (transitions.length > 0) {
      guardFromStatusId = existing.statusId;
      // A specific from→to transition takes precedence; otherwise fall back to a
      // wildcard (fromStatusId === null, "from any status") into the target.
      const match =
        transitions.find(
          (t) => t.fromStatusId === existing.statusId && t.toStatusId === update.statusId,
        ) ?? transitions.find((t) => t.fromStatusId === null && t.toStatusId === update.statusId);
      if (!match) {
        res.status(422).json({ error: "This status change is not an allowed transition" });
        return;
      }
      const allowedRoleIds = (match.allowedRoleIds as number[]) ?? [];
      const userRoleIds = await getUserRoleIds(req);
      if (allowedRoleIds.length > 0 && !allowedRoleIds.some((id) => userRoleIds.includes(id))) {
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
          const gdriveModuleEnabled = await isGoogleDriveModuleEnabled();
          const result = validateValues(fields, base, gdriveModuleEnabled, existingValues);
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

  // Audit: one entry per changed data field, plus status and (consequent)
  // archival flips. Diffing the persisted value map against the prior one keeps
  // the trail accurate even when workflow set_field actions mutated values.
  const userId = req.user!.userId;
  const updateEntries: InsertAuditLog[] = [];
  if (update.valuesJson !== undefined) {
    const after = record.valuesJson as Record<string, unknown>;
    for (const c of diffValues(existingValues, after, fields.map((f) => f.fieldKey))) {
      updateEntries.push({ entityId: existing.entityId, recordId: record.id, ...c, userId });
    }
  }
  if (statusChanging) {
    updateEntries.push({
      entityId: existing.entityId,
      recordId: record.id,
      fieldKey: AUDIT_STATUS,
      oldValue: existing.statusId != null ? String(existing.statusId) : null,
      newValue: record.statusId != null ? String(record.statusId) : null,
      userId,
    });
    // A delay=0 archive-trigger status archives immediately as a side effect.
    if (existing.archivedAt == null && record.archivedAt != null) {
      updateEntries.push({ entityId: existing.entityId, recordId: record.id, fieldKey: AUDIT_ARCHIVED, oldValue: "false", newValue: "true", userId });
    }
  }
  await writeAudit(updateEntries, req.log);

  // Move any local files that were cleared or replaced by this update into the
  // file trash (Drive/link values untouched). Best-effort; does not block.
  if (update.valuesJson !== undefined) {
    await trashRemovedServerFiles(
      req,
      existing.entityId,
      record.id,
      existingValues,
      record.valuesJson as Record<string, unknown>,
    );
  }

  const events: Parameters<typeof emitEvent>[0] = [
    {
      eventName: EVENT_RECORD_UPDATED,
      entityId: existing.entityId,
      recordId: record.id,
      payload: { actorUserId: userId },
    },
  ];
  if (statusChanging) {
    events.push({
      eventName: EVENT_STATUS_CHANGED,
      entityId: existing.entityId,
      recordId: record.id,
      payload: {
        actorUserId: userId,
        from: existing.statusId ?? null,
        to: record.statusId ?? null,
      },
    });
  }
  await emitEvent(events, req.log);

  res.json(stripHidden(record, hidden));
});

router.delete("/records/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = DeleteRecordBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
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
  if (!(await assertRecord(req, res, existing.entityId, "delete", body.data.pageId))) return;

  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, existing.entityId);
  const values = (existing.valuesJson as Record<string, unknown>) ?? {};
  if (scope === "own" && !recordOwnedBy(values, scopeFieldKeys, req.user!.userId)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  await db.delete(entityRecordsTable).where(eq(entityRecordsTable.id, params.data.id));

  // Move the record's local files into the file trash so a mistaken delete is
  // recoverable (Drive/link values untouched). Best-effort; does not block.
  await trashRemovedServerFiles(req, existing.entityId, params.data.id, values, null);

  // Audit: one deletion marker carrying a snapshot of the record's data so the
  // trail preserves what was removed even though the row is gone.
  await writeAudit(
    [{
      entityId: existing.entityId,
      recordId: params.data.id,
      fieldKey: AUDIT_DELETED,
      oldValue: Object.keys(values).length > 0 ? auditStr(values) : null,
      newValue: null,
      userId: req.user!.userId,
    }],
    req.log,
  );

  await emitEvent(
    {
      eventName: EVENT_RECORD_DELETED,
      entityId: existing.entityId,
      recordId: params.data.id,
      payload: { actorUserId: req.user!.userId },
    },
    req.log,
  );

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

  // Audit: log the archival flip only when it actually changed state.
  if (wasArchived !== archived) {
    await writeAudit(
      [{
        entityId: existing.entityId,
        recordId,
        fieldKey: AUDIT_ARCHIVED,
        oldValue: String(wasArchived),
        newValue: String(archived),
        userId: req.user!.userId,
      }],
      req.log,
    );
  }

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
