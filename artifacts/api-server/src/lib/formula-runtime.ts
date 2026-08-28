import type { Request } from "express";
import {
  db,
  entityFieldsTable,
  entityRecordsTable,
  pageFieldsTable,
  pagesTable,
  relationsTable,
  type EntityField,
  type RecordPermission,
  type RolePermissions,
  appSettingsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import {
  effectiveRecordPerm,
  effectiveScopeFor,
  getPermissions,
  getUserRoleIds,
  mostPermissiveFieldPerm,
  resolveFieldAccess,
} from "../middlewares/permissions";
import { ownScopeWhere } from "../routes/own-scope";
import {
  linkedFormulaResourceKey,
  resolveLinkedFormulaData,
  type LinkedFormulaPermissionContext,
  type LinkedFormulaResource,
  type LinkedFormulaSource,
} from "./linked-formula-resolver";
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

/** Field references are deliberately extracted without evaluating an expression.
 * Invalid expressions remain the evaluator's concern and simply contribute no
 * dependency here. */
function formulaReferenceKeys(fields: readonly FormulaConfiguredField[]): Set<string> {
  const keys = new Set<string>();
  for (const field of fields) {
    if (field.fieldType !== "function") continue;
    const expression = (field.formulaConfigJson as { expression?: unknown } | null)?.expression;
    if (typeof expression !== "string") continue;
    for (const match of expression.matchAll(/\{([^{}]+)\}/g)) {
      const key = match[1].trim();
      // Legacy references are flat. Qualified names already have an explicit
      // namespace and must not be guessed as a relation field.
      if (key && !key.includes(":") && !key.includes(".")) keys.add(key);
    }
  }
  return keys;
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
  for (const field of fields) {
    if (field.fieldType !== "function") continue;
    const sources = normalizeFormulaFieldSources(
      (field.formulaConfigJson as { sources?: unknown } | null)?.sources,
    ) as LinkedFormulaSource[];
    for (const source of sources) {
      // Source tokens share one formula scope. Identical definitions are
      // harmless; a cross-field key collision with different definitions is
      // ambiguous and therefore removed (neutral), never resolved arbitrarily.
      const previous = byKey.get(source.key);
      if (previous === undefined) byKey.set(source.key, source);
      else if (previous !== null && JSON.stringify(previous) !== JSON.stringify(source)) byKey.set(source.key, null);
    }
  }
  return [...byKey.values()].filter((source): source is LinkedFormulaSource => source !== null);
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
): Promise<LinkedFormulaPermissionContext> {
  const [perms, roleIds] = await Promise.all([getPermissions(req), getUserRoleIds(req)]);
  return {
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
        inArray(entityRecordsTable.id, [...scope.recordIds]),
        isNull(entityRecordsTable.archivedAt),
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
}): Promise<Map<number, Record<string, unknown>>> {
  const out = new Map(options.rows.map((row) => [row.id, { ...row.values }]));
  const configuredSources = formulaSourcesOf(options.fields);
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
  try {
    const unique = new Map(sourceRequirements.flatMap(({ resources }) =>
      resources.map((resource) => [linkedFormulaResourceKey(resource), resource] as const),
    ));
    const allowed = await options.permissions.authorizeResources([...unique.values()]);
    for (const requirement of sourceRequirements) {
      if (requirement.keys.every((key) => allowed.has(key))) sources.push(requirement.source);
    }
  } catch {
    // neutral
  }
  if (!sources.length || !options.rows.length) return out;
  try {
    const requestedIds = options.rows.map((row) => row.id);
    const allowedBase = await options.permissions.filterRows({
      entityId: options.entityId,
      pageId: options.pageId,
      recordIds: requestedIds,
    });
    const eligibleIds = requestedIds.filter((id) => allowedBase.has(id));
    if (!eligibleIds.length) return out;
    const resolved = await resolveLinkedFormulaData({
      baseEntityId: options.entityId,
      basePageId: options.pageId,
      baseRecordIds: eligibleIds,
      sources,
      permissions: options.permissions,
    });
    for (const [id, values] of resolved.valuesByRecordId) Object.assign(out.get(id)!, values);
  } catch {
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
  const scopeEntityValues = projectViewerFormulaValues(
    options.linkedValues,
    [...options.visibleEntityFields, ...options.visiblePageFields],
  );
  const scopePageValues = { ...responsePageValues };
  const entityFieldByKey = new Map(options.visibleEntityFields.map((field) => [field.fieldKey, field]));
  const pageFieldByKey = new Map(options.visiblePageFields.map((field) => [field.fieldKey, field]));

  for (const sourceKey of options.sourceKeys) {
    const entityField = entityFieldByKey.get(sourceKey);
    const pageField = pageFieldByKey.get(sourceKey);
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
      && hasOwnValue(scopeEntityValues, sourceKey)
    ) {
      scopePageValues[sourceKey] = scopeEntityValues[sourceKey];
      if (hasOwnValue(responseEntityValues, sourceKey)) {
        scopeEntityValues[sourceKey] = responseEntityValues[sourceKey];
      } else {
        delete scopeEntityValues[sourceKey];
      }
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
    out.set(row.id, pageValues);
  }
  return out;
}