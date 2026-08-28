import { Router, type IRouter } from "express";
import { db, entityRecordsTable, entityFieldsTable, entityStatusesTable, entitiesTable, usersTable, entityTransitionsTable, deletedFilesTable, pageFieldsTable, pageRecordValuesTable, pagesTable, relationsTable, recordLinksTable } from "@workspace/db";
import { eq, asc, desc, and, or, sql, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { evaluateFormula, normalizeDecimals, cleanFpNoise, type FormulaFieldDef } from "@workspace/formula";
import type { Request } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  requireRecordParam,
  assertRecord,
  getPermissions,
  getUserRoleIds,
  effectiveScope,
  effectiveScopeFor,
  effectiveStatusVisibility,
  effectiveRecordPerm,
  resolveFieldAccess,
  mostPermissiveFieldPerm,
  canRecord,
  requireSuperAdmin,
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
  GetPageFilterValuesParams,
  GetPageFilterValuesBody,
  GetFieldDependentValuesParams,
  GetFieldDependentValuesBody,
  RenameFieldValueParams,
  RenameFieldValueBody,
  ArchiveRecordParams,
  ArchiveRecordBody,
  UnarchiveRecordParams,
  PivotEntityRecordsParams,
  PivotEntityRecordsBody,
  BulkRecordsActionBody,
  BulkUpdateRecordFieldBody,
  MergeRecordsBody,
} from "@workspace/api-zod";
import type { EntityField, InsertAuditLog, FileSource, FileFieldConfig, FieldValidationRule } from "@workspace/db";
import { mappedStatusForChangedValues, optionValues, optionNumbers } from "../lib/selectOptions";
import { resolveCustomFilterClauses, type CustomFilterPick } from "./custom-filter-apply";
import {
  buildRecordQuery,
  buildPageLocalCondition,
  pageLocalValueExpr,
  relationValueExists,
  EMPTY_FILTER_VALUE,
  relationLinkFilter,
  relationLinkedIdScalar,
  relationValueScalar,
  SYSTEM_SORT_CREATED_AT,
  type RecordQuerySpec,
  type FilterCondition,
  type RelationFilterMeta,
  loadPageRefSource,
} from "./record-query";
import type { PageField, PageRefFieldConfig } from "@workspace/db";
import { buildRelationMeta, ownScopeWhere, isRecordOwned } from "./own-scope";
import { applyPageFieldDefaults } from "../lib/page-field-defaults";
import { computePivot } from "./pivot-compute";
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
  EVENT_PAGE_FIELD_SAVED,
} from "../lib/events";
import {
  lockAndValidateUserReferences,
  referencedUserIds,
  UserReferenceBusyError,
} from "../lib/user-reference-barrier";
import {
  combineAuthoritativeAndViewerWhere,
  resolveAuthoritativeView,
} from "../lib/authoritative-view";
import {
  interactiveFormulaPermissions,
  mergeLinkedFormulaInputs,
  mergeLinkedFormulaInputsBatched,
  buildQualifiedFormulaScope,
  formulaSourcesOf,
  materializeVisibleEntityFormulas,
  canUseRecordPageFormulaContext,
  projectViewerFormulaValues,
  materializeVisiblePageFormulas,
  loadFormulaOptions,
} from "../lib/formula-runtime";
import { effectiveEntityForPage } from "./page-fields";
import {
  applyFormulaGroupResults,
  formulaGroupResultWinners,
  secureFormulaGroupConfigs,
  type FormulaGroupConfig,
  type FormulaGroupReference,
} from "../lib/formula-group-result";
import { isManualStatusEditDisabled } from "../lib/status-manual-edit";
import {
  canonicalGdriveFileIdUnion,
  DriveFileTombstonedError,
  lockAndValidateGdriveFileReferences,
  lockGdriveFileIds,
  newlyIntroducedGdriveFileIds,
  validateGdriveFileReferencesUnderLock,
} from "../lib/gdrive-file-reference-lock";

const router: IRouter = Router();

// Page-local field types whose value lives in page_record_values and can be
// filtered with the standard value operators. Relation/lookup/function have no
// stored value and `file` stores an object, so they are never filterable.
const PAGE_LOCAL_FILTERABLE_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "url",
  "phone",
  "select",
  "number",
  "percent",
  "boolean",
  "date",
  "datetime",
  "user",
]);

/**
 * Resolve a page-local field into the (pageId, key, type) triple its VALUE
 * actually lives under, enforcing the filter boundary. For ordinary page fields
 * that's the field itself; for `page_ref` it's the SOURCE page's field, gated
 * by the same double boundary as value merging (source-page access + source
 * field per-role visibility; setup admins pass) plus read-time eligibility.
 * Returns null when the field must not be filterable for this viewer.
 */
async function resolvePageLocalFilterTarget(
  pf: PageField,
  roleIds: number[],
  perms: Awaited<ReturnType<typeof getPermissions>>,
  entityId: number,
  pageId: number,
): Promise<{ effType: string; exprPageId: number; exprKey: string } | null> {
  if (!pf.isFilterable) return null;
  if (mostPermissiveFieldPerm(pf.permissionsJson, roleIds, "view", perms, entityId, pageId) === "hidden") return null;
  if (pf.fieldType === "page_ref") {
    const cfg = (pf.pageRefConfigJson ?? {}) as PageRefFieldConfig;
    const src = await loadPageRefSource(cfg);
    if (!src || !PAGE_LOCAL_FILTERABLE_TYPES.has(src.fieldType)) return null;
    if (!(perms.superAdmin || perms.admin.pages)) {
      if (!perms.pageIds.includes(cfg.sourcePageId!)) return null;
      if (mostPermissiveFieldPerm(src.permissionsJson, roleIds, "view", perms, entityId, cfg.sourcePageId!) === "hidden")
        return null;
    }
    return { effType: src.fieldType, exprPageId: cfg.sourcePageId!, exprKey: cfg.sourceFieldKey! };
  }
  if (!PAGE_LOCAL_FILTERABLE_TYPES.has(pf.fieldType)) return null;
  return { effType: pf.fieldType, exprPageId: pageId, exprKey: pf.fieldKey };
}

/**
 * Resolve a SOFT page-local exclusion without requiring `isFilterable` (page
 * admins may author exclusions independently of the viewer's live filter bar),
 * while still enforcing the viewer's field-visibility boundary. Returning null
 * intentionally ignores stale/deactivated/retyped/hidden defaults instead of
 * breaking the entire page or exposing protected values through row counts.
 */
function resolvePageLocalExclusionTarget(
  pf: PageField,
  roleIds: number[],
  perms: Awaited<ReturnType<typeof getPermissions>>,
  entityId: number,
  pageId: number,
): { exprPageId: number; exprKey: string } | null {
  if (!pf.isActive || !PAGE_LOCAL_FILTERABLE_TYPES.has(pf.fieldType)) return null;
  if (mostPermissiveFieldPerm(pf.permissionsJson, roleIds, "view", perms, entityId, pageId) === "hidden") return null;
  return { exprPageId: pageId, exprKey: pf.fieldKey };
}

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

export function isEmpty(value: unknown): boolean {
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
function allowedFileSources(field: FileFieldLike): FileSource[] {
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
export type FileFieldLike = { fieldKey: string; fileConfigJson?: unknown };

export function validateFileValue(field: FileFieldLike, raw: unknown, gdriveModuleEnabled: boolean, prevValue?: unknown): Record<string, unknown> | string {
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
    // New server uploads land on local disk (`/local/...`); legacy values point
    // at object storage (`/objects/...`) and stay readable/valid.
    if (typeof path !== "string" || !(path.startsWith("/local/") || path.startsWith("/objects/"))) {
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

export function validateValues(
  fields: EntityField[],
  values: Record<string, unknown>,
  gdriveModuleEnabled: boolean,
  prevValues: Record<string, unknown> = {},
  /**
   * When set, the required-field check applies ONLY to these field keys.
   * Used by SYSTEM writes (automations): they update specific fields and must
   * not be blocked by pre-existing empty required fields they do not touch —
   * user-facing create/update paths keep the strict all-fields check.
   */
  requiredOnlyKeys?: Set<string>,
): { values: Record<string, unknown> } | { error: string } {
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
    // Relation fields are derived from a single linked record (the link lives in
    // record_links, assigned via the related-link endpoint) and never stored here.
    // Lookup fields project another field of that same linked record (read-only),
    // so they are likewise derived and never stored in valuesJson.
    // created_at (system date) mirrors the record's system creation timestamp —
    // read-only, never stored in valuesJson.
    if (
      field.fieldType === "function" ||
      field.fieldType === "relation" ||
      field.fieldType === "lookup" ||
      field.fieldType === "created_at"
    )
      continue;
    const raw = values[field.fieldKey];

    if (isEmpty(raw)) {
      if (field.isRequired && (requiredOnlyKeys === undefined || requiredOnlyKeys.has(field.fieldKey))) {
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
        if (!optionValues(field.optionsJson).has(raw)) return { error: `Field "${field.fieldKey}" must be one of the allowed options` };
        cleaned[field.fieldKey] = raw;
        break;
      }
      case "percent": {
        // Stored as a NUMBER (30 = 30%) so it works in formulas and averages.
        const num = typeof raw === "number" ? raw : Number(raw);
        if (typeof raw === "boolean" || (typeof raw === "string" && raw.trim() === "") || !Number.isFinite(num)) {
          return { error: `Field "${field.fieldKey}" must be a number` };
        }
        // List mode: the value must be one of the numeric preset options,
        // compared by numeric equivalence (so "12.50" matches 12.5).
        if ((field.percentConfigJson?.mode ?? "value") === "list" && !optionNumbers(field.optionsJson).has(num)) {
          return { error: `Field "${field.fieldKey}" must be one of the allowed options` };
        }
        cleaned[field.fieldKey] = num;
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

export async function loadActiveFields(entityId: number): Promise<EntityField[]> {
  return db
    .select()
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)))
    .orderBy(asc(entityFieldsTable.sortOrder));
}

/** Verify that every value for a `user`-type field references an existing user. */
export async function validateUserRefs(
  fields: EntityField[],
  values: Record<string, unknown>,
  tx?: DbExecutor,
): Promise<string | null> {
  const unique = referencedUserIds(fields, values);
  if (unique.length === 0) return null;
  if (tx) return lockAndValidateUserReferences(tx, unique);
  const rows = await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.id, unique));
  const found = new Set(rows.map((r) => r.id));
  const missing = unique.find((id) => !found.has(id));
  return missing === undefined ? null : `Referenced user ${missing} does not exist`;
}

/**
 * Resolve the requester's field-access context for an entity: which field keys
 * are hidden (stripped from responses) and which are editable (writable).
 */
export async function fieldAccessContext(
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
    const access = resolveFieldAccess(f, perms, roleIds, entityId, rp, pageId);
    if (access === "hidden") hidden.add(f.fieldKey);
    if (access === "edit") editable.add(f.fieldKey);
  }
  return { hidden, editable };
}

async function resolvePageFormulaContextId(
  req: Request,
  entityId: number,
  pageId: number | undefined,
): Promise<number | undefined> {
  if (pageId == null) return undefined;
  const [pageEntity, perms] = await Promise.all([
    effectiveEntityForPage(pageId),
    getPermissions(req),
  ]);
  const recordPermission = pageEntity.found && pageEntity.entityId === entityId
    ? await effectiveRecordPerm(req, perms, entityId, pageId)
    : undefined;
  return pageEntity.found && canUseRecordPageFormulaContext({
    permissions: perms,
    entityId,
    pageId,
    pageEntityId: pageEntity.entityId,
    recordPermission,
  }) ? pageId : undefined;
}

async function loadPageFormulaResponseContext(
  req: Request,
  entityId: number,
  pageId: number | undefined,
  recordIds: readonly number[],
): Promise<{
  fields: PageField[];
  hidden: Set<string>;
  values: Map<number, Record<string, unknown>>;
}> {
  const authorizedPageId = await resolvePageFormulaContextId(req, entityId, pageId);
  if (authorizedPageId == null) return { fields: [], hidden: new Set(), values: new Map() };
  // pageId is untrusted on record routes. Resolve the canonical page→entity
  // binding and page-aware read permission before touching page schema or data.
  const [perms, roleIds] = await Promise.all([getPermissions(req), getUserRoleIds(req)]);
  const fields = await db.select().from(pageFieldsTable).where(and(
      eq(pageFieldsTable.pageId, authorizedPageId),
      eq(pageFieldsTable.isActive, true),
    ));
  const hidden = new Set(fields
    .filter((field) =>
      mostPermissiveFieldPerm(field.permissionsJson, roleIds, "view", perms, entityId, authorizedPageId) === "hidden")
    .map((field) => field.fieldKey));
  const values = new Map<number, Record<string, unknown>>();
  if (recordIds.length > 0) {
    const rows = await db
      .select({ recordId: pageRecordValuesTable.recordId, values: pageRecordValuesTable.valuesJson })
      .from(pageRecordValuesTable)
      .where(and(
        eq(pageRecordValuesTable.pageId, authorizedPageId),
        inArray(pageRecordValuesTable.recordId, [...recordIds]),
      ));
    for (const row of rows) values.set(row.recordId, (row.values as Record<string, unknown> | null) ?? {});
  }
  return { fields, hidden, values };
}

/** Remove hidden field keys from a record's valuesJson before returning it. */
function stripHidden<T extends { valuesJson: unknown }>(record: T, hidden: Set<string>): T {
  if (hidden.size === 0) return record;
  const values = { ...((record.valuesJson as Record<string, unknown>) ?? {}) };
  for (const k of hidden) delete values[k];
  return { ...record, valuesJson: values };
}

/**
 * Present a record for a response: strip hidden field values, then inject the
 * system creation timestamp under every visible `created_at`-type field key.
 * created_at fields have no stored value — the injected ISO value is display
 * data only (writes drop the key), so this cannot round-trip into storage.
 */
export function presentRecord<T extends { valuesJson: unknown; createdAt: Date | string }>(
  record: T,
  hidden: Set<string>,
  fields: EntityField[],
): T {
  const out = stripHidden(record, hidden);
  const sysKeys = fields.filter((f) => f.fieldType === "created_at" && !hidden.has(f.fieldKey));
  const values = { ...((out.valuesJson as Record<string, unknown>) ?? {}) };
  // Resolver inputs are evaluation-only capabilities. Never serialize them:
  // their keys may reveal linked/page schema and their values may be derived
  // from a formula the viewer is not allowed to inspect.
  for (const source of formulaSourcesOf(fields)) delete values[source.key];
  if (sysKeys.length === 0) return { ...out, valuesJson: values };
  const iso = record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt);
  for (const f of sysKeys) values[f.fieldKey] = iso;
  return { ...out, valuesJson: values };
}

/** Russian label for a field, falling back to its key (server-side getML-lite). */
function fieldRuName(field: EntityField): string {
  const name = field.nameJson as { ru?: string; en?: string; he?: string } | null;
  return name?.ru || name?.en || name?.he || field.fieldKey;
}

/**
 * Coerce a value into a number for ordered comparisons (gt/lt/gte/lte/between).
 * Numeric strings compare numerically; otherwise an ISO date/datetime string is
 * compared by its epoch. Returns null when the value is not comparable.
 */
function toComparable(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** Whether the condition field's value satisfies a validation rule's operator. */
function validationConditionSatisfied(rule: FieldValidationRule, otherValue: unknown): boolean {
  switch (rule.operator) {
    case "empty":
      return isEmpty(otherValue);
    case "notEmpty":
      return !isEmpty(otherValue);
    case "equals":
      return String(otherValue ?? "") === String(rule.value ?? "");
    case "notEquals":
      return String(otherValue ?? "") !== String(rule.value ?? "");
    case "gt": {
      const a = toComparable(otherValue), b = toComparable(rule.value);
      return a != null && b != null && a > b;
    }
    case "lt": {
      const a = toComparable(otherValue), b = toComparable(rule.value);
      return a != null && b != null && a < b;
    }
    case "gte": {
      const a = toComparable(otherValue), b = toComparable(rule.value);
      return a != null && b != null && a >= b;
    }
    case "lte": {
      const a = toComparable(otherValue), b = toComparable(rule.value);
      return a != null && b != null && a <= b;
    }
    case "between": {
      const a = toComparable(otherValue), lo = toComparable(rule.value), hi = toComparable(rule.value2);
      return a != null && lo != null && hi != null && a >= lo && a <= hi;
    }
    default:
      // Unknown operator (forward-compat): do not block.
      return true;
  }
}

/** Human-readable (ru) description of what the condition field must satisfy. */
function describeValidationCondition(rule: FieldValidationRule, condField: EntityField): string {
  const name = fieldRuName(condField);
  const v = rule.value ?? "";
  switch (rule.operator) {
    case "empty":
      return `поле «${name}» должно быть пустым`;
    case "notEmpty":
      return `поле «${name}» должно быть заполнено`;
    case "equals":
      return `поле «${name}» должно быть равно «${v}»`;
    case "notEquals":
      return `поле «${name}» не должно быть равно «${v}»`;
    case "gt":
      return `поле «${name}» должно быть больше «${v}»`;
    case "lt":
      return `поле «${name}» должно быть меньше «${v}»`;
    case "gte":
      return `поле «${name}» должно быть не меньше «${v}»`;
    case "lte":
      return `поле «${name}» должно быть не больше «${v}»`;
    case "between":
      return `поле «${name}» должно быть в диапазоне от «${v}» до «${rule.value2 ?? ""}»`;
    default:
      return `поле «${name}» должно удовлетворять условию`;
  }
}

/**
 * Cross-field validation ("fill") rules — a HARD server boundary on record
 * create/update, distinct from cosmetic conditional formatting. For each field
 * that has a (non-empty) value, every one of its validationRulesJson rules whose
 * applyToValues matches must be satisfied by the named condition field;
 * otherwise the save is rejected with an auto-generated message. Evaluated
 * against the FINAL merged record values, so it also blocks clearing/altering a
 * prerequisite field that another field's set value still depends on. Stale
 * rules referencing a removed field are ignored.
 */
export function checkValidationRules(fields: EntityField[], values: Record<string, unknown>): string | null {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f] as const));
  for (const field of fields) {
    const rules = (field.validationRulesJson as FieldValidationRule[] | null) ?? [];
    if (!Array.isArray(rules) || rules.length === 0) continue;
    const myVal = values[field.fieldKey];
    if (isEmpty(myVal)) continue;
    for (const rule of rules) {
      if (!rule || !rule.conditionFieldKey || !rule.operator) continue;
      if (Array.isArray(rule.applyToValues) && rule.applyToValues.length > 0 && !rule.applyToValues.includes(String(myVal))) {
        continue;
      }
      const condField = byKey.get(rule.conditionFieldKey);
      if (!condField) continue;
      if (!validationConditionSatisfied(rule, values[rule.conditionFieldKey])) {
        const shown = field.fieldType === "boolean" ? (String(myVal) === "true" ? "Да" : "Нет") : String(myVal);
        return `Нельзя сохранить поле «${fieldRuName(field)}» со значением «${shown}»: ${describeValidationCondition(rule, condField)}.`;
      }
    }
  }
  return null;
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
export async function checkDependentValues(
  entityId: number,
  fields: EntityField[],
  values: Record<string, unknown>,
  excludeRecordId?: number,
  exec: DbExecutor = db as unknown as DbExecutor,
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
    const rows = await exec
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

/** Clear every dependent field whose parent chain includes `changedKey`. */
function clearDependentDescendantValues(
  values: Record<string, unknown>,
  changedKey: string,
  fields: EntityField[],
): Record<string, unknown> {
  let next = values;
  for (const field of fields) {
    if (!field.dependencyConfigJson?.dependsOnFieldKey) continue;
    if (!dependencyAncestorKeys(field, fields).includes(changedKey)) continue;
    if (!(field.fieldKey in next) || isEmpty(next[field.fieldKey])) continue;
    if (next === values) next = { ...values };
    delete next[field.fieldKey];
  }
  return next;
}

/** Arbitrary advisory-lock namespace for serializing unique-key checks per entity. */
export const UNIQUE_KEY_LOCK_NS = 415943;

/** Thrown inside a write transaction when an isKey value collides; mapped to 409. */
export class UniqueKeyError extends Error {}
class UserReferenceValidationError extends Error {}

/** A db handle that works for both the pool and a transaction. */
export type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Uniqueness guard for `isKey` fields. MUST run inside the write transaction
 * (under `pg_advisory_xact_lock`) so two concurrent writes can't both pass.
 * Case-insensitive (trim+lower), global within the entity — NO archive/visibility
 * filter, because a key must stay unique even against archived/hidden rows (else
 * unarchiving could resurrect a duplicate). `excludeRecordId` skips the row being
 * updated so it never collides with its own stored value.
 */
export async function checkUniqueKeys(
  exec: DbExecutor,
  entityId: number,
  keyFields: EntityField[],
  values: Record<string, unknown>,
  excludeRecordId?: number,
): Promise<string | null> {
  const norm = (s: string) => s.trim().toLowerCase();
  for (const f of keyFields) {
    const raw = values[f.fieldKey];
    if (isEmpty(raw)) continue;
    const v = typeof raw === "string" ? raw.trim() : String(raw);
    const valueExpr = sql`lower(trim(${entityRecordsTable.valuesJson} ->> ${f.fieldKey}))`;
    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId), sql`${valueExpr} = ${norm(v)}`];
    if (excludeRecordId != null) clauses.push(sql`${entityRecordsTable.id} <> ${excludeRecordId}`);
    const [hit] = await exec
      .select({ id: entityRecordsTable.id })
      .from(entityRecordsTable)
      .where(and(...clauses)!)
      .limit(1);
    if (hit) return `Поле «${fieldRuName(f)}»: значение «${v}» уже используется в другой записи`;
  }
  return null;
}

/**
 * Immutability guard for `lockAfterCreate` fields, run on UPDATE only. Once a
 * non-empty value has been stored, it can neither change nor be cleared. No
 * superAdmin exception — durable integrity is the entire point of the flag.
 */
export function checkImmutableFields(
  fields: EntityField[],
  newValues: Record<string, unknown>,
  oldValues: Record<string, unknown>,
): string | null {
  for (const f of fields) {
    if (!f.lockAfterCreate) continue;
    const oldV = oldValues[f.fieldKey];
    if (isEmpty(oldV)) continue; // not yet set → the first non-empty save is allowed
    const newV = newValues[f.fieldKey];
    if (JSON.stringify(newV ?? null) !== JSON.stringify(oldV ?? null)) {
      return `Поле «${fieldRuName(f)}» нельзя изменить после создания записи`;
    }
  }
  return null;
}

/** Returns true if the status belongs to the given entity. */
export async function statusBelongsToEntity(statusId: number, entityId: number): Promise<boolean> {
  const [status] = await db
    .select({ id: entityStatusesTable.id })
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.id, statusId), eq(entityStatusesTable.entityId, entityId)))
    .limit(1);
  return Boolean(status);
}

export async function defaultStatusId(entityId: number): Promise<number | null> {
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
const ARCHIVED_CHANGED_FIELD = "__archived__";

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
    const archived = await db
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
      )
      .returning({ id: entityRecordsTable.id, version: entityRecordsTable.version });
    if (archived.length > 0) {
      await emitEvent(archived.map((record) => ({
        eventName: EVENT_RECORD_UPDATED,
        entityId,
        recordId: record.id,
        payload: { changedFields: [ARCHIVED_CHANGED_FIELD], version: record.version },
      })));
    }
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

router.get("/entities/:entityId/records", requireAuth, requireRecordParam("view", { entityOnly: true }), async (req, res): Promise<void> => {
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
    where = and(where, await ownScopeWhere(entityId, scopeFieldKeys, req.user!.userId, fields))!;
  }
  const listHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
  if (listHiddenRowWhere) where = and(where, listHiddenRowWhere)!;

  const records = await db
    .select()
    .from(entityRecordsTable)
    .where(where)
    .orderBy(desc(entityRecordsTable.createdAt));
  const formulaPermissions = await interactiveFormulaPermissions(req, entityId);
  const visibleFields = fields.filter((field) => !hidden.has(field.fieldKey));
  const formulaRows = records.map((record) => {
    const values = { ...((record.valuesJson ?? {}) as Record<string, unknown>) };
    for (const field of visibleFields) {
      if (field.fieldType === "created_at") values[field.fieldKey] = record.createdAt.toISOString();
    }
    return { id: record.id, createdAt: record.createdAt, values };
  });
  const linked = await mergeLinkedFormulaInputsBatched({
    entityId,
    rows: formulaRows.map((row) => ({
      id: row.id,
      values: projectViewerFormulaValues(row.values, visibleFields),
    })),
    fields: visibleFields,
    permissions: formulaPermissions,
  });
  let formulaValues = materializeVisibleEntityFormulas({
    entityId,
    rows: formulaRows,
    fields: visibleFields,
    hidden,
    linkedInputs: linked,
    formulaOptions: await loadFormulaOptions(),
  });
  const groupConfigs = secureFormulaGroupConfigs({
    fields: visibleFields,
    entityFields: visibleFields,
  });
  if (groupConfigs.length > 0) {
    formulaValues = applyFormulaGroupResults(
      formulaValues,
      formulaGroupResultWinners(formulaRows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        entityValues: formulaValues.get(row.id) ?? row.values,
      })), groupConfigs),
    );
  }
  res.json(records.map((r) => presentRecord(
    { ...r, valuesJson: formulaValues.get(r.id) ?? r.valuesJson },
    hidden,
    fields,
  )));
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

  // Keep ordinary entity query semantics intact, but treat an untrusted page
  // context as absent for every derived/formula path unless it passes the page
  // ownership, page access, and page-aware record-view boundaries.
  const formulaPageId = await resolvePageFormulaContextId(req, entityId, body.data.pageId);
  const formulaOptions = await loadFormulaOptions();
  const fields = await loadActiveFields(entityId);
  const selectedView = await resolveAuthoritativeView({
    req,
    entityId,
    pageId: body.data.pageId,
    viewId: body.data.viewId,
    allFields: fields,
  });
  if (!selectedView.ok) {
    res.status(selectedView.status).json({ error: selectedView.error });
    return;
  }
  const { hidden } = await fieldAccessContext(req, entityId, fields, body.data.pageId);
  // Hidden fields must not be observable, including via filter/sort/search inference.
  // Restrict the query whitelist to visible fields so any reference to a hidden field
  // is rejected as an unknown field and search never touches hidden values.
  const visibleFields = fields.filter((f) => !hidden.has(f.fieldKey));
  // Formula aliases are an evaluation capability: never register a hidden formula
  // here, otherwise a visible formula can infer its output (and linked sources).
  const toFormulaDef = (f: { fieldKey: string; formulaConfigJson: unknown }): FormulaFieldDef => {
    const cfg = f.formulaConfigJson as { expression?: string; decimals?: number | null } | null;
    return { key: f.fieldKey, expression: cfg?.expression ?? "", decimals: cfg?.decimals ?? null };
  };
  const entityFormulaDefs = visibleFields.filter((f) => f.fieldType === "function").map(toFormulaDef);
  const relationMeta = await buildRelationMeta(entityId, visibleFields);
  const built = buildRecordQuery(visibleFields, body.data as RecordQuerySpec, relationMeta);
  if ("error" in built) {
    res.status(400).json({ error: built.error });
    return;
  }

  const perms = await getPermissions(req);
  const formulaPermissions = await interactiveFormulaPermissions(req, entityId, formulaPageId);
  const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, body.data.pageId);
  const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);

  // Guests are strictly read-only: skip the archival write sweep for guest sessions.
  if (!req.user?.guest) await runAutoArchiveSweep(entityId);
  const archived = (body.data.archived ?? "active") as ArchiveFilterValue;

  const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
  if (built.where) clauses.push(built.where);
  const archWhere = archivedWhere(archived);
  if (archWhere) clauses.push(archWhere);
  if (scope === "own") clauses.push(await ownScopeWhere(entityId, scopeFieldKeys, req.user!.userId, fields));
  // Hard boundary: rows in a status hidden-for-rows for this role are never
  // returned, so the role cannot surface them via any filter/status pick either.
  const queryHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
  if (queryHiddenRowWhere) clauses.push(queryHiddenRowWhere);

  // Page-local field filters: conditions on fields stored in page_record_values
  // (keyed by pageId+recordId), not on the entity, so they bypass the entity
  // field whitelist above and are validated separately here. A condition is only
  // accepted for a visible (per-role), filterable, value-backed page-local field
  // — a field hidden for this role is rejected so its values can't be inferred
  // from which rows appear. AND-combined with the rest of the query. Requires
  // pageId (the page context that owns these fields).
  const pageLocalFilters = (body.data.pageLocalFilters ?? []) as FilterCondition[];
  if (pageLocalFilters.length > 0) {
    const plPageId = body.data.pageId;
    if (plPageId == null) {
      res.status(400).json({ error: "pageLocalFilters require pageId" });
      return;
    }
    const roleIds = await getUserRoleIds(req);
    const plRows = await db
      .select()
      .from(pageFieldsTable)
      .where(and(eq(pageFieldsTable.pageId, plPageId), eq(pageFieldsTable.isActive, true)));
    const plByKey = new Map(plRows.map((pf) => [pf.fieldKey, pf] as const));
    for (const cond of pageLocalFilters) {
      const pf = plByKey.get(cond.field);
      const target = pf ? await resolvePageLocalFilterTarget(pf, roleIds, perms, entityId, plPageId) : null;
      if (!target) {
        res.status(400).json({ error: `Unknown or non-filterable page field "${cond.field}"` });
        return;
      }
      const r = buildPageLocalCondition({ ...cond, field: target.exprKey }, target.effType, target.exprPageId);
      if ("error" in r) {
        res.status(400).json({ error: r.error });
        return;
      }
      clauses.push(r.sql);
    }
  }

  // SOFT exclusions on PAGE-LOCAL fields (page default filter, "show hidden"
  // off). Same semantics as entity excludeFilters: always AND-combined (never
  // routed through the view conjunction, so they can only NARROW). Selected-value
  // exclusions are NULL-safe; excludeEmpty explicitly hides missing/blank values.
  // Validated against the page's
  // ACTIVE value-backed fields — no isFilterable/visibility gate, matching the
  // entity exclusion path (exclusions are authored by a pages admin and only
  // ever hide rows, so they cannot leak values).
  const excludePageLocal = (body.data.excludePageLocalFilters ?? []) as {
    field: string;
    values?: string[];
    excludeEmpty?: boolean;
  }[];
  if (excludePageLocal.length > 0) {
    const eplPageId = body.data.pageId;
    if (eplPageId == null) {
      res.status(400).json({ error: "excludePageLocalFilters require pageId" });
      return;
    }
    const eplRows = await db
      .select()
      .from(pageFieldsTable)
      .where(and(eq(pageFieldsTable.pageId, eplPageId), eq(pageFieldsTable.isActive, true)));
    const eplByKey = new Map(eplRows.map((pf) => [pf.fieldKey, pf] as const));
    const eplRoleIds = await getUserRoleIds(req);
    for (const ex of excludePageLocal) {
      const pf = eplByKey.get(ex.field);
      const target = pf
        ? resolvePageLocalExclusionTarget(pf, eplRoleIds, perms, entityId, eplPageId)
        : null;
      // SOFT page defaults are metadata that may become stale after a field is
      // removed, deactivated, retyped, or hidden for this viewer. Ignore that
      // condition rather than 400ing the whole records page.
      if (!target) continue;
      const vals = (ex.values ?? []).filter((v) => v != null && v !== "").map((v) => String(v));
      const expr = pageLocalValueExpr(target.exprPageId, target.exprKey);
      if (ex.excludeEmpty === true) {
        clauses.push(sql`NULLIF(BTRIM(${expr}), '') IS NOT NULL`);
      }
      if (vals.length > 0) {
        const parts = vals.map((v) => sql`${v}`);
        clauses.push(sql`(${expr} IS NULL OR ${expr} NOT IN (${sql.join(parts, sql`, `)}))`);
      }
    }
  }

  // Per-entity CUSTOM filters (custom_filters): each picked filter references an
  // AUTHORITATIVE def by id + any runtime input values. The def (a two-level
  // И/ИЛИ condition tree over ANY field, incl. formula) is resolved server-side
  // and is evaluated only over the viewer-visible schema. A hidden formula or
  // its linked sources must never become an inference oracle through filtering.
  {
    const cf = await resolveCustomFilterClauses({
      entityId,
      allFields: visibleFields,
      relationMeta,
      picks: (body.data.customFilters ?? []) as CustomFilterPick[],
      pageId: formulaPageId,
      formulaOptions,
      formulaPermissions,
      loadVisiblePageFields: async (pageId) => {
        const context = await loadPageFormulaResponseContext(req, entityId, pageId, []);
        return new Map(context.fields
          .filter((field) => !context.hidden.has(field.fieldKey))
          .map((field) => [field.fieldKey, {
            fieldType: field.fieldType,
            formulaConfigJson: field.formulaConfigJson,
          }] as const));
      },
    });
    if ("error" in cf) {
      res.status(400).json({ error: cf.error });
      return;
    }
    for (const c of cf.clauses) clauses.push(c);
  }

  // ---- Mirror-page grouping (pages.groupByFieldKey) -------------------------
  // `grouped: true` asks for group buckets in the response; `groupValue`
  // narrows the ROW set to a single group (used when the client expands one
  // group). Both require the pageId of a mirror page with grouping configured.
  // Boundary: the group field must be VISIBLE for this viewer — when it is
  // hidden, grouping silently degrades (no groups; groupValue rejected) so
  // group keys/labels can never leak a hidden field's values. For a relation
  // group field the label is the linked record's projected relatedFieldKey —
  // that projection carries its OWN boundary on the linked entity (the same
  // gate the related-values column applies): when the viewer lacks record-view
  // on the linked entity or the projected field is hidden there, the label is
  // withheld (null) while grouping still works via the opaque linked-record id.
  const wantGroups = body.data.grouped === true;
  const groupValueSpec = body.data.groupValue as { value?: string | null } | undefined;
  let groupField: EntityField | null = null;
  let groupRelMeta: RelationFilterMeta | undefined;
  let groupLabelAllowed = true;
  // Groups are always computed over the full filtered set WITHOUT the
  // groupValue narrowing, so expanding one group still returns every bucket.
  const groupsClauses = [...clauses];
  if (wantGroups || groupValueSpec !== undefined) {
    const gPageId = body.data.pageId;
    if (gPageId == null) {
      res.status(400).json({ error: "grouped/groupValue require pageId" });
      return;
    }
    const [gPage] = await db
      .select({ groupByFieldKey: pagesTable.groupByFieldKey })
      .from(pagesTable)
      .where(eq(pagesTable.id, gPageId));
    const gKey = gPage?.groupByFieldKey ?? null;
    if (gKey) {
      groupField = visibleFields.find((f) => f.fieldKey === gKey) ?? null;
      if (groupField && (groupField.fieldType === "relation" || groupField.fieldType === "lookup")) {
        groupRelMeta = relationMeta.get(gKey);
        if (!groupRelMeta) {
          groupField = null; // not a single-link relation → grouping unavailable
        } else {
          // Re-apply the LINKED entity's boundary for the projected label — the
          // same gate the related-values column uses. Without it a group label
          // would expose a projected field the viewer cannot see through the
          // column itself. Key (linked record id) stays usable either way.
          const [gRel] = await db
            .select()
            .from(relationsTable)
            .where(eq(relationsTable.id, groupRelMeta.relationId));
          const gRelatedEntityId = gRel
            ? groupRelMeta.direction === "source"
              ? gRel.targetEntityId
              : gRel.sourceEntityId
            : null;
          if (gRelatedEntityId == null || !canRecord(perms, gRelatedEntityId, "view")) {
            groupLabelAllowed = false;
          } else {
            const [gRelatedField] = await db
              .select()
              .from(entityFieldsTable)
              .where(
                and(
                  eq(entityFieldsTable.entityId, gRelatedEntityId),
                  eq(entityFieldsTable.fieldKey, groupRelMeta.relatedFieldKey),
                  eq(entityFieldsTable.isActive, true),
                ),
              );
            const gLabelRoleIds = await getUserRoleIds(req);
            groupLabelAllowed =
              !!gRelatedField &&
              resolveFieldAccess(gRelatedField, perms, gLabelRoleIds, gRelatedEntityId) !== "hidden";
          }
        }
      }
    }
    if (!groupField && groupValueSpec !== undefined) {
      res.status(400).json({ error: "Grouping is not available on this page" });
      return;
    }
    if (groupField && groupValueSpec !== undefined) {
      const v = groupValueSpec.value ?? null;
      if (groupRelMeta) {
        const linkedId = v === null ? null : Number(v);
        if (linkedId !== null && (!Number.isInteger(linkedId) || linkedId <= 0)) {
          clauses.push(sql`false`);
        } else {
          clauses.push(relationLinkFilter(groupRelMeta, linkedId));
        }
      } else {
        const expr = sql`(${entityRecordsTable.valuesJson} ->> ${groupField.fieldKey})`;
        clauses.push(v === null ? sql`(${expr} IS NULL OR ${expr} = '')` : sql`${expr} = ${v}`);
      }
    }
  }

  const where = combineAuthoritativeAndViewerWhere(selectedView.hardWhere, clauses)!;

  const { page, pageSize } = body.data;
  const offset = (page - 1) * pageSize;

  // "Expand all groups" mode: valid only on a grouped mirror page and only when
  // NOT narrowing to a single group. Rows are ordered so each group is
  // contiguous (group key first, then the user's sorts), and the response adds
  // `rowGroups` (record id → group key) so the client can render every group
  // expanded at once. Ignored when the page has no usable group field.
  const wantRowGroups = body.data.withRowGroups === true && !!groupField && groupValueSpec === undefined;
  const rowGroupKeyExpr =
    wantRowGroups && groupField
      ? groupRelMeta
        ? relationLinkedIdScalar(groupRelMeta)
        : sql`(${entityRecordsTable.valuesJson} ->> ${groupField.fieldKey})`
      : null;
  // Expand-all group ordering: the client interleaves headers following the ROW
  // order, so the rows' group-clustering expression must honor the caller's sort.
  // A __created_at__ sort orders groups by their newest/oldest member first;
  // otherwise the group field itself controls label order, with A→Z as fallback.
  // Empty group stays last.
  const groupRequestedSorts = (body.data.sorts ?? []) as { field: string; direction?: "asc" | "desc" }[];
  // `__created_at__` is only a whole-group ordering when it is the primary row
  // sort. A later date tie-break must not unexpectedly take over group ordering.
  const primaryCreatedAtGroupSort =
    groupRequestedSorts[0]?.field === SYSTEM_SORT_CREATED_AT ? groupRequestedSorts[0] : undefined;
  let rowGroupOrder: SQL[] = [];
  if (rowGroupKeyExpr && groupField) {
    const gLbl = groupRelMeta ? relationValueScalar(groupRelMeta) : rowGroupKeyExpr;
    const s0 = groupRequestedSorts[0];
    const gNum = sql`(CASE WHEN ${gLbl} ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (${gLbl})::numeric END)`;
    if (s0?.field === SYSTEM_SORT_CREATED_AT) {
      const gDateDir = s0.direction === "desc" ? sql`DESC` : sql`ASC`;
      const groupDate =
        s0.direction === "desc"
          ? sql`MAX(${entityRecordsTable.createdAt}) OVER (PARTITION BY NULLIF(${rowGroupKeyExpr}, ''))`
          : sql`MIN(${entityRecordsTable.createdAt}) OVER (PARTITION BY NULLIF(${rowGroupKeyExpr}, ''))`;
      rowGroupOrder = [
        sql`CASE WHEN NULLIF(${rowGroupKeyExpr}, '') IS NULL THEN 1 ELSE 0 END ASC`,
        sql`${groupDate} ${gDateDir}`,
        sql`${gNum} ASC NULLS LAST`,
        sql`${gLbl} ASC NULLS LAST`,
        sql`${rowGroupKeyExpr} ASC NULLS LAST`,
      ];
    } else {
      const gRowDir = s0?.field === groupField.fieldKey && s0.direction === "desc" ? sql`DESC` : sql`ASC`;
      rowGroupOrder = [
        sql`CASE WHEN NULLIF(${rowGroupKeyExpr}, '') IS NULL THEN 1 ELSE 0 END ASC`,
        sql`${gNum} ${gRowDir} NULLS LAST`,
        sql`${gLbl} ${gRowDir} NULLS LAST`,
        sql`${rowGroupKeyExpr} ASC NULLS LAST`,
      ];
    }
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entityRecordsTable)
    .where(where);

  const data = await db
    .select()
    .from(entityRecordsTable)
    .where(where)
    .orderBy(...(rowGroupOrder.length > 0 ? [...rowGroupOrder, ...built.orderBy] : built.orderBy))
    .limit(pageSize)
    .offset(offset);
  const dataPageFormulaContext = await loadPageFormulaResponseContext(
    req, entityId, formulaPageId, data.map((row) => row.id),
  );
  const visibleDataPageFields = dataPageFormulaContext.fields.filter(
    (field) => !dataPageFormulaContext.hidden.has(field.fieldKey),
  );
  const dataLinkedInputs = await mergeLinkedFormulaInputs({
    entityId,
    pageId: formulaPageId,
    rows: data.map((r) => ({ id: r.id, values: projectViewerFormulaValues((r.valuesJson ?? {}) as Record<string, unknown>, visibleFields) })),
    fields: [
      ...fields.filter((field) => !hidden.has(field.fieldKey)),
      ...visibleDataPageFields,
    ],
    permissions: formulaPermissions,
  });
  let dataFormulaValues = materializeVisibleEntityFormulas({
    entityId,
    rows: data.map((r) => ({ id: r.id, values: (r.valuesJson ?? {}) as Record<string, unknown> })),
        fields: visibleFields,
    hidden,
    pageId: formulaPageId,
    pageValues: dataPageFormulaContext.values,
    pageFields: dataPageFormulaContext.fields,
    hiddenPage: dataPageFormulaContext.hidden,
    linkedInputs: dataLinkedInputs,
    formulaOptions,
  });

  // Resolve grouping capabilities exclusively against this viewer's visible
  // schema. Page references are additionally restricted to the authorized page
  // context of the same effective entity (resolved above).
  const visibleEntityKeys = new Set(visibleFields.map((field) => field.fieldKey));
  const visiblePageKeys = new Set(visibleDataPageFields.map((field) => field.fieldKey));
  const secureGroupConfig = (
    field: { fieldKey: string; fieldType: string; formulaConfigJson: unknown },
  ): FormulaGroupConfig | null => {
    if (field.fieldType !== "function") return null;
    const groupResult = (field.formulaConfigJson as {
      groupResult?: { enabled?: unknown; fields?: unknown };
    } | null)?.groupResult;
    if (!groupResult || groupResult.enabled !== true || !Array.isArray(groupResult.fields) ||
        groupResult.fields.length === 0 || groupResult.fields.length > 8) return null;
    const refs: FormulaGroupReference[] = [];
    const seen = new Set<string>();
    for (const raw of groupResult.fields) {
      if (!raw || typeof raw !== "object") return null;
      const ref = raw as { scope?: unknown; pageId?: unknown; fieldKey?: unknown };
      if (typeof ref.fieldKey !== "string") return null;
      if (ref.scope === "entity" && visibleEntityKeys.has(ref.fieldKey)) {
        const key = `entity:${ref.fieldKey}`;
        if (seen.has(key)) return null;
        seen.add(key);
        refs.push({ scope: "entity", fieldKey: ref.fieldKey });
      } else if (
        ref.scope === "page" &&
        formulaPageId != null &&
        ref.pageId === formulaPageId &&
        visiblePageKeys.has(ref.fieldKey)
      ) {
        const key = `page:${formulaPageId}:${ref.fieldKey}`;
        if (seen.has(key)) return null;
        seen.add(key);
        refs.push({ scope: "page", pageId: formulaPageId, fieldKey: ref.fieldKey });
      } else {
        // A hidden, foreign-entity, or inaccessible-page reference disables the
        // grouping behavior rather than turning it into an inference oracle.
        return null;
      }
    }
    return { key: field.fieldKey, fields: refs };
  };
  const entityGroupConfigs = visibleFields
    .map(secureGroupConfig)
    .filter((config): config is FormulaGroupConfig => config !== null);
  const pageGroupConfigs = visibleDataPageFields
    .map(secureGroupConfig)
    .filter((config): config is FormulaGroupConfig => config !== null);
  let formulaGroupWinners = new Map<string, Set<number>>();
  let pageFormulaGroupWinners = new Map<string, Set<number>>();
  let formulaGroupRows: {
    id: number;
    createdAt: Date;
    values: Record<string, unknown>;
  }[] = [];
  let formulaGroupPageValues = new Map<number, Record<string, unknown>>();
  if (entityGroupConfigs.length > 0 || pageGroupConfigs.length > 0) {
    const groupingWhere = combineAuthoritativeAndViewerWhere(
      selectedView.hardWhere,
      groupsClauses,
    )!;
    formulaGroupRows = (await db
      .select({
        id: entityRecordsTable.id,
        createdAt: entityRecordsTable.createdAt,
        values: entityRecordsTable.valuesJson,
      })
      .from(entityRecordsTable)
      .where(groupingWhere)).map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        values: projectViewerFormulaValues(
          (row.values ?? {}) as Record<string, unknown>,
          visibleFields,
        ),
      }));
    if (formulaPageId != null && formulaGroupRows.length > 0) {
      const pageRows = await db
        .select({
          recordId: pageRecordValuesTable.recordId,
          values: pageRecordValuesTable.valuesJson,
        })
        .from(pageRecordValuesTable)
        .where(and(
          eq(pageRecordValuesTable.pageId, formulaPageId),
          inArray(pageRecordValuesTable.recordId, formulaGroupRows.map((row) => row.id)),
        ));
      for (const row of pageRows) {
        formulaGroupPageValues.set(
          row.recordId,
          projectViewerFormulaValues(
            (row.values ?? {}) as Record<string, unknown>,
            visibleDataPageFields,
          ),
        );
      }
    }
    for (const row of formulaGroupRows) {
      for (const field of visibleFields) {
        if (field.fieldType === "created_at") row.values[field.fieldKey] = row.createdAt.toISOString();
      }
    }
    const groupingLinkedInputs = await mergeLinkedFormulaInputsBatched({
      entityId,
      pageId: formulaPageId,
      rows: formulaGroupRows.map((row) => ({ id: row.id, values: row.values })),
      fields: [...visibleFields, ...visibleDataPageFields],
      permissions: formulaPermissions,
    });
    const groupingEntityValues = materializeVisibleEntityFormulas({
      entityId,
      rows: formulaGroupRows.map((row) => ({ id: row.id, values: row.values })),
      fields: visibleFields,
      hidden,
      pageId: formulaPageId,
      pageValues: formulaGroupPageValues,
      pageFields: dataPageFormulaContext.fields,
      hiddenPage: dataPageFormulaContext.hidden,
      linkedInputs: groupingLinkedInputs,
      formulaOptions,
    });
    const groupingPageValues = formulaPageId == null
      ? new Map<number, Record<string, unknown>>()
      : materializeVisiblePageFormulas({
          entityId,
          pageId: formulaPageId,
          rows: formulaGroupRows.map((row) => ({
            id: row.id,
            entityValues: row.values,
            pageValues: formulaGroupPageValues.get(row.id) ?? {},
          })),
          entityFields: visibleFields,
          pageFields: dataPageFormulaContext.fields,
          hiddenEntity: hidden,
          hiddenPage: dataPageFormulaContext.hidden,
          linkedInputs: groupingLinkedInputs,
          formulaOptions,
        });
    const groupingRows = formulaGroupRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      entityValues: groupingEntityValues.get(row.id) ?? row.values,
      pageValues: formulaPageId == null
        ? undefined
        : new Map([[
            formulaPageId,
            groupingPageValues.get(row.id) ?? formulaGroupPageValues.get(row.id) ?? {},
          ]]),
    }));
    formulaGroupWinners = formulaGroupResultWinners(groupingRows, entityGroupConfigs);
    pageFormulaGroupWinners = formulaGroupResultWinners(groupingRows, pageGroupConfigs);
    dataFormulaValues = applyFormulaGroupResults(dataFormulaValues, formulaGroupWinners);
  }
  let dataPageFormulaValues = materializeVisiblePageFormulas({
    entityId,
    pageId: formulaPageId ?? 0,
    rows: data.map((row) => ({
      id: row.id,
      entityValues: (row.valuesJson ?? {}) as Record<string, unknown>,
      pageValues: dataPageFormulaContext.values.get(row.id) ?? {},
    })),
    entityFields: visibleFields,
    pageFields: dataPageFormulaContext.fields,
    hiddenEntity: hidden,
    hiddenPage: dataPageFormulaContext.hidden,
    linkedInputs: dataLinkedInputs,
    formulaOptions,
  });
  dataPageFormulaValues = applyFormulaGroupResults(
    dataPageFormulaValues,
    pageFormulaGroupWinners,
  );
  const visiblePageFormulaKeys = new Set(visibleDataPageFields
    .filter((field) => field.fieldType === "function")
    .map((field) => field.fieldKey));
  const presentedPageFormulaValues: Record<string, Record<string, unknown>> = {};
  if (formulaPageId != null && visiblePageFormulaKeys.size > 0) {
    for (const [recordId, values] of dataPageFormulaValues) {
      presentedPageFormulaValues[String(recordId)] = Object.fromEntries(
        Object.entries(values).filter(([key]) => visiblePageFormulaKeys.has(key)),
      );
    }
  }

  // Row → group-key map for the returned page (same key space as RecordGroup.key,
  // null = the "no value" group). Computed with the SAME key expression the
  // buckets use so client partitioning lines up exactly. One extra query bounded
  // to the current page.
  let rowGroups: Record<string, string | null> | undefined;
  if (rowGroupKeyExpr) {
    const ids = data.map((r) => r.id);
    rowGroups = {};
    if (ids.length > 0) {
      // NB: the raw fragment must be wrapped in sql`` — a SQL fragment passed
      // directly as a selected field makes Drizzle render its table columns
      // UNQUALIFIED ("id"), which inside the correlated subquery resolves to
      // rl.id instead of entity_records.id and silently yields NULL keys.
      const keyed = await db
        .select({ id: entityRecordsTable.id, k: sql<string | null>`${rowGroupKeyExpr}` })
        .from(entityRecordsTable)
        .where(inArray(entityRecordsTable.id, ids));
      for (const row of keyed) {
        const raw = (row as { k: unknown }).k;
        rowGroups[String(row.id)] = raw == null || raw === "" ? null : String(raw);
      }
    }
  }

  // Column totals: sum each visible numeric field flagged showColumnTotal over the
  // FULL filtered set (every page), not just the current page. Non-numeric stored
  // text is skipped so an unguarded ::numeric cast can never error.
  const NUMERIC_RE = "^-?[0-9]+(\\.[0-9]+)?$";
  const totalFields = visibleFields.filter((f) => f.fieldType === "number" && f.showColumnTotal);
  // Percent fields aggregate as the AVERAGE over records that have a numeric value
  // (empties are ignored, not counted as 0). `percentFields` (ALL percent columns)
  // feeds the per-group averages, which are always shown; `percentTotalFields` is
  // the showColumnTotal-gated subset for the flat totals row (общий результат),
  // which — like number/formula totals — is opt-in per field.
  const percentFields = visibleFields.filter((f) => f.fieldType === "percent");
  const percentTotalFields = percentFields.filter((f) => f.showColumnTotal);
  // Function (formula) fields can also opt into a column total. Their value is not
  // stored, so we evaluate the formula per row over the FULL filtered set and sum
  // the finite numeric results (non-numeric/error rows contribute nothing).
  const formulaTotalFields = visibleFields.filter(
    (f) => f.fieldType === "function" && f.showColumnTotal,
  );
  let numericTotals: Record<string, number> | undefined;
  if (totalFields.length > 0 || percentTotalFields.length > 0) {
    const sel: Record<string, SQL<number>> = {};
    for (const f of totalFields) {
      const k = f.fieldKey;
      sel[k] = sql<number>`COALESCE(SUM(CASE WHEN (${entityRecordsTable.valuesJson} ->> ${k}) ~ ${NUMERIC_RE} THEN (${entityRecordsTable.valuesJson} ->> ${k})::numeric ELSE 0 END), 0)::float8`;
    }
    for (const f of percentTotalFields) {
      const k = f.fieldKey;
      // NULL for non-numeric/empty rows so AVG skips them (average only over filled).
      sel[k] = sql<number>`AVG(CASE WHEN (${entityRecordsTable.valuesJson} ->> ${k}) ~ ${NUMERIC_RE} THEN (${entityRecordsTable.valuesJson} ->> ${k})::numeric ELSE NULL END)::float8`;
    }
    const [row] = await db.select(sel).from(entityRecordsTable).where(where);
    numericTotals = {};
    for (const f of totalFields) {
      numericTotals[f.fieldKey] = Number((row as Record<string, unknown> | undefined)?.[f.fieldKey] ?? 0);
    }
    for (const f of percentTotalFields) {
      const v = (row as Record<string, unknown> | undefined)?.[f.fieldKey];
      if (v == null) continue; // no filled rows → no average to show
      const d = normalizeDecimals(f.percentConfigJson?.decimals);
      const n = Number(v);
      numericTotals[f.fieldKey] = d != null ? Number(n.toFixed(d)) : cleanFpNoise(n);
    }
  }
  if (formulaTotalFields.length > 0) {
    const allRows = await db
      .select({ id: entityRecordsTable.id, values: entityRecordsTable.valuesJson })
      .from(entityRecordsTable)
      .where(where);
    const totalLinkedInputs = await mergeLinkedFormulaInputs({
      entityId,
      pageId: formulaPageId,
      rows: allRows.map((r) => ({ id: r.id, values: projectViewerFormulaValues((r.values ?? {}) as Record<string, unknown>, visibleFields) })),
      fields: [...visibleFields, ...visibleDataPageFields],
      permissions: formulaPermissions,
    });
    const totalCurrentPageValues = new Map<number, Record<string, unknown>>();
    if (formulaPageId != null && allRows.length > 0) {
      const rows = await db
        .select({ recordId: pageRecordValuesTable.recordId, values: pageRecordValuesTable.valuesJson })
        .from(pageRecordValuesTable)
        .where(and(eq(pageRecordValuesTable.pageId, formulaPageId), inArray(pageRecordValuesTable.recordId, allRows.map((row) => row.id))));
          for (const row of rows) totalCurrentPageValues.set(
            row.recordId,
            projectViewerFormulaValues((row.values ?? {}) as Record<string, unknown>, visibleDataPageFields),
          );
    }
    numericTotals = numericTotals ?? {};
    const totalPageFormulaDefs = visibleDataPageFields
      .filter((field) => field.fieldType === "function")
      .map(toFormulaDef);
    for (const f of formulaTotalFields) {
      const cfg = f.formulaConfigJson as { expression?: string; decimals?: number | null } | null;
      const expr = (cfg?.expression ?? "").trim();
      if (!expr) continue;
      const d = normalizeDecimals(cfg?.decimals);
      let sum = 0;
      for (const r of allRows) {
        const winners = formulaGroupWinners.get(f.fieldKey);
        if (winners && !winners.has(r.id)) continue;
        // Resolver inputs and aliases were assembled only from fields visible to
        // this viewer. Raw hidden values may exist in storage, but cannot become a
        // formula capability through a total.
        const vals = totalLinkedInputs.get(r.id) ?? projectViewerFormulaValues(
          (r.values as Record<string, unknown> | null) ?? {},
          visibleFields,
        );
        try {
          const out = evaluateFormula(expr, buildQualifiedFormulaScope({
            entityId,
            entityValues: vals,
            entityFormulas: entityFormulaDefs,
            pageId: formulaPageId,
            pageValues: totalCurrentPageValues.get(r.id),
            pageFormulas: totalPageFormulaDefs,
            formulaOptions,
          }), formulaOptions);
          if (typeof out === "number" && Number.isFinite(out)) {
            // Round EACH per-row result to the field's configured decimals before
            // summing, so the total equals the sum of the values the user actually
            // sees per row (the client renders each cell via toFixed(decimals)).
            // Summing raw then rounding once at the end would let `round(Σ raw)`
            // drift from `Σ round(row)` and show a total that doesn't match the
            // visible column.
            sum += d != null ? Number(out.toFixed(d)) : cleanFpNoise(out);
          }
        } catch {
          // Skip rows whose formula fails to parse/evaluate.
        }
      }
      numericTotals[f.fieldKey] = d != null ? Number(sum.toFixed(d)) : cleanFpNoise(sum);
    }
  }

  // Page-local column totals (number + formula) when this table is rendered
  // inside a page. Page-local fields live in `page_fields` and their values in
  // `page_record_values` (keyed by pageId+recordId), separate from the entity's
  // own data — so the entity totals above never see them. A page formula field
  // references the MERGED row ({...entityValues, ...pageValues}); we reproduce
  // that merge here. Totals are gated by per-viewer page-field visibility (a
  // field hidden for the viewer never gets a total), but — like the entity
  // formula totals above — evaluate over the full underlying values for
  // correctness. Mirror pages are covered because `where` is built over the
  // page's effective (mirrored) entity.
  const totalsPageId = formulaPageId;
  if (totalsPageId != null) {
    const roleIds = await getUserRoleIds(req);
    // Cross-formula resolution needs EVERY active page formula field for this
    // page — a total-enabled page formula may reference another page formula that
    // is NOT itself total-enabled — so pull them independently of the
    // showColumnTotal gate applied to the totals subset below.
    const pageAllFormulaRows = await db
      .select({
        fieldKey: pageFieldsTable.fieldKey,
        formulaConfigJson: pageFieldsTable.formulaConfigJson,
        permissionsJson: pageFieldsTable.permissionsJson,
      })
      .from(pageFieldsTable)
      .where(
        and(
          eq(pageFieldsTable.pageId, totalsPageId),
          eq(pageFieldsTable.isActive, true),
          eq(pageFieldsTable.fieldType, "function"),
        ),
      );
    const visiblePageAllFormulaRows = pageAllFormulaRows.filter(
      (pf) => mostPermissiveFieldPerm(pf.permissionsJson, roleIds, "view", perms, entityId, totalsPageId) !== "hidden",
    );
    // Flat totals row (общий результат) is opt-in per field, so only pull page
    // fields flagged showColumnTotal. Percent columns average (not sum) but are
    // still gated by the same flag here; their ALWAYS-shown per-group averages
    // are computed separately in the grouping pass below.
    const pageFieldRows = await db
      .select()
      .from(pageFieldsTable)
      .where(
        and(
          eq(pageFieldsTable.pageId, totalsPageId),
          eq(pageFieldsTable.isActive, true),
          eq(pageFieldsTable.showColumnTotal, true),
        ),
      );
    const pageTotalFields = pageFieldRows.filter(
      (pf) =>
        (pf.fieldType === "number" || pf.fieldType === "function") &&
        mostPermissiveFieldPerm(pf.permissionsJson, roleIds, "view", perms, entityId, totalsPageId) !== "hidden",
    );
    // Percent page fields flagged showColumnTotal: average over records WITH a value.
    const pagePercentFields = pageFieldRows.filter(
      (pf) =>
        pf.fieldType === "percent" &&
        mostPermissiveFieldPerm(pf.permissionsJson, roleIds, "view", perms, entityId, totalsPageId) !== "hidden",
    );
    // page_ref columns flagged showColumnTotal whose SOURCE is numeric: totals
    // read the source page's values, so the same double boundary as value
    // merging applies (source-page access + source field visibility; setup
    // admins pass). number sums, percent averages — matching the source type.
    const pageRefTotalTargets: { pf: PageField; srcPageId: number; srcKey: string; srcType: string; srcPercentDecimals: number | null | undefined }[] = [];
    {
      const totalsSetupAdmin = perms.superAdmin || perms.admin.pages;
      for (const pf of pageFieldRows) {
        if (pf.fieldType !== "page_ref") continue;
        if (mostPermissiveFieldPerm(pf.permissionsJson, roleIds, "view", perms, entityId, totalsPageId) === "hidden") continue;
        const cfg = (pf.pageRefConfigJson ?? {}) as PageRefFieldConfig;
        const src = await loadPageRefSource(cfg);
        if (!src || (src.fieldType !== "number" && src.fieldType !== "percent")) continue;
        if (!totalsSetupAdmin) {
          if (!perms.pageIds.includes(cfg.sourcePageId!)) continue;
          if (mostPermissiveFieldPerm(src.permissionsJson, roleIds, "view", perms, entityId, cfg.sourcePageId!) === "hidden") continue;
        }
        pageRefTotalTargets.push({
          pf,
          srcPageId: cfg.sourcePageId!,
          srcKey: cfg.sourceFieldKey!,
          srcType: src.fieldType,
          srcPercentDecimals: src.percentConfigJson?.decimals,
        });
      }
    }
    if (pageTotalFields.length > 0 || pagePercentFields.length > 0 || pageRefTotalTargets.length > 0) {
      const recRows = await db
        .select({ id: entityRecordsTable.id, values: entityRecordsTable.valuesJson })
        .from(entityRecordsTable)
        .where(where);
      const pageLinkedInputs = await mergeLinkedFormulaInputs({
        entityId,
        pageId: totalsPageId,
        rows: recRows.map((r) => ({ id: r.id, values: projectViewerFormulaValues((r.values ?? {}) as Record<string, unknown>, visibleFields) })),
        fields: [
          ...visibleFields,
          ...pageFieldRows.filter((pf) => mostPermissiveFieldPerm(pf.permissionsJson, roleIds, "view", perms, entityId, totalsPageId) !== "hidden"),
          ...visiblePageAllFormulaRows.map((r) => ({ ...r, fieldType: "function" })),
        ],
        permissions: formulaPermissions,
      });
      const ids = recRows.map((r) => r.id);
      const pvRows =
        ids.length > 0
          ? await db
              .select({ recordId: pageRecordValuesTable.recordId, values: pageRecordValuesTable.valuesJson })
              .from(pageRecordValuesTable)
              .where(and(eq(pageRecordValuesTable.pageId, totalsPageId), inArray(pageRecordValuesTable.recordId, ids)))
          : [];
      const pvByRecord = new Map<number, Record<string, unknown>>();
      for (const r of pvRows) pvByRecord.set(
        r.recordId,
        projectViewerFormulaValues(
          (r.values as Record<string, unknown> | null) ?? {},
          visibleDataPageFields,
        ),
      );
      // page_ref totals read the SOURCE page's values — one map per source page.
      const srcPvByPage = new Map<number, Map<number, Record<string, unknown>>>();
      if (ids.length > 0) {
        for (const spid of [...new Set(pageRefTotalTargets.map((t) => t.srcPageId))]) {
          const rows = await db
            .select({ recordId: pageRecordValuesTable.recordId, values: pageRecordValuesTable.valuesJson })
            .from(pageRecordValuesTable)
            .where(and(eq(pageRecordValuesTable.pageId, spid), inArray(pageRecordValuesTable.recordId, ids)));
          const m = new Map<number, Record<string, unknown>>();
          for (const r of rows) m.set(r.recordId, (r.values as Record<string, unknown> | null) ?? {});
          srcPvByPage.set(spid, m);
        }
      }
      numericTotals = numericTotals ?? {};
      // Page-local formulas evaluate over {entity ∪ page} values and may reference
      // either entity or page formula fields by key.
      for (const pf of pageTotalFields) {
        // Namespace page totals by the stable page-field id (`pf:<id>`) so they
        // can never collide with an entity field that happens to share the same
        // fieldKey — a flat key would silently overwrite one of the two totals.
        const totalKey = `pf:${pf.id}`;
        if (pf.fieldType === "number") {
          let sum = 0;
          for (const r of recRows) {
            const raw = (pvByRecord.get(r.id) ?? {})[pf.fieldKey];
            if (typeof raw === "number" && Number.isFinite(raw)) sum += raw;
            else if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) sum += Number(raw);
          }
          numericTotals[totalKey] = sum;
        } else {
          const cfg = pf.formulaConfigJson as { expression?: string; decimals?: number | null } | null;
          const expr = (cfg?.expression ?? "").trim();
          if (!expr) continue;
          const d = normalizeDecimals(cfg?.decimals);
          let sum = 0;
          for (const r of recRows) {
            const winners = pageFormulaGroupWinners.get(pf.fieldKey);
            if (winners && !winners.has(r.id)) continue;
            try {
              const out = evaluateFormula(expr, buildQualifiedFormulaScope({
                entityId,
                entityValues: pageLinkedInputs.get(r.id) ?? ((r.values as Record<string, unknown> | null) ?? {}),
                entityFormulas: entityFormulaDefs,
                pageId: totalsPageId,
                pageValues: pvByRecord.get(r.id) ?? {},
                pageFormulas: visiblePageAllFormulaRows.map(toFormulaDef),
                formulaOptions,
              }), formulaOptions);
              // Round each per-row result to the configured decimals before summing
              // so the total matches the sum of the per-row values the user sees.
              if (typeof out === "number" && Number.isFinite(out)) sum += d != null ? Number(out.toFixed(d)) : cleanFpNoise(out);
            } catch {
              // Skip rows whose formula fails to parse/evaluate.
            }
          }
          numericTotals[totalKey] = d != null ? Number(sum.toFixed(d)) : cleanFpNoise(sum);
        }
      }
      // Percent page fields: arithmetic mean over records that HAVE a value
      // (empties ignored). Always shown (not gated by showColumnTotal).
      for (const pf of pagePercentFields) {
        const totalKey = `pf:${pf.id}`;
        const d = normalizeDecimals(pf.percentConfigJson?.decimals);
        let sum = 0;
        let count = 0;
        for (const r of recRows) {
          const raw = (pvByRecord.get(r.id) ?? {})[pf.fieldKey];
          let n: number | null = null;
          if (typeof raw === "number" && Number.isFinite(raw)) n = raw;
          else if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) n = Number(raw);
          if (n != null) {
            sum += n;
            count += 1;
          }
        }
        if (count > 0) {
          const avg = sum / count;
          numericTotals[totalKey] = d != null ? Number(avg.toFixed(d)) : cleanFpNoise(avg);
        }
      }
      // page_ref totals: aggregate the SOURCE page's values under this page's
      // column key — number sources sum, percent sources average filled rows.
      for (const t of pageRefTotalTargets) {
        const totalKey = `pf:${t.pf.id}`;
        const m = srcPvByPage.get(t.srcPageId) ?? new Map<number, Record<string, unknown>>();
        if (t.srcType === "number") {
          let sum = 0;
          for (const r of recRows) {
            const raw = (m.get(r.id) ?? {})[t.srcKey];
            if (typeof raw === "number" && Number.isFinite(raw)) sum += raw;
            else if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) sum += Number(raw);
          }
          numericTotals[totalKey] = sum;
        } else {
          const d = normalizeDecimals(t.srcPercentDecimals);
          let sum = 0;
          let count = 0;
          for (const r of recRows) {
            const raw = (m.get(r.id) ?? {})[t.srcKey];
            let n: number | null = null;
            if (typeof raw === "number" && Number.isFinite(raw)) n = raw;
            else if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) n = Number(raw);
            if (n != null) {
              sum += n;
              count += 1;
            }
          }
          if (count > 0) {
            const avg = sum / count;
            numericTotals[totalKey] = d != null ? Number(avg.toFixed(d)) : cleanFpNoise(avg);
          }
        }
      }
    }
  }

  // Group buckets: one JS pass over the FULL filtered set (WITHOUT the
  // groupValue narrowing — expanding one group must still return every bucket).
  // Sums follow the exact numericTotals semantics: only columns flagged
  // showColumnTotal, evaluated over the RAW stored values INCLUDING fields
  // hidden for this viewer (the true-total product decision above), with
  // per-row rounding for formula fields — so a group's sum always reconciles
  // with the flat column total.
  let groups:
    | { key: string | null; label: string | null; count: number; sums: Record<string, number> }[]
    | undefined;
  if (wantGroups && groupField) {
    const groupsWhere = and(...groupsClauses)!;
    const keyExpr = groupRelMeta
      ? relationLinkedIdScalar(groupRelMeta)
      : groupField.fieldType === "created_at"
        ? // System date: group by the record's creation DAY (UTC), not the full timestamp.
          sql`to_char(${entityRecordsTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`
        : sql`(${entityRecordsTable.valuesJson} ->> ${groupField.fieldKey})`;
    // Label boundary: the projected linked-field value is only selected when the
    // viewer may see it on the linked entity (groupLabelAllowed); otherwise the
    // label is withheld and the client falls back to the opaque key.
    const labelExpr = groupRelMeta
      ? groupLabelAllowed
        ? relationValueScalar(groupRelMeta)
        : sql`NULL`
      : keyExpr;

    // Relation/lookup columns can carry a group-common value too. The displayed
    // value is the projected relatedFieldKey, which must pass the FULL
    // linked-entity boundary before it is selected at all:
    //   - entity view permission on the linked entity,
    //   - projected field active and not hidden for this viewer,
    //   - NO row-level restrictions on the linked entity (own-scope or hidden
    //     row statuses) — the raw scalar projection cannot re-apply per-row
    //     visibility, so any row restriction skips the column entirely.
    const gCommonRoleIds = await getUserRoleIds(req);
    const relCommonCols: { fieldKey: string; meta: RelationFilterMeta }[] = [];
    {
      const relFields = visibleFields.filter(
        (f) => (f.fieldType === "relation" || f.fieldType === "lookup") && relationMeta.has(f.fieldKey),
      );
      if (relFields.length > 0) {
        const relIds = [...new Set(relFields.map((f) => relationMeta.get(f.fieldKey)!.relationId))];
        const relRows = await db.select().from(relationsTable).where(inArray(relationsTable.id, relIds));
        const relById = new Map(relRows.map((r) => [r.id, r]));
        // Resolve each column's linked entity, then batch-load the projected
        // fields in ONE query (no per-column round trip).
        const wanted: { fieldKey: string; meta: RelationFilterMeta; relatedEntityId: number }[] = [];
        for (const f of relFields) {
          const meta = relationMeta.get(f.fieldKey)!;
          const rel = relById.get(meta.relationId);
          if (!rel) continue;
          const relatedEntityId = meta.direction === "source" ? rel.targetEntityId : rel.sourceEntityId;
          if (!canRecord(perms, relatedEntityId, "view")) continue;
          if (effectiveScope(perms, relatedEntityId).scope !== "all") continue;
          if (effectiveStatusVisibility(perms, relatedEntityId).hiddenRowStatusIds.length > 0) continue;
          wanted.push({ fieldKey: f.fieldKey, meta, relatedEntityId });
        }
        if (wanted.length > 0) {
          const relatedFieldRows = await db
            .select()
            .from(entityFieldsTable)
            .where(
              and(
                inArray(entityFieldsTable.entityId, [...new Set(wanted.map((w) => w.relatedEntityId))]),
                inArray(entityFieldsTable.fieldKey, [...new Set(wanted.map((w) => w.meta.relatedFieldKey))]),
                eq(entityFieldsTable.isActive, true),
              ),
            );
          const relatedFieldByPair = new Map(relatedFieldRows.map((rf) => [`${rf.entityId}\u0000${rf.fieldKey}`, rf]));
          for (const w of wanted) {
            const relatedField = relatedFieldByPair.get(`${w.relatedEntityId}\u0000${w.meta.relatedFieldKey}`);
            if (!relatedField || resolveFieldAccess(relatedField, perms, gCommonRoleIds, w.relatedEntityId) === "hidden")
              continue;
            relCommonCols.push({ fieldKey: w.fieldKey, meta: w.meta });
          }
        }
      }
    }
    const relValSel: Record<string, SQL<string | null>> = {};
    for (const rc of relCommonCols) {
      relValSel[`relval__${rc.fieldKey}`] = sql<string | null>`${relationValueScalar(rc.meta)}`;
    }

    const gRows = await db
      .select({
        id: entityRecordsTable.id,
        values: entityRecordsTable.valuesJson,
        createdAt: entityRecordsTable.createdAt,
        statusId: entityRecordsTable.statusId,
        gkey: sql<string | null>`${keyExpr}`,
        glabel: sql<string | null>`${labelExpr}`,
        ...relValSel,
      })
      .from(entityRecordsTable)
      .where(groupsWhere);

    // Page-local columns, gated by per-viewer page-field visibility exactly
    // like the flat totals above. Sum columns = number/function flagged
    // showColumnTotal; the rest of the value-backed visible ones participate in
    // the group-common-value pass instead.
    const gPageId = formulaPageId;
    const gRoleIds = gCommonRoleIds;
    const gPfRows = gPageId == null
      ? []
      : await db
          .select()
          .from(pageFieldsTable)
          .where(and(eq(pageFieldsTable.pageId, gPageId), eq(pageFieldsTable.isActive, true)));
    const gPfVisible = gPfRows.filter(
      (pf) => mostPermissiveFieldPerm(pf.permissionsJson, gRoleIds, "view", perms, entityId, gPageId) !== "hidden",
    );
    const groupLinkedInputs = await mergeLinkedFormulaInputs({
      entityId,
      pageId: gPageId,
      rows: gRows.map((r) => ({ id: r.id, values: projectViewerFormulaValues((r.values ?? {}) as Record<string, unknown>, visibleFields) })),
      fields: [...visibleFields, ...gPfVisible],
      permissions: formulaPermissions,
    });
    const gPfSumFields = gPfVisible.filter(
      (pf) => pf.showColumnTotal && (pf.fieldType === "number" || pf.fieldType === "function"),
    );
    const gPfSumIds = new Set(gPfSumFields.map((pf) => pf.id));
    // Page-local percent fields: always averaged per group (not gated by showColumnTotal).
    const gPfPercentFields = gPfVisible.filter((pf) => pf.fieldType === "percent");
    // Value-backed page-local fields for the common-value pass (relation/lookup
    // page fields resolve via record links, file values are objects — skip both;
    // percent goes through the average pass, not the common-value pass).
    const PF_COMMON_SKIP = new Set(["relation", "lookup", "file", "page_ref"]);
    const gPfScalarCommon = gPfVisible.filter(
      (pf) =>
        !gPfSumIds.has(pf.id) &&
        pf.fieldType !== "function" &&
        pf.fieldType !== "percent" &&
        !PF_COMMON_SKIP.has(pf.fieldType),
    );
    const gPfFormulaCommon = gPfVisible.filter((pf) => !gPfSumIds.has(pf.id) && pf.fieldType === "function");
    // page_ref columns in groups: numeric sources sum/average like their source
    // type (sum gated by showColumnTotal, percent always averaged — matching the
    // ordinary page-field rules); everything else joins the common-value pass.
    // Same double boundary as value merging (source page + source field perms).
    const gPfRefTargets: { pf: PageField; srcPageId: number; srcKey: string; srcType: string; srcPercentDecimals: number | null | undefined }[] = [];
    {
      const gSetupAdmin = perms.superAdmin || perms.admin.pages;
      for (const pf of gPfVisible) {
        if (pf.fieldType !== "page_ref") continue;
        const cfg = (pf.pageRefConfigJson ?? {}) as PageRefFieldConfig;
        const src = await loadPageRefSource(cfg);
        if (!src) continue;
        if (!gSetupAdmin) {
          if (!perms.pageIds.includes(cfg.sourcePageId!)) continue;
          if (mostPermissiveFieldPerm(src.permissionsJson, gCommonRoleIds, "view", perms, entityId, cfg.sourcePageId!) === "hidden") continue;
        }
        gPfRefTargets.push({
          pf,
          srcPageId: cfg.sourcePageId!,
          srcKey: cfg.sourceFieldKey!,
          srcType: src.fieldType,
          srcPercentDecimals: src.percentConfigJson?.decimals,
        });
      }
    }
    const gPfRefSum = gPfRefTargets.filter((t) => t.srcType === "number" && t.pf.showColumnTotal);
    const gPfRefPercent = gPfRefTargets.filter((t) => t.srcType === "percent");
    const gPfRefCommon = gPfRefTargets.filter((t) => t.srcType !== "number" && t.srcType !== "percent");
    // Cross-formula resolution scope for the grouped page: entity formulas ∪ this
    // page's formula fields (page formulas evaluate over {entity ∪ page} values).
    // Source-page value maps for page_ref group columns (one per source page).
    const gSrcPvByPage = new Map<number, Map<number, Record<string, unknown>>>();
    if (gPfRefTargets.length > 0 && gRows.length > 0) {
      for (const spid of [...new Set(gPfRefTargets.map((t) => t.srcPageId))]) {
        const rows = await db
          .select({ recordId: pageRecordValuesTable.recordId, values: pageRecordValuesTable.valuesJson })
          .from(pageRecordValuesTable)
          .where(
            and(
              eq(pageRecordValuesTable.pageId, spid),
              inArray(
                pageRecordValuesTable.recordId,
                gRows.map((r) => r.id),
              ),
            ),
          );
        const m = new Map<number, Record<string, unknown>>();
        for (const r of rows) m.set(r.recordId, (r.values as Record<string, unknown> | null) ?? {});
        gSrcPvByPage.set(spid, m);
      }
    }
    const gPvByRec = new Map<number, Record<string, unknown>>();
    if (
      (gPfSumFields.length > 0 ||
        gPfScalarCommon.length > 0 ||
        gPfFormulaCommon.length > 0 ||
        gPfPercentFields.length > 0) &&
      gPageId != null &&
      gRows.length > 0
    ) {
      const pv = await db
        .select({ recordId: pageRecordValuesTable.recordId, values: pageRecordValuesTable.valuesJson })
        .from(pageRecordValuesTable)
        .where(
          and(
            eq(pageRecordValuesTable.pageId, gPageId),
            inArray(
              pageRecordValuesTable.recordId,
              gRows.map((r) => r.id),
            ),
          ),
        );
      for (const r of pv) gPvByRec.set(
        r.recordId,
        projectViewerFormulaValues((r.values as Record<string, unknown> | null) ?? {}, gPfVisible),
      );
    }

    // Mirrors the SQL NUMERIC_RE gate: only clean numeric text contributes.
    const NUM_JS_RE = /^-?[0-9]+(\.[0-9]+)?$/;
    const numVal = (raw: unknown): number => {
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string" && NUM_JS_RE.test(raw)) return Number(raw);
      return 0;
    };
    // Like numVal but returns null for empty/non-numeric, so percent averages
    // count only filled rows (an empty cell must not drag the average toward 0).
    const numOrNull = (raw: unknown): number | null => {
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (typeof raw === "string" && NUM_JS_RE.test(raw)) return Number(raw);
      return null;
    };
    // Common-value pass: entity fields with a stored scalar (sum columns are
    // excluded — they already show a sum; relation/lookup go through the
    // boundary-gated relCommonCols projection; file values are objects → skip).
    const sumKeySet = new Set([...totalFields, ...formulaTotalFields].map((f) => f.fieldKey));
    const ENTITY_COMMON_SKIP = new Set(["relation", "lookup", "file"]);
    const gScalarCommon = visibleFields.filter(
      (f) =>
        !sumKeySet.has(f.fieldKey) &&
        f.fieldType !== "function" &&
        f.fieldType !== "percent" &&
        !ENTITY_COMMON_SKIP.has(f.fieldType),
    );
    const gFormulaCommon = visibleFields.filter(
      (f) => !sumKeySet.has(f.fieldKey) && f.fieldType === "function",
    );

    type GroupBucket = {
      key: string | null;
      label: string | null;
      count: number;
      sums: Record<string, number>;
      newestCreatedAtMs: number;
      oldestCreatedAtMs: number;
      // Percent columns aggregate as an average: accumulate the running sum and
      // the count of FILLED rows, then divide once at the end into `sums`.
      pctSum: Record<string, number>;
      pctCnt: Record<string, number>;
      common: Map<string, unknown>;
      mixed: Set<string>;
    };
    const buckets = new Map<string, GroupBucket>();
    // Empty (null/'' /undefined) never yields a common value: a column shows a
    // group value only when EVERY row carries the same NON-empty value.
    const normCommon = (v: unknown): unknown => (v === undefined || v === null || v === "" ? null : v);
    const trackCommon = (b: GroupBucket, colKey: string, raw: unknown, firstRow: boolean) => {
      if (b.mixed.has(colKey)) return;
      const v = normCommon(raw);
      if (firstRow) {
        if (v !== null) b.common.set(colKey, v);
        else b.mixed.add(colKey);
        return;
      }
      const prev = b.common.get(colKey);
      if (prev === undefined || JSON.stringify(prev) !== JSON.stringify(v)) {
        b.mixed.add(colKey);
        b.common.delete(colKey);
      }
    };
    const evalFormulaVal = (
      f: { formulaConfigJson: unknown },
      scope: Record<string, unknown>,
    ): unknown => {
      const cfg = f.formulaConfigJson as { expression?: string; decimals?: number | null } | null;
      const expr = (cfg?.expression ?? "").trim();
      if (!expr) return null;
      try {
        const out = evaluateFormula(expr, scope, formulaOptions);
        if (typeof out === "number" && Number.isFinite(out)) {
          const d = normalizeDecimals(cfg?.decimals);
          return d != null ? Number(out.toFixed(d)) : cleanFpNoise(out);
        }
        return out ?? null;
      } catch {
        return null;
      }
    };
    for (const r of gRows) {
      // Empty string and NULL both mean "no value" — one shared bucket.
      const rawKey = r.gkey == null || r.gkey === "" ? null : r.gkey;
      const mapKey = rawKey === null ? "\u0000" : rawKey;
      let b = buckets.get(mapKey);
      let firstRow = false;
      if (!b) {
        b = {
          key: rawKey,
          label: rawKey === null ? null : groupRelMeta ? (r.glabel ?? null) : rawKey,
          count: 0,
          sums: {},
          newestCreatedAtMs: Number.NEGATIVE_INFINITY,
          oldestCreatedAtMs: Number.POSITIVE_INFINITY,
          pctSum: {},
          pctCnt: {},
          common: new Map(),
          mixed: new Set(),
        };
        buckets.set(mapKey, b);
        firstRow = true;
      }
      b.count += 1;
      const createdAtMs =
        r.createdAt instanceof Date ? r.createdAt.getTime() : Date.parse(String(r.createdAt));
      if (Number.isFinite(createdAtMs)) {
        b.newestCreatedAtMs = Math.max(b.newestCreatedAtMs, createdAtMs);
        b.oldestCreatedAtMs = Math.min(b.oldestCreatedAtMs, createdAtMs);
      }
      const vals = { ...(groupLinkedInputs.get(r.id) ?? ((r.values as Record<string, unknown> | null) ?? {})) };
      // created_at fields carry no stored value — inject the system timestamp so
      // the common-value pass sees it like any other scalar column.
      for (const f of gScalarCommon) {
        if (f.fieldType === "created_at") vals[f.fieldKey] = r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt);
      }
      for (const f of totalFields) b.sums[f.fieldKey] = (b.sums[f.fieldKey] ?? 0) + numVal(vals[f.fieldKey]);
      for (const f of formulaTotalFields) {
        const winners = formulaGroupWinners.get(f.fieldKey);
        if (winners && !winners.has(r.id)) continue;
        const cfg = f.formulaConfigJson as { expression?: string; decimals?: number | null } | null;
        const expr = (cfg?.expression ?? "").trim();
        if (!expr) continue;
        const d = normalizeDecimals(cfg?.decimals);
        try {
          const out = evaluateFormula(expr, buildQualifiedFormulaScope({
            entityId, entityValues: vals, entityFormulas: entityFormulaDefs,
            pageId: gPageId, pageValues: gPvByRec.get(r.id) ?? {},
            pageFormulas: gPfVisible.filter((field) => field.fieldType === "function").map(toFormulaDef), formulaOptions,
          }), formulaOptions);
          if (typeof out === "number" && Number.isFinite(out))
            b.sums[f.fieldKey] = (b.sums[f.fieldKey] ?? 0) + (d != null ? Number(out.toFixed(d)) : cleanFpNoise(out));
        } catch {
          // Skip rows whose formula fails to parse/evaluate.
        }
      }
      for (const pf of gPfSumFields) {
        const totalKey = `pf:${pf.id}`;
        const pvVals = gPvByRec.get(r.id) ?? {};
        if (pf.fieldType === "number") {
          b.sums[totalKey] = (b.sums[totalKey] ?? 0) + numVal(pvVals[pf.fieldKey]);
        } else {
          const winners = pageFormulaGroupWinners.get(pf.fieldKey);
          if (winners && !winners.has(r.id)) continue;
          const cfg = pf.formulaConfigJson as { expression?: string; decimals?: number | null } | null;
          const expr = (cfg?.expression ?? "").trim();
          if (!expr) continue;
          const d = normalizeDecimals(cfg?.decimals);
          try {
            const out = evaluateFormula(expr, buildQualifiedFormulaScope({
              entityId, entityValues: vals, entityFormulas: entityFormulaDefs,
              pageId: gPageId, pageValues: pvVals,
              pageFormulas: gPfVisible.filter((field) => field.fieldType === "function").map(toFormulaDef),
              formulaOptions,
            }), formulaOptions);
            if (typeof out === "number" && Number.isFinite(out))
              b.sums[totalKey] = (b.sums[totalKey] ?? 0) + (d != null ? Number(out.toFixed(d)) : cleanFpNoise(out));
          } catch {
            // Skip rows whose formula fails to parse/evaluate.
          }
        }
      }
      // page_ref group columns read the SOURCE page's value for this record.
      for (const t of gPfRefSum) {
        const k = `pf:${t.pf.id}`;
        b.sums[k] = (b.sums[k] ?? 0) + numVal((gSrcPvByPage.get(t.srcPageId)?.get(r.id) ?? {})[t.srcKey]);
      }
      for (const t of gPfRefPercent) {
        const k = `pf:${t.pf.id}`;
        const n = numOrNull((gSrcPvByPage.get(t.srcPageId)?.get(r.id) ?? {})[t.srcKey]);
        if (n !== null) {
          b.pctSum[k] = (b.pctSum[k] ?? 0) + n;
          b.pctCnt[k] = (b.pctCnt[k] ?? 0) + 1;
        }
      }
      for (const t of gPfRefCommon) {
        trackCommon(b, `pf:${t.pf.id}`, (gSrcPvByPage.get(t.srcPageId)?.get(r.id) ?? {})[t.srcKey], firstRow);
      }
      // Percent averages: accumulate sum + filled-count per group (entity + page-local).
      for (const f of percentFields) {
        const n = numOrNull(vals[f.fieldKey]);
        if (n !== null) {
          b.pctSum[f.fieldKey] = (b.pctSum[f.fieldKey] ?? 0) + n;
          b.pctCnt[f.fieldKey] = (b.pctCnt[f.fieldKey] ?? 0) + 1;
        }
      }
      if (gPfPercentFields.length > 0) {
        const pvVals = gPvByRec.get(r.id) ?? {};
        for (const pf of gPfPercentFields) {
          const k = `pf:${pf.id}`;
          const n = numOrNull(pvVals[pf.fieldKey]);
          if (n !== null) {
            b.pctSum[k] = (b.pctSum[k] ?? 0) + n;
            b.pctCnt[k] = (b.pctCnt[k] ?? 0) + 1;
          }
        }
      }
      // Common-value tracking: stored scalars, evaluated formulas, boundary-gated
      // relation projections and page-local values (keys match the sums keys).
      for (const f of gScalarCommon) trackCommon(b, f.fieldKey, vals[f.fieldKey], firstRow);
      // Common status: the reserved "__status__" key carries the shared statusId
      // when EVERY row in the group has the same non-null status. Rows are
      // already filtered by the row boundary (hiddenRowStatusIds), so any
      // status that reaches here is visible to the viewer.
      trackCommon(b, "__status__", r.statusId, firstRow);
      for (const f of gFormulaCommon) {
        const winners = formulaGroupWinners.get(f.fieldKey);
        trackCommon(b, f.fieldKey, winners && !winners.has(r.id) ? 0 : evalFormulaVal(f, buildQualifiedFormulaScope({
          entityId, entityValues: vals, entityFormulas: entityFormulaDefs,
          pageId: gPageId, pageValues: gPvByRec.get(r.id) ?? {},
          pageFormulas: gPfVisible.filter((field) => field.fieldType === "function").map(toFormulaDef), formulaOptions,
        })), firstRow);
      }
      for (const rc of relCommonCols) {
        trackCommon(b, rc.fieldKey, (r as Record<string, unknown>)[`relval__${rc.fieldKey}`], firstRow);
      }
      if (gPfScalarCommon.length > 0 || gPfFormulaCommon.length > 0) {
        const pvVals = gPvByRec.get(r.id) ?? {};
        for (const pf of gPfScalarCommon) trackCommon(b, `pf:${pf.id}`, pvVals[pf.fieldKey], firstRow);
        for (const pf of gPfFormulaCommon) {
          const winners = pageFormulaGroupWinners.get(pf.fieldKey);
          trackCommon(b, `pf:${pf.id}`, winners && !winners.has(r.id) ? 0 : evalFormulaVal(pf, buildQualifiedFormulaScope({
            entityId, entityValues: vals, entityFormulas: entityFormulaDefs,
            pageId: gPageId, pageValues: pvVals,
            pageFormulas: gPfVisible.filter((field) => field.fieldType === "function").map(toFormulaDef),
            formulaOptions,
          })), firstRow);
        }
      }
    }
    // Final per-group rounding for formula sums (matches the flat totals).
    for (const b of buckets.values()) {
      for (const f of formulaTotalFields) {
        const d = normalizeDecimals((f.formulaConfigJson as { decimals?: number | null } | null)?.decimals);
        if (b.sums[f.fieldKey] != null) b.sums[f.fieldKey] = d != null ? Number(b.sums[f.fieldKey]!.toFixed(d)) : cleanFpNoise(b.sums[f.fieldKey]!);
      }
      for (const pf of gPfSumFields) {
        if (pf.fieldType !== "function") continue;
        const d = normalizeDecimals((pf.formulaConfigJson as { decimals?: number | null } | null)?.decimals);
        const k = `pf:${pf.id}`;
        if (b.sums[k] != null) b.sums[k] = d != null ? Number(b.sums[k]!.toFixed(d)) : cleanFpNoise(b.sums[k]!);
      }
      // Percent columns: divide the running sum by the filled-row count into `sums`
      // (rounded to the field's decimals). Skipped when no row in the group is filled.
      for (const f of percentFields) {
        const cnt = b.pctCnt[f.fieldKey] ?? 0;
        if (cnt > 0) {
          const d = normalizeDecimals(f.percentConfigJson?.decimals);
          const avg = b.pctSum[f.fieldKey]! / cnt;
          b.sums[f.fieldKey] = d != null ? Number(avg.toFixed(d)) : cleanFpNoise(avg);
        }
      }
      for (const pf of gPfPercentFields) {
        const k = `pf:${pf.id}`;
        const cnt = b.pctCnt[k] ?? 0;
        if (cnt > 0) {
          const d = normalizeDecimals(pf.percentConfigJson?.decimals);
          const avg = b.pctSum[k]! / cnt;
          b.sums[k] = d != null ? Number(avg.toFixed(d)) : cleanFpNoise(avg);
        }
      }
      for (const t of gPfRefPercent) {
        const k = `pf:${t.pf.id}`;
        const cnt = b.pctCnt[k] ?? 0;
        if (cnt > 0) {
          const d = normalizeDecimals(t.srcPercentDecimals);
          const avg = b.pctSum[k]! / cnt;
          b.sums[k] = d != null ? Number(avg.toFixed(d)) : cleanFpNoise(avg);
        }
      }
    }
    // Group-list ordering: honor the caller's first sort that is applicable to
    // a GROUP — __created_at__ (the group's newest row), the group field itself
    // (label), a summed column, or a column with a group-common value. Anything
    // else falls back to label A→Z. The empty-key group always sorts last.
    const gSpecSorts = groupRequestedSorts;
    const allBuckets = [...buckets.values()];
    const gSortSpec =
      primaryCreatedAtGroupSort ??
      gSpecSorts.find(
        (s) =>
          s.field !== SYSTEM_SORT_CREATED_AT &&
          (s.field === groupField.fieldKey ||
            allBuckets.some((b) => b.sums[s.field] !== undefined || b.common.has(s.field))),
      );
    const gDir = gSortSpec?.direction === "desc" ? -1 : 1;
    const cmpLabel = (a: GroupBucket, b: GroupBucket) =>
      (a.label ?? a.key ?? "").localeCompare(b.label ?? b.key ?? "", "ru", { numeric: true, sensitivity: "base" });
    const groupSortVal = (b: GroupBucket): unknown =>
      gSortSpec?.field === SYSTEM_SORT_CREATED_AT
        ? gSortSpec.direction === "desc"
          ? b.newestCreatedAtMs
          : b.oldestCreatedAtMs
        : !gSortSpec || gSortSpec.field === groupField.fieldKey
        ? (b.label ?? b.key)
        : b.sums[gSortSpec.field] !== undefined
          ? b.sums[gSortSpec.field]
          : b.common.get(gSortSpec.field);
    groups = allBuckets
      .sort((a, b) => {
        if (a.key === null) return 1;
        if (b.key === null) return -1;
        if (!gSortSpec) return cmpLabel(a, b);
        const av = groupSortVal(a);
        const bv = groupSortVal(b);
        // Groups without a value for the sorted column (mixed/empty) go last.
        if (av == null && bv == null) return cmpLabel(a, b);
        if (av == null) return 1;
        if (bv == null) return -1;
        const an = typeof av === "number" ? av : Number(String(av).trim() === "" ? NaN : av);
        const bn = typeof bv === "number" ? bv : Number(String(bv).trim() === "" ? NaN : bv);
        const c =
          Number.isFinite(an) && Number.isFinite(bn)
            ? an - bn
            : String(av).localeCompare(String(bv), "ru", { numeric: true, sensitivity: "base" });
        return c !== 0 ? c * gDir : cmpLabel(a, b);
      })
      .map((b) => {
        const values: Record<string, unknown> = {};
        for (const [k, v] of b.common) values[k] = v;
        return {
          key: b.key,
          label: b.label,
          count: b.count,
          sums: b.sums,
          ...(Object.keys(values).length > 0 ? { values } : {}),
        };
      });
  }

  res.json({
    data: data.map((r) => presentRecord(
      { ...r, valuesJson: dataFormulaValues.get(r.id) ?? r.valuesJson },
      hidden,
      fields,
    )),
    total: countRow?.count ?? 0,
    ...(Object.keys(presentedPageFormulaValues).length > 0
      ? { pageFormulaValues: presentedPageFormulaValues }
      : {}),
    ...(numericTotals ? { numericTotals } : {}),
    ...(groups ? { groups } : {}),
    ...(rowGroups ? { rowGroups } : {}),
  });
});

// ---- Pivot (Сводная таблица) ------------------------------------------------
// Permission-scoped cross-tab aggregation. Reuses the SAME read boundary as the
// records query (entity scope + filters + archival + own-row + hidden-status +
// page-local filters). Dimensions/measures are restricted to the viewer's
// NON-hidden, pivot-enabled fields so an aggregate can never leak a hidden field.
// Deliberately NOT admin-authoritative (unlike dashboard widgets): the totals
// reflect only what this viewer is permitted to see. The aggregation core itself
// lives in ./pivot-compute (shared with the admin-authoritative dashboard pivot
// widget); here we only build the viewer's read boundary and pass it in.
router.post(
  "/entities/:entityId/records/pivot",
  requireAuth,
  requireRecordParam("view"),
  async (req, res): Promise<void> => {
    const params = PivotEntityRecordsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = PivotEntityRecordsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const { entityId } = params.data;

    const [entity] = await db.select().from(entitiesTable).where(eq(entitiesTable.id, entityId));
    if (!entity) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    if (!entity.pivotEnabled) {
      res.status(400).json({ error: "Pivot mode is not enabled for this entity" });
      return;
    }

    const formulaOptions = await loadFormulaOptions();
    const pivot = body.data.pivot;
    const pageId = body.data.pageId ?? undefined;
    const formulaPageId = await resolvePageFormulaContextId(req, entityId, pageId);

    const fields = await loadActiveFields(entityId);
    const selectedView = await resolveAuthoritativeView({
      req,
      entityId,
      pageId,
      viewId: body.data.viewId,
      allFields: fields,
      requirePivot: body.data.viewId != null,
    });
    if (!selectedView.ok) {
      res.status(selectedView.status).json({ error: selectedView.error });
      return;
    }
    const { hidden } = await fieldAccessContext(req, entityId, fields, pageId);
    const visibleFields = fields.filter((f) => !hidden.has(f.fieldKey));

    // Page-local fields: load once when a page context is supplied. `visiblePl`
    // holds the per-role VISIBLE ones (for dims/measures); the filterable subset
    // (for pageLocalFilters) is derived below, mirroring the records/query rules.
    const roleIds = await getUserRoleIds(req);
    const plPerms = await getPermissions(req);
    const plAll =
      formulaPageId != null
        ? await db
            .select()
            .from(pageFieldsTable)
            .where(and(eq(pageFieldsTable.pageId, formulaPageId), eq(pageFieldsTable.isActive, true)))
        : [];
    const visiblePl = plAll.filter(
      (pf) => mostPermissiveFieldPerm(pf.permissionsJson, roleIds, "view", plPerms, entityId, formulaPageId) !== "hidden",
    );

    // Relation/lookup dims project the SINGLE linked record's value. Built from
    // visibleFields so hidden relation fields are excluded; reused as the
    // records/query read-boundary relation meta below.
    const relationMeta = await buildRelationMeta(entityId, visibleFields);

    // ---- Read boundary (identical to records/query) ----
    const spec: RecordQuerySpec = {
      filters: (body.data.filters ?? []) as FilterCondition[],
      filterConjunction: body.data.filterConjunction,
      statusIds: body.data.statusIds ?? undefined,
      search: body.data.search ?? undefined,
    };
    const built = buildRecordQuery(visibleFields, spec, relationMeta);
    if ("error" in built) {
      res.status(400).json({ error: built.error });
      return;
    }

    const perms = await getPermissions(req);
    const pivotFormulaPermissions = await interactiveFormulaPermissions(req, entityId, formulaPageId);

    // Pivot role visibility. The request's viewId is UNTRUSTED, so we never use its
    // mere presence as the branch condition (that would let a caller dodge the
    // default-pivot gate by sending a bogus viewId). Instead:
    //  - viewId given → load the view, verify it belongs to this entity AND is
    //    visible to the viewer (mirrors the views-list boundary: invisible → 404).
    //    A named pivot view that the viewer may see is its own role gate.
    //  - no viewId → this is the entity DEFAULT pivot, so enforce
    //    defaultPivotJson.visibleRoleIds as a hard boundary.
    // superAdmin always passes; empty/absent visibleRoleIds = everyone with access.
    if (selectedView.view == null) {
      const dpv = (entity.defaultPivotJson as { visibleRoleIds?: number[] } | null)?.visibleRoleIds;
      if (!perms.superAdmin && dpv && dpv.length > 0 && !dpv.some((id) => roleIds.includes(id))) {
        res.status(403).json({ error: "Сводная таблица недоступна для вашей роли" });
        return;
      }
    }

    const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, pageId);
    const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);

    if (!req.user?.guest) await runAutoArchiveSweep(entityId);
    const archived = (body.data.archived ?? "active") as ArchiveFilterValue;

    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
    if (built.where) clauses.push(built.where);
    const archWhere = archivedWhere(archived);
    if (archWhere) clauses.push(archWhere);
    if (scope === "own")
      clauses.push(await ownScopeWhere(entityId, scopeFieldKeys, req.user!.userId, fields));
    const queryHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
    if (queryHiddenRowWhere) clauses.push(queryHiddenRowWhere);

    const pageLocalFilters = (body.data.pageLocalFilters ?? []) as FilterCondition[];
    if (pageLocalFilters.length > 0) {
      if (formulaPageId == null) {
        res.status(400).json({ error: "pageLocalFilters require pageId" });
        return;
      }
      const plFilterByKey = new Map(visiblePl.map((pf) => [pf.fieldKey, pf] as const));
      for (const cond of pageLocalFilters) {
        const pf = plFilterByKey.get(cond.field);
        const target = pf ? await resolvePageLocalFilterTarget(pf, roleIds, plPerms, entityId, formulaPageId) : null;
        if (!target) {
          res.status(400).json({ error: `Unknown or non-filterable page field "${cond.field}"` });
          return;
        }
        const r = buildPageLocalCondition({ ...cond, field: target.exprKey }, target.effType, target.exprPageId);
        if ("error" in r) {
          res.status(400).json({ error: r.error });
          return;
        }
        clauses.push(r.sql);
      }
    }

    {
      const cf = await resolveCustomFilterClauses({
        entityId,
        allFields: visibleFields,
        relationMeta,
        picks: (body.data.customFilters ?? []) as CustomFilterPick[],
        pageId: formulaPageId,
        formulaOptions,
        formulaPermissions: pivotFormulaPermissions,
        loadVisiblePageFields: async (requestedPageId) => new Map(
          (requestedPageId === formulaPageId ? visiblePl : []).map((field) => [field.fieldKey, {
            fieldType: field.fieldType,
            formulaConfigJson: field.formulaConfigJson,
          }] as const),
        ),
      });
      if ("error" in cf) {
        res.status(400).json({ error: cf.error });
        return;
      }
      for (const c of cf.clauses) clauses.push(c);
    }

    const where = combineAuthoritativeAndViewerWhere(selectedView.hardWhere, clauses)!;
    // Pivot formula measures are evaluated in JS. Supply their linked inputs in
    // one batch; without this an otherwise declared `{entity:…}`/linked token
    // silently resolved as null in the pivot-only evaluator.
    const pivotRows = await db
      .select({ id: entityRecordsTable.id, values: entityRecordsTable.valuesJson })
      .from(entityRecordsTable)
      .where(where);
    const pivotFormulaInputs = await mergeLinkedFormulaInputsBatched({
      entityId,
      pageId: formulaPageId,
      rows: pivotRows.map((row) => ({ id: row.id, values: projectViewerFormulaValues((row.values ?? {}) as Record<string, unknown>, visibleFields) })),
      fields: [...visibleFields, ...visiblePl],
      permissions: pivotFormulaPermissions,
    });

    const outcome = await computePivot({
      entityId,
      pivot,
      entityFields: visibleFields,
      relationMeta,
      pageFields: visiblePl,
      pageId: formulaPageId,
      where,
      formulaOptions,
      formulaInputs: pivotFormulaInputs,
    });
    if (!outcome.ok) {
      res.status(400).json({ error: outcome.error });
      return;
    }
    res.json(outcome.result);
  },
);

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
    const selectedView = await resolveAuthoritativeView({
      req,
      entityId,
      pageId: body.data.pageId,
      viewId: body.data.viewId,
      allFields: fields,
    });
    if (!selectedView.ok) {
      res.status(selectedView.status).json({ error: selectedView.error });
      return;
    }
    const { hidden } = await fieldAccessContext(req, entityId, fields, body.data.pageId);
    const visibleFields = fields.filter((f) => !hidden.has(f.fieldKey));

    const target = visibleFields.find((f) => f.fieldKey === body.data.field);
    // The real boundary for listing distinct values is field VISIBILITY (hidden) +
    // row scope + hidden statuses, all applied below — `isFilterable` is only a
    // LIVE-bar UI opt-in (which fields surface as interactive dropdowns), NOT a
    // security boundary. The admin view/default-view editor authors persistent
    // filters on ANY visible field (incl. non-filterable lookups), so list values
    // for any field the caller can already see. The live bar only ever requests
    // filterable fields, so this relaxation doesn't change its behavior.
    if (!target) {
      res.status(400).json({ error: `Field not found or not visible: ${body.data.field}` });
      return;
    }

    // Dependent filters: options come from records matching the OTHER active filters.
    // The viewer's AD-HOC picks (`filters`) self-exclude the target field so its own
    // selection can still be widened. The view's HARD filters (`baseFilters`) are kept
    // even on the target field, so a field pinned by the view only offers the value(s)
    // the view permits (never all values). Both sets combine under one conjunction, the
    // same way the records query flattens them.
    const spec: RecordQuerySpec = {
      filters: [
        ...(selectedView.view == null ? (body.data.baseFilters ?? []) : []),
        ...(body.data.filters ?? []).filter((c) => c.field !== body.data.field),
      ],
      filterConjunction: body.data.filterConjunction ?? "and",
      statusIds: body.data.statusIds ?? undefined,
      // SOFT exclusions co-narrow the option list so values only appear if they
      // co-occur with the visible rows. The exclusion ON the target field itself
      // is skipped, so the target's own dropdown still lists every selectable
      // value (mirrors how ad-hoc `filters` self-exclude the target above).
      excludeFilters: ((body.data.excludeFilters ?? []) as {
        field: string;
        values?: string[];
        excludeEmpty?: boolean;
      }[]).filter(
        (ex) => ex.field !== body.data.field,
      ),
      excludeStatusIds: body.data.excludeStatusIds ?? undefined,
      search: body.data.search ?? undefined,
    };
    const relationMeta = await buildRelationMeta(entityId, visibleFields);
    const built = buildRecordQuery(visibleFields, spec, relationMeta);
    if ("error" in built) {
      res.status(400).json({ error: built.error });
      return;
    }

    const perms = await getPermissions(req);
    const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, body.data.pageId);
    const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);
    const archived = (body.data.archived ?? "active") as ArchiveFilterValue;

    // Boundary clauses over the BASE records (entity scope + the OTHER active
    // filters + archival + own-row + hidden-status). These are identical for
    // stored and relation/lookup targets — only the value expression differs.
    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
    if (built.where) clauses.push(built.where);
    const archWhere = archivedWhere(archived);
    if (archWhere) clauses.push(archWhere);
    if (scope === "own") clauses.push(await ownScopeWhere(entityId, scopeFieldKeys, req.user!.userId, fields));
    // Same hard boundary as the records query: dependent-filter options must not
    // leak values that only exist on rows hidden-for-rows for this role.
    const fvHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
    if (fvHiddenRowWhere) clauses.push(fvHiddenRowWhere);

    // Picker search box, applied server-side BEFORE the 500-row limit so a value
    // outside the first 500 distinct values (alphabetically) is still findable.
    const valueSearch = (body.data.valueSearch ?? "").trim();

    const targetMeta = relationMeta.get(body.data.field);
    let values: string[];
    if (targetMeta) {
      // relation/lookup target: the distinct values are the LINKED record's
      // projected field. Join the link + linked record (aliased to avoid the
      // base table) and read its value. Only links reachable from base rows the
      // viewer can see contribute — the same exposure as the rendered column.
      const flt = alias(entityRecordsTable, "flt");
      const frl = alias(recordLinksTable, "frl");
      const baseCol = targetMeta.direction === "source" ? frl.sourceRecordId : frl.targetRecordId;
      const linkedCol = targetMeta.direction === "source" ? frl.targetRecordId : frl.sourceRecordId;
      const valueExpr = sql<string | null>`(${flt.valuesJson} ->> ${targetMeta.relatedFieldKey})`;
      const vsClauses = valueSearch ? [sql`${valueExpr} ILIKE ${"%" + valueSearch + "%"}`] : [];
      const where = combineAuthoritativeAndViewerWhere(
        selectedView.hardWhere,
        [...clauses, ...vsClauses, sql`${valueExpr} IS NOT NULL AND ${valueExpr} <> ''`],
      )!;
      // ORDER BY ordinal (1) — same SELECT DISTINCT constraint as below.
      const rows = await db
        .selectDistinct({ v: valueExpr })
        .from(entityRecordsTable)
        .innerJoin(frl, and(eq(frl.relationId, targetMeta.relationId), eq(baseCol, entityRecordsTable.id)))
        .innerJoin(flt, eq(flt.id, linkedCol))
        .where(where)
        .orderBy(sql`1`)
        .limit(500);
      values = rows.map((r) => r.v).filter((v): v is string => v != null && v !== "");
      // Offer "(empty)" when some visible row has NO linked non-empty value.
      // Skipped while the user is text-searching values.
      if (!valueSearch) {
        const noLink = sql`NOT ${relationValueExists({ relationId: targetMeta.relationId, direction: targetMeta.direction, relatedFieldKey: targetMeta.relatedFieldKey }, (v) => sql`${v} IS NOT NULL AND ${v} <> ''`)}`;
        const [emptyRow] = await db
          .select({ one: sql<number>`1` })
          .from(entityRecordsTable)
          .where(combineAuthoritativeAndViewerWhere(selectedView.hardWhere, [...clauses, noLink])!)
          .limit(1);
        if (emptyRow) values = [EMPTY_FILTER_VALUE, ...values];
      }
    } else {
      // created_at (system date): distinct DAYS from the system column (used by
      // the date filter popover to enable days); other fields list stored values.
      const valueExpr =
        target.fieldType === "created_at"
          ? sql<string | null>`to_char(${entityRecordsTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`
          : sql<string | null>`(${entityRecordsTable.valuesJson} ->> ${body.data.field})`;
      const vsClauses = valueSearch ? [sql`${valueExpr} ILIKE ${"%" + valueSearch + "%"}`] : [];
      const where = combineAuthoritativeAndViewerWhere(
        selectedView.hardWhere,
        [...clauses, ...vsClauses, sql`${valueExpr} IS NOT NULL AND ${valueExpr} <> ''`],
      )!;
      // ORDER BY ordinal (1) — for SELECT DISTINCT the order-by expression must match the
      // selected column; re-emitting valueExpr would bind a fresh param and Postgres would
      // reject it as not in the select list.
      const rows = await db
        .selectDistinct({ v: valueExpr })
        .from(entityRecordsTable)
        .where(where)
        .orderBy(sql`1`)
        .limit(500);
      values = rows.map((r) => r.v).filter((v): v is string => v != null && v !== "");
      // Offer "(empty)" when some visible row has no stored value for the field.
      if (!valueSearch) {
        const [emptyRow] = await db
          .select({ one: sql<number>`1` })
          .from(entityRecordsTable)
          .where(combineAuthoritativeAndViewerWhere(
            selectedView.hardWhere,
            [...clauses, sql`(${valueExpr} IS NULL OR ${valueExpr} = '')`],
          )!)
          .limit(1);
        if (emptyRow) values = [EMPTY_FILTER_VALUE, ...values];
      }
    }
    res.json({ values });
  },
);

// Distinct EXISTING values of a filterable page-local field (mirror-page column
// stored in page_record_values, NOT on the entity). Unlike entity filter-values
// this is not dependent on the other active filters — it simply lists the values
// actually present in the table so the filter dropdown never offers a select
// option no record uses. Reuses the records read boundary exactly: view perm
// (requireRecordParam), entity scope, archival, own-row, hidden-row-status, plus
// the page-field per-role visibility gate (a field hidden for this role is
// rejected so its values can't be inferred — superAdmin/pages-admin get NO pass,
// same hard boundary as /records/query's page-local filters).
router.post(
  "/entities/:entityId/records/page-filter-values",
  requireAuth,
  requireRecordParam("view"),
  async (req, res): Promise<void> => {
    const params = GetPageFilterValuesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = GetPageFilterValuesBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const { entityId } = params.data;
    if (!(await entityExists(entityId))) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    const { pageId } = body.data;

    // The target must be an active, filterable, value-backed page field that is
    // not hidden for this caller's roles — identical gate to /records/query.
    const roleIds = await getUserRoleIds(req);
    const fvPerms = await getPermissions(req);
    const plRows = await db
      .select()
      .from(pageFieldsTable)
      .where(and(eq(pageFieldsTable.pageId, pageId), eq(pageFieldsTable.isActive, true)));
    const targetPf = plRows.find((pf) => pf.fieldKey === body.data.field);
    const resolved = targetPf
      ? await resolvePageLocalFilterTarget(targetPf, roleIds, fvPerms, entityId, pageId)
      : null;
    if (!resolved) {
      res.status(400).json({ error: `Field is not a filterable page field: ${body.data.field}` });
      return;
    }
    // For page_ref the VALUE lives on the source page under the source key —
    // all value reads below go through the resolved (pageId, key) pair.
    const valPageId = resolved.exprPageId;
    const valKey = resolved.exprKey;

    const fields = await loadActiveFields(entityId);
    const selectedView = await resolveAuthoritativeView({
      req,
      entityId,
      pageId,
      viewId: body.data.viewId,
      allFields: fields,
    });
    if (!selectedView.ok) {
      res.status(selectedView.status).json({ error: selectedView.error });
      return;
    }
    const perms = await getPermissions(req);
    const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, pageId);
    const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);
    const archived = (body.data.archived ?? "active") as ArchiveFilterValue;

    // Value lives in page_record_values keyed by (pageId, recordId). INNER JOIN so
    // only records that actually carry a page value contribute (= "in the table").
    const valueExpr = sql<string | null>`(${pageRecordValuesTable.valuesJson} ->> ${valKey})`;
    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
    const archWhere = archivedWhere(archived);
    if (archWhere) clauses.push(archWhere);
    if (scope === "own") clauses.push(await ownScopeWhere(entityId, scopeFieldKeys, req.user!.userId, fields));
    const pfvHiddenRowWhere = hiddenRowStatusWhere(hiddenRowStatusIds);
    if (pfvHiddenRowWhere) clauses.push(pfvHiddenRowWhere);
    // Boundary-only clauses (no value predicates) — reused for the "(empty)" probe below.
    const pfBoundaryClauses = [...clauses];
    clauses.push(sql`${valueExpr} IS NOT NULL AND ${valueExpr} <> ''`);
    // Same server-side picker search as entity filter-values (pre-limit).
    const pfValueSearch = (body.data.valueSearch ?? "").trim();
    if (pfValueSearch) clauses.push(sql`${valueExpr} ILIKE ${"%" + pfValueSearch + "%"}`);
    const where = combineAuthoritativeAndViewerWhere(selectedView.hardWhere, clauses)!;

    // ORDER BY ordinal (1) — same SELECT DISTINCT constraint as filter-values:
    // re-emitting valueExpr in ORDER BY would bind a fresh param Postgres rejects.
    const rows = await db
      .selectDistinct({ v: valueExpr })
      .from(entityRecordsTable)
      .innerJoin(
        pageRecordValuesTable,
        and(eq(pageRecordValuesTable.pageId, valPageId), eq(pageRecordValuesTable.recordId, entityRecordsTable.id)),
      )
      .where(where)
      .orderBy(sql`1`)
      .limit(500);

    let values = rows.map((r) => r.v).filter((v): v is string => v != null && v !== "");
    // Offer "(empty)" when some visible record has no stored page value for the
    // field (no page_record_values row at all, or NULL/'' under the key). Uses
    // the same correlated subquery as the page-local `in` filter so semantics
    // match. The selected view's hard boundary stays applied even when probing
    // the target field itself; only caller-supplied ad-hoc target filters self-exclude.
    if (!pfValueSearch) {
      const pfExpr = pageLocalValueExpr(valPageId, valKey);
      const [emptyRow] = await db
        .select({ one: sql<number>`1` })
        .from(entityRecordsTable)
        .where(combineAuthoritativeAndViewerWhere(
          selectedView.hardWhere,
          [...pfBoundaryClauses, sql`(${pfExpr} IS NULL OR ${pfExpr} = '')`],
        )!)
        .limit(1);
      if (emptyRow) values = [EMPTY_FILTER_VALUE, ...values];
    }
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
    const relationMeta = await buildRelationMeta(entityId, visibleFields);
    const built = buildRecordQuery(visibleFields, spec, relationMeta);
    if ("error" in built) {
      res.status(400).json({ error: built.error });
      return;
    }

    const perms = await getPermissions(req);
    const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, body.data.pageId);
    const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);

    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
    if (built.where) clauses.push(built.where);
    const archWhere = archivedWhere("active");
    if (archWhere) clauses.push(archWhere);
    if (scope === "own") clauses.push(await ownScopeWhere(entityId, scopeFieldKeys, req.user!.userId, fields));
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
    const relationMeta = await buildRelationMeta(entityId, visibleFields);
    const built = buildRecordQuery(
      visibleFields,
      {
        filters: parentVals.map((p) => ({ field: p.field, operator: "eq" as const, value: p.value })),
        filterConjunction: "and",
      },
      relationMeta,
    );
    if ("error" in built) {
      res.status(400).json({ error: built.error });
      return;
    }

    const perms = await getPermissions(req);
    const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, body.data.pageId);
    const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);

    // Only rename within the rows this role can actually see — mirror the
    // dependent-values read boundary (active rows, no hidden-status rows, own
    // scope) so a direct API call cannot silently rewrite archived/hidden rows.
    const clauses: SQL[] = [eq(entityRecordsTable.entityId, entityId)];
    if (built.where) clauses.push(built.where);
    const renameArchWhere = archivedWhere("active");
    if (renameArchWhere) clauses.push(renameArchWhere);
    if (scope === "own") clauses.push(await ownScopeWhere(entityId, scopeFieldKeys, req.user!.userId, fields));
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

    type RenamedRow = { id: number; version: number; changedFields: string[] };
    class RenameValidationError extends Error {}
    let renamedRows: RenamedRow[];
    try {
      renamedRows = await db.transaction(async (tx) => {
        // Candidate discovery is intentionally outside the transaction, but all
        // decisions and full-map writes are derived from these stable locked
        // rows. Reapply the scope/value predicate so rows changed out of the
        // candidate set before locking become no-ops.
        const locked = await tx
          .select()
          .from(entityRecordsTable)
          .where(and(where, inArray(entityRecordsTable.id, matches.map((match) => match.id)))!)
          .orderBy(asc(entityRecordsTable.id))
          .for("update");
        const changed: RenamedRow[] = [];
        for (const row of locked) {
          const before = (row.valuesJson as Record<string, unknown>) ?? {};
          let next = { ...before, [target.fieldKey]: newValue };
          if (JSON.stringify(before[target.fieldKey] ?? null) !== JSON.stringify(newValue)) {
            next = clearDependentDescendantValues(next, target.fieldKey, fields);
          }
          const validationError = checkValidationRules(fields, next);
          if (validationError) throw new RenameValidationError(validationError);
          const userRefError = await validateUserRefs(fields, next, tx);
          if (userRefError) throw new RenameValidationError(userRefError);
          const changedFields = diffValues(before, next, fields.map((field) => field.fieldKey))
            .map((change) => change.fieldKey);
          if (changedFields.length === 0) continue;
          const [updated] = await tx.update(entityRecordsTable)
            .set({ valuesJson: next })
            .where(eq(entityRecordsTable.id, row.id))
            .returning({ version: entityRecordsTable.version });
          if (updated) changed.push({ id: row.id, version: updated.version, changedFields });
        }
        return changed;
      });
    } catch (err) {
      if (err instanceof RenameValidationError) {
        res.status(422).json({ error: err.message });
        return;
      }
      if (err instanceof UserReferenceBusyError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    const userId = req.user!.userId;
    await writeAudit(
      renamedRows.map((row) => ({
        entityId,
        recordId: row.id,
        userId,
        fieldKey: target.fieldKey,
        oldValue: auditStr(oldValue),
        newValue: auditStr(newValue),
      })),
      req.log,
    );
    if (renamedRows.length > 0) {
      await emitEvent(renamedRows.map((row) => ({
        eventName: EVENT_RECORD_UPDATED,
        entityId,
        recordId: row.id,
        payload: {
          actorUserId: userId,
          changedFields: row.changedFields,
          version: row.version,
        },
      })), req.log);
    }

    res.json({ updated: renamedRows.length });
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
  if (body.data.statusId !== undefined) {
    const [statusPolicy] = await db
      .select({
        policy: entitiesTable.statusManualEditPolicy,
        userIds: entitiesTable.statusManualEditUserIds,
      })
      .from(entitiesTable)
      .where(eq(entitiesTable.id, entityId))
      .limit(1);
    if (statusPolicy && isManualStatusEditDisabled(statusPolicy.policy, statusPolicy.userIds, req.user!.userId)) {
      res.status(403).json({ error: "Manual status editing is disabled for this user" });
      return;
    }
  }

  // Page-level create ban (pages.disableCreate): role-independent hard stop for
  // creates issued FROM that page. Other pages of the same entity are unaffected.
  if (body.data.pageId != null) {
    const [crPage] = await db
      .select({ disableCreate: pagesTable.disableCreate })
      .from(pagesTable)
      .where(eq(pagesTable.id, body.data.pageId));
    if (crPage?.disableCreate) {
      res.status(403).json({ error: "Creating records is disabled on this page" });
      return;
    }
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
  const validationError = checkValidationRules(fields, result.values);
  if (validationError) {
    res.status(422).json({ error: validationError });
    return;
  }

  const mappedCreateStatus = mappedStatusForChangedValues(fields, undefined, result.values);
  if ("error" in mappedCreateStatus) {
    res.status(422).json({ error: mappedCreateStatus.error });
    return;
  }
  if (
    mappedCreateStatus.statusId != null &&
    body.data.statusId !== undefined &&
    body.data.statusId !== mappedCreateStatus.statusId
  ) {
    res.status(422).json({ error: "Selected list value conflicts with the explicitly selected system status" });
    return;
  }

  let statusId: number | null;
  if (mappedCreateStatus.statusId != null) {
    if (!(await statusBelongsToEntity(mappedCreateStatus.statusId, entityId))) {
      res.status(400).json({ error: "Mapped status does not belong to this entity" });
      return;
    }
    // An administrator-configured option mapping is a system side effect of a
    // permitted field write, not an explicit status choice by this user.
    statusId = mappedCreateStatus.statusId;
  } else if (body.data.statusId === undefined) {
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
  // isKey uniqueness is verified inside the write transaction under an advisory lock
  // (per entity) so two concurrent creates can't both pass the check and insert a dup.
  const keyFields = fields.filter((f) => f.isKey);
  let record: typeof entityRecordsTable.$inferSelect;
  try {
    record = await db.transaction(async (tx) => {
      const lockedUserRefError = await validateUserRefs(fields, result.values, tx);
      if (lockedUserRefError) throw new UserReferenceValidationError(lockedUserRefError);
      await lockAndValidateGdriveFileReferences(tx, {}, result.values);
      if (keyFields.length > 0) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${UNIQUE_KEY_LOCK_NS}, ${entityId})`);
        const dup = await checkUniqueKeys(tx, entityId, keyFields, result.values);
        if (dup) throw new UniqueKeyError(dup);
      }
      const [rec] = await tx
        .insert(entityRecordsTable)
        .values({ entityId, valuesJson: result.values, statusId, statusChangedAt: new Date() })
        .returning();
      if (!rec) throw new Error("Failed to create record");
      return rec;
    });
  } catch (err) {
    if (err instanceof UniqueKeyError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof DriveFileTombstonedError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof UserReferenceBusyError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof UserReferenceValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

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

  // Persist page-field defaults for every mirror page of this entity (create-time
  // only; best-effort — never blocks the creation).
  await applyPageFieldDefaults(entityId, record.id, req.log);

  await emitEvent(
    {
      eventName: EVENT_RECORD_CREATED,
      entityId,
      recordId: record.id,
      payload: { actorUserId: userId, statusId: record.statusId },
    },
    req.log,
  );

  const createFormulaPageId = await resolvePageFormulaContextId(req, entityId, body.data.pageId);
  const createPageFormulaContext = await loadPageFormulaResponseContext(req, entityId, createFormulaPageId, [record.id]);
  const createVisibleFormulaFields = [
    ...fields.filter((field) => !hidden.has(field.fieldKey)),
    ...createPageFormulaContext.fields.filter((field) => !createPageFormulaContext.hidden.has(field.fieldKey)),
  ];
  const createInputs = await mergeLinkedFormulaInputs({
    entityId, rows: [{ id: record.id, values: projectViewerFormulaValues((record.valuesJson ?? {}) as Record<string, unknown>, createVisibleFormulaFields) }],
    pageId: createFormulaPageId,
    fields: createVisibleFormulaFields,
    permissions: await interactiveFormulaPermissions(req, entityId, createFormulaPageId),
  });
  const createFormulaValues = materializeVisibleEntityFormulas({
    entityId,
    rows: [{ id: record.id, values: (record.valuesJson ?? {}) as Record<string, unknown> }],
    fields,
    hidden,
    pageId: createFormulaPageId,
    pageValues: createPageFormulaContext.values,
    pageFields: createPageFormulaContext.fields,
    hiddenPage: createPageFormulaContext.hidden,
    linkedInputs: createInputs,
    formulaOptions: await loadFormulaOptions(),
  });
  res.status(201).json(presentRecord({ ...record, valuesJson: createFormulaValues.get(record.id) ?? record.valuesJson }, hidden, fields));
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
  const fields = await loadActiveFields(record.entityId);
  const { scope, scopeFieldKeys } = effectiveScope(perms, record.entityId);
  if (scope === "own" && !(await isRecordOwned(record.entityId, record, scopeFieldKeys, req.user!.userId, fields))) {
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

  const { hidden } = await fieldAccessContext(req, record.entityId, fields);
  const readInputs = await mergeLinkedFormulaInputs({
    entityId: record.entityId,
    rows: [{ id: record.id, values: projectViewerFormulaValues((record.valuesJson ?? {}) as Record<string, unknown>, fields.filter((field) => !hidden.has(field.fieldKey))) }],
    fields: fields.filter((field) => !hidden.has(field.fieldKey)),
    permissions: await interactiveFormulaPermissions(req, record.entityId),
  });
  const readFormulaValues = materializeVisibleEntityFormulas({
    entityId: record.entityId,
    rows: [{ id: record.id, values: (record.valuesJson ?? {}) as Record<string, unknown> }],
    fields,
    hidden,
    linkedInputs: readInputs,
    formulaOptions: await loadFormulaOptions(),
  });
  res.json(presentRecord({ ...record, valuesJson: readFormulaValues.get(record.id) ?? record.valuesJson }, hidden, fields));
});

type TrashReason = "record_deleted" | "field_cleared" | "field_replaced";

/**
 * Recognize a server-stored file value (local disk `/local/...` or legacy object
 * storage `/objects/...`). These are the only kinds we ever physically delete;
 * Google Drive (`fileId`) and link (`url`) values are deliberately ignored.
 * Legacy values without a `kind` but with such a path are treated as server files.
 */
export function asServerFile(
  v: unknown,
): { path: string; name: string; size: number | null; contentType: string | null } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const isServer = o.kind === "server" || (o.kind == null && o.url == null && o.fileId == null);
  if (!isServer) return null;
  const path = o.path;
  if (typeof path !== "string" || !(path.startsWith("/local/") || path.startsWith("/objects/"))) return null;
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

/**
 * Page-local twin of `trashRemovedServerFiles`: moves LOCAL files removed from a
 * page-local file field (page_record_values) into the file trash. Same rules:
 * server files only, best-effort, `newValues === null` means the record (and its
 * page values) were deleted. Field display names come from page_fields.
 * The actor is structural (Request satisfies it) so the automations engine can
 * attribute AS-SYSTEM trash entries to the triggering user without a Request.
 */
export async function trashRemovedPageServerFiles(
  req: { user?: { userId: number } | null; log: { error: (obj: unknown, msg: string) => void } },
  entityId: number,
  pageId: number,
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
      .select({ fieldKey: pageFieldsTable.fieldKey, nameJson: pageFieldsTable.nameJson })
      .from(pageFieldsTable)
      .where(eq(pageFieldsTable.pageId, pageId));
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
        deletedBy: req.user?.userId ?? null,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to record removed page-local files in the file trash");
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
  const recordId = params.data.id;
  const input = body.data;

  const [existing] = await db
    .select()
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, recordId))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!(await assertRecord(req, res, existing.entityId, "update", input.pageId))) return;

  const perms = await getPermissions(req);
  const fields = await loadActiveFields(existing.entityId);
  const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, existing.entityId, input.pageId);
  let authoritativeExisting = existing;
  let existingValues = (existing.valuesJson as Record<string, unknown>) ?? {};
  if (scope === "own" && !(await isRecordOwned(existing.entityId, existing, scopeFieldKeys, req.user!.userId, fields))) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  const hasValues = input.valuesJson !== undefined;
  const hasStatus = input.statusId !== undefined;
  let effectiveHasStatus = hasStatus;
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

  const { editable, hidden } = await fieldAccessContext(req, existing.entityId, fields, input.pageId);

  if (hasValues) {
    const activeKeys = new Set(fields.map((field) => field.fieldKey));
    for (const key of Object.keys(input.valuesJson as Record<string, unknown>)) {
      if (!activeKeys.has(key)) {
        res.status(400).json({ error: `Unknown field: ${key}` });
        return;
      }
    }
  }
  // Final value derivation and validation are intentionally deferred until the
  // authoritative row is locked inside the mutation transaction.

  if (hasStatus) {
    if (input.statusId === null) {
      update.statusId = null;
    } else {
      if (!(await statusBelongsToEntity(input.statusId as number, existing.entityId))) {
        res.status(400).json({ error: "Status does not belong to this entity" });
        return;
      }
      update.statusId = input.statusId as number;
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
  let statusChanging = hasStatus && (update.statusId ?? null) !== (existing.statusId ?? null);
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
  // isKey uniqueness is verified inside the write transaction under an advisory lock
  // (per entity), excluding this record, so concurrent edits can't both pass.
  const keyFields = fields.filter((f) => f.isKey);
  let record: typeof entityRecordsTable.$inferSelect | undefined;
  class LockedUpdateError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
  }
  try {
    record = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(entityRecordsTable)
        .where(eq(entityRecordsTable.id, recordId)).for("update");
      if (!locked) throw new LockedUpdateError(404, "Record not found");
      if (input.expectedVersion != null && locked.version !== input.expectedVersion) return undefined;
      if (locked.entityId !== existing.entityId) throw new LockedUpdateError(404, "Record not found");
      if (hasStatus) {
        const [statusPolicy] = await tx
          .select({
            policy: entitiesTable.statusManualEditPolicy,
            userIds: entitiesTable.statusManualEditUserIds,
          })
          .from(entitiesTable)
          .where(eq(entitiesTable.id, locked.entityId))
          .limit(1);
        if (statusPolicy && isManualStatusEditDisabled(statusPolicy.policy, statusPolicy.userIds, req.user!.userId)) {
          throw new LockedUpdateError(403, "Manual status editing is disabled for this user");
        }
      }
      if (
        scope === "own" &&
        !(await isRecordOwned(locked.entityId, locked, scopeFieldKeys, req.user!.userId, fields, tx))
      ) {
        throw new LockedUpdateError(404, "Record not found");
      }
      const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, locked.entityId);
      if (locked.statusId != null && hiddenRowStatusIds.includes(locked.statusId)) {
        throw new LockedUpdateError(404, "Record not found");
      }
      authoritativeExisting = locked;
      existingValues = (locked.valuesJson as Record<string, unknown>) ?? {};
      let statusWasMapped = false;

      // Rebuild the complete value map from the locked current row. The earlier
      // request checks are only a fast-fail boundary and are never write input.
      if (hasValues) {
        const rawValues = input.valuesJson as Record<string, unknown>;
        const candidate: Record<string, unknown> = {};
        for (const field of fields) {
          candidate[field.fieldKey] = editable.has(field.fieldKey) && field.fieldKey in rawValues
            ? rawValues[field.fieldKey]
            : existingValues[field.fieldKey];
        }
        let validated = validateValues(fields, candidate, await isGoogleDriveModuleEnabled(), existingValues);
        if ("error" in validated) throw new LockedUpdateError(400, validated.error);
        let finalValues = validated.values;
        for (const field of fields) {
          if (
            field.fieldKey in rawValues &&
            JSON.stringify(existingValues[field.fieldKey] ?? null) !==
              JSON.stringify(finalValues[field.fieldKey] ?? null)
          ) {
            finalValues = clearDependentDescendantValues(finalValues, field.fieldKey, fields);
          }
        }
        validated = validateValues(fields, finalValues, await isGoogleDriveModuleEnabled(), existingValues);
        if ("error" in validated) throw new LockedUpdateError(400, validated.error);
        update.valuesJson = validated.values;
        const mapped = mappedStatusForChangedValues(fields, existingValues, update.valuesJson);
        if ("error" in mapped) throw new LockedUpdateError(422, mapped.error);
        if (mapped.statusId != null) {
          if (hasStatus && update.statusId !== mapped.statusId) {
            throw new LockedUpdateError(
              422,
              "Selected list value conflicts with the explicitly selected system status",
            );
          }
          const [mappedStatus] = await tx
            .select({ id: entityStatusesTable.id })
            .from(entityStatusesTable)
            .where(and(
              eq(entityStatusesTable.id, mapped.statusId),
              eq(entityStatusesTable.entityId, locked.entityId),
            ))
            .limit(1);
          if (!mappedStatus) {
            throw new LockedUpdateError(400, "Mapped status does not belong to this entity");
          }
          update.statusId = mapped.statusId;
          effectiveHasStatus = true;
          statusWasMapped = true;
        }
      } else {
        delete update.valuesJson;
      }

      statusChanging = effectiveHasStatus && (update.statusId ?? null) !== (locked.statusId ?? null);
      delete update.statusChangedAt;
      delete update.archivedAt;
      delete update.archiveExempt;
      if (statusChanging && update.statusId != null && !perms.superAdmin && !statusWasMapped) {
        const { hiddenStatusIds } = effectiveStatusVisibility(perms, locked.entityId);
        if (hiddenStatusIds.includes(update.statusId)) {
          throw new LockedUpdateError(403, "This status is not available to your role");
        }
      }
      if (statusChanging && locked.statusId != null && !perms.superAdmin) {
        const transitions = await tx.select().from(entityTransitionsTable)
          .where(eq(entityTransitionsTable.entityId, locked.entityId));
        if (transitions.length > 0) {
          const match = transitions.find((transition) =>
            transition.fromStatusId === locked.statusId && transition.toStatusId === update.statusId)
            ?? transitions.find((transition) =>
              transition.fromStatusId === null && transition.toStatusId === update.statusId);
          if (!match) throw new LockedUpdateError(422, "This status change is not an allowed transition");
          const allowedRoleIds = (match.allowedRoleIds as number[]) ?? [];
          const userRoleIds = await getUserRoleIds(req);
          if (
            !statusWasMapped &&
            allowedRoleIds.length > 0 &&
            !allowedRoleIds.some((id) => userRoleIds.includes(id))
          ) {
            throw new LockedUpdateError(403, "Your role is not allowed to perform this transition");
          }
          const base = update.valuesJson !== undefined ? { ...update.valuesJson } : { ...existingValues };
          for (const action of (match.actionsJson as { type: string; fieldKey: string; value?: unknown }[]) ?? []) {
            if (action.type === "set_field") base[action.fieldKey] = action.value;
          }
          const validated = validateValues(fields, base, await isGoogleDriveModuleEnabled(), existingValues);
          if ("error" in validated) throw new LockedUpdateError(400, validated.error);
          update.valuesJson = validated.values;
          const finalMapped = mappedStatusForChangedValues(fields, existingValues, update.valuesJson);
          if ("error" in finalMapped) throw new LockedUpdateError(422, finalMapped.error);
          if (finalMapped.statusId != null && finalMapped.statusId !== update.statusId) {
            throw new LockedUpdateError(
              422,
              "Workflow actions conflict with the system status mapped from the final select value",
            );
          }
          const missing = ((match.requiredFieldKeys as string[]) ?? [])
            .filter((fieldKey) => isEmpty(update.valuesJson![fieldKey]));
          if (missing.length > 0) {
            throw new LockedUpdateError(422, `Fields required for this transition: ${missing.join(", ")}`);
          }
        }
      }
      if (update.valuesJson !== undefined) {
        const preservedValues = { ...existingValues };
        for (const field of fields) {
          if (Object.prototype.hasOwnProperty.call(update.valuesJson, field.fieldKey)) {
            preservedValues[field.fieldKey] = update.valuesJson[field.fieldKey];
          } else {
            delete preservedValues[field.fieldKey];
          }
        }
        update.valuesJson = preservedValues;
        const userRefError = await validateUserRefs(fields, update.valuesJson, tx);
        if (userRefError) throw new LockedUpdateError(400, userRefError);
        const dependentError = await checkDependentValues(
          locked.entityId, fields, update.valuesJson, locked.id, tx,
        );
        if (dependentError) throw new LockedUpdateError(400, dependentError);
        const immutableError = checkImmutableFields(fields, update.valuesJson, existingValues);
        if (immutableError) throw new LockedUpdateError(422, immutableError);
        const validationError = checkValidationRules(fields, update.valuesJson);
        if (validationError) throw new LockedUpdateError(422, validationError);
        try {
          await lockAndValidateGdriveFileReferences(tx, existingValues, update.valuesJson);
        } catch (err) {
          if (err instanceof DriveFileTombstonedError) throw new LockedUpdateError(409, err.message);
          throw err;
        }
      }
      if (statusChanging) {
        update.statusChangedAt = new Date();
        update.archiveExempt = false;
        if (update.statusId != null) {
          const info = await statusArchiveInfo(update.statusId);
          if (info?.isArchiveTrigger && (info.archiveAfterDays ?? 0) === 0) update.archivedAt = new Date();
        }
      }
      if (keyFields.length > 0 && update.valuesJson !== undefined) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${UNIQUE_KEY_LOCK_NS}, ${existing.entityId})`);
        const dup = await checkUniqueKeys(tx, existing.entityId, keyFields, update.valuesJson, recordId);
        if (dup) throw new UniqueKeyError(dup);
      }
      const [rec] = await tx
        .update(entityRecordsTable)
        .set(update)
        .where(eq(entityRecordsTable.id, recordId))
        .returning();
      return rec;
    });
  } catch (err) {
    if (err instanceof UniqueKeyError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof LockedUpdateError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof UserReferenceBusyError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
  if (!record) {
    const [current] = await db.select({ version: entityRecordsTable.version }).from(entityRecordsTable).where(eq(entityRecordsTable.id, recordId));
    res.status(409).json({ error: "Record changed concurrently; please retry", currentVersion: current?.version ?? null });
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
      updateEntries.push({ entityId: authoritativeExisting.entityId, recordId: record.id, ...c, userId });
    }
  }
  if (statusChanging) {
    updateEntries.push({
      entityId: authoritativeExisting.entityId,
      recordId: record.id,
      fieldKey: AUDIT_STATUS,
      oldValue: authoritativeExisting.statusId != null ? String(authoritativeExisting.statusId) : null,
      newValue: record.statusId != null ? String(record.statusId) : null,
      userId,
    });
    // A delay=0 archive-trigger status archives immediately as a side effect.
    if (authoritativeExisting.archivedAt == null && record.archivedAt != null) {
      updateEntries.push({ entityId: authoritativeExisting.entityId, recordId: record.id, fieldKey: AUDIT_ARCHIVED, oldValue: "false", newValue: "true", userId });
    }
  }
  await writeAudit(updateEntries, req.log);

  // Move any local files that were cleared or replaced by this update into the
  // file trash (Drive/link values untouched). Best-effort; does not block.
  if (update.valuesJson !== undefined) {
    await trashRemovedServerFiles(
      req,
      authoritativeExisting.entityId,
      record.id,
      existingValues,
      record.valuesJson as Record<string, unknown>,
    );
  }

  // changedFields lets field_changed automations gate on the specific field(s)
  // that actually changed; derived from the persisted diff (post set_field).
  const changedFields =
    update.valuesJson !== undefined
      ? diffValues(existingValues, record.valuesJson as Record<string, unknown>, fields.map((f) => f.fieldKey)).map((c) => c.fieldKey)
      : [];
  if ((existing.archivedAt != null) !== (record.archivedAt != null)) {
    changedFields.push(ARCHIVED_CHANGED_FIELD);
  }
  const events: Parameters<typeof emitEvent>[0] = [
    {
      eventName: EVENT_RECORD_UPDATED,
        entityId: authoritativeExisting.entityId,
      recordId: record.id,
      payload: { actorUserId: userId, changedFields, version: record.version },
    },
  ];
  if (statusChanging) {
    events.push({
      eventName: EVENT_STATUS_CHANGED,
      entityId: authoritativeExisting.entityId,
      recordId: record.id,
      payload: {
        actorUserId: userId,
        from: authoritativeExisting.statusId ?? null,
        to: record.statusId ?? null,
        version: record.version,
      },
    });
  }
  await emitEvent(events, req.log);

  const updateFormulaPageId = await resolvePageFormulaContextId(req, record.entityId, input.pageId);
  const updatePageFormulaContext = await loadPageFormulaResponseContext(
    req, record.entityId, updateFormulaPageId, [record.id],
  );
  const updateVisibleFormulaFields = [
    ...fields.filter((field) => !hidden.has(field.fieldKey)),
    ...updatePageFormulaContext.fields.filter((field) => !updatePageFormulaContext.hidden.has(field.fieldKey)),
  ];
  const updateInputs = await mergeLinkedFormulaInputs({
    entityId: record.entityId,
    pageId: updateFormulaPageId,
    rows: [{ id: record.id, values: projectViewerFormulaValues((record.valuesJson ?? {}) as Record<string, unknown>, updateVisibleFormulaFields) }],
    fields: updateVisibleFormulaFields,
    permissions: await interactiveFormulaPermissions(req, record.entityId, updateFormulaPageId),
  });
  const updateFormulaValues = materializeVisibleEntityFormulas({
    entityId: record.entityId,
    rows: [{ id: record.id, values: (record.valuesJson ?? {}) as Record<string, unknown> }],
    fields,
    hidden,
    pageId: updateFormulaPageId,
    pageValues: updatePageFormulaContext.values,
    pageFields: updatePageFormulaContext.fields,
    hiddenPage: updatePageFormulaContext.hidden,
    linkedInputs: updateInputs,
    formulaOptions: await loadFormulaOptions(),
  });
  res.json(presentRecord({ ...record, valuesJson: updateFormulaValues.get(record.id) ?? record.valuesJson }, hidden, fields));
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
    .select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, valuesJson: entityRecordsTable.valuesJson, version: entityRecordsTable.version })
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  if (!(await assertRecord(req, res, existing.entityId, "delete", body.data.pageId))) return;

  const perms = await getPermissions(req);
  const fields = await loadActiveFields(existing.entityId);
  const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, existing.entityId, body.data.pageId);
  if (scope === "own" && !(await isRecordOwned(existing.entityId, existing, scopeFieldKeys, req.user!.userId, fields))) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  const deleted = await performRecordDelete(req, existing.entityId, params.data.id, body.data.expectedVersion);
  if (!deleted) {
    const [current] = await db.select({ version: entityRecordsTable.version }).from(entityRecordsTable).where(eq(entityRecordsTable.id, params.data.id)).limit(1);
    res.status(409).json({ error: "Stale record version", recordId: params.data.id, currentVersion: current?.version });
    return;
  }

  res.json({ success: true });
});

/**
 * Physical deletion of a record + the accompanying bookkeeping (file trash,
 * audit marker with a data snapshot, delete event). ALL permission/ownership
 * checks must have passed before calling this — it is shared by the single
 * DELETE endpoint and the bulk action, so it performs no checks itself.
 */
async function performRecordDelete(
  req: import("express").Request,
  entityId: number,
  recordId: number,
  expectedVersion?: number,
): Promise<typeof entityRecordsTable.$inferSelect | undefined> {
  const result = await db.transaction(async (tx) => {
    await tx.select({ id: relationsTable.id }).from(relationsTable)
      .where(or(eq(relationsTable.sourceEntityId, entityId), eq(relationsTable.targetEntityId, entityId)))
      .orderBy(asc(relationsTable.id)).for("update");
    const links = await tx.select().from(recordLinksTable)
      .where(or(eq(recordLinksTable.sourceRecordId, recordId), eq(recordLinksTable.targetRecordId, recordId)))
      .orderBy(asc(recordLinksTable.id)).for("update");
    const counterpartIds = [...new Set(links.map((link) =>
      link.sourceRecordId === recordId ? link.targetRecordId : link.sourceRecordId))];
    const locked = await tx.select().from(entityRecordsTable)
      .where(inArray(entityRecordsTable.id, [recordId, ...counterpartIds].sort((a, b) => a - b)))
      .orderBy(asc(entityRecordsTable.id)).for("update");
    const deleting = locked.find((record) => record.id === recordId && record.entityId === entityId);
    if (!deleting || (expectedVersion != null && deleting.version !== expectedVersion)) return null;
    const pageFileEntries = (await tx
      .select({ pageId: pageRecordValuesTable.pageId, valuesJson: pageRecordValuesTable.valuesJson })
      .from(pageRecordValuesTable)
      .where(eq(pageRecordValuesTable.recordId, recordId))
      .for("update"))
      .map((row) => ({ pageId: row.pageId, valuesJson: (row.valuesJson as Record<string, unknown>) ?? {} }));
    await tx.delete(entityRecordsTable).where(eq(entityRecordsTable.id, recordId));
    const touched = counterpartIds.length === 0 ? [] : await tx.update(entityRecordsTable)
      .set({ updatedAt: new Date() })
      .where(inArray(entityRecordsTable.id, counterpartIds))
      .returning({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, version: entityRecordsTable.version });
    return { pageFileEntries, touched, deleting };
  });
  if (!result) return undefined;

  await finalizeRecordDelete(
    req,
    entityId,
    recordId,
    (result.deleting.valuesJson as Record<string, unknown>) ?? {},
    result.pageFileEntries,
  );
  if (result.touched.length > 0) {
    await emitEvent(result.touched.map((row) => ({
      eventName: EVENT_RECORD_UPDATED,
      entityId: row.entityId,
      recordId: row.id,
      payload: { actorUserId: req.user!.userId, changedFields: [], version: row.version },
    })), req.log);
  }
  return result.deleting;
}

/** Post-delete bookkeeping shared with transactional multi-record operations. */
async function finalizeRecordDelete(
  req: import("express").Request,
  entityId: number,
  recordId: number,
  values: Record<string, unknown>,
  pageFileEntries: { pageId: number; valuesJson: Record<string, unknown> }[],
): Promise<void> {
  // Move the record's local files into the file trash so a mistaken delete is
  // recoverable (Drive/link values untouched). Best-effort; does not block.
  await trashRemovedServerFiles(req, entityId, recordId, values, null);
  for (const pv of pageFileEntries) {
    await trashRemovedPageServerFiles(req, entityId, pv.pageId, recordId, pv.valuesJson, null);
  }

  // Audit: one deletion marker carrying a snapshot of the record's data so the
  // trail preserves what was removed even though the row is gone.
  await writeAudit(
    [{
      entityId,
      recordId,
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
      entityId,
      recordId,
      payload: { actorUserId: req.user!.userId },
    },
    req.log,
  );
}

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
  expectedVersion?: number,
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
  const fields = await loadActiveFields(existing.entityId);
  const { scope, scopeFieldKeys } = effectiveScope(perms, existing.entityId);
  if (scope === "own" && !(await isRecordOwned(existing.entityId, existing, scopeFieldKeys, req.user!.userId, fields))) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  if (expectedVersion != null && existing.version !== expectedVersion) {
    res.status(409).json({ error: "Stale record version", recordId, currentVersion: existing.version });
    return;
  }
  const record = await applyArchiveFlag(req, existing.entityId, existing.id, archived, expectedVersion);
  if (!record) {
    const [current] = await db.select({ version: entityRecordsTable.version }).from(entityRecordsTable).where(eq(entityRecordsTable.id, recordId)).limit(1);
    res.status(409).json({ error: "Stale record version", recordId, currentVersion: current?.version });
    return;
  }

  const { hidden } = await fieldAccessContext(req, existing.entityId, fields);
  res.json(presentRecord(record, hidden, fields));
}

/**
 * Flip the archive flag + audit. Shared by the single archive/unarchive
 * endpoints and the bulk action; performs NO permission checks itself.
 *
 * Unarchive sets the exemption so the auto-archive sweep won't immediately
 * re-archive a record still sitting in a (delay=0) archive-trigger status; the
 * exemption is cleared on the next status change. Archiving clears it (an
 * explicit archive needs no exemption). Guard: only an actual archived→active
 * transition grants the exemption — unarchiving an already-active record is a
 * no-op for exemption, so the endpoint can't be used to opt records out of
 * auto-archival.
 */
async function applyArchiveFlag(
  req: import("express").Request,
  entityId: number,
  recordId: number,
  archived: boolean,
  expectedVersion?: number,
): Promise<typeof entityRecordsTable.$inferSelect | undefined> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(entityRecordsTable)
      .where(and(eq(entityRecordsTable.id, recordId), eq(entityRecordsTable.entityId, entityId)))
      .for("update");
    if (!current || (expectedVersion != null && current.version !== expectedVersion)) return undefined;
    const currentlyArchived = current.archivedAt != null;
    if (currentlyArchived === archived) return { record: current, changed: false };
    const [record] = await tx.update(entityRecordsTable)
      .set({
        archivedAt: archived ? new Date() : null,
        archiveExempt: archived ? false : true,
      })
      .where(and(eq(entityRecordsTable.id, recordId), eq(entityRecordsTable.version, current.version)))
      .returning();
    return record ? { record, changed: true, wasArchived: currentlyArchived } : undefined;
  });
  if (!result) return undefined;
  if (!result.changed) return result.record;

  await writeAudit([{
    entityId,
    recordId,
    fieldKey: AUDIT_ARCHIVED,
    oldValue: String(result.wasArchived),
    newValue: String(archived),
    userId: req.user!.userId,
  }], req.log);
  await emitEvent({
    eventName: EVENT_RECORD_UPDATED,
    entityId,
    recordId,
    payload: {
      actorUserId: req.user!.userId,
      changedFields: [ARCHIVED_CHANGED_FIELD],
      version: result.record.version,
    },
  }, req.log);
  return result.record;
}

router.post("/records/:id/archive", requireAuth, async (req, res): Promise<void> => {
  const params = ArchiveRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ArchiveRecordBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await setArchived(req, res, params.data.id, true, body.data.expectedVersion);
});

router.post("/records/:id/unarchive", requireAuth, async (req, res): Promise<void> => {
  const params = UnarchiveRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ArchiveRecordBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await setArchived(req, res, params.data.id, false, body.data.expectedVersion);
});

class BulkFieldUpdateError extends Error {
  constructor(
    readonly status: number,
    readonly recordId: number | null,
    message: string,
  ) {
    super(recordId == null ? message : `Запись ${recordId}: ${message}`);
  }
}

/**
 * Atomically set ONE entity field to ONE value across selected records.
 *
 * Unlike the intentionally partial archive/delete endpoint below, this endpoint
 * locks and validates every selected row in one transaction. A failure on any
 * row rolls the whole batch back. Parent-field changes clear dependent
 * descendants before the same validation/immutability/fill-rule pipeline used
 * by the single-record update.
 */
router.post("/records/bulk-field", requireAuth, async (req, res): Promise<void> => {
  const body = BulkUpdateRecordFieldBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { entityId, fieldKey, value, pageId, expectedVersions } = body.data;
  const recordIds = [...new Set(body.data.recordIds)].sort((a, b) => a - b);
  if (!(await assertRecord(req, res, entityId, "update", pageId))) return;

  const [perms, fields] = await Promise.all([getPermissions(req), loadActiveFields(entityId)]);
  const field = fields.find((candidate) => candidate.fieldKey === fieldKey);
  if (!field) {
    res.status(400).json({ error: `Unknown field: ${fieldKey}` });
    return;
  }
  if (
    field.fieldType === "function" ||
    field.fieldType === "relation" ||
    field.fieldType === "lookup" ||
    field.fieldType === "created_at" ||
    field.fieldType === "file"
  ) {
    res.status(400).json({ error: `Field "${fieldKey}" cannot be changed in bulk` });
    return;
  }
  if (field.lockAfterCreate) {
    res.status(422).json({ error: `Поле «${fieldRuName(field)}» нельзя изменять массово` });
    return;
  }
  // A dependent field's valid option set can differ from row to row according
  // to its parent chain, so one shared picker/value is not a safe bulk contract.
  if (field.dependencyConfigJson?.dependsOnFieldKey) {
    res.status(400).json({ error: `Dependent field "${fieldKey}" cannot be changed in bulk` });
    return;
  }

  const { editable } = await fieldAccessContext(req, entityId, fields, pageId);
  if (!editable.has(fieldKey)) {
    res.status(403).json({ error: `Field "${fieldKey}" is read-only for your role` });
    return;
  }
  const { scope, scopeFieldKeys } = await effectiveScopeFor(req, perms, entityId, pageId);
  const { hiddenRowStatusIds } = effectiveStatusVisibility(perms, entityId);
  const gdriveModuleEnabled = await isGoogleDriveModuleEnabled();
  const keyFields = fields.filter((candidate) => candidate.isKey);
  const userId = req.user!.userId;

  type ChangedRow = {
    id: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    beforeStatusId: number | null;
    afterStatusId: number | null;
    beforeArchivedAt: Date | null;
    afterArchivedAt: Date | null;
    version: number;
  };
  let changedRows: ChangedRow[] = [];
  try {
    changedRows = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(entityRecordsTable)
        .where(and(eq(entityRecordsTable.entityId, entityId), inArray(entityRecordsTable.id, recordIds)))
        .orderBy(asc(entityRecordsTable.id))
        .for("update");
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const recordId of recordIds) {
        const row = byId.get(recordId);
        if (!row) throw new BulkFieldUpdateError(404, recordId, "запись не найдена");
        if (row.statusId != null && hiddenRowStatusIds.includes(row.statusId)) {
          throw new BulkFieldUpdateError(404, recordId, "запись недоступна");
        }
        const expectedVersion = expectedVersions?.[String(recordId)];
        if (expectedVersion != null && row.version !== expectedVersion) {
          throw new BulkFieldUpdateError(409, recordId, `устаревшая версия (текущая ${row.version})`);
        }
        if (
          scope === "own" &&
          !(await isRecordOwned(entityId, row, scopeFieldKeys, userId, fields))
        ) {
          throw new BulkFieldUpdateError(404, recordId, "запись недоступна");
        }
      }

      if (keyFields.length > 0) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${UNIQUE_KEY_LOCK_NS}, ${entityId})`);
      }

      const changed: ChangedRow[] = [];
      const pending: {
        recordId: number;
        row: (typeof rows)[number];
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        statusChanging: boolean;
        updateData: {
          valuesJson: Record<string, unknown>;
          statusId?: number;
          statusChangedAt?: Date;
          archiveExempt?: boolean;
          archivedAt?: Date;
        };
      }[] = [];
      for (const recordId of recordIds) {
        const row = byId.get(recordId)!;
        const before = (row.valuesJson as Record<string, unknown>) ?? {};
        let candidate = { ...before, [fieldKey]: isEmpty(value) ? undefined : value };
        let validated = validateValues(fields, candidate, gdriveModuleEnabled, before);
        if ("error" in validated) {
          throw new BulkFieldUpdateError(400, recordId, validated.error);
        }
        // Clear descendants only when the target's CANONICAL value actually
        // changes. Reapplying an already-stored parent value is a no-op and must
        // never erase its dependent children.
        const targetChanged =
          JSON.stringify(before[fieldKey] ?? null) !==
          JSON.stringify(validated.values[fieldKey] ?? null);
        if (targetChanged) {
          candidate = clearDependentDescendantValues(validated.values, fieldKey, fields);
          validated = validateValues(fields, candidate, gdriveModuleEnabled, before);
          if ("error" in validated) {
            throw new BulkFieldUpdateError(400, recordId, validated.error);
          }
        }
        const mapped = mappedStatusForChangedValues(fields, before, validated.values);
        if ("error" in mapped) throw new BulkFieldUpdateError(422, recordId, mapped.error);
        const mappedStatusId = mapped.statusId;
        const statusChanging =
          mappedStatusId != null && mappedStatusId !== (row.statusId ?? null);
        if (mappedStatusId != null) {
          const [mappedStatus] = await tx
            .select({
              id: entityStatusesTable.id,
              isArchiveTrigger: entityStatusesTable.isArchiveTrigger,
              archiveAfterDays: entityStatusesTable.archiveAfterDays,
            })
            .from(entityStatusesTable)
            .where(and(
              eq(entityStatusesTable.id, mappedStatusId),
              eq(entityStatusesTable.entityId, entityId),
            ))
            .limit(1);
          if (!mappedStatus) {
            throw new BulkFieldUpdateError(400, recordId, "Mapped status does not belong to this entity");
          }
          if (statusChanging && !perms.superAdmin) {
            if (row.statusId != null) {
              const transitions = await tx
                .select()
                .from(entityTransitionsTable)
                .where(eq(entityTransitionsTable.entityId, entityId));
              if (transitions.length > 0) {
                const match = transitions.find((transition) =>
                  transition.fromStatusId === row.statusId && transition.toStatusId === mappedStatusId)
                  ?? transitions.find((transition) =>
                    transition.fromStatusId === null && transition.toStatusId === mappedStatusId);
                if (!match) {
                  throw new BulkFieldUpdateError(422, recordId, "This status change is not an allowed transition");
                }
                const transitionValues = { ...validated.values };
                for (const action of (match.actionsJson as {
                  type: string;
                  fieldKey: string;
                  value?: unknown;
                }[]) ?? []) {
                  if (action.type === "set_field") transitionValues[action.fieldKey] = action.value;
                }
                const transitionValidated = validateValues(
                  fields,
                  transitionValues,
                  gdriveModuleEnabled,
                  before,
                );
                if ("error" in transitionValidated) {
                  throw new BulkFieldUpdateError(400, recordId, transitionValidated.error);
                }
                validated = transitionValidated;
                const finalMapped = mappedStatusForChangedValues(fields, before, validated.values);
                if ("error" in finalMapped) {
                  throw new BulkFieldUpdateError(422, recordId, finalMapped.error);
                }
                if (finalMapped.statusId != null && finalMapped.statusId !== mappedStatusId) {
                  throw new BulkFieldUpdateError(
                    422,
                    recordId,
                    "Workflow actions conflict with the system status mapped from the final select value",
                  );
                }
                const missing = ((match.requiredFieldKeys as string[]) ?? [])
                  .filter((requiredKey) => isEmpty(transitionValidated.values[requiredKey]));
                if (missing.length > 0) {
                  throw new BulkFieldUpdateError(
                    422,
                    recordId,
                    `Fields required for this transition: ${missing.join(", ")}`,
                  );
                }
              }
            }
          }
        }
        const userRefError = await validateUserRefs(fields, validated.values, tx);
        if (userRefError) throw new BulkFieldUpdateError(400, recordId, userRefError);
        const dependentError = await checkDependentValues(
          entityId,
          fields,
          validated.values,
          recordId,
          tx,
        );
        if (dependentError) throw new BulkFieldUpdateError(400, recordId, dependentError);
        const immutableError = checkImmutableFields(fields, validated.values, before);
        if (immutableError) throw new BulkFieldUpdateError(422, recordId, immutableError);
        const fillError = checkValidationRules(fields, validated.values);
        if (fillError) throw new BulkFieldUpdateError(422, recordId, fillError);
        const diffs = diffValues(before, validated.values, fields.map((candidateField) => candidateField.fieldKey));
        if (diffs.length === 0 && !statusChanging) continue;
        const updateData: {
          valuesJson: Record<string, unknown>;
          statusId?: number;
          statusChangedAt?: Date;
          archiveExempt?: boolean;
          archivedAt?: Date;
        } = { valuesJson: validated.values };
        if (statusChanging && mappedStatusId != null) {
          updateData.statusId = mappedStatusId;
          updateData.statusChangedAt = new Date();
          updateData.archiveExempt = false;
          const [archiveInfo] = await tx
            .select({
              isArchiveTrigger: entityStatusesTable.isArchiveTrigger,
              archiveAfterDays: entityStatusesTable.archiveAfterDays,
            })
            .from(entityStatusesTable)
            .where(eq(entityStatusesTable.id, mappedStatusId))
            .limit(1);
          if (archiveInfo?.isArchiveTrigger && (archiveInfo.archiveAfterDays ?? 0) === 0) {
            updateData.archivedAt = new Date();
          }
        }
        pending.push({
          recordId,
          row,
          before,
          after: validated.values,
          statusChanging,
          updateData,
        });
      }

      await lockGdriveFileIds(
        tx,
        pending.flatMap(({ before, after }) => newlyIntroducedGdriveFileIds(before, after)),
      );
      for (const item of pending) {
        try {
          await validateGdriveFileReferencesUnderLock(tx, item.before, item.after);
        } catch (err) {
          if (err instanceof DriveFileTombstonedError) {
            throw new BulkFieldUpdateError(409, item.recordId, err.message);
          }
          throw err;
        }
      }
      for (const item of pending) {
        if (keyFields.length > 0) {
          const duplicate = await checkUniqueKeys(tx, entityId, keyFields, item.after, item.recordId);
          if (duplicate) throw new BulkFieldUpdateError(409, item.recordId, duplicate);
        }
        const [updated] = await tx
          .update(entityRecordsTable)
          .set(item.updateData)
          .where(eq(entityRecordsTable.id, item.recordId))
          .returning({
            id: entityRecordsTable.id,
            valuesJson: entityRecordsTable.valuesJson,
            statusId: entityRecordsTable.statusId,
            archivedAt: entityRecordsTable.archivedAt,
            version: entityRecordsTable.version,
          });
        changed.push({
          id: updated.id,
          before: item.before,
          after: updated.valuesJson as Record<string, unknown>,
          beforeStatusId: item.row.statusId ?? null,
          afterStatusId: updated.statusId ?? null,
          beforeArchivedAt: item.row.archivedAt,
          afterArchivedAt: updated.archivedAt,
          version: updated.version,
        });
      }
      return changed;
    });
  } catch (err) {
    if (err instanceof BulkFieldUpdateError) {
      const current =
        err.status === 409 && err.recordId != null
          ? await db.select({ version: entityRecordsTable.version }).from(entityRecordsTable).where(eq(entityRecordsTable.id, err.recordId)).limit(1)
          : [];
      res.status(err.status).json({ error: err.message, recordId: err.recordId, ...(err.status === 409 ? { currentVersion: current[0]?.version } : {}) });
      return;
    }
    if (err instanceof UserReferenceBusyError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }

  const auditEntries: InsertAuditLog[] = [];
  const events: Parameters<typeof emitEvent>[0] = [];
  for (const row of changedRows) {
    const changedFields = diffValues(row.before, row.after, fields.map((candidate) => candidate.fieldKey));
    for (const change of changedFields) {
      auditEntries.push({ entityId, recordId: row.id, ...change, userId });
    }
    const statusChanged = row.beforeStatusId !== row.afterStatusId;
    if (statusChanged) {
      auditEntries.push({
        entityId,
        recordId: row.id,
        fieldKey: AUDIT_STATUS,
        oldValue: row.beforeStatusId != null ? String(row.beforeStatusId) : null,
        newValue: row.afterStatusId != null ? String(row.afterStatusId) : null,
        userId,
      });
    }
    if (row.beforeArchivedAt == null && row.afterArchivedAt != null) {
      auditEntries.push({
        entityId,
        recordId: row.id,
        fieldKey: AUDIT_ARCHIVED,
        oldValue: "false",
        newValue: "true",
        userId,
      });
      changedFields.push({
        fieldKey: ARCHIVED_CHANGED_FIELD,
        oldValue: "false",
        newValue: "true",
      });
    }
    events.push({
      eventName: EVENT_RECORD_UPDATED,
      entityId,
      recordId: row.id,
      payload: { actorUserId: userId, changedFields: changedFields.map((change) => change.fieldKey), version: row.version },
    });
    if (statusChanged) {
      events.push({
        eventName: EVENT_STATUS_CHANGED,
        entityId,
        recordId: row.id,
        payload: {
          actorUserId: userId,
          from: row.beforeStatusId,
          to: row.afterStatusId,
          version: row.version,
        },
      });
    }
  }
  if (auditEntries.length > 0) await writeAudit(auditEntries, req.log);
  if (events.length > 0) await emitEvent(events, req.log);

  res.json({ updatedIds: recordIds, versions: Object.fromEntries(changedRows.map((row) => [row.id, row.version])) });
});

/**
 * Bulk archive/unarchive/delete. The entity-level capability is asserted once
 * (delete → record `delete` cap honouring the mirror-page override via pageId;
 * archive/unarchive → record `update` cap, exactly like the single endpoints),
 * then EVERY record is re-checked individually against the row-level own-scope
 * boundary — records that fail (missing, wrong entity, not owned) are reported
 * in `failedIds` while the rest are processed. No transaction on purpose: each
 * record's outcome is independent, mirroring N single calls.
 */
router.post("/records/bulk", requireAuth, async (req, res): Promise<void> => {
  const body = BulkRecordsActionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { entityId, action, recordIds, pageId, expectedVersions } = body.data;
  const isDelete = action === "delete";
  if (!(await assertRecord(req, res, entityId, isDelete ? "delete" : "update", isDelete ? pageId : undefined))) return;

  const perms = await getPermissions(req);
  const fields = await loadActiveFields(entityId);
  // Same scope resolution as the corresponding single endpoint: delete honours
  // the mirror-page override, archive/unarchive uses the plain entity scope.
  const { scope, scopeFieldKeys } = isDelete
    ? await effectiveScopeFor(req, perms, entityId, pageId)
    : effectiveScope(perms, entityId);

  const uniqueIds = [...new Set(recordIds)];
  const rows = await db
    .select()
    .from(entityRecordsTable)
    .where(and(eq(entityRecordsTable.entityId, entityId), inArray(entityRecordsTable.id, uniqueIds)));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const successIds: number[] = [];
  const failedIds: number[] = [];
  const versions: Record<string, number> = {};
  for (const id of uniqueIds) {
    const existing = byId.get(id);
    if (!existing) {
      failedIds.push(id);
      continue;
    }
    if (scope === "own" && !(await isRecordOwned(entityId, existing, scopeFieldKeys, req.user!.userId, fields))) {
      failedIds.push(id);
      continue;
    }
    try {
      const expectedVersion = expectedVersions?.[String(id)];
      if (isDelete) {
        const deleted = await performRecordDelete(
          req,
          entityId,
          id,
          expectedVersion,
        );
        if (!deleted) {
          failedIds.push(id);
          continue;
        }
      } else {
        const updated = await applyArchiveFlag(
          req,
          entityId,
          id,
          action === "archive",
          expectedVersion,
        );
        if (!updated) {
          failedIds.push(id);
          continue;
        }
        versions[String(id)] = updated.version;
      }
      successIds.push(id);
    } catch (err) {
      req.log.error({ err, recordId: id, action }, "bulk record action failed");
      failedIds.push(id);
    }
  }

  res.json({ successIds, failedIds, ...(Object.keys(versions).length > 0 ? { versions } : {}) });
});

/** True when a stored field value counts as "empty" for merge fill-in. */
function mergeValueEmpty(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}
class MergeRecordNotFoundError extends Error {}

/**
 * Merge duplicate records into one (superAdmin only).
 *
 * In ONE transaction: every relation link of the source records is repointed
 * to the target — deduplicated and cardinality-safe (the target's own existing
 * link on a unique side always wins; a link that would connect the target to
 * itself is dropped); the target's EMPTY fields are filled from the sources
 * (first source with a value wins; the target's own values are never
 * overwritten); page-local values are merged the same way. Source rows are
 * deleted in that transaction; after commit the shared delete bookkeeping
 * performs file trash + audit snapshot + delete event. File values inherited
 * by the target are excluded from trashing so surviving files stay downloadable.
 */
router.post("/records/merge", requireAuth, requireSuperAdmin(), async (req, res): Promise<void> => {
  const body = MergeRecordsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { entityId, targetRecordId } = body.data;
  const sourceIds = [...new Set(body.data.sourceRecordIds)].filter((id) => id !== targetRecordId);
  if (sourceIds.length === 0) {
    res.status(400).json({ error: "sourceRecordIds must contain at least one record different from the target" });
    return;
  }

  const fields = await loadActiveFields(entityId);
  const sourceIdSet = new Set(sourceIds);
  // Fields whose value the target inherits from a source (fill-empty). Tracked
  // so the sources' delete does NOT trash the physical files behind them.
  const inheritedFileKeys = new Set<string>();

  let movedLinks = 0;
  let filledFields = 0;
  let targetLinkStateChanged = false;
  let mergedTargetVersion: number | undefined;
  const linkedSurvivorVersions = new Map<number, { entityId: number; version: number }>();
  const changedTargetPageRows = new Map<number, { version: number; changedPageFieldKeys: Set<string> }>();

  const filledFieldKeys: string[] = [];
  const deletedSnapshots = new Map<number, {
    values: Record<string, unknown>;
    pageFileEntries: { pageId: number; valuesJson: Record<string, unknown> }[];
  }>();

  try {
  await db.transaction(async (tx) => {
    const participantIds = [targetRecordId, ...sourceIds].sort((a, b) => a - b);
    // Global lock order shared with generic link writes:
    // relation rows (ascending), page advisory keys (page,record), entity records
    // (ascending), then link/page rows.
    // Lock every relation that can involve this entity, not merely relations in
    // a pre-lock link snapshot, so a new source link cannot appear unnoticed.
    await tx
      .select()
      .from(relationsTable)
      .where(or(eq(relationsTable.sourceEntityId, entityId), eq(relationsTable.targetEntityId, entityId)))
      .orderBy(asc(relationsTable.id))
      .for("update");

    const protectedLinkSnapshot = await tx
      .select()
      .from(recordLinksTable)
      .where(or(inArray(recordLinksTable.sourceRecordId, participantIds), inArray(recordLinksTable.targetRecordId, participantIds)))
      .orderBy(asc(recordLinksTable.id));
    const allLockedRecordIds = [
      ...new Set([
        ...participantIds,
        ...protectedLinkSnapshot.flatMap((link) => [link.sourceRecordId, link.targetRecordId]),
      ]),
    ].sort((a, b) => a - b);

    // Advisory locks precede record locks because a missing-row page insert
    // takes the advisory lock before its FK check touches entity_records.
    const pageIds = (await tx.select({ id: pagesTable.id }).from(pagesTable).orderBy(asc(pagesTable.id))).map((page) => page.id);
    for (const pageId of pageIds) {
      for (const recordId of participantIds) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock((${pageId}::bigint << 32) | ${recordId}::bigint)`);
      }
    }

    const lockedRows = await tx
      .select()
      .from(entityRecordsTable)
      .where(inArray(entityRecordsTable.id, allLockedRecordIds))
      .orderBy(asc(entityRecordsTable.id))
      .for("update");
    const byId = new Map(lockedRows.map((row) => [row.id, row]));
    const target = byId.get(targetRecordId);
    if (!target || sourceIds.some((id) => byId.get(id)?.entityId !== entityId) || target.entityId !== entityId) {
      throw new MergeRecordNotFoundError();
    }
    // ---- 1. Repoint relation links ------------------------------------
    // Re-read only after relation+record locks. All normal link create/delete
    // paths must first obtain one of those relation locks, so this is protected
    // against phantoms for every currently-defined relation.
    const participantLinks = await tx
      .select()
      .from(recordLinksTable)
      .where(or(inArray(recordLinksTable.sourceRecordId, participantIds), inArray(recordLinksTable.targetRecordId, participantIds)))
      .orderBy(asc(recordLinksTable.id))
      .for("update");
    const links = participantLinks.filter((link) =>
      sourceIdSet.has(link.sourceRecordId) || sourceIdSet.has(link.targetRecordId));
    const changedLinkedSurvivors = new Set<number>();

    // The target's CURRENT links per relation, to enforce dedupe + the partial
    // unique indexes (source unique for one_to_one/many_to_one, target unique
    // for one_to_one/one_to_many) in application order.
    const relationIds = new Set(links.map((link) => link.relationId));
    const targetLinks = participantLinks.filter((link) =>
      relationIds.has(link.relationId) &&
      (link.sourceRecordId === targetRecordId || link.targetRecordId === targetRecordId));
    const pairKey = (relationId: number, s: number, t: number) => `${relationId}:${s}:${t}`;
    const existingPairs = new Set(targetLinks.map((l) => pairKey(l.relationId, l.sourceRecordId, l.targetRecordId)));
    const sourceSideTaken = new Set(
      targetLinks.filter((l) => l.sourceRecordId === targetRecordId).map((l) => l.relationId),
    );
    const targetSideTaken = new Set(
      targetLinks.filter((l) => l.targetRecordId === targetRecordId).map((l) => l.relationId),
    );

    for (const link of links) {
      const newSource = sourceIdSet.has(link.sourceRecordId) ? targetRecordId : link.sourceRecordId;
      const newTarget = sourceIdSet.has(link.targetRecordId) ? targetRecordId : link.targetRecordId;
      const sourceUnique = link.relationType === "one_to_one" || link.relationType === "many_to_one";
      const targetUnique = link.relationType === "one_to_one" || link.relationType === "one_to_many";
      const drop =
        newSource === newTarget || // would link the target to itself
        existingPairs.has(pairKey(link.relationId, newSource, newTarget)) || // identical link exists
        (sourceUnique && newSource === targetRecordId && link.sourceRecordId !== targetRecordId && sourceSideTaken.has(link.relationId)) ||
        (targetUnique && newTarget === targetRecordId && link.targetRecordId !== targetRecordId && targetSideTaken.has(link.relationId));
      if (drop) {
        await tx.delete(recordLinksTable).where(eq(recordLinksTable.id, link.id));
        // A dropped link changes the surviving target only when the target was
        // already one endpoint. Duplicate/cardinality drops of source-only
        // links leave the target's effective relation set unchanged.
        if (link.sourceRecordId === targetRecordId || link.targetRecordId === targetRecordId) {
          targetLinkStateChanged = true;
        }
        for (const id of [link.sourceRecordId, link.targetRecordId]) {
          if (!sourceIdSet.has(id) && id !== targetRecordId) changedLinkedSurvivors.add(id);
        }
        continue;
      }
      await tx
        .update(recordLinksTable)
        .set({ sourceRecordId: newSource, targetRecordId: newTarget })
        .where(eq(recordLinksTable.id, link.id));
      movedLinks += 1;
      targetLinkStateChanged = true;
      for (const id of [link.sourceRecordId, link.targetRecordId, newSource, newTarget]) {
        if (!sourceIdSet.has(id) && id !== targetRecordId) changedLinkedSurvivors.add(id);
      }
      existingPairs.add(pairKey(link.relationId, newSource, newTarget));
      if (newSource === targetRecordId) sourceSideTaken.add(link.relationId);
      if (newTarget === targetRecordId) targetSideTaken.add(link.relationId);
    }

    // ---- 2. Fill the target's empty fields from the sources ------------
    const targetValues = { ...((target.valuesJson as Record<string, unknown>) ?? {}) };
    const auditEntries: InsertAuditLog[] = [];
    for (const f of fields) {
      if (f.fieldType === "relation" || f.fieldType === "lookup" || f.fieldType === "function" || f.fieldType === "created_at") continue;
      if (!mergeValueEmpty(targetValues[f.fieldKey])) continue;
      for (const srcId of sourceIds) {
        const srcValues = (byId.get(srcId)!.valuesJson as Record<string, unknown>) ?? {};
        const v = srcValues[f.fieldKey];
        if (mergeValueEmpty(v)) continue;
        targetValues[f.fieldKey] = v;
        filledFields += 1;
        filledFieldKeys.push(f.fieldKey);
        if (f.fieldType === "file") inheritedFileKeys.add(f.fieldKey);
        auditEntries.push({
          entityId,
          recordId: targetRecordId,
          fieldKey: f.fieldKey,
          oldValue: null,
          newValue: auditStr(v),
          userId: req.user!.userId,
        });
        break;
      }
    }
    if (filledFields > 0) {
      // isKey uniqueness on inherited values, under the same advisory lock as
      // normal writes. The duplicate-holding SOURCE records don't count (they
      // are deleted by this merge); any OTHER record owning the value aborts.
      const keyFields = fields.filter((f) => f.isKey && filledFieldKeys.includes(f.fieldKey));
      if (keyFields.length > 0) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${UNIQUE_KEY_LOCK_NS}, ${entityId})`);
        for (const f of keyFields) {
          const raw = targetValues[f.fieldKey];
          if (raw == null || raw === "") continue;
          const v = typeof raw === "string" ? raw.trim() : String(raw);
          const valueExpr = sql`lower(trim(${entityRecordsTable.valuesJson} ->> ${f.fieldKey}))`;
          const [hit] = await tx
            .select({ id: entityRecordsTable.id })
            .from(entityRecordsTable)
            .where(
              and(
                eq(entityRecordsTable.entityId, entityId),
                sql`${valueExpr} = ${v.trim().toLowerCase()}`,
                sql`${entityRecordsTable.id} NOT IN (${sql.join([targetRecordId, ...sourceIds].map((n) => sql`${n}`), sql`, `)})`,
              )!,
            )
            .limit(1);
          if (hit) throw new UniqueKeyError(`Поле «${fieldRuName(f)}»: значение «${v}» уже используется в другой записи`);
        }
      }
    }

    // Compute every values_json transfer before taking any Drive lock. One
    // sorted union prevents two multi-file merges from acquiring file locks in
    // opposite incremental orders.
    const pageRows = await tx
      .select()
      .from(pageRecordValuesTable)
      .where(inArray(pageRecordValuesTable.recordId, participantIds))
      .orderBy(asc(pageRecordValuesTable.pageId), asc(pageRecordValuesTable.recordId))
      .for("update");
    const targetPageRows = new Map(pageRows.filter((r) => r.recordId === targetRecordId).map((r) => [r.pageId, r]));
    const sourcePageRows = pageRows.filter((r) => sourceIdSet.has(r.recordId));
    const mergedByPage = new Map<number, Record<string, unknown>>();
    for (const row of sourcePageRows) {
      const acc = mergedByPage.get(row.pageId) ?? {};
      const vals = (row.valuesJson as Record<string, unknown>) ?? {};
      for (const [k, v] of Object.entries(vals)) {
        if (mergeValueEmpty(v) || !mergeValueEmpty(acc[k])) continue;
        acc[k] = v;
      }
      mergedByPage.set(row.pageId, acc);
    }
    const pageValueTransitions: {
      pageId: number;
      existing: typeof pageRecordValuesTable.$inferSelect | undefined;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      changedPageFieldKeys: string[];
    }[] = [];
    for (const [pageId, srcVals] of [...mergedByPage.entries()].sort((a, b) => a[0] - b[0])) {
      const existing = targetPageRows.get(pageId);
      const before = (existing?.valuesJson as Record<string, unknown> | undefined) ?? {};
      const after = { ...before };
      const changedPageFieldKeys: string[] = [];
      for (const [k, v] of Object.entries(srcVals)) {
        if (!mergeValueEmpty(after[k])) continue;
        after[k] = v;
        changedPageFieldKeys.push(k);
      }
      if (changedPageFieldKeys.length > 0) {
        pageValueTransitions.push({ pageId, existing, before, after, changedPageFieldKeys });
      }
    }
    const driveLockValues: unknown[] = [target.valuesJson, targetValues];
    for (const transition of pageValueTransitions) driveLockValues.push(transition.before, transition.after);
    // Include source maps too: transfer must serialize with deletion even when
    // the target already happened to contain the same ID.
    for (const sourceId of sourceIds) driveLockValues.push(byId.get(sourceId)!.valuesJson);
    for (const row of sourcePageRows) driveLockValues.push(row.valuesJson);
    await lockGdriveFileIds(tx, canonicalGdriveFileIdUnion(driveLockValues));
    await validateGdriveFileReferencesUnderLock(tx, target.valuesJson, targetValues);
    for (const transition of pageValueTransitions) {
      await validateGdriveFileReferencesUnderLock(tx, transition.before, transition.after);
    }

    if (filledFields > 0 || targetLinkStateChanged) {
      // One physical target update covers both scalar fill and relation-state
      // invalidation, so the version trigger advances exactly once.
      const mergedUserRefError = await validateUserRefs(fields, targetValues, tx);
      if (mergedUserRefError) throw new Error(mergedUserRefError);
      const [updatedTarget] = await tx
        .update(entityRecordsTable)
        .set({ valuesJson: targetValues, updatedAt: new Date() })
        .where(eq(entityRecordsTable.id, targetRecordId))
        .returning({ version: entityRecordsTable.version });
      mergedTargetVersion = updatedTarget!.version;
    }
    if (changedLinkedSurvivors.size > 0) {
      const touched = await tx.update(entityRecordsTable).set({ updatedAt: new Date() })
        .where(inArray(entityRecordsTable.id, [...changedLinkedSurvivors]))
        .returning({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, version: entityRecordsTable.version });
      for (const row of touched) linkedSurvivorVersions.set(row.id, { entityId: row.entityId, version: row.version });
    }

    // ---- 3. Merge page-local values (fill-empty, per page) -------------
    // Page writers use the advisory keys and rows acquired above; all Drive
    // references are covered by the already-held sorted union.
    for (const { pageId, existing, after: current, changedPageFieldKeys } of pageValueTransitions) {
      let written: { version: number } | undefined;
      if (existing) {
        [written] = await tx.update(pageRecordValuesTable)
          .set({ valuesJson: current })
          .where(eq(pageRecordValuesTable.id, existing.id))
          .returning({ version: pageRecordValuesTable.version });
      } else {
        [written] = await tx.insert(pageRecordValuesTable)
          .values({ pageId, recordId: targetRecordId, valuesJson: current })
          .returning({ version: pageRecordValuesTable.version });
      }
      if (written) {
        const prior = changedTargetPageRows.get(pageId);
        changedTargetPageRows.set(pageId, {
          version: written.version,
          changedPageFieldKeys: new Set([
            ...(prior?.changedPageFieldKeys ?? []),
            ...changedPageFieldKeys,
          ]),
        });
      }
    }

    if (auditEntries.length > 0) await writeAudit(auditEntries, req.log);

    // Delete while the relation and source-record locks are still held. A link
    // writer that started concurrently either committed before our locks (and
    // was included above) or waits and then observes the source no longer exists.
    for (const srcId of sourceIds) {
      const src = byId.get(srcId)!;
      const values = { ...((src.valuesJson as Record<string, unknown>) ?? {}) };
      for (const key of inheritedFileKeys) delete values[key];
      deletedSnapshots.set(srcId, {
        values,
        pageFileEntries: pageRows
          .filter((row) => row.recordId === srcId)
          .map((row) => ({
            pageId: row.pageId,
            valuesJson: (row.valuesJson as Record<string, unknown>) ?? {},
          })),
      });
      const deleted = await tx.delete(entityRecordsTable)
        .where(and(eq(entityRecordsTable.id, srcId), eq(entityRecordsTable.version, src.version)))
        .returning({ id: entityRecordsTable.id });
      if (deleted.length !== 1) throw new Error("Locked merge source disappeared");
    }
  });
  } catch (err) {
    if (err instanceof MergeRecordNotFoundError) {
      res.status(404).json({ error: "Record not found in this entity" });
      return;
    }
    if (err instanceof UserReferenceBusyError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof UniqueKeyError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof DriveFileTombstonedError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }

  // ---- 4. Post-commit source-delete bookkeeping ------------------------
  // Physical deletion happened atomically above; retain the shared core's
  // trash, audit and event behavior without reopening a link-create race.
  const deletedRecordIds: number[] = [];
  for (const srcId of sourceIds) {
    const snapshot = deletedSnapshots.get(srcId)!;
    try {
      await finalizeRecordDelete(req, entityId, srcId, snapshot.values, snapshot.pageFileEntries);
      deletedRecordIds.push(srcId);
    } catch (err) {
      req.log.error({ err, recordId: srcId }, "merge: source record delete failed");
    }
  }

  await emitEvent(
    [
      ...(mergedTargetVersion != null && (filledFields > 0 || targetLinkStateChanged) ? [{
        eventName: EVENT_RECORD_UPDATED,
        entityId,
        recordId: targetRecordId,
        payload: { actorUserId: req.user!.userId, changedFields: filledFieldKeys, version: mergedTargetVersion },
      }] : []),
      ...[...linkedSurvivorVersions.entries()].map(([recordId, state]) => ({
        eventName: EVENT_RECORD_UPDATED,
        entityId: state.entityId,
        recordId,
        payload: { actorUserId: req.user!.userId, changedFields: [], version: state.version },
      })),
      ...[...changedTargetPageRows.entries()].map(([pageId, state]) => ({
        eventName: EVENT_PAGE_FIELD_SAVED,
        entityId,
        recordId: targetRecordId,
        payload: {
          actorUserId: req.user!.userId,
          pageId,
          changedPageFieldKeys: [...state.changedPageFieldKeys],
          version: state.version,
        },
      })),
    ],
    req.log,
  );

  res.json({ movedLinks, filledFields, deletedRecordIds });
});

export default router;
