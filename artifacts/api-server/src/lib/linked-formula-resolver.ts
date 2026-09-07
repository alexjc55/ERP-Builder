import {
  db,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  pageFieldsTable,
  pageRecordValuesTable,
  pagesTable,
  recordLinksTable,
  relationsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

export type LinkedFormulaAggregate = "sum" | "average" | "min" | "max" | "count" | "uniqueJoin";

/** A field reference is deliberately qualified. Page values can never silently
 * fall back to an entity value (or to the caller's current page). */
export type LinkedFormulaFieldRef =
  | { scope: "entity"; fieldKey: string }
  | { scope: "page"; pageId: number; fieldKey: string };

export type LinkedFormulaJoin =
  | { kind: "relation"; relationId: number; baseSide: "source" | "target" }
  | {
      kind: "equality";
      /** All comparisons are ANDed. Null never equals null. */
      on: ReadonlyArray<{ base: LinkedFormulaFieldRef; target: LinkedFormulaFieldRef }>;
    };

export type LinkedFormulaSource =
  | {
      key: string;
      kind: "pageLocal";
      pageId: number;
      fieldKey: string;
    }
  | {
      key: string;
      kind: "aggregate";
      targetEntityId: number;
      /** Required only when a target field/join field has scope "page". */
      targetPageId?: number;
      value?: LinkedFormulaFieldRef;
      join: LinkedFormulaJoin;
      aggregate: LinkedFormulaAggregate;
      /** Applied after row permissions, in stable target-record-id order. */
      limit?: number;
      separator?: string;
    };

export type LinkedFormulaResource =
  | { kind: "entity"; entityId: number }
  | { kind: "page"; pageId: number; entityId: number }
  | ({ kind: "field"; entityId: number } & LinkedFormulaFieldRef);

export interface LinkedFormulaRowScope {
  entityId: number;
  pageId?: number;
  recordIds: readonly number[];
}

/**
 * Authorization is dependency-injected so HTTP, automations and background jobs
 * can use their own identity model. It is intentionally fail-closed:
 * - every resource must be returned by authorizeResources;
 * - every requested base row must survive filterRows;
 * - inaccessible target rows are removed before limit/aggregation.
 * Callbacks throwing also abort resolution.
 */
export interface LinkedFormulaPermissionContext {
  authorizeResources(resources: readonly LinkedFormulaResource[]): Promise<ReadonlySet<string>>;
  filterRows(scope: LinkedFormulaRowScope): Promise<ReadonlySet<number>>;
}

export interface ResolveLinkedFormulaOptions {
  baseEntityId: number;
  basePageId?: number;
  baseRecordIds: readonly number[];
  sources: readonly LinkedFormulaSource[];
  permissions: LinkedFormulaPermissionContext;
  /** Hard safety boundary; overflow throws rather than returning partial totals. */
  maxTargetRecords?: number;
}

export interface LinkedFormulaResolution {
  valuesByRecordId: Map<number, Record<string, unknown>>;
  targetRecordsRead: number;
}

export class LinkedFormulaResolutionError extends Error {
  constructor(
    public readonly code: "INVALID_CONFIG" | "NOT_FOUND" | "FORBIDDEN" | "LIMIT_EXCEEDED",
    message: string,
  ) {
    super(message);
    this.name = "LinkedFormulaResolutionError";
  }
}

export function linkedFormulaResourceKey(resource: LinkedFormulaResource): string {
  if (resource.kind === "entity") return `entity:${resource.entityId}`;
  if (resource.kind === "page") return `page:${resource.entityId}:${resource.pageId}`;
  return resource.scope === "entity"
    ? `field:${resource.entityId}:entity:${resource.fieldKey}`
    : `field:${resource.entityId}:page:${resource.pageId}:${resource.fieldKey}`;
}

const invalid = (message: string): never => {
  throw new LinkedFormulaResolutionError("INVALID_CONFIG", message);
};

function assertPositiveId(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) invalid(`${label} must be a positive integer`);
}

function valueFrom(
  ref: LinkedFormulaFieldRef,
  entityValues: Record<string, unknown>,
  pageValues: Map<number, Record<string, unknown>>,
): unknown {
  return ref.scope === "entity"
    ? entityValues[ref.fieldKey]
    : pageValues.get(ref.pageId)?.[ref.fieldKey];
}

function equalityKey(values: readonly unknown[]): string | null {
  if (values.some((v) => v === null || v === undefined)) return null;
  // PostgreSQL's normal JSON-field join expression is `values_json ->> key`,
  // hence scalar comparisons are textual (JSON 12 equals stored string "12").
  return JSON.stringify(values.map((v) => typeof v === "object" ? JSON.stringify(v) : String(v)));
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Exported independently to keep aggregate semantics directly unit-testable. */
export function aggregateLinkedValues(
  aggregate: LinkedFormulaAggregate,
  values: readonly unknown[],
  separator = ", ",
): number | string | unknown | null {
  if (aggregate === "count") return values.length;
  if (aggregate === "uniqueJoin") {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const text = String(value);
      if (!seen.has(text)) {
        seen.add(text);
        ordered.push(text);
      }
    }
    return ordered.join(separator);
  }
  if (aggregate === "sum" || aggregate === "average") {
    const numbers = values.map(finiteNumber).filter((v): v is number => v !== null);
    const sum = numbers.reduce((total, value) => total + value, 0);
    return aggregate === "sum" ? sum : numbers.length ? sum / numbers.length : null;
  }
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (present.length === 0) return null;
  return present.slice(1).reduce((best, value) => {
    const bestNumber = finiteNumber(best);
    const valueNumber = finiteNumber(value);
    const comparison =
      bestNumber !== null && valueNumber !== null
        ? valueNumber - bestNumber
        : String(value).localeCompare(String(best));
    return aggregate === "min" ? (comparison < 0 ? value : best) : comparison > 0 ? value : best;
  }, present[0]);
}

type LoadedRecord = {
  id: number;
  entityId: number;
  values: Record<string, unknown>;
  pages: Map<number, Record<string, unknown>>;
};
type RecordRow = { id: number; entityId: number; values: unknown };
type FormulaFieldMetadata = {
  fieldType: string;
  relationConfigJson: unknown;
};

const fieldMetadataKey = (entityId: number, ref: LinkedFormulaFieldRef) =>
  ref.scope === "entity"
    ? `${entityId}:entity:${ref.fieldKey}`
    : `${entityId}:page:${ref.pageId}:${ref.fieldKey}`;

export function linkedFormulaEqualityKeys(values: readonly (readonly unknown[])[]): string[] {
  let combinations: unknown[][] = [[]];
  for (const candidates of values) {
    const present = candidates.filter((value) => value !== null && value !== undefined);
    if (!present.length) return [];
    if (combinations.length * present.length > 1_000) {
      throw new LinkedFormulaResolutionError("LIMIT_EXCEEDED", "Equality relation expansion exceeds 1000 combinations");
    }
    combinations = combinations.flatMap((combination) =>
      present.map((candidate) => [...combination, candidate]));
  }
  return combinations
    .map((combination) => equalityKey(combination))
    .filter((key): key is string => key !== null);
}

/**
 * Apply row RBAC once per distinct target scope. Several aggregates commonly
 * read different fields from the same entity/page; their permission boundary is
 * identical and must not cause repeated scope/status queries.
 */
export async function filterLinkedFormulaTargetsByScope(
  sources: readonly Pick<Extract<LinkedFormulaSource, { kind: "aggregate" }>, "key" | "targetEntityId" | "targetPageId">[],
  targetRows: readonly Pick<RecordRow, "id" | "entityId">[],
  filterRows: LinkedFormulaPermissionContext["filterRows"],
): Promise<Map<string, ReadonlySet<number>>> {
  const groups = new Map<string, {
    entityId: number;
    pageId?: number;
    sourceKeys: string[];
  }>();
  for (const source of sources) {
    const scopeKey = `${source.targetEntityId}:${source.targetPageId ?? ""}`;
    const group = groups.get(scopeKey);
    if (group) group.sourceKeys.push(source.key);
    else groups.set(scopeKey, {
      entityId: source.targetEntityId,
      pageId: source.targetPageId,
      sourceKeys: [source.key],
    });
  }

  const bySource = new Map<string, ReadonlySet<number>>();
  await Promise.all([...groups.values()].map(async (group) => {
    const ids = targetRows.filter((row) => row.entityId === group.entityId).map((row) => row.id);
    const candidateIds = new Set(ids);
    const allowed = await filterRows({
      entityId: group.entityId,
      pageId: group.pageId,
      recordIds: ids,
    });
    if (!allowed?.has || [...allowed].some((id) => !candidateIds.has(id))) {
      throw new LinkedFormulaResolutionError("FORBIDDEN", "Invalid target row permission result");
    }
    for (const sourceKey of group.sourceKeys) bySource.set(sourceKey, allowed);
  }));
  return bySource;
}

/**
 * Resolve all sources without an N+1 query per base row. Metadata, records,
 * page-value rows and relation links are loaded in set-based batches; joins and
 * permission-aware aggregation then happen in memory.
 */
export async function resolveLinkedFormulaData(
  options: ResolveLinkedFormulaOptions,
): Promise<LinkedFormulaResolution> {
  assertPositiveId(options.baseEntityId, "baseEntityId");
  if (!options.permissions?.authorizeResources || !options.permissions?.filterRows) {
    throw new LinkedFormulaResolutionError("FORBIDDEN", "A complete permission context is required");
  }
  const baseIds = [...new Set(options.baseRecordIds)];
  for (const id of baseIds) assertPositiveId(id, "baseRecordId");
  const sourceKeys = new Set<string>();
  for (const source of options.sources) {
    if (!source.key || sourceKeys.has(source.key)) invalid(`Duplicate or empty source key: ${source.key}`);
    sourceKeys.add(source.key);
    if (source.kind === "pageLocal") {
      assertPositiveId(source.pageId, `Source ${source.key} pageId`);
    } else {
      assertPositiveId(source.targetEntityId, `Source ${source.key} targetEntityId`);
      if (source.limit != null && (!Number.isInteger(source.limit) || source.limit < 0)) {
        invalid(`Source ${source.key} limit must be a non-negative integer`);
      }
      if (source.join.kind === "equality" && source.join.on.length === 0) {
        invalid(`Source ${source.key} requires at least one equality join`);
      }
      if (source.join.kind === "relation") {
        assertPositiveId(source.join.relationId, `Source ${source.key} relationId`);
      }
    }
  }

  const aggregates = options.sources.filter((s): s is Extract<LinkedFormulaSource, { kind: "aggregate" }> => s.kind === "aggregate");
  const entityIds = [...new Set([options.baseEntityId, ...aggregates.map((s) => s.targetEntityId)])];
  const pageIds = new Set<number>();
  const pageOwners = new Map<number, number>();
  if (options.basePageId != null) pageIds.add(options.basePageId);
  if (options.basePageId != null) pageOwners.set(options.basePageId, options.baseEntityId);
  const fieldOwners: Array<{ entityId: number; ref: LinkedFormulaFieldRef }> = [];
  for (const source of options.sources) {
    if (source.kind === "pageLocal") {
      pageIds.add(source.pageId);
      pageOwners.set(source.pageId, options.baseEntityId);
      fieldOwners.push({ entityId: options.baseEntityId, ref: { scope: "page", pageId: source.pageId, fieldKey: source.fieldKey } });
      continue;
    }
    if (source.value) {
      fieldOwners.push({ entityId: source.targetEntityId, ref: source.value });
      if (source.value.scope === "page") pageIds.add(source.value.pageId);
      if (source.value.scope === "page") pageOwners.set(source.value.pageId, source.targetEntityId);
    }
    if (source.targetPageId != null) {
      pageIds.add(source.targetPageId);
      pageOwners.set(source.targetPageId, source.targetEntityId);
    }
    if (source.join.kind === "equality") {
      for (const pair of source.join.on) {
        fieldOwners.push({ entityId: options.baseEntityId, ref: pair.base });
        fieldOwners.push({ entityId: source.targetEntityId, ref: pair.target });
        if (pair.base.scope === "page") {
          pageIds.add(pair.base.pageId);
          pageOwners.set(pair.base.pageId, options.baseEntityId);
        }
        if (pair.target.scope === "page") {
          pageIds.add(pair.target.pageId);
          pageOwners.set(pair.target.pageId, source.targetEntityId);
        }
      }
    }
  }

  const [entities, pages, entityFields, pageFields] = await Promise.all([
    db.select({ id: entitiesTable.id, pageId: entitiesTable.pageId }).from(entitiesTable).where(inArray(entitiesTable.id, entityIds)),
    pageIds.size
      ? db.select({ id: pagesTable.id, mirrorEntityId: pagesTable.mirrorEntityId }).from(pagesTable).where(inArray(pagesTable.id, [...pageIds]))
      : Promise.resolve([]),
    db.select({
      entityId: entityFieldsTable.entityId,
      fieldKey: entityFieldsTable.fieldKey,
      fieldType: entityFieldsTable.fieldType,
      relationConfigJson: entityFieldsTable.relationConfigJson,
    })
      .from(entityFieldsTable)
      .where(and(inArray(entityFieldsTable.entityId, entityIds), eq(entityFieldsTable.isActive, true))),
    pageIds.size
      ? db.select({
          pageId: pageFieldsTable.pageId,
          fieldKey: pageFieldsTable.fieldKey,
          fieldType: pageFieldsTable.fieldType,
          relationConfigJson: pageFieldsTable.relationConfigJson,
        })
          .from(pageFieldsTable)
          .where(and(inArray(pageFieldsTable.pageId, [...pageIds]), eq(pageFieldsTable.isActive, true)))
      : Promise.resolve([]),
  ]);
  const entityById = new Map(entities.map((row) => [row.id, row]));
  if (entityIds.some((id) => !entityById.has(id))) {
    throw new LinkedFormulaResolutionError("NOT_FOUND", "A referenced entity does not exist");
  }
  const pageById = new Map(pages.map((row) => [row.id, row]));
  for (const [pageId, entityId] of pageOwners) {
    const page = pageById.get(pageId);
    if (!page || (page.mirrorEntityId !== entityId && entityById.get(entityId)?.pageId !== pageId)) {
      throw new LinkedFormulaResolutionError("NOT_FOUND", `Page ${pageId} does not belong to entity ${entityId}`);
    }
  }
  const entityFieldSet = new Set(entityFields.map((row) => `${row.entityId}:${row.fieldKey}`));
  const pageFieldSet = new Set(pageFields.map((row) => `${row.pageId}:${row.fieldKey}`));
  const fieldMetadata = new Map<string, FormulaFieldMetadata>([
    ...entityFields.map((row) => [
      fieldMetadataKey(row.entityId, { scope: "entity", fieldKey: row.fieldKey }),
      { fieldType: row.fieldType, relationConfigJson: row.relationConfigJson },
    ] as const),
    ...pageFields.flatMap((row) => {
      const owner = pageOwners.get(row.pageId);
      return owner == null ? [] : [[
        fieldMetadataKey(owner, { scope: "page", pageId: row.pageId, fieldKey: row.fieldKey }),
        { fieldType: row.fieldType, relationConfigJson: row.relationConfigJson },
      ] as const];
    }),
  ]);
  for (const { entityId, ref } of fieldOwners) {
    if (!ref.fieldKey) invalid("Field keys cannot be empty");
    if (ref.scope === "entity") {
      if (!entityFieldSet.has(`${entityId}:${ref.fieldKey}`)) {
        throw new LinkedFormulaResolutionError("NOT_FOUND", `Unknown active entity field ${entityId}.${ref.fieldKey}`);
      }
    } else {
      const page = pageById.get(ref.pageId);
      const ownsPage = page?.mirrorEntityId === entityId || entityById.get(entityId)?.pageId === ref.pageId;
      if (!page || !ownsPage || !pageFieldSet.has(`${ref.pageId}:${ref.fieldKey}`)) {
        throw new LinkedFormulaResolutionError("NOT_FOUND", `Unknown qualified page field ${ref.pageId}.${ref.fieldKey}`);
      }
    }
  }
  for (const source of aggregates) {
    if (source.value?.scope === "page" && source.targetPageId !== source.value.pageId) {
      invalid(`Source ${source.key} targetPageId must qualify its page value field`);
    }
    if (source.join.kind === "equality") {
      for (const pair of source.join.on) {
        if (pair.target.scope === "page" && source.targetPageId !== pair.target.pageId) {
          invalid(`Source ${source.key} targetPageId must qualify every target page join field`);
        }
      }
    }
  }

  const directRelationIds = aggregates.flatMap((source) =>
    source.join.kind === "relation" ? [source.join.relationId] : []);
  const equalityRelationIds = [...new Set(aggregates.flatMap((source) =>
    source.join.kind === "equality"
      ? source.join.on.flatMap((pair) => [pair.base, pair.target])
          .map((ref, index) => {
            const ownerEntityId = index % 2 === 0 ? options.baseEntityId : source.targetEntityId;
            const metadata = fieldMetadata.get(fieldMetadataKey(ownerEntityId, ref));
            if (metadata?.fieldType !== "relation") return null;
            const relationId = Number((metadata.relationConfigJson as { relationId?: unknown } | null)?.relationId);
            return Number.isInteger(relationId) && relationId > 0 ? relationId : null;
          })
          .filter((id): id is number => id != null)
      : []))];
  const relationIds = [...new Set([...directRelationIds, ...equalityRelationIds])];
  const relations = relationIds.length
    ? await db.select().from(relationsTable).where(inArray(relationsTable.id, relationIds))
    : [];
  const relationById = new Map(relations.map((relation) => [relation.id, relation]));
  if (relations.length !== relationIds.length) {
    throw new LinkedFormulaResolutionError("NOT_FOUND", "A referenced relation does not exist");
  }
  const relationLinkedEntity = (ownerEntityId: number, ref: LinkedFormulaFieldRef): number | null => {
    const metadata = fieldMetadata.get(fieldMetadataKey(ownerEntityId, ref));
    if (metadata?.fieldType !== "relation") return null;
    const relationId = Number((metadata.relationConfigJson as { relationId?: unknown } | null)?.relationId);
    const relation = relationById.get(relationId);
    if (!relation) return null;
    if (relation.sourceEntityId === ownerEntityId) return relation.targetEntityId;
    if (relation.targetEntityId === ownerEntityId) return relation.sourceEntityId;
    return null;
  };
  for (const source of aggregates) {
    if (source.join.kind !== "equality") continue;
    for (const pair of source.join.on) {
      const baseMeta = fieldMetadata.get(fieldMetadataKey(options.baseEntityId, pair.base));
      const targetMeta = fieldMetadata.get(fieldMetadataKey(source.targetEntityId, pair.target));
      const hasRelation = baseMeta?.fieldType === "relation" || targetMeta?.fieldType === "relation";
      if (!hasRelation) continue;
      const baseLinkedEntity = relationLinkedEntity(options.baseEntityId, pair.base);
      const targetLinkedEntity = relationLinkedEntity(source.targetEntityId, pair.target);
      if (baseLinkedEntity == null || targetLinkedEntity == null || baseLinkedEntity !== targetLinkedEntity) {
        invalid(`Source ${source.key} equality relation references must both link to the same entity`);
      }
    }
  }
  const intermediateEntityIds = [...new Set(aggregates.flatMap((source) =>
    source.join.kind === "equality"
      ? source.join.on.map((pair) => relationLinkedEntity(options.baseEntityId, pair.base)).filter((id): id is number => id != null)
      : []))];

  const resources = new Map<string, LinkedFormulaResource>();
  const addResource = (resource: LinkedFormulaResource) => resources.set(linkedFormulaResourceKey(resource), resource);
  for (const entityId of entityIds) addResource({ kind: "entity", entityId });
  for (const entityId of intermediateEntityIds) addResource({ kind: "entity", entityId });
  for (const [pageId, entityId] of pageOwners) addResource({ kind: "page", pageId, entityId });
  for (const item of fieldOwners) addResource({ kind: "field", entityId: item.entityId, ...item.ref });
  const resourceList = [...resources.values()];
  const allowedResources = await options.permissions.authorizeResources(resourceList);
  if (!allowedResources?.has || resourceList.some((resource) => !allowedResources.has(linkedFormulaResourceKey(resource)))) {
    throw new LinkedFormulaResolutionError("FORBIDDEN", "Linked formula resource access denied");
  }

  const maxTargets = options.maxTargetRecords ?? 50_000;
  if (!Number.isInteger(maxTargets) || maxTargets < 1) invalid("maxTargetRecords must be a positive integer");
  const [baseRows, targetRows]: [RecordRow[], RecordRow[]] = await Promise.all([
    baseIds.length
      ? db.select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, values: entityRecordsTable.valuesJson })
          .from(entityRecordsTable)
          .where(and(eq(entityRecordsTable.entityId, options.baseEntityId), inArray(entityRecordsTable.id, baseIds), isNull(entityRecordsTable.archivedAt)))
      : Promise.resolve([] as RecordRow[]),
    aggregates.length
      ? db.select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, values: entityRecordsTable.valuesJson })
          .from(entityRecordsTable)
          .where(and(inArray(entityRecordsTable.entityId, [...new Set(aggregates.map((s) => s.targetEntityId))]), isNull(entityRecordsTable.archivedAt)))
          .limit(maxTargets + 1)
      : Promise.resolve([] as RecordRow[]),
  ]);
  if (baseRows.length !== baseIds.length) {
    throw new LinkedFormulaResolutionError("NOT_FOUND", "One or more base records do not exist or are archived");
  }
  if (targetRows.length > maxTargets) {
    throw new LinkedFormulaResolutionError("LIMIT_EXCEEDED", `Linked formula target scan exceeds ${maxTargets} records`);
  }
  const allowedBase = await options.permissions.filterRows({
    entityId: options.baseEntityId,
    pageId: options.basePageId,
    recordIds: baseIds,
  });
  if (!allowedBase?.has || baseIds.some((id) => !allowedBase.has(id))) {
    throw new LinkedFormulaResolutionError("FORBIDDEN", "Linked formula base row access denied");
  }

  const allowedTargetsBySource = await filterLinkedFormulaTargetsByScope(
    aggregates,
    targetRows,
    (scope) => options.permissions.filterRows(scope),
  );
  const allAllowedTargets = new Set<number>();
  for (const allowed of allowedTargetsBySource.values()) {
    for (const id of allowed) allAllowedTargets.add(id);
  }

  const allRows = [...baseRows, ...targetRows.filter((row) => allAllowedTargets.has(row.id))];
  const allRecordIds = [...new Set(allRows.map((row) => row.id))];
  const pageValueRows = pageIds.size && allRecordIds.length
    ? await db.select({ pageId: pageRecordValuesTable.pageId, recordId: pageRecordValuesTable.recordId, values: pageRecordValuesTable.valuesJson })
        .from(pageRecordValuesTable)
        .where(and(inArray(pageRecordValuesTable.pageId, [...pageIds]), inArray(pageRecordValuesTable.recordId, allRecordIds)))
    : [];
  const loaded = new Map<number, LoadedRecord>();
  for (const row of allRows) loaded.set(row.id, { id: row.id, entityId: row.entityId, values: row.values as Record<string, unknown>, pages: new Map() });
  for (const row of pageValueRows) loaded.get(row.recordId)?.pages.set(row.pageId, row.values as Record<string, unknown>);

  const links = relationIds.length && allRecordIds.length
    ? await db.select().from(recordLinksTable).where(and(
        inArray(recordLinksTable.relationId, relationIds),
        or(inArray(recordLinksTable.sourceRecordId, allRecordIds), inArray(recordLinksTable.targetRecordId, allRecordIds)),
      ))
    : [];

  const intermediateIdsByEntity = new Map<number, Set<number>>();
  for (const relationId of equalityRelationIds) {
    const relation = relationById.get(relationId)!;
    for (const link of links) {
      if (link.relationId !== relationId) continue;
      const sourceLoaded = loaded.get(link.sourceRecordId)?.entityId === relation.sourceEntityId;
      const targetLoaded = loaded.get(link.targetRecordId)?.entityId === relation.targetEntityId;
      if (sourceLoaded && !loaded.has(link.targetRecordId)) {
        const ids = intermediateIdsByEntity.get(relation.targetEntityId) ?? new Set<number>();
        ids.add(link.targetRecordId);
        intermediateIdsByEntity.set(relation.targetEntityId, ids);
      }
      if (targetLoaded && !loaded.has(link.sourceRecordId)) {
        const ids = intermediateIdsByEntity.get(relation.sourceEntityId) ?? new Set<number>();
        ids.add(link.sourceRecordId);
        intermediateIdsByEntity.set(relation.sourceEntityId, ids);
      }
    }
  }
  const allowedIntermediateByEntity = new Map<number, ReadonlySet<number>>();
  await Promise.all([...intermediateIdsByEntity].map(async ([entityId, ids]) => {
    const allowed = await options.permissions.filterRows({ entityId, recordIds: [...ids] });
    if (!allowed?.has || [...allowed].some((id) => !ids.has(id))) {
      throw new LinkedFormulaResolutionError("FORBIDDEN", "Invalid intermediate row permission result");
    }
    allowedIntermediateByEntity.set(entityId, allowed);
  }));

  const relationValues = new Map<string, number[]>();
  for (const relationId of equalityRelationIds) {
    const relation = relationById.get(relationId)!;
    for (const link of links) {
      if (link.relationId !== relationId) continue;
      const addLinked = (recordId: number, ownerEntityId: number, linkedId: number, linkedEntityId: number) => {
        if (loaded.get(recordId)?.entityId !== ownerEntityId) return;
        if (!allowedIntermediateByEntity.get(linkedEntityId)?.has(linkedId)) return;
        const key = `${relationId}:${recordId}`;
        const ids = relationValues.get(key) ?? [];
        if (!ids.includes(linkedId)) ids.push(linkedId);
        relationValues.set(key, ids);
      };
      addLinked(link.sourceRecordId, relation.sourceEntityId, link.targetRecordId, relation.targetEntityId);
      addLinked(link.targetRecordId, relation.targetEntityId, link.sourceRecordId, relation.sourceEntityId);
    }
  }
  for (const ids of relationValues.values()) ids.sort((a, b) => a - b);

  const equalityCandidates = (
    ownerEntityId: number,
    ref: LinkedFormulaFieldRef,
    record: LoadedRecord,
  ): readonly unknown[] => {
    const metadata = fieldMetadata.get(fieldMetadataKey(ownerEntityId, ref));
    if (metadata?.fieldType !== "relation") return [valueFrom(ref, record.values, record.pages)];
    const relationId = Number((metadata.relationConfigJson as { relationId?: unknown } | null)?.relationId);
    return (relationValues.get(`${relationId}:${record.id}`) ?? []).map((id) => `relation:${id}`);
  };

  const valuesByRecordId = new Map<number, Record<string, unknown>>(
    baseIds.map((id) => [id, {}]),
  );
  for (const source of options.sources) {
    if (source.kind === "pageLocal") {
      for (const id of baseIds) {
        valuesByRecordId.get(id)![source.key] = loaded.get(id)?.pages.get(source.pageId)?.[source.fieldKey] ?? null;
      }
      continue;
    }
    const allowedTargets = allowedTargetsBySource.get(source.key)!;
    const targets = [...loaded.values()]
      .filter((record) => record.entityId === source.targetEntityId && allowedTargets.has(record.id))
      .sort((a, b) => a.id - b.id);
    const matches = new Map<number, LoadedRecord[]>();
    if (source.join.kind === "relation") {
      const relation = relationById.get(source.join.relationId);
      if (!relation) throw new LinkedFormulaResolutionError("NOT_FOUND", `Unknown relation ${source.join.relationId}`);
      const validEndpoints = source.join.baseSide === "source"
        ? relation.sourceEntityId === options.baseEntityId && relation.targetEntityId === source.targetEntityId
        : relation.targetEntityId === options.baseEntityId && relation.sourceEntityId === source.targetEntityId;
      if (!validEndpoints) invalid(`Relation ${relation.id} endpoints do not match source ${source.key}`);
      for (const link of links) {
        if (link.relationId !== relation.id) continue;
        const baseId = source.join.baseSide === "source" ? link.sourceRecordId : link.targetRecordId;
        const targetId = source.join.baseSide === "source" ? link.targetRecordId : link.sourceRecordId;
        const target = loaded.get(targetId);
        if (!target || !allowedTargets.has(targetId) || !valuesByRecordId.has(baseId)) continue;
        const list = matches.get(baseId) ?? [];
        list.push(target);
        matches.set(baseId, list);
      }
      for (const list of matches.values()) list.sort((a, b) => a.id - b.id);
    } else {
      const index = new Map<string, LoadedRecord[]>();
      for (const target of targets) {
        const keys = linkedFormulaEqualityKeys(source.join.on.map((pair) =>
          equalityCandidates(source.targetEntityId, pair.target, target)));
        for (const key of keys) {
          const list = index.get(key) ?? [];
          list.push(target);
          index.set(key, list);
        }
      }
      for (const baseId of baseIds) {
        const base = loaded.get(baseId)!;
        const found = new Map<number, LoadedRecord>();
        const keys = linkedFormulaEqualityKeys(source.join.on.map((pair) =>
          equalityCandidates(options.baseEntityId, pair.base, base)));
        for (const key of keys) for (const target of index.get(key) ?? []) found.set(target.id, target);
        matches.set(baseId, [...found.values()].sort((a, b) => a.id - b.id));
      }
    }
    for (const baseId of baseIds) {
      const matched = (matches.get(baseId) ?? []).slice(0, source.limit);
      const values = matched.map((record) => source.value ? valueFrom(source.value, record.values, record.pages) : undefined);
      valuesByRecordId.get(baseId)![source.key] = aggregateLinkedValues(source.aggregate, values, source.separator);
    }
  }
  return { valuesByRecordId, targetRecordsRead: targetRows.length };
}