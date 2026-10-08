import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { db, pool, rolesTable, usersTable, modulesTable, inboundIntegrationsTable,
  inboundMappingVersionsTable, inboundDeliveriesTable, entitiesTable, entityFieldsTable, NO_ACCESS_PERMS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { inboundSafetyIssues, inboundEventAllowed, isInboundGuestRole } from "./inbound-safety";
import { hashInboundSecret } from "./inbound-auth";
import adminRouter, { inboundWebhookRouter, claimAndProcessInboundDelivery } from "../routes/inbound-integrations";
import { signToken } from "./jwt";

test("inbound safety is fail-closed for old mappings, roles, events and disabled modules", async () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  const schema = `inbound_safety_${randomUUID().replaceAll("-", "")}`;
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const tables = await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    const write = { ...NO_ACCESS_PERMS, records: { "1": { view: true, create: true, update: true, delete: false } } };
    await db.insert(rolesTable).values([
      { id: 1, nameJson: {}, permissionsJson: write },
      { id: 2, nameJson: {}, permissionsJson: NO_ACCESS_PERMS },
      { id: 3, nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS, superAdmin: true } },
    ]);
    await db.insert(usersTable).values({ id: 1, email: "fixture@inbound.invalid", firstName: "Fixture", lastName: "", roleId: 1 });
    await db.insert(modulesTable).values({ moduleKey: "inbound_integrations", nameJson: {}, version: "1", isEnabled: true });
    const secret = "whk_" + "x".repeat(48);
    await db.insert(inboundIntegrationsTable).values({ id: 1, name: "Fixture", userId: 1, roleId: 1, tokenHash: hashInboundSecret(secret), tokenPrefix: "fixture" });
    const base = { userId: 1, roleId: 1 };
    const mapping = { allowedEvents: ["accepted"], steps: [{ key: "client", operation: "create" as const,
      target: { kind: "user" as const, fieldId: 1, roleId: 2 } }] };
    assert.equal(isInboundGuestRole(write), false);
    assert.equal(isInboundGuestRole(NO_ACCESS_PERMS), true);
    assert.equal(inboundEventAllowed(mapping, { event: "other" }), false);
    assert.equal(inboundEventAllowed(mapping, {}), false);
    assert.equal(inboundEventAllowed(mapping, { event: "accepted" }), true);
    assert.ok((await inboundSafetyIssues(base)).length);
    assert.deepEqual(await inboundSafetyIssues(base, db, mapping), []);
    assert.ok((await inboundSafetyIssues({ ...base, roleId: 3 }, db, mapping)).length);
    assert.ok((await inboundSafetyIssues(base, db, { ...mapping, allowedEvents: [] })).length);
    assert.ok((await inboundSafetyIssues(base, db, { ...mapping, steps: [{ ...mapping.steps[0], target: { ...mapping.steps[0].target, roleId: 1 } }] })).length);
    const [version] = await db.insert(inboundMappingVersionsTable).values({ integrationId: 1, version: 1, state: "published", mappingJson: mapping, createdBy: 1 }).returning();
    await db.update(inboundIntegrationsTable).set({ publishedMappingVersionId: version.id }).where(eq(inboundIntegrationsTable.id, 1));
    const app = express();
    app.use("/api/webhooks", express.raw({ type: "application/json" }));
    app.use(inboundWebhookRouter);
    app.use(express.json(), adminRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    await db.insert(usersTable).values({ id: 10, email: "admin@fixture.invalid",
      firstName: "Admin", lastName: "", roleId: 3 });
    const adminToken = signToken({ userId: 10, roleId: 3 });
    const adminCreate = await fetch(`http://127.0.0.1:${addr.port}/inbound-integrations`, {
      method: "POST", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Forbidden admin integration", roleIds: [3] }),
    });
    assert.equal(adminCreate.status, 400);
    assert.equal((await db.select().from(inboundIntegrationsTable)).length, 1);
    const call = (event: string) => fetch(`http://127.0.0.1:${addr.port}/api/webhooks/inbound/1`, {
      method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-event-id": randomUUID() },
      body: JSON.stringify({ event }),
    });
    assert.equal((await call("other")).status, 422);
    assert.equal((await db.select().from(inboundDeliveriesTable)).length, 0);
    await db.update(modulesTable).set({ isEnabled: false }).where(eq(modulesTable.moduleKey, "inbound_integrations"));
    assert.equal((await call("accepted")).status, 403);
    const [queued] = await db.insert(inboundDeliveriesTable).values({
      integrationId: 1, mappingVersionId: version.id, eventId: "queued-before-disable",
      payloadHash: "fixture", payloadJson: { event: "accepted" }, status: "queued",
    }).returning();
    await claimAndProcessInboundDelivery(queued.id);
    const [blocked] = await db.select().from(inboundDeliveriesTable).where(eq(inboundDeliveriesTable.id, queued.id));
    assert.equal(blocked.status, "failed");
    assert.equal(blocked.errorCode, "security_policy_blocked");
    assert.equal((await db.select().from(usersTable)).length, 2);
    await db.update(modulesTable).set({ isEnabled: true }).where(eq(modulesTable.moduleKey, "inbound_integrations"));
    await db.insert(entitiesTable).values({ id: 1, entityKey: "inbound_fixture", nameJson: {} });
    await db.insert(entityFieldsTable).values({ id: 1, entityId: 1, fieldKey: "client", fieldType: "user",
      nameJson: {}, userConfigJson: { allowCreate: true, allowedRoleIds: [2] } });
    const executable = { ...mapping, steps: [{ ...mapping.steps[0], values: {
      email: { operand: { kind: "source", path: "client.email" } },
    } }] };
    const [working] = await db.insert(inboundMappingVersionsTable).values({ integrationId: 1, version: 2,
      state: "published", mappingJson: executable, createdBy: 1 }).returning();
    const queue = async (versionId: number, email: string) => {
      const [row] = await db.insert(inboundDeliveriesTable).values({ integrationId: 1, mappingVersionId: versionId,
        eventId: randomUUID(), payloadHash: "fixture", payloadJson: { event: "accepted", client: { email },
          roleId: 3, password: "ignored-fixture-value" }, status: "queued" }).returning();
      await claimAndProcessInboundDelivery(row.id);
      return (await db.select().from(inboundDeliveriesTable).where(eq(inboundDeliveriesTable.id, row.id)))[0];
    };
    assert.equal((await queue(working.id, "guest@fixture.invalid")).status, "completed");
    const [guest] = await db.select().from(usersTable).where(eq(usersTable.email, "guest@fixture.invalid"));
    assert.equal(guest.roleId, 2);
    assert.equal(guest.passwordHash, null);
    const [failing] = await db.insert(inboundMappingVersionsTable).values({ integrationId: 1, version: 3,
      state: "published", createdBy: 1, mappingJson: { ...executable, steps: [...executable.steps,
        { key: "missing", operation: "find", target: { kind: "entity", entityId: 1 }, matches: [] }] } }).returning();
    assert.equal((await queue(failing.id, "rollback@fixture.invalid")).status, "failed");
    assert.equal((await db.select().from(usersTable).where(eq(usersTable.email, "rollback@fixture.invalid"))).length, 0);
  } finally {
    if (server) await new Promise<void>((resolve) => { server!.close(() => resolve()); server!.closeAllConnections(); });
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release();
    await pool.end();
  }
});
