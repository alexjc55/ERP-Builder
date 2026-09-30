import { db, entityFieldsTable, entityRecordsTable, recordLinksTable, relationsTable, type RelationFieldConfig, type DependencyFieldConfig } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { selectionDirection } from "./relation-selection-policy";

export type SelectionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class RelationSelectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function validateSelectionDependencyConfig(entityId: number, fieldKey: string, cfg: RelationFieldConfig, dep?: DependencyFieldConfig | null): Promise<string | null> {
  if (!dep?.dependsOnFieldKey && !dep?.relatedFilterFieldKey) return null;
  if (!dep.dependsOnFieldKey || !dep.relatedFilterFieldKey) return "Dependent relation requires both parent and target filter fields";
  const fields = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const parent = fields.find(f => f.fieldKey === dep.dependsOnFieldKey);
  if (!parent) return "Parent field not found";
  const seen = new Set([fieldKey]);
  let cursor: typeof parent | undefined = parent;
  while (cursor) {
    if (seen.has(cursor.fieldKey)) return "Cyclic relation dependency";
    seen.add(cursor.fieldKey);
    cursor = fields.find(f => f.fieldKey === cursor?.dependencyConfigJson?.dependsOnFieldKey);
  }
  if (parent.fieldType !== "relation") return cfg.selectionMode === "multiple" ? "Multiple dependent selection requires a relation parent" : null;
  if (parent.relationConfigJson?.selectionMode === "multiple") return "Dependency requires a single parent relation";
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, cfg.relationId ?? -1));
  const [parentRelation] = await db.select().from(relationsTable).where(eq(relationsTable.id, parent.relationConfigJson?.relationId ?? -1));
  if (!relation || !parentRelation) return "Dependency relation not configured";
  const direction = selectionDirection(relation, entityId, cfg);
  const pd = selectionDirection(parentRelation, entityId, parent.relationConfigJson);
  if (!direction || !pd) return "Invalid dependency relation cardinality";
  const relatedId = direction === "source" ? relation.targetEntityId : relation.sourceEntityId;
  const [filter] = await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, relatedId), eq(entityFieldsTable.fieldKey, dep.relatedFilterFieldKey), eq(entityFieldsTable.isActive, true)));
  if (filter?.fieldType !== "relation") return "Relation parent requires a relation filter field";
  const [filterRelation] = await db.select().from(relationsTable).where(eq(relationsTable.id, filter.relationConfigJson?.relationId ?? -1));
  const fd = filterRelation && selectionDirection(filterRelation, relatedId, filter.relationConfigJson);
  if (!filterRelation || !fd || (fd === "source" ? filterRelation.targetEntityId : filterRelation.sourceEntityId) !== (pd === "source" ? parentRelation.targetEntityId : parentRelation.sourceEntityId)) return "Parent and target filter relations must reference the same entity";
  return null;
}

/** Raw pair mutations cannot express a replacement snapshot or dependency CAS. */
export async function guardedRelationRequiresFieldSurface(tx: SelectionTx, relationId: number): Promise<boolean> {
  const fields = await tx.select().from(entityFieldsTable).where(eq(entityFieldsTable.isActive, true));
  const parents = new Set(fields.filter(f => f.dependencyConfigJson?.dependsOnFieldKey).map(f => `${f.entityId}:${f.dependencyConfigJson!.dependsOnFieldKey}`));
  const relations = await tx.select().from(relationsTable);
  const filters = new Set(fields.flatMap(f => {
    if (!f.dependencyConfigJson?.relatedFilterFieldKey) return [];
    const relation = relations.find(r => r.id === f.relationConfigJson?.relationId);
    const direction = relation && selectionDirection(relation, f.entityId, f.relationConfigJson);
    return relation && direction ? [`${direction === "source" ? relation.targetEntityId : relation.sourceEntityId}:${f.dependencyConfigJson.relatedFilterFieldKey}`] : [];
  }));
  return fields.some(f => f.fieldType === "relation" && f.relationConfigJson?.relationId === relationId &&
    (f.relationConfigJson.selectionMode === "multiple" || !!f.dependencyConfigJson?.dependsOnFieldKey || parents.has(`${f.entityId}:${f.fieldKey}`) || filters.has(`${f.entityId}:${f.fieldKey}`)));
}

/** Reparenting a selected member must not silently corrupt another record's snapshot. */
export async function assertSelectedMemberParentChange(tx: SelectionTx, entityId: number, recordId: number, relationId: number, selectedIds: number[]) {
  const fields = await tx.select().from(entityFieldsTable).where(eq(entityFieldsTable.isActive, true));
  const changedKeys = new Set(fields.filter(f => f.entityId === entityId && f.fieldType === "relation" && f.relationConfigJson?.relationId === relationId).map(f => f.fieldKey));
  if (!changedKeys.size) return;
  const relations = await tx.select().from(relationsTable);
  for (const field of fields.filter(f => changedKeys.has(f.dependencyConfigJson?.relatedFilterFieldKey ?? "") && f.fieldType === "relation")) {
    const relation = relations.find(r => r.id === field.relationConfigJson?.relationId);
    const direction = relation && selectionDirection(relation, field.entityId, field.relationConfigJson);
    if (!relation || !direction || (direction === "source" ? relation.targetEntityId : relation.sourceEntityId) !== entityId) continue;
    const parent = fields.find(f => f.entityId === field.entityId && f.fieldKey === field.dependencyConfigJson?.dependsOnFieldKey && f.fieldType === "relation");
    const pr = relations.find(r => r.id === parent?.relationConfigJson?.relationId);
    const pd = pr && selectionDirection(pr, field.entityId, parent?.relationConfigJson);
    if (!parent || !pr || !pd) continue;
    const members = await tx.select({ base: direction === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId }).from(recordLinksTable)
      .where(and(eq(recordLinksTable.relationId, relation.id), eq(direction === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId, recordId)));
    if (!members.length) continue;
    const parentLinks = await tx.select({ parent: pd === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId }).from(recordLinksTable)
      .where(and(eq(recordLinksTable.relationId, pr.id), inArray(pd === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId, members.map(m => m.base))));
    if (parentLinks.some(link => !selectedIds.includes(link.parent))) throw new RelationSelectionError("This record is selected by a dependent relation. Clear those selections before changing its parent");
  }
}

/** Runs on the caller's transaction; compare normalized IDs, never labels. */
export async function assertSelectionDependencies(tx: SelectionTx, entityId: number, recordId: number, relationId: number, selectedIds: number[]) {
  if (!selectedIds.length) return;
  const fields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  for (const field of fields.filter(f => f.fieldType === "relation" && f.relationConfigJson?.relationId === relationId)) {
    const dep = field.dependencyConfigJson;
    if (!dep?.dependsOnFieldKey || !dep.relatedFilterFieldKey) continue;
    const parent = fields.find(f => f.fieldKey === dep.dependsOnFieldKey);
    if (!parent) throw new RelationSelectionError("Parent field not found");
    if (parent.fieldType !== "relation") {
      if (field.relationConfigJson?.selectionMode === "multiple") throw new RelationSelectionError("Multiple dependent selection requires a relation parent");
      const [base] = await tx.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, recordId));
      const parentValue = (base?.valuesJson as Record<string, unknown> | undefined)?.[parent.fieldKey];
      if (parentValue == null || parentValue === "") throw new RelationSelectionError("Сначала заполните родительское поле");
      const [relation] = await tx.select().from(relationsTable).where(eq(relationsTable.id, relationId));
      const direction = relation && selectionDirection(relation, entityId, field.relationConfigJson);
      if (!relation || !direction) throw new RelationSelectionError("Invalid dependency relation");
      const targetEntity = direction === "source" ? relation.targetEntityId : relation.sourceEntityId;
      const [filter] = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, targetEntity), eq(entityFieldsTable.fieldKey, dep.relatedFilterFieldKey), eq(entityFieldsTable.isActive, true)));
      if (!filter) throw new RelationSelectionError("Dependency filter field not found");
      if (filter.fieldType === "relation") {
        const [filterRelation] = await tx.select().from(relationsTable).where(eq(relationsTable.id, filter.relationConfigJson?.relationId ?? -1));
        const fd = filterRelation && selectionDirection(filterRelation, targetEntity, filter.relationConfigJson);
        if (!filterRelation || !fd || !Number.isSafeInteger(Number(parentValue))) throw new RelationSelectionError("Invalid dependency filter");
        const matches = await tx.select({ id: fd === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId }).from(recordLinksTable)
          .where(and(eq(recordLinksTable.relationId, filterRelation.id), eq(fd === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId, Number(parentValue))));
        if (selectedIds.some(id => !matches.some(m => m.id === id))) throw new RelationSelectionError("Связанная запись не соответствует родителю");
      } else {
        const selected = await tx.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.entityId, targetEntity), inArray(entityRecordsTable.id, selectedIds)));
        if (selected.length !== selectedIds.length || selected.some(row => String((row.valuesJson as Record<string, unknown>)?.[filter.fieldKey] ?? "") !== String(parentValue))) throw new RelationSelectionError("Связанная запись не соответствует родителю");
      }
      continue;
    }
    const [parentRelation] = await tx.select().from(relationsTable).where(eq(relationsTable.id, parent.relationConfigJson?.relationId ?? -1));
    const [childRelation] = await tx.select().from(relationsTable).where(eq(relationsTable.id, relationId));
    if (!parentRelation || !childRelation) throw new RelationSelectionError("Dependency relation is not configured");
    const pd = selectionDirection(parentRelation, entityId, parent.relationConfigJson);
    const cd = selectionDirection(childRelation, entityId, field.relationConfigJson);
    if (!pd || !cd || parent.relationConfigJson?.selectionMode === "multiple") throw new RelationSelectionError("Dependency requires a single parent relation");
    const parentEntityId = pd === "source" ? parentRelation.targetEntityId : parentRelation.sourceEntityId;
    const childEntityId = cd === "source" ? childRelation.targetEntityId : childRelation.sourceEntityId;
    const [filter] = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, childEntityId), eq(entityFieldsTable.fieldKey, dep.relatedFilterFieldKey), eq(entityFieldsTable.isActive, true)));
    if (filter?.fieldType !== "relation") throw new RelationSelectionError("Relation parent requires a relation filter field");
    const [filterRelation] = await tx.select().from(relationsTable).where(eq(relationsTable.id, filter.relationConfigJson?.relationId ?? -1));
    const fd = filterRelation && selectionDirection(filterRelation, childEntityId, filter.relationConfigJson);
    if (!filterRelation || !fd || (fd === "source" ? filterRelation.targetEntityId : filterRelation.sourceEntityId) !== parentEntityId) throw new RelationSelectionError("Dependency relations must point to the same entity");
    const [parentLink] = await tx.select({ id: pd === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId }).from(recordLinksTable)
      .where(and(eq(recordLinksTable.relationId, parentRelation.id), eq(pd === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId, recordId)));
    if (!parentLink) throw new RelationSelectionError("Сначала заполните родительское поле");
    const matches = await tx.select({ id: fd === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId }).from(recordLinksTable)
      .where(and(eq(recordLinksTable.relationId, filterRelation.id), eq(fd === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId, parentLink.id),
        inArray(fd === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId, selectedIds)));
    const allowed = new Set(matches.map(r => r.id));
    if (selectedIds.some(id => !allowed.has(id))) throw new RelationSelectionError("Связанная запись не соответствует родителю");
  }
}

/** Parent switches invalidate the saved snapshot, including invisible members. */
async function dependentSelections(tx: SelectionTx, entityId: number, recordId: number, parentRelationId: number, clear: boolean, visited = new Set<number>()): Promise<number[]> {
  if (visited.has(parentRelationId)) return [];
  visited.add(parentRelationId);
  const fields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const parentKeys = new Set(fields.filter(f => f.fieldType === "relation" && f.relationConfigJson?.relationId === parentRelationId).map(f => f.fieldKey));
  const affected: number[] = [];
  for (const child of fields.filter(f => f.fieldType === "relation" && parentKeys.has(f.dependencyConfigJson?.dependsOnFieldKey ?? ""))) {
    const relationId = child.relationConfigJson?.relationId;
    if (!relationId || relationId === parentRelationId) continue;
    const [relation] = await tx.select().from(relationsTable).where(eq(relationsTable.id, relationId));
    const direction = relation && selectionDirection(relation, entityId, child.relationConfigJson);
    if (!direction) continue;
    const condition = and(eq(recordLinksTable.relationId, relationId), eq(direction === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId, recordId));
    const projection = { id: direction === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId };
    const removed = clear
      ? await tx.delete(recordLinksTable).where(condition).returning(projection)
      : await tx.select(projection).from(recordLinksTable).where(condition);
    affected.push(...removed.map(r => r.id));
    affected.push(...await dependentSelections(tx, entityId, recordId, relationId, clear, visited));
  }
  return affected;
}

export const clearDependentSelections = (tx: SelectionTx, entityId: number, recordId: number, relationId: number) =>
  dependentSelections(tx, entityId, recordId, relationId, true);
export const collectDependentSelectionIds = (tx: SelectionTx, entityId: number, recordId: number, relationId: number) =>
  dependentSelections(tx, entityId, recordId, relationId, false);