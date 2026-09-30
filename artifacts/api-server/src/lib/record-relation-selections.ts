import type { Request } from "express";
import { entityFieldsTable, entityRecordsTable, relationsTable, recordLinksTable, pageFieldsTable, pagesTable, entitiesTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { canRecord, effectiveScope, effectiveStatusVisibility, getPermissions, getUserRoleIds, resolveFieldAccess, mostPermissiveFieldPerm } from "../middlewares/permissions";
import { isRecordOwned } from "../routes/own-scope";
import { assertSelectionDependencies, RelationSelectionError, type SelectionTx } from "./relation-selection-integrity";
import { normalizeSelection, selectionDirection } from "./relation-selection-policy";
import { touchLockedRecords } from "./record-links";

export async function validateVisibleSelection(tx: SelectionTx, req: Request, entityId: number, ids: number[]) {
  const perms = await getPermissions(req);
  if (!canRecord(perms, entityId, "view")) throw new RelationSelectionError("Forbidden", 403);
  const rows = ids.length ? await tx.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.entityId, entityId), inArray(entityRecordsTable.id, ids))).orderBy(asc(entityRecordsTable.id)).for("update") : [];
  if (rows.length !== ids.length) throw new RelationSelectionError("Linked record not available");
  const hidden = effectiveStatusVisibility(perms, entityId).hiddenRowStatusIds;
  const scope = effectiveScope(perms, entityId);
  const fields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  for (const row of rows) {
    if (row.statusId != null && hidden.includes(row.statusId)) throw new RelationSelectionError("Linked record not available", 403);
    if (scope.scope === "own" && !await isRecordOwned(entityId, row, scope.scopeFieldKeys, req.user!.userId, fields, tx)) throw new RelationSelectionError("Linked record not available", 403);
  }
  return rows;
}

/** Atomic creation: parent selections precede children, then record.created sees all links. */
export async function createRecordRelationSelections(
  tx: SelectionTx, req: Request, entityId: number, recordId: number,
  selections: { fieldKey: string; linkedRecordIds: number[] }[],
) {
  if (!selections.length) return [];
  if (new Set(selections.map(s => s.fieldKey)).size !== selections.length) throw new RelationSelectionError("Duplicate relation field");
  const fields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true)));
  const perms = await getPermissions(req);
  const roles = await getUserRoleIds(req);
  const pending = [...selections];
  const seen = new Set<string>();
  const usedRelations = new Set<number>();
  const linkedEntities = new Map<number, number>();
  const relationIds = fields.filter(f => pending.some(s => s.fieldKey === f.fieldKey)).flatMap(f => f.relationConfigJson?.relationId ? [f.relationConfigJson.relationId] : []);
  const relations = relationIds.length ? await tx.select().from(relationsTable).where(inArray(relationsTable.id, relationIds)).orderBy(asc(relationsTable.id)).for("update") : [];
  while (pending.length) {
    const index = pending.findIndex(s => {
      const parent = fields.find(f => f.fieldKey === s.fieldKey)?.dependencyConfigJson?.dependsOnFieldKey;
      return !parent || seen.has(parent) || !pending.some(p => p.fieldKey === parent);
    });
    if (index < 0) throw new RelationSelectionError("Cyclic relation dependency");
    const [selection] = pending.splice(index, 1);
    const field = fields.find(f => f.fieldKey === selection.fieldKey);
    if (!field || field.fieldType !== "relation" || resolveFieldAccess(field, perms, roles, entityId) !== "edit") throw new RelationSelectionError("Relation field not editable", 403);
    const cfg = field.relationConfigJson;
    const relation = relations.find(r => r.id === cfg?.relationId);
    const direction = relation && selectionDirection(relation, entityId, cfg);
    if (!relation || !direction || usedRelations.has(relation.id)) throw new RelationSelectionError("Invalid or duplicate relation configuration");
    usedRelations.add(relation.id);
    let ids: number[];
    try { ids = normalizeSelection(selection, cfg?.selectionMode === "multiple"); }
    catch (error) { throw new RelationSelectionError((error as Error).message); }
    const targetEntity = direction === "source" ? relation.targetEntityId : relation.sourceEntityId;
    const targetFields = await tx.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, targetEntity), eq(entityFieldsTable.isActive, true)));
    const label = targetFields.find(f => f.fieldKey === cfg?.relatedFieldKey);
    if (cfg?.relatedPageId != null) {
      const [page] = await tx.select().from(pagesTable).where(eq(pagesTable.id, cfg.relatedPageId));
      const [bound] = await tx.select().from(entitiesTable).where(eq(entitiesTable.pageId, cfg.relatedPageId));
      const [pageField] = await tx.select().from(pageFieldsTable).where(and(eq(pageFieldsTable.pageId, cfg.relatedPageId), eq(pageFieldsTable.fieldKey, cfg.relatedFieldKey ?? ""), eq(pageFieldsTable.isActive, true)));
      if (!page || (page.mirrorEntityId ?? bound?.id) !== targetEntity || !pageField ||
        mostPermissiveFieldPerm(pageField.permissionsJson, roles, "view", perms, targetEntity, cfg.relatedPageId) === "hidden") throw new RelationSelectionError("Related page field not available", 403);
    } else if (!label || resolveFieldAccess(label, perms, roles, targetEntity) === "hidden") throw new RelationSelectionError("Related field not available", 403);
    await validateVisibleSelection(tx, req, targetEntity, ids);
    for (const id of ids) linkedEntities.set(id, targetEntity);
    await assertSelectionDependencies(tx, entityId, recordId, relation.id, ids);
    if (ids.length) await tx.insert(recordLinksTable).values(ids.map(id => ({
      relationId: relation.id, relationType: relation.relationType,
      sourceRecordId: direction === "source" ? recordId : id,
      targetRecordId: direction === "source" ? id : recordId,
    })));
    seen.add(selection.fieldKey);
  }
  // A self-link is initial state of the new record, not a second update.
  linkedEntities.delete(recordId);
  const versions = await touchLockedRecords(tx, [...linkedEntities.keys()]);
  return [...linkedEntities].map(([id, entityId]) => ({ id, entityId, version: versions[String(id)]! }));
}