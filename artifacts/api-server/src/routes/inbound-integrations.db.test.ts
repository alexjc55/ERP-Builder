import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogTable,
  db,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  inboundDeliveriesTable,
  inboundDeliveryStepLogsTable,
  inboundExternalObjectMappingsTable,
  inboundIntegrationsTable,
  inboundMappingVersionsTable,
  pool,
  rolesTable,
  systemEventsTable,
  usersTable,
} from "@workspace/db";
import { EVENT_ANY, subscribe } from "../lib/events";
import { EVENT_RECORD_UPDATED } from "../lib/events";
import { signToken } from "../lib/jwt";
import adminRouter, {
  claimAndProcessInboundDelivery,
  inboundDriveName,
  isSystemIdAtOrAboveMatchMaximum,
  recoverInboundDeliveries,
  selectInboundTaggedFile,
  unsafeInboundAddress,
} from "./inbound-integrations";

const runId = `inbound-db-${randomUUID()}`;
const ids: {
  role?: number;
  user?: number;
  entity?: number;
  integration?: number;
  versions: number[];
  deliveries: number[];
} = { versions: [], deliveries: [] };

const source = (path: string) => ({ operand: { kind: "source", path } });

test("bounded system-id matches fall through at their exclusive maximum", () => {
  assert.equal(isSystemIdAtOrAboveMatchMaximum(999, 1_000), false);
  assert.equal(isSystemIdAtOrAboveMatchMaximum(1_000, 1_000), true);
  assert.equal(isSystemIdAtOrAboveMatchMaximum(1_001, 1_000), true);
  assert.equal(isSystemIdAtOrAboveMatchMaximum(Number.NaN, 1_000), false);
  assert.equal(isSystemIdAtOrAboveMatchMaximum(1_000, undefined), false);
});

test("inbound files accept only globally routable IPv4 addresses", () => {
  for (const address of [
    "127.0.0.1", "169.254.1.1", "192.168.1.1", "192.0.0.8", "192.0.2.1",
    "198.18.0.1", "198.51.100.1", "203.0.113.1", "::1", "::ffff:127.0.0.1",
  ]) assert.equal(unsafeInboundAddress(address), true, address);
  assert.equal(unsafeInboundAddress("8.8.8.8"), false);
  assert.equal(unsafeInboundAddress("93.184.216.34"), false);
});

test("inbound Drive naming and tag selection mirror the configured contract", () => {
  const selected = selectInboundTaggedFile([
    { file_tag: "drawing", file_name: "drawing.pdf" },
    { file_tag: "order", file_name: "order.pdf" },
  ], "order");
  assert.equal(selected?.file_name, "order.pdf");
  const name = inboundDriveName("source.pdf", [
    { kind: "text", text: "Order" },
    { kind: "field", fieldKey: "missing", alts: [{ fieldKey: "number" }] },
    { kind: "hash" },
    { kind: "user" },
  ], { number: "08005" }, "operator@example.com");
  assert.match(name, /^Order_08005_[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{7}_operator\.pdf$/);
});

async function addVersion(mappingJson: Record<string, unknown>) {
  const [row] = await db.insert(inboundMappingVersionsTable).values({
    integrationId: ids.integration!,
    version: ids.versions.length + 1,
    state: "published",
    mappingJson,
    createdBy: ids.user!,
    publishedAt: new Date(),
  }).returning({ id: inboundMappingVersionsTable.id });
  ids.versions.push(row!.id);
  return row!.id;
}

async function addDelivery(mappingVersionId: number, suffix: string, options: {
  status?: "queued" | "processing";
  attemptCount?: number;
  processingStartedAt?: Date;
  name?: string;
  receivedAt?: Date;
} = {}) {
  const [row] = await db.insert(inboundDeliveriesTable).values({
    integrationId: ids.integration!,
    mappingVersionId,
    eventId: `${runId}:${suffix}`,
    payloadHash: `${runId}:${suffix}:hash`,
    payloadJson: {
      externalId: `${runId}:customer`,
      orderId: `${runId}:order`,
      name: options.name ?? "Concurrent customer",
    },
    status: options.status ?? "queued",
    attemptCount: options.attemptCount ?? 0,
    processingStartedAt: options.processingStartedAt,
    receivedAt: options.receivedAt,
  }).returning({ id: inboundDeliveriesTable.id });
  ids.deliveries.push(row!.id);
  return row!.id;
}

async function delivery(id: number) {
  const [row] = await db.select().from(inboundDeliveriesTable).where(eq(inboundDeliveriesTable.id, id));
  assert.ok(row);
  return row;
}

async function postReprocess(id: number) {
  const app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await fetch(`http://127.0.0.1:${address.port}/api/inbound-deliveries/${id}/reprocess`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${signToken({ userId: ids.user!, roleId: ids.role! })}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

async function setup() {
  const [role] = await db.insert(rolesTable).values({
    nameJson: { en: runId },
    permissionsJson: {
      superAdmin: true,
      admin: {
        pages: true, entities: true, roles: true, users: true, translations: true,
        events: true, modules: true, googleDrive: true, settings: true,
        automations: true, customFilters: true, columnGroups: true,
        dataImport: true, inboundIntegrations: true,
      },
      pageIds: [],
      records: {},
    },
  }).returning({ id: rolesTable.id });
  ids.role = role!.id;
  const [user] = await db.insert(usersTable).values({
    email: `${runId}@example.invalid`,
    passwordHash: null,
    firstName: runId,
    lastName: "Webhook test",
    roleId: ids.role,
  }).returning({ id: usersTable.id });
  ids.user = user!.id;
  const [entity] = await db.insert(entitiesTable).values({
    entityKey: runId,
    nameJson: { en: runId },
  }).returning({ id: entitiesTable.id });
  ids.entity = entity!.id;
  await db.insert(entityFieldsTable).values([
    { entityId: ids.entity, fieldKey: "external_key", nameJson: { en: "External key" }, fieldType: "text", isKey: true },
    { entityId: ids.entity, fieldKey: "name", nameJson: { en: "Name" }, fieldType: "text" },
  ]);
  const [integration] = await db.insert(inboundIntegrationsTable).values({
    name: runId,
    userId: ids.user,
    roleId: ids.role,
    tokenHash: `${runId}:token`,
    tokenPrefix: runId,
  }).returning({ id: inboundIntegrationsTable.id });
  ids.integration = integration!.id;
}

async function cleanup() {
  if (ids.entity) {
    await db.delete(systemEventsTable).where(eq(systemEventsTable.entityId, ids.entity));
    await db.delete(auditLogTable).where(eq(auditLogTable.entityId, ids.entity));
  }
  if (ids.deliveries.length) {
    await db.delete(inboundDeliveryStepLogsTable).where(inArray(inboundDeliveryStepLogsTable.deliveryId, ids.deliveries));
    await db.delete(inboundDeliveriesTable).where(inArray(inboundDeliveriesTable.id, ids.deliveries));
  }
  if (ids.integration) {
    await db.delete(inboundExternalObjectMappingsTable).where(eq(inboundExternalObjectMappingsTable.integrationId, ids.integration));
    await db.delete(inboundMappingVersionsTable).where(eq(inboundMappingVersionsTable.integrationId, ids.integration));
    await db.delete(inboundIntegrationsTable).where(eq(inboundIntegrationsTable.id, ids.integration));
  }
  if (ids.entity) await db.delete(entitiesTable).where(eq(entitiesTable.id, ids.entity));
  if (ids.user) await db.delete(usersTable).where(eq(usersTable.id, ids.user));
  if (ids.role) await db.delete(rolesTable).where(eq(rolesTable.id, ids.role));
}

after(async () => {
  await cleanup();
  await pool.end();
});

test("inbound worker PostgreSQL concurrency and atomicity regressions", async (t) => {
  await setup();

  const upsertVersion = await addVersion({
    atomic: true,
    steps: [{
      key: "customer",
      operation: "upsert",
      target: { kind: "entity", entityId: ids.entity },
      matches: [{ kind: "fields", conditions: [{ fieldKey: "external_key", value: source("externalId") }] }],
      values: { external_key: source("externalId"), name: source("name") },
      externalId: { objectType: "customer", value: source("externalId") },
    }, {
      key: "order",
      operation: "upsert",
      target: { kind: "entity", entityId: ids.entity },
      matches: [{ kind: "fields", conditions: [{ fieldKey: "external_key", value: source("orderId") }] }],
      values: { external_key: source("orderId"), name: { operand: { kind: "static", value: "Concurrent order" } } },
      externalId: { objectType: "order", value: source("orderId") },
    }],
  });

  await t.test("a delivery is claimed once and attemptCount increments on claim", async () => {
    const id = await addDelivery(upsertVersion, "single-claim");
    const claims = await Promise.all(Array.from({ length: 12 }, () => claimAndProcessInboundDelivery(id)));
    assert.equal(claims.filter(Boolean).length, 1);
    const row = await delivery(id);
    assert.equal(row.status, "completed");
    assert.equal(row.attemptCount, 1);
    const logs = await db.select().from(inboundDeliveryStepLogsTable).where(eq(inboundDeliveryStepLogsTable.deliveryId, id));
    assert.equal(logs.length, 2);
  });

  await t.test("concurrent deliveries share one customer, order, and each external mapping", async () => {
    const a = await addDelivery(upsertVersion, "concurrent-a");
    const b = await addDelivery(upsertVersion, "concurrent-b");
    assert.deepEqual(await Promise.all([claimAndProcessInboundDelivery(a), claimAndProcessInboundDelivery(b)]), [true, true]);
    const records = await db.select().from(entityRecordsTable).where(and(
      eq(entityRecordsTable.entityId, ids.entity!),
      eq(entityRecordsTable.valuesJson, { external_key: `${runId}:customer`, name: "Concurrent customer" }),
    ));
    assert.equal(records.length, 1);
    const customerMappings = await db.select().from(inboundExternalObjectMappingsTable).where(and(
      eq(inboundExternalObjectMappingsTable.integrationId, ids.integration!),
      eq(inboundExternalObjectMappingsTable.objectType, "customer"),
      eq(inboundExternalObjectMappingsTable.externalId, `${runId}:customer`),
    ));
    assert.equal(customerMappings.length, 1);
    assert.equal(customerMappings[0]!.targetId, records[0]!.id);
    const orders = await db.select().from(entityRecordsTable).where(and(
      eq(entityRecordsTable.entityId, ids.entity!),
      eq(entityRecordsTable.valuesJson, { external_key: `${runId}:order`, name: "Concurrent order" }),
    ));
    assert.equal(orders.length, 1);
    const orderMappings = await db.select().from(inboundExternalObjectMappingsTable).where(and(
      eq(inboundExternalObjectMappingsTable.integrationId, ids.integration!),
      eq(inboundExternalObjectMappingsTable.objectType, "order"),
      eq(inboundExternalObjectMappingsTable.externalId, `${runId}:order`),
    ));
    assert.equal(orderMappings.length, 1);
    assert.equal(orderMappings[0]!.targetId, orders[0]!.id);
  });

  await t.test("business write, audit, version, step log, event and completed status commit together", async () => {
    const id = await addDelivery(upsertVersion, "atomic-success", { name: "Atomic customer update" });
    const [recordBefore] = await db.select().from(entityRecordsTable).where(and(
      eq(entityRecordsTable.entityId, ids.entity!),
      eq(entityRecordsTable.valuesJson, { external_key: `${runId}:customer`, name: "Concurrent customer" }),
    ));
    assert.ok(recordBefore);
    const auditsBefore = (await db.select().from(auditLogTable).where(and(
      eq(auditLogTable.entityId, ids.entity!),
      eq(auditLogTable.recordId, recordBefore.id),
    ))).length;
    const eventsBefore = (await db.select().from(systemEventsTable).where(and(
      eq(systemEventsTable.entityId, ids.entity!),
      eq(systemEventsTable.recordId, recordBefore.id),
      eq(systemEventsTable.eventName, EVENT_RECORD_UPDATED),
    ))).length;
    assert.equal(await claimAndProcessInboundDelivery(id), true);
    const row = await delivery(id);
    assert.equal(row.status, "completed");
    assert.ok(row.completedAt);
    const [record] = await db.select().from(entityRecordsTable).where(eq(entityRecordsTable.id, recordBefore.id));
    assert.ok(record);
    assert.equal(record.version, recordBefore.version + 1);
    assert.equal((await db.select().from(auditLogTable).where(and(
      eq(auditLogTable.entityId, ids.entity!),
      eq(auditLogTable.recordId, record.id),
    ))).length, auditsBefore + 1);
    assert.equal((await db.select().from(inboundDeliveryStepLogsTable).where(eq(inboundDeliveryStepLogsTable.deliveryId, id))).length, 2);
    assert.equal((await db.select().from(systemEventsTable).where(and(
      eq(systemEventsTable.entityId, ids.entity!),
      eq(systemEventsTable.recordId, record.id),
      eq(systemEventsTable.eventName, EVENT_RECORD_UPDATED),
    ))).length, eventsBefore + 1);
  });

  await t.test("forced later-step failure rolls back business effects and emits no mutation event", async () => {
    const unique = `${runId}:rollback`;
    const failingVersion = await addVersion({
      atomic: true,
      steps: [{
        key: "first",
        operation: "create",
        target: { kind: "entity", entityId: ids.entity },
        values: {
          external_key: { operand: { kind: "static", value: unique } },
          name: { operand: { kind: "static", value: "must roll back" } },
        },
        externalId: { objectType: "rollback-customer", value: { operand: { kind: "static", value: unique } } },
      }, {
        key: "fail",
        operation: "update",
        target: { kind: "entity", entityId: ids.entity },
        matches: [{ kind: "fields", conditions: [{ fieldKey: "external_key", value: { operand: { kind: "static", value: `${unique}:missing` } } }] }],
        values: { name: { operand: { kind: "static", value: "unreachable" } } },
      }],
    });
    const id = await addDelivery(failingVersion, "forced-failure");
    let emitted = 0;
    const unsubscribe = subscribe(EVENT_ANY, (event) => {
      if (event.entityId === ids.entity) emitted += 1;
    });
    try {
      assert.equal(await claimAndProcessInboundDelivery(id), true);
    } finally {
      unsubscribe();
    }
    assert.equal((await delivery(id)).status, "failed");
    const rolledBack = await db.select().from(entityRecordsTable).where(and(
      eq(entityRecordsTable.entityId, ids.entity!),
      eq(entityRecordsTable.valuesJson, { external_key: unique, name: "must roll back" }),
    ));
    assert.equal(rolledBack.length, 0);
    assert.equal((await db.select().from(inboundExternalObjectMappingsTable).where(and(
      eq(inboundExternalObjectMappingsTable.integrationId, ids.integration!),
      eq(inboundExternalObjectMappingsTable.externalId, unique),
    ))).length, 0);
    assert.equal((await db.select().from(auditLogTable).where(and(
      eq(auditLogTable.entityId, ids.entity!),
      eq(auditLogTable.newValue, unique),
    ))).length, 0);
    assert.equal(emitted, 0);
    const logs = await db.select().from(inboundDeliveryStepLogsTable).where(eq(inboundDeliveryStepLogsTable.deliveryId, id));
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.status, "failed");
  });

  await t.test("stale work is reclaimed once while active and completed deliveries are not reprocessed", async () => {
    const stale = await addDelivery(upsertVersion, "stale", {
      status: "processing",
      attemptCount: 4,
      processingStartedAt: new Date(Date.now() - 11 * 60_000),
    });
    const staleClaims = await Promise.all(Array.from({ length: 8 }, () => claimAndProcessInboundDelivery(stale)));
    assert.equal(staleClaims.filter(Boolean).length, 1);
    assert.equal((await delivery(stale)).attemptCount, 5);
    assert.equal((await delivery(stale)).status, "completed");

    const active = await addDelivery(upsertVersion, "active", {
      status: "processing",
      attemptCount: 7,
      processingStartedAt: new Date(),
    });
    assert.equal(await claimAndProcessInboundDelivery(active), false);
    assert.equal((await delivery(active)).attemptCount, 7);
    assert.equal((await delivery(active)).status, "processing");

    assert.equal(await claimAndProcessInboundDelivery(stale), false);
    assert.equal((await delivery(stale)).attemptCount, 5);
  });

  await t.test("recovery scans queued and stale rows, honors limit, excludes active work, and races safely", async () => {
    const first = await addDelivery(upsertVersion, "recover-first", { receivedAt: new Date(1) });
    const second = await addDelivery(upsertVersion, "recover-second", { receivedAt: new Date(2) });
    const active = await addDelivery(upsertVersion, "recover-active", {
      status: "processing", attemptCount: 9, processingStartedAt: new Date(),
    });
    await recoverInboundDeliveries(1);
    assert.equal((await delivery(first)).status, "completed");
    assert.equal((await delivery(first)).attemptCount, 1);
    assert.equal((await delivery(second)).status, "queued");
    assert.equal((await delivery(active)).attemptCount, 9);

    const stale = await addDelivery(upsertVersion, "recover-stale", {
      status: "processing", attemptCount: 2, processingStartedAt: new Date(Date.now() - 11 * 60_000),
    });
    await Promise.all([recoverInboundDeliveries(10), recoverInboundDeliveries(10), recoverInboundDeliveries(10)]);
    assert.equal((await delivery(second)).status, "completed");
    assert.equal((await delivery(second)).attemptCount, 1);
    assert.equal((await delivery(stale)).status, "completed");
    assert.equal((await delivery(stale)).attemptCount, 3);
    assert.equal((await delivery(active)).status, "processing");
    assert.equal((await delivery(active)).attemptCount, 9);
  });

  await t.test("authenticated reprocess reports a state-change race as conflict without resetting work", async () => {
    const id = await addDelivery(upsertVersion, "reprocess-race");
    await db.update(inboundDeliveriesTable).set({ status: "failed", attemptCount: 3 }).where(eq(inboundDeliveriesTable.id, id));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE inbound_deliveries SET status = 'processing', processing_started_at = now() WHERE id = $1", [id]);
      const responsePromise = postReprocess(id);
      let waiting = false;
      for (let i = 0; i < 100; i += 1) {
        const result = await client.query("SELECT count(*)::int AS count FROM pg_locks WHERE NOT granted");
        if (result.rows[0]?.count > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, "reprocess update did not reach the locked row");
      await client.query("COMMIT");
      const response = await responsePromise;
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "Delivery state changed; it was not reprocessed" });
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    const row = await delivery(id);
    assert.equal(row.status, "processing");
    assert.equal(row.attemptCount, 3);
    assert.equal((await db.select().from(inboundDeliveryStepLogsTable).where(eq(inboundDeliveryStepLogsTable.deliveryId, id))).length, 0);
  });
});