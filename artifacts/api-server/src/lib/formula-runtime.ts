import type { Request } from "express";
import {
  db,
  entityFieldsTable,
  entityRecordsTable,
  pageFieldsTable,
  pagesTable,
  type EntityField,
  type RecordPermission,
  type RolePermissions,
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
import { buildFormulaScope, type FormulaEvaluationOptions, type FormulaFieldDef } from "@workspace/formula";

type FormulaConfiguredField = { fieldType: string; formulaConfigJson?: unknown };

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
          ok = (perms.superAdmin || perms.admin.pages || perms.pageIds.includes(resource.pageId)) && rp?.view === true;
        } else if (resource.scope === "entity") {
          const field = entityFieldByKey.get(`${resource.entityId}:${resource.fieldKey}`);
          const contextPage = resource.entityId === baseEntityId ? basePageId : undefined;
          const rp = recordPerm(resource.entityId, contextPage);
          ok = !!field && rp?.view === true &&
            resolveFieldAccess(field, perms, roleIds, resource.entityId, rp, contextPage) !== "hidden";
        } else {
          const field = pageFieldByKey.get(`${resource.pageId}:${resource.fieldKey}`);
          const rp = recordPerm(resource.entityId, resource.pageId);
          ok = !!field &&
            (perms.superAdmin || perms.admin.pages || perms.pageIds.includes(resource.pageId)) &&
            rp?.view === true &&
            mostPermissiveFieldPerm(field.permissionsJson, roleIds, "view", perms, resource.entityId, resource.pageId) !== "hidden";
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
  fields: readonly FormulaConfiguredField[];
  permissions: LinkedFormulaPermissionContext;
}): Promise<Map<number, Record<string, unknown>>> {
  const out = new Map(options.rows.map((row) => [row.id, { ...row.values }]));
  const configuredSources = formulaSourcesOf(options.fields);
  const baseResources: LinkedFormulaResource[] = [
    { kind: "entity", entityId: options.entityId },
    ...(options.pageId == null ? [] : [{ kind: "page" as const, pageId: options.pageId, entityId: options.entityId }]),
  ];
  // Authorize the complete graph in one call. A hidden source becomes neutral
  // without suppressing unrelated allowed inputs.
  const sourceRequirements = configuredSources.map((source) => {
    const resources: LinkedFormulaResource[] = [...baseResources];
    if (source.kind === "pageLocal") {
      resources.push(
        { kind: "page", pageId: source.pageId, entityId: options.entityId },
        { kind: "field", entityId: options.entityId, scope: "page", pageId: source.pageId, fieldKey: source.fieldKey },
      );
    } else {
      resources.push({ kind: "entity", entityId: source.targetEntityId });
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
  const sourceKeys = formulaSourcesOf([...options.fields, ...(options.pageFields ?? [])]).map((source) => source.key);
  const out = new Map<number, Record<string, unknown>>();
  const visibleEntityFields = options.fields.filter((field) => !options.hidden.has(field.fieldKey));
  const visiblePageFields = (options.pageFields ?? []).filter(
    (field) => !options.hiddenPage?.has(field.fieldKey),
  );
  for (const row of options.rows) {
    const values = projectViewerFormulaValues(
      options.linkedInputs?.get(row.id) ?? row.values,
      [...visibleEntityFields, ...visiblePageFields],
    );
    const pageValues = projectViewerFormulaValues(
      options.pageValues?.get(row.id) ?? {},
      visiblePageFields,
    );
    if (formulas.length > 0) {
      const scope = buildQualifiedFormulaScope({
        entityId: options.entityId,
        entityValues: values,
        entityFormulas: formulas,
        pageId: options.pageId,
        pageValues,
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
    // Do not rely solely on a particular HTTP presenter to remove these
    // capabilities: callers may use this helper for a dedicated response map.
    for (const sourceKey of sourceKeys) delete values[sourceKey];
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
  const sourceKeys = formulaSourcesOf([...options.entityFields, ...options.pageFields]).map((source) => source.key);
  const out = new Map<number, Record<string, unknown>>();
  for (const row of options.rows) {
    const visibleEntityFields = options.entityFields.filter((field) => !options.hiddenEntity.has(field.fieldKey));
    const visiblePageFields = options.pageFields.filter((field) => !options.hiddenPage.has(field.fieldKey));
    const entityValues = projectViewerFormulaValues(
      options.linkedInputs?.get(row.id) ?? row.entityValues,
      [...visibleEntityFields, ...visiblePageFields],
    );
    const pageValues = projectViewerFormulaValues(row.pageValues, visiblePageFields);
    const scope = buildQualifiedFormulaScope({
      entityId: options.entityId, entityValues, entityFormulas,
      pageId: options.pageId, pageValues, pageFormulas, formulaOptions: options.formulaOptions,
    });
    for (const formula of pageFormulas) {
      const result = scope[`page:${options.pageId}.${formula.key}`];
      if (result === null || typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
        pageValues[formula.key] = result;
      }
    }
    for (const sourceKey of sourceKeys) delete pageValues[sourceKey];
    out.set(row.id, pageValues);
  }
  return out;
}