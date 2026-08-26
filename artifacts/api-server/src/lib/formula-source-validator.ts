import {
  db,
  entitiesTable,
  entityFieldsTable,
  pageFieldsTable,
  pagesTable,
  relationsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { FORMULA_CONFIG_LIMITS, normalizeFormulaFieldSources } from "./formula-field-config";

type Base = { kind: "entity"; entityId: number } | { kind: "page"; pageId: number; entityId: number };
type Ref = { scope: "entity"; fieldKey: string } | { scope: "page"; pageId: number; fieldKey: string };
type Field = { fieldType: string };

const UNSUPPORTED = new Set(["file", "relation", "lookup", "page_ref", "function"]);
const NUMERIC = new Set(["number", "percent"]);

function unsupported(field: Field | null): boolean {
  return !field || UNSUPPORTED.has(field.fieldType);
}

/**
 * DB-backed write-boundary validation for formula sources.  The runtime also
 * defends itself, but it must never be the first place a malformed schema is
 * discovered: these messages are returned directly as HTTP 400 responses.
 */
export async function validateFormulaSources(base: Base, config: unknown): Promise<string[]> {
  const rawSources = config && typeof config === "object" ? (config as { sources?: unknown }).sources : undefined;
  if (!Array.isArray(rawSources)) return [];
  const raw = rawSources;
  const sources = normalizeFormulaFieldSources(raw);
  // Structural validation reports this case first. Do not use normalized values
  // here: accepting a trimmed/dropped source would silently change the schema.
  if (sources.length !== raw.length || raw.length > FORMULA_CONFIG_LIMITS.sourceCount) return [];

  const errors: string[] = [];
  const sourceKeys = new Set(sources.map((source) => source.key));
  // Collect the entire graph first. The checks below intentionally retain the
  // old per-source error ordering, but all metadata is fetched in bounded
  // set-based queries so editing a formula cannot fan out by source/reference.
  const entityIds = new Set<number>([base.entityId]);
  const pageIds = new Set<number>();
  const relationIds = new Set<number>();
  if (base.kind === "page") pageIds.add(base.pageId);
  for (const source of sources) {
    if (source.kind === "pageLocal") {
      pageIds.add(source.pageId);
      continue;
    }
    entityIds.add(source.targetEntityId);
    if (source.targetPageId != null) pageIds.add(source.targetPageId);
    if (source.value?.scope === "page") pageIds.add(source.value.pageId);
    if (source.join.kind === "relation") relationIds.add(source.join.relationId);
    else for (const pair of source.join.on) {
      if (pair.base.scope === "page") pageIds.add(pair.base.pageId);
      if (pair.target.scope === "page") pageIds.add(pair.target.pageId);
    }
  }
  const [entities, pages, allEntityFields, allPageFields, relations] = await Promise.all([
    db.select({ id: entitiesTable.id, pageId: entitiesTable.pageId }).from(entitiesTable)
      .where(inArray(entitiesTable.id, [...entityIds])),
    pageIds.size ? db.select({ id: pagesTable.id, mirrorEntityId: pagesTable.mirrorEntityId }).from(pagesTable)
      .where(inArray(pagesTable.id, [...pageIds])) : Promise.resolve([] as Array<{ id: number; mirrorEntityId: number | null }>),
    db.select({ entityId: entityFieldsTable.entityId, fieldKey: entityFieldsTable.fieldKey, fieldType: entityFieldsTable.fieldType })
      .from(entityFieldsTable).where(and(inArray(entityFieldsTable.entityId, [...entityIds]), eq(entityFieldsTable.isActive, true))),
    pageIds.size ? db.select({ pageId: pageFieldsTable.pageId, fieldKey: pageFieldsTable.fieldKey, fieldType: pageFieldsTable.fieldType })
      .from(pageFieldsTable).where(and(inArray(pageFieldsTable.pageId, [...pageIds]), eq(pageFieldsTable.isActive, true))) : Promise.resolve([] as Array<{ pageId: number; fieldKey: string; fieldType: string }>),
    relationIds.size ? db.select().from(relationsTable).where(inArray(relationsTable.id, [...relationIds])) : Promise.resolve([]),
  ]);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const entityFieldByKey = new Map(allEntityFields.map((field) => [`${field.entityId}:${field.fieldKey}`, field]));
  const pageFieldByKey = new Map(allPageFields.map((field) => [`${field.pageId}:${field.fieldKey}`, field]));
  const relationById = new Map(relations.map((relation) => [relation.id, relation]));
  const pageBelongsTo = (pageId: number, entityId: number) => {
    const page = pageById.get(pageId);
    return Boolean(page && (page.mirrorEntityId === entityId || entityById.get(entityId)?.pageId === pageId));
  };
  const activeField = (entityId: number, ref: Ref): Field | null => {
    if (ref.scope === "entity") return entityFieldByKey.get(`${entityId}:${ref.fieldKey}`) ?? null;
    if (!pageBelongsTo(ref.pageId, entityId)) return null;
    return pageFieldByKey.get(`${ref.pageId}:${ref.fieldKey}`) ?? null;
  };
  const entityKeys = allEntityFields.filter((field) => field.entityId === base.entityId);
  const basePageId = "pageId" in base ? base.pageId : null;
  const pageKeys = basePageId != null
    ? allPageFields.filter((field) => field.pageId === basePageId)
    : [];
  const reserved = new Set([
    ...entityKeys.map((field) => field.fieldKey),
    ...entityKeys.map((field) => `entity:${base.entityId}.${field.fieldKey}`),
    ...pageKeys.map((field) => field.fieldKey),
    ...(basePageId != null ? pageKeys.map((field) => `page:${basePageId}.${field.fieldKey}`) : []),
  ]);
  for (const key of sourceKeys) {
    if (reserved.has(key)) errors.push(`Source token "${key}" collides with an entity, page, or formula field token`);
  }

  for (const source of sources) {
    if (source.kind === "pageLocal") {
      if (!pageBelongsTo(source.pageId, base.entityId)) {
        errors.push(`Source "${source.key}" page ${source.pageId} does not belong to the base entity`);
      } else if (unsupported(activeField(base.entityId, { scope: "page", pageId: source.pageId, fieldKey: source.fieldKey }))) {
        errors.push(`Source "${source.key}" must reference an active, value-backed page field on the same record`);
      }
      continue;
    }

    const target = entityById.get(source.targetEntityId);
    if (!target) {
      errors.push(`Source "${source.key}" target entity does not exist`);
      continue;
    }
    if (source.targetPageId != null && !pageBelongsTo(source.targetPageId, source.targetEntityId)) {
      errors.push(`Source "${source.key}" target page does not belong to its target entity`);
    }
    if (source.value) {
      const valueField = activeField(source.targetEntityId, source.value);
      if (unsupported(valueField)) errors.push(`Source "${source.key}" value must reference an active supported target field`);
      else if (valueField && (source.aggregate === "sum" || source.aggregate === "average") && !NUMERIC.has(valueField.fieldType)) {
        errors.push(`Source "${source.key}" ${source.aggregate} requires a numeric target field`);
      }
      if (source.value.scope === "page" && source.targetPageId !== source.value.pageId) {
        errors.push(`Source "${source.key}" targetPageId must qualify its page value field`);
      }
    }
    if (source.join.kind === "relation") {
      const relation = relationById.get(source.join.relationId);
      const endpoints = relation && (source.join.baseSide === "source"
        ? relation.sourceEntityId === base.entityId && relation.targetEntityId === source.targetEntityId
        : relation.targetEntityId === base.entityId && relation.sourceEntityId === source.targetEntityId);
      if (!endpoints) errors.push(`Source "${source.key}" relation does not connect the base and target entities on baseSide`);
    } else {
      for (const pair of source.join.on) {
        const baseField = activeField(base.entityId, pair.base);
        const targetField = activeField(source.targetEntityId, pair.target);
        if (unsupported(baseField)) errors.push(`Source "${source.key}" equality base reference must be an active supported base field`);
        if (unsupported(targetField)) errors.push(`Source "${source.key}" equality target reference must be an active supported target field`);
        if (pair.target.scope === "page" && source.targetPageId !== pair.target.pageId) {
          errors.push(`Source "${source.key}" targetPageId must qualify every target page equality reference`);
        }
      }
    }
  }
  return [...new Set(errors)];
}