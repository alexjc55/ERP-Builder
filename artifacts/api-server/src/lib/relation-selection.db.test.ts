import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Request } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, entitiesTable, entityFieldsTable, entityRecordsTable, entityStatusesTable, relationsTable, recordLinksTable } from "@workspace/db";
import { replaceSingleRelationLink } from "./record-links";
import { RelationSelectionError, guardedRelationRequiresFieldSurface } from "./relation-selection-integrity";
import { createRecordRelationSelections, validateVisibleSelection } from "./record-relation-selections";
import { loadCandidateRows } from "../routes/page-fields";

test("dependent selection persists >50 members; invalid/unauthorized/stale writes roll back; parent switch clears snapshot", {
  skip: process.env.RUN_RELATION_SELECTION_DB_TESTS !== "1",
}, async () => {
  const key = `selection-test-${randomUUID()}`;
  const entityIds: number[] = [];
  try {
    const entities = await db.insert(entitiesTable).values(["parent", "member", "base"].map(s => ({ entityKey: `${key}-${s}` }))).returning();
    const [parent, member, base] = entities;
    entityIds.push(...entities.map(e => e.id));
    const relations = await db.insert(relationsTable).values([
      { relationKey: `${key}-base-parent`, sourceEntityId: base!.id, targetEntityId: parent!.id, relationType: "many_to_one" },
      { relationKey: `${key}-member-parent`, sourceEntityId: member!.id, targetEntityId: parent!.id, relationType: "many_to_one" },
      { relationKey: `${key}-selection`, sourceEntityId: base!.id, targetEntityId: member!.id, relationType: "many_to_many" },
    ]).returning();
    const [baseParent, memberParent, selection] = relations;
    await db.insert(entityFieldsTable).values([
      { entityId: parent!.id, fieldKey: "name" }, { entityId: member!.id, fieldKey: "name" },
      { entityId: base!.id, fieldKey: "parent", fieldType: "relation", relationConfigJson: { relationId: baseParent!.id, relatedFieldKey: "name" } },
      { entityId: member!.id, fieldKey: "parent", fieldType: "relation", relationConfigJson: { relationId: memberParent!.id, relatedFieldKey: "name" } },
      { entityId: base!.id, fieldKey: "members", fieldType: "relation", relationConfigJson: { relationId: selection!.id, relatedFieldKey: "name", selectionMode: "multiple" }, dependencyConfigJson: { dependsOnFieldKey: "parent", relatedFilterFieldKey: "parent" } },
    ]);
    // Deliberately identical labels: identity is exclusively the normalized ID.
    const parents = await db.insert(entityRecordsTable).values([1, 2].map(() => ({ entityId: parent!.id, valuesJson: { name: "same label" } }))).returning();
    const [record] = await db.insert(entityRecordsTable).values({ entityId: base!.id }).returning();
    const members = await db.insert(entityRecordsTable).values(Array.from({ length: 62 }, () => ({ entityId: member!.id }))).returning();
    assert.equal((await loadCandidateRows(member!.id, "name", null, [eq(entityRecordsTable.entityId, member!.id)], undefined)).length, 50);
    assert.equal((await loadCandidateRows(member!.id, "name", null, [eq(entityRecordsTable.entityId, member!.id)], undefined, true)).length, 62);
    await db.insert(recordLinksTable).values(members.map((m, i) => ({ relationId: memberParent!.id, relationType: memberParent!.relationType, sourceRecordId: m.id, targetRecordId: parents[i === 61 ? 1 : 0]!.id })));
    const parentWrite = await replaceSingleRelationLink({ entityId: base!.id, baseRecordId: record!.id, relationId: baseParent!.id, direction: "source", linkedRecordId: parents[0]!.id });
    assert.equal(parentWrite.ok, true);
    const ids = members.slice(0, 61).map(m => m.id);
    const options = { entityId: base!.id, baseRecordId: record!.id, relationId: selection!.id, direction: "source" as const, linkedRecordId: null, linkedRecordIds: ids };
    const saved = await replaceSingleRelationLink(options);
    assert.equal(saved.ok, true);
    const noop = await replaceSingleRelationLink({ ...options, expectedVersion: saved.version });
    assert.equal(noop.ok, true);
    if (noop.ok) { assert.equal(noop.changed, false); assert.equal(noop.version, saved.version); }
    const read = () => db.select().from(recordLinksTable).where(and(eq(recordLinksTable.relationId, selection!.id), eq(recordLinksTable.sourceRecordId, record!.id)));
    assert.equal((await read()).length, 61);
    const unrelated = await replaceSingleRelationLink({ ...options, linkedRecordIds: [members[61]!.id] });
    assert.equal(unrelated.ok, false);
    assert.equal((await read()).length, 61);
    const unauthorized = await replaceSingleRelationLink({ ...options, linkedRecordIds: [], validate: async () => { throw new RelationSelectionError("Forbidden", 403); } });
    assert.equal(unauthorized.ok, false);
    if (!unauthorized.ok) assert.equal(unauthorized.status, 403);
    assert.equal((await read()).length, 61);
    const stale = await replaceSingleRelationLink({ ...options, linkedRecordIds: [], expectedVersion: 0 });
    assert.equal(stale.ok, false);
    const memberReparent = await replaceSingleRelationLink({ entityId: member!.id, baseRecordId: members[0]!.id,
      relationId: memberParent!.id, direction: "source", linkedRecordId: parents[1]!.id });
    assert.equal(memberReparent.ok, false);
    const switchParent = await replaceSingleRelationLink({ entityId: base!.id, baseRecordId: record!.id, relationId: baseParent!.id, direction: "source", linkedRecordId: parents[1]!.id });
    assert.equal(switchParent.ok, true);
    if (switchParent.ok) assert.equal(switchParent.version, saved.version + 1);
    assert.equal((await read()).length, 0);
    await db.transaction(async tx => {
      assert.equal(await guardedRelationRequiresFieldSurface(tx, baseParent!.id), true);
      assert.equal(await guardedRelationRequiresFieldSurface(tx, selection!.id), true);
    });
    const req = { permissions: { superAdmin: true }, _roleIds: [], user: { userId: 0 } } as unknown as Request;
    const staged = await db.transaction(async tx => {
      const [created] = await tx.insert(entityRecordsTable).values({ entityId: base!.id }).returning();
      // Deliberately child first: server resolves topological dependency order.
      await createRecordRelationSelections(tx, req, base!.id, created!.id, [
        { fieldKey: "members", linkedRecordIds: ids },
        { fieldKey: "parent", linkedRecordIds: [parents[0]!.id] },
      ]);
      return created!;
    });
    assert.equal((await db.select().from(recordLinksTable).where(and(eq(recordLinksTable.sourceRecordId, staged.id), eq(recordLinksTable.relationId, selection!.id)))).length, 61);
    const beforeCount = (await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.entityId, base!.id))).length;
    await assert.rejects(db.transaction(async tx => {
      const [created] = await tx.insert(entityRecordsTable).values({ entityId: base!.id }).returning();
      await createRecordRelationSelections(tx, req, base!.id, created!.id, [
        { fieldKey: "parent", linkedRecordIds: [parents[0]!.id] },
        { fieldKey: "members", linkedRecordIds: [members[61]!.id] },
      ]);
    }), /не соответствует/);
    assert.equal((await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.entityId, base!.id))).length, beforeCount);
    const deniedReq = { permissions: { superAdmin: false, records: {} }, _roleIds: [], user: { userId: 0 } } as unknown as Request;
    await assert.rejects(db.transaction(tx => validateVisibleSelection(tx, deniedReq, member!.id, ids)), /Forbidden/);
    const [hiddenStatus] = await db.insert(entityStatusesTable).values({ entityId: member!.id, statusKey: `${key}-hidden` }).returning();
    await db.update(entityRecordsTable).set({ statusId: hiddenStatus!.id }).where(eq(entityRecordsTable.id, members[0]!.id));
    const hiddenReq = { permissions: { superAdmin: false, records: { [member!.id]: { view: true, hiddenRowStatusIds: [hiddenStatus!.id] } } }, _roleIds: [], user: { userId: 0 } } as unknown as Request;
    await assert.rejects(db.transaction(tx => validateVisibleSelection(tx, hiddenReq, member!.id, [members[0]!.id])), /not available/);
  } finally {
    if (entityIds.length) await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
    await pool.end();
  }
});