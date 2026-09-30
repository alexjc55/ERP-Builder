import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, entitiesTable, entityFieldsTable, entityRecordsTable, entityStatusesTable,
  relationsTable, recordLinksTable, auditLogTable, systemEventsTable, usersTable,
} from "@workspace/db";
import { systemSetRelatedStatus, systemUpdateRecord } from "./automations-engine";

// Run in node:test's isolated child process via the registered locked command.
// Obtain DEV_DB_FINGERPRINT independently with executeSql(environment:development):
// SELECT md5(string_agg(id::text||':'||entity_key||':'||created_at::text,',' ORDER BY id)) FROM entities;
// Never generate the expected value from this process's DATABASE_URL.
test("system writes never borrow a second connection while holding a transaction", {
  skip: process.env.RUN_AUTOMATION_POOL_DB_TESTS !== "1",
  timeout: 30_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "helium", "Only independently verified local development is allowed");
  assert.equal(url.pathname, "/heliumdb");
  const expected = process.env.DEV_DB_FINGERPRINT;
  assert.match(expected ?? "", /^[a-f0-9]{32}$/, "Independent development fingerprint required");

  // ONLY this test process's pool, not the running API. Acquisition timeout makes
  // a regression fail/rollback instead of hanging the suite or preventing cleanup.
  pool.options.max = 1;
  pool.options.connectionTimeoutMillis = 1500;
  pool.options.options = "-c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=8000";
  pool.on("error", () => { /* an idle connection timeout must not crash teardown */ });
  const ids: number[] = [];
  const errors: unknown[] = [];
  const log = { error: (error: unknown) => { errors.push(error); } };
  try {
    const proof = await db.execute(sql`SELECT current_database() AS db,
      (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,
      md5(string_agg(id::text||':'||entity_key||':'||created_at::text,',' ORDER BY id)) AS fingerprint FROM entities`);
    assert.equal(proof.rows[0]?.db, "heliumdb");
    assert.equal(proof.rows[0]?.oid, "16384");
    assert.equal(proof.rows[0]?.fingerprint, expected);
    const key = `pool-regression-${randomUUID()}`;
    const [source, target] = await db.insert(entitiesTable).values([
      { entityKey: `${key}-source` }, { entityKey: `${key}-target` },
    ]).returning();
    ids.push(source!.id, target!.id);
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
    assert.ok(user, "Fixture requires an existing user for reference validation; never mutates it");
    await db.insert(entityFieldsTable).values([
      { entityId: target!.id, fieldKey: "title", fieldType: "text" },
      { entityId: target!.id, fieldKey: "parent", fieldType: "text" },
      { entityId: target!.id, fieldKey: "child", fieldType: "text", dependencyConfigJson: { dependsOnFieldKey: "parent" } },
      { entityId: target!.id, fieldKey: "owner", fieldType: "user" },
    ]);
    const [status] = await db.insert(entityStatusesTable).values({ entityId: target!.id, statusKey: "done" }).returning();
    const [relation] = await db.insert(relationsTable).values({
      sourceEntityId: source!.id, targetEntityId: target!.id, relationKey: "members", relationType: "many_to_many",
    }).returning();
    const sources = await db.insert(entityRecordsTable).values(Array.from({ length: 13 }, () => ({ entityId: source!.id }))).returning();
    const targets = await db.insert(entityRecordsTable).values(Array.from({ length: 13 }, () => ({
      entityId: target!.id, valuesJson: { title: "before", parent: "group", child: "member", owner: user.id },
    }))).returning();
    await db.insert(recordLinksTable).values(sources.map((record, index) => ({
      relationId: relation!.id, relationType: "many_to_many", sourceRecordId: record.id, targetRecordId: targets[index]!.id,
    })));
    const action = { type: "set_related_status" as const, relationId: relation!.id, statusId: status!.id };
    const read = async (id: number) => (await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, id)))[0]!;
    const probe = async () => {
      assert.equal((await db.execute(sql`SELECT 1 AS healthy`)).rows[0]?.healthy, 1);
      assert.equal(pool.waitingCount, 0);
    };

    // Deterministic former deadlock: related action owns the only connection;
    // initial record/fields/status reads must use that same transaction.
    assert.deepEqual(await systemSetRelatedStatus(source!.id, sources[0]!.id, action, null, log), { ok: true, matched: 1 });
    assert.equal((await read(targets[0]!.id)).version, targets[0]!.version + 1);
    await probe();

    // Ordinary value updates used to borrow a connection for module metadata
    // after obtaining their own transaction's record lock.
    assert.equal(await systemUpdateRecord(targets[1]!.id, { title: "standalone" }, undefined, null, log), true);
    assert.equal(((await read(targets[1]!.id)).valuesJson as Record<string, unknown>).title, "standalone");
    await probe();

    // Also exercise ALL preflight metadata/reference/dependency reads with an
    // externally supplied transaction; events remain deferred until commit.
    const deferred: (() => Promise<void>)[] = [];
    const beforeEvents = await db.select().from(systemEventsTable).where(eq(systemEventsTable.recordId, targets[2]!.id));
    await db.transaction(async tx => {
      assert.equal(await systemUpdateRecord(targets[2]!.id, { title: "outer" }, status!.id, null, log, {
        transaction: tx, afterCommit: deferred,
      }), true);
      assert.deepEqual(await tx.select().from(systemEventsTable).where(eq(systemEventsTable.recordId, targets[2]!.id)), beforeEvents);
    });
    for (const publish of deferred) await publish();
    assert.equal(((await read(targets[2]!.id)).valuesJson as Record<string, unknown>).title, "outer");
    await probe();

    const rollbackBefore = await read(targets[2]!.id);
    const rollbackAudits = await db.select().from(auditLogTable).where(eq(auditLogTable.recordId, targets[2]!.id));
    const rollbackEvents = await db.select().from(systemEventsTable).where(eq(systemEventsTable.recordId, targets[2]!.id));
    const discarded: (() => Promise<void>)[] = [];
    await assert.rejects(db.transaction(async tx => {
      assert.equal(await systemUpdateRecord(targets[2]!.id, { title: "must roll back" }, null, null, log, {
        transaction: tx, afterCommit: discarded,
      }), true);
      throw new Error("later batch validation failed");
    }), /later batch validation failed/);
    assert.deepEqual(await read(targets[2]!.id), rollbackBefore);
    assert.deepEqual(await db.select().from(auditLogTable).where(eq(auditLogTable.recordId, targets[2]!.id)), rollbackAudits);
    assert.deepEqual(await db.select().from(systemEventsTable).where(eq(systemEventsTable.recordId, targets[2]!.id)), rollbackEvents);
    await probe();

    // Ten disjoint related actions saturate a normal-sized pool concurrently.
    // Do not enlarge the production pool: this is a test-only return to default.
    pool.options.max = 10;
    const outcomes = await Promise.allSettled(sources.slice(3).map(record =>
      systemSetRelatedStatus(source!.id, record.id, action, null, log)));
    for (const outcome of outcomes) {
      assert.equal(outcome.status, "fulfilled");
      if (outcome.status === "fulfilled") assert.deepEqual(outcome.value, { ok: true, matched: 1 });
    }
    await probe();
    for (const targetRow of targets.slice(3)) {
      const row = await read(targetRow.id);
      assert.equal(row.statusId, status!.id);
      assert.equal(row.version, targetRow.version + 1);
      const audits = await db.select().from(auditLogTable).where(eq(auditLogTable.recordId, row.id));
      assert.equal(audits.length, 1);
      const events = await db.select().from(systemEventsTable).where(eq(systemEventsTable.recordId, row.id));
      assert.deepEqual(events.map(event => event.eventName).sort(), ["record.updated", "status.changed"]);
      assert.ok(events.every(event => (event.payloadJson as { version: number }).version === row.version));
    }
    assert.deepEqual(errors, []);
  } finally {
    if (ids.length) {
      await db.delete(auditLogTable).where(inArray(auditLogTable.entityId, ids));
      await db.delete(systemEventsTable).where(inArray(systemEventsTable.entityId, ids));
      await db.delete(entitiesTable).where(inArray(entitiesTable.id, ids));
      assert.deepEqual(await db.select().from(entitiesTable).where(inArray(entitiesTable.id, ids)), []);
      assert.deepEqual(await db.select().from(auditLogTable).where(inArray(auditLogTable.entityId, ids)), []);
      assert.deepEqual(await db.select().from(systemEventsTable).where(inArray(systemEventsTable.entityId, ids)), []);
    }
    await pool.end();
  }
});