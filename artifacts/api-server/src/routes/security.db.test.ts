import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { db, pool, rolesTable, usersTable, securityEventsTable, securityEventReviewsTable, NO_ACCESS_PERMS,
  entitiesTable, entityFieldsTable, entityRecordsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { signToken } from "../lib/jwt";
import { securityAuditContext, securityAuditStart, flushSecurityAudit, securityTokenRef, classifySecurityRequest } from "../lib/security-audit";
import { createSecurityIpResolver } from "../lib/security-ip";
import { requireAuth } from "../middlewares/auth";
import { requireSuperAdmin } from "../middlewares/permissions";
import { storeSecurityEvidence } from "../lib/security-aggregation";
import { cleanupSecurityEvents } from "../lib/security-retention";
import { enrichSecurityReferences, securityReferenceIds } from "../lib/security-display-references";

test("IP attribution rejects spoofed chains and trusts only configured hops", () => {
  const resolve = createSecurityIpResolver("127.0.0.1/32").resolve;
  assert.equal(resolve("8.8.8.8", "1.1.1.1").clientIp, "8.8.8.8");
  assert.equal(resolve("::ffff:127.0.0.1", "1.1.1.1, 8.8.8.8").clientIp, "8.8.8.8");
  assert.equal(resolve("127.0.0.1", "not-an-ip").ipSource, "invalid-forwarded-ignored");
  assert.throws(() => createSecurityIpResolver("0.0.0.0/0"));
  assert.equal(classifySecurityRequest("/api/inbound-integrations/2/regenerate-secret", "POST").critical, true);
  assert.equal(classifySecurityRequest("/api/google-drive/oauth/callback", "GET").critical, true);
});

test("security evidence HTTP and database boundaries", { timeout: 120000 }, async (t) => {
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  assert.equal(process.env.NODE_ENV, "test");
  const schema = `security_test_${randomUUID().replaceAll("-", "")}`;
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const tables = await bootstrap.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    await db.insert(rolesTable).values([
      { id: 1001, nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS, superAdmin: true } },
      { id: 1002, nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS } },
    ]);
    const password = "security-fixture-password";
    await db.insert(usersTable).values([
      { id: 1001, email: "admin@security.invalid", firstName: "Test", lastName: "", roleId: 1001, passwordHash: await bcrypt.hash(password, 10) },
      { id: 1002, email: "user@security.invalid", firstName: "Test", lastName: "", roleId: 1002 },
    ]);
    const app = express();
    app.use(securityAuditContext, express.json(), securityAuditStart);
    app.use((await import("./auth")).default);
    app.use((await import("./security")).default);
    app.post("/users", requireAuth, requireSuperAdmin(), (_req, res) => res.json({ id: 2001, passwordHash: "NEVER-STORE-HASH" }));
    let rotations = 0;
    app.post("/ai-agents/:id/regenerate-key", requireAuth, requireSuperAdmin(), (_req, res) => {
      rotations++; res.json({ apiKey: "NEVER-STORE-AGENT-KEY" });
    });
    app.get("/probe", requireAuth, (_req, res) => res.json({ ok: true }));
    app.get("/records/:id", requireAuth, (_req, res) => res.status(403).json({ error: "Denied test fixture" }));
    app.get("/entities/:entityId/records", requireAuth, (_req, res) => res.status(403).json({ error: "Denied test fixture" }));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    const base = `http://127.0.0.1:${addr.port}`;
    const request = async (path: string, token?: string, body?: unknown, method?: string) => {
      const response = await fetch(base + path, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json() as Record<string, any>;
      await flushSecurityAudit();
      return { status: response.status, data, requestId: response.headers.get("x-request-id") };
    };
    let token = "";
    await t.test("failed login reason is private; successful login and later actions share safe session reference", async () => {
      const bad = await request("/auth/login", undefined, { email: "admin@security.invalid", password: "NEVER-STORE-PASSWORD" });
      assert.equal(bad.status, 401);
      assert.equal(bad.data.error, "Invalid credentials");
      const signed = await request("/auth/login", undefined, { email: "admin@security.invalid", password });
      assert.equal(signed.status, 200); token = signed.data.token;
      const changed = await request("/users", token, { password: "NEVER-STORE-PASSWORD", roleIds: [1001], arbitrary: "NEVER-STORE-ARBITRARY" });
      assert.equal(changed.status, 200);
      const rows = await db.select().from(securityEventsTable);
      assert.ok(rows.some((r) => r.reason === "password_mismatch"));
      const created = rows.find((r) => r.action === "user.create" && r.outcome === "success")!;
      assert.equal(created.actorUserId, 1001); assert.equal(created.targetUserId, 2001);
      assert.equal(created.sessionRef, securityTokenRef(token)); assert.equal(created.isAlert, true);
      assert.equal(rows.find((r) => r.action === "auth.login" && r.outcome === "success")!.sessionRef, created.sessionRef);
      const encoded = JSON.stringify(rows);
      for (const secret of [password, "NEVER-STORE-PASSWORD", "NEVER-STORE-HASH", "NEVER-STORE-ARBITRARY", token]) assert.ok(!encoded.includes(secret));
      assert.ok(created.requestId && changed.requestId === created.requestId);
    });
    await t.test("ordinary, guest, impersonated users cannot access evidence; malformed filters are rejected", async () => {
      assert.equal((await request("/security/summary", signToken({ userId: 1002, roleId: 1002 }))).status, 403);
      assert.equal((await request("/security/summary", signToken({ userId: 1001, roleId: 1001, guest: true }))).status, 403);
      assert.equal((await request("/security/summary", signToken({ userId: 1001, roleId: 1001, impersonatorId: 1001, impersonatorSessionVersion: 0 }))).status, 403);
      assert.equal((await request("/security/events/query", token, { limit: 99999 })).status, 400);
      const page = await request("/security/events/query", token, { actorUserId: 1001, sessionRef: securityTokenRef(token), limit: 2 });
      assert.equal(page.status, 200); assert.equal(page.data.data.length, 2);
      assert.ok(page.data.data.every((row: { actorUserId: number }) => row.actorUserId === 1001));
    });
    await t.test("acknowledgment is separate, idempotent and cannot delete evidence", async () => {
      const [event] = await db.select().from(securityEventsTable).where(eq(securityEventsTable.action, "user.create")).orderBy(securityEventsTable.id);
      const all = await db.select().from(securityEventsTable).where(eq(securityEventsTable.action, "user.create"));
      const alert = all.find((row) => row.isAlert)!; assert.ok(alert);
      const before = (await request("/security/summary", token)).data.unreviewedAlerts;
      assert.equal((await request(`/security/events/${alert.id}/review`, token, {})).status, 200);
      assert.equal((await request(`/security/events/${alert.id}/review`, token, {})).status, 200);
      assert.equal((await db.select().from(securityEventReviewsTable)).length, 1);
      assert.equal((await request("/security/summary", token)).data.unreviewedAlerts, before - 1);
      assert.deepEqual((await db.select().from(securityEventsTable).where(eq(securityEventsTable.id, event!.id)))[0], event);
    });
    await t.test("authorized audit query resolves actor names and keeps missing targets explicit", async () => {
      const page = await request("/security/events/query", token, { action: "user.create" });
      const event = page.data.data.find((row: { outcome: string }) => row.outcome === "success");
      assert.ok(event);
      const [actor] = await db.select().from(usersTable).where(eq(usersTable.id, 1001));
      const actorRef = event.displayReferences.find((ref: { relation: string }) => ref.relation === "actor");
      assert.equal(actorRef.id, 1001);
      assert.equal(actorRef.nameJson.ru, `${actor!.firstName} ${actor!.lastName}`.trim());
      assert.equal(actorRef.missing, false);
      const target = event.displayReferences.find((ref: { relation: string }) => ref.relation === "target");
      assert.equal(target.id, 2001);
      assert.equal(target.missing, true);
      assert.ok(!JSON.stringify(event.displayReferences).includes("password"));
      assert.equal((await request("/security/events/query", signToken({ userId: 1002, roleId: 1002 }), {})).status, 403);
      assert.equal((await request("/security/events/query", signToken({ userId: 1001, roleId: 1001, agentId: 999 }), {})).status, 403);
    });
    await t.test("record and entity names are bounded live hints, not stored snapshots or full values", async () => {
      await db.insert(entitiesTable).values({ id: 1007, entityKey: "security_labels_fixture", nameJson: { ru: "Заказы", en: "Orders", he: "הזמנות" } });
      await db.insert(entityFieldsTable).values([
        { id: 1007, entityId: 1007, fieldKey: "number", nameJson: {}, fieldType: "text", isKey: true },
        { id: 1008, entityId: 1007, fieldKey: "file", nameJson: {}, fieldType: "file", sortOrder: -1 },
      ]);
      await db.insert(entityRecordsTable).values({ id: 1007, entityId: 1007,
        valuesJson: { number: "Заказ 3715", file: { url: "NEVER-DISPLAY-FILE-URL" }, unknown: "NEVER-DISPLAY-UNKNOWN" } });
      const evidence = { targetUserId: 1002, reviewedBy: 1001, detailsJson: { targetRecordId: 1007, requestedRoleIds: [1001, 1002] } };
      const original = JSON.stringify(evidence);
      const [result] = await enrichSecurityReferences([evidence]);
      assert.equal(result!.displayReferences.find(r => r.kind === "record")?.nameJson?.ru, "Заказ 3715");
      assert.equal(result!.displayReferences.find(r => r.kind === "entity")?.nameJson?.en, "Orders");
      assert.equal(result!.displayReferences.filter(r => r.kind === "role").length, 2);
      assert.ok(!JSON.stringify(result).includes("NEVER-DISPLAY"));
      assert.equal(JSON.stringify(evidence), original);
      await db.update(entityRecordsTable).set({ valuesJson: { number: "Новое название" } }).where(eq(entityRecordsTable.id, 1007));
      const [renamed] = await enrichSecurityReferences([evidence]);
      assert.equal(renamed!.displayReferences.find(r => r.kind === "record")?.nameJson?.ru, "Новое название");
      const deniedRecord = await request("/records/1007", token);
      const deniedEntity = await request("/entities/1007/records", token);
      assert.equal(deniedRecord.status, 403);
      const recordPage = await request("/security/events/query", token, { requestId: deniedRecord.requestId });
      assert.equal(recordPage.data.data[0].detailsJson.targetRecordId, 1007);
      assert.equal(recordPage.data.data[0].displayReferences.find((r: { kind: string }) => r.kind === "record").nameJson.ru, "Новое название");
      const entityPage = await request("/security/events/query", token, { requestId: deniedEntity.requestId });
      assert.equal(entityPage.data.data[0].displayReferences.find((r: { kind: string }) => r.kind === "entity").nameJson.ru, "Заказы");
      await db.delete(entityRecordsTable).where(eq(entityRecordsTable.id, 1007));
      const [deleted] = await enrichSecurityReferences([evidence]);
      assert.equal(deleted!.displayReferences.find(r => r.kind === "record")?.missing, true);
      assert.equal(deleted!.displayReferences.find(r => r.kind === "record")?.nameJson, undefined);
      assert.deepEqual(await enrichSecurityReferences([]), []);
      assert.deepEqual(securityReferenceIds({ detailsJson: { targetUserId: 1001, targetRecordId: "1007", targetEntityId: -1 } }), []);
    });
    await t.test("export includes every filtered page, names and metadata without modifying evidence; limits fail explicitly", async () => {
      const insertRows = (from: number, to: number) => db.execute(sql`
        INSERT INTO security_events (id, request_id, action, outcome, actor_user_id,
          peer_ip, client_ip, ip_source, method, route, created_at, last_seen_at, occurrence_count)
        SELECT 2000000 + n, 'export-fixture', 'export.fixture', 'denied', 1001,
          '127.0.0.1', '198.51.100.9', 'socket', 'GET', '/fixture',
          '2020-01-01T12:00:00Z'::timestamptz, '2020-01-01T12:10:00Z'::timestamptz, 3
        FROM generate_series(${from}::int, ${to}::int) AS n
      `);
      try {
        await insertRows(1, 60);
        const filters = { action: "export.fixture", actorUserId: 1001, clientIp: "198.51.100.9",
          from: "2020-01-01T00:00:00Z", to: "2020-01-02T00:00:00Z", limit: 1, offset: 40 };
        const before = await db.select().from(securityEventsTable).where(eq(securityEventsTable.action, "export.fixture"));
        const response = await fetch(base + "/security/events/export", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(filters),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.match(response.headers.get("content-disposition")!, /^attachment; filename="security-audit-.*\.json"$/);
        const file = await response.json() as Record<string, any>;
        assert.equal(file.count, 60); assert.equal(file.data.length, 60);
        assert.equal(file.timezone, "UTC"); assert.ok(file.exportedAt);
        assert.equal(file.filters.limit, undefined); assert.equal(file.filters.offset, undefined);
        assert.equal(file.filters.clientIp, filters.clientIp);
        assert.ok(file.data.every((r: any) => r.action === "export.fixture" && r.occurrenceCount === 3 && r.displayReferences[0].nameJson));
        assert.equal(new Set(file.data.map((r: any) => r.id)).size, 60);
        assert.ok(!JSON.stringify(file).includes(password));
        const after = await db.select().from(securityEventsTable).where(eq(securityEventsTable.action, "export.fixture"));
        assert.deepEqual(after, before);
        assert.equal((await request("/security/events/export", token, { action: "export.none" })).data.count, 0);
        assert.equal((await request("/security/events/export", token, { ...filters, onlyUnreviewed: true })).data.count, 0);
        assert.equal((await request("/security/events/export", token, { from: "2021-01-01T00:00:00Z", to: "2020-01-01T00:00:00Z" })).status, 400);
        assert.equal((await request("/security/events/export", undefined, {})).status, 401);
        for (const identity of [
          { userId: 1002, roleId: 1002 },
          { userId: 1001, roleId: 1001, guest: true },
          { userId: 1001, roleId: 1001, agentId: 999 },
          { userId: 1001, roleId: 1001, impersonatorId: 1001, impersonatorSessionVersion: 0 },
        ]) assert.equal((await request("/security/events/export", signToken(identity), {})).status, 403);
        await insertRows(61, 10001);
        const large = await request("/security/events/export", token, filters);
        assert.equal(large.status, 413);
        assert.equal(large.data.data, undefined);
      } finally {
        await db.delete(securityEventsTable).where(eq(securityEventsTable.action, "export.fixture"));
      }
    });
    await t.test("repeated failed login followed by success is highlighted", async () => {
      for (let i = 0; i < 5; i++) await request("/auth/login", undefined, { email: "admin@security.invalid", password: "wrong-fixture-password" });
      await request("/auth/login", undefined, { email: "admin@security.invalid", password });
      const rows = await db.select().from(securityEventsTable).where(eq(securityEventsTable.action, "auth.login"));
      assert.ok(rows.some((r) => r.outcome === "denied" && r.isAlert));
      assert.ok(rows.some((r) => r.outcome === "success" && r.isAlert));
      assert.notEqual(signToken({ userId: 1, roleId: 1 }), signToken({ userId: 1, roleId: 1 }));
    });
    await t.test("retention settings reject unauthorized writes, require confirmation and prevent stale edits", async () => {
      const input = { revision: 1, ordinaryDays: 30, importantDays: 180, warningSizeMb: 10, cleanupEnabled: false, confirmed: true };
      assert.equal((await request("/security/retention", signToken({ userId: 1002, roleId: 1002 }), input, "PUT")).status, 403);
      assert.equal((await request("/security/retention", token, { ...input, confirmed: false }, "PUT")).status, 400);
      assert.equal((await request("/security/retention", token, { ...input, importantDays: 5 }, "PUT")).status, 400);
      const saved = await request("/security/retention", token, input, "PUT");
      assert.equal(saved.status, 200); assert.equal(saved.data.cleanupEnabled, false);
      assert.equal((await request("/security/retention", token, input, "PUT")).status, 409);
      const read = await request("/security/retention", token);
      assert.equal(read.data.ordinaryDays, 30); assert.equal(read.data.revision, 2);
      assert.ok(read.data.sizeBytes > 0);
    });
    await t.test("cleanup is bounded, paused automatically, preserves fresh/important events and removes review orphans", async () => {
      const base = {
        requestId: "retention-fixture", action: "access.denied", outcome: "failure",
        peerIp: "test", clientIp: "test", ipSource: "socket", method: "GET", route: "/probe",
      };
      const ago = (days: number) => new Date(Date.now() - days * 86400000);
      await db.insert(securityEventsTable).values(Array.from({ length: 1005 }, (_, n) => ({
        ...base, id: 90000 + n, createdAt: ago(40), lastSeenAt: ago(40),
      })));
      await db.insert(securityEventsTable).values([
        { ...base, id: 92001, action: "user.create", severity: "critical", isAlert: true, lastSeenAt: ago(100) },
        { ...base, id: 92002, action: "user.create", severity: "critical", isAlert: true, lastSeenAt: ago(200) },
        { ...base, id: 92003, createdAt: ago(200), lastSeenAt: ago(1), occurrenceCount: 10 },
      ]);
      await db.insert(securityEventReviewsTable).values({ eventId: 92002, reviewedBy: 1001 });
      assert.equal(await cleanupSecurityEvents(), 0);
      assert.equal(await cleanupSecurityEvents(true), 1000);
      assert.equal(await cleanupSecurityEvents(true), 6);
      assert.equal((await db.select().from(securityEventReviewsTable).where(eq(securityEventReviewsTable.eventId, 92002))).length, 0);
      assert.equal((await db.select().from(securityEventsTable).where(eq(securityEventsTable.id, 92001))).length, 1);
      assert.equal((await db.select().from(securityEventsTable).where(eq(securityEventsTable.id, 92003))).length, 1);
      assert.equal((await request("/security/retention", token)).data.expiredCount, 0);
    });
    await t.test("repeat counters are atomic, successful actions stay separate and anonymous group growth is bounded", async () => {
      const base = { requestId: "aggregation-fixture", action: "access.denied", outcome: "denied",
        peerIp: "127.0.0.1", clientIp: "198.51.100.1", ipSource: "socket", method: "GET", route: "/probe", isAlert: true };
      await Promise.all(Array.from({ length: 10 }, () => storeSecurityEvidence(base)));
      let rows = await db.select().from(securityEventsTable);
      assert.equal(rows.find((r) => r.requestId === base.requestId)!.occurrenceCount, 10);
      await storeSecurityEvidence({ ...base, requestId: "success-one", action: "user.create", outcome: "success", actorUserId: 1001 });
      await storeSecurityEvidence({ ...base, requestId: "success-two", action: "user.create", outcome: "success", actorUserId: 1001 });
      for (let i = 0; i < 110; i++) await storeSecurityEvidence({ ...base, clientIp: `198.51.100.${i + 2}` });
      rows = await db.select().from(securityEventsTable);
      const groups = rows.filter((r) => r.aggregationKey);
      assert.ok(groups.length <= 101);
      assert.ok(groups.some((r) => r.detailsJson.sourceDetailsTruncated === true));
      assert.equal(rows.filter((r) => ["success-one", "success-two"].includes(r.requestId)).length, 2);
    });
    await t.test("key rotation retains the target, not the key; missing audit storage prevents the operation", async () => {
      assert.equal((await request("/ai-agents/91/regenerate-key", token, {})).status, 200);
      const page = await request("/security/events/query", token, { agentId: 91 });
      assert.ok(page.data.total >= 1);
      assert.ok(page.data.data.some((r: { outcome: string }) => r.outcome === "success"));
      assert.ok(page.data.data.every((r: { detailsJson: Record<string, unknown> }) => r.detailsJson.targetAgentId === 91));
      assert.ok(!JSON.stringify(page.data).includes("NEVER-STORE-AGENT-KEY"));
      assert.equal(rotations, 1);
      await bootstrap.query(`ALTER TABLE "${schema}".security_events RENAME TO security_events_unavailable`);
      try {
        assert.equal((await request("/ai-agents/91/regenerate-key", token, {})).status, 503);
        assert.equal(rotations, 1);
      } finally {
        await flushSecurityAudit();
        await bootstrap.query(`ALTER TABLE "${schema}".security_events_unavailable RENAME TO security_events`);
      }
    });
  } finally {
    if (server) await new Promise<void>((resolve) => { server!.close(() => resolve()); server!.closeAllConnections(); });
    await flushSecurityAudit();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release(); await pool.end();
  }
});
