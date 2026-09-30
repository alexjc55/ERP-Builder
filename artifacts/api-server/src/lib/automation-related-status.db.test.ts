import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, entitiesTable, entityRecordsTable, entityStatusesTable,
  relationsTable, recordLinksTable, auditLogTable, systemEventsTable,
  entityAutomationsTable, entityAutomationRunsTable,
} from "@workspace/db";
import { systemSetRelatedStatus, initAutomations, stopAutomations } from "./automations-engine";
import { emitEvent, EVENT_RECORD_CREATED } from "./events";

test("related status updates only direct selection; no links noop; status and late-row validation roll back", {
  skip: process.env.RUN_RELATED_STATUS_DB_TESTS !== "1",
}, async () => {
  const key = `related-status-${randomUUID()}`;
  const entityIds: number[] = [];
  const log = { error() {} };
  try {
    const [source, target] = await db.insert(entitiesTable).values([{ entityKey: `${key}-source` }, { entityKey: `${key}-target` }]).returning();
    entityIds.push(source!.id, target!.id);
    const [status] = await db.insert(entityStatusesTable).values({ entityId: target!.id, statusKey: "done" }).returning();
    const [wrongStatus] = await db.insert(entityStatusesTable).values({ entityId: source!.id, statusKey: "wrong" }).returning();
    const [relation] = await db.insert(relationsTable).values({ sourceEntityId: source!.id, targetEntityId: target!.id, relationKey: "links", relationType: "many_to_many" }).returning();
    const [trigger, empty] = await db.insert(entityRecordsTable).values([{ entityId: source!.id }, { entityId: source!.id }]).returning();
    const [first, second, unlinked] = await db.insert(entityRecordsTable).values(Array.from({ length: 3 }, () => ({ entityId: target!.id }))).returning();
    await db.insert(recordLinksTable).values([first!, second!].map((record) => ({ relationId: relation!.id, relationType: "many_to_many", sourceRecordId: trigger!.id, targetRecordId: record.id })));
    const action = { type: "set_related_status" as const, relationId: relation!.id, statusId: status!.id };
    const snapshot = () => db.select().from(entityRecordsTable).where(inArray(entityRecordsTable.id, [first!.id, second!.id, unlinked!.id])).orderBy(entityRecordsTable.id);
    const before = await snapshot();
    assert.deepEqual(await systemSetRelatedStatus(source!.id, empty!.id, action, null, log), { ok: true, matched: 0 });
    assert.deepEqual(await snapshot(), before);
    const bad = await systemSetRelatedStatus(source!.id, trigger!.id, { ...action, statusId: wrongStatus!.id }, null, log);
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /Status does not belong/);
    assert.deepEqual(await snapshot(), before);
    // Corrupt legacy link discovered after the first valid target was written:
    // every write, audit entry and version change must roll back.
    const [wrongRow] = await db.insert(entityRecordsTable).values({ entityId: source!.id }).returning();
    const [badLink] = await db.insert(recordLinksTable).values({ relationId: relation!.id, relationType: "many_to_many", sourceRecordId: trigger!.id, targetRecordId: wrongRow!.id }).returning();
    const failed = await systemSetRelatedStatus(source!.id, trigger!.id, action, null, log);
    assert.equal(failed.ok, false);
    assert.match(failed.error!, /Linked record/);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.select().from(auditLogTable).where(eq(auditLogTable.entityId, target!.id))).length, 0);
    assert.equal((await db.select().from(systemEventsTable).where(eq(systemEventsTable.entityId, target!.id))).length, 0);
    await db.delete(recordLinksTable).where(eq(recordLinksTable.id, badLink!.id));
    assert.deepEqual(await systemSetRelatedStatus(source!.id, trigger!.id, action, null, log), { ok: true, matched: 2 });
    const after = await snapshot();
    assert.equal(after[0]!.statusId, status!.id);
    assert.equal(after[1]!.statusId, status!.id);
    assert.deepEqual(after[2], before[2]);
    assert.equal((await db.select().from(auditLogTable).where(eq(auditLogTable.entityId, target!.id))).length, 2);
    // Repeating an already-satisfied status is a true no-op.
    await systemSetRelatedStatus(source!.id, trigger!.id, action, null, log);
    assert.deepEqual(await snapshot(), after);
    // Error details must remain visible in the durable automation journal.
    const [automation] = await db.insert(entityAutomationsTable).values({
      entityId: source!.id,
      triggerJson: { type: "record_created" },
      actionsJson: [{ ...action, statusId: wrongStatus!.id }],
    }).returning();
    initAutomations();
    await emitEvent({ eventName: EVENT_RECORD_CREATED, entityId: source!.id, recordId: trigger!.id });
    let runs: (typeof entityAutomationRunsTable.$inferSelect)[] = [];
    for (let attempt = 0; attempt < 100 && !runs.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      runs = await db.select().from(entityAutomationRunsTable).where(eq(entityAutomationRunsTable.automationId, automation!.id));
    }
    assert.equal(runs[0]?.status, "error");
    assert.match(JSON.stringify(runs[0]?.detailJson), /Status does not belong/);
    assert.deepEqual(await snapshot(), after);
    await db.update(entityAutomationsTable).set({ actionsJson: [action] }).where(eq(entityAutomationsTable.id, automation!.id));
    await emitEvent({ eventName: EVENT_RECORD_CREATED, entityId: source!.id, recordId: empty!.id });
    let noLinkRuns: (typeof entityAutomationRunsTable.$inferSelect)[] = [];
    for (let attempt = 0; attempt < 100 && !noLinkRuns.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      noLinkRuns = (await db.select().from(entityAutomationRunsTable).where(eq(entityAutomationRunsTable.automationId, automation!.id))).filter((run) => run.recordId === empty!.id);
    }
    assert.equal(noLinkRuns[0]?.status, "success");
    assert.match(JSON.stringify(noLinkRuns[0]?.detailJson), /"matched":0/);
    // Reverse traversal selects only the source linked to this target.
    assert.deepEqual(await systemSetRelatedStatus(target!.id, first!.id, {
      ...action, relationDirection: "reverse", statusId: wrongStatus!.id,
    }, null, log), { ok: true, matched: 1 });
    const [updatedSource] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, trigger!.id));
    const [untouchedSource] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, empty!.id));
    assert.equal(updatedSource!.statusId, wrongStatus!.id);
    assert.equal(untouchedSource!.statusId, null);
  } finally {
    stopAutomations();
    if (entityIds.length) {
      await db.delete(auditLogTable).where(inArray(auditLogTable.entityId, entityIds));
      await db.delete(systemEventsTable).where(inArray(systemEventsTable.entityId, entityIds));
      await db.delete(entitiesTable).where(inArray(entitiesTable.id, entityIds));
    }
    await pool.end();
  }
});