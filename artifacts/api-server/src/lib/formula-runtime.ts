import type { Request } from "express";
import {
  db,
  entityFieldsTable,
  entityRecordsTable,
  entitiesTable,
  pageFieldsTable,
  pageRecordValuesTable,
  pagesTable,
  relationsTable,
  type EntityField,
  type RecordPermission,
  type RolePermissions,
  appSettingsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import {
  effectiveRecordPerm,
  effectiveScopeFor,
  effectiveFormulaExportRecordPerm,
  effectiveFormulaExportScopeFor,
  getPermissions,
  getUserRoleIds,
  mostPermissiveFieldPerm,
  resolveFieldAccess,
} from "../middlewares/permissions";
import { ownScopeWhere } from "../routes/own-scope";
import {
  linkedFormulaResourceKey,
  LinkedFormulaResolutionError,
  resolveLinkedFormulaData,
  type LinkedFormulaPermissionContext,
  type LinkedFormulaResource,
  type LinkedFormulaSource,
} from "./linked-formula-resolver";
import { idArrayAny } from "./sql-id-array";
import { normalizeFormulaFieldSources } from "./formula-field-config";
import { buildFormulaScope, DEFAULT_FORMULA_TIME_ZONE, DEFAULT_WORKING_DAYS, type FormulaEvaluationOptions, type FormulaFieldDef } from "@workspace/formula";

/** Authoritative application calendar settings for formula materialization. */
export async function loadFormulaOptions(): Promise<FormulaEvaluationOptions> {
  const [settings] = await db.select({ timeZone: appSettingsTable.timeZone, workingDays: appSettingsTable.workingDays })
    .from(appSettingsTable).where(eq(appSettingsTable.id, 1)).limit(1);
  return {
    timeZone: settings?.timeZone ?? DEFAULT_FORMULA_TIME_ZONE,
    workingDays: settings?.workingDays ?? DEFAULT_WORKING_DAYS,
  };
}

type FormulaConfiguredField = { fieldType: string; formulaConfigJson?: unknown; relationConfigJson?: unknown };
type FormulaDependencyField = FormulaConfiguredField & {
  fieldKey: string;
  relationConfigJson?: unknown;
};
type LegacyRelationField = {
  fieldKey: string;
  fieldType: string;
  formulaConfigJson?: unknown;
  relationConfigJson?: unknown;
  scope: "entity" | "page";
  pageId?: number;
};
type RelationEndpoint = { id: number; sourceEntityId: number; targetEntityId: number };

/** Default-deny, additive role capability for one exact page-field source. */
export function canExportPageFieldToFormula(options: {
  formulaExportRoleIds: readonly number[] | null | undefined;
  roleIds: readonly number[];
  ordinaryFieldAccess: "hidden" | "view" | "edit";
  recordView: boolean;
}): boolean {
  return options.recordView
    && options.ordinaryFieldAccess !== "hidden"
    && (options.formulaExportRoleIds ?? []).some((roleId) => options.roleIds.includes(roleId));
}

type ExportedFormulaPageContext = {
  entityId: number;
  pageId: number;
};

/**
 * An exact exported formula field may evaluate in its canonical source-page
 * context without opening that page to the viewer. This exception applies only
 * to the page resource itself; dependency fields and linked target resources
 * still require their ordinary/export-aware authorization checks.
 */
export function isExportedFormulaBasePageResource(
  resource: LinkedFormulaResource,
  context: ExportedFormulaPageContext | undefined,
): boolean {
  return context != null
    && resource.kind === "page"
    && resource.entityId === context.entityId
    && resource.pageId === context.pageId;
}

const deniedFormulaProjectionKeys = new WeakMap<object, Set<string>>();

/** Mark a temporary formula input/output as denied without serializing policy metadata. */
export function markDeniedFormulaProjection(values: Record<string, unknown>, key: string): void {
  const denied = deniedFormulaProjectionKeys.get(values) ?? new Set<string>();
  denied.add(key);
  deniedFormulaProjectionKeys.set(values, denied);
}

/** True only for permission-denied projections, never for legitimate nulls. */
export function isDeniedFormulaProjection(values: Record<string, unknown> | undefined, key: string): boolean {
  return values != null && deniedFormulaProjectionKeys.get(values)?.has(key) === true;
}

function deniedKeys(values: Record<string, unknown> | undefined): ReadonlySet<string> {
  return values == null ? new Set() : deniedFormulaProjectionKeys.get(values) ?? new Set();
}

/** Field references are deliberately extracted without evaluating an expression.
 * Invalid expressions remain the evaluator's concern and simply contribute no
 * dependency here. */
function formulaReferenceKeys(fields: readonly FormulaConfiguredField[]): Set<string> {
  const keys = new Set<string>();
  for (const field of fields) {
    if (field.fieldType !== "function") continue;
    const config = field.formulaConfigJson as {
      expression?: unknown;
      groupResult?: { fields?: unknown };
    } | null;
    if (typeof config?.expression === "string") {
      for (const match of config.expression.matchAll(/\{([^{}]+)\}/g)) {
        const key = match[1].trim();
        // Legacy references are flat. Qualified names already have an explicit
        // namespace and must not be guessed as a relation field.
        if (key && !key.includes(":") && !key.includes(".")) keys.add(key);
      }
    }
    if (Array.isArray(config?.groupResult?.fields)) {
      for (const raw of config.groupResult.fields) {
        if (!raw || typeof raw !== "object") continue;
        const ref = raw as { scope?: unknown; fieldKey?: unknown };
        if ((ref.scope === "entity" || ref.scope === "page") &&
            typeof ref.fieldKey === "string" && ref.fieldKey) {
          keys.add(ref.fieldKey);
        }
      }
    }
  }
  return keys;
}

/**
 * A qualified `{page:<id>.<key>}` reference is already an unambiguous request
 * for a page-local value on the same base record. Turn it into the structured
 * source consumed by the permission-aware resolver, even when an older/manual
 * formula did not persist a matching `formulaConfigJson.sources` entry.
 */
export function qualifiedPageFormulaSources(
  fields: readonly FormulaConfiguredField[],
): LinkedFormulaSource[] {
  const sources = new Map<string, LinkedFormulaSource>();
  for (const field of fields) {
    if (field.fieldType !== "function") continue;
    const expression = (field.formulaConfigJson as { expression?: unknown } | null)?.expression;
    if (typeof expression !== "string") continue;
    for (const match of expression.matchAll(/\{([^{}]+)\}/g)) {
      const qualified = /^page:(\d+)\.(.+)$/.exec(match[1].trim());
      if (!qualified) continue;
      const pageId = Number(qualified[1]);
      const fieldKey = qualified[2].trim();
      if (!Number.isInteger(pageId) || pageId <= 0 || !fieldKey) continue;
      const key = `page:${pageId}.${fieldKey}`;
      sources.set(key, { kind: "pageLocal", key, pageId, fieldKey });
    }
  }
  return [...sources.values()];
}

/**
 * Turn a legacy flat reference to a relation/lookup column into the same
 * permission-aware linked source used by structured formulas.  This is pure so
 * the security-sensitive discovery rules can be tested without a database.
 */
export function legacyFormulaSourcesFromFields(
  fields: readonly LegacyRelationField[],
  relations: readonly RelationEndpoint[],
  entityId: number,
  referencedKeys?: Iterable<string>,
): LinkedFormulaSource[] {
  const references = referencedKeys == null
    ? formulaReferenceKeys(fields)
    : new Set(referencedKeys);
  const relationById = new Map(relations.map((relation) => [relation.id, relation]));
  const result: LinkedFormulaSource[] = [];
  const effectiveFields = new Map<string, LegacyRelationField>();
  for (const field of fields) effectiveFields.set(field.fieldKey, field);
  for (const field of effectiveFields.values()) {
    if (!references.has(field.fieldKey) || (field.fieldType !== "relation" && field.fieldType !== "lookup")) continue;
    const config = field.relationConfigJson as {
      relationId?: unknown; relatedFieldKey?: unknown; relatedPageId?: unknown;
    } | null;
    const relationId = config?.relationId;
    const relatedFieldKey = config?.relatedFieldKey;
    if (
      typeof relationId !== "number"
      || !Number.isInteger(relationId)
      || typeof relatedFieldKey !== "string"
      || !relatedFieldKey
    ) continue;
    const relation = relationById.get(relationId);
    if (!relation) continue;
    const baseSide = relation.sourceEntityId === entityId
      ? "source"
      : relation.targetEntityId === entityId
        ? "target"
        : null;
    if (!baseSide) continue;
    const targetEntityId = baseSide === "source" ? relation.targetEntityId : relation.sourceEntityId;
    const relatedPageId = config?.relatedPageId;
    if (
      relatedPageId != null
      && (
        typeof relatedPageId !== "number"
        || !Number.isInteger(relatedPageId)
        || relatedPageId <= 0
      )
    ) continue;
    result.push({
      key: field.fieldKey,
      kind: "aggregate",
      targetEntityId,
      ...(relatedPageId == null ? {} : { targetPageId: relatedPageId }),
      value: relatedPageId == null
        ? { scope: "entity", fieldKey: relatedFieldKey }
        : { scope: "page", pageId: relatedPageId, fieldKey: relatedFieldKey },
      join: { kind: "relation", relationId, baseSide },
      // Relation/lookup fields are configured only for qualifying single-link
      // relations. min provides neutral scalar semantics if stale data violates
      // that invariant, without choosing an arbitrary link.
      aggregate: "min",
      limit: 1,
    });
  }
  return result;
}

function legacySourceKeysOf(fields: readonly FormulaDependencyField[]): string[] {
  const references = formulaReferenceKeys(fields);
  // Page fields occur after entity fields at every call site, matching flat-key
  // formula scope shadowing. A relation/lookup dependency is transient input,
  // never an additional response value.
  const byKey = new Map<string, FormulaDependencyField>();
  for (const field of fields) byKey.set(field.fieldKey, field);
  return [...references].filter((key) => {
    const field = byKey.get(key);
    return field?.fieldType === "relation" || field?.fieldType === "lookup";
  });
}

/**
 * A caller-supplied page may contribute page-local values to a record formula
 * only when it is the requested entity's page, the viewer can enter that page,
 * and the page-aware record permission grants read access. Entity-level record
 * access alone must not turn an inaccessible page into a derived-data oracle.
 */
export function canUseRecordPageFormulaContext(options: {
  permissions: Pick<RolePermissions, "superAdmin" | "pageIds">;
  entityId: number;
  pageId: number;
  pageEntityId: number | null;
  recordPermission: RecordPermission | undefined;
}): boolean {
  const { permissions, entityId, pageId, pageEntityId, recordPermission } = options;
  if (pageEntityId !== entityId) return false;
  if (permissions.superAdmin) return true;
  return permissions.pageIds.includes(pageId) && recordPermission?.view === true;
}

/**
 * Construct the formula namespace used by the editor:
 * `{entity:<id>.<key>}` always addresses the record value and
 * `{page:<id>.<key>}` always addresses that page's value. Flat keys retain
 * legacy semantics (current-page values shadow entity values). Formula aliases
 * are definitions, not copied values, so qualified formula-to-formula chains
 * remain lazy and cycle-safe.
 */
export function buildQualifiedFormulaScope(options: {
  entityId: number;
  entityValues: Record<string, unknown>;
  entityFormulas: FormulaFieldDef[];
  pageId?: number;
  pageValues?: Record<string, unknown>;
  pageFormulas?: FormulaFieldDef[];
  formulaOptions?: FormulaEvaluationOptions;
}): Record<string, unknown> {
  const base: Record<string, unknown> = { ...options.entityValues };
  for (const [key, value] of Object.entries(options.entityValues)) {
    base[`entity:${options.entityId}.${key}`] = value;
  }
  if (options.pageId != null) {
    for (const [key, value] of Object.entries(options.pageValues ?? {})) {
      base[key] = value; // current-page flat-key compatibility
      base[`page:${options.pageId}.${key}`] = value;
    }
  }
  const formulas = [...options.entityFormulas, ...(options.pageFormulas ?? [])];
  const aliases: FormulaFieldDef[] = options.entityFormulas.map((formula) => ({
    ...formula,
    key: `entity:${options.entityId}.${formula.key}`,
  }));
  if (options.pageId != null) {
    aliases.push(...(options.pageFormulas ?? []).map((formula) => ({
      ...formula,
      key: `page:${options.pageId}.${formula.key}`,
    })));
  }
  return buildFormulaScope(base, [...formulas, ...aliases], options.formulaOptions);
}

/** Collect structured dependencies once for an evaluation batch. */
export function formulaSourcesOf(fields: readonly FormulaConfiguredField[]): LinkedFormulaSource[] {
  const byKey = new Map<string, LinkedFormulaSource | null>();
  const addSource = (source: LinkedFormulaSource) => {
    // Source tokens share one formula scope. Identical definitions are
    // harmless; a cross-field key collision with different definitions is
    // ambiguous and therefore removed (neutral), never resolved arbitrarily.
    const previous = byKey.get(source.key);
    if (previous === undefined) byKey.set(source.key, source);
    else if (previous !== null && JSON.stringify(previous) !== JSON.stringify(source)) byKey.set(source.key, null);
  };
  for (const field of fields) {
    if (field.fieldType !== "function") continue;
    for (const source of normalizeFormulaFieldSources(
      (field.formulaConfigJson as { sources?: unknown } | null)?.sources,
    ) as LinkedFormulaSource[]) addSource(source);
  }
  for (const source of qualifiedPageFormulaSources(fields)) addSource(source);
  return [...byKey.values()].filter((source): source is LinkedFormulaSource => source !== null);
}

/**
 * Collect only the same-context formula definitions needed to evaluate one
 * page formula. Cross-page references remain structured linked sources and are
 * resolved recursively. Keeping this closure target-specific prevents sibling
 * projections in the same batch from being mistaken for active ancestors.
 */
function localFormulaDependencyClosure(
  target: FormulaDependencyField,
  entityId: number,
  pageId: number,
  entityFields: readonly FormulaDependencyField[],
  pageFields: readonly FormulaDependencyField[],
): FormulaDependencyField[] {
  const entityByKey = new Map(entityFields.map((field) => [field.fieldKey, field]));
  const pageByKey = new Map(pageFields.map((field) => [field.fieldKey, field]));
  const out = new Map<string, FormulaDependencyField>();

  const visit = (field: FormulaDependencyField, scope: "entity" | "page") => {
    const id = `${scope}:${field.fieldKey}`;
    if (out.has(id)) return;
    out.set(id, field);
    if (field.fieldType !== "function") return;
    const expression = (field.formulaConfigJson as { expression?: unknown } | null)?.expression;
    if (typeof expression !== "string") return;
    for (const match of expression.matchAll(/\{([^{}]+)\}/g)) {
      const key = match[1].trim();
      const entityRef = new RegExp(`^entity:${entityId}\\.(.+)$`).exec(key);
      if (entityRef) {
        const dependency = entityByKey.get(entityRef[1]);
        if (dependency) visit(dependency, "entity");
        continue;
      }
      const pageRef = new RegExp(`^page:${pageId}\\.(.+)$`).exec(key);
      if (pageRef) {
        const dependency = pageByKey.get(pageRef[1]);
        if (dependency) visit(dependency, "page");
        continue;
      }
      if (!key.includes(":") && !key.includes(".")) {
        const pageDependency = pageByKey.get(key);
        const entityDependency = entityByKey.get(key);
        if (pageDependency) visit(pageDependency, "page");
        else if (entityDependency) visit(entityDependency, "entity");
      }
    }
  };

  visit(target, "page");
  return [...out.values()];
}

/**
 * Projects an interactive formula input onto the viewer-visible schema.
 * Resolver tokens declared by visible formulas are retained; arbitrary stored
 * keys (including hidden fields) are not. Privileged/system callers should not
 * use this projection.
 */
export function projectViewerFormulaValues(
  values: Record<string, unknown>,
  visibleFields: readonly (FormulaConfiguredField & { fieldKey: string })[],
  safeKeys: readonly string[] = [],
): Record<string, unknown> {
  const allowed = new Set([
    ...visibleFields.map((field) => field.fieldKey),
    ...formulaSourcesOf(visibleFields).map((source) => source.key),
    ...safeKeys,
  ]);
  return Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)));
}

/**
 * Build the HTTP viewer adapter. Every entity/page/field and every row is
 * independently checked. The resolver consequently never reads a hidden field
 * or a row outside own/filter/status scope.
 */
export async function interactiveFormulaPermissions(
  req: Request,
  baseEntityId?: number,
  basePageId?: number,
  includeArchivedBaseRows = false,
): Promise<LinkedFormulaPermissionContext> {
  const [perms, roleIds] = await Promise.all([getPermissions(req), getUserRoleIds(req)]);
  return {
    includeArchivedBaseRows,
    async authorizePageFormulaSourceFields(resources) {
      const unique = [...new Map(resources.map((resource) => [linkedFormulaResourceKey(resource), resource])).values()];
      const pageIds = [...new Set(unique.map((resource) => resource.pageId))];
      if (!pageIds.length) return new Set<string>();
      const [fields, pages, boundEntities] = await Promise.all([
        db.select().from(pageFieldsTable).where(and(
          inArray(pageFieldsTable.pageId, pageIds),
          eq(pageFieldsTable.isActive, true),
        )),
        db.select({ id: pagesTable.id, mirrorEntityId: pagesTable.mirrorEntityId })
          .from(pagesTable)
          .where(inArray(pagesTable.id, pageIds)),
        db.select({ id: entitiesTable.id, pageId: entitiesTable.pageId })
          .from(entitiesTable)
          .where(inArray(entitiesTable.pageId, pageIds)),
      ]);
      const fieldByKey = new Map(fields.map((field) => [`${field.pageId}:${field.fieldKey}`, field]));
      const boundEntityByPage = new Map(boundEntities.map((entity) => [entity.pageId, entity.id]));
      const pageEntity = new Map(pages.map((page) => [
        page.id,
        page.mirrorEntityId ?? boundEntityByPage.get(page.id) ?? null,
      ]));
      const allowed = new Set<string>();
      for (const resource of unique) {
        const field = fieldByKey.get(`${resource.pageId}:${resource.fieldKey}`);
        const page = pages.find((candidate) => candidate.id === resource.pageId);
        const mirrorPageId = page?.mirrorEntityId === resource.entityId
          ? resource.pageId
          : undefined;
        const recordPermission = await effectiveFormulaExportRecordPerm(
          req,
          perms,
          resource.entityId,
          resource.pageId,
        );
        if (
          field
          && pageEntity.get(resource.pageId) === resource.entityId
          && canExportPageFieldToFormula({
            formulaExportRoleIds: field.formulaExportRoleIds,
            roleIds,
            ordinaryFieldAccess: mostPermissiveFieldPerm(
              field.permissionsJson,
              roleIds,
              "view",
              perms,
              resource.entityId,
              mirrorPageId,
            ),
            recordView: perms.superAdmin || recordPermission?.view === true,
          })
        ) {
          allowed.add(linkedFormulaResourceKey(resource));
        }
      }
      return allowed;
    },
    async filterPageFormulaSourceRows(scope) {
      const rp = await effectiveFormulaExportRecordPerm(
        req,
        perms,
        scope.entityId,
        scope.pageId,
      );
      if (!perms.superAdmin && rp?.view !== true) return new Set<number>();
      const fields = await db.select().from(entityFieldsTable).where(and(
        eq(entityFieldsTable.entityId, scope.entityId),
        eq(entityFieldsTable.isActive, true),
      ));
      const effective = await effectiveFormulaExportScopeFor(
        req,
        perms,
        scope.entityId,
        scope.pageId,
      );
      const clauses = [
        eq(entityRecordsTable.entityId, scope.entityId),
        idArrayAny(entityRecordsTable.id, scope.recordIds),
        ...(includeArchivedBaseRows ? [] : [isNull(entityRecordsTable.archivedAt)]),
      ];
      if (effective.scope === "own") {
        clauses.push(await ownScopeWhere(
          scope.entityId,
          effective.scopeFieldKeys,
          req.user!.userId,
          fields,
        ));
      }
      const hiddenStatuses = (rp?.hiddenRowStatusIds ?? []).filter(Number.isInteger);
      if (hiddenStatuses.length) {
        clauses.push(or(
          isNull(entityRecordsTable.statusId),
          notInArray(entityRecordsTable.statusId, hiddenStatuses),
        )!);
      }
      const rows = await db.select({ id: entityRecordsTable.id })
        .from(entityRecordsTable)
        .where(and(...clauses));
      return new Set(rows.map((row) => row.id));
    },
    async authorizeResources(resources) {
      const allowed = new Set<string>();
      // Resolver calls this with the complete dependency graph.  Load its
      // metadata once rather than turning a wide formula into one query per
      // resource.  Do not cache authorization decisions: permissions remain
      // request-scoped, while this batch is deliberately local to the call.
      const unique = [...new Map(resources.map((r) => [linkedFormulaResourceKey(r), r])).values()];
      const entityIds = [...new Set(unique.map((r) => r.entityId))];
      const pageIds = [...new Set(unique.flatMap((r) =>
        r.kind === "page" ? [r.pageId] : r.kind === "field" && r.scope === "page" ? [r.pageId] : [],
      ))];
      const [entityFields, pageFields, pages] = await Promise.all([
        entityIds.length ? db.select().from(entityFieldsTable).where(and(
          inArray(entityFieldsTable.entityId, entityIds),
          eq(entityFieldsTable.isActive, true),
        )) : Promise.resolve([]),
        pageIds.length ? db.select().from(pageFieldsTable).where(and(
          inArray(pageFieldsTable.pageId, pageIds),
          eq(pageFieldsTable.isActive, true),
        )) : Promise.resolve([]),
        // effectiveRecordPerm can inspect the base page even if it is not a
        // resource itself, so include it in the same metadata query.
        [...new Set([...pageIds, ...(basePageId == null ? [] : [basePageId])])].length
          ? db.select({ id: pagesTable.id, mirrorEntityId: pagesTable.mirrorEntityId }).from(pagesTable)
            .where(inArray(pagesTable.id, [...new Set([...pageIds, ...(basePageId == null ? [] : [basePageId])])]))
          : Promise.resolve([]),
      ]);
      const entityFieldByKey = new Map(entityFields.map((f) => [`${f.entityId}:${f.fieldKey}`, f]));
      const pageFieldByKey = new Map(pageFields.map((f) => [`${f.pageId}:${f.fieldKey}`, f]));
      const pageMirrorById = new Map(pages.map((p) => [p.id, p.mirrorEntityId]));
      const recordPerm = (entityId: number, pageId?: number) => {
        if (pageId != null && perms.pageIds.includes(pageId) && pageMirrorById.get(pageId) === entityId) {
          const override = perms.records[`mirror:${pageId}`];
          if (override) return override;
        }
        return perms.records[String(entityId)];
      };
      for (const resource of unique) {
        let ok = false;
        if (resource.kind === "entity") {
          const contextPage = resource.entityId === baseEntityId ? basePageId : undefined;
          ok = perms.superAdmin ||
            recordPerm(resource.entityId, contextPage)?.view === true;
        } else if (resource.kind === "page") {
          const rp = recordPerm(resource.entityId, resource.pageId);
          ok = perms.superAdmin || (
            (perms.admin.pages || perms.pageIds.includes(resource.pageId))
            && rp?.view === true
          );
        } else if (resource.scope === "entity") {
          const field = entityFieldByKey.get(`${resource.entityId}:${resource.fieldKey}`);
          const contextPage = resource.entityId === baseEntityId ? basePageId : undefined;
          const rp = recordPerm(resource.entityId, contextPage);
          ok = !!field && (
            perms.superAdmin || (
              rp?.view === true
              && resolveFieldAccess(field, perms, roleIds, resource.entityId, rp, contextPage) !== "hidden"
            )
          );
        } else {
          const field = pageFieldByKey.get(`${resource.pageId}:${resource.fieldKey}`);
          const rp = recordPerm(resource.entityId, resource.pageId);
          ok = !!field && (
            perms.superAdmin || (
              (perms.admin.pages || perms.pageIds.includes(resource.pageId))
              && rp?.view === true
              && mostPermissiveFieldPerm(
                field.permissionsJson,
                roleIds,
                "view",
                perms,
                resource.entityId,
                resource.pageId,
              ) !== "hidden"
            )
          );
        }
        if (ok) allowed.add(linkedFormulaResourceKey(resource));
      }
      return allowed;
    },
    async filterRows(scope) {
      if (scope.recordIds.length === 0) return new Set<number>();
      const rp = await effectiveRecordPerm(req, perms, scope.entityId, scope.pageId);
      if (!perms.superAdmin && rp?.view !== true) return new Set<number>();
      const fields = await db.select().from(entityFieldsTable).where(and(
        eq(entityFieldsTable.entityId, scope.entityId),
        eq(entityFieldsTable.isActive, true),
      ));
      const effective = await effectiveScopeFor(req, perms, scope.entityId, scope.pageId);
      const clauses = [
        eq(entityRecordsTable.entityId, scope.entityId),
        idArrayAny(entityRecordsTable.id, scope.recordIds),
        ...(includeArchivedBaseRows ? [] : [isNull(entityRecordsTable.archivedAt)]),
      ];
      if (effective.scope === "own") {
        clauses.push(await ownScopeWhere(scope.entityId, effective.scopeFieldKeys, req.user!.userId, fields));
      }
      const hiddenStatuses = (rp?.hiddenRowStatusIds ?? []).filter(Number.isInteger);
      if (hiddenStatuses.length) {
        clauses.push(or(isNull(entityRecordsTable.statusId), notInArray(entityRecordsTable.statusId, hiddenStatuses))!);
      }
      const rows = await db.select({ id: entityRecordsTable.id }).from(entityRecordsTable).where(and(...clauses));
      return new Set(rows.map((row) => row.id));
    },
  };
}

/** Explicit AS SYSTEM adapter for automations/background execution. */
export const systemFormulaPermissions: LinkedFormulaPermissionContext = {
  async authorizeResources(resources: readonly LinkedFormulaResource[]) {
    return new Set(resources.map(linkedFormulaResourceKey));
  },
  async filterRows(scope) {
    return new Set(scope.recordIds);
  },
};

/**
 * Resolve dependencies in one set-based call and merge them into each row's
 * formula input. A denied/malformed dependency is deliberately neutral: no
 * source token is injected, so formula evaluation yields its ordinary null/zero
 * semantics without revealing which boundary denied it.
 */
export async function mergeLinkedFormulaInputs(options: {
  entityId: number;
  pageId?: number;
  rows: readonly { id: number; values: Record<string, unknown> }[];
  fields: readonly FormulaDependencyField[];
  permissions: LinkedFormulaPermissionContext;
}, state: {
  depth: number;
  pageFormulaStack: ReadonlySet<string>;
  exportedBasePage?: ExportedFormulaPageContext;
} = {
  depth: 0,
  pageFormulaStack: new Set(),
}): Promise<Map<number, Record<string, unknown>>> {
  const out = new Map(options.rows.map((row) => [row.id, { ...row.values }]));
  const configuredSources = formulaSourcesOf(options.fields).filter((source) =>
    // A canonical qualified reference to the current page is already resolved
    // lazily by buildQualifiedFormulaScope. Sending it through the linked
    // resolver injects a stored-value null placeholder, which shadows valid
    // same-page formula chains and makes them evaluate as null.
    source.kind !== "pageLocal" ||
    source.pageId !== options.pageId ||
    source.key !== `page:${source.pageId}.${source.fieldKey}`
  );
  // Old formulas stored only `{relation_or_lookup_key}`. Load the active schema
  // for the keys actually referenced, rather than treating valuesJson as an
  // authority (these fields are derived and never stored there). Page columns
  // shadow entity columns just as buildQualifiedFormulaScope does.
  const referencedKeys = [...formulaReferenceKeys(options.fields)];
  let legacySources: LinkedFormulaSource[] = [];
  let legacyBaseResources = new Map<string, LinkedFormulaResource>();
  if (referencedKeys.length) {
    try {
      const [entityFields, pageFields] = await Promise.all([
        db.select({
          fieldKey: entityFieldsTable.fieldKey,
          fieldType: entityFieldsTable.fieldType,
          relationConfigJson: entityFieldsTable.relationConfigJson,
        }).from(entityFieldsTable).where(and(
          eq(entityFieldsTable.entityId, options.entityId),
          eq(entityFieldsTable.isActive, true),
          inArray(entityFieldsTable.fieldKey, referencedKeys),
        )),
        options.pageId == null ? Promise.resolve([]) : db.select({
          fieldKey: pageFieldsTable.fieldKey,
          fieldType: pageFieldsTable.fieldType,
          relationConfigJson: pageFieldsTable.relationConfigJson,
        }).from(pageFieldsTable).where(and(
          eq(pageFieldsTable.pageId, options.pageId),
          eq(pageFieldsTable.isActive, true),
          inArray(pageFieldsTable.fieldKey, referencedKeys),
        )),
      ]);
      const candidates: LegacyRelationField[] = [
        ...entityFields.map((field) => ({ ...field, scope: "entity" as const })),
        // Deliberately last: current page is the flat-key compatibility scope.
        ...pageFields.map((field) => ({ ...field, scope: "page" as const, pageId: options.pageId! })),
      ];
      const relationIds: number[] = [...new Set(candidates.flatMap((field) => {
        const id = (field.relationConfigJson as { relationId?: unknown } | null)?.relationId;
        return typeof id === "number" && Number.isInteger(id) ? [id] : [];
      }))];
      const relations = relationIds.length
        ? await db.select({
          id: relationsTable.id,
          sourceEntityId: relationsTable.sourceEntityId,
          targetEntityId: relationsTable.targetEntityId,
        }).from(relationsTable).where(inArray(relationsTable.id, relationIds))
        : [];
      legacySources = legacyFormulaSourcesFromFields(
        candidates,
        relations,
        options.entityId,
        referencedKeys,
      );
      for (const source of legacySources) {
        const candidate = [...candidates].reverse().find((field) => field.fieldKey === source.key)!;
        legacyBaseResources.set(source.key, candidate.scope === "entity"
          ? { kind: "field", entityId: options.entityId, scope: "entity", fieldKey: source.key }
          : { kind: "field", entityId: options.entityId, scope: "page", pageId: candidate.pageId!, fieldKey: source.key });
      }
    } catch {
      // Schema discovery is optional derived data; retain neutral formula input.
    }
  }
  // Explicit configurations are the durable, authoritative definition. A
  // legacy fallback only fills a token for which no explicit source exists.
  const explicitKeys = new Set(configuredSources.map((source) => source.key));
  const sourcesToConsider = [
    ...configuredSources,
    ...legacySources.filter((source) => !explicitKeys.has(source.key)),
  ];
  const baseResources: LinkedFormulaResource[] = [
    { kind: "entity", entityId: options.entityId },
    ...(options.pageId == null ? [] : [{ kind: "page" as const, pageId: options.pageId, entityId: options.entityId }]),
  ];
  // Authorize the complete graph in one call. A hidden source becomes neutral
  // without suppressing unrelated allowed inputs.
  const sourceRequirements = sourcesToConsider.map((source) => {
    const resources: LinkedFormulaResource[] = [...baseResources];
    if (source.kind === "pageLocal") {
      resources.push(
        { kind: "page", pageId: source.pageId, entityId: options.entityId },
        { kind: "field", entityId: options.entityId, scope: "page", pageId: source.pageId, fieldKey: source.fieldKey },
      );
    } else {
      resources.push({ kind: "entity", entityId: source.targetEntityId });
      const legacyBase = legacyBaseResources.get(source.key);
      if (legacyBase && !explicitKeys.has(source.key)) resources.push(legacyBase);
      if (source.value) resources.push({ kind: "field", entityId: source.targetEntityId, ...source.value });
      if (source.targetPageId != null) resources.push({ kind: "page", pageId: source.targetPageId, entityId: source.targetEntityId });
      if (source.join.kind === "equality") for (const pair of source.join.on) {
        resources.push(
          { kind: "field", entityId: options.entityId, ...pair.base },
          { kind: "field", entityId: source.targetEntityId, ...pair.target },
        );
      }
    }
    return { source, keys: [...new Set(resources.map(linkedFormulaResourceKey))], resources };
  });
  const sources: LinkedFormulaSource[] = [];
  const exportedSourceFields = new Set<string>();
  const deniedSourceKeys = new Set(sourcesToConsider.map((source) => source.key));
  try {
    const unique = new Map(sourceRequirements.flatMap(({ resources }) =>
      resources.map((resource) => [linkedFormulaResourceKey(resource), resource] as const),
    ));
    const allowed = await options.permissions.authorizeResources([...unique.values()]);
    const pageSourceFields = options.pageId == null
      ? []
      : [...unique.values()].filter(
          (resource): resource is Extract<LinkedFormulaResource, { kind: "field"; scope: "page" }> =>
            resource.kind === "field" && resource.scope === "page" && resource.pageId !== options.pageId,
        );
    const exported = options.permissions.authorizePageFormulaSourceFields
      ? await options.permissions.authorizePageFormulaSourceFields(pageSourceFields)
      : new Set<string>();
    for (const requirement of sourceRequirements) {
      const sourcePageFields = requirement.resources.filter(
        (resource): resource is Extract<LinkedFormulaResource, { kind: "field"; scope: "page" }> =>
          resource.kind === "field" && resource.scope === "page" && resource.pageId !== options.pageId,
      );
      const sourcePages = new Map<number, typeof sourcePageFields>();
      for (const field of sourcePageFields) {
        sourcePages.set(field.pageId, [...(sourcePages.get(field.pageId) ?? []), field]);
      }
      const accepted = requirement.resources.every((resource) => {
        const key = linkedFormulaResourceKey(resource);
        if (allowed.has(key)) return true;
        if (isExportedFormulaBasePageResource(resource, state.exportedBasePage)) return true;
        if (resource.kind === "field" && resource.scope === "page") return exported.has(key);
        if (resource.kind === "page" && resource.pageId !== options.pageId) {
          const fields = sourcePages.get(resource.pageId) ?? [];
          return fields.length > 0 && fields.every((field) => exported.has(linkedFormulaResourceKey(field)));
        }
        return false;
      });
      if (accepted) {
        sources.push(requirement.source);
        deniedSourceKeys.delete(requirement.source.key);
        for (const field of sourcePageFields) {
          const key = linkedFormulaResourceKey(field);
          if (exported.has(key)) exportedSourceFields.add(key);
        }
      }
    }
  } catch {
    // neutral
  }
  for (const values of out.values()) {
    for (const key of deniedSourceKeys) markDeniedFormulaProjection(values, key);
  }
  if (!sources.length || !options.rows.length) return out;
  try {
    const requestedIds = options.rows.map((row) => row.id);
    const exportedBasePage = state.exportedBasePage;
    const usesExportedBasePage =
      exportedBasePage?.entityId === options.entityId
      && exportedBasePage.pageId === options.pageId
      && options.pageId != null
      && options.permissions.filterPageFormulaSourceRows != null;
    const allowedBase = usesExportedBasePage
      ? await options.permissions.filterPageFormulaSourceRows!({
          entityId: options.entityId,
          pageId: options.pageId!,
          recordIds: requestedIds,
        })
      : await options.permissions.filterRows({
          entityId: options.entityId,
          pageId: options.pageId,
          recordIds: requestedIds,
        });
    const eligibleIds = requestedIds.filter((id) => allowedBase.has(id));
    for (const id of requestedIds) {
      if (allowedBase.has(id)) continue;
      for (const source of sources) markDeniedFormulaProjection(out.get(id)!, source.key);
    }
    if (!eligibleIds.length) return out;
    const exportedPageIds = new Set([...exportedSourceFields].flatMap((key) => {
      const match = /^field:\d+:page:(\d+):/.exec(key);
      return match ? [Number(match[1])] : [];
    }));
    const resolutionPermissions: LinkedFormulaPermissionContext =
      exportedSourceFields.size || usesExportedBasePage
      ? {
          ...options.permissions,
          async authorizeResources(resources) {
            const allowed = new Set(await options.permissions.authorizeResources(resources));
            for (const resource of resources) {
              const key = linkedFormulaResourceKey(resource);
              if (
                isExportedFormulaBasePageResource(resource, exportedBasePage)
                ||
                (resource.kind === "field" && exportedSourceFields.has(key))
                || (
                  resource.kind === "page"
                  && resources.some((candidate) =>
                    candidate.kind === "field"
                    && candidate.scope === "page"
                    && candidate.entityId === resource.entityId
                    && candidate.pageId === resource.pageId
                    && exportedSourceFields.has(linkedFormulaResourceKey(candidate)))
                )
              ) allowed.add(key);
            }
            return allowed;
          },
          async filterRows(scope) {
            if (
              exportedBasePage != null
              && scope.entityId === exportedBasePage.entityId
              && scope.pageId === exportedBasePage.pageId
              && options.permissions.filterPageFormulaSourceRows
            ) {
              return options.permissions.filterPageFormulaSourceRows({
                ...scope,
                pageId: exportedBasePage.pageId,
              });
            }
            if (
              scope.pageId != null
              && exportedPageIds.has(scope.pageId)
              && options.permissions.filterPageFormulaSourceRows
            ) {
              return options.permissions.filterPageFormulaSourceRows({
                ...scope,
                pageId: scope.pageId,
              });
            }
            return options.permissions.filterRows(scope);
          },
        }
      : options.permissions;
    const resolved = await resolveLinkedFormulaData({
      baseEntityId: options.entityId,
      basePageId: options.pageId,
      baseRecordIds: eligibleIds,
      sources,
      permissions: resolutionPermissions,
    });
    for (const [id, values] of resolved.valuesByRecordId) Object.assign(out.get(id)!, values);
    for (const [id, keys] of resolved.deniedSourceKeysByRecordId) {
      for (const key of keys) markDeniedFormulaProjection(out.get(id)!, key);
    }

    // pageLocal may itself target a computed page field. Such a value has no
    // page_record_values scalar, so evaluate that page's authorized formula
    // scope and replace the resolver's null placeholder. This remains bounded
    // and cycle-safe, and every transitive field/source is authorized through
    // the same permission adapter before any raw value enters the scope.
    if (state.depth < 16) {
      const pageFormulaSources = sources.filter(
        (source): source is Extract<LinkedFormulaSource, { kind: "pageLocal" }> =>
          source.kind === "pageLocal",
      );
      const sourcePageIds = [...new Set(pageFormulaSources.map((source) => source.pageId))];
      if (sourcePageIds.length) {
        const [allEntityFields, allPageFields, storedPageRows] = await Promise.all([
          db.select().from(entityFieldsTable).where(and(
            eq(entityFieldsTable.entityId, options.entityId),
            eq(entityFieldsTable.isActive, true),
          )),
          db.select().from(pageFieldsTable).where(and(
            inArray(pageFieldsTable.pageId, sourcePageIds),
            eq(pageFieldsTable.isActive, true),
          )),
          db.select({
            pageId: pageRecordValuesTable.pageId,
            recordId: pageRecordValuesTable.recordId,
            values: pageRecordValuesTable.valuesJson,
          }).from(pageRecordValuesTable).where(and(
            inArray(pageRecordValuesTable.pageId, sourcePageIds),
            idArrayAny(pageRecordValuesTable.recordId, eligibleIds),
          )),
        ]);
        const fieldResources: LinkedFormulaResource[] = [
          ...allEntityFields.map((field) => ({
            kind: "field" as const,
            entityId: options.entityId,
            scope: "entity" as const,
            fieldKey: field.fieldKey,
          })),
          ...allPageFields.map((field) => ({
            kind: "field" as const,
            entityId: options.entityId,
            scope: "page" as const,
            pageId: field.pageId,
            fieldKey: field.fieldKey,
          })),
        ];
        const allowedFields = await options.permissions.authorizeResources(fieldResources);
        const requestedByPage = new Map<number, Extract<LinkedFormulaSource, { kind: "pageLocal" }>[]>();
        for (const source of pageFormulaSources) {
          requestedByPage.set(source.pageId, [...(requestedByPage.get(source.pageId) ?? []), source]);
        }
        const exportedDependencyFields = new Set<string>();
        if (options.permissions.authorizePageFormulaSourceFields) {
          const exactDependencies = sourcePageIds.flatMap((pageId) => {
            const pageFields = allPageFields.filter((field) => field.pageId === pageId);
            return (requestedByPage.get(pageId) ?? []).flatMap((source) => {
              const target = pageFields.find((field) => field.fieldKey === source.fieldKey);
              if (!target) return [];
              return localFormulaDependencyClosure(
                target,
                options.entityId,
                pageId,
                allEntityFields,
                pageFields,
              ).filter((field) =>
                pageFields.some((pageField) => pageField.fieldKey === field.fieldKey),
              ).map((field) => ({
                kind: "field" as const,
                entityId: options.entityId,
                scope: "page" as const,
                pageId,
                fieldKey: field.fieldKey,
              }));
            });
          });
          const exported = await options.permissions.authorizePageFormulaSourceFields(exactDependencies);
          for (const key of exported) exportedDependencyFields.add(key);
        }
        const deniedComputedSources = new Set<string>();
        for (const [pageId, requestedSources] of requestedByPage) {
          const pageFields = allPageFields.filter((field) => field.pageId === pageId);
          for (const source of requestedSources) {
            const target = pageFields.find((field) =>
              field.fieldKey === source.fieldKey && field.fieldType === "function");
            if (!target) continue;
            const dependencies = localFormulaDependencyClosure(
              target,
              options.entityId,
              pageId,
              allEntityFields,
              pageFields,
            ).filter((field) =>
              pageFields.some((pageField) => pageField.fieldKey === field.fieldKey));
            if (dependencies.some((field) => {
              const key = linkedFormulaResourceKey({
                kind: "field",
                entityId: options.entityId,
                scope: "page",
                pageId,
                fieldKey: field.fieldKey,
              });
              return !allowedFields.has(key) && !exportedDependencyFields.has(key);
            })) {
              deniedComputedSources.add(source.key);
            }
          }
        }
        const visibleEntityFields = allEntityFields.filter((field) =>
          allowedFields.has(linkedFormulaResourceKey({
            kind: "field", entityId: options.entityId, scope: "entity", fieldKey: field.fieldKey,
          })) &&
          !(
            field.fieldType === "function" &&
            (field.formulaConfigJson as { groupResult?: { enabled?: unknown } } | null)?.groupResult?.enabled === true
          ));
        const pageValues = new Map<string, Record<string, unknown>>();
        for (const row of storedPageRows) {
          pageValues.set(`${row.pageId}:${row.recordId}`, (row.values as Record<string, unknown>) ?? {});
        }
        for (const pageId of sourcePageIds) {
          const useExportRows = allPageFields.some((field) =>
            field.pageId === pageId
            && exportedDependencyFields.has(linkedFormulaResourceKey({
              kind: "field",
              entityId: options.entityId,
              scope: "page",
              pageId,
              fieldKey: field.fieldKey,
            })));
          const allowedPageRows = useExportRows && options.permissions.filterPageFormulaSourceRows
            ? await options.permissions.filterPageFormulaSourceRows({
                entityId: options.entityId,
                pageId,
                recordIds: eligibleIds,
              })
            : await options.permissions.filterRows({
                entityId: options.entityId,
                pageId,
                recordIds: eligibleIds,
              });
          const visiblePageFields = allPageFields.filter((field) =>
            field.pageId === pageId &&
            (
              allowedFields.has(linkedFormulaResourceKey({
                kind: "field", entityId: options.entityId, scope: "page", pageId, fieldKey: field.fieldKey,
              }))
              || exportedDependencyFields.has(linkedFormulaResourceKey({
                kind: "field", entityId: options.entityId, scope: "page", pageId, fieldKey: field.fieldKey,
              }))
            ) &&
            !(
              field.fieldType === "function" &&
              (field.formulaConfigJson as { groupResult?: { enabled?: unknown } } | null)?.groupResult?.enabled === true
            ));
          const requested = pageFormulaSources.filter((source) =>
            source.pageId === pageId &&
            !deniedComputedSources.has(source.key) &&
            visiblePageFields.some((field) =>
              field.fieldKey === source.fieldKey &&
              field.fieldType === "function" &&
              !state.pageFormulaStack.has(`page:${pageId}.${source.fieldKey}`),
            ));
          for (const source of pageFormulaSources.filter((candidate) =>
            candidate.pageId === pageId && deniedComputedSources.has(candidate.key))) {
            for (const id of eligibleIds) {
              out.get(id)![source.key] = null;
              markDeniedFormulaProjection(out.get(id)!, source.key);
            }
          }
          const requestedPageRefs = pageFormulaSources.filter((source) =>
            source.pageId === pageId &&
            visiblePageFields.some((field) =>
              field.fieldKey === source.fieldKey
              && field.fieldType === "page_ref"
              && !state.pageFormulaStack.has(`page:${pageId}.${source.fieldKey}`),
            ));
          for (const source of requestedPageRefs) {
            const targetField = visiblePageFields.find((field) =>
              field.fieldKey === source.fieldKey && field.fieldType === "page_ref");
            // Older dependency shapes do not expose pageRefConfigJson here.
            // The full DB row does; read it without widening the shared
            // FormulaDependencyField type used by pure callers.
            const pageRefConfig = (targetField as (typeof targetField & {
              pageRefConfigJson?: { sourcePageId?: unknown; sourceFieldKey?: unknown };
            }) | undefined)?.pageRefConfigJson;
            const sourcePageId = pageRefConfig?.sourcePageId;
            const sourceFieldKey = pageRefConfig?.sourceFieldKey;
            if (
              typeof sourcePageId !== "number"
              || !Number.isInteger(sourcePageId)
              || sourcePageId <= 0
              || typeof sourceFieldKey !== "string"
              || !sourceFieldKey
            ) continue;
            const token = `__page_ref_source:${pageId}.${source.fieldKey}`;
            const nextStack = new Set(state.pageFormulaStack);
            nextStack.add(`page:${pageId}.${source.fieldKey}`);
            const nested = await mergeLinkedFormulaInputs({
              entityId: options.entityId,
              pageId: options.pageId,
              rows: options.rows,
              fields: [{
                fieldKey: token,
                fieldType: "function",
                formulaConfigJson: {
                  expression: `{${token}}`,
                  sources: [{
                    kind: "pageLocal",
                    key: token,
                    pageId: sourcePageId,
                    fieldKey: sourceFieldKey,
                  }],
                },
              }],
              permissions: options.permissions,
            }, { depth: state.depth + 1, pageFormulaStack: nextStack });
            for (const id of allowedPageRows) {
              const nestedValues = nested.get(id);
              out.get(id)![source.key] = nestedValues?.[token] ?? null;
              if (isDeniedFormulaProjection(nestedValues, token)) {
                markDeniedFormulaProjection(out.get(id)!, source.key);
              }
            }
          }
          if (!requested.length) continue;
          const pageRows = eligibleIds.filter((id) => allowedPageRows.has(id)).map((id) => ({
            id,
            entityValues: options.rows.find((row) => row.id === id)?.values ?? {},
            pageValues: pageValues.get(`${pageId}:${id}`) ?? {},
          }));
          for (const source of requested) {
            const targetField = visiblePageFields.find((field) => field.fieldKey === source.fieldKey);
            if (!targetField) continue;
            const nextStack = new Set(state.pageFormulaStack);
            nextStack.add(`page:${pageId}.${source.fieldKey}`);
            const targetResource = {
              kind: "field" as const,
              entityId: options.entityId,
              scope: "page" as const,
              pageId,
              fieldKey: source.fieldKey,
            };
            const exportedBasePage = exportedDependencyFields.has(
              linkedFormulaResourceKey(targetResource),
            )
              ? { entityId: options.entityId, pageId }
              : undefined;
            const nestedInputs = await mergeLinkedFormulaInputs({
              entityId: options.entityId,
              pageId,
              rows: pageRows.map((row) => ({ id: row.id, values: row.entityValues })),
              fields: localFormulaDependencyClosure(
                targetField,
                options.entityId,
                pageId,
                visibleEntityFields,
                visiblePageFields,
              ),
              permissions: options.permissions,
            }, {
              depth: state.depth + 1,
              pageFormulaStack: nextStack,
              exportedBasePage,
            });
            const computed = materializeVisiblePageFormulas({
              entityId: options.entityId,
              pageId,
              rows: pageRows,
              entityFields: visibleEntityFields,
              pageFields: visiblePageFields,
              hiddenEntity: new Set(),
              hiddenPage: new Set(),
              linkedInputs: nestedInputs,
              formulaOptions: await loadFormulaOptions(),
            });
            for (const id of allowedPageRows) {
              const computedValues = computed.get(id);
              out.get(id)![source.key] = computedValues?.[source.fieldKey] ?? null;
              if (isDeniedFormulaProjection(computedValues, source.fieldKey)) {
                markDeniedFormulaProjection(out.get(id)!, source.key);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof LinkedFormulaResolutionError && error.code === "LIMIT_EXCEEDED") {
      throw error;
    }
    // Formula sources are optional derived data. Fail closed and neutral rather
    // than turning an inaccessible dependency into an observable HTTP error.
  }
  return out;
}

/**
 * Full-set counterpart for aggregates/group-result evaluation. Resolves linked
 * inputs in bounded batches while returning one map for winner selection across
 * the complete caller-provided row set.
 */
export async function mergeLinkedFormulaInputsBatched(
  options: Parameters<typeof mergeLinkedFormulaInputs>[0],
  _batchSize = 5_000,
): Promise<Map<number, Record<string, unknown>>> {
  // The linked resolver already performs set-based metadata, target-record and
  // relation-link loads. Splitting base rows here repeats the complete target
  // scan for every chunk, so full-set callers must resolve once and then reuse
  // the resulting map for winner/group selection.
  return mergeLinkedFormulaInputs(options);
}

function hasOwnValue(values: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function prepareMaterializationValues(options: {
  rawEntityValues: Record<string, unknown>;
  rawPageValues: Record<string, unknown>;
  linkedValues: Record<string, unknown>;
  visibleEntityFields: readonly FormulaDependencyField[];
  visiblePageFields: readonly FormulaDependencyField[];
  sourceKeys: readonly string[];
}): {
  responseEntityValues: Record<string, unknown>;
  responsePageValues: Record<string, unknown>;
  scopeEntityValues: Record<string, unknown>;
  scopePageValues: Record<string, unknown>;
} {
  const responseEntityValues = projectViewerFormulaValues(
    options.rawEntityValues,
    options.visibleEntityFields,
  );
  const responsePageValues = projectViewerFormulaValues(
    options.rawPageValues,
    options.visiblePageFields,
  );
  // Keep native entity/page storage in separate permission-filtered maps.
  // Projecting the raw merged input against a union of both schemas is unsafe:
  // a visible page field named like a hidden entity field would otherwise admit
  // the hidden entity value and recreate its qualified entity alias.
  const scopeEntityValues = { ...responseEntityValues };
  const scopePageValues = { ...responsePageValues };
  const entityFieldByKey = new Map(options.visibleEntityFields.map((field) => [field.fieldKey, field]));
  const pageFieldByKey = new Map(options.visiblePageFields.map((field) => [field.fieldKey, field]));

  for (const sourceKey of options.sourceKeys) {
    const entityField = entityFieldByKey.get(sourceKey);
    const pageField = pageFieldByKey.get(sourceKey);
    const hasLinkedValue = hasOwnValue(options.linkedValues, sourceKey);
    // Source tokens are capabilities, not response data. Preserve a same-key
    // real scalar field, but never serialize a relation/lookup projection.
    if (!entityField || entityField.fieldType === "relation" || entityField.fieldType === "lookup") {
      delete responseEntityValues[sourceKey];
    }
    if (!pageField || pageField.fieldType === "relation" || pageField.fieldType === "lookup") {
      delete responsePageValues[sourceKey];
    }

    // Current-page fields shadow entity fields for flat legacy references.
    // Route a page relation/lookup projection into page scope, while restoring
    // any same-key entity scalar for qualified {entity:<id>.<key>} reads.
    if (
      pageField
      && (pageField.fieldType === "relation" || pageField.fieldType === "lookup")
      && hasLinkedValue
    ) {
      scopePageValues[sourceKey] = options.linkedValues[sourceKey];
    } else if (
      entityField
      && (entityField.fieldType === "relation" || entityField.fieldType === "lookup")
      && hasLinkedValue
    ) {
      scopeEntityValues[sourceKey] = options.linkedValues[sourceKey];
    } else if (!entityField && !pageField && hasLinkedValue) {
      // Structured aliases and qualified cross-page tokens are capabilities
      // authorized by mergeLinkedFormulaInputs, not native stored values.
      scopeEntityValues[sourceKey] = options.linkedValues[sourceKey];
    }
  }

  return {
    responseEntityValues,
    responsePageValues,
    scopeEntityValues,
    scopePageValues,
  };
}

/**
 * Materialize the response-safe portion of entity formula fields after linked
 * inputs have been resolved.  Resolver tokens are intentionally left only in
 * this temporary input map; callers still pass the result through
 * `presentRecord`, which removes them before JSON serialization.
 *
 * Formula definitions are restricted to fields visible to this viewer. This is
 * important even though a hidden formula is not copied into the output: putting
 * it in the lazy scope would allow a visible formula to observe its result.
 * Visible formula-to-formula chains (including qualified entity references)
 * remain lazy and cycle-safe through buildQualifiedFormulaScope.
 */
export function materializeVisibleEntityFormulas(options: {
  entityId: number;
  rows: readonly { id: number; values: Record<string, unknown> }[];
  fields: readonly (FormulaConfiguredField & { fieldKey: string; formulaConfigJson?: unknown })[];
  hidden: ReadonlySet<string>;
  pageId?: number;
  pageValues?: ReadonlyMap<number, Record<string, unknown>>;
  pageFields?: readonly (FormulaConfiguredField & { fieldKey: string; formulaConfigJson?: unknown })[];
  hiddenPage?: ReadonlySet<string>;
  linkedInputs?: ReadonlyMap<number, Record<string, unknown>>;
  formulaOptions?: FormulaEvaluationOptions;
}): Map<number, Record<string, unknown>> {
  const formulas: FormulaFieldDef[] = options.fields
    .filter((field) => field.fieldType === "function" && !options.hidden.has(field.fieldKey))
    .map((field) => {
      const config = field.formulaConfigJson as { expression?: unknown; decimals?: unknown } | null;
      return {
        key: field.fieldKey,
        expression: typeof config?.expression === "string" ? config.expression : "",
        decimals: typeof config?.decimals === "number" ? config.decimals : null,
      };
    });
  const pageFormulas: FormulaFieldDef[] = (options.pageFields ?? [])
    .filter((field) => field.fieldType === "function" && !options.hiddenPage?.has(field.fieldKey))
    .map((field) => {
      const config = field.formulaConfigJson as { expression?: unknown; decimals?: unknown } | null;
      return {
        key: field.fieldKey,
        expression: typeof config?.expression === "string" ? config.expression : "",
        decimals: typeof config?.decimals === "number" ? config.decimals : null,
      };
    });
  const dependencyFields = [...options.fields, ...(options.pageFields ?? [])];
  const sourceKeys = [
    ...formulaSourcesOf(dependencyFields).map((source) => source.key),
    ...legacySourceKeysOf(dependencyFields),
  ];
  const out = new Map<number, Record<string, unknown>>();
  const visibleEntityFields = options.fields.filter((field) => !options.hidden.has(field.fieldKey));
  const visiblePageFields = (options.pageFields ?? []).filter(
    (field) => !options.hiddenPage?.has(field.fieldKey),
  );
  for (const row of options.rows) {
    const denied = new Set([
      ...deniedKeys(options.linkedInputs?.get(row.id)),
      ...deniedKeys(row.values),
      ...deniedKeys(options.pageValues?.get(row.id)),
    ]);
    const prepared = prepareMaterializationValues({
      rawEntityValues: row.values,
      rawPageValues: options.pageValues?.get(row.id) ?? {},
      linkedValues: options.linkedInputs?.get(row.id) ?? row.values,
      visibleEntityFields,
      visiblePageFields,
      sourceKeys,
    });
    const values = prepared.responseEntityValues;
    if (formulas.length > 0) {
      const scope = buildQualifiedFormulaScope({
        entityId: options.entityId,
        entityValues: prepared.scopeEntityValues,
        entityFormulas: formulas,
        pageId: options.pageId,
        pageValues: prepared.scopePageValues,
        pageFormulas,
        formulaOptions: options.formulaOptions,
      });
      for (const formula of formulas) {
        // Reading through the scope (rather than evaluating the expression
        // directly) preserves formula chains, qualified aliases and cycle
        // handling. FormulaValue is deliberately scalar/null; guard anyway so
        // a future evaluator cannot introduce an opaque response object here.
        const result = scope[formula.key];
        if (
          result === null ||
          typeof result === "string" ||
          typeof result === "number" ||
          typeof result === "boolean"
        ) {
          values[formula.key] = result;
        }
      }
      const deniedFormulas = formulaDeniedKeys(
        options.entityId,
        options.pageId,
        formulas,
        pageFormulas,
        denied,
      );
      for (const key of deniedFormulas.entity) {
        values[key] = null;
        markDeniedFormulaProjection(values, key);
      }
    }
    out.set(row.id, values);
  }
  return out;
}

/** The page-local counterpart writes results into the page value map, where a
 * page field's normal key cannot collide with entity storage. */
export function materializeVisiblePageFormulas(options: {
  entityId: number;
  pageId: number;
  rows: readonly { id: number; entityValues: Record<string, unknown>; pageValues: Record<string, unknown> }[];
  entityFields: readonly (FormulaConfiguredField & { fieldKey: string; formulaConfigJson?: unknown })[];
  pageFields: readonly (FormulaConfiguredField & { fieldKey: string; formulaConfigJson?: unknown })[];
  hiddenEntity: ReadonlySet<string>;
  hiddenPage: ReadonlySet<string>;
  linkedInputs?: ReadonlyMap<number, Record<string, unknown>>;
  formulaOptions?: FormulaEvaluationOptions;
}): Map<number, Record<string, unknown>> {
  const defs = (fields: readonly (FormulaConfiguredField & { fieldKey: string; formulaConfigJson?: unknown })[], hidden: ReadonlySet<string>) =>
    fields.filter((f) => f.fieldType === "function" && !hidden.has(f.fieldKey)).map((f) => {
      const config = f.formulaConfigJson as { expression?: unknown; decimals?: unknown } | null;
      return { key: f.fieldKey, expression: typeof config?.expression === "string" ? config.expression : "", decimals: typeof config?.decimals === "number" ? config.decimals : null };
    });
  const entityFormulas = defs(options.entityFields, options.hiddenEntity);
  const pageFormulas = defs(options.pageFields, options.hiddenPage);
  const dependencyFields = [...options.entityFields, ...options.pageFields];
  const sourceKeys = [
    ...formulaSourcesOf(dependencyFields).map((source) => source.key),
    ...legacySourceKeysOf(dependencyFields),
  ];
  const out = new Map<number, Record<string, unknown>>();
  const visibleEntityFields = options.entityFields.filter((field) => !options.hiddenEntity.has(field.fieldKey));
  const visiblePageFields = options.pageFields.filter((field) => !options.hiddenPage.has(field.fieldKey));
  for (const row of options.rows) {
    const denied = new Set([
      ...deniedKeys(options.linkedInputs?.get(row.id)),
      ...deniedKeys(row.entityValues),
      ...deniedKeys(row.pageValues),
    ]);
    const prepared = prepareMaterializationValues({
      rawEntityValues: row.entityValues,
      rawPageValues: row.pageValues,
      linkedValues: options.linkedInputs?.get(row.id) ?? row.entityValues,
      visibleEntityFields,
      visiblePageFields,
      sourceKeys,
    });
    const pageValues = prepared.responsePageValues;
    const scope = buildQualifiedFormulaScope({
      entityId: options.entityId, entityValues: prepared.scopeEntityValues, entityFormulas,
      pageId: options.pageId, pageValues: prepared.scopePageValues, pageFormulas, formulaOptions: options.formulaOptions,
    });
    for (const formula of pageFormulas) {
      const result = scope[`page:${options.pageId}.${formula.key}`];
      if (result === null || typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
        pageValues[formula.key] = result;
      }
    }
    const deniedFormulas = formulaDeniedKeys(
      options.entityId,
      options.pageId,
      entityFormulas,
      pageFormulas,
      denied,
    );
    for (const key of deniedFormulas.page) {
      pageValues[key] = null;
      markDeniedFormulaProjection(pageValues, key);
    }
    out.set(row.id, pageValues);
  }
  return out;
}

function formulaDeniedKeys(
  entityId: number,
  pageId: number | undefined,
  entityFormulas: readonly FormulaFieldDef[],
  pageFormulas: readonly FormulaFieldDef[],
  deniedInputs: ReadonlySet<string>,
): { entity: Set<string>; page: Set<string> } {
  const entityByKey = new Map(entityFormulas.map((formula) => [formula.key, formula]));
  const pageByKey = new Map(pageFormulas.map((formula) => [formula.key, formula]));
  const memo = new Map<string, boolean>();
  const active = new Set<string>();
  const visit = (scope: "entity" | "page", key: string): boolean => {
    const id = `${scope}:${key}`;
    const cached = memo.get(id);
    if (cached != null) return cached;
    if (active.has(id)) return false;
    const formula = scope === "entity" ? entityByKey.get(key) : pageByKey.get(key);
    if (!formula) return deniedInputs.has(key);
    active.add(id);
    let denied = false;
    for (const match of formula.expression.matchAll(/\{([^{}]+)\}/g)) {
      const token = match[1].trim();
      if (deniedInputs.has(token)) {
        denied = true;
        break;
      }
      const entityRef = new RegExp(`^entity:${entityId}\\.(.+)$`).exec(token);
      if (entityRef) {
        if (visit("entity", entityRef[1])) { denied = true; break; }
        continue;
      }
      const pageRef = pageId == null ? null : new RegExp(`^page:${pageId}\\.(.+)$`).exec(token);
      if (pageRef) {
        if (visit("page", pageRef[1])) { denied = true; break; }
        continue;
      }
      if (!token.includes(":") && !token.includes(".")) {
        if (pageByKey.has(token) ? visit("page", token) : visit("entity", token)) {
          denied = true;
          break;
        }
      }
    }
    active.delete(id);
    memo.set(id, denied);
    return denied;
  };
  const entity = new Set(entityFormulas.filter((formula) =>
    visit("entity", formula.key)).map((formula) => formula.key));
  const page = new Set(pageFormulas.filter((formula) =>
    visit("page", formula.key)).map((formula) => formula.key));
  return { entity, page };
}