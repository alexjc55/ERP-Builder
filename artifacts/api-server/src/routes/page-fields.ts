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
  usersTable,
  userRolesTable,
  type PageField,
  type Relation,
  type RelationFieldConfig,
  type DependencyFieldConfig,
  type FieldPermissions,
  type EntityField,
} from "@workspace/db";
import { eq, asc, desc, and, ne, inArray, or, sql, type SQL } from "drizzle-orm";
import { relationLinkLockViolation } from "../lib/relation-lock";
import { sanitizeOptionsInput, normalizeOptions, optionValues, optionNumbers, type SelectOption } from "../lib/selectOptions";
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
import { emitEvent, EVENT_PAGE_FIELD_SAVED } from "../lib/events";
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

// A percent-field option value must be a plain number (stored record value is
// numeric so it can be averaged and used in formulas).
const PERCENT_NUM_RE = /^-?[0-9]+(\.[0-9]+)?$/;

// Drizzle wraps the pg driver error, so the SQLSTATE code (23505 for a unique
// violation) can live on err.cause rather than the top-level error. Walk the
// cause chain — checking only the top level silently misclassifies wrapped
// unique violations as generic 500s (e.g. a record_links cardinality conflict).
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
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
export async function effectiveEntityForPage(
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
): Promise<{ ok: true; cleaned: RelationFieldConfig } | { error: string }> {
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

  // Page-source: project a page-local field of the related entity's page. Both
  // relation and lookup page fields may use it; the cleaned config never carries
  // writeThrough (page fields have no per-page nav affordance anyway).
  const relatedPageId = cfg?.relatedPageId ?? null;
  if (relatedPageId != null) {
    const pageCheck = await validateRelatedPageSource(relatedPageId, relatedEntityId, relatedFieldKey);
    if ("error" in pageCheck) return pageCheck;
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
  if (!rf) return { error: "Related field not found on the related entity" };
  // Entity-source: strip any stray relatedPageId/writeThrough. Page fields never
  // offer write-through (no per-page nav affordance), so it is always dropped.
  return { ok: true, cleaned: { relationId, relatedFieldKey } };
}

/**
 * Validate that a lookup's `relatedPageId` page belongs to the relation's
 * related entity and that `relatedFieldKey` is an active value-backed page field
 * of that page (function/relation/lookup page fields cannot be projected).
 */
async function validateRelatedPageSource(
  relatedPageId: number,
  relatedEntityId: number,
  relatedFieldKey: string,
): Promise<{ ok: true } | { error: string }> {
  const pageEff = await effectiveEntityForPage(relatedPageId);
  if (!pageEff.found || pageEff.entityId == null) return { error: "Lookup page not found" };
  if (pageEff.entityId !== relatedEntityId) {
    return { error: "Lookup page does not belong to the related entity" };
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
  if (!pf) return { error: "Lookup page field not found" };
  if (pf.fieldType === "function" || pf.fieldType === "relation" || pf.fieldType === "lookup") {
    return { error: "This page field cannot be used as a lookup source" };
  }
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
 * Return the set of keys whose value differs between two page-value maps
 * (including keys added or removed). Values are compared by JSON identity — the
 * stored values are JSONB scalars/arrays, so this is a stable equality check.
 */
function diffChangedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) changed.push(k);
  }
  return changed;
}

/**
 * Validate a page-local values object against the page's active page-fields.
 * `function`-type fields are computed at read time and are never stored, so any
 * incoming value for them is ignored. Unknown keys are rejected.
 */
export function validatePageValues(
  fields: PageField[],
  values: Record<string, unknown>,
): { values: Record<string, unknown> } | { error: string } {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
  for (const key of Object.keys(values)) {
    if (!byKey.has(key)) return { error: `Unknown page field: ${key}` };
  }
  const cleaned: Record<string, unknown> = {};
  for (const field of fields) {
    // `function` (computed), `relation` (derived from a linked record and
    // written back to that record), and `lookup` (read-only projection of a
    // linked record's field) are never stored as page-local values.
    if (
      field.fieldType === "function" ||
      field.fieldType === "relation" ||
      field.fieldType === "lookup"
    )
      continue;
    const raw = values[field.fieldKey];
    if (isEmpty(raw)) {
      // Page-local values are filled INCREMENTALLY (inline, one cell at a time)
      // and a mirror-page row is created as a two-step, non-atomic write (entity
      // record first, page values after) — so there is no single moment where the
      // whole page-value map is submitted. Enforcing `isRequired` here would make
      // required page fields unfillable inline: the first single-cell save would
      // fail because the OTHER still-empty required fields look "missing". So
      // requiredness on page fields is a client-side hint only; the server
      // type-validates whatever is provided and skips empties.
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
        if ((field.percentConfigJson?.mode ?? "value") === "list" && !optionNumbers(field.optionsJson).has(num)) {
          return { error: `Field "${field.fieldKey}" must be one of the allowed options` };
        }
        cleaned[field.fieldKey] = num;
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
  const createOptions = sanitizeOptionsInput(parsed.data.optionsJson);
  if (parsed.data.fieldType === "select" && createOptions.length === 0) {
    res.status(400).json({ error: "Select fields require at least one option" });
    return;
  }
  if (parsed.data.fieldType === "percent" && (parsed.data.percentConfigJson?.mode ?? "value") === "list") {
    if (createOptions.length === 0) {
      res.status(400).json({ error: "Поле «Проценты» в режиме списка требует хотя бы один вариант" });
      return;
    }
    if (createOptions.some((o) => !PERCENT_NUM_RE.test(o.value))) {
      res.status(400).json({ error: "Значения вариантов процентного поля должны быть числами" });
      return;
    }
  }
  const createPageName = parsed.data.nameJson as Record<string, unknown> | null | undefined;
  if (!createPageName || !Object.values(createPageName).some((v) => typeof v === "string" && v.trim() !== "")) {
    res.status(400).json({ error: "Укажите название хотя бы на одном языке" });
    return;
  }
  let relationConfigToInsert: RelationFieldConfig | null | undefined = parsed.data.relationConfigJson;
  if (parsed.data.fieldType === "relation" || parsed.data.fieldType === "lookup") {
    const check = await validateRelationFieldConfig(
      params.data.pageId,
      parsed.data.relationConfigJson,
    );
    if ("error" in check) {
      res.status(400).json({ error: check.error });
      return;
    }
    relationConfigToInsert = check.cleaned;
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
        optionsJson: createOptions,
        formulaConfigJson: clampFormulaDecimals(parsed.data.formulaConfigJson),
        percentConfigJson: clampFormulaDecimals(parsed.data.percentConfigJson),
        relationConfigJson: relationConfigToInsert ?? {},
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
  const sanitizedOptions = body.optionsJson != null ? sanitizeOptionsInput(body.optionsJson) : null;
  if ("optionsJson" in body || body.fieldType != null) {
    const nextOptions = sanitizedOptions ?? normalizeOptions(current.optionsJson);
    if (nextType === "select" && nextOptions.length === 0) {
      res.status(400).json({ error: "Select fields require at least one option" });
      return;
    }
  }
  {
    const nextPercentMode = body.percentConfigJson?.mode ?? current.percentConfigJson?.mode ?? "value";
    if (nextType === "percent" && nextPercentMode === "list") {
      const nextOpts = sanitizedOptions ?? normalizeOptions(current.optionsJson);
      if (nextOpts.length === 0) {
        res.status(400).json({ error: "Поле «Проценты» в режиме списка требует хотя бы один вариант" });
        return;
      }
      if (nextOpts.some((o) => !PERCENT_NUM_RE.test(o.value))) {
        res.status(400).json({ error: "Значения вариантов процентного поля должны быть числами" });
        return;
      }
    }
  }
  let relationConfigToPersist: RelationFieldConfig | null | undefined;
  if (nextType === "relation" || nextType === "lookup") {
    const nextCfg =
      "relationConfigJson" in body
        ? body.relationConfigJson
        : (current.relationConfigJson as RelationFieldConfig | null);
    const check = await validateRelationFieldConfig(current.pageId, nextCfg);
    if ("error" in check) {
      res.status(400).json({ error: check.error });
      return;
    }
    relationConfigToPersist = check.cleaned;
  } else if (body.fieldType != null) {
    // Switching away from relation/lookup: clear any stored relation config.
    relationConfigToPersist = null;
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
  if (body.isFilterable != null) updateData.isFilterable = body.isFilterable;
  if (body.pivotEnabled != null) updateData.pivotEnabled = body.pivotEnabled;
  if ("defaultValue" in body) updateData.defaultValue = body.defaultValue ?? null;
  if (sanitizedOptions != null) updateData.optionsJson = sanitizedOptions;
  if (body.formatRulesJson != null) updateData.formatRulesJson = body.formatRulesJson;
  if (body.formulaConfigJson != null)
    updateData.formulaConfigJson = clampFormulaDecimals(body.formulaConfigJson);
  if (body.percentConfigJson != null)
    updateData.percentConfigJson = clampFormulaDecimals(body.percentConfigJson);
  if (relationConfigToPersist !== undefined) {
    updateData.relationConfigJson = relationConfigToPersist ?? {};
  } else if ("relationConfigJson" in body) {
    updateData.relationConfigJson = body.relationConfigJson ?? {};
  }
  if ("permissionsJson" in body) updateData.permissionsJson = body.permissionsJson ?? {};
  if (body.sortOrder != null) updateData.sortOrder = body.sortOrder;
  if (body.isActive != null) updateData.isActive = body.isActive;
  if (body.showInTable != null) updateData.showInTable = body.showInTable;
  if (body.isPinned != null) updateData.isPinned = body.isPinned;
  if (body.showColumnTotal != null) updateData.showColumnTotal = body.showColumnTotal;
  if ("totalFillColor" in body) updateData.totalFillColor = body.totalFillColor ?? null;
  if ("totalTextColor" in body) updateData.totalTextColor = body.totalTextColor ?? null;
  if ("columnGroupId" in body) updateData.columnGroupId = body.columnGroupId ?? null;
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
  // Emit a best-effort event for any page-field whose value actually changed,
  // so automations with a `page_field_changed` trigger can react. The event
  // carries the page's effective entity so the engine can find that entity's
  // automations. Never let a failed emit break the write.
  const changedPageFieldKeys = diffChangedKeys(
    (existing?.valuesJson as Record<string, unknown> | undefined) ?? {},
    result.values,
  );
  if (changedPageFieldKeys.length > 0) {
    await emitEvent(
      {
        eventName: EVENT_PAGE_FIELD_SAVED,
        entityId,
        recordId,
        payload: { pageId, changedPageFieldKeys, actorUserId: req.user!.userId },
      },
      req.log,
    );
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

/** Bounded depth for chained ("double-hop") lookups; also a cycle guard. */
const MAX_LOOKUP_HOPS = 8;

interface LookupResolveCtx {
  perms: Awaited<ReturnType<typeof getPermissions>>;
  roleIds: number[];
  userId: number;
}

interface ChainResolution {
  /** First-hop access after the full-chain gate: "hidden" if ANY hop is view-blocked. */
  access: "hidden" | "view" | "edit";
  /** The TERMINAL (deepest) field's type, used by the client to render the value. */
  relatedFieldType: string | null;
  /** The terminal field's select options (empty for non-select terminals). */
  optionsJson: SelectOption[];
  /** host recordId -> projected value, present only for viewable records (value may be null). */
  valueByRecordId: Map<number, unknown>;
}

/**
 * Resolve a lookup/relation projection, following the target record's OWN
 * relation/lookup field when the projected field is itself a relation/lookup
 * ("double-hop"). Recursion re-applies the FULL RBAC boundary at every hop —
 * related-entity record view, projected-field hidden access, related own-row
 * scope, and row-hidden-status exclusion — so a deeper hop can never surface a
 * value the viewer could not read directly. This is the single source of truth
 * used by both related-values endpoints for chained columns; keep it in lockstep
 * with the inline first-hop logic (audit-field-security invariant).
 */
async function resolveChainValues(
  hostEntityId: number,
  recordIds: number[],
  relationId: number,
  relatedFieldKey: string,
  relatedPageId: number | null,
  ctx: LookupResolveCtx,
  depth: number,
): Promise<ChainResolution> {
  const empty: ChainResolution = {
    access: "hidden",
    relatedFieldType: null,
    optionsJson: [],
    valueByRecordId: new Map(),
  };
  if (recordIds.length === 0) return empty;

  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
  if (!relation) return empty;
  const direction = relationDirection(relation, hostEntityId);
  if (!direction) return empty;
  const relatedEntityId = relatedEntityIdFor(relation, direction);

  const { perms, roleIds, userId } = ctx;
  const canViewRelated = canRecord(perms, relatedEntityId, "view");
  const relScope = effectiveScope(perms, relatedEntityId);

  // Resolve the projected field's metadata + visibility (page-source or own field).
  let access: "hidden" | "view" | "edit";
  let relatedFieldType: string | null;
  let optionsJson: SelectOption[];
  let projectedField: EntityField | null = null;
  if (relatedPageId != null) {
    const [rpf] = await db
      .select({
        fieldType: pageFieldsTable.fieldType,
        optionsJson: pageFieldsTable.optionsJson,
        permissionsJson: pageFieldsTable.permissionsJson,
      })
      .from(pageFieldsTable)
      .where(
        and(
          eq(pageFieldsTable.pageId, relatedPageId),
          eq(pageFieldsTable.fieldKey, relatedFieldKey),
          eq(pageFieldsTable.isActive, true),
        ),
      );
    if (!rpf) return empty;
    const pagePerm = mostPermissiveFieldPerm(rpf.permissionsJson as FieldPermissions | null, roleIds, "view");
    access = canViewRelated && pagePerm !== "hidden" ? "view" : "hidden";
    relatedFieldType = access === "hidden" ? null : rpf.fieldType;
    optionsJson = access === "hidden" ? [] : normalizeOptions(rpf.optionsJson);
  } else {
    const [rf] = await db
      .select()
      .from(entityFieldsTable)
      .where(
        and(
          eq(entityFieldsTable.entityId, relatedEntityId),
          eq(entityFieldsTable.fieldKey, relatedFieldKey),
          eq(entityFieldsTable.isActive, true),
        ),
      );
    if (!rf) return empty;
    projectedField = rf;
    access = canViewRelated ? resolveFieldAccess(rf, perms, roleIds, relatedEntityId) : "hidden";
    relatedFieldType = access === "hidden" ? null : rf.fieldType;
    optionsJson = access === "hidden" ? [] : normalizeOptions(rf.optionsJson);
  }
  if (access === "hidden") return empty;

  // host record -> single linked record id.
  const linkRows =
    direction === "source"
      ? await db
          .select({ from: recordLinksTable.sourceRecordId, to: recordLinksTable.targetRecordId })
          .from(recordLinksTable)
          .where(and(eq(recordLinksTable.relationId, relationId), inArray(recordLinksTable.sourceRecordId, recordIds)))
      : await db
          .select({ from: recordLinksTable.targetRecordId, to: recordLinksTable.sourceRecordId })
          .from(recordLinksTable)
          .where(and(eq(recordLinksTable.relationId, relationId), inArray(recordLinksTable.targetRecordId, recordIds)));
  const linkMap = new Map<number, number>();
  for (const l of linkRows) linkMap.set(l.from, l.to);
  const linkedIds = Array.from(new Set(linkRows.map((l) => l.to)));
  if (linkedIds.length === 0) return { access, relatedFieldType, optionsJson, valueByRecordId: new Map() };

  // Load only the VIEWABLE linked records (row-hidden status + related own-scope).
  const relHiddenRowWhere = hiddenRowStatusWhere(effectiveStatusVisibility(perms, relatedEntityId).hiddenRowStatusIds);
  const linkedConds: SQL[] = [
    eq(entityRecordsTable.entityId, relatedEntityId),
    inArray(entityRecordsTable.id, linkedIds),
  ];
  if (relHiddenRowWhere) linkedConds.push(relHiddenRowWhere);
  if (relScope.scope === "own") {
    const relatedFields = await loadActiveEntityFields(relatedEntityId);
    linkedConds.push(await ownScopeWhere(relatedEntityId, relScope.scopeFieldKeys, userId, relatedFields));
  }
  const linkedRecords = await db
    .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(...linkedConds));
  const linkedMap = new Map<number, Record<string, unknown>>();
  for (const lr of linkedRecords) linkedMap.set(lr.id, (lr.valuesJson as Record<string, unknown>) ?? {});

  // Recurse when the projected field is itself an entity-source relation/lookup.
  const projectedIsChain =
    relatedPageId == null &&
    projectedField != null &&
    (projectedField.fieldType === "relation" || projectedField.fieldType === "lookup") &&
    depth < MAX_LOOKUP_HOPS;

  let terminalType = relatedFieldType;
  let terminalOptions = optionsJson;
  const linkedValueMap = new Map<number, unknown>(); // linkedId -> projected value

  if (projectedIsChain) {
    const pcfg = projectedField!.relationConfigJson as RelationFieldConfig | null;
    const pRelId = pcfg?.relationId ?? null;
    const pKey = pcfg?.relatedFieldKey ?? null;
    if (pRelId == null || !pKey) {
      return { access, relatedFieldType: null, optionsJson: [], valueByRecordId: new Map() };
    }
    const inner = await resolveChainValues(
      relatedEntityId,
      Array.from(linkedMap.keys()),
      pRelId,
      pKey,
      pcfg?.relatedPageId ?? null,
      ctx,
      depth + 1,
    );
    if (inner.access === "hidden") {
      return { access: "hidden", relatedFieldType: null, optionsJson: [], valueByRecordId: new Map() };
    }
    terminalType = inner.relatedFieldType;
    terminalOptions = inner.optionsJson;
    for (const [id, v] of inner.valueByRecordId) linkedValueMap.set(id, v);
  } else if (relatedPageId != null) {
    const allowedLinkedIds = Array.from(linkedMap.keys());
    const pageValuesMap = new Map<number, Record<string, unknown>>();
    if (allowedLinkedIds.length > 0) {
      const prv = await db
        .select({ recordId: pageRecordValuesTable.recordId, valuesJson: pageRecordValuesTable.valuesJson })
        .from(pageRecordValuesTable)
        .where(and(eq(pageRecordValuesTable.pageId, relatedPageId), inArray(pageRecordValuesTable.recordId, allowedLinkedIds)));
      for (const r of prv) pageValuesMap.set(r.recordId, (r.valuesJson as Record<string, unknown>) ?? {});
    }
    for (const id of linkedMap.keys()) linkedValueMap.set(id, pageValuesMap.get(id)?.[relatedFieldKey] ?? null);
  } else {
    for (const [id, vals] of linkedMap) linkedValueMap.set(id, vals[relatedFieldKey] ?? null);
  }

  const valueByRecordId = new Map<number, unknown>();
  for (const rid of recordIds) {
    const linkedId = linkMap.get(rid);
    if (linkedId == null || !linkedMap.has(linkedId)) continue; // no link, or linked record not viewable
    valueByRecordId.set(rid, linkedValueMap.get(linkedId) ?? null);
  }
  return { access, relatedFieldType: terminalType, optionsJson: terminalOptions, valueByRecordId };
}

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
          inArray(pageFieldsTable.fieldType, ["relation", "lookup"]),
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
    optionsJson: SelectOption[];
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
    // Page-source: project a PAGE-LOCAL field of the linked record from
    // page_record_values, not one of the linked entity record's own fields.
    // Applies to both relation and lookup page fields.
    const relatedPageId = cfg?.relatedPageId ?? null;

    const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
    if (!relation) continue;
    const direction = relationDirection(relation, entityId);
    if (!direction) continue;
    const relatedEntityId = relatedEntityIdFor(relation, direction);

    // Re-apply the related entity's RECORD-VIEW boundary first: a viewer with no
    // view permission on the related entity must get nothing from it.
    const canViewRelated = canRecord(perms, relatedEntityId, "view");
    const relScope = effectiveScope(perms, relatedEntityId);

    // Resolve the projected field's metadata + visibility from the right source:
    // a page field (page-source lookup) or the linked entity's own field.
    let access: "hidden" | "view" | "edit";
    let relatedFieldType: string | null;
    let optionsJson: SelectOption[];
    let projectedChain = false;
    if (relatedPageId != null) {
      const [relatedPageField] = await db
        .select({
          fieldType: pageFieldsTable.fieldType,
          optionsJson: pageFieldsTable.optionsJson,
          permissionsJson: pageFieldsTable.permissionsJson,
        })
        .from(pageFieldsTable)
        .where(
          and(
            eq(pageFieldsTable.pageId, relatedPageId),
            eq(pageFieldsTable.fieldKey, relatedFieldKey),
            eq(pageFieldsTable.isActive, true),
          ),
        );
      if (!relatedPageField) continue;
      const projPerm = mostPermissiveFieldPerm(
        relatedPageField.permissionsJson as FieldPermissions | null,
        roleIds,
        "view",
      );
      access = canViewRelated && projPerm !== "hidden" ? "view" : "hidden";
      relatedFieldType = access === "hidden" ? null : relatedPageField.fieldType;
      optionsJson = access === "hidden" ? [] : normalizeOptions(relatedPageField.optionsJson);
    } else {
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
      // resolveFieldAccess defaults to "view" when no explicit field perm exists,
      // so treat lack of related-entity view as hidden (no type, value, or id).
      access = canViewRelated ? resolveFieldAccess(relatedField, perms, roleIds, relatedEntityId) : "hidden";
      relatedFieldType = access === "hidden" ? null : relatedField.fieldType;
      optionsJson = access === "hidden" ? [] : normalizeOptions(relatedField.optionsJson);
      // Double-hop: when the projected field is itself an entity-source
      // relation/lookup, follow it one more hop (recursively) instead of reading
      // values_json (which has no scalar for it). resolveChainValues re-applies
      // the full RBAC boundary at every hop.
      if (relatedField.fieldType === "relation" || relatedField.fieldType === "lookup") {
        projectedChain = true;
      }
    }

    // Resolve the chained value/metadata once per column (entity-source only).
    let chain: ChainResolution | null = null;
    if (projectedChain && access !== "hidden") {
      chain = await resolveChainValues(entityId, allowedIds, relationId, relatedFieldKey, relatedPageId, { perms, roleIds, userId }, 0);
      relatedFieldType = chain.access === "hidden" ? null : chain.relatedFieldType;
      optionsJson = chain.optionsJson;
      if (chain.access === "hidden") access = "hidden";
    }

    const pagePerm = mostPermissiveFieldPerm(pf.permissionsJson as FieldPermissions | null, roleIds, "edit");
    // The column ASSIGNS the link (not edits the related value): a cell is
    // assignable when the viewer may edit this page-field column, can update the
    // base entity's records (links belong to the base record), and the related
    // field is not hidden. Column-wide, so EMPTY cells are assignable too.
    // A lookup page field is read-only: it projects a field of the linked record
    // and never assigns the link, so its column is never editable.
    const columnEditable =
      pf.fieldType !== "lookup" &&
      pagePerm === "edit" && access !== "hidden" && canRecord(perms, entityId, "update");

    columns.push({
      fieldKey: pf.fieldKey,
      relatedFieldKey,
      relatedFieldType,
      optionsJson,
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

    // Load the linked records once for related own-scope + row-hidden gating.
    // For page-source lookups linkedMap carries only membership; the projected
    // value comes from pageValuesMap.
    const linkedIds = Array.from(new Set(linkRows.map((l) => l.to)));
    const linkedMap = new Map<number, Record<string, unknown>>();
    const pageValuesMap = new Map<number, Record<string, unknown>>();
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
      if (relatedPageId != null) {
        const allowedLinkedIds = Array.from(linkedMap.keys());
        if (allowedLinkedIds.length > 0) {
          const prv = await db
            .select({ recordId: pageRecordValuesTable.recordId, valuesJson: pageRecordValuesTable.valuesJson })
            .from(pageRecordValuesTable)
            .where(
              and(
                eq(pageRecordValuesTable.pageId, relatedPageId),
                inArray(pageRecordValuesTable.recordId, allowedLinkedIds),
              ),
            );
          for (const r of prv) pageValuesMap.set(r.recordId, (r.valuesJson as Record<string, unknown>) ?? {});
        }
      }
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
          value = chain
            ? chain.valueByRecordId.get(recordId) ?? null
            : relatedPageId != null
              ? pageValuesMap.get(rawLinkedId)?.[relatedFieldKey] ?? null
              : linkedValues[relatedFieldKey] ?? null;
        }
      }
      // Do not leak the linked record's identifier when its content is not
      // visible (hidden field access or related own-scope): the id is only
      // exposed for cells the viewer can actually read. Existence of restricted
      // related rows stays hidden.
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
 * Shape shared by both relation-field resolvers describing the projected
 * (related) field. For entity-source the value/label comes from one of the
 * related entity record's own fields; for page-source (`relatedPageId` set) it
 * comes from a PAGE-LOCAL field of the related entity (page_record_values).
 */
type ResolvedRelatedField = {
  relatedEntityId: number;
  relatedField: typeof entityFieldsTable.$inferSelect | null;
  relatedPageId: number | null;
  relatedPagePerms: FieldPermissions | null;
};

/**
 * Compute the viewer's access to the projected related field, uniformly across
 * entity-source and page-source. Page-source uses the related PAGE field's own
 * per-role permissions; entity-source uses the entity field's. Either way a
 * viewer who cannot view the related entity's records gets "hidden".
 */
function resolveRelatedAccess(
  resolved: ResolvedRelatedField,
  perms: Awaited<ReturnType<typeof getPermissions>>,
  roleIds: number[],
): "hidden" | "view" | "edit" {
  if (!canRecord(perms, resolved.relatedEntityId, "view")) return "hidden";
  if (resolved.relatedPageId != null) {
    return mostPermissiveFieldPerm(resolved.relatedPagePerms, roleIds, "view") === "hidden" ? "hidden" : "view";
  }
  return resolveFieldAccess(resolved.relatedField!, perms, roleIds, resolved.relatedEntityId);
}

/**
 * List up to 50 candidate related-entity records (newest first), each labelled
 * by the projected related field, applying the caller-built RBAC/scope `conds`
 * and an optional case-insensitive search over the label. For page-source the
 * label + search read the related PAGE field from page_record_values; otherwise
 * they read the related entity record's own field.
 */
/**
 * Render a candidate's projected value as a label. Only scalar (string / number
 * / boolean) projections yield a label; object-valued projections (e.g. a lookup
 * pointing at a `file` or relation field whose JSONB value is an object) render
 * empty so the picker drops them instead of showing "[object Object]".
 */
function candidateLabel(v: unknown): string {
  if (v == null) return "";
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean" ? String(v) : "";
}

async function loadCandidateRows(
  relatedEntityId: number,
  relatedFieldKey: string,
  relatedPageId: number | null,
  conds: SQL[],
  q: string | undefined,
): Promise<{ id: number; label: string }[]> {
  if (relatedPageId != null) {
    const searchConds = q
      ? [
          ...conds,
          inArray(
            entityRecordsTable.id,
            db
              .select({ id: pageRecordValuesTable.recordId })
              .from(pageRecordValuesTable)
              .where(
                and(
                  eq(pageRecordValuesTable.pageId, relatedPageId),
                  sql`(${pageRecordValuesTable.valuesJson} ->> ${relatedFieldKey}) ILIKE ${`%${q}%`}`,
                ),
              ),
          ),
        ]
      : conds;
    const rows = await db
      .select({ id: entityRecordsTable.id })
      .from(entityRecordsTable)
      .where(and(...searchConds))
      .orderBy(desc(entityRecordsTable.id))
      .limit(50);
    const ids = rows.map((r) => r.id);
    const pvMap = new Map<number, Record<string, unknown>>();
    if (ids.length > 0) {
      const prv = await db
        .select({ recordId: pageRecordValuesTable.recordId, valuesJson: pageRecordValuesTable.valuesJson })
        .from(pageRecordValuesTable)
        .where(and(eq(pageRecordValuesTable.pageId, relatedPageId), inArray(pageRecordValuesTable.recordId, ids)));
      for (const r of prv) pvMap.set(r.recordId, (r.valuesJson as Record<string, unknown>) ?? {});
    }
    return rows.map((r) => {
      const v = pvMap.get(r.id)?.[relatedFieldKey];
      return { id: r.id, label: candidateLabel(v) };
    });
  }
  const searchConds = q
    ? [...conds, sql`(${entityRecordsTable.valuesJson} ->> ${relatedFieldKey}) ILIKE ${`%${q}%`}`]
    : conds;
  const rows = await db
    .select({ id: entityRecordsTable.id, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(and(...searchConds))
    .orderBy(desc(entityRecordsTable.id))
    .limit(50);
  return rows.map((r) => {
    const v = ((r.valuesJson as Record<string, unknown>) ?? {})[relatedFieldKey];
    return { id: r.id, label: candidateLabel(v) };
  });
}

/**
 * Resolve the projected value to report after a link change. For page-source it
 * reads the related PAGE field from page_record_values keyed by the linked
 * record; otherwise it reads the already-loaded linked entity record values.
 */
async function loadLinkedValue(
  relatedPageId: number | null,
  relatedFieldKey: string,
  linkedRecordId: number | null,
  linkedValues: Record<string, unknown> | null,
): Promise<unknown> {
  if (linkedRecordId == null) return null;
  if (relatedPageId != null) {
    const [prv] = await db
      .select({ valuesJson: pageRecordValuesTable.valuesJson })
      .from(pageRecordValuesTable)
      .where(and(eq(pageRecordValuesTable.pageId, relatedPageId), eq(pageRecordValuesTable.recordId, linkedRecordId)));
    return ((prv?.valuesJson as Record<string, unknown>) ?? {})[relatedFieldKey] ?? null;
  }
  return linkedValues != null ? linkedValues[relatedFieldKey] ?? null : null;
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
      relatedField: typeof entityFieldsTable.$inferSelect | null;
      relatedPageId: number | null;
      relatedPagePerms: FieldPermissions | null;
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
  const relatedPageId = cfg?.relatedPageId ?? null;
  if (relationId == null || !relatedFieldKey) return { ok: false, status: 400, error: "Relation field is not configured" };
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
  if (!relation) return { ok: false, status: 400, error: "Relation not found" };
  const direction = relationDirection(relation, eff.entityId);
  if (!direction) return { ok: false, status: 400, error: "Relation does not yield a single linked record" };
  const relatedEntityId = relatedEntityIdFor(relation, direction);
  // Page-source: the projected field is a PAGE-LOCAL field of the related
  // entity's page; resolve its own per-role permissions rather than an entity
  // field. Entity-source resolves the related entity field as before.
  if (relatedPageId != null) {
    const [relatedPageField] = await db
      .select({ permissionsJson: pageFieldsTable.permissionsJson })
      .from(pageFieldsTable)
      .where(
        and(
          eq(pageFieldsTable.pageId, relatedPageId),
          eq(pageFieldsTable.fieldKey, relatedFieldKey),
          eq(pageFieldsTable.isActive, true),
        ),
      );
    if (!relatedPageField) return { ok: false, status: 400, error: "Related page field not found" };
    return {
      ok: true,
      entityId: eff.entityId,
      pageField,
      relation,
      direction,
      relatedEntityId,
      relatedFieldKey,
      relatedField: null,
      relatedPageId,
      relatedPagePerms: (relatedPageField.permissionsJson as FieldPermissions | null) ?? null,
    };
  }
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
    relatedPageId: null,
    relatedPagePerms: null,
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
  const { entityId, pageField, relatedEntityId, relatedFieldKey, relatedPageId } = resolved;
  if (!(await assertRecord(req, res, entityId, "view", params.data.pageId))) return;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user!.userId;
  const pagePerm = mostPermissiveFieldPerm(pageField.permissionsJson as FieldPermissions | null, roleIds, "edit");
  // Mirror the related-values column boundary: the viewer must be able to view
  // the related entity AND the specific related field must not be hidden for
  // their role. The label/search expose that field's value, so a hidden related
  // field must not be enumerable or searchable through this endpoint. For
  // page-source the related field's PAGE-field perm governs (resolveRelatedAccess).
  if (pagePerm === "hidden" || resolveRelatedAccess(resolved, perms, roleIds) === "hidden") {
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
  const candidates = await loadCandidateRows(relatedEntityId, relatedFieldKey, relatedPageId, conds, q);
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
  const { entityId, pageField, relation, direction, relatedEntityId, relatedFieldKey, relatedPageId } = resolved;
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
  // For page-source the related PAGE-field perm governs (resolveRelatedAccess).
  const relatedAccess = resolveRelatedAccess(resolved, perms, roleIds);
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
  // For page-source the value is read from the linked record's page_record_values.
  const value = await loadLinkedValue(relatedPageId, relatedFieldKey, linkedRecordId, linkedValues);
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
type RelationOptionPage = {
  pageId: number;
  pageLabel: unknown;
  fields: { key: string; label: unknown; fieldType: string }[];
};
type RelationOption = {
  relationId: number;
  label: unknown;
  direction: LinkDirection;
  relatedEntityId: number;
  relatedEntityLabel: unknown;
  fields: { key: string; label: unknown; fieldType: string }[];
  pages: RelationOptionPage[];
};

/**
 * Pages (bound + mirror) of an entity whose page-local, value-backed fields a
 * relation/lookup field can project (via relatedPageId). Excludes computed/
 * relation/lookup page fields, which have no stored value to project. Pages
 * with no eligible field are omitted.
 */
async function pageSourcesForEntity(entityId: number): Promise<RelationOptionPage[]> {
  const bound = await db
    .select({ id: pagesTable.id, nameJson: pagesTable.nameJson })
    .from(pagesTable)
    .innerJoin(entitiesTable, eq(entitiesTable.pageId, pagesTable.id))
    .where(eq(entitiesTable.id, entityId));
  const mirrors = await db
    .select({ id: pagesTable.id, nameJson: pagesTable.nameJson })
    .from(pagesTable)
    .where(eq(pagesTable.mirrorEntityId, entityId));
  const byId = new Map<number, { id: number; nameJson: unknown }>();
  for (const p of [...bound, ...mirrors]) byId.set(p.id, p);
  const result: RelationOptionPage[] = [];
  for (const page of byId.values()) {
    const fields = await db
      .select({ fieldKey: pageFieldsTable.fieldKey, nameJson: pageFieldsTable.nameJson, fieldType: pageFieldsTable.fieldType })
      .from(pageFieldsTable)
      .where(and(eq(pageFieldsTable.pageId, page.id), eq(pageFieldsTable.isActive, true)))
      .orderBy(asc(pageFieldsTable.sortOrder));
    const valueBacked = fields.filter(
      (f) => f.fieldType !== "function" && f.fieldType !== "relation" && f.fieldType !== "lookup",
    );
    if (valueBacked.length === 0) continue;
    result.push({
      pageId: page.id,
      pageLabel: page.nameJson,
      fields: valueBacked.map((f) => ({ key: f.fieldKey, label: f.nameJson, fieldType: f.fieldType })),
    });
  }
  return result;
}

async function buildRelationOptions(entityId: number): Promise<RelationOption[]> {
  const relations = await db
    .select()
    .from(relationsTable)
    .where(or(eq(relationsTable.sourceEntityId, entityId), eq(relationsTable.targetEntityId, entityId)));

  const options: RelationOption[] = [];

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
      pages: await pageSourcesForEntity(relatedEntityId),
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
  allowLookup = false,
): Promise<
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      field: typeof entityFieldsTable.$inferSelect;
      relation: Relation;
      direction: LinkDirection;
      relatedEntityId: number;
      relatedFieldKey: string;
      relatedField: typeof entityFieldsTable.$inferSelect | null;
      relatedPageId: number | null;
      relatedPagePerms: FieldPermissions | null;
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
        inArray(entityFieldsTable.fieldType, allowLookup ? ["relation", "lookup"] : ["relation"]),
      ),
    );
  if (!field) return { ok: false, status: 404, error: "Relation field not found" };
  const cfg = field.relationConfigJson as RelationFieldConfig | null;
  const relationId = cfg?.relationId ?? null;
  const relatedFieldKey = cfg?.relatedFieldKey ?? null;
  const relatedPageId = cfg?.relatedPageId ?? null;
  if (relationId == null || !relatedFieldKey) return { ok: false, status: 400, error: "Relation field is not configured" };
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
  if (!relation) return { ok: false, status: 400, error: "Relation not found" };
  const direction = relationDirection(relation, entityId);
  if (!direction) return { ok: false, status: 400, error: "Relation does not yield a single linked record" };
  const relatedEntityId = relatedEntityIdFor(relation, direction);
  // Page-source: the projected field is a PAGE-LOCAL field of the related
  // entity's page; resolve its own per-role permissions rather than an entity
  // field. Entity-source resolves the related entity field as before.
  if (relatedPageId != null) {
    const [relatedPageField] = await db
      .select({ permissionsJson: pageFieldsTable.permissionsJson })
      .from(pageFieldsTable)
      .where(
        and(
          eq(pageFieldsTable.pageId, relatedPageId),
          eq(pageFieldsTable.fieldKey, relatedFieldKey),
          eq(pageFieldsTable.isActive, true),
        ),
      );
    if (!relatedPageField) return { ok: false, status: 400, error: "Related page field not found" };
    return {
      ok: true,
      field,
      relation,
      direction,
      relatedEntityId,
      relatedFieldKey,
      relatedField: null,
      relatedPageId,
      relatedPagePerms: (relatedPageField.permissionsJson as FieldPermissions | null) ?? null,
    };
  }
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
    field,
    relation,
    direction,
    relatedEntityId,
    relatedFieldKey,
    relatedField,
    relatedPageId: null,
    relatedPagePerms: null,
  };
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
    optionsJson: SelectOption[];
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
    // Page-source: project a PAGE-LOCAL field of the linked record from
    // page_record_values, not one of the linked entity record's own fields.
    // Applies to both relation and lookup entity fields.
    const relatedPageId = cfg?.relatedPageId ?? null;

    const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId));
    if (!relation) continue;
    const direction = relationDirection(relation, entityId);
    if (!direction) continue;
    const relatedEntityId = relatedEntityIdFor(relation, direction);

    const ownAccess = resolveFieldAccess(f, perms, roleIds, entityId);
    const canViewRelated = canRecord(perms, relatedEntityId, "view");
    const relScope = effectiveScope(perms, relatedEntityId);

    // Resolve the projected field's metadata + visibility from the right source:
    // a page field (page-source lookup) or the linked entity's own field.
    let access: "hidden" | "view" | "edit";
    let relatedFieldType: string | null;
    let optionsJson: SelectOption[];
    let projectedChain = false;
    if (relatedPageId != null) {
      const [relatedPageField] = await db
        .select({
          fieldType: pageFieldsTable.fieldType,
          optionsJson: pageFieldsTable.optionsJson,
          permissionsJson: pageFieldsTable.permissionsJson,
        })
        .from(pageFieldsTable)
        .where(
          and(
            eq(pageFieldsTable.pageId, relatedPageId),
            eq(pageFieldsTable.fieldKey, relatedFieldKey),
            eq(pageFieldsTable.isActive, true),
          ),
        );
      if (!relatedPageField) continue;
      // Page-field visibility decides access; the related entity's record-view
      // boundary still gates whether anything is shown at all.
      const pagePerm = mostPermissiveFieldPerm(
        relatedPageField.permissionsJson as FieldPermissions | null,
        roleIds,
        "view",
      );
      access = canViewRelated && pagePerm !== "hidden" ? "view" : "hidden";
      relatedFieldType = access === "hidden" ? null : relatedPageField.fieldType;
      optionsJson = access === "hidden" ? [] : normalizeOptions(relatedPageField.optionsJson);
    } else {
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
      access = canViewRelated ? resolveFieldAccess(relatedField, perms, roleIds, relatedEntityId) : "hidden";
      relatedFieldType = access === "hidden" ? null : relatedField.fieldType;
      optionsJson = access === "hidden" ? [] : normalizeOptions(relatedField.optionsJson);
      // Double-hop: when the projected field is itself an entity-source
      // relation/lookup, follow it one more hop (see resolveChainValues).
      if (relatedField.fieldType === "relation" || relatedField.fieldType === "lookup") {
        projectedChain = true;
      }
    }

    // Resolve the chained value/metadata once per column (entity-source only).
    let chain: ChainResolution | null = null;
    if (projectedChain && access !== "hidden") {
      chain = await resolveChainValues(entityId, allowedIds, relationId, relatedFieldKey, relatedPageId, { perms, roleIds, userId }, 0);
      relatedFieldType = chain.access === "hidden" ? null : chain.relatedFieldType;
      optionsJson = chain.optionsJson;
      if (chain.access === "hidden") access = "hidden";
    }

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
    // Page-source lookups are never write-through (the value lives on a page, not
    // a directly-editable entity field).
    // A chained (double-hop) lookup is never write-through: its value comes from a
    // record two+ hops away, so "open the linked record" would edit the wrong one.
    const writeThrough =
      f.fieldType === "lookup" &&
      relatedPageId == null &&
      !projectedChain &&
      cfg?.writeThrough === true &&
      access !== "hidden";

    columns.push({
      fieldKey: f.fieldKey,
      relatedFieldKey,
      relatedFieldType,
      optionsJson,
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
    // linkedMap gates which linked records are viewable (row-hidden status +
    // related own-scope on the ENTITY record). For page-source lookups it carries
    // no value, only membership; the projected value comes from pageValuesMap.
    const linkedMap = new Map<number, Record<string, unknown>>();
    const pageValuesMap = new Map<number, Record<string, unknown>>();
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
      if (relatedPageId != null) {
        const allowedLinkedIds = Array.from(linkedMap.keys());
        if (allowedLinkedIds.length > 0) {
          const prv = await db
            .select({ recordId: pageRecordValuesTable.recordId, valuesJson: pageRecordValuesTable.valuesJson })
            .from(pageRecordValuesTable)
            .where(
              and(
                eq(pageRecordValuesTable.pageId, relatedPageId),
                inArray(pageRecordValuesTable.recordId, allowedLinkedIds),
              ),
            );
          for (const r of prv) pageValuesMap.set(r.recordId, (r.valuesJson as Record<string, unknown>) ?? {});
        }
      }
    }

    for (const recordId of allowedIds) {
      const rawLinkedId = linkMap.get(recordId) ?? null;
      let value: unknown = null;
      const editable = columnEditable;
      let visible = false;
      if (rawLinkedId != null && access !== "hidden") {
        // linkedMap already excludes non-owned/row-hidden linked records, so
        // presence here means the linked record itself is viewable.
        const linkedValues = linkedMap.get(rawLinkedId);
        if (linkedValues != null) {
          visible = true;
          value = chain
            ? chain.valueByRecordId.get(recordId) ?? null
            : relatedPageId != null
              ? pageValuesMap.get(rawLinkedId)?.[relatedFieldKey] ?? null
              : linkedValues[relatedFieldKey] ?? null;
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
  // allowLookup: the conditions/value picker (e.g. automations) can read
  // candidates for a `lookup` field too; the WRITE path keeps the default
  // (relation-only) so lookups can never be used to mutate a link.
  const resolved = await resolveRelationEntityField(params.data.entityId, body.data.fieldKey, true);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const { field, relatedEntityId, relatedFieldKey, relatedPageId } = resolved;
  const entityId = params.data.entityId;
  if (!(await assertRecord(req, res, entityId, "view"))) return;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user!.userId;
  const ownAccess = resolveFieldAccess(field, perms, roleIds, entityId);
  // The relation field must not be hidden for the role, the viewer must be able
  // to view the related entity, and the labelled related field must not be hidden.
  // For page-source the related PAGE-field perm governs (resolveRelatedAccess).
  if (ownAccess === "hidden" || resolveRelatedAccess(resolved, perms, roleIds) === "hidden") {
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

  // A dependent (cascading) parent that yields no matching candidates must still
  // surface the related entity + create permission, so the picker can offer
  // "add record" even when the parent has zero existing children (e.g. a project
  // with no orders yet). Returning bare `{ candidates: [] }` would hide the
  // create affordance — the very bug this avoids. Creating from the picker
  // prefills the dependency filter with the parent value, so the new record
  // satisfies the cascade.
  const emptyResult = {
    candidates: [] as { id: number; label: string; value?: string }[],
    relatedEntityId,
    relatedFieldKey,
    canCreate: canRecord(perms, relatedEntityId, "create"),
  };

  // Dependent (cascading) relation field: when configured, narrow the candidate
  // list to related records whose `relatedFilterFieldKey` matches the parent
  // field's value in the row being edited. `parentValue` is supplied by the
  // client (a scalar value, or a linked record id for a relation parent). An
  // empty parent yields no candidates (the picker is also gated client-side).
  const dep = field.dependencyConfigJson as DependencyFieldConfig | null;
  const dependsOnFieldKey = dep?.dependsOnFieldKey?.trim();
  const relatedFilterFieldKey = dep?.relatedFilterFieldKey?.trim();
  if (!body.data.ignoreDependency && dependsOnFieldKey && relatedFilterFieldKey) {
    const parentValue = body.data.parentValue?.trim() ?? "";
    if (!parentValue) {
      res.json(emptyResult);
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
      res.json(emptyResult);
      return;
    }
    if (filterField.fieldType === "relation") {
      // The filter field on the related entity is itself a relation: match by the
      // linked record id (parentValue) via record_links on that relation.
      const fr = await resolveRelationEntityField(relatedEntityId, relatedFilterFieldKey);
      const parentId = Number(parentValue);
      if (!fr.ok || !Number.isFinite(parentId)) {
        res.json(emptyResult);
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
        res.json(emptyResult);
        return;
      }
      conds.push(inArray(entityRecordsTable.id, ids));
    } else {
      // Scalar filter field: match the stored JSONB value as text.
      conds.push(sql`(${entityRecordsTable.valuesJson} ->> ${relatedFilterFieldKey}) = ${parentValue}`);
    }
  }

  // A projected `user` field stores the user id as its raw value (what automation
  // conditions match against via the engine). For such fields the picker must
  // show the user's display NAME (label) while emitting the user ID (value) — a
  // value/label split — so matching keeps working. Two cases:
  //  - condition context (ignoreDependency, no row/parent chain): offer ALL users
  //    the projected field's `allowedRoleIds` permits, not just users that happen
  //    to appear in existing records, so automations can target FUTURE records.
  //  - records-linking context: keep the existing-record-derived candidates (the
  //    relation picker links by record id) but resolve labels to names.
  const userProjection = resolved.relatedField?.fieldType === "user";
  let finalCandidates: { id: number; label: string; value?: string }[];
  if (userProjection && body.data.ignoreDependency) {
    const allowed = (resolved.relatedField!.userConfigJson as { allowedRoleIds?: number[] } | null)
      ?.allowedRoleIds;
    const allUsers = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
        roleId: usersTable.roleId,
      })
      .from(usersTable);
    const urRows = await db
      .select({ userId: userRolesTable.userId, roleId: userRolesTable.roleId })
      .from(userRolesTable);
    const rolesByUser = new Map<number, number[]>();
    for (const r of urRows) {
      const list = rolesByUser.get(r.userId);
      if (list) list.push(r.roleId);
      else rolesByUser.set(r.userId, [r.roleId]);
    }
    // Match on the user's FULL role set (primary roleId + additional via
    // user_roles), identical to the client's filterUserOptionsByRoles.
    const allowedSet =
      Array.isArray(allowed) && allowed.length > 0 ? new Set(allowed) : null;
    const needle = q?.toLowerCase();
    finalCandidates = allUsers
      .filter((u) => {
        if (!allowedSet) return true;
        const rs = rolesByUser.get(u.id);
        const set = rs && rs.length > 0 ? rs : [u.roleId];
        return set.some((rid) => allowedSet.has(rid));
      })
      .map((u) => ({
        id: u.id,
        label: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email,
        value: String(u.id),
      }))
      .filter((c) => (needle ? c.label.toLowerCase().includes(needle) : true));
  } else {
    const candidates = await loadCandidateRows(relatedEntityId, relatedFieldKey, relatedPageId, conds, q);
    if (userProjection) {
      const ids = [...new Set(candidates.map((c) => Number(c.label)).filter((n) => Number.isInteger(n)))];
      if (ids.length > 0) {
        const users = await db
          .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
          .from(usersTable)
          .where(inArray(usersTable.id, ids));
        const nameById = new Map(
          users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email] as const),
        );
        finalCandidates = candidates.map((c) => {
          const nm = nameById.get(Number(c.label));
          return nm ? { ...c, label: nm, value: c.label } : c;
        });
      } else {
        finalCandidates = candidates;
      }
    } else {
      finalCandidates = candidates;
    }
  }
  // Surface the related entity id + create permission so the client can offer an
  // in-place "add record" affordance (create a record in the related entity and
  // link it without leaving the picker).
  res.json({
    candidates: finalCandidates,
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
  const { field, relation, direction, relatedEntityId, relatedFieldKey, relatedPageId } = resolved;
  const entityId = params.data.entityId;
  const baseRecordId = body.data.recordId;
  const linkedRecordId = body.data.linkedRecordId ?? null;

  const perms = await getPermissions(req);
  const roleIds = await getUserRoleIds(req);
  const userId = req.user!.userId;
  const ownAccess = resolveFieldAccess(field, perms, roleIds, entityId);
  // For page-source the related PAGE-field perm governs (resolveRelatedAccess).
  const relatedAccess = resolveRelatedAccess(resolved, perms, roleIds);
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

  // For page-source the value is read from the linked record's page_record_values.
  const value = await loadLinkedValue(relatedPageId, relatedFieldKey, linkedRecordId, linkedValues);
  res.json({ linkedRecordId, value });
});

export default router;
